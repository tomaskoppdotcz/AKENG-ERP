import React, { useCallback, useEffect, useMemo, useState } from "react";
import PageContainer from "../components/layout/PageContainer";
import PageHeader from "../components/layout/PageHeader";
import PageSection from "../components/layout/PageSection";
import { UI } from "../styles/ui";
import {
  getMachineShiftTemplates,
  regenerateMachineCalendarFromShifts,
  rebuildPlanningAll,
  upsertMachineShiftTemplate,
} from "../services/plannerApi";
import { getWorkplaceLibraryItems, type WorkplaceLibraryItem } from "../services/masterLibrariesApi";
import { canPerformAction, readStoredErpRole } from "../auth/rbac";

const WEEKDAYS: { weekday: number; label: string }[] = [
  { weekday: 0, label: "Pondělí" },
  { weekday: 1, label: "Úterý" },
  { weekday: 2, label: "Středa" },
  { weekday: 3, label: "Čtvrtek" },
  { weekday: 4, label: "Pátek" },
  { weekday: 5, label: "Sobota" },
  { weekday: 6, label: "Neděle" },
];

function workplaceOptionLabel(w: WorkplaceLibraryItem): string {
  const n = (w.name || "").trim();
  const c = (w.code || "").trim();
  if (n && c) return `${n} (${c})`;
  return n || c || `#${w.id}`;
}

type DayRowState = {
  weekday: number;
  isActive: boolean;
  startTime: string;
  endTime: string;
  label: string;
};

function minutesToTime(m: number): string {
  const h = Math.floor(m / 60);
  const min = m % 60;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

function parseTimeToMinutes(s: string): number | null {
  const t = s.trim();
  const m = /^(\d{1,2}):(\d{2})$/.exec(t);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min) || h > 23 || min > 59) return null;
  return h * 60 + min;
}

function defaultDayRows(): DayRowState[] {
  return WEEKDAYS.map((w) => ({
    weekday: w.weekday,
    isActive: w.weekday < 5,
    startTime: "06:00",
    endTime: "13:30",
    label: "",
  }));
}

