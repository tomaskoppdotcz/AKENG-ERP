import React, { useEffect, useMemo, useState } from "react";
import SimpleModal from "../components/SimpleModal";
import { UI } from "../styles/ui";
import { getMaterialStockItems, type MaterialStockItem } from "../services/materialStockApi";
import {
  getMaterialRequirements,
  getMaterialRequirementsByVp,
  listCustomersForPurchase,
  postMaterialIssue,
  postMaterialPurchaseOrder,
  postMaterialReservationsRebuildAll,
  type CustomerOption,
  type MaterialPurchaseLinePayload,
  type MaterialRequirementRelatedOrder,
  type MaterialRequirementRow,
  type VpMaterialLine,
  type VpRequirementRow,
} from "../services/materialRequirementsApi";

type Props = {
  onOpenProductionOrderInWorkspaceTab?: (productionOrderId: number, titleHint?: string) => void;
  onOpenCustomerOrderInWorkspaceTab?: (customerOrderId: number, titleHint?: string) => void;
};

type ViewMode = "by_vp" | "by_material";

const PURCHASE_BUFFER = 1.1;

function formatQty(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "0";
  return n.toLocaleString("cs-CZ", { maximumFractionDigits: 3 });
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

function flatPendingFromVpLine(vp: VpRequirementRow, m: VpMaterialLine) {
  const rel: MaterialRequirementRelatedOrder = {
    reservation_id: m.reservation_id,
    reservation_ids: m.reservation_ids,
    reservation_count: m.reservation_count,
    reservation_lines: m.reservation_lines,
    production_order_id: vp.production_order_id,
    vp_code: vp.vp_code,
    job_item_id: vp.job_item_id,
    customer_order_id: vp.customer_order_id,
    zakazka: vp.zakazka,
    gpn: vp.gpn ?? m.gpn,
    required_qty: m.required_qty,
    reserved_qty: m.reserved_qty,
    status: m.status,
  };
  const lines =
    m.reservation_lines && m.reservation_lines.length > 0
      ? m.reservation_lines.filter((l) => l.status !== "issued")
      : [
          {
            reservation_id: m.reservation_id,
            reserved_qty: m.reserved_qty,
            required_qty: m.required_qty,
            status: m.status,
          },
        ];
  const out: Array<{
    rel: MaterialRequirementRelatedOrder;
    reservation_id: number;
    reserved_qty: number;
    required_qty: number;
  }> = [];
  for (const ln of lines) {
    out.push({
      rel,
      reservation_id: ln.reservation_id,
      reserved_qty: Number(ln.reserved_qty ?? 0),
      required_qty: Number(ln.required_qty ?? 0),
    });
  }
  return out;
}

function syntheticRowFromVp(vp: VpRequirementRow, m: VpMaterialLine): MaterialRequirementRow {
  return {
    material_library_item_id: m.material_library_item_id,
    material: { code: m.material.code, name: m.material.name },
    required: m.required_qty,
    available: m.available,
    shortage: m.shortage,
    related_orders: [
      {
        reservation_id: m.reservation_id,
        reservation_ids: m.reservation_ids,
        reservation_count: m.reservation_count,
        reservation_lines: m.reservation_lines,
        production_order_id: vp.production_order_id,
        vp_code: vp.vp_code,
        job_item_id: vp.job_item_id,
        customer_order_id: vp.customer_order_id,
        zakazka: vp.zakazka,
        gpn: vp.gpn ?? m.gpn,
        required_qty: m.required_qty,
        reserved_qty: m.reserved_qty,
        status: m.status,
      },
    ],
  };
}

function uncoveredBaseForLine(m: VpMaterialLine): number {
  const gap = Math.max(0, Number(m.required_qty || 0) - Number(m.reserved_qty || 0));
  return Math.max(gap, Number(m.shortage || 0));
}

type PurchaseDraftLine = {
  material_library_item_id: number;
  code: string | null;
  name: string | null;
  unit: string | null;
  qty: number;
  traceability_note: string;
};

function buildPurchaseDraftForVp(vp: VpRequirementRow): PurchaseDraftLine[] {
  const byMid = new Map<
    number,
    { base: number; traces: string[]; code: string | null; name: string | null; unit: string | null }
  >();
  for (const m of vp.materials) {
    const base = uncoveredBaseForLine(m);
    if (base <= 1e-9) continue;
    const trace = `Zakázka ${vp.zakazka ?? "—"} · ${vp.vp_code ?? "VP"} · GPN ${vp.gpn ?? m.gpn ?? "—"} · ${m.material.code ?? "?"} · požadavek ${formatQty(m.required_qty)} / rez. ${formatQty(m.reserved_qty)} / sklad ${formatQty(m.available)}`;
    const mid = m.material_library_item_id;
    const cur = byMid.get(mid);
    if (cur) {
      cur.base += base;
      cur.traces.push(trace);
    } else {
      byMid.set(mid, {
        base,
        traces: [trace],
        code: m.material.code,
        name: m.material.name,
        unit: m.material.unit,
      });
    }
  }
  return [...byMid.entries()].map(([material_library_item_id, v]) => ({
    material_library_item_id,
    code: v.code,
    name: v.name,
    unit: v.unit,
    qty: Math.round(v.base * PURCHASE_BUFFER * 1000) / 1000,
    traceability_note: v.traces.join("\n"),
  }));
}

export default function MaterialRequirementsPage({
  onOpenProductionOrderInWorkspaceTab,
  onOpenCustomerOrderInWorkspaceTab,
}: Props) {
  const [viewMode, setViewMode] = useState<ViewMode>("by_vp");
  const [rows, setRows] = useState<MaterialRequirementRow[]>([]);
  const [vpRows, setVpRows] = useState<VpRequirementRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [onlyShortages, setOnlyShortages] = useState(false);
  const [materialCodeFilter, setMaterialCodeFilter] = useState("");
  const [orderVpFilter, setOrderVpFilter] = useState("");
  const [expandedVp, setExpandedVp] = useState<Set<number>>(() => new Set());

  const [issueRow, setIssueRow] = useState<MaterialRequirementRow | null>(null);
  const [issueReservationId, setIssueReservationId] = useState<number | "">("");
  const [issueQty, setIssueQty] = useState("");
  const [issueStockItemId, setIssueStockItemId] = useState<number | "">("");
  const [stockOptions, setStockOptions] = useState<MaterialStockItem[]>([]);
  const [issueBusy, setIssueBusy] = useState(false);
  const [issueError, setIssueError] = useState<string | null>(null);

  const [purchaseOpen, setPurchaseOpen] = useState(false);
  const [purchaseVp, setPurchaseVp] = useState<VpRequirementRow | null>(null);
  const [purchaseLines, setPurchaseLines] = useState<PurchaseDraftLine[]>([]);
  const [suppliers, setSuppliers] = useState<CustomerOption[]>([]);
  const [supplierId, setSupplierId] = useState<number | "">("");
  const [purchaseBusy, setPurchaseBusy] = useState(false);
  const [purchaseError, setPurchaseError] = useState<string | null>(null);
  const [purchaseHeaderNote, setPurchaseHeaderNote] = useState("");

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const [agg, byVp] = await Promise.all([getMaterialRequirements(), getMaterialRequirementsByVp()]);
      setRows(agg);
      setVpRows(byVp);
    } catch (e: unknown) {
      setRows([]);
      setVpRows([]);
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
      await loadData();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Obnovení požadavků se nezdařilo.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData().catch(() => {});
  }, []);

  useEffect(() => {
    if (!purchaseOpen) return;
    let cancelled = false;
    void listCustomersForPurchase()
      .then((c) => {
        if (!cancelled) setSuppliers(c.filter((x) => x.is_active !== false));
      })
      .catch(() => {
        if (!cancelled) setSuppliers([]);
      });
    return () => {
      cancelled = true;
    };
  }, [purchaseOpen]);

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

  const filteredMaterial = useMemo(() => {
    const codeQ = norm(materialCodeFilter);
    const orderQ = norm(orderVpFilter);
    return rows.filter((r) => {
      const hasShortage = (r.shortage ?? 0) > 0;
      if (onlyShortages && !hasShortage) return false;
      const code = norm(r.material.code ?? "");
      if (codeQ && !code.includes(codeQ)) return false;
      if (orderQ) {
        const hay = r.related_orders.map((x) => `${x.zakazka ?? ""} ${x.vp_code ?? ""} ${x.gpn ?? ""}`).join(" ");
        if (!norm(hay).includes(orderQ)) return false;
      }
      return true;
    });
  }, [rows, onlyShortages, materialCodeFilter, orderVpFilter]);

  const filteredVp = useMemo(() => {
    const codeQ = norm(materialCodeFilter);
    const orderQ = norm(orderVpFilter);
    return vpRows.filter((vp) => {
      if (onlyShortages && vp.coverage !== "uncovered") return false;
      const hay = `${vp.zakazka ?? ""} ${vp.vp_code ?? ""} ${vp.gpn ?? ""} ${vp.order_type ?? ""}`;
      if (orderQ && !norm(hay).includes(orderQ)) return false;
      if (codeQ) {
        const hit = vp.materials.some((m) => norm(m.material.code ?? "").includes(codeQ));
        if (!hit) return false;
      }
      return true;
    });
  }, [vpRows, onlyShortages, materialCodeFilter, orderVpFilter]);

  function toggleExpand(pid: number) {
    setExpandedVp((prev) => {
      const n = new Set(prev);
      if (n.has(pid)) n.delete(pid);
      else n.add(pid);
      return n;
    });
  }

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

  function openIssueFromVp(vp: VpRequirementRow, m: VpMaterialLine) {
    const flat = flatPendingFromVpLine(vp, m).filter((x) => x.rel.status !== "issued");
    if (flat.length === 0) return;
    setIssueRow(syntheticRowFromVp(vp, m));
    const first = flat[0]!;
    setIssueReservationId(first.reservation_id);
    const defQty = first.reserved_qty > 0 ? first.reserved_qty : first.required_qty;
    setIssueQty(defQty > 0 ? String(defQty) : "1");
    setIssueStockItemId("");
    setIssueError(null);
  }

  function openPurchaseModal(vp: VpRequirementRow) {
    const draft = buildPurchaseDraftForVp(vp);
    if (draft.length === 0) return;
    setPurchaseVp(vp);
    setPurchaseLines(draft);
    setSupplierId("");
    setPurchaseHeaderNote(`Nákup z požadavků VP ${vp.vp_code ?? vp.production_order_id}`);
    setPurchaseError(null);
    setPurchaseOpen(true);
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

  async function submitPurchase() {
    if (supplierId === "" || !purchaseVp) return;
    setPurchaseBusy(true);
    setPurchaseError(null);
    try {
      const lines: MaterialPurchaseLinePayload[] = purchaseLines.map((l) => ({
        material_library_item_id: l.material_library_item_id,
        qty_ordered: l.qty,
        traceability_note: l.traceability_note,
      }));
      await postMaterialPurchaseOrder({
        supplier_customer_id: Number(supplierId),
        lines,
        header_note: purchaseHeaderNote || null,
      });
      setPurchaseOpen(false);
      setPurchaseVp(null);
    } catch (e: unknown) {
      setPurchaseError(e instanceof Error ? e.message : "Uložení se nepodařilo.");
    } finally {
      setPurchaseBusy(false);
    }
  }

  function openFirstIssueForVp(vp: VpRequirementRow) {
    for (const m of vp.materials) {
      const flat = flatPendingFromVpLine(vp, m).filter((x) => x.rel.status !== "issued");
      if (flat.length > 0) {
        openIssueFromVp(vp, m);
        return;
      }
    }
  }

  return (
    <div style={UI.container}>
      <div style={{ paddingTop: 10, display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={UI.pageHeaderRow}>
          <div>
            <div style={UI.sectionTitle}>Požadavky materiálu</div>
            <div style={UI.sectionSubtitle}>
              Provozní přehled podle zakázek a VP; souhrn podle materiálu pro nákupní pool.
            </div>
          </div>
          <div style={UI.pageHeaderActions}>
            <button type="button" style={UI.buttons.secondary} onClick={() => void refreshWithRebuild()}>
              Obnovit
            </button>
          </div>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          {(
            [
              { id: "by_vp" as const, label: "Podle zakázek / VP" },
              { id: "by_material" as const, label: "Souhrn podle materiálu" },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setViewMode(t.id)}
              style={{
                ...UI.ordersFilterChip,
                ...(viewMode === t.id ? UI.ordersFilterChipActive : {}),
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div style={{ ...UI.card, display: "grid", gridTemplateColumns: "repeat(3, minmax(180px, 1fr))", gap: 10 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700 }}>
            <input type="checkbox" checked={onlyShortages} onChange={(e) => setOnlyShortages(e.target.checked)} />
            Jen nepokryté / shortage
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
        ) : viewMode === "by_vp" ? (
          <div style={{ ...UI.card, overflowX: "auto" }}>
            <table style={UI.table}>
              <thead>
                <tr>
                  <th style={{ ...UI.th, width: 40 }} />
                  <th style={UI.th}>Zakázka</th>
                  <th style={UI.th}>VP</th>
                  <th style={UI.th}>GPN</th>
                  <th style={UI.th}>Termín</th>
                  <th style={UI.th}>Typ</th>
                  <th style={UI.th}>Materiál VP</th>
                  <th style={UI.th}>Pokrytí</th>
                  <th style={UI.th}>Materiál připraven</th>
                  <th style={UI.th}>Akce</th>
                </tr>
              </thead>
              <tbody>
                {filteredVp.map((vp) => {
                  const exp = expandedVp.has(vp.production_order_id);
                  const cov = vp.coverage === "covered";
                  return (
                    <React.Fragment key={vp.production_order_id}>
                      <tr
                        style={
                          !cov
                            ? { background: "#fef2f2", borderLeft: "4px solid #dc2626" }
                            : { borderLeft: "4px solid #22c55e" }
                        }
                      >
                        <td style={UI.td}>
                          <button
                            type="button"
                            style={UI.buttons.secondary}
                            onClick={() => toggleExpand(vp.production_order_id)}
                            aria-expanded={exp}
                          >
                            {exp ? "▼" : "▶"}
                          </button>
                        </td>
                        <td style={UI.td}>
                          {vp.customer_order_id != null ? (
                            <button
                              type="button"
                              style={{ ...UI.buttons.secondary, fontWeight: 800 }}
                              onClick={() =>
                                onOpenCustomerOrderInWorkspaceTab?.(
                                  vp.customer_order_id!,
                                  vp.zakazka ? `Zakázka ${vp.zakazka}` : undefined
                                )
                              }
                            >
                              {vp.zakazka ?? `CO #${vp.customer_order_id}`}
                            </button>
                          ) : (
                            vp.zakazka ?? "—"
                          )}
                        </td>
                        <td style={UI.td}>
                          <button
                            type="button"
                            style={{ ...UI.buttons.secondary, fontWeight: 900 }}
                            onClick={() =>
                              onOpenProductionOrderInWorkspaceTab?.(vp.production_order_id, vp.vp_code ?? undefined)
                            }
                          >
                            {vp.vp_code ?? `VP #${vp.production_order_id}`}
                          </button>
                        </td>
                        <td style={UI.td}>{vp.gpn ?? "—"}</td>
                        <td style={UI.td}>{vp.due_date ?? "—"}</td>
                        <td style={UI.td}>
                          {vp.order_type === "internal" ? (
                            <span style={{ fontSize: 11, fontWeight: 900, color: "#475569" }}>Interní</span>
                          ) : (
                            "Zákazník"
                          )}
                        </td>
                        <td style={UI.td}>{vp.materials.length}</td>
                        <td style={UI.td}>
                          <span
                            style={{
                              display: "inline-block",
                              padding: "2px 10px",
                              borderRadius: 999,
                              fontSize: 12,
                              fontWeight: 800,
                              background: cov ? "#dcfce7" : "#fee2e2",
                              color: cov ? "#166534" : "#991b1b",
                            }}
                          >
                            {cov ? "Pokryto" : "Nepokryto"}
                          </span>
                        </td>
                        <td style={UI.td}>{vp.is_material_ready ? "Ano" : "Ne"}</td>
                        <td style={UI.td}>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                            {cov ? (
                              <button type="button" style={UI.buttons.primary} onClick={() => openFirstIssueForVp(vp)}>
                                Vydat
                              </button>
                            ) : (
                              <button type="button" style={UI.buttons.primary} onClick={() => openPurchaseModal(vp)}>
                                Objednat
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                      {exp ? (
                        <tr>
                          <td colSpan={10} style={{ ...UI.td, background: "#f8fafc", padding: 12 }}>
                            <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 8 }}>Materiály pro VP</div>
                            <table style={{ ...UI.table, width: "100%" }}>
                              <thead>
                                <tr style={{ background: "#f1f5f9" }}>
                                  {[
                                    "Kód",
                                    "Materiál",
                                    "Rozměr",
                                    "Požadováno",
                                    "Rezervováno",
                                    "Skladem",
                                    "Chybí",
                                    "Stav TP",
                                    "Akce",
                                  ].map((h) => (
                                    <th key={h} style={{ ...UI.th, fontSize: 11 }}>
                                      {h}
                                    </th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {vp.materials.map((m) => {
                                  const pend = flatPendingFromVpLine(vp, m).filter((x) => x.rel.status !== "issued");
                                  const lineCov =
                                    Number(m.reserved_qty || 0) + 1e-9 >= Number(m.required_qty || 0) &&
                                    Number(m.shortage || 0) < 1e-6;
                                  return (
                                    <tr key={`${vp.production_order_id}-${m.material_library_item_id}`}>
                                      <td style={UI.td}>{m.material.code ?? "—"}</td>
                                      <td style={UI.td}>{m.material.name ?? "—"}</td>
                                      <td style={UI.td}>{m.material.dimension ?? "—"}</td>
                                      <td style={UI.td}>{formatQty(m.required_qty)}</td>
                                      <td style={UI.td}>{formatQty(m.reserved_qty)}</td>
                                      <td style={UI.td}>{formatQty(m.available)}</td>
                                      <td style={{ ...UI.td, fontWeight: 800, color: m.shortage > 0 ? "#b91c1c" : "#166534" }}>
                                        {formatQty(m.shortage)}
                                      </td>
                                      <td style={UI.td}>{m.status ?? "—"}</td>
                                      <td style={UI.td}>
                                        <button
                                          type="button"
                                          style={UI.buttons.primary}
                                          disabled={pend.length === 0 || !lineCov}
                                          onClick={() => openIssueFromVp(vp, m)}
                                        >
                                          Vydat
                                        </button>
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      ) : null}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
            {!filteredVp.length ? <div style={{ marginTop: 12, color: "#64748b" }}>Žádné VP pro zadané filtry.</div> : null}
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
                {filteredMaterial.map((row) => {
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
            {!filteredMaterial.length ? (
              <div style={{ marginTop: 12, color: "#64748b" }}>Žádné položky pro zadané filtry.</div>
            ) : null}
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

      <SimpleModal
        title="Objednat materiál (nákupní objednávka)"
        open={purchaseOpen}
        onClose={() => !purchaseBusy && setPurchaseOpen(false)}
        footer={
          <>
            <button type="button" style={UI.buttons.secondary} disabled={purchaseBusy} onClick={() => setPurchaseOpen(false)}>
              Zrušit
            </button>
            <button
              type="button"
              style={UI.buttons.primary}
              disabled={purchaseBusy || supplierId === ""}
              onClick={() => void submitPurchase()}
            >
              {purchaseBusy ? "Ukládám…" : "Potvrdit objednávku"}
            </button>
          </>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 12, fontSize: 14 }}>
          <div style={{ color: "#64748b" }}>
            Množství = součet neuspokojené poptávky na VP × {PURCHASE_BUFFER} (zaokrouhleno na 3 des.). Stopa poptávky je
            uložena u každé řádky.
          </div>
          {purchaseVp ? (
            <div style={{ fontWeight: 800 }}>
              VP {purchaseVp.vp_code ?? purchaseVp.production_order_id} · {purchaseVp.zakazka ?? "—"}
            </div>
          ) : null}
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontWeight: 800 }}>Dodavatel (z adresáře zákazníků)</span>
            <select
              style={UI.inputs.base}
              value={supplierId === "" ? "" : String(supplierId)}
              onChange={(e) => setSupplierId(e.target.value === "" ? "" : Number(e.target.value))}
            >
              <option value="">— vyberte —</option>
              {suppliers.map((s) => (
                <option key={s.id} value={String(s.id)}>
                  {s.name} ({s.code})
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontWeight: 800 }}>Poznámka k hlavičce</span>
            <input style={UI.inputs.base} value={purchaseHeaderNote} onChange={(e) => setPurchaseHeaderNote(e.target.value)} />
          </label>
          <div style={{ maxHeight: 280, overflowY: "auto", border: "1px solid #e2e8f0", borderRadius: 10, padding: 8 }}>
            {purchaseLines.map((l) => (
              <div key={l.material_library_item_id} style={{ marginBottom: 12, paddingBottom: 12, borderBottom: "1px solid #f1f5f9" }}>
                <div style={{ fontWeight: 900 }}>
                  {l.code} — {l.name}
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 6, alignItems: "center" }}>
                  <span style={{ fontWeight: 700 }}>Objednat (j.):</span>
                  <input
                    style={{ ...UI.inputs.base, width: 120 }}
                    type="text"
                    inputMode="decimal"
                    value={String(l.qty)}
                    onChange={(e) => {
                      const v = Number(String(e.target.value).replace(",", "."));
                      setPurchaseLines((prev) =>
                        prev.map((x) =>
                          x.material_library_item_id === l.material_library_item_id
                            ? { ...x, qty: Number.isFinite(v) ? v : x.qty }
                            : x
                        )
                      );
                    }}
                  />
                  {l.unit ? <span style={{ color: "#64748b" }}>{l.unit}</span> : null}
                </div>
                <div style={{ fontSize: 12, color: "#475569", marginTop: 6, whiteSpace: "pre-wrap" }}>{l.traceability_note}</div>
              </div>
            ))}
          </div>
          {purchaseError ? <div style={{ color: "#b91c1c", fontWeight: 700 }}>{purchaseError}</div> : null}
        </div>
      </SimpleModal>
    </div>
  );
}
