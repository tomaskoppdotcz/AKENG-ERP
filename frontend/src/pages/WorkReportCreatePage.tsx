import React, { useEffect, useMemo, useRef, useState } from "react";
import PageContainer from "../components/layout/PageContainer";
import InlineBanner from "../components/InlineBanner";
import { canPerformAction, readStoredErpRole } from "../auth/rbac";
import { UI } from "../styles/ui";
import { akengFetch } from "../services/akengFetch";
import { getEmployeesMaster, type EmployeeMasterRow } from "../services/masterLibrariesApi";
import { getProductionOrdersOverview, type ProductionOrderOverviewRow } from "../services/productionOrdersApi";
import {
  createWorkReport,
  fetchPlanningOperationsForVp,
  type WorkReportDto,
  type WorkReportPlanningOperationRow,
} from "../services/workReportsApi";
import { buildSearchHaystack, matchesSearchQuery } from "../overview/overviewSearch";
import { formatOverviewHoursFromMinutes, formatOverviewReportedMinutes } from "../overview/overviewMetricsFormat";
import { runWriteAction, type WriteFeedback } from "../utils/writeActionFeedback";

const API_BASE = (import.meta as any).env?.VITE_API_BASE_URL || "http://127.0.0.1:8000";

type MachineMasterRow = {
  id: number;
  machine_code?: string | null;
  name?: string | null;
};

const SOURCE_OPTIONS: { value: string; label: string }[] = [
  { value: "manual", label: "Ruční (doplnění)" },
  { value: "pc_kiosk", label: "PC kiosk" },
  { value: "shopfloor_kiosk", label: "Shopfloor kiosk" },
];

const PLANNING_STATUS_LABEL: Record<string, string> = {
  bezi: "Běží",
  hotovo: "Hotovo",
  ceka: "Čeká",
  naplanovano: "Naplánováno",
  planned: "Planned",
  ready: "Připraveno",
  waiting_release: "Čeká na uvolnění",
  blokovano: "Blokováno",
  scheduling_late: "Po termínu",
  cancelled: "Zrušeno",
};

function labelPlanningStatus(raw: string | null | undefined): string {
  if (raw == null || String(raw).trim() === "") return "—";
  const k = String(raw).toLowerCase();
  return PLANNING_STATUS_LABEL[k] ?? String(raw);
}

function filterVps(orders: ProductionOrderOverviewRow[], q: string): ProductionOrderOverviewRow[] {
  const s = q.trim();
  if (!s) return orders;
  return orders.filter((v) => {
    const hay = buildSearchHaystack(
      v.vp_code,
      v.gpn,
      v.description,
      v.zakazka,
      v.customer_order_no,
      v.drawing_number,
      v.drawing_revision,
      v.logistic_mode
    );
    return matchesSearchQuery(s, hay);
  });
}

function toApiLocalDateTime(s: string): string {
  const t = s.trim();
  if (!t) return "";
  if (t.length === 16) return `${t}:00`;
  return t;
}

function deriveDurationPreview(start: string, end: string): string {
  if (!start || !end) return "—";
  const a = new Date(toApiLocalDateTime(start));
  const b = new Date(toApiLocalDateTime(end));
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime()) || b.getTime() < a.getTime()) return "—";
  const min = Math.round((b.getTime() - a.getTime()) / 60000);
  if (!Number.isFinite(min)) return "—";
  if (Math.abs(min) < 60) return formatOverviewReportedMinutes(min);
  return formatOverviewHoursFromMinutes(min);
}

type Props = {
  onCancel: () => void;
  onCreated: (p: { workReportId: number; titleForTab: string }) => void;
  onWorkspaceTabTitle?: (title: string) => void;
};

const fieldLabel: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  color: UI.colors.neutralFg,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
};

const sectionLabel: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 800,
  color: UI.colors.textSecondary,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  marginBottom: 6,
};

function opRowLabel(r: WorkReportPlanningOperationRow): string {
  return `${r.operation_no} · ${(r.operation_name || "").trim() || "—"}`;
}