export default function WorkplaceShiftsPage() {
  const erpRole = useMemo(() => readStoredErpRole(), []);
  const canWrite = canPerformAction(erpRole, "planning.write");

  const [workplaces, setWorkplaces] = useState<WorkplaceLibraryItem[]>([]);
  const [selectedWorkplaceId, setSelectedWorkplaceId] = useState<number | null>(null);
  const [rows, setRows] = useState<DayRowState[]>(() => defaultDayRows());
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const loadWorkplaces = useCallback(async () => {
    const data = await getWorkplaceLibraryItems();
    const sorted = [...data].sort((a, b) =>
      workplaceOptionLabel(a).localeCompare(workplaceOptionLabel(b), "cs")
    );
    setWorkplaces(sorted);
    setSelectedWorkplaceId((prev) => {
      if (sorted.length === 0) return null;
      if (prev != null && sorted.some((x) => x.id === prev)) return prev;
      return sorted[0].id;
    });
  }, []);

  useEffect(() => {
    void loadWorkplaces();
  }, [loadWorkplaces]);

  const loadTemplates = useCallback(async (workplaceId: number) => {
    setLoading(true);
    setMessage("");
    try {
      const tpl = await getMachineShiftTemplates({ workplaceLibraryItemId: workplaceId });
      const byWd = new Map(tpl.map((t) => [t.weekday, t]));
      setRows(
        WEEKDAYS.map((w) => {
          const t = byWd.get(w.weekday);
          if (!t) {
            return {
              weekday: w.weekday,
              isActive: w.weekday < 5,
              startTime: "06:00",
              endTime: "13:30",
              label: "",
            };
          }
          return {
            weekday: w.weekday,
            isActive: t.is_active,
            startTime: minutesToTime(t.start_minutes),
            endTime: minutesToTime(t.end_minutes),
            label: t.label ?? "",
          };
        })
      );
    } catch (e: any) {
      setMessage(e?.message || "Nepodařilo se načíst šablony.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedWorkplaceId != null) void loadTemplates(selectedWorkplaceId);
  }, [selectedWorkplaceId, loadTemplates]);

  function updateRow(weekday: number, patch: Partial<DayRowState>) {
    setRows((prev) => prev.map((r) => (r.weekday === weekday ? { ...r, ...patch } : r)));
  }

  async function handleSave() {
    if (!canWrite || selectedWorkplaceId == null) return;
    setLoading(true);
    setMessage("");
    try {
      for (const r of rows) {
        const sm = parseTimeToMinutes(r.startTime);
        const em = parseTimeToMinutes(r.endTime);
        if (sm === null || em === null) {
          setMessage("Neplatný čas (očekává se HH:MM).");
          setLoading(false);
          return;
        }
        if (r.isActive && em <= sm) {
          setMessage("U aktivního dne musí být konec po začátku.");
          setLoading(false);
          return;
        }
        await upsertMachineShiftTemplate({
          workplaceLibraryItemId: selectedWorkplaceId,
          weekday: r.weekday,
          startMinutes: sm,
          endMinutes: r.isActive ? em : sm + 1,
          label: r.label.trim() || null,
          isActive: r.isActive,
        });
      }
      setMessage("Směny uloženy.");
      await loadTemplates(selectedWorkplaceId);
    } catch (e: any) {
      setMessage(e?.message || "Uložení se nezdařilo.");
    } finally {
      setLoading(false);
    }
  }

  async function handleRegenerate() {
    if (!canWrite || selectedWorkplaceId == null) return;
    setLoading(true);
    setMessage("");
    try {
      const t = new Date();
      const from = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
      const end = new Date(t);
      end.setDate(end.getDate() + 365);
      const to = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, "0")}-${String(end.getDate()).padStart(2, "0")}`;
      await regenerateMachineCalendarFromShifts({
        fromDate: from,
        toDate: to,
        workplaceLibraryItemId: selectedWorkplaceId,
      });
      setMessage("Kalendář kapacity přegenerován.");
    } catch (e: any) {
      setMessage(e?.message || "Přegenerování se nezdařilo.");
    } finally {
      setLoading(false);
    }
  }

  async function handleRebuild() {
    if (!canWrite) return;
    setLoading(true);
    setMessage("");
    try {
      await rebuildPlanningAll();
      setMessage("Plán přepočítán.");
    } catch (e: any) {
      setMessage(e?.message || "Přepočet se nezdařil.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <PageContainer style={{ paddingTop: 10 }}>
      <PageHeader
        title="Směny pracovišť"
        subtitle="Dostupnost kapacity podle dne v týdnu pro záznamy z knihovny Pracoviště. Šablony jsou vázané na pracoviště; do kalendáře plánovače se promítnou u všech strojů daného pracoviště."
      />

      <PageSection>
        <div style={{ ...UI.card, maxWidth: 920 }}>
          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 13, fontWeight: 800, color: "#334155", display: "block", marginBottom: 6 }}>
              Pracoviště
            </label>
            <select
              value={selectedWorkplaceId ?? ""}
              onChange={(e) => setSelectedWorkplaceId(e.target.value ? Number(e.target.value) : null)}
              disabled={loading || workplaces.length === 0}
              style={{
                minWidth: 280,
                border: "1px solid #cbd5e1",
                borderRadius: 10,
                padding: "10px 12px",
                fontSize: 14,
                background: "#fff",
              }}
            >
              {workplaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {workplaceOptionLabel(w)}
                </option>
              ))}
            </select>
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 16 }}>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={!canWrite || loading || selectedWorkplaceId == null}
              style={{
                border: "1px solid #0f172a",
                background: "#0f172a",
                color: "#fff",
                borderRadius: 10,
                padding: "10px 16px",
                fontWeight: 800,
                cursor: canWrite && !loading ? "pointer" : "default",
                opacity: !canWrite || loading ? 0.55 : 1,
              }}
            >
              Uložit směny
            </button>
            <button
              type="button"
              onClick={() => void handleRegenerate()}
              disabled={!canWrite || loading || selectedWorkplaceId == null}
              style={{
                border: "1px solid #b45309",
                background: "#fffbeb",
                color: "#92400e",
                borderRadius: 10,
                padding: "10px 16px",
                fontWeight: 800,
                cursor: canWrite && !loading ? "pointer" : "default",
                opacity: !canWrite || loading ? 0.55 : 1,
              }}
            >
              Přegenerovat kalendář
            </button>
            <button
              type="button"
              onClick={() => void handleRebuild()}
              disabled={!canWrite || loading}
              style={{
                border: "1px solid #1d4ed8",
                background: "#eff6ff",
                color: "#1e40af",
                borderRadius: 10,
                padding: "10px 16px",
                fontWeight: 800,
                cursor: canWrite && !loading ? "pointer" : "default",
                opacity: !canWrite || loading ? 0.55 : 1,
              }}
            >
              Přepočítat plán
            </button>
          </div>

          {message ? (
            <div
              style={{
                marginBottom: 14,
                fontSize: 14,
                fontWeight: 700,
                color: message.includes("Neplat") || message.includes("nezdař") ? "#b91c1c" : "#15803d",
              }}
            >
              {message}
            </div>
          ) : null}

          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #e2e8f0", textAlign: "left" }}>
                  <th style={{ padding: "8px 6px", width: 36 }}>Akt.</th>
                  <th style={{ padding: "8px 6px", minWidth: 100 }}>Den</th>
                  <th style={{ padding: "8px 6px" }}>Od</th>
                  <th style={{ padding: "8px 6px" }}>Do</th>
                  <th style={{ padding: "8px 6px", minWidth: 160 }}>Popisek</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const wd = WEEKDAYS.find((w) => w.weekday === r.weekday)?.label ?? "";
                  return (
                    <tr key={r.weekday} style={{ borderBottom: "1px solid #f1f5f9" }}>
                      <td style={{ padding: "8px 6px", verticalAlign: "middle" }}>
                        <input
                          type="checkbox"
                          checked={r.isActive}
                          onChange={(e) => updateRow(r.weekday, { isActive: e.target.checked })}
                          disabled={loading}
                        />
                      </td>
                      <td style={{ padding: "8px 6px", fontWeight: 700, color: "#0f172a" }}>{wd}</td>
                      <td style={{ padding: "8px 6px" }}>
                        <input
                          type="text"
                          value={r.startTime}
                          onChange={(e) => updateRow(r.weekday, { startTime: e.target.value })}
                          disabled={loading}
                          placeholder="HH:MM"
                          style={{
                            width: 88,
                            border: "1px solid #cbd5e1",
                            borderRadius: 8,
                            padding: "6px 8px",
                            fontSize: 14,
                          }}
                        />
                      </td>
                      <td style={{ padding: "8px 6px" }}>
                        <input
                          type="text"
                          value={r.endTime}
                          onChange={(e) => updateRow(r.weekday, { endTime: e.target.value })}
                          disabled={loading}
                          placeholder="HH:MM"
                          style={{
                            width: 88,
                            border: "1px solid #cbd5e1",
                            borderRadius: 8,
                            padding: "6px 8px",
                            fontSize: 14,
                          }}
                        />
                      </td>
                      <td style={{ padding: "8px 6px" }}>
                        <input
                          type="text"
                          value={r.label}
                          onChange={(e) => updateRow(r.weekday, { label: e.target.value })}
                          disabled={loading}
                          placeholder="volitelné"
                          style={{
                            width: "100%",
                            minWidth: 120,
                            border: "1px solid #cbd5e1",
                            borderRadius: 8,
                            padding: "6px 8px",
                            fontSize: 14,
                          }}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </PageSection>
    </PageContainer>
  );
}
