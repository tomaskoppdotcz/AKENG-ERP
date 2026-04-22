import React, { useEffect, useState } from "react";
import DetailPageHeader from "../components/DetailPageHeader";
import InlineBanner from "../components/InlineBanner";
import PageContainer from "../components/layout/PageContainer";
import {
  erpDetailIdentGrid,
  erpDetailIdentLabel,
  erpDetailIdentValue,
  erpDetailRowLabel,
  erpDetailRowValue,
  erpDetailSectionEyebrow,
  erpDetailStateCard,
  UI,
} from "../styles/ui";
import { akengFetch } from "../services/akengFetch";
import { getEmployeesMaster, getWorkplaceLibraryItems, type EmployeeMasterRow } from "../services/masterLibrariesApi";
import {
  deleteWorkReport,
  getWorkReport,
  resolveProductionOrderForPlanningOperation,
  type DeleteWorkReportResponse,
  type WorkReportDto,
} from "../services/workReportsApi";
import { buildErpUrl } from "../utils/erpDeepLink";
import { runWriteAction } from "../utils/writeActionFeedback";
import {
  formatOverviewHoursFromMinutes,
  formatOverviewReportedMinutes,
} from "../overview/overviewMetricsFormat";

const API_BASE = (import.meta as any).env?.VITE_API_BASE_URL || "http://127.0.0.1:8000";

type MachineMasterRow = {
  id: number;
  machine_code?: string | null;
  name?: string | null;
};

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
  fontWeight: 800,
};

type Props = {
  workReportId: number;
  onBack: () => void;
  onEdit?: (workReportId: number) => void;
  onWorkspaceTabTitle?: (title: string) => void;
  onOpenProductionOrderDetail?: (productionOrderId: number) => void;
};

