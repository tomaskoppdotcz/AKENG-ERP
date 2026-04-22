import React, { useEffect, useMemo, useRef, useState } from "react";
import InlineBanner from "../components/InlineBanner";
import PageContainer from "../components/layout/PageContainer";
import { UI, erpDetailRowLabel, erpDetailRowValue, erpDetailSectionEyebrow } from "../styles/ui";
import { getEmployeesMaster, getWorkplaceLibraryItems, type EmployeeMasterRow } from "../services/masterLibrariesApi";
import {
  getWorkReport,
  patchWorkReport,
  resolveProductionOrderForPlanningOperation,
  type WorkReportDto,
} from "../services/workReportsApi";
import { formatOverviewHoursFromMinutes, formatOverviewReportedMinutes } from "../overview/overviewMetricsFormat";
import { runWriteAction, type WriteFeedback } from "../utils/writeActionFeedback";
import { akengFetch } from "../services/akengFetch";

const API_BASE = (import.meta as any).env?.VITE_API_BASE_URL || "http://127.0.0.1:8000";

const SOURCE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "manual", label: "Ručně (doplnění)" },
  { value: "pc_kiosk", label: "PC kiosk" },
  { value: "shopfloor_kiosk", label: "Shopfloor kiosk" },
];

type MachineMasterRow = {
  id: number;
  machine_code?: string | null;
  name?: string | null;
};

type Props = {
  workReportId: number;
  onCancel: () => void;
  onSaved: (next: { workReportId: number }) => void;
  onWorkspaceTabTitle?: (title: string) => void;
};

