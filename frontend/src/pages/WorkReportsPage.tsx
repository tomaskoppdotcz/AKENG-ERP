import React, { useCallback, useEffect, useMemo, useState } from "react";
import { WORK_REPORT_PAUSE_REASONS } from "../constants/workReportPauseReasons";
import { getEmployeesMaster, type EmployeeMasterRow } from "../services/masterLibrariesApi";
import { getProductionOrdersOverview, type ProductionOrderOverviewRow } from "../services/productionOrdersApi";
import { UI } from "../styles/ui";
import {
  createWorkReport,
  createWorkReportPause,
  deleteWorkReport,
  deleteWorkReportPause,
  fetchPlanningOperationsForVp,
  listWorkReports,
  patchWorkReport,
  patchWorkReportPause,
  resolveProductionOrderForPlanningOperation,
  type WorkReportDto,
  type WorkReportPauseDto,
  type WorkReportPlanningOperationRow,
} from "../services/workReportsApi";

function toDatetimeLocalValue(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromDatetimeLocalValue(v: string): string | null {
  const t = v.trim();
  if (!t) return null;
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function filterVps(orders: ProductionOrderOverviewRow[], q: string): ProductionOrderOverviewRow[] {
  const s = q.trim().toLowerCase();
  if (!s) return orders;
  return orders.filter(
    (v) =>
      (v.vp_code || "").toLowerCase().includes(s) ||
      (v.gpn || "").toLowerCase().includes(s) ||
      (v.description || "").toLowerCase().includes(s) ||
      (v.zakazka || "").toLowerCase().includes(s) ||
      (v.customer_order_no || "").toLowerCase().includes(s)
  );
}

function sortEmployeesForPicker(rows: EmployeeMasterRow[], kioskOnly: boolean): EmployeeMasterRow[] {
  const active = rows.filter((e) => e.is_active);
  const filtered = kioskOnly ? active.filter((e) => e.can_use_kiosk) : active;
  return [...filtered].sort((a, b) => {
    const k = Number(b.can_use_kiosk) - Number(a.can_use_kiosk);
    if (k !== 0) return k;
    return a.full_name.localeCompare(b.full_name, "cs");
  });
}

function VpSearchField({
  label,
  valueId,
  onChangeId,
  query,
  onQueryChange,
  orders,
  disabled,
}: {
  label: string;
  valueId: number | null;
  onChangeId: (id: number | null) => void;
  query: string;
  onQueryChange: (q: string) => void;
  orders: ProductionOrderOverviewRow[];
  disabled?: boolean;
}) {
  const selected = valueId ? orders.find((o) => o.id === valueId) : null;
  const filtered = useMemo(() => filterVps(orders, query).slice(0, 14), [orders, query]);
  return (
    <div>
      <div style={{ fontSize: 12, color: "#64748b", fontWeight: 700 }}>{label}</div>
      {selected ? (
        <div
          style={{
            marginTop: 4,
            padding: "10px 12px",
            background: "#f1f5f9",
            borderRadius: 8,
            fontSize: 13,
            display: "flex",
            justifyContent: "space-between",
            gap: 8,
            alignItems: "flex-start",
          }}
        >
          <div>
            <strong>{selected.vp_code}</strong>
            {selected.gpn ? ` · ${selected.gpn}` : ""}
            <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>
              {(selected.description || "").slice(0, 120) || "—"}
              {selected.zakazka ? ` · Zak.: ${selected.zakazka}` : ""}
              {selected.customer_order_no ? ` · Obj.: ${selected.customer_order_no}` : ""}
            </div>
          </div>
          <button
            type="button"
            style={{ ...UI.buttonSecondary, flexShrink: 0 }}
            onClick={() => onChangeId(null)}
            disabled={disabled}
          >
            Změnit
          </button>
        </div>
      ) : (
        <>
          <input
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            disabled={disabled}
            placeholder="Hledat VP kód, GPN, popis, zakázku, číslo objednávky…"
            style={{ width: "100%", marginTop: 4, padding: 8, borderRadius: 8, border: "1px solid #cbd5e1" }}
          />
          <div
            style={{
              maxHeight: 220,
              overflow: "auto",
              border: "1px solid #e2e8f0",
              borderRadius: 8,
              marginTop: 4,
              background: "#fff",
            }}
          >
            {filtered.length === 0 ? (
              <div style={{ padding: 12, color: "#64748b", fontSize: 13 }}>Žádná shoda.</div>
            ) : (
              filtered.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => {
                    onChangeId(v.id);
                    onQueryChange("");
                  }}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    padding: "10px 12px",
                    border: "none",
                    borderBottom: "1px solid #f1f5f9",
                    background: "#fff",
                    cursor: "pointer",
                  }}
                >
                  <div style={{ fontWeight: 800 }}>{v.vp_code}</div>
                  <div style={{ fontSize: 12, color: "#64748b" }}>
                    {v.gpn || "—"} · {(v.description || "").slice(0, 70) || "—"}
                  </div>
                </button>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}

function EmployeeSearchField({
  label,
  valueId,
  onChangeId,
  query,
  onQueryChange,
  employees,
  kioskOnly,
  onKioskOnlyChange,
  disabled,
}: {
  label: string;
  valueId: number | null;
  onChangeId: (id: number | null) => void;
  query: string;
  onQueryChange: (q: string) => void;
  employees: EmployeeMasterRow[];
  kioskOnly: boolean;
  onKioskOnlyChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  const sorted = useMemo(() => sortEmployeesForPicker(employees, kioskOnly), [employees, kioskOnly]);
  const f = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!f) return sorted;
    return sorted.filter(
      (e) =>
        e.full_name.toLowerCase().includes(f) ||
        e.employee_code.toLowerCase().includes(f) ||
        (e.subgroup_name || "").toLowerCase().includes(f)
    );
  }, [sorted, f]);
  const shown = filtered.slice(0, 20);
  const selected = valueId ? employees.find((e) => e.id === valueId) : null;

  return (
    <div>
      <div style={{ fontSize: 12, color: "#64748b", fontWeight: 700 }}>{label}</div>
      <label
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginTop: 6,
          fontSize: 13,
          color: "#334155",
        }}
      >
        <input
          type="checkbox"
          checked={kioskOnly}
          onChange={(e) => onKioskOnlyChange(e.target.checked)}
          disabled={disabled}
        />
        Jen zaměstnanci s oprávněním kiosk (jinak všichni aktivní; kiosk se řadí nahoru)
      </label>
      {selected ? (
        <div
          style={{
            marginTop: 8,
            padding: "10px 12px",
            background: "#f1f5f9",
            borderRadius: 8,
            fontSize: 13,
            display: "flex",
            justifyContent: "space-between",
            gap: 8,
            alignItems: "center",
          }}
        >
          <div>
            <strong>{selected.full_name}</strong>
            <span style={{ color: "#64748b", marginLeft: 8 }}>{selected.employee_code}</span>
            {selected.can_use_kiosk ? (
              <span style={{ marginLeft: 8, fontSize: 11, color: "#15803d", fontWeight: 700 }}>kiosk</span>
            ) : null}
          </div>
          <button
            type="button"
            style={UI.buttonSecondary}
            onClick={() => onChangeId(null)}
            disabled={disabled}
          >
            Změnit
          </button>
        </div>
      ) : (
        <>
          <input
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            disabled={disabled}
            placeholder="Jméno nebo kód zaměstnance…"
            style={{ width: "100%", marginTop: 4, padding: 8, borderRadius: 8, border: "1px solid #cbd5e1" }}
          />
          <div
            style={{
              maxHeight: 200,
              overflow: "auto",
              border: "1px solid #e2e8f0",
              borderRadius: 8,
              marginTop: 4,
              background: "#fff",
            }}
          >
            {shown.map((e) => (
              <button
                key={e.id}
                type="button"
                onClick={() => {
                  onChangeId(e.id);
                  onQueryChange("");
                }}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: "8px 12px",
                  border: "none",
                  borderBottom: "1px solid #f1f5f9",
                  background: "#fff",
                  cursor: "pointer",
                }}
              >
                <span style={{ fontWeight: 700 }}>{e.full_name}</span>
                <span style={{ color: "#64748b", marginLeft: 8, fontSize: 12 }}>{e.employee_code}</span>
                {e.can_use_kiosk ? (
                  <span style={{ marginLeft: 6, fontSize: 11, color: "#15803d" }}>kiosk</span>
                ) : null}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function OperationSelect({
  ops,
  valueId,
  onChangeId,
  disabled,
  label,
  loading,
}: {
  ops: WorkReportPlanningOperationRow[];
  valueId: number | null;
  onChangeId: (id: number | null) => void;
  disabled?: boolean;
  label: string;
  loading?: boolean;
}) {
  return (
    <label style={{ display: "block" }}>
      <div style={{ fontSize: 12, color: "#64748b", fontWeight: 700 }}>{label}</div>
      <select
        value={valueId ?? ""}
        onChange={(e) => onChangeId(e.target.value ? Number(e.target.value) : null)}
        disabled={disabled || ops.length === 0 || loading}
        style={{ width: "100%", marginTop: 4, padding: 8, borderRadius: 8, border: "1px solid #cbd5e1" }}
      >
        <option value="">
          {loading ? "Načítám operace…" : disabled ? "Nejdřív vyberte výrobní příkaz (VP)" : "Vyberte operaci…"}
        </option>
        {ops.map((o) => (
          <option key={o.planning_operation_id} value={o.planning_operation_id}>
            #{o.operation_no} {o.operation_name} — {o.machine_name || o.machine_code || "?"} [{o.status}]
            {o.workplace_name ? ` @ ${o.workplace_name}` : ""}
          </option>
        ))}
      </select>
      {!loading && ops.length === 0 && !disabled ? (
        <div style={{ fontSize: 12, color: "#b45309", marginTop: 4 }}>
          Pro tento VP nejsou v plánovači žádné operace (zkontrolujte vygenerování operací).
        </div>
      ) : null}
    </label>
  );
}

export default function WorkReportsPage() {
  const [reports, setReports] = useState<WorkReportDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [filterVpId, setFilterVpId] = useState<number | null>(null);
  const [filterVpQuery, setFilterVpQuery] = useState("");
  const [filterOpId, setFilterOpId] = useState("");
  const [filterMachineId, setFilterMachineId] = useState("");
  const [openOnly, setOpenOnly] = useState(false);

  const [vps, setVps] = useState<ProductionOrderOverviewRow[]>([]);
  const [employees, setEmployees] = useState<EmployeeMasterRow[]>([]);
  const [mastersLoading, setMastersLoading] = useState(true);

  const [selected, setSelected] = useState<WorkReportDto | null>(null);
  const [draftStarted, setDraftStarted] = useState("");
  const [draftEnded, setDraftEnded] = useState("");
  const [draftQtyOk, setDraftQtyOk] = useState<string>("");
  const [draftQtyNok, setDraftQtyNok] = useState<string>("");
  const [draftNote, setDraftNote] = useState("");

  const [editorVpId, setEditorVpId] = useState<number | null>(null);
  const [editorVpQuery, setEditorVpQuery] = useState("");
  const [editOps, setEditOps] = useState<WorkReportPlanningOperationRow[]>([]);
  const [editOpsLoading, setEditOpsLoading] = useState(false);
  const [editPlanningOpId, setEditPlanningOpId] = useState<number | null>(null);
  const [editEmployeeId, setEditEmployeeId] = useState<number | null>(null);
  const [editEmpQuery, setEditEmpQuery] = useState("");
  const [editKioskOnly, setEditKioskOnly] = useState(false);

  const [newVpId, setNewVpId] = useState<number | null>(null);
  const [newVpQuery, setNewVpQuery] = useState("");
  const [newOps, setNewOps] = useState<WorkReportPlanningOperationRow[]>([]);
  const [newOpsLoading, setNewOpsLoading] = useState(false);
  const [newPlanningOpId, setNewPlanningOpId] = useState<number | null>(null);
  const [newEmployeeId, setNewEmployeeId] = useState<number | null>(null);
  const [newEmpQuery, setNewEmpQuery] = useState("");
  const [newKioskOnly, setNewKioskOnly] = useState(false);
  const [newStarted, setNewStarted] = useState("");
  const [newEnded, setNewEnded] = useState("");
  const [newQtyOk, setNewQtyOk] = useState("0");
  const [newQtyNok, setNewQtyNok] = useState("0");
  const [newNote, setNewNote] = useState("");
  const [newUseAsCompletion, setNewUseAsCompletion] = useState(false);

  const [pauseStart, setPauseStart] = useState("");
  const [pauseEnd, setPauseEnd] = useState("");
  const [pauseReason, setPauseReason] = useState(WORK_REPORT_PAUSE_REASONS[0]);
  const [pauseNote, setPauseNote] = useState("");

  useEffect(() => {
    let c = false;
    (async () => {
      setMastersLoading(true);
      try {
        const [vpRows, empRows] = await Promise.all([
          getProductionOrdersOverview("all"),
          getEmployeesMaster("active"),
        ]);
        if (!c) {
          setVps(vpRows);
          setEmployees(empRows);
        }
      } catch {
        if (!c) setError("Nepodařilo se načíst výrobní příkazy nebo zaměstnance.");
      } finally {
        if (!c) setMastersLoading(false);
      }
    })();
    return () => {
      c = true;
    };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const list = await listWorkReports({
        productionOrderId: filterVpId ?? undefined,
        planningOperationId: filterOpId.trim() ? Number(filterOpId) : undefined,
        machineId: filterMachineId.trim() ? Number(filterMachineId) : undefined,
        openOnly,
        limit: 300,
      });
      setReports(list);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Nelze načíst výkazy.");
      setReports([]);
    } finally {
      setLoading(false);
    }
  }, [filterVpId, filterOpId, filterMachineId, openOnly]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!selected) {
      setEditorVpId(null);
      setEditOps([]);
      setEditPlanningOpId(null);
      setEditEmployeeId(null);
      return;
    }
    let c = false;
    (async () => {
      try {
        let poId = selected.production_order_id;
        if (!poId) {
          const r = await resolveProductionOrderForPlanningOperation(selected.planning_operation_id);
          poId = r.production_order_id;
        }
        if (c) return;
        setEditorVpId(poId ?? null);
        setEditPlanningOpId(selected.planning_operation_id);
        setEditEmployeeId(selected.employee_id ?? null);
      } catch {
        if (!c) setError("Nelze dohledat výrobní příkaz pro tento výkaz.");
      }
    })();
    return () => {
      c = true;
    };
  }, [selected?.id]);

  useEffect(() => {
    if (!editorVpId) {
      setEditOps([]);
      return;
    }
    let c = false;
    setEditOpsLoading(true);
    fetchPlanningOperationsForVp(editorVpId)
      .then((ctx) => {
        if (!c) setEditOps(ctx.operations);
      })
      .catch(() => {
        if (!c) setError("Nepodařilo se načíst operace VP.");
      })
      .finally(() => {
        if (!c) setEditOpsLoading(false);
      });
    return () => {
      c = true;
    };
  }, [editorVpId]);

  useEffect(() => {
    if (editPlanningOpId == null || editOps.length === 0) return;
    if (!editOps.some((o) => o.planning_operation_id === editPlanningOpId)) {
      setEditPlanningOpId(null);
    }
  }, [editOps, editPlanningOpId]);

  useEffect(() => {
    if (!newVpId) {
      setNewOps([]);
      setNewPlanningOpId(null);
      return;
    }
    let c = false;
    setNewOpsLoading(true);
    fetchPlanningOperationsForVp(newVpId)
      .then((ctx) => {
        if (!c) setNewOps(ctx.operations);
      })
      .catch(() => {
        if (!c) setError("Nepodařilo se načíst operace pro nový výkaz.");
      })
      .finally(() => {
        if (!c) setNewOpsLoading(false);
      });
    return () => {
      c = true;
    };
  }, [newVpId]);

  useEffect(() => {
    if (newPlanningOpId == null || newOps.length === 0) return;
    if (!newOps.some((o) => o.planning_operation_id === newPlanningOpId)) {
      setNewPlanningOpId(null);
    }
  }, [newOps, newPlanningOpId]);

  function syncDraftFromRow(r: WorkReportDto) {
    setSelected(r);
    setDraftStarted(toDatetimeLocalValue(r.started_at));
    setDraftEnded(toDatetimeLocalValue(r.ended_at));
    setDraftQtyOk(r.qty_ok != null ? String(r.qty_ok) : "");
    setDraftQtyNok(r.qty_nok != null ? String(r.qty_nok) : "");
    setDraftNote(r.note || "");
  }

  async function saveSelected() {
    if (!selected) return;
    const op = editOps.find((o) => o.planning_operation_id === editPlanningOpId);
    if (!op || editPlanningOpId == null) {
      setError("Uložení: vyberte operaci odpovídající zvolenému VP.");
      return;
    }
    try {
      setError("");
      const started = fromDatetimeLocalValue(draftStarted);
      if (!started) {
        setError("Vyplňte začátek (platné datum).");
        return;
      }
      const emp = editEmployeeId != null ? employees.find((e) => e.id === editEmployeeId) : null;
      const patch: Parameters<typeof patchWorkReport>[1] = {
        started_at: started,
        ended_at: fromDatetimeLocalValue(draftEnded),
        note: draftNote.trim() || null,
        qty_ok: draftQtyOk.trim() === "" ? null : Number(draftQtyOk),
        qty_nok: draftQtyNok.trim() === "" ? null : Number(draftQtyNok),
        operator_display: emp?.full_name ?? null,
        employee_id: editEmployeeId,
        machine_id: op.machine_id,
        planning_operation_id: editPlanningOpId,
      };
      const updated = await patchWorkReport(selected.id, patch);
      syncDraftFromRow(updated);
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Uložení selhalo.");
    }
  }

  async function removeSelected() {
    if (!selected || !window.confirm("Smazat výkaz?")) return;
    try {
      setError("");
      await deleteWorkReport(selected.id);
      setSelected(null);
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Smazání selhalo.");
    }
  }

  async function addPause() {
    if (!selected) return;
    const ps = fromDatetimeLocalValue(pauseStart);
    if (!ps) {
      setError("Vyplňte začátek pauzy.");
      return;
    }
    try {
      setError("");
      await createWorkReportPause(selected.id, {
        pause_start: ps,
        pause_end: fromDatetimeLocalValue(pauseEnd),
        pause_reason: pauseReason,
        note: pauseNote.trim() || null,
      });
      const list = await listWorkReports({ planningOperationId: selected.planning_operation_id, limit: 50 });
      const hit = list.find((x) => x.id === selected.id);
      if (hit) syncDraftFromRow(hit);
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Pauzu se nepodařilo přidat.");
    }
  }

  async function savePause(p: WorkReportPauseDto) {
    if (!selected) return;
    const ps = typeof p.pause_start === "string" ? p.pause_start : null;
    if (!ps) {
      setError("Neplatný začátek pauzy.");
      return;
    }
    try {
      setError("");
      await patchWorkReportPause(selected.id, p.id, {
        pause_start: ps,
        pause_end: p.pause_end,
        pause_reason: p.pause_reason,
        note: p.note,
      });
      const list = await listWorkReports({ planningOperationId: selected.planning_operation_id, limit: 50 });
      const hit = list.find((x) => x.id === selected.id);
      if (hit) syncDraftFromRow(hit);
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Úprava pauzy selhala.");
    }
  }

  async function removePause(pauseId: number) {
    if (!selected || !window.confirm("Smazat tuto pauzu?")) return;
    try {
      setError("");
      await deleteWorkReportPause(selected.id, pauseId);
      const list = await listWorkReports({ planningOperationId: selected.planning_operation_id, limit: 50 });
      const hit = list.find((x) => x.id === selected.id);
      if (hit) syncDraftFromRow(hit);
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Smazání pauzy selhalo.");
    }
  }

  async function createNew() {
    const op = newOps.find((o) => o.planning_operation_id === newPlanningOpId);
    if (!newVpId || !op || newPlanningOpId == null) {
      setError("Nový výkaz: vyberte VP, operaci a vyplňte začátek.");
      return;
    }
    const st = fromDatetimeLocalValue(newStarted);
    if (!st) {
      setError("Vyplňte platný začátek výkazu.");
      return;
    }
    const endedIso = fromDatetimeLocalValue(newEnded);
    if (newUseAsCompletion && !endedIso) {
      setError("Pro dokončení operace vyplňte také konec výkazu.");
      return;
    }
    try {
      setError("");
      const emp = newEmployeeId != null ? employees.find((e) => e.id === newEmployeeId) : null;
      await createWorkReport({
        planning_operation_id: op.planning_operation_id,
        machine_id: op.machine_id,
        started_at: st,
        ended_at: endedIso,
        employee_id: newEmployeeId,
        operator_display: emp?.full_name ?? null,
        qty_ok: newQtyOk.trim() === "" ? null : Number(newQtyOk),
        qty_nok: newQtyNok.trim() === "" ? null : Number(newQtyNok),
        note: newNote.trim() || null,
        source: "manual",
        use_as_completion: Boolean(newUseAsCompletion),
      });
      setNewVpId(null);
      setNewPlanningOpId(null);
      setNewEmployeeId(null);
      setNewStarted("");
      setNewEnded("");
      setNewQtyOk("0");
      setNewQtyNok("0");
      setNewNote("");
      setNewUseAsCompletion(false);
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Založení výkazu selhalo.");
    }
  }

  const selectedOpSummary =
    selected && editPlanningOpId
      ? editOps.find((o) => o.planning_operation_id === editPlanningOpId)
      : null;

  return (
    <div style={UI.pageContainer}>
      <div style={UI.pageHeaderRow}>
        <div>
          <div style={UI.pageTitle}>Výkazy práce</div>
          <div style={UI.sectionSubtitle}>
            Ruční doplnění a opravy — výběr VP, operace z plánovače a zaměstnance ze kmenových dat. Agregace zakázek
            zatím ne.
          </div>
        </div>
        <button type="button" style={UI.buttonSecondary} onClick={() => void load()} disabled={loading}>
          Obnovit
        </button>
      </div>

      {mastersLoading ? (
        <div style={{ marginTop: 8, fontSize: 13, color: "#64748b" }}>Načítám seznamy VP a zaměstnanců…</div>
      ) : null}

      {error ? (
        <div style={{ ...UI.card, marginTop: 12, borderColor: "#fecaca", background: "#fef2f2", color: "#b91c1c" }}>
          {error}
        </div>
      ) : null}

      <div style={{ ...UI.card, marginTop: UI.pageSection.marginTop, display: "grid", gap: 12 }}>
        <div style={{ fontWeight: 800 }}>Filtry seznamu</div>
        <VpSearchField
          label="Výrobní příkaz (VP) — volitelně omezit tabulku"
          valueId={filterVpId}
          onChangeId={setFilterVpId}
          query={filterVpQuery}
          onQueryChange={setFilterVpQuery}
          orders={vps}
        />
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ fontSize: 13, color: "#64748b" }}>Planning op id (pokročilé)</span>
            <input
              value={filterOpId}
              onChange={(e) => setFilterOpId(e.target.value)}
              style={{ width: 120, padding: 8, borderRadius: 8, border: "1px solid #cbd5e1" }}
            />
          </label>
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ fontSize: 13, color: "#64748b" }}>Machine id (pokročilé)</span>
            <input
              value={filterMachineId}
              onChange={(e) => setFilterMachineId(e.target.value)}
              style={{ width: 120, padding: 8, borderRadius: 8, border: "1px solid #cbd5e1" }}
            />
          </label>
          <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
            <input type="checkbox" checked={openOnly} onChange={(e) => setOpenOnly(e.target.checked)} />
            Jen otevřené výkazy
          </label>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.2fr) minmax(0, 1fr)", gap: 16, marginTop: 16 }}>
        <div style={{ ...UI.card, minWidth: 0 }}>
          <div style={{ fontWeight: 900, marginBottom: 10 }}>Seznam</div>
          {loading ? <div style={{ color: "#64748b" }}>Načítám…</div> : null}
          <div style={{ maxHeight: "62vh", overflow: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: "left", color: "#64748b" }}>
                  <th style={{ padding: "6px 4px" }}>Id</th>
                  <th style={{ padding: "6px 4px" }}>VP</th>
                  <th style={{ padding: "6px 4px" }}>Op</th>
                  <th style={{ padding: "6px 4px" }}>Stroj</th>
                  <th style={{ padding: "6px 4px" }}>Od</th>
                  <th style={{ padding: "6px 4px" }}>Do</th>
                  <th style={{ padding: "6px 4px" }}>Min</th>
                  <th style={{ padding: "6px 4px" }}>Zdroj</th>
                </tr>
              </thead>
              <tbody>
                {reports.map((r) => (
                  <tr
                    key={r.id}
                    onClick={() => syncDraftFromRow(r)}
                    style={{
                      cursor: "pointer",
                      background: selected?.id === r.id ? "#eff6ff" : "transparent",
                      borderTop: "1px solid #e2e8f0",
                    }}
                  >
                    <td style={{ padding: "8px 4px", fontWeight: 800 }}>{r.id}</td>
                    <td style={{ padding: "8px 4px" }}>
                      {r.production_order_id != null
                        ? vps.find((v) => v.id === r.production_order_id)?.vp_code || `#${r.production_order_id}`
                        : "—"}
                    </td>
                    <td style={{ padding: "8px 4px" }}>
                      #{r.operation_no} {r.operation_name}
                    </td>
                    <td style={{ padding: "8px 4px" }}>{r.machine_id}</td>
                    <td style={{ padding: "8px 4px", whiteSpace: "nowrap" }}>
                      {r.started_at ? new Date(r.started_at).toLocaleString("cs-CZ") : "—"}
                    </td>
                    <td style={{ padding: "8px 4px", whiteSpace: "nowrap" }}>
                      {r.ended_at ? new Date(r.ended_at).toLocaleString("cs-CZ") : "—"}
                    </td>
                    <td style={{ padding: "8px 4px" }}>{r.duration_min != null ? Math.round(r.duration_min) : "—"}</td>
                    <td style={{ padding: "8px 4px" }}>{r.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div style={{ ...UI.card, minWidth: 0 }}>
          <div style={{ fontWeight: 900, marginBottom: 10 }}>Detail / úprava</div>
          {!selected ? (
            <div style={{ color: "#64748b" }}>Vyberte řádek v seznamu.</div>
          ) : (
            <div style={{ display: "grid", gap: 12, fontSize: 14 }}>
              <div style={{ fontSize: 12, color: "#64748b", lineHeight: 1.4 }}>
                Výkaz #{selected.id} · zdroj {selected.source}
                {selectedOpSummary ? (
                  <>
                    <br />
                    Operace v plánovači: #{selectedOpSummary.operation_no} {selectedOpSummary.operation_name} · stroj{" "}
                    {selectedOpSummary.machine_name || selectedOpSummary.machine_code}
                  </>
                ) : null}
              </div>

              <VpSearchField
                label="1) Výrobní příkaz (VP)"
                valueId={editorVpId}
                onChangeId={(id) => {
                  setEditorVpId(id);
                  if (id == null) setEditPlanningOpId(null);
                }}
                query={editorVpQuery}
                onQueryChange={setEditorVpQuery}
                orders={vps}
              />
              <OperationSelect
                label="2) Operace (z plánovače pro tento VP)"
                ops={editOps}
                valueId={editPlanningOpId}
                onChangeId={setEditPlanningOpId}
                disabled={!editorVpId}
                loading={editOpsLoading}
              />
              <EmployeeSearchField
                label="3) Zaměstnanec"
                valueId={editEmployeeId}
                onChangeId={setEditEmployeeId}
                query={editEmpQuery}
                onQueryChange={setEditEmpQuery}
                employees={employees}
                kioskOnly={editKioskOnly}
                onKioskOnlyChange={setEditKioskOnly}
              />

              <div
                style={{
                  fontSize: 11,
                  color: "#64748b",
                  padding: "8px 10px",
                  background: "#f8fafc",
                  borderRadius: 8,
                  lineHeight: 1.45,
                }}
              >
                Propojení do databáze se dopočítá z volby operace:{" "}
                <strong>planning_operation_id</strong>, <strong>machine_id</strong>, vazby na VP / zakázku uloží
                backend při uložení.
              </div>

              <label>
                <div style={{ fontSize: 12, color: "#64748b" }}>4) Začátek výkazu</div>
                <input
                  type="datetime-local"
                  value={draftStarted}
                  onChange={(e) => setDraftStarted(e.target.value)}
                  style={{ width: "100%", padding: 8, borderRadius: 8, border: "1px solid #cbd5e1" }}
                />
              </label>
              <label>
                <div style={{ fontSize: 12, color: "#64748b" }}>Konec</div>
                <input
                  type="datetime-local"
                  value={draftEnded}
                  onChange={(e) => setDraftEnded(e.target.value)}
                  style={{ width: "100%", padding: 8, borderRadius: 8, border: "1px solid #cbd5e1" }}
                />
              </label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <label>
                  <div style={{ fontSize: 12, color: "#64748b" }}>Qty OK</div>
                  <input
                    value={draftQtyOk}
                    onChange={(e) => setDraftQtyOk(e.target.value)}
                    style={{ width: "100%", padding: 8, borderRadius: 8, border: "1px solid #cbd5e1" }}
                  />
                </label>
                <label>
                  <div style={{ fontSize: 12, color: "#64748b" }}>Qty NOK</div>
                  <input
                    value={draftQtyNok}
                    onChange={(e) => setDraftQtyNok(e.target.value)}
                    style={{ width: "100%", padding: 8, borderRadius: 8, border: "1px solid #cbd5e1" }}
                  />
                </label>
              </div>
              <label>
                <div style={{ fontSize: 12, color: "#64748b" }}>Poznámka</div>
                <textarea
                  value={draftNote}
                  onChange={(e) => setDraftNote(e.target.value)}
                  rows={3}
                  style={{ width: "100%", padding: 8, borderRadius: 8, border: "1px solid #cbd5e1" }}
                />
              </label>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button type="button" style={UI.buttonPrimary} onClick={() => void saveSelected()}>
                  Uložit výkaz
                </button>
                <button
                  type="button"
                  style={{
                    background: "#b91c1c",
                    color: "#fff",
                    border: "none",
                    borderRadius: 10,
                    padding: "10px 14px",
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                  onClick={() => void removeSelected()}
                >
                  Smazat výkaz
                </button>
              </div>

              <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid #e2e8f0" }}>
                <div style={{ fontWeight: 800, marginBottom: 8 }}>Pauzy</div>
                {selected.pauses.map((p) => (
                  <PauseRow
                    key={p.id}
                    p={p}
                    onSave={(row) => void savePause(row)}
                    onDelete={() => void removePause(p.id)}
                  />
                ))}
                <div style={{ marginTop: 10, fontSize: 12, color: "#64748b" }}>Nová pauza</div>
                <div style={{ display: "grid", gap: 8, marginTop: 6 }}>
                  <input
                    type="datetime-local"
                    value={pauseStart}
                    onChange={(e) => setPauseStart(e.target.value)}
                    style={{ padding: 8, borderRadius: 8, border: "1px solid #cbd5e1" }}
                  />
                  <input
                    type="datetime-local"
                    value={pauseEnd}
                    onChange={(e) => setPauseEnd(e.target.value)}
                    style={{ padding: 8, borderRadius: 8, border: "1px solid #cbd5e1" }}
                  />
                  <select
                    value={pauseReason}
                    onChange={(e) => setPauseReason(e.target.value)}
                    style={{ padding: 8, borderRadius: 8, border: "1px solid #cbd5e1" }}
                  >
                    {WORK_REPORT_PAUSE_REASONS.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                  <input
                    placeholder="poznámka pauzy"
                    value={pauseNote}
                    onChange={(e) => setPauseNote(e.target.value)}
                    style={{ padding: 8, borderRadius: 8, border: "1px solid #cbd5e1" }}
                  />
                  <button type="button" style={UI.buttonSecondary} onClick={() => void addPause()}>
                    Přidat pauzu
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div style={{ ...UI.card, marginTop: 16 }}>
        <div style={{ fontWeight: 900, marginBottom: 10 }}>Nový výkaz (ručně)</div>
        <div style={{ display: "grid", gap: 14 }}>
          <VpSearchField
            label="1) Výrobní příkaz (VP)"
            valueId={newVpId}
            onChangeId={(id) => {
              setNewVpId(id);
              if (id == null) setNewPlanningOpId(null);
            }}
            query={newVpQuery}
            onQueryChange={setNewVpQuery}
            orders={vps}
            disabled={mastersLoading}
          />
          <OperationSelect
            label="2) Operace"
            ops={newOps}
            valueId={newPlanningOpId}
            onChangeId={setNewPlanningOpId}
            disabled={!newVpId}
            loading={newOpsLoading}
          />
          <EmployeeSearchField
            label="3) Zaměstnanec"
            valueId={newEmployeeId}
            onChangeId={setNewEmployeeId}
            query={newEmpQuery}
            onQueryChange={setNewEmpQuery}
            employees={employees}
            kioskOnly={newKioskOnly}
            onKioskOnlyChange={setNewKioskOnly}
            disabled={mastersLoading}
          />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <label>
              <div style={{ fontSize: 12, color: "#64748b" }}>4) Začátek</div>
              <input
                type="datetime-local"
                value={newStarted}
                onChange={(e) => setNewStarted(e.target.value)}
                style={{ width: "100%", padding: 8, borderRadius: 8, border: "1px solid #cbd5e1" }}
              />
            </label>
            <label>
              <div style={{ fontSize: 12, color: "#64748b" }}>Konec</div>
              <input
                type="datetime-local"
                value={newEnded}
                onChange={(e) => setNewEnded(e.target.value)}
                style={{ width: "100%", padding: 8, borderRadius: 8, border: "1px solid #cbd5e1" }}
              />
            </label>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <label>
              <div style={{ fontSize: 12, color: "#64748b" }}>Qty OK</div>
              <input
                value={newQtyOk}
                onChange={(e) => setNewQtyOk(e.target.value)}
                style={{ width: "100%", padding: 8, borderRadius: 8, border: "1px solid #cbd5e1" }}
              />
            </label>
            <label>
              <div style={{ fontSize: 12, color: "#64748b" }}>Qty NOK</div>
              <input
                value={newQtyNok}
                onChange={(e) => setNewQtyNok(e.target.value)}
                style={{ width: "100%", padding: 8, borderRadius: 8, border: "1px solid #cbd5e1" }}
              />
            </label>
          </div>
          <label>
            <div style={{ fontSize: 12, color: "#64748b" }}>Poznámka</div>
            <textarea
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              rows={2}
              style={{ width: "100%", padding: 8, borderRadius: 8, border: "1px solid #cbd5e1" }}
            />
          </label>
          <label
            style={{
              display: "grid",
              gap: 4,
              padding: "8px 10px",
              border: "1px solid #e2e8f0",
              borderRadius: 8,
              background: "#f8fafc",
            }}
          >
            <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 700 }}>
              <input
                type="checkbox"
                checked={newUseAsCompletion}
                onChange={(e) => setNewUseAsCompletion(e.target.checked)}
                disabled={newPlanningOpId == null}
              />
              Použít jako dokončení operace
            </span>
            <span style={{ fontSize: 12, color: "#64748b" }}>
              Použije výkaz jako náhradu za tlačítko HOTOVO v kiosku.
            </span>
          </label>
          <button type="button" style={UI.buttonPrimary} onClick={() => void createNew()}>
            Založit výkaz
          </button>
        </div>
      </div>
    </div>
  );
}

function PauseRow({
  p,
  onSave,
  onDelete,
}: {
  p: WorkReportPauseDto;
  onSave: (p: WorkReportPauseDto) => void;
  onDelete: () => void;
}) {
  const [start, setStart] = useState(toDatetimeLocalValue(p.pause_start));
  const [end, setEnd] = useState(toDatetimeLocalValue(p.pause_end));
  const [reason, setReason] = useState(p.pause_reason);
  const [note, setNote] = useState(p.note || "");

  useEffect(() => {
    setStart(toDatetimeLocalValue(p.pause_start));
    setEnd(toDatetimeLocalValue(p.pause_end));
    setReason(p.pause_reason);
    setNote(p.note || "");
  }, [p.id, p.pause_start, p.pause_end, p.pause_reason, p.note]);

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr minmax(120px, 1fr) 1fr auto auto",
        gap: 6,
        alignItems: "center",
        marginBottom: 8,
        fontSize: 12,
      }}
    >
      <input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} style={{ padding: 6 }} />
      <input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} style={{ padding: 6 }} />
      <select value={reason} onChange={(e) => setReason(e.target.value)} style={{ padding: 6 }}>
        {WORK_REPORT_PAUSE_REASONS.map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </select>
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="pozn." style={{ padding: 6 }} />
      <button
        type="button"
        style={UI.buttonSecondary}
        onClick={() =>
          onSave({
            ...p,
            pause_start: fromDatetimeLocalValue(start) || (p.pause_start as string),
            pause_end: fromDatetimeLocalValue(end),
            pause_reason: reason,
            note: note.trim() || null,
          })
        }
      >
        Uložit
      </button>
      <button
        type="button"
        style={{
          background: "#b91c1c",
          color: "#fff",
          border: "none",
          borderRadius: 8,
          padding: "6px 10px",
          fontWeight: 800,
          cursor: "pointer",
        }}
        onClick={onDelete}
      >
        ×
      </button>
    </div>
  );
}