const EMPTY = "Nezadan";

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return EMPTY;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return EMPTY;
  return d.toLocaleString("cs-CZ", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDateOnly(iso: string | null | undefined): string {
  if (!iso) return EMPTY;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return EMPTY;
  return d.toLocaleDateString("cs-CZ", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function formatDuration(min: number | null | undefined): string {
  if (min == null || !Number.isFinite(Number(min))) return EMPTY;
  const m = Number(min);
  if (Math.abs(m) < 60) return formatOverviewReportedMinutes(m);
  return formatOverviewHoursFromMinutes(m);
}

function sourceLabel(source: string): string {
  const s = (source || "").toLowerCase();
  if (s === "manual") return "Rucni";
  if (s === "pc_kiosk") return "PC kiosk";
  if (s === "shopfloor_kiosk") return "Shopfloor";
  return (source || "").trim() || EMPTY;
}

function isShopfloorSource(source: string | null | undefined): boolean {
  const s = (source ?? "").toLowerCase();
  return s === "shopfloor_kiosk" || s.includes("shopfloor");
}

function statusBadgeStyle(open: boolean): React.CSSProperties {
  if (open) {
    return { ...UI.statusBadgeBase, ...UI.statusBadgeRunning };
  }
  return { ...UI.statusBadgeBase, ...UI.statusBadgeOk };
}

export default function WorkReportDetailPage({
  workReportId,
  onBack,
  onEdit,
  onWorkspaceTabTitle,
  onOpenProductionOrderDetail,
}: Props) {
  const [data, setData] = useState<WorkReportDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [vpCode, setVpCode] = useState<string | null>(null);
  const [employeeLine, setEmployeeLine] = useState<string>(EMPTY);
  const [machineLine, setMachineLine] = useState<string>(EMPTY);
  const [workplaceName, setWorkplaceName] = useState<string>(EMPTY);
  const [actionFeedback, setActionFeedback] = useState<{ kind: "success" | "info" | "warning" | "error"; message: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setData(null);
    void getWorkReport(workReportId)
      .then((row) => {
        if (!cancelled) setData(row);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Nepodarilo se nacist vykaz.");
          setData(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [workReportId]);

  async function handleDelete(reportId: number) {
    if (deleting) return;
    if (!window.confirm("Opravdu chcete tento vykaz trvale smazat?")) return;

    setActionFeedback(null);
    setDeleting(true);
    const fb = await runWriteAction<DeleteWorkReportResponse>(
      () => deleteWorkReport(reportId),
      {
        successMessage: "Vykaz byl trvale smazan.",
        errorMessage: "Smazani vykazu se nepodarilo.",
      }
    );
    setDeleting(false);

    if (fb.kind === "success") {
      setActionFeedback(fb);
      try {
        sessionStorage.setItem("akeng_work_reports_refresh_once", "1");
      } catch {
        /* ignore */
      }
      await new Promise((r) => setTimeout(r, 500));
      onBack();
      return;
    }

    setActionFeedback(fb);
  }

  useEffect(() => {
    if (!data) return;
    let cancelled = false;
    void (async () => {
      let vp: string | null = null;
      try {
        const po = await resolveProductionOrderForPlanningOperation(data.planning_operation_id);
        if (!cancelled) vp = (po.vp_code ?? "").trim() || null;
      } catch {
        /* ignore */
      }
      let empLine = EMPTY;
      let mach = EMPTY;
      let wpName = EMPTY;
      try {
        const [emps, wps, machRes] = await Promise.all([
          getEmployeesMaster("active").catch(() => [] as EmployeeMasterRow[]),
          getWorkplaceLibraryItems().catch(() => []),
          akengFetch(`${API_BASE}/master-data/machines`),
        ]);
        if (data.employee_id != null) {
          const e = emps.find((x) => x.id === data.employee_id);
          if (e) {
            empLine = `${e.full_name}${e.employee_code ? ` (${e.employee_code})` : ""}`;
          } else if ((data.operator_display ?? "").trim()) {
            empLine = (data.operator_display ?? "").trim();
          } else {
            empLine = `ID ${data.employee_id}`;
          }
        } else if ((data.operator_display ?? "").trim()) {
          empLine = (data.operator_display ?? "").trim();
        }
        if (data.workplace_library_item_id != null) {
          const w = wps.find((x) => x.id === data.workplace_library_item_id);
          if (w?.name) wpName = w.name;
        }
        if (machRes?.ok) {
          try {
            const raw = await machRes.json();
            if (Array.isArray(raw)) {
              const rows = raw as MachineMasterRow[];
              const m = rows.find((x) => x.id === data.machine_id);
              if (m) {
                mach = (m.name || m.machine_code || "").trim() || `Stroj #${m.id}`;
              }
            }
          } catch {
            /* ignore */
          }
        }
        if (mach === EMPTY && data.machine_id) {
          mach = `Stroj #${data.machine_id}`;
        }
      } catch {
        /* ignore */
      }
      if (!cancelled) {
        setVpCode(vp);
        setEmployeeLine(empLine);
        setMachineLine(mach);
        setWorkplaceName(wpName);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [data]);

  useEffect(() => {
    if (!onWorkspaceTabTitle || !data) return;
    const hint = (vpCode ?? "").trim();
    const c = (data.code ?? "").trim() || `ID ${data.id}`;
    onWorkspaceTabTitle(hint ? `Vykaz ${c} · ${hint}` : `Vykaz ${c}`);
  }, [data, vpCode, onWorkspaceTabTitle]);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("akeng_work_report_feedback");
      if (!raw) return;
      const parsed = JSON.parse(raw) as { workReportId?: number; kind?: "success" | "info" | "warning" | "error"; message?: string };
      if (parsed.workReportId === workReportId && parsed.kind && parsed.message) {
        setActionFeedback({ kind: parsed.kind, message: parsed.message });
      }
      sessionStorage.removeItem("akeng_work_report_feedback");
    } catch {
      try {
        sessionStorage.removeItem("akeng_work_report_feedback");
      } catch {
        /* ignore */
      }
    }
  }, [workReportId]);

  const contextCardCompact: React.CSSProperties = {
    ...erpDetailStateCard,
    padding: "10px 12px",
    gap: 8,
    boxShadow: "0 4px 12px rgba(15, 23, 42, 0.04)",
  };

  const summaryCard: React.CSSProperties = {
    padding: "8px 10px",
    borderRadius: 12,
    background: UI.colors.card,
    border: `1px solid ${UI.colors.border}`,
  };

  const detailSectionCard: React.CSSProperties = {
    ...UI.card,
    borderRadius: 14,
    padding: "10px 12px",
  };

  const detailGroupBox: React.CSSProperties = {
    border: `1px solid ${UI.colors.border}`,
    borderRadius: 10,
    padding: "8px 10px",
    background: UI.colors.neutralBg,
    minWidth: 0,
  };

  const detailGroupTitle: React.CSSProperties = {
    fontSize: 12,
    fontWeight: 800,
    color: UI.colors.textSecondary,
    marginBottom: 6,
    letterSpacing: 0.02,
  };

  const qtyEmphasisOk: React.CSSProperties = {
    ...erpDetailIdentValue,
    fontVariantNumeric: "tabular-nums",
    fontSize: 17,
    fontWeight: 900,
    color: UI.colors.okFg,
    letterSpacing: 0.02,
  };

  const qtyEmphasisNok: React.CSSProperties = {
    ...erpDetailIdentValue,
    fontVariantNumeric: "tabular-nums",
    fontSize: 17,
    fontWeight: 900,
    color: UI.colors.problemFg,
    letterSpacing: 0.02,
  };

  if (loading) {
    return (
      <PageContainer className="erp-overview-page" style={{ paddingTop: 10 }}>
        <div style={{ ...UI.card, borderRadius: 14, padding: "14px 16px" }}>
          <div style={UI.sectionSubtitle}>Nacitam vykaz prace...</div>
        </div>
      </PageContainer>
    );
  }

  if (error || !data) {
    return (
      <PageContainer className="erp-overview-page" style={{ paddingTop: 10 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <button type="button" style={UI.buttons.secondary} onClick={onBack}>
            Zpet na vykazy
          </button>
          <div
            style={{
              ...UI.card,
              borderRadius: 14,
              padding: "14px 16px",
              border: "1px solid #fecaca",
              background: "#fef2f2",
              color: "#991b1b",
              fontWeight: 700,
            }}
          >
            {error ?? "Vykaz se nepodarilo zobrazit."}
          </div>
        </div>
      </PageContainer>
    );
  }

  const open = data.ended_at == null;
  const productionOrderId = data.production_order_id;
  const vpDisplay = (vpCode ?? "").trim() || (productionOrderId != null ? `#${productionOrderId}` : EMPTY);

  return (
    <PageContainer className="erp-overview-page" style={{ paddingTop: 10 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, width: "100%", minWidth: 0 }}>
        <DetailPageHeader
          title={
            <div
              style={{
                fontSize: 28,
                fontWeight: 1000,
                color: UI.colors.primary,
                letterSpacing: 0.3,
                lineHeight: 1.05,
              }}
            >
              Vykaz prace
            </div>
          }
          actions={
            <>
              {onEdit ? (
                <button type="button" style={UI.buttons.primary} onClick={() => onEdit(data.id)}>
                  Upravit
                </button>
              ) : null}
              <button
                type="button"
                style={{
                  ...UI.buttons.secondary,
                  borderColor: "#fca5a5",
                  color: "#991b1b",
                }}
                onClick={() => void handleDelete(data.id)}
                disabled={deleting}
              >
                {deleting ? "Mazu..." : "Smazat"}
              </button>
              <button
                type="button"
                style={UI.buttons.secondary}
                onClick={() => window.open(buildErpUrl({ view: "workReport", workReportId: data.id }), "_blank")}
              >
                Otevrit v novem okne
              </button>
              <button type="button" style={UI.buttons.secondary} onClick={onBack}>
                Zpet na vykazy
              </button>
            </>
          }
          context={
            <div style={contextCardCompact}>
              <div style={erpDetailSectionEyebrow}>Kontext</div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
                  gap: 8,
                }}
              >
                <div>
                  <div style={erpDetailRowLabel}>Vykaz</div>
                  <div style={{ ...erpDetailRowValue, fontVariantNumeric: "tabular-nums" }}>
                    {(data.code ?? "").trim() || `ID ${data.id}`}
                  </div>
                </div>
                <div>
                  <div style={erpDetailRowLabel}>Zamestnanec</div>
                  <div style={erpDetailRowValue}>{employeeLine}</div>
                </div>
                <div>
                  <div style={erpDetailRowLabel}>VP</div>
                  <div style={erpDetailRowValue}>
                    {productionOrderId != null && onOpenProductionOrderDetail ? (
                      <button
                        type="button"
                        className="erp-table-link"
                        style={{ ...linkButtonReset, fontSize: "inherit" }}
                        onClick={() => onOpenProductionOrderDetail(productionOrderId)}
                      >
                        {vpDisplay}
                      </button>
                    ) : (
                      vpDisplay
                    )}
                  </div>
                </div>
                <div>
                  <div style={erpDetailRowLabel}>Datum</div>
                  <div style={erpDetailRowValue}>{formatDateOnly(data.started_at)}</div>
                </div>
              </div>
            </div>
          }
          summaryTiles={
            <div style={summaryCard}>
              <div style={{ ...erpDetailSectionEyebrow, color: UI.colors.neutralFg, marginBottom: 4 }}>Souhrn</div>
              <div style={{ ...erpDetailIdentGrid, gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}>
                <div>
                  <div style={erpDetailIdentLabel}>Operace</div>
                  <div style={erpDetailIdentValue}>
                    #{data.operation_no} {data.operation_name}
                  </div>
                </div>
                <div>
                  <div style={erpDetailIdentLabel}>Pracoviste</div>
                  <div style={erpDetailIdentValue}>{workplaceName}</div>
                </div>
                <div>
                  <div style={erpDetailIdentLabel}>Stav vykazu</div>
                  <div style={{ marginTop: 2 }}>
                    <span style={statusBadgeStyle(open)}>{open ? "Otevreny" : "Uzavreny"}</span>
                  </div>
                </div>
                <div>
                  <div style={erpDetailIdentLabel}>Zdroj</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 2 }}>
                    {isShopfloorSource(data.source) ? (
                      <span
                        className="erp-status-badge"
                        title={data.source ?? undefined}
                        style={{
                          ...UI.statusBadgeBase,
                          fontSize: 10,
                          padding: "3px 8px",
                          background: "#e0f2fe",
                          color: "#0369a1",
                          border: "1px solid #7dd3fc",
                          fontWeight: 800,
                        }}
                      >
                        Shopfloor
                      </span>
                    ) : (
                      <span style={erpDetailIdentValue}>{sourceLabel(data.source)}</span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          }
        />
        {actionFeedback ? (
          <InlineBanner kind={actionFeedback.kind} message={actionFeedback.message} onClose={() => setActionFeedback(null)} />
        ) : null}

        <div style={detailSectionCard}>
          <div
            style={{
              ...erpDetailSectionEyebrow,
              letterSpacing: "0.06em",
              fontSize: 10,
              marginBottom: 8,
            }}
          >
            DETAIL VYKAZU
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: 10,
              alignItems: "stretch",
            }}
          >
            <div style={detailGroupBox}>
              <div style={detailGroupTitle}>Cas</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                <div>
                  <div style={erpDetailIdentLabel}>Zacatek</div>
                  <div style={erpDetailIdentValue}>{formatDateTime(data.started_at)}</div>
                </div>
                <div>
                  <div style={erpDetailIdentLabel}>Konec</div>
                  <div style={erpDetailIdentValue}>{formatDateTime(data.ended_at)}</div>
                </div>
                <div>
                  <div style={erpDetailIdentLabel}>Trvani</div>
                  <div style={{ ...erpDetailIdentValue, fontVariantNumeric: "tabular-nums" }}>{formatDuration(data.duration_min)}</div>
                </div>
              </div>
            </div>

            <div style={detailGroupBox}>
              <div style={detailGroupTitle}>Vysledek</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 16px", alignItems: "flex-end" }}>
                <div style={{ minWidth: 64 }}>
                  <div style={erpDetailIdentLabel}>OK</div>
                  <div style={qtyEmphasisOk}>{(data.qty_ok ?? 0).toLocaleString("cs-CZ")}</div>
                </div>
                <div style={{ minWidth: 64 }}>
                  <div style={erpDetailIdentLabel}>NOK</div>
                  <div style={qtyEmphasisNok}>{(data.qty_nok ?? 0).toLocaleString("cs-CZ")}</div>
                </div>
              </div>
            </div>

            <div style={detailGroupBox}>
              <div style={detailGroupTitle}>Vazby</div>
              <div style={{ ...erpDetailIdentGrid, gap: 6, gridTemplateColumns: "1fr" }}>
                <div>
                  <div style={erpDetailIdentLabel}>Zamestnanec</div>
                  <div style={erpDetailIdentValue}>{employeeLine}</div>
                </div>
                <div>
                  <div style={erpDetailIdentLabel}>Vyrobni prikaz</div>
                  <div style={erpDetailIdentValue}>
                    {productionOrderId != null && onOpenProductionOrderDetail ? (
                      <button type="button" style={linkButtonReset} onClick={() => onOpenProductionOrderDetail(productionOrderId)}>
                        {vpDisplay}
                      </button>
                    ) : (
                      vpDisplay
                    )}
                  </div>
                </div>
                <div>
                  <div style={erpDetailIdentLabel}>Planovaci operace</div>
                  <div style={{ ...erpDetailIdentValue, fontVariantNumeric: "tabular-nums" }}>
                    #{data.planning_operation_id} · operace {data.operation_no}
                  </div>
                </div>
                <div>
                  <div style={erpDetailIdentLabel}>Stroj / pracoviste</div>
                  <div style={erpDetailIdentValue}>
                    {machineLine}
                    {workplaceName !== EMPTY ? ` · ${workplaceName}` : ""}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </PageContainer>
  );
}
