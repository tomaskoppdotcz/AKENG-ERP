import React, { useEffect, useMemo, useState } from "react";
import DetailPageHeader from "../components/DetailPageHeader";
import SimpleModal from "../components/SimpleModal";
import { UI } from "../styles/ui";
import { buildProductionOrderDetailHeaderModel, vpHeaderBadgeStyle } from "../utils/productionOrderDetailHeader";
import {
  getProductionOrderDetail,
  openProductionOrderPdfInNewTab,
  receiveFinishedGoodsToStock,
  reportProductionOrderOperation,
  startProductionOrderOperation,
  stornoProductionOrder,
  type ProductionOrderDetail,
} from "../services/productionOrdersApi";
import { buildErpUrl } from "../utils/erpDeepLink";
import { canPerformAction, readStoredErpRole } from "../auth/rbac";

const API_URL =
  (import.meta as any).env?.VITE_API_BASE_URL || "http://127.0.0.1:8000";

const linkButtonReset: React.CSSProperties = {
  background: "none",
  border: "none",
  padding: 0,
  margin: 0,
  cursor: "pointer",
  font: "inherit",
  color: "#2563eb",
  textDecoration: "underline",
  textUnderlineOffset: "3px",
  fontSize: "inherit",
  fontWeight: 800,
};

type Props = {
  productionOrderId: number;
  onBack: () => void;
  onWorkspaceTabTitle?: (title: string) => void;
  onOpenPortfolioItemId?: (portfolioItemId: number) => void;
  onOpenCustomerOrderCard?: (customerOrderId: number) => void;
  onPreviewPortfolioById?: (portfolioItemId: number) => void;
};

function isBusinessWorkflowActive(status: string | null | undefined): boolean {
  const s = String(status ?? "").trim().toLowerCase();
  return !s || s === "active";
}

/** Log-derived operation progress; canonical planned | bezi | hotovo. */
function labelVpOperationProgress(st: string | null | undefined): string {
  const s = String(st ?? "").trim().toLowerCase();
  if (s === "hotovo") return "Hotovo";
  if (s === "bezi") return "Běží";
  return "Naplánováno";
}

