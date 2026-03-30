import React, { useEffect, useMemo, useState } from "react";
import SimpleModal from "../components/SimpleModal";
import { UI } from "../styles/ui";
import { getMaterialStockItems, type MaterialStockItem } from "../services/materialStockApi";
import {
  getMaterialRequirements,
  postMaterialIssue,
  postMaterialReservationsRebuildAll,
  type MaterialRequirementRow,
  type MaterialRequirementRelatedOrder,
} from "../services/materialRequirementsApi";

type Props = {
  onOpenProductionOrderInWorkspaceTab?: (productionOrderId: number, titleHint?: string) => void;
  onOpenCustomerOrderInWorkspaceTab?: (customerOrderId: number, titleHint?: string) => void;
};

function formatQty(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "0";
  return n.toLocaleString("cs-CZ", { maximumFractionDigits: 2 });
}

function norm(v: string): string {
  return v.trim().toLowerCase();
}

function reservationLabel(r: MaterialRequirementRelatedOrder): string {
  const vp = r.vp_code ?? (r.production_order_id != null ? `VP #${r.production_order_id}` : "VP");
  const z = r.zakazka ? ` · ${r.zakazka}` : "";
  return `${vp}${z}`;
}

function flatPendingReservations(row: MaterialRequirementRow): Array<{
  rel: MaterialRequirementRelatedOrder;
  reservation_id: number;
  reserved_qty: number;
  required_qty: number;
}> {
  const out: Array<{
    rel: MaterialRequirementRelatedOrder;
    reservation_id: number;
    reserved_qty: number;
    required_qty: number;
  }> = [];
  for (const rel of row.related_orders.filter((x) => x.status !== "issued")) {
    const lines =
      rel.reservation_lines && rel.reservation_lines.length > 0
        ? rel.reservation_lines.filter((l) => l.status !== "issued")
        : [
            {
              reservation_id: rel.reservation_id,
              reserved_qty: rel.reserved_qty,
              required_qty: rel.required_qty,
              status: rel.status,
            },
          ];
    for (const ln of lines) {
      out.push({
        rel,
        reservation_id: ln.reservation_id,
        reserved_qty: Number(ln.reserved_qty ?? 0),
        required_qty: Number(ln.required_qty ?? 0),
      });
    }
  }
  return out;
}

