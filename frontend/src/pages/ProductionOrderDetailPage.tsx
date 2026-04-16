import React, { useEffect, useMemo, useState } from "react";
import DetailPageHeader from "../components/DetailPageHeader";
import SimpleModal from "../components/SimpleModal";
import { UI } from "../styles/ui";
import { buildProductionOrderDetailHeaderModel, vpHeaderBadgeStyle } from "../utils/productionOrderDetailHeader";
import {
  getProductionOrderDetail,
  openProductionOrderPdfInNewTab,
  regenerateProductionOrderFromTp,
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

function formatPlanningPhaseCs(phase: string | null | undefined): string {
  const s = String(phase ?? "").trim().toLowerCase();
  if (s === "hotovo") return "Hotovo";
  if (s === "bezi") return "Běží";
  if (s === "planned") return "Naplánováno";
  return (phase || "").trim() ? String(phase) : "—";
}

function formatDetailPercent(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  return `${Number(v)} %`;
}

function formatDetailLaborCzk(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  if (Number(v) <= 0) return "0 Kč";
  try {
    return new Intl.NumberFormat("cs-CZ", {
      style: "currency",
      currency: "CZK",
      maximumFractionDigits: 0,
    }).format(Number(v));
  } catch {
    return `${Math.round(Number(v))} Kč`;
  }
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
  const [regenerateBusy, setRegenerateBusy] = useState(false);
  const [regenerateMessage, setRegenerateMessage] = useState<string | null>(null);
  const [regenerateConfirmOpen, setRegenerateConfirmOpen] = useState(false);

  const erpRole = useMemo(() => readStoredErpRole(), []);
  const canProductionExecute = canPerformAction(erpRole, "production.execute");
  const canProductionStorno = canPerformAction(erpRole, "production.storno");
  const canStockMutate = canPerformAction(erpRole, "stock.mutate");
  const poWorkflowActive = isBusinessWorkflowActive(data?.workflow_status);
  const regenerateBlockedByProgress = useMemo(() => {
    if (!data) return false;
    return data.operations.some((op) => {
      const st = String(op.operation_status ?? "").trim().toLowerCase();
      return st === "bezi" || st === "hotovo";
    });
  }, [data]);
  const regenerateDisabled =
    !poWorkflowActive || regenerateBusy || !canProductionExecute || regenerateBlockedByProgress;

  async function loadDetail() {
    setLoading(true);
    setError(null);
    try {
      const r = await getProductionOrderDetail(productionOrderId);
      setData(r);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    loadDetail()
      .then(() => {
        if (cancelled) return;
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Nepodařilo se načíst detail VP.");
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

  async function handleRegenerateFromTp() {
    setRegenerateBusy(true);
    setRegenerateMessage(null);
    setOpActionError(null);
    try {
      const out = await regenerateProductionOrderFromTp(productionOrderId);
      setRegenerateConfirmOpen(false);
      setRegenerateMessage(`VP ${out.vp_code}: operace úspěšně přegenerovány z TP.`);
      await loadDetail();
    } catch (e: unknown) {
      setOpActionError(e instanceof Error ? e.message : "Přegenerování z TP se nezdařilo.");
    } finally {
      setRegenerateBusy(false);
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
  const productTitle =
    (data.description || "").trim() || (data.portfolio_item_name || "").trim() || "—";

  const poStateAccent = UI.colors.primaryLight;
  const poStateBg = "linear-gradient(145deg, rgba(37, 99, 235, 0.09) 0%, rgba(241, 245, 249, 0.92) 52%, #ffffff 100%)";
  const kpiPanelBg = UI.colors.neutralBg;
  const sectionEyebrow: React.CSSProperties = {
    fontSize: 10,
    fontWeight: 900,
    color: UI.colors.textSecondary,
    letterSpacing: "0.1em",
    textTransform: "uppercase",
    marginBottom: 12,
  };
  const stateRowLabel: React.CSSProperties = {
    fontSize: 10,
    fontWeight: 800,
    color: UI.colors.neutralFg,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
  };
  const stateRowValue: React.CSSProperties = {
    fontSize: 17,
    fontWeight: 1000,
    color: UI.colors.textPrimary,
    lineHeight: 1.3,
    marginTop: 5,
  };
  const kpiLabel: React.CSSProperties = {
    fontSize: 10,
    fontWeight: 700,
    color: UI.colors.textSecondary,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
  };
  const kpiValue: React.CSSProperties = {
    fontSize: 26,
    fontWeight: 1000,
    color: UI.colors.textPrimary,
    letterSpacing: "-0.03em",
    lineHeight: 1.1,
    marginTop: 6,
    wordBreak: "break-word",
  };

  return (
    <div style={UI.container}>
      <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
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
            <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 8 }}>
              <div
                style={{
                  fontSize: 28,
                  fontWeight: 1000,
                  color: UI.colors.primary,
                  letterSpacing: "-0.03em",
                  lineHeight: 1.12,
                }}
              >
                {data.vp_code}
              </div>
              <div
                style={{
                  fontSize: 15,
                  fontWeight: 800,
                  color: UI.colors.textPrimary,
                  lineHeight: 1.35,
                  maxWidth: 640,
                }}
              >
                {productTitle}
              </div>
              <div style={{ ...UI.sectionSubtitle, maxWidth: 640 }}>{headerModel.headlineSentence}</div>
            </div>
          }
          headerAside={
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 10 }}>
              <span style={vpHeaderBadgeStyle(headerModel.mainStatusTone)}>{headerModel.mainStatusLabel}</span>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: UI.colors.textSecondary, letterSpacing: "0.06em" }}>
                  Hotovo (operace)
                </div>
                <div style={{ fontSize: 28, fontWeight: 1000, color: UI.colors.textPrimary, letterSpacing: "-0.03em", lineHeight: 1.05 }}>
                  {headerModel.progressPercent} %
                </div>
                <div style={{ fontSize: 13, fontWeight: 800, color: UI.colors.textSecondary, marginTop: 4 }}>
                  Postup: {headerModel.progressLine}
                </div>
              </div>
            </div>
          }
          context={
            <div
              style={{
                borderRadius: 14,
                padding: "18px 18px 16px",
                background: poStateBg,
                border: `1px solid ${poStateAccent}`,
                boxShadow: "0 8px 28px rgba(15, 23, 42, 0.06)",
              }}
            >
              <div style={sectionEyebrow}>Aktuální stav výroby</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 16 }}>
                {(
                  [
                    ["Kde je díl", headerModel.workplaceWherePartIs],
                    ["Aktuální operace", headerModel.currentOperationLine],
                    ["Následující operace", headerModel.nextOperationLine],
                    ["Poté", headerModel.afterNextLine],
                  ] as const
                ).map(([label, val]) => (
                  <div key={label} style={{ minWidth: 0 }}>
                    <div style={stateRowLabel}>{label}</div>
                    <div style={stateRowValue}>{val}</div>
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
              <button
                type="button"
                style={UI.buttons.secondary}
                disabled={regenerateDisabled}
                title={
                  regenerateDisabled
                    ? "Přegenerování není dostupné pro rozpracovaný nebo uzavřený výrobní příkaz."
                    : undefined
                }
                onClick={() => setRegenerateConfirmOpen(true)}
              >
                {regenerateBusy ? "Přegenerovávám…" : "Přegenerovat z TP"}
              </button>
              <button onClick={onBack} style={UI.buttonSecondary}>
                Zpět na výrobní příkazy
              </button>
            </>
          }
          summaryTiles={
            <div style={{ display: "flex", flexDirection: "column", gap: 26, width: "100%", minWidth: 0 }}>
              <div
                style={{
                  borderRadius: 14,
                  padding: "18px 16px 16px",
                  background: kpiPanelBg,
                  border: `1px solid ${UI.colors.border}`,
                }}
              >
                <div style={sectionEyebrow}>Provozní metriky</div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(128px, 1fr))",
                    gap: 16,
                    alignItems: "start",
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={kpiLabel}>Vykázaný čas</div>
                    <div style={kpiValue}>{Math.round(Number(data.reported_time_min ?? 0))} min</div>
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={kpiLabel}>Náklad práce</div>
                    <div style={kpiValue}>{formatDetailLaborCzk(data.direct_labor_cost)}</div>
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={kpiLabel}>Hotovo %</div>
                    <div style={kpiValue}>{formatDetailPercent(data.completion_percent)}</div>
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={kpiLabel}>Výkonnost</div>
                    <div style={kpiValue}>{formatDetailPercent(data.performance_percent)}</div>
                    <div style={{ fontSize: 10, color: UI.colors.textSecondary, marginTop: 8, fontWeight: 600, lineHeight: 1.35 }}>
                      Plánovaný čas (planning_operations) / vykázaný čas (work_reports)
                    </div>
                  </div>
                </div>
                {(data.current_location || data.current_phase) && (
                  <div
                    style={{
                      marginTop: 18,
                      paddingTop: 16,
                      borderTop: `1px solid ${UI.colors.divider}`,
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
                      gap: 12,
                    }}
                  >
                    <div>
                      <div style={{ ...kpiLabel, marginBottom: 4 }}>Poloha (běžící operace)</div>
                      <div style={{ fontSize: 15, fontWeight: 900, color: UI.colors.textPrimary }}>
                        {data.current_location?.trim() ? data.current_location : "—"}
                      </div>
                    </div>
                    <div>
                      <div style={{ ...kpiLabel, marginBottom: 4 }}>Fáze VP</div>
                      <div style={{ fontSize: 15, fontWeight: 900, color: UI.colors.textPrimary }}>
                        {formatPlanningPhaseCs(data.current_phase)}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div style={{ paddingTop: 4 }}>
                <div style={{ ...sectionEyebrow, color: UI.colors.neutralFg, marginBottom: 10 }}>Identifikace a objednávka</div>
                <div
                  style={{
                    ...UI.detailPageHeaderContextGrid,
                    gridTemplateColumns: "repeat(auto-fill, minmax(148px, 1fr))",
                    gap: 10,
                  }}
                >
                  {headerModel.rowIdentifiers.map((row) => (
                    <div key={row.key} style={{ minWidth: 0 }}>
                      <div style={{ ...UI.summaryTileLabel, fontSize: 10, opacity: 0.85 }}>{row.label}</div>
                      <div style={{ ...UI.summaryTileValue, fontSize: 14, fontWeight: 800, color: UI.colors.textSecondary }}>
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
                <div style={{ ...sectionEyebrow, color: UI.colors.neutralFg, marginBottom: 10 }}>Portfolio a zdroj</div>
                <div style={{ ...UI.detailPageHeaderContextGrid, gap: 10 }}>
                  {headerModel.rowSource.map((row) => (
                    <div key={row.key} style={{ minWidth: 0 }}>
                      <div style={{ ...UI.summaryTileLabel, fontSize: 10, opacity: 0.85 }}>{row.label}</div>
                      <div style={{ ...UI.summaryTileValue, fontSize: 14, fontWeight: 800, color: UI.colors.textSecondary }}>
                        {row.value}
                      </div>
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
        {regenerateMessage ? (
          <div
            style={{
              ...UI.card,
              borderRadius: 12,
              background: "#ecfeff",
              border: "1px solid #67e8f9",
              color: "#155e75",
              fontWeight: 700,
            }}
          >
            {regenerateMessage}
          </div>
        ) : null}
        {regenerateDisabled ? (
          <div style={{ fontSize: 12, color: "#64748b", marginTop: -6 }}>
            Přegenerování není dostupné pro rozpracovaný nebo uzavřený výrobní příkaz.
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
        <SimpleModal
          title="Přegenerovat operace z TP?"
          open={regenerateConfirmOpen}
          onClose={() => !regenerateBusy && setRegenerateConfirmOpen(false)}
          footer={
            <>
              <button
                type="button"
                style={UI.buttons.secondary}
                disabled={regenerateBusy}
                onClick={() => setRegenerateConfirmOpen(false)}
              >
                Zrušit
              </button>
              <button
                type="button"
                style={UI.buttons.primary}
                disabled={regenerateBusy}
                onClick={() => void handleRegenerateFromTp()}
              >
                {regenerateBusy ? "Přegenerovávám…" : "Přegenerovat"}
              </button>
            </>
          }
        >
          <div style={{ fontSize: 13, color: "#334155", lineHeight: 1.45 }}>
            Tato akce znovu vytvoří operace výrobního příkazu podle aktuálního technologického postupu.
            Dojde také k přepočtu plánovacích operací a plánu pro tento VP. Pokud už jsou na VP
            rozpracované nebo odvedené operace, akce může být zablokována.
          </div>
        </SimpleModal>
      </div>
    </div>
  );
}