function toLocalInputValue(iso: string | null | undefined): string {
  if (!iso) return "";
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return "";
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const d = String(dt.getDate()).padStart(2, "0");
  const hh = String(dt.getHours()).padStart(2, "0");
  const mm = String(dt.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${d}T${hh}:${mm}`;
}

function toApiLocalDateTime(value: string): string | null {
  const t = value.trim();
  if (!t) return null;
  if (t.length === 16) return `${t}:00`;
  return t;
}

function formatDuration(min: number | null | undefined): string {
  if (min == null || !Number.isFinite(Number(min))) return "—";
  const m = Number(min);
  if (Math.abs(m) < 60) return formatOverviewReportedMinutes(m);
  return formatOverviewHoursFromMinutes(m);
}

function deriveDurationFromRange(start: string, end: string): string {
  if (!start || !end) return "—";
  const a = new Date(toApiLocalDateTime(start) ?? "");
  const b = new Date(toApiLocalDateTime(end) ?? "");
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime()) || b.getTime() < a.getTime()) return "—";
  const min = Math.round((b.getTime() - a.getTime()) / 60000);
  return formatDuration(min);
}

export default function WorkReportEditPage({ workReportId, onCancel, onSaved, onWorkspaceTabTitle }: Props) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<WriteFeedback | null>(null);
  const bannerAnchorRef = useRef<HTMLDivElement>(null);

  const [report, setReport] = useState<WorkReportDto | null>(null);
  const [employees, setEmployees] = useState<EmployeeMasterRow[]>([]);
  const [workplaceName, setWorkplaceName] = useState<string>("—");
  const [machineLine, setMachineLine] = useState<string>("—");
  const [vpCode, setVpCode] = useState<string>("—");

  const [employeeId, setEmployeeId] = useState<number | null>(null);
  const [startedAt, setStartedAt] = useState<string>("");
  const [endedAt, setEndedAt] = useState<string>("");
  const [okQty, setOkQty] = useState<string>("");
  const [nokQty, setNokQty] = useState<string>("");
  const [source, setSource] = useState<string>("manual");

  useEffect(() => {
    if (!feedback) return;
    bannerAnchorRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [feedback]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void Promise.all([
      getWorkReport(workReportId),
      getEmployeesMaster("active").catch(() => [] as EmployeeMasterRow[]),
      getWorkplaceLibraryItems().catch(() => []),
      akengFetch(`${API_BASE}/master-data/machines`),
    ])
      .then(async ([row, emps, workplaces, machinesRes]) => {
        if (cancelled) return;
        setReport(row);
        setEmployees(emps);
        setEmployeeId(row.employee_id ?? null);
        setStartedAt(toLocalInputValue(row.started_at));
        setEndedAt(toLocalInputValue(row.ended_at));
        setOkQty(row.qty_ok == null ? "" : String(row.qty_ok));
        setNokQty(row.qty_nok == null ? "" : String(row.qty_nok));
        setSource((row.source || "manual").trim() || "manual");

        const wp = workplaces.find((x) => x.id === row.workplace_library_item_id);
        setWorkplaceName((wp?.name || "").trim() || "—");

        let machineText = "—";
        if (machinesRes.ok) {
          try {
            const raw = await machinesRes.json();
            if (Array.isArray(raw)) {
              const m = (raw as MachineMasterRow[]).find((x) => x.id === row.machine_id);
              if (m) machineText = (m.name || m.machine_code || "").trim() || `Stroj #${m.id}`;
            }
          } catch {
            /* ignore */
          }
        }
        if (machineText === "—" && row.machine_id != null) machineText = `Stroj #${row.machine_id}`;
        setMachineLine(machineText);

        try {
          const po = await resolveProductionOrderForPlanningOperation(row.planning_operation_id);
          if (!cancelled) setVpCode((po.vp_code || "").trim() || (po.production_order_id ? `#${po.production_order_id}` : "—"));
        } catch {
          if (!cancelled) setVpCode(row.production_order_id != null ? `#${row.production_order_id}` : "—");
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Výkaz se nepodařilo načíst.");
          setReport(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [workReportId]);

  useEffect(() => {
    if (!onWorkspaceTabTitle || !report) return;
    const code = (report.code ?? "").trim() || `ID ${report.id}`;
    onWorkspaceTabTitle(`Úprava výkazu ${code}`);
  }, [report, onWorkspaceTabTitle]);

  const durationPreview = useMemo(() => {
    if (!startedAt || !endedAt) return formatDuration(report?.duration_min);
    return deriveDurationFromRange(startedAt, endedAt);
  }, [startedAt, endedAt, report?.duration_min]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!report || saving) return;
    setFeedback(null);

    const startedIso = toApiLocalDateTime(startedAt);
    if (!startedIso) {
      setFeedback({ kind: "error", message: "Zadejte čas začátku." });
      return;
    }
    const endedIso = toApiLocalDateTime(endedAt);
    if (endedIso) {
      const a = new Date(startedIso);
      const b = new Date(endedIso);
      if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime()) || b.getTime() < a.getTime()) {
        setFeedback({ kind: "error", message: "Konec musí být po začátku." });
        return;
      }
    }

    const patch = {
      employee_id: employeeId,
      started_at: startedIso,
      ended_at: endedIso,
      qty_ok: okQty.trim() === "" ? null : Math.max(0, Math.floor(Number(okQty) || 0)),
      qty_nok: nokQty.trim() === "" ? null : Math.max(0, Math.floor(Number(nokQty) || 0)),
      source: source.trim() || "manual",
    };

    setSaving(true);
    const fb = await runWriteAction(
      async () => patchWorkReport(report.id, patch),
      {
        successMessage: "Změny výkazu byly uloženy.",
        errorMessage: "Změny výkazu se nepodařilo uložit.",
      }
    );
    setFeedback(fb);
    setSaving(false);
    if (fb.kind === "success" || fb.kind === "info") {
      try {
        sessionStorage.setItem(
          "akeng_work_report_feedback",
          JSON.stringify({ workReportId: report.id, kind: fb.kind, message: fb.message })
        );
      } catch {
        /* ignore */
      }
      window.setTimeout(() => onSaved({ workReportId: report.id }), 250);
    }
  }

  if (loading) {
    return (
      <PageContainer className="erp-overview-page" style={{ paddingTop: 10 }}>
        <div style={{ ...UI.card, padding: 16 }}>
          <div style={UI.sectionSubtitle}>Načítám výkaz pro úpravu…</div>
        </div>
      </PageContainer>
    );
  }

  if (error || !report) {
    return (
      <PageContainer className="erp-overview-page" style={{ paddingTop: 10 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <button type="button" style={UI.buttons.secondary} onClick={onCancel}>
            Zrušit
          </button>
          <div style={{ ...UI.card, border: "1px solid #fecaca", background: "#fef2f2", color: "#991b1b", fontWeight: 700 }}>
            {error ?? "Výkaz se nepodařilo zobrazit."}
          </div>
        </div>
      </PageContainer>
    );
  }

  return (
    <PageContainer className="erp-overview-page" style={{ paddingTop: 10 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, width: "100%", maxWidth: 860 }}>
        <div>
          <div style={UI.pageTitle}>Upravit výkaz práce</div>
          <div style={UI.sectionSubtitle}>Korekce času, množství, zaměstnance a zdroje výkazu.</div>
        </div>

        <div ref={bannerAnchorRef}>
          {feedback ? (
            <InlineBanner kind={feedback.kind} message={feedback.message} onClose={() => setFeedback(null)} />
          ) : null}
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ ...UI.card, padding: "12px 14px", display: "grid", gap: 14 }}>
            <div>
              <div style={erpDetailSectionEyebrow}>Kontext výkazu (readonly)</div>
              <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
                <div><div style={erpDetailRowLabel}>Výkaz</div><div style={erpDetailRowValue}>{(report.code || "").trim() || `ID ${report.id}`}</div></div>
                <div><div style={erpDetailRowLabel}>VP</div><div style={erpDetailRowValue}>{vpCode}</div></div>
                <div><div style={erpDetailRowLabel}>Operace</div><div style={erpDetailRowValue}>#{report.operation_no} {report.operation_name}</div></div>
                <div><div style={erpDetailRowLabel}>Plánovací operace</div><div style={erpDetailRowValue}>#{report.planning_operation_id}</div></div>
                <div><div style={erpDetailRowLabel}>Pracoviště</div><div style={erpDetailRowValue}>{workplaceName}</div></div>
                <div><div style={erpDetailRowLabel}>Stroj</div><div style={erpDetailRowValue}>{machineLine}</div></div>
                <div><div style={erpDetailRowLabel}>Stav výkazu</div><div style={erpDetailRowValue}>{report.ended_at ? "Uzavřený" : "Otevřený"}</div></div>
              </div>
            </div>

            <div style={{ borderTop: `1px solid ${UI.colors.border}`, paddingTop: 12 }}>
              <div style={erpDetailSectionEyebrow}>Editovatelná data</div>
              <div style={{ display: "grid", gap: 10 }}>
                <label>
                  <div style={UI.inputs.label}>Zaměstnanec</div>
                  <select
                    value={employeeId ?? ""}
                    onChange={(e) => setEmployeeId(e.target.value ? Number(e.target.value) : null)}
                    style={UI.inputs.base}
                  >
                    <option value="">Nezadáno</option>
                    {employees
                      .filter((x) => x.is_active)
                      .sort((a, b) => a.full_name.localeCompare(b.full_name, "cs"))
                      .map((emp) => (
                        <option key={emp.id} value={emp.id}>
                          {emp.full_name}{emp.employee_code ? ` (${emp.employee_code})` : ""}
                        </option>
                      ))}
                  </select>
                </label>

                <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
                  <label>
                    <div style={UI.inputs.label}>Začátek</div>
                    <input type="datetime-local" value={startedAt} onChange={(e) => setStartedAt(e.target.value)} style={UI.inputs.base} required />
                  </label>
                  <label>
                    <div style={UI.inputs.label}>Konec</div>
                    <input type="datetime-local" value={endedAt} onChange={(e) => setEndedAt(e.target.value)} style={UI.inputs.base} />
                  </label>
                </div>

                <label>
                  <div style={UI.inputs.label}>Trvání (odvozeno)</div>
                  <input value={durationPreview} readOnly style={{ ...UI.inputs.base, background: UI.colors.neutralBg }} />
                </label>

                <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" }}>
                  <label>
                    <div style={UI.inputs.label}>OK qty</div>
                    <input type="number" min={0} step={1} value={okQty} onChange={(e) => setOkQty(e.target.value)} style={UI.inputs.base} />
                  </label>
                  <label>
                    <div style={UI.inputs.label}>NOK qty</div>
                    <input type="number" min={0} step={1} value={nokQty} onChange={(e) => setNokQty(e.target.value)} style={UI.inputs.base} />
                  </label>
                </div>

                <label>
                  <div style={UI.inputs.label}>Zdroj</div>
                  <select value={source} onChange={(e) => setSource(e.target.value)} style={UI.inputs.base}>
                    {SOURCE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button type="button" style={UI.buttons.secondary} onClick={onCancel} disabled={saving}>
                Zrušit
              </button>
              <button type="submit" style={{ ...UI.buttons.primary, ...(saving ? { opacity: 0.7, cursor: "wait" } : {}) }} disabled={saving}>
                {saving ? "Ukládám…" : "Uložit změny"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </PageContainer>
  );
}