export default function MaterialRequirementsPage({
  onOpenProductionOrderInWorkspaceTab,
  onOpenCustomerOrderInWorkspaceTab,
}: Props) {
  const [rows, setRows] = useState<MaterialRequirementRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [onlyShortages, setOnlyShortages] = useState(false);
  const [materialCodeFilter, setMaterialCodeFilter] = useState("");
  const [orderVpFilter, setOrderVpFilter] = useState("");

  const [issueRow, setIssueRow] = useState<MaterialRequirementRow | null>(null);
  const [issueReservationId, setIssueReservationId] = useState<number | "">("");
  const [issueQty, setIssueQty] = useState("");
  const [issueStockItemId, setIssueStockItemId] = useState<number | "">("");
  const [stockOptions, setStockOptions] = useState<MaterialStockItem[]>([]);
  const [issueBusy, setIssueBusy] = useState(false);
  const [issueError, setIssueError] = useState<string | null>(null);

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const data = await getMaterialRequirements();
      setRows(data);
    } catch (e: unknown) {
      setRows([]);
      setError(e instanceof Error ? e.message : "Nepodařilo se načíst požadavky materiálu.");
    } finally {
      setLoading(false);
    }
  }

  async function refreshWithRebuild() {
    setLoading(true);
    setError(null);
    try {
      await postMaterialReservationsRebuildAll();
      const data = await getMaterialRequirements();
      setRows(data);
    } catch (e: unknown) {
      setRows([]);
      setError(e instanceof Error ? e.message : "Obnovení požadavků se nezdařilo.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData().catch(() => {
      // handled in loadData
    });
  }, []);

  useEffect(() => {
    if (!issueRow) return;
    let cancelled = false;
    void getMaterialStockItems()
      .then((items) => {
        if (cancelled) return;
        setStockOptions(items.filter((s) => s.material_library_item_id === issueRow.material_library_item_id));
      })
      .catch(() => {
        if (!cancelled) setStockOptions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [issueRow]);

  const filtered = useMemo(() => {
    const codeQ = norm(materialCodeFilter);
    const orderQ = norm(orderVpFilter);
    return rows.filter((r) => {
      const hasShortage = (r.shortage ?? 0) > 0;
      if (onlyShortages && !hasShortage) return false;

      const code = norm(r.material.code ?? "");
      if (codeQ && !code.includes(codeQ)) return false;

      if (orderQ) {
        const hay = r.related_orders
          .map((x) => `${x.zakazka ?? ""} ${x.vp_code ?? ""} ${x.gpn ?? ""}`)
          .join(" ");
        if (!norm(hay).includes(orderQ)) return false;
      }
      return true;
    });
  }, [rows, onlyShortages, materialCodeFilter, orderVpFilter]);

  function openIssueModal(row: MaterialRequirementRow) {
    const flat = flatPendingReservations(row);
    if (flat.length === 0) return;
    setIssueRow(row);
    const first = flat[0]!;
    setIssueReservationId(first.reservation_id);
    const defQty = first.reserved_qty > 0 ? first.reserved_qty : first.required_qty;
    setIssueQty(defQty > 0 ? String(defQty) : "1");
    setIssueStockItemId("");
    setIssueError(null);
  }

  async function submitIssue() {
    if (issueRow == null || issueReservationId === "") return;
    const q = Number(String(issueQty).replace(",", "."));
    if (!Number.isFinite(q) || q <= 0) {
      setIssueError("Zadejte platné množství větší než 0.");
      return;
    }
    setIssueBusy(true);
    setIssueError(null);
    try {
      await postMaterialIssue({
        reservation_id: Number(issueReservationId),
        qty: q,
        stock_item_id: issueStockItemId === "" ? null : Number(issueStockItemId),
      });
      setIssueRow(null);
      await loadData();
    } catch (e: unknown) {
      setIssueError(e instanceof Error ? e.message : "Vydání se nepodařilo.");
    } finally {
      setIssueBusy(false);
    }
  }

  return (
    <div style={UI.container}>
      <div style={{ paddingTop: 10, display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={UI.pageHeaderRow}>
          <div>
            <div style={UI.sectionTitle}>Požadavky materiálu</div>
            <div style={UI.sectionSubtitle}>Nákup a plánování podle aktuálních rezervací a dostupnosti</div>
          </div>
          <div style={UI.pageHeaderActions}>
            <button type="button" style={UI.buttons.secondary} onClick={() => void refreshWithRebuild()}>
              Obnovit
            </button>
          </div>
        </div>

        <div style={{ ...UI.card, display: "grid", gridTemplateColumns: "repeat(3, minmax(180px, 1fr))", gap: 10 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700 }}>
            <input type="checkbox" checked={onlyShortages} onChange={(e) => setOnlyShortages(e.target.checked)} />
            Jen chybějící materiál
          </label>
          <input
            style={UI.inputs.base}
            placeholder="Filtr kódu materiálu…"
            value={materialCodeFilter}
            onChange={(e) => setMaterialCodeFilter(e.target.value)}
          />
          <input
            style={UI.inputs.base}
            placeholder="Filtr zakázka / VP / GPN…"
            value={orderVpFilter}
            onChange={(e) => setOrderVpFilter(e.target.value)}
          />
        </div>

        {loading ? (
          <div style={UI.card}>Načítám požadavky materiálu…</div>
        ) : error ? (
          <div style={{ ...UI.card, borderColor: "#fecaca", background: "#fef2f2", color: "#991b1b", fontWeight: 700 }}>
            {error}
          </div>
        ) : (
          <div style={{ ...UI.card, overflowX: "auto" }}>
            <table style={UI.table}>
              <thead>
                <tr>
                  <th style={UI.th}>Kód materiálu</th>
                  <th style={UI.th}>Materiál</th>
                  <th style={UI.th}>Požadováno</th>
                  <th style={UI.th}>Rezervováno / vydáno</th>
                  <th style={UI.th}>Skladem</th>
                  <th style={UI.th}>Chybí</th>
                  <th style={UI.th}>Zakázky / VP</th>
                  <th style={UI.th}>Stav</th>
                  <th style={UI.th}>Akce</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => {
                  const reserved = row.related_orders.reduce((acc, x) => acc + Number(x.reserved_qty || 0), 0);
                  const issued = row.related_orders.reduce(
                    (acc, x) => acc + (x.status === "issued" ? Number(x.reserved_qty || 0) : 0),
                    0
                  );
                  const shortage = Number(row.shortage || 0);
                  const status =
                    shortage > 0 ? "Chybí materiál" : reserved < Number(row.required || 0) ? "Čeká rezervace" : "Pokryto";
                  const pendingRes = row.related_orders.filter((x) => x.status !== "issued");
                  return (
                    <tr
                      key={row.material_library_item_id}
                      style={shortage > 0 ? { background: "#fef2f2", borderLeft: "4px solid #dc2626" } : undefined}
                    >
                      <td style={UI.td}>{row.material.code ?? "—"}</td>
                      <td style={UI.td}>{row.material.name ?? "—"}</td>
                      <td style={UI.td}>{formatQty(row.required)}</td>
                      <td style={UI.td}>
                        {formatQty(reserved)} / {formatQty(issued)}
                      </td>
                      <td style={UI.td}>{formatQty(row.available)}</td>
                      <td style={{ ...UI.td, fontWeight: 900, color: shortage > 0 ? "#b91c1c" : "#166534" }}>
                        {formatQty(shortage)}
                      </td>
                      <td style={UI.td}>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                          {row.related_orders.length === 0 ? (
                            <span style={{ color: "#64748b" }}>—</span>
                          ) : (
                            row.related_orders.slice(0, 6).map((rel, idx) => (
                              <div key={`${row.material_library_item_id}-${idx}`} style={{ display: "inline-flex", gap: 6 }}>
                                {rel.customer_order_id != null ? (
                                  <button
                                    type="button"
                                    style={UI.buttons.secondary}
                                    onClick={() =>
                                      onOpenCustomerOrderInWorkspaceTab?.(
                                        rel.customer_order_id as number,
                                        rel.zakazka ? `Zakázka ${rel.zakazka}` : undefined
                                      )
                                    }
                                  >
                                    {rel.zakazka ? `Zak ${rel.zakazka}` : `Zak ${rel.customer_order_id}`}
                                  </button>
                                ) : null}
                                {rel.production_order_id != null ? (
                                  <button
                                    type="button"
                                    style={UI.buttons.secondary}
                                    onClick={() =>
                                      onOpenProductionOrderInWorkspaceTab?.(
                                        rel.production_order_id as number,
                                        rel.vp_code ?? undefined
                                      )
                                    }
                                  >
                                    {rel.vp_code ?? `VP ${rel.production_order_id}`}
                                  </button>
                                ) : null}
                              </div>
                            ))
                          )}
                          {row.related_orders.length > 6 ? (
                            <span style={{ color: "#64748b", fontSize: 12 }}>+{row.related_orders.length - 6} další</span>
                          ) : null}
                        </div>
                      </td>
                      <td style={UI.td}>
                        <span
                          style={{
                            display: "inline-block",
                            padding: "2px 8px",
                            borderRadius: 999,
                            fontSize: 12,
                            fontWeight: 800,
                            background: shortage > 0 ? "#fee2e2" : status === "Pokryto" ? "#dcfce7" : "#e2e8f0",
                            color: shortage > 0 ? "#991b1b" : status === "Pokryto" ? "#166534" : "#334155",
                          }}
                        >
                          {status}
                        </span>
                      </td>
                      <td style={UI.td}>
                        <button
                          type="button"
                          style={UI.buttons.primary}
                          disabled={pendingRes.length === 0}
                          onClick={() => openIssueModal(row)}
                        >
                          Vydat materiál
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!filtered.length ? <div style={{ marginTop: 12, color: "#64748b" }}>Žádné položky pro zadané filtry.</div> : null}
          </div>
        )}
      </div>

      <SimpleModal
        title="Vydat materiál"
        open={issueRow != null}
        onClose={() => !issueBusy && setIssueRow(null)}
        footer={
          <>
            <button type="button" style={UI.buttons.secondary} disabled={issueBusy} onClick={() => setIssueRow(null)}>
              Zrušit
            </button>
            <button type="button" style={UI.buttons.primary} disabled={issueBusy} onClick={() => void submitIssue()}>
              {issueBusy ? "Ukládám…" : "Potvrdit výdej"}
            </button>
          </>
        }
      >
        {issueRow ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ fontSize: 13, color: "#64748b" }}>
              {issueRow.material.code} — {issueRow.material.name}
            </div>
            {issueRow && flatPendingReservations(issueRow).length > 1 ? (
              <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontWeight: 800 }}>Rezervace (VP)</span>
                <select
                  style={UI.inputs.base}
                  value={issueReservationId === "" ? "" : String(issueReservationId)}
                  onChange={(e) => {
                    const v = e.target.value;
                    setIssueReservationId(v === "" ? "" : Number(v));
                    const flat = flatPendingReservations(issueRow);
                    const sel = flat.find((x) => x.reservation_id === Number(v));
                    if (sel) {
                      const d = sel.reserved_qty > 0 ? sel.reserved_qty : sel.required_qty;
                      setIssueQty(d > 0 ? String(d) : "1");
                    }
                  }}
                >
                  {flatPendingReservations(issueRow).map((x) => (
                    <option key={`${x.rel.production_order_id}-${x.reservation_id}`} value={String(x.reservation_id)}>
                      {reservationLabel(x.rel)} · {formatQty(x.reserved_qty || x.required_qty)} jednotek
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontWeight: 800 }}>Množství</span>
              <input
                style={UI.inputs.base}
                type="text"
                inputMode="decimal"
                value={issueQty}
                onChange={(e) => setIssueQty(e.target.value)}
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontWeight: 800 }}>Skladová karta (volitelné)</span>
              <select
                style={UI.inputs.base}
                value={issueStockItemId === "" ? "" : String(issueStockItemId)}
                onChange={(e) => setIssueStockItemId(e.target.value === "" ? "" : Number(e.target.value))}
              >
                <option value="">Automaticky (nejvyšší dostupné množství)</option>
                {stockOptions.map((s) => (
                  <option key={s.id} value={String(s.id)}>
                    {s.location ? `${s.location} · ` : ""}
                    {formatQty(s.available_qty)} k disp. (ks {s.id})
                  </option>
                ))}
              </select>
            </label>
            {issueError ? <div style={{ color: "#b91c1c", fontWeight: 700 }}>{issueError}</div> : null}
          </div>
        ) : null}
      </SimpleModal>
    </div>
  );
}