export default function ProductionOrderDetailPage({
  productionOrderId,
  onBack,
  onWorkspaceTabTitle,
  onOpenPortfolioItemId,
  onOpenCustomerOrderCard,
  onPreviewPortfolioById,
}: Props) {
  const [data, setData] = useState<ProductionOrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [opActionError, setOpActionError] = useState<string | null>(null);
  const [busyOp, setBusyOp] = useState<number | null>(null);
  const [okByOp, setOkByOp] = useState<Record<number, string>>({});
  const [nokByOp, setNokByOp] = useState<Record<number, string>>({});
  const [minutesByOp, setMinutesByOp] = useState<Record<number, string>>({});
  const [noteByOp, setNoteByOp] = useState<Record<number, string>>({});
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [receiveQty, setReceiveQty] = useState("");
  const [receiveLocation, setReceiveLocation] = useState("");
  const [receiveBusy, setReceiveBusy] = useState(false);
  const [receiveMessage, setReceiveMessage] = useState<string | null>(null);
  const [receiveError, setReceiveError] = useState<string | null>(null);
  const [stornoBusy, setStornoBusy] = useState(false);

  const erpRole = useMemo(() => readStoredErpRole(), []);
  const canProductionExecute = canPerformAction(erpRole, "production.execute");
  const canProductionStorno = canPerformAction(erpRole, "production.storno");
  const canStockMutate = canPerformAction(erpRole, "stock.mutate");
  const poWorkflowActive = isBusinessWorkflowActive(data?.workflow_status);

  async function loadDetail() {
    setLoading(true);
    setError(null);
    const r = await getProductionOrderDetail(productionOrderId);
    setData(r);
  }

  useEffect(() => {
    let cancelled = false;
    loadDetail()
      .then(() => {
        if (cancelled) return;
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Nepodařilo se načíst detail VP.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [productionOrderId]);

  useEffect(() => {
    if (!onWorkspaceTabTitle || !data) return;
    const code = data.vp_code?.trim();
    onWorkspaceTabTitle(code || `VP · #${productionOrderId}`);
  }, [data, productionOrderId, onWorkspaceTabTitle]);

  async function handleStartOperation(operationNo: number) {
    setOpActionError(null);
    setBusyOp(operationNo);
    try {
      await startProductionOrderOperation(productionOrderId, operationNo);
      await loadDetail();
    } catch (e: unknown) {
      setOpActionError(e instanceof Error ? e.message : "Nepodařilo se zahájit operaci.");
    } finally {
      setBusyOp(null);
    }
  }

  async function handleReportOperation(operationNo: number) {
    setOpActionError(null);
    setBusyOp(operationNo);
    const ok_qty = Math.max(0, Number(okByOp[operationNo] ?? 0) || 0);
    const nok_qty = Math.max(0, Number(nokByOp[operationNo] ?? 0) || 0);
    const reported_minutes = Math.max(0, Number(minutesByOp[operationNo] ?? 0) || 0);
    const note = (noteByOp[operationNo] ?? "").trim() || null;
    try {
      await reportProductionOrderOperation(productionOrderId, operationNo, {
        ok_qty,
        nok_qty,
        reported_minutes,
        note,
      });
      await loadDetail();
    } catch (e: unknown) {
      setOpActionError(e instanceof Error ? e.message : "Nepodařilo se odvést operaci.");
    } finally {
      setBusyOp(null);
    }
  }

  async function handleStornoVp() {
    if (!window.confirm("Stornovat tento výrobní příkaz? Rezervace materiálu se uvolní; záznam VP zůstane v historii.")) return;
    setStornoBusy(true);
    setOpActionError(null);
    try {
      await stornoProductionOrder(productionOrderId);
      await loadDetail();
    } catch (e: unknown) {
      setOpActionError(e instanceof Error ? e.message : "Storno VP se nezdařilo.");
    } finally {
      setStornoBusy(false);
    }
  }

  async function handleReceiveToStock() {
    if (!data) return;
    const q = Number(String(receiveQty).replace(",", "."));
    if (!Number.isFinite(q) || q <= 0) {
      setReceiveError("Zadejte platné množství větší než 0.");
      return;
    }
    setReceiveBusy(true);
    setReceiveError(null);
    setReceiveMessage(null);
    try {
      const res = await receiveFinishedGoodsToStock(productionOrderId, {
        qty: q,
        location: receiveLocation.trim() || null,
      });
      setReceiveMessage(`Přijato ${res.qty_received} ks, stav skladu: ${res.current_qty} ks.`);
      setReceiveOpen(false);
      setReceiveQty("");
      setReceiveLocation("");
      await loadDetail();
    } catch (e: unknown) {
      setReceiveError(e instanceof Error ? e.message : "Příjem se nepodařil.");
    } finally {
      setReceiveBusy(false);
    }
  }

  if (loading) {
    return (
      <div style={UI.container}>
        <div style={{ ...UI.card, borderRadius: 14 }}>
          <div style={UI.sectionSubtitle}>Načítám detail výrobního příkazu…</div>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div style={UI.container}>
        <button onClick={onBack} style={UI.buttonSecondary}>
          Zpět na výrobní příkazy
        </button>
        <div style={{ ...UI.card, borderRadius: 14, marginTop: 12, color: "#991b1b", border: "1px solid #fecaca", background: "#fef2f2" }}>
          {error ?? "Detail výrobního příkazu není dostupný."}
        </div>
      </div>
    );
  }

  const headerModel = buildProductionOrderDetailHeaderModel(data);

  return (
    <div style={UI.container}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <DetailPageHeader
          preHeader={
            !poWorkflowActive ? (
              <div
                style={{
                  padding: "12px 16px",
                  borderRadius: 10,
                  border: "1px solid #fecaca",
                  background: "#fef2f2",
                  color: "#991b1b",
                  fontWeight: 700,
                }}
              >
                Tento výrobní příkaz je stornován — provozní akce (zahájit/odvést, příjem) nejsou povoleny.
              </div>
            ) : null
          }
          title={
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: 10 }}>
              <span style={UI.pageTitle}>Výrobní příkaz</span>
              <span style={{ fontSize: 22, fontWeight: 1000, color: "#334155" }}>{data.vp_code}</span>
            </div>
          }
          subtitle={headerModel.headlineSentence}
          headerAside={
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
              <span style={vpHeaderBadgeStyle(headerModel.mainStatusTone)}>{headerModel.mainStatusLabel}</span>
              <div style={{ fontSize: 15, fontWeight: 900, color: "#0f172a", letterSpacing: "0.02em" }}>
                Postup: {headerModel.progressLine}
              </div>
            </div>
          }
          context={
            <div>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 900,
                  color: "#64748b",
                  marginBottom: 10,
                  letterSpacing: "0.06em",
                }}
              >
                POLOHA VE V\u00ddROB\u011b
              </div>
              <div style={UI.detailPageHeaderContextGrid}>
                {(
                  [
                    ["Pracoviště (kde je díl)", headerModel.workplaceWherePartIs],
                    ["Aktuální operace", headerModel.currentOperationLine],
                    ["Následující operace", headerModel.nextOperationLine],
                    ["Poté", headerModel.afterNextLine],
                  ] as const
                ).map(([label, val]) => (
                  <div key={label}>
                    <div style={UI.statLabel}>{label}</div>
                    <div style={UI.statValue}>{val}</div>
                  </div>
                ))}
              </div>
            </div>
          }
          actions={
            <>
              <button
                type="button"
                onClick={() => {
                  void openProductionOrderPdfInNewTab(productionOrderId).catch((e) =>
                    window.alert(e instanceof Error ? e.message : String(e))
                  );
                }}
                style={UI.buttonPrimary}
              >
                Tisk VP
              </button>
              <button
                type="button"
                style={UI.buttons.secondary}
                onClick={() =>
                  window.open(buildErpUrl({ view: "productionOrder", productionOrderId }), "_blank")
                }
              >
                Otevřít v novém okně
              </button>
              {data.portfolio_item_id != null && onPreviewPortfolioById ? (
                <button type="button" style={UI.buttons.secondary} onClick={() => onPreviewPortfolioById(data.portfolio_item_id!)}>
                  Náhled portfolia
                </button>
              ) : null}
              {data.portfolio_item_id != null ? (
                <button
                  type="button"
                  style={UI.buttons.primary}
                  disabled={!poWorkflowActive || !canStockMutate}
                  onClick={() => {
                    setReceiveMessage(null);
                    setReceiveError(null);
                    setReceiveQty(data.quantity > 0 ? String(data.quantity) : "1");
                    setReceiveLocation("");
                    setReceiveOpen(true);
                  }}
                >
                  Přijmout na sklad
                </button>
              ) : null}
              <button
                type="button"
                style={UI.buttons.secondary}
                disabled={!poWorkflowActive || stornoBusy || !canProductionStorno}
                onClick={() => void handleStornoVp()}
              >
                {stornoBusy ? "Stornuji…" : "Stornovat VP"}
              </button>
              <button onClick={onBack} style={UI.buttonSecondary}>
                Zpět na výrobní příkazy
              </button>
            </>
          }
          summaryTiles={
            <div style={{ display: "flex", flexDirection: "column", gap: 18, width: "100%" }}>
              <div>
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 900,
                    color: "#64748b",
                    marginBottom: 10,
                    letterSpacing: "0.06em",
                  }}
                >
                  IDENTIFIKACE A OBJEDNÁVKA
                </div>
                <div
                  style={{
                    ...UI.detailPageHeaderContextGrid,
                    gridTemplateColumns: "repeat(auto-fill, minmax(148px, 1fr))",
                  }}
                >
                  {headerModel.rowIdentifiers.map((row) => (
                    <div key={row.key} style={{ minWidth: 0 }}>
                      <div style={UI.summaryTileLabel}>{row.label}</div>
                      <div style={{ ...UI.summaryTileValue, fontSize: 17 }}>
                        {row.key === "gpn" &&
                        data.portfolio_item_id != null &&
                        onOpenPortfolioItemId &&
                        row.value !== "—" ? (
                          <button
                            type="button"
                            style={linkButtonReset}
                            onClick={() => onOpenPortfolioItemId(data.portfolio_item_id!)}
                          >
                            {row.value}
                          </button>
                        ) : row.key === "zakazka" &&
                          data.customer_order_id != null &&
                          onOpenCustomerOrderCard &&
                          row.value !== "—" ? (
                          <button
                            type="button"
                            style={linkButtonReset}
                            onClick={() => onOpenCustomerOrderCard(data.customer_order_id!)}
                          >
                            {row.value}
                          </button>
                        ) : (
                          row.value
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 900,
                    color: "#64748b",
                    marginBottom: 10,
                    letterSpacing: "0.06em",
                  }}
                >
                  PORTFOLIO A ZDROJ
                </div>
                <div style={UI.detailPageHeaderContextGrid}>
                  {headerModel.rowSource.map((row) => (
                    <div key={row.key} style={{ minWidth: 0 }}>
                      <div style={UI.summaryTileLabel}>{row.label}</div>
                      <div style={{ ...UI.summaryTileValue, fontSize: 17 }}>{row.value}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          }
        />

        {receiveMessage ? (
          <div
            style={{
              ...UI.card,
              borderRadius: 12,
              background: "#ecfdf5",
              border: "1px solid #6ee7b7",
              color: "#065f46",
              fontWeight: 700,
            }}
          >
            {receiveMessage}
          </div>
        ) : null}

        <div style={{ ...UI.card, borderRadius: 14 }}>
          <div style={{ fontSize: 16, fontWeight: 900, color: "#0f172a", marginBottom: 10 }}>Technologický postup VP</div>
          {opActionError ? (
            <div style={{ marginBottom: 10, color: "#991b1b", fontWeight: 700 }}>{opActionError}</div>
          ) : null}
          {data.operations.length === 0 ? (
            <div style={{ color: "#64748b", fontWeight: 600 }}>Pro tuto portfolio variantu není k dispozici technologický postup.</div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={UI.table}>
                <thead>
                  <tr style={{ background: "#f8fafc" }}>
                    {["Pořadí", "Operace", "Pracoviště", "Setup (min)", "Čas / ks (min)", "Stav", "Odvedeno", "Akce", "Poznámka"].map((h) => (
                      <th key={h} style={{ ...UI.th, whiteSpace: "nowrap" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.operations.map((op) => (
                    <tr key={op.id}>
                      <td style={UI.td}>{op.operation_no}</td>
                      <td style={UI.td}>{op.operation_name}</td>
                      <td style={UI.td}>{op.workplace_name ?? "—"}</td>
                      <td style={UI.td}>{op.setup_time_min}</td>
                      <td style={UI.td}>{op.run_min_per_piece}</td>
                      <td style={UI.td}>{labelVpOperationProgress(op.operation_status)}</td>
                      <td style={UI.td}>
                        OK {op.reported_ok_qty_total ?? 0} / NOK {op.reported_nok_qty_total ?? 0} / {op.reported_minutes_total ?? 0} min
                      </td>
                      <td style={{ ...UI.td, minWidth: 330 }}>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                          <button
                            type="button"
                            style={UI.buttons.secondary}
                            disabled={!poWorkflowActive || busyOp === op.operation_no || !canProductionExecute}
                            onClick={() => handleStartOperation(op.operation_no)}
                          >
                            Zahájit
                          </button>
                          <input
                            style={{ ...UI.inputs.base, width: 70, padding: "6px 8px" }}
                            placeholder="OK"
                            value={okByOp[op.operation_no] ?? ""}
                            onChange={(e) => setOkByOp((s) => ({ ...s, [op.operation_no]: e.target.value }))}
                          />
                          <input
                            style={{ ...UI.inputs.base, width: 70, padding: "6px 8px" }}
                            placeholder="NOK"
                            value={nokByOp[op.operation_no] ?? ""}
                            onChange={(e) => setNokByOp((s) => ({ ...s, [op.operation_no]: e.target.value }))}
                          />
                          <input
                            style={{ ...UI.inputs.base, width: 90, padding: "6px 8px" }}
                            placeholder="Min"
                            value={minutesByOp[op.operation_no] ?? ""}
                            onChange={(e) => setMinutesByOp((s) => ({ ...s, [op.operation_no]: e.target.value }))}
                          />
                          <button
                            type="button"
                            style={UI.buttons.primary}
                            disabled={!poWorkflowActive || busyOp === op.operation_no || !canProductionExecute}
                            onClick={() => handleReportOperation(op.operation_no)}
                          >
                            Odvést
                          </button>
                        </div>
                      </td>
                      <td style={UI.td}>{op.note ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div style={{ ...UI.card, borderRadius: 14 }}>
          <div style={{ fontSize: 16, fontWeight: 900, color: "#0f172a", marginBottom: 10 }}>Vstupy VP</div>
          {data.inputs.length === 0 ? (
            <div style={{ color: "#64748b", fontWeight: 600 }}>Pro tuto portfolio variantu nejsou definované vstupy.</div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={UI.table}>
                <thead>
                  <tr style={{ background: "#f8fafc" }}>
                    {["Typ", "Materiál / Produkt", "Kód / GPN", "Spotřeba / ks", "Prořez (kerf / ks)", "Celkem (VP)", "Poznámka"].map((h) => (
                      <th key={h} style={{ ...UI.th, whiteSpace: "nowrap" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.inputs.map((inp) => {
                    const mt = inp.material_traceability;
                    const showTrace =
                      inp.input_type === "material" &&
                      mt &&
                      (mt.has_issued_movement === true ||
                        (mt.issue_movement_id != null && mt.issue_movement_id > 0) ||
                        mt.heat_lot ||
                        mt.movement_scan_code ||
                        mt.stock_location ||
                        mt.supplier_name ||
                        mt.delivery_note_no ||
                        mt.certificate_no ||
                        (mt.attachments && mt.attachments.length > 0));
                    return (
                      <React.Fragment key={inp.id}>
                        <tr>
                          <td style={UI.td}>{inp.input_type === "product_stock" ? "Produkt ze skladu" : "Materiál"}</td>
                          <td style={UI.td}>{inp.material_name ?? inp.portfolio_item_name ?? "—"}</td>
                          <td style={UI.td}>{inp.material_code ?? inp.portfolio_item_gpn ?? "—"}</td>
                          <td style={UI.td}>
                            {inp.consumption_per_piece}
                            {inp.consumption_unit ? ` ${inp.consumption_unit}` : ""}
                          </td>
                          <td style={UI.td}>{inp.scrap_allowance}</td>
                          <td style={UI.td}>
                            {inp.total_consumption != null && inp.total_consumption !== undefined
                              ? `${inp.total_consumption}${inp.consumption_unit ? ` ${inp.consumption_unit}` : ""}`
                              : "—"}
                          </td>
                          <td style={UI.td}>{inp.note ?? "—"}</td>
                        </tr>
                        {showTrace && mt ? (
                          <tr>
                            <td colSpan={7} style={{ ...UI.td, background: "#f1f5f9", borderTop: "none", paddingTop: 6, paddingBottom: 10 }}>
                              {mt.issue_movement_id != null && mt.issue_movement_id > 0 ? (
                                <div style={{ fontSize: 11, color: "#64748b", fontWeight: 700, marginBottom: 8 }}>
                                  Výdej materiálu #{mt.issue_movement_id}
                                  {mt.linkage ? ` · vazba: ${mt.linkage}` : ""}
                                </div>
                              ) : null}
                              <div style={{ display: "flex", flexWrap: "wrap", gap: "10px 18px", fontSize: 12, color: "#334155", fontWeight: 600 }}>
                                {mt.material_code || mt.material_dimension ? (
                                  <span>
                                    Kód / rozměr (sklad):{" "}
                                    <span style={{ fontWeight: 800, color: "#0f172a" }}>
                                      {[mt.material_code, mt.material_dimension].filter(Boolean).join(" · ") || "—"}
                                    </span>
                                  </span>
                                ) : null}
                                {mt.stock_location ? (
                                  <span>
                                    Lokace karty: <span style={{ fontWeight: 800, color: "#0f172a" }}>{mt.stock_location}</span>
                                  </span>
                                ) : null}
                                {mt.movement_scan_code ? (
                                  <span>
                                    Scan pohybu / karty:{" "}
                                    <span style={{ fontWeight: 800, color: "#0f172a" }}>{mt.movement_scan_code}</span>
                                  </span>
                                ) : null}
                                {mt.length_per_piece_mm != null && Number.isFinite(Number(mt.length_per_piece_mm)) ? (
                                  <span>
                                    Délka na kus (mm):{" "}
                                    <span style={{ fontWeight: 800, color: "#0f172a" }}>{Number(mt.length_per_piece_mm)}</span>
                                  </span>
                                ) : null}
                                {mt.weight_per_piece_kg != null && Number.isFinite(Number(mt.weight_per_piece_kg)) ? (
                                  <span>
                                    Váha na kus (kg):{" "}
                                    <span style={{ fontWeight: 800, color: "#0f172a" }}>{Number(mt.weight_per_piece_kg)}</span>
                                  </span>
                                ) : null}
                                {mt.heat_lot ? (
                                  <span>
                                    Tavba / šarže: <span style={{ fontWeight: 800, color: "#0f172a" }}>{mt.heat_lot}</span>
                                  </span>
                                ) : null}
                                {mt.supplier_name ? (
                                  <span>
                                    Dodavatel: <span style={{ fontWeight: 800, color: "#0f172a" }}>{mt.supplier_name}</span>
                                  </span>
                                ) : null}
                                {mt.delivery_note_no ? (
                                  <span>
                                    Číslo dodacího listu: <span style={{ fontWeight: 800, color: "#0f172a" }}>{mt.delivery_note_no}</span>
                                  </span>
                                ) : null}
                                {mt.certificate_no ? (
                                  <span>
                                    Číslo atestu: <span style={{ fontWeight: 800, color: "#0f172a" }}>{mt.certificate_no}</span>
                                  </span>
                                ) : null}
                              </div>
                              {mt.attachments && mt.attachments.length > 0 ? (
                                <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                                  <span style={{ fontSize: 11, fontWeight: 800, color: "#64748b" }}>Dokumenty příjmu:</span>
                                  {mt.attachments.map((a) => (
                                    <a
                                      key={a.id}
                                      href={`${API_URL}${a.download_url}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      style={{ ...linkButtonReset, fontSize: 12 }}
                                    >
                                      {a.original_filename || `Soubor #${a.id}`}
                                    </a>
                                  ))}
                                </div>
                              ) : null}
                            </td>
                          </tr>
                        ) : null}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <SimpleModal
          title="Přijmout na sklad"
          open={receiveOpen}
          onClose={() => !receiveBusy && setReceiveOpen(false)}
          footer={
            <>
              <button type="button" style={UI.buttons.secondary} disabled={receiveBusy} onClick={() => setReceiveOpen(false)}>
                Zrušit
              </button>
              <button
                type="button"
                style={UI.buttons.primary}
                disabled={receiveBusy || !canStockMutate}
                onClick={() => void handleReceiveToStock()}
              >
                {receiveBusy ? "Ukládám…" : "Potvrdit příjem"}
              </button>
            </>
          }
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ fontSize: 13, color: "#64748b" }}>VP {data.vp_code} — hotový výrobek přijat na sklad výrobků.</div>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontWeight: 800 }}>Množství (ks)</span>
              <input
                style={UI.inputs.base}
                type="text"
                inputMode="decimal"
                value={receiveQty}
                onChange={(e) => setReceiveQty(e.target.value)}
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontWeight: 800 }}>Lokace (kód)</span>
              <input
                style={UI.inputs.base}
                type="text"
                placeholder="např. EXPEDICE nebo kód z úložišť"
                value={receiveLocation}
                onChange={(e) => setReceiveLocation(e.target.value)}
              />
            </label>
            {receiveError ? <div style={{ color: "#b91c1c", fontWeight: 700 }}>{receiveError}</div> : null}
          </div>
        </SimpleModal>
      </div>
    </div>
  );
}
