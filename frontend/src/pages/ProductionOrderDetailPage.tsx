import React, { useEffect, useMemo, useRef, useState } from "react";
import DetailPageHeader from "../components/DetailPageHeader";
import SimpleModal from "../components/SimpleModal";
import {
  erpDetailIdentGrid,
  erpDetailIdentLabel,
  erpDetailIdentValue,
  erpDetailKpiLabel,
  erpDetailKpiPanel,
  erpDetailKpiRow,
  erpDetailKpiValue,
  erpDetailRowLabel,
  erpDetailRowValue,
  erpDetailSectionEyebrow,
  erpDetailStateCard,
  UI,
} from "../styles/ui";
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
import InlineBanner from "../components/InlineBanner";
import { interpretError, runWriteAction, type WriteFeedback } from "../utils/writeActionFeedback";

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
  /**
   * Sjednocený inline feedback pro write akce (start / report / storno /
   * regenerate / receive / print PDF). Phase 1 standardu — viz
   * `utils/writeActionFeedback.ts` + `components/InlineBanner.tsx`.
   *
   * Volidační chyby uvnitř modálu (např. „zadejte platné množství") zůstávají
   * v `receiveError` — to je modal-scoped a render se v modálu, ne na page.
   */
  const [actionFeedback, setActionFeedback] = useState<WriteFeedback | null>(null);
  const writeFeedbackAnchorRef = useRef<HTMLDivElement>(null);
  const [busyOp, setBusyOp] = useState<number | null>(null);
  const [okByOp, setOkByOp] = useState<Record<number, string>>({});
  const [nokByOp, setNokByOp] = useState<Record<number, string>>({});
  const [minutesByOp, setMinutesByOp] = useState<Record<number, string>>({});
  const [noteByOp, setNoteByOp] = useState<Record<number, string>>({});
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [receiveQty, setReceiveQty] = useState("");
  const [receiveLocation, setReceiveLocation] = useState("");
  const [receiveBusy, setReceiveBusy] = useState(false);
  const [receiveError, setReceiveError] = useState<string | null>(null);
  const [stornoBusy, setStornoBusy] = useState(false);
  const [regenerateBusy, setRegenerateBusy] = useState(false);
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

  async function loadDetail(opts?: { silent?: boolean }) {
    const silent = opts?.silent === true;
    if (!silent) {
      setLoading(true);
      setError(null);
    }
    try {
      const r = await getProductionOrderDetail(productionOrderId);
      setData(r);
    } catch (e: unknown) {
      if (silent) {
        setActionFeedback(interpretError(e, "Nepodařilo se načíst detail VP."));
      } else {
        setError(e instanceof Error ? e.message : "Nepodařilo se načíst detail VP.");
      }
    } finally {
      if (!silent) setLoading(false);
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

  useEffect(() => {
    if (!actionFeedback) return;
    writeFeedbackAnchorRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [actionFeedback]);

  async function handleStartOperation(operationNo: number) {
    setActionFeedback(null);
    setBusyOp(operationNo);
    const fb = await runWriteAction(
      () => startProductionOrderOperation(productionOrderId, operationNo),
      {
        successMessage: `Operace č. ${operationNo} byla zahájena.`,
        errorMessage: "Zahájení operace se nezdařilo.",
      },
    );
    setActionFeedback(fb);
    setBusyOp(null);
    if (fb.kind === "success" || fb.kind === "info") {
      await loadDetail({ silent: true });
    }
  }

  async function handleReportOperation(operationNo: number) {
    setActionFeedback(null);
    setBusyOp(operationNo);
    const ok_qty = Math.max(0, Number(okByOp[operationNo] ?? 0) || 0);
    const nok_qty = Math.max(0, Number(nokByOp[operationNo] ?? 0) || 0);
    const reported_minutes = Math.max(0, Number(minutesByOp[operationNo] ?? 0) || 0);
    const note = (noteByOp[operationNo] ?? "").trim() || null;
    const fb = await runWriteAction(
      () =>
        reportProductionOrderOperation(productionOrderId, operationNo, {
          ok_qty,
          nok_qty,
          reported_minutes,
          note,
        }),
      {
        successMessage: `Operace č. ${operationNo}: odvedeno OK ${ok_qty} / NOK ${nok_qty}, ${reported_minutes} min.`,
        errorMessage: "Odvedení operace se nezdařilo.",
      },
    );
    setActionFeedback(fb);
    setBusyOp(null);
    if (fb.kind === "success" || fb.kind === "info") {
      await loadDetail({ silent: true });
    }
  }

  async function handleStornoVp() {
    if (!window.confirm("Stornovat tento výrobní příkaz? Rezervace materiálu se uvolní; záznam VP zůstane v historii.")) return;
    setStornoBusy(true);
    setActionFeedback(null);
    const fb = await runWriteAction(
      () => stornoProductionOrder(productionOrderId),
      {
        successMessage: "Výrobní příkaz byl stornován.",
        errorMessage: "Storno VP se nezdařilo.",
      },
    );
    setActionFeedback(fb);
    setStornoBusy(false);
    if (fb.kind === "success" || fb.kind === "info") {
      await loadDetail({ silent: true });
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
    const fb = await runWriteAction(
      () =>
        receiveFinishedGoodsToStock(productionOrderId, {
          qty: q,
          location: receiveLocation.trim() || null,
        }),
      {
        successMessage: `Příjem na sklad proběhl (${q} ks).`,
        errorMessage: "Příjem na sklad se nepodařil.",
        // Backend tady vrací `{ qty_received, current_qty }` — žádný `status`,
        // tak interpretMutationBody by spadl do generického success.
        // Sestavíme přesnější hlášku ručně.
        interpretResult: (res) => ({
          kind: "success",
          message: `Přijato ${res.qty_received} ks, stav skladu: ${res.current_qty} ks.`,
        }),
      },
    );
    setReceiveBusy(false);
    if (fb.kind === "success" || fb.kind === "info") {
      setActionFeedback(fb);
      setReceiveOpen(false);
      setReceiveQty("");
      setReceiveLocation("");
      await loadDetail({ silent: true });
    } else {
      // Při chybě modál nezavíráme; uživatel uvidí hlášku přímo v něm
      // a může opravit zadání. Page-level banner v tom případě neukazujeme.
      setReceiveError(fb.message);
    }
  }

  async function handleRegenerateFromTp() {
    setRegenerateBusy(true);
    setActionFeedback(null);
    const fb = await runWriteAction(
      () => regenerateProductionOrderFromTp(productionOrderId),
      {
        successMessage: "Operace VP byly přegenerovány z TP.",
        errorMessage: "Přegenerování z TP se nezdařilo.",
        interpretResult: (out) => ({
          kind: "success",
          message: `VP ${out.vp_code}: operace úspěšně přegenerovány z TP.`,
        }),
      },
    );
    setActionFeedback(fb);
    setRegenerateBusy(false);
    if (fb.kind === "success" || fb.kind === "info") {
      setRegenerateConfirmOpen(false);
      await loadDetail({ silent: true });
    }
  }

  async function handlePrintVpPdf() {
    setActionFeedback(null);
    const fb = await runWriteAction(
      () => openProductionOrderPdfInNewTab(productionOrderId),
      {
        successMessage: "Tisk VP otevřen v novém okně.",
        errorMessage: "Tisk VP se nepodařil.",
      },
    );
    setActionFeedback(fb);
  }

  if (loading) {
    return (
      <div className="erp-overview-page" style={UI.container}>
        <div style={{ ...UI.card, borderRadius: 14 }}>
          <div style={UI.sectionSubtitle}>Načítám detail výrobního příkazu…</div>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="erp-overview-page" style={UI.container}>
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
  const productTitle = (() => {
    const parts: string[] = [];
    const gpn = (data.gpn || "").trim();
    const drawing = (data.drawing_number || "").trim();
    const name = (data.description || "").trim() || (data.portfolio_item_name || "").trim();
    if (gpn) parts.push(gpn);
    if (drawing) parts.push(drawing);
    if (name) parts.push(name);
    return parts.length > 0 ? parts.join(" – ") : "—";
  })();

  const canReceiveToStock =
    data.portfolio_item_id != null && poWorkflowActive && canStockMutate;
  const primaryActionAvailable = canReceiveToStock;

  const dangerButton: React.CSSProperties = {
    ...UI.buttons.secondary,
    color: UI.colors.problemFg,
    borderColor: "#FCA5A5",
    background: "#FEF2F2",
  };

  const subtleCard: React.CSSProperties = {
    padding: "14px 16px",
    borderRadius: 12,
    background: UI.colors.card,
    border: `1px solid ${UI.colors.border}`,
  };

  const identEyebrow: React.CSSProperties = {
    ...erpDetailSectionEyebrow,
    color: UI.colors.neutralFg,
    marginBottom: 10,
  };

  const tableSectionCard: React.CSSProperties = {
    ...UI.card,
    borderRadius: 14,
    padding: 18,
  };

  const sectionHeader: React.CSSProperties = {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 12,
  };

  const sectionHeaderTitle: React.CSSProperties = {
    fontSize: 16,
    fontWeight: 900,
    color: UI.colors.textPrimary,
    letterSpacing: 0.1,
  };

  const sectionHeaderSub: React.CSSProperties = {
    fontSize: 12,
    fontWeight: 700,
    color: UI.colors.textSecondary,
  };

  const tableHeadCell: React.CSSProperties = {
    ...UI.th,
    whiteSpace: "nowrap",
    padding: "10px 12px",
  };

  const tableBodyCell: React.CSSProperties = {
    ...UI.td,
    padding: "10px 12px",
    verticalAlign: "middle" as const,
  };

  const rowStripeBg = "#FAFBFD";

  const opStatusBadge = (status: string | null | undefined): React.CSSProperties => {
    const s = String(status ?? "").trim().toLowerCase();
    const base = UI.statusBadgeBase;
    if (s === "hotovo") return { ...base, ...UI.statusBadgeOk };
    if (s === "bezi") return { ...base, ...UI.statusBadgeRunning };
    return { ...base, ...UI.statusBadgeWait };
  };

  const fieldLabel: React.CSSProperties = {
    fontSize: 10.5,
    fontWeight: 800,
    color: UI.colors.neutralFg,
    letterSpacing: 0.4,
    textTransform: "uppercase",
    marginBottom: 3,
  };

  const totalOperations = data.operations.length;
  const doneOperations = data.operations.filter(
    (op) => String(op.operation_status ?? "").trim().toLowerCase() === "hotovo",
  ).length;

  return (
    <div className="erp-overview-page" style={UI.container}>
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
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
            <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
              <div
                style={{
                  fontSize: 28,
                  fontWeight: 1000,
                  color: UI.colors.primary,
                  letterSpacing: 0.3,
                  lineHeight: 1.05,
                }}
              >
                {data.vp_code}
              </div>
              <div
                style={{
                  fontSize: 15,
                  fontWeight: 700,
                  color: UI.colors.textPrimary,
                  lineHeight: 1.35,
                  maxWidth: 640,
                }}
              >
                {productTitle}
              </div>
              <div
                style={{
                  fontSize: 12.5,
                  fontWeight: 600,
                  color: UI.colors.textSecondary,
                  lineHeight: 1.4,
                  maxWidth: 640,
                }}
              >
                {headerModel.headlineSentence}
              </div>
            </div>
          }
          headerAside={
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
              <span style={vpHeaderBadgeStyle(headerModel.mainStatusTone)}>{headerModel.mainStatusLabel}</span>
              <div style={{ textAlign: "right" }}>
                <div
                  style={{
                    fontSize: 10.5,
                    fontWeight: 700,
                    color: UI.colors.neutralFg,
                    letterSpacing: 0.6,
                    textTransform: "uppercase",
                  }}
                >
                  Hotovo
                </div>
                <div
                  style={{
                    fontSize: 24,
                    fontWeight: 1000,
                    color: UI.colors.textPrimary,
                    lineHeight: 1.05,
                  }}
                >
                  {headerModel.progressPercent} %
                </div>
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    color: UI.colors.textSecondary,
                    marginTop: 2,
                  }}
                >
                  {headerModel.progressLine}
                </div>
              </div>
            </div>
          }
          actions={
            <>
              {primaryActionAvailable ? (
                <button
                  type="button"
                  style={UI.buttons.primary}
                  onClick={() => {
                    setActionFeedback(null);
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
                onClick={() =>
                  window.open(buildErpUrl({ view: "productionOrder", productionOrderId }), "_blank")
                }
              >
                Otevřít v novém okně
              </button>
              <button type="button" style={UI.buttons.secondary} onClick={onBack}>
                Zpět na výrobní příkazy
              </button>
            </>
          }
          context={
            <div style={erpDetailStateCard}>
              <div style={erpDetailSectionEyebrow}>Aktuální stav výroby</div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                  gap: 14,
                }}
              >
                {(
                  [
                    ["Kde je díl", headerModel.workplaceWherePartIs],
                    ["Aktuální operace", headerModel.currentOperationLine],
                    ["Následující operace", headerModel.nextOperationLine],
                    ["Poté", headerModel.afterNextLine],
                  ] as const
                ).map(([label, val]) => (
                  <div key={label} style={{ minWidth: 0 }}>
                    <div style={erpDetailRowLabel}>{label}</div>
                    <div style={erpDetailRowValue}>{val}</div>
                  </div>
                ))}
              </div>
            </div>
          }
          summaryTiles={
            <div style={{ display: "flex", flexDirection: "column", gap: 14, width: "100%", minWidth: 0 }}>
              <div style={erpDetailKpiPanel}>
                <div style={erpDetailSectionEyebrow}>Provozní metriky</div>
                <div style={erpDetailKpiRow}>
                  <div style={{ minWidth: 0 }}>
                    <div style={erpDetailKpiLabel}>Vykázaný čas</div>
                    <div style={erpDetailKpiValue}>
                      {Math.round(Number(data.reported_time_min ?? 0))} min
                    </div>
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={erpDetailKpiLabel}>Náklad práce</div>
                    <div style={erpDetailKpiValue}>{formatDetailLaborCzk(data.direct_labor_cost)}</div>
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={erpDetailKpiLabel}>Hotovo %</div>
                    <div style={erpDetailKpiValue}>{formatDetailPercent(data.completion_percent)}</div>
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={erpDetailKpiLabel}>Výkonnost</div>
                    <div style={erpDetailKpiValue}>{formatDetailPercent(data.performance_percent)}</div>
                  </div>
                </div>
                <div
                  style={{
                    marginTop: 2,
                    paddingTop: 12,
                    borderTop: `1px solid ${UI.colors.divider}`,
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                    gap: 14,
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={erpDetailKpiLabel}>Poloha (běžící operace)</div>
                    <div style={{ ...erpDetailKpiValue, fontSize: 17 }}>
                      {data.current_location?.trim() ? data.current_location : "—"}
                    </div>
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={erpDetailKpiLabel}>Fáze VP</div>
                    <div style={{ ...erpDetailKpiValue, fontSize: 17 }}>
                      {formatPlanningPhaseCs(data.current_phase)}
                    </div>
                  </div>
                </div>
              </div>

              <div style={subtleCard}>
                <div style={identEyebrow}>Identifikace a objednávka</div>
                <div style={erpDetailIdentGrid}>
                  {headerModel.rowIdentifiers.map((row) => (
                    <div key={row.key} style={{ minWidth: 0 }}>
                      <div style={erpDetailIdentLabel}>{row.label}</div>
                      <div style={erpDetailIdentValue}>
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

              <div style={subtleCard}>
                <div style={identEyebrow}>Portfolio a zdroj</div>
                <div style={erpDetailIdentGrid}>
                  {headerModel.rowSource.map((row) => (
                    <div key={row.key} style={{ minWidth: 0 }}>
                      <div style={erpDetailIdentLabel}>{row.label}</div>
                      <div style={erpDetailIdentValue}>{row.value}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          }
        />

        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 12,
            padding: "10px 16px",
            borderRadius: 12,
            background: UI.colors.neutralBg,
            border: `1px solid ${UI.colors.border}`,
          }}
        >
          <div
            style={{
              ...erpDetailSectionEyebrow,
              color: UI.colors.neutralFg,
              marginRight: 4,
              flexShrink: 0,
            }}
          >
            Akce VP
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <button
              type="button"
              style={UI.buttons.secondary}
              onClick={() => void handlePrintVpPdf()}
            >
              Tisk VP
            </button>
            {data.portfolio_item_id != null && onPreviewPortfolioById ? (
              <button
                type="button"
                style={UI.buttons.secondary}
                onClick={() => onPreviewPortfolioById(data.portfolio_item_id!)}
              >
                Náhled portfolia
              </button>
            ) : null}
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
          </div>

          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
            <div
              aria-hidden
              style={{
                width: 1,
                height: 22,
                background: UI.colors.divider,
              }}
            />
            <button
              type="button"
              style={dangerButton}
              disabled={!poWorkflowActive || stornoBusy || !canProductionStorno}
              onClick={() => void handleStornoVp()}
            >
              {stornoBusy ? "Stornuji…" : "Stornovat VP"}
            </button>
          </div>
        </div>

        {actionFeedback ? (
          <div ref={writeFeedbackAnchorRef} style={{ scrollMarginTop: 8 }}>
            <InlineBanner
              kind={actionFeedback.kind}
              message={actionFeedback.message}
              onClose={() => setActionFeedback(null)}
            />
          </div>
        ) : null}
        {regenerateDisabled ? (
          <div style={{ fontSize: 12, color: "#64748b", marginTop: -6 }}>
            Přegenerování není dostupné pro rozpracovaný nebo uzavřený výrobní příkaz.
          </div>
        ) : null}

        <div style={tableSectionCard}>
          <div style={sectionHeader}>
            <div>
              <div style={{ ...erpDetailSectionEyebrow, marginBottom: 2 }}>Technologický postup</div>
              <div style={sectionHeaderTitle}>Operace výrobního příkazu</div>
            </div>
            {totalOperations > 0 ? (
              <div style={sectionHeaderSub}>
                {doneOperations}/{totalOperations} hotovo
              </div>
            ) : null}
          </div>
          {data.operations.length === 0 ? (
            <div
              style={{
                ...UI.overviewEmptyInCard,
                padding: "24px 18px",
              }}
            >
              Pro tuto portfolio variantu není k dispozici technologický postup.
            </div>
          ) : (
            <div style={UI.overviewTableWrap}>
              <table style={UI.table}>
                <thead>
                  <tr style={UI.overviewTableHeadRow}>
                    {[
                      { k: "no", label: "#", align: "right" as const },
                      { k: "op", label: "Operace", align: "left" as const },
                      { k: "wp", label: "Pracoviště", align: "left" as const },
                      { k: "setup", label: "Setup (min)", align: "right" as const },
                      { k: "run", label: "Čas / ks (min)", align: "right" as const },
                      { k: "status", label: "Stav", align: "left" as const },
                      { k: "done", label: "Odvedeno", align: "left" as const },
                      { k: "act", label: "Akce", align: "left" as const },
                      { k: "note", label: "Poznámka", align: "left" as const },
                    ].map((h) => (
                      <th key={h.k} style={{ ...tableHeadCell, textAlign: h.align }}>
                        {h.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.operations.map((op, idx) => {
                    const rowBg = idx % 2 === 1 ? rowStripeBg : UI.colors.card;
                    const numCell = {
                      ...tableBodyCell,
                      textAlign: "right" as const,
                      fontVariantNumeric: "tabular-nums" as const,
                      background: rowBg,
                    };
                    const txtCell = { ...tableBodyCell, background: rowBg };
                    const okTotal = op.reported_ok_qty_total ?? 0;
                    const nokTotal = op.reported_nok_qty_total ?? 0;
                    const minTotal = op.reported_minutes_total ?? 0;
                    const canExec = poWorkflowActive && busyOp !== op.operation_no && canProductionExecute;
                    return (
                      <tr key={op.id}>
                        <td style={{ ...numCell, fontWeight: 900, color: UI.colors.textPrimary }}>
                          {op.operation_no}
                        </td>
                        <td style={{ ...txtCell, fontWeight: 700, color: UI.colors.textPrimary }}>
                          {op.operation_name}
                        </td>
                        <td style={txtCell}>{op.workplace_name ?? "—"}</td>
                        <td style={numCell}>{op.setup_time_min}</td>
                        <td style={numCell}>{op.run_min_per_piece}</td>
                        <td style={txtCell}>
                          <span className="erp-status-badge" style={opStatusBadge(op.operation_status)}>
                            {labelVpOperationProgress(op.operation_status)}
                          </span>
                        </td>
                        <td style={txtCell}>
                          <div
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              gap: 2,
                              fontVariantNumeric: "tabular-nums",
                              lineHeight: 1.3,
                            }}
                          >
                            <div style={{ fontSize: 13, fontWeight: 700, color: UI.colors.textPrimary }}>
                              <span style={{ color: UI.colors.okFg }}>OK {okTotal}</span>
                              <span style={{ color: UI.colors.neutralFg, margin: "0 6px" }}>·</span>
                              <span style={{ color: nokTotal > 0 ? UI.colors.problemFg : UI.colors.neutralFg }}>
                                NOK {nokTotal}
                              </span>
                            </div>
                            <div style={{ fontSize: 12, fontWeight: 600, color: UI.colors.textSecondary }}>
                              {minTotal} min
                            </div>
                          </div>
                        </td>
                        <td style={{ ...txtCell, minWidth: 360 }}>
                          <div
                            style={{
                              display: "flex",
                              flexWrap: "wrap",
                              alignItems: "flex-end",
                              gap: 10,
                            }}
                          >
                            <button
                              type="button"
                              style={UI.buttons.secondary}
                              disabled={!canExec}
                              onClick={() => handleStartOperation(op.operation_no)}
                            >
                              Zahájit
                            </button>
                            <div
                              style={{
                                display: "flex",
                                alignItems: "flex-end",
                                gap: 8,
                                padding: "6px 10px",
                                borderRadius: 10,
                                background: UI.colors.card,
                                border: `1px solid ${UI.colors.border}`,
                              }}
                            >
                              <label style={{ display: "flex", flexDirection: "column" }}>
                                <span style={fieldLabel}>OK</span>
                                <input
                                  style={{ ...UI.inputs.base, width: 64, padding: "6px 8px", textAlign: "right" }}
                                  value={okByOp[op.operation_no] ?? ""}
                                  onChange={(e) => setOkByOp((s) => ({ ...s, [op.operation_no]: e.target.value }))}
                                />
                              </label>
                              <label style={{ display: "flex", flexDirection: "column" }}>
                                <span style={fieldLabel}>NOK</span>
                                <input
                                  style={{ ...UI.inputs.base, width: 64, padding: "6px 8px", textAlign: "right" }}
                                  value={nokByOp[op.operation_no] ?? ""}
                                  onChange={(e) => setNokByOp((s) => ({ ...s, [op.operation_no]: e.target.value }))}
                                />
                              </label>
                              <label style={{ display: "flex", flexDirection: "column" }}>
                                <span style={fieldLabel}>Min</span>
                                <input
                                  style={{ ...UI.inputs.base, width: 80, padding: "6px 8px", textAlign: "right" }}
                                  value={minutesByOp[op.operation_no] ?? ""}
                                  onChange={(e) => setMinutesByOp((s) => ({ ...s, [op.operation_no]: e.target.value }))}
                                />
                              </label>
                              <button
                                type="button"
                                style={UI.buttons.primary}
                                disabled={!canExec}
                                onClick={() => handleReportOperation(op.operation_no)}
                              >
                                Odvést
                              </button>
                            </div>
                          </div>
                        </td>
                        <td style={{ ...txtCell, maxWidth: 220, whiteSpace: "normal" }}>
                          {op.note ?? "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div style={tableSectionCard}>
          <div style={sectionHeader}>
            <div>
              <div style={{ ...erpDetailSectionEyebrow, marginBottom: 2 }}>Vstupy</div>
              <div style={sectionHeaderTitle}>Materiál a komponenty VP</div>
            </div>
            {data.inputs.length > 0 ? (
              <div style={sectionHeaderSub}>{data.inputs.length} položek</div>
            ) : null}
          </div>
          {data.inputs.length === 0 ? (
            <div
              style={{
                ...UI.overviewEmptyInCard,
                padding: "24px 18px",
              }}
            >
              Pro tuto portfolio variantu nejsou definované vstupy.
            </div>
          ) : (
            <div style={UI.overviewTableWrap}>
              <table style={UI.table}>
                <thead>
                  <tr style={UI.overviewTableHeadRow}>
                    {["Typ", "Materiál / Produkt", "Kód / GPN", "Spotřeba / ks", "Prořez (kerf / ks)", "Celkem (VP)", "Poznámka"].map((h) => (
                      <th key={h} style={tableHeadCell}>{h}</th>
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