export default function WorkReportCreatePage({ onCancel, onCreated, onWorkspaceTabTitle }: Props) {
  const erpRole = useMemo(() => readStoredErpRole(), []);
  const canWrite = canPerformAction(erpRole, "production.execute");

  const [vps, setVps] = useState<ProductionOrderOverviewRow[]>([]);
  const [vpQuery, setVpQuery] = useState("");
  const [productionOrderId, setProductionOrderId] = useState<number | null>(null);
  const [ops, setOps] = useState<WorkReportPlanningOperationRow[]>([]);
  const [opLoading, setOpLoading] = useState(false);
  const [opError, setOpError] = useState<string | null>(null);
  const [planningOperationId, setPlanningOperationId] = useState<number | null>(null);
  const [machines, setMachines] = useState<MachineMasterRow[]>([]);
  const [employees, setEmployees] = useState<EmployeeMasterRow[]>([]);
  const [mastersLoading, setMastersLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [actionFeedback, setActionFeedback] = useState<WriteFeedback | null>(null);
  const writeFeedbackAnchorRef = useRef<HTMLDivElement>(null);

  const [machineId, setMachineId] = useState<number | null>(null);
  const [employeeId, setEmployeeId] = useState<number | null>(null);
  const [startedAt, setStartedAt] = useState("");
  const [endedAt, setEndedAt] = useState("");
  const [okQty, setOkQty] = useState("");
  const [nokQty, setNokQty] = useState("");
  const [source, setSource] = useState("manual");

  const selectedVp = productionOrderId ? vps.find((v) => v.id === productionOrderId) : null;
  const filteredVps = useMemo(() => filterVps(vps, vpQuery).slice(0, 14), [vps, vpQuery]);
  const selectedOp = useMemo(
    () => (planningOperationId != null ? ops.find((o) => o.planning_operation_id === planningOperationId) : null),
    [ops, planningOperationId]
  );
  const noReportableOperations = productionOrderId != null && !opLoading && !opError && ops.length === 0;
  const saveDisabled = saving || opLoading || noReportableOperations;

  useEffect(() => {
    onWorkspaceTabTitle?.("Nový výkaz práce");
  }, [onWorkspaceTabTitle]);

  useEffect(() => {
    if (!actionFeedback) return;
    writeFeedbackAnchorRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [actionFeedback]);

  useEffect(() => {
    let c = false;
    (async () => {
      setMastersLoading(true);
      try {
        const [vpRows, empRows, machRes] = await Promise.all([
          getProductionOrdersOverview("all"),
          getEmployeesMaster("active").catch(() => [] as EmployeeMasterRow[]),
          akengFetch(`${API_BASE}/master-data/machines`),
        ]);
        let machRows: MachineMasterRow[] = [];
        if (machRes?.ok) {
          try {
            const raw = await machRes.json();
            if (Array.isArray(raw)) machRows = raw as MachineMasterRow[];
          } catch {
            /* ignore */
          }
        }
        if (!c) {
          setVps(vpRows);
          setEmployees(empRows);
          setMachines(machRows);
        }
      } finally {
        if (!c) setMastersLoading(false);
      }
    })();
    return () => {
      c = true;
    };
  }, []);

  useEffect(() => {
    if (productionOrderId == null) {
      setOps([]);
      setPlanningOperationId(null);
      setOpError(null);
      return;
    }
    let cancelled = false;
    setOpLoading(true);
    setOpError(null);
    setPlanningOperationId(null);
    setOps([]);
    void fetchPlanningOperationsForVp(productionOrderId, { onlyWithoutWorkReport: true })
      .then((r) => {
        if (cancelled) return;
        setOps(r.operations || []);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setOpError(e instanceof Error ? e.message : "Operace se nepodařilo načíst.");
          setOps([]);
        }
      })
      .finally(() => {
        if (!cancelled) setOpLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [productionOrderId]);

  useEffect(() => {
    if (!selectedOp) {
      setMachineId(null);
      return;
    }
    setMachineId(selectedOp.machine_id);
  }, [selectedOp]);

  const machineOptions = useMemo(
    () =>
      machines
        .slice()
        .sort((a, b) => String(a.name || a.machine_code || "").localeCompare(String(b.name || b.machine_code || ""), "cs")),
    [machines]
  );

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canWrite || saveDisabled) return;
    setActionFeedback(null);
    if (noReportableOperations) {
      setActionFeedback({
        kind: "warning",
        message: "Pro zvolený VP už všechny operace mají výkaz práce. Vyberte jiný VP.",
      });
      return;
    }
    if (planningOperationId == null) {
      setActionFeedback({ kind: "error", message: "Vyberte plánovací operaci." });
      return;
    }
    if (machineId == null) {
      setActionFeedback({ kind: "error", message: "Vyberte stroj." });
      return;
    }
    const sIso = toApiLocalDateTime(startedAt);
    if (!sIso) {
      setActionFeedback({ kind: "error", message: "Zadejte čas zahájení." });
      return;
    }
    const eIso = endedAt.trim() ? toApiLocalDateTime(endedAt) : null;
    if (eIso && sIso) {
      const a = new Date(sIso);
      const b = new Date(eIso);
      if (!Number.isNaN(a.getTime()) && !Number.isNaN(b.getTime()) && b.getTime() < a.getTime()) {
        setActionFeedback({ kind: "error", message: "Konec musí být po začátku." });
        return;
      }
    }
    setSaving(true);
    const body = {
      planning_operation_id: planningOperationId,
      machine_id: machineId,
      started_at: sIso,
      ended_at: eIso,
      source,
      employee_id: employeeId ?? null,
      qty_ok: okQty.trim() === "" ? null : Math.max(0, Math.floor(Number(okQty) || 0)),
      qty_nok: nokQty.trim() === "" ? null : Math.max(0, Math.floor(Number(nokQty) || 0)),
    };
    let createdRow: WorkReportDto | null = null;
    const fb = await runWriteAction(
      async () => {
        const r = await createWorkReport(body);
        createdRow = r;
        return r;
      },
      {
        successMessage: "Výkaz byl uložen.",
        errorMessage: "Uložení výkazu se nezdařilo.",
        interpretResult: (r) => {
          const row = r as WorkReportDto;
          const c = (row?.code ?? "").trim();
          return {
            kind: "success" as const,
            message: c ? `Výkaz ${c} byl vytvořen.` : "Výkaz byl vytvořen.",
          };
        },
      }
    );
    setActionFeedback(fb);
    setSaving(false);
    if ((fb.kind === "success" || fb.kind === "info") && createdRow) {
      const code = (createdRow.code ?? "").trim();
      const titleForTab = code ? `Výkaz ${code}` : `Výkaz #${createdRow.id}`;
      window.setTimeout(() => onCreated({ workReportId: createdRow.id, titleForTab }), 750);
    }
  };

  if (!canWrite) {
    return (
      <PageContainer style={{ paddingTop: 10, background: UI.colors.pageBg, minHeight: "100%" }}>
        <div style={UI.pageTitle}>Nový výkaz práce</div>
        <div
          style={{
            ...UI.card,
            marginTop: 12,
            padding: 16,
            borderColor: "#fecaca",
            background: "#fef2f2",
            color: "#991b1b",
            fontWeight: 700,
            fontSize: 13,
          }}
        >
          K vytvoření výkazu potřebujete oprávnění k provedení výroby.
        </div>
        <div style={{ marginTop: 12 }}>
          <button type="button" style={UI.buttons.secondary} onClick={onCancel}>
            Zavřít
          </button>
        </div>
      </PageContainer>
    );
  }

  return (
    <PageContainer style={{ paddingTop: 10, background: UI.colors.pageBg, minHeight: "100%" }}>
      <div style={UI.pageHeaderRow}>
        <div>
          <div style={UI.pageTitle}>Nový výkaz práce</div>
          <div style={UI.sectionSubtitle}>
            Doplňte zapomenutý nebo chybějící výkaz z výroby. Zdroj a časy musí odpovídat skutečnosti.
          </div>
        </div>
      </div>

      <div ref={writeFeedbackAnchorRef} style={{ scrollMarginTop: 8 }}>
        {actionFeedback ? (
          <div style={{ marginTop: 10 }}>
            <InlineBanner kind={actionFeedback.kind} message={actionFeedback.message} onClose={() => setActionFeedback(null)} />
          </div>
        ) : null}
      </div>

      {mastersLoading ? (
        <div style={{ marginTop: 8, fontSize: 13, color: UI.colors.textSecondary }}>Načítám číselníky…</div>
      ) : null}

      <form onSubmit={onSubmit} style={{ marginTop: 12 }}>
        <div style={{ ...UI.card, padding: "12px 14px", maxWidth: 720 }}>
          <div style={{ ...sectionLabel }}>Kontext operace</div>
          <div style={{ display: "grid", gap: 10 }}>
            <div>
              <div style={fieldLabel}>Výrobní příkaz (VP)</div>
              {selectedVp ? (
                <div
                  style={{
                    marginTop: 4,
                    padding: "8px 10px",
                    background: UI.colors.neutralBg,
                    borderRadius: 8,
                    fontSize: 13,
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 8,
                    alignItems: "flex-start",
                  }}
                >
                  <div>
                    <strong>{selectedVp.vp_code}</strong>
                    {selectedVp.gpn ? ` · ${selectedVp.gpn}` : ""}
                  </div>
                  <button
                    type="button"
                    style={{ ...UI.buttons.secondary, flexShrink: 0, fontSize: 11, padding: "4px 10px" }}
                    onClick={() => {
                      setProductionOrderId(null);
                      setVpQuery("");
                    }}
                  >
                    Změnit
                  </button>
                </div>
              ) : (
                <>
                  <input
                    value={vpQuery}
                    onChange={(e) => setVpQuery(e.target.value)}
                    placeholder="Hledat VP…"
                    style={{ ...UI.inputs.base, marginTop: 4 }}
                    autoComplete="off"
                  />
                  <div
                    style={{
                      maxHeight: 200,
                      overflow: "auto",
                      border: `1px solid ${UI.colors.border}`,
                      borderRadius: 8,
                      marginTop: 4,
                    }}
                  >
                    {filteredVps.length === 0 ? (
                      <div style={{ padding: 10, color: UI.colors.textSecondary, fontSize: 13 }}>Žádná shoda.</div>
                    ) : (
                      filteredVps.map((v) => (
                        <button
                          key={v.id}
                          type="button"
                          onClick={() => {
                            setProductionOrderId(v.id);
                            setVpQuery("");
                          }}
                          style={{
                            display: "block",
                            width: "100%",
                            textAlign: "left",
                            padding: "8px 10px",
                            border: "none",
                            borderBottom: `1px solid ${UI.colors.divider}`,
                            background: UI.colors.card,
                            cursor: "pointer",
                            fontSize: 13,
                          }}
                        >
                          <div style={{ fontWeight: 800 }}>{v.vp_code}</div>
                          <div style={{ fontSize: 12, color: UI.colors.textSecondary }}>
                            {v.gpn || "—"} · {(v.description || "").slice(0, 80) || "—"}
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                </>
              )}
            </div>

            <div>
              <div style={fieldLabel}>Plánovaná operace</div>
              {productionOrderId == null ? (
                <div style={{ marginTop: 4, fontSize: 13, color: UI.colors.textSecondary }}>Nejprve zvolte VP.</div>
              ) : opLoading ? (
                <div style={{ marginTop: 4, fontSize: 13, color: UI.colors.textSecondary }}>Načítám operace…</div>
              ) : opError ? (
                <div style={{ marginTop: 4, color: "#b91c1c", fontSize: 13, fontWeight: 600 }}>{opError}</div>
              ) : ops.length === 0 ? (
                <div
                  style={{
                    marginTop: 4,
                    fontSize: 13,
                    color: "#92400e",
                    fontWeight: 600,
                    background: "#fffbeb",
                    border: "1px solid #fcd34d",
                    borderRadius: 8,
                    padding: "8px 10px",
                  }}
                >
                  Pro zvolený VP už všechny operace mají výkaz práce. Duplicitní výkaz nelze vytvořit.
                </div>
              ) : (
                <select
                  value={planningOperationId ?? ""}
                  onChange={(e) => setPlanningOperationId(e.target.value ? Number(e.target.value) : null)}
                  style={{ ...UI.inputs.base, marginTop: 4 }}
                  required
                >
                  <option value="">— zvolte operaci —</option>
                  {ops.map((o) => (
                    <option key={o.planning_operation_id} value={o.planning_operation_id}>
                      {opRowLabel(o)} · {o.machine_name || o.machine_code || `stř. ${o.machine_id}`}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {selectedOp ? (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 8 }}>
                <div>
                  <div style={fieldLabel}>Stav operace (podle plánu)</div>
                  <div style={{ marginTop: 4, padding: "8px 10px", background: UI.colors.neutralBg, borderRadius: 8, fontSize: 13 }}>
                    {labelPlanningStatus(selectedOp.status)}
                  </div>
                </div>
                <div>
                  <div style={fieldLabel}>Pracoviště (z operace)</div>
                  <div
                    style={{ marginTop: 4, padding: "8px 10px", background: UI.colors.neutralBg, borderRadius: 8, fontSize: 13 }}
                    title="Pracoviště se bere z plánované operace; backend ho při uložení naváže sám."
                  >
                    {(selectedOp.workplace_name || "").trim() || "—"}
                  </div>
                </div>
              </div>
            ) : null}

            <div>
              <div style={fieldLabel}>Stroj (runtime)</div>
              <select
                value={machineId ?? ""}
                onChange={(e) => setMachineId(e.target.value ? Number(e.target.value) : null)}
                style={{ ...UI.inputs.base, marginTop: 4 }}
                required
                title="Stroj musí patřit ke stejnému provozu jako operace ve vrstvě plánování."
              >
                <option value="">— zvolte stroj —</option>
                {machineOptions.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name || m.machine_code || `Stroj #${m.id}`}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div style={{ borderTop: `1px solid ${UI.colors.border}`, marginTop: 14, paddingTop: 12 }}>
            <div style={{ ...sectionLabel }}>Zadání výkazu</div>
            <div style={{ display: "grid", gap: 10 }}>
              <div>
                <div style={fieldLabel}>Zaměstnanec (volitelně)</div>
                <select
                  value={employeeId ?? ""}
                  onChange={(e) => setEmployeeId(e.target.value ? Number(e.target.value) : null)}
                  style={{ ...UI.inputs.base, marginTop: 4 }}
                >
                  <option value="">Nezadáno (ruční doplnění bez konkrétní osoby)</option>
                  {employees
                    .filter((e) => e.is_active)
                    .sort((a, b) => a.full_name.localeCompare(b.full_name, "cs"))
                    .map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.full_name} ({e.employee_code})
                      </option>
                    ))}
                </select>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 8, alignItems: "end" }}>
                <label style={{ minWidth: 0 }}>
                  <div style={fieldLabel}>Zahájeno</div>
                  <input
                    type="datetime-local"
                    value={startedAt}
                    onChange={(e) => setStartedAt(e.target.value)}
                    style={{ ...UI.inputs.base, marginTop: 4 }}
                    required
                  />
                </label>
                <label style={{ minWidth: 0 }}>
                  <div style={fieldLabel}>Ukončeno (volitelně)</div>
                  <input
                    type="datetime-local"
                    value={endedAt}
                    onChange={(e) => setEndedAt(e.target.value)}
                    style={{ ...UI.inputs.base, marginTop: 4 }}
                  />
                </label>
              </div>

              <div>
                <div style={fieldLabel}>Trvání (automaticky)</div>
                <div
                  style={{ marginTop: 4, padding: "8px 10px", background: UI.colors.neutralBg, borderRadius: 8, fontSize: 13 }}
                  title="Počítá se z rozdílu mezi zahájením a koncem. Skutečné trvání vč. pauz po uložení spočítá server."
                >
                  {deriveDurationPreview(startedAt, endedAt)}
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 12 }}>
                <label>
                  <div style={fieldLabel}>OK ks</div>
                  <input type="number" min={0} step={1} value={okQty} onChange={(e) => setOkQty(e.target.value)} style={{ ...UI.inputs.base, marginTop: 4 }} />
                </label>
                <label>
                  <div style={fieldLabel}>NOK ks</div>
                  <input type="number" min={0} step={1} value={nokQty} onChange={(e) => setNokQty(e.target.value)} style={{ ...UI.inputs.base, marginTop: 4 }} />
                </label>
              </div>

              <div>
                <div style={fieldLabel}>Zdroj</div>
                <select value={source} onChange={(e) => setSource(e.target.value)} style={{ ...UI.inputs.base, marginTop: 4 }}>
                  {SOURCE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 22, justifyContent: "flex-end" }}>
            <button type="button" style={UI.buttons.secondary} onClick={onCancel} disabled={saving}>
              Zrušit
            </button>
            <button
              type="submit"
              style={{ ...UI.buttons.primary, ...(saving ? { opacity: 0.7, cursor: "wait" } : {}) }}
              disabled={saveDisabled}
            >
              {saving ? "Ukládám…" : "Uložit"}
            </button>
          </div>
        </div>
      </form>
    </PageContainer>
  );
}
