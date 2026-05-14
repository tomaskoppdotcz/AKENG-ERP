import React, { useEffect, useMemo, useState } from "react";
import { akengFetch } from "../services/akengFetch";
import { ERP_COLORS, UI } from "../styles/ui";

const API_BASE = "http://127.0.0.1:8001";

type Machine = {
  id: number;
  machine_code: string;
  name: string;
  machine_type: string;
};

type PlanningOperation = {
  id: number;
  order_item_id?: number | null;
  work_order_no?: string | null;
  gpn: string;
  operation_name: string;
  operation_no: number;
  qty: number;
  input_diameter_mm: number | null;
  setup_time_min: number;
  total_labor_time_min: number;
  total_operation_time_min: number;
  expedition_date: string;
  planned_start: string | null;
  planned_end: string | null;
  queue_position: number | null;
  status: string;
};

type MachineCalendarDay = {
  id: number;
  machine_id: number;
  calendar_date: string;
  available_minutes: number;
  planned_minutes: number;
  maintenance_minutes: number;
  reserved_minutes: number;
  is_working_day: boolean;
  is_machine_available: boolean;
};

const ROW_HOVER = "#F1F5F9";

function getStatusStyle(status: string) {
  switch ((status || "").toLowerCase()) {
    case "running":
      return { bg: ERP_COLORS.okBg, border: ERP_COLORS.okFg, pill: ERP_COLORS.okFg };
    case "ready":
      return { bg: ERP_COLORS.runningBg, border: ERP_COLORS.primary, pill: ERP_COLORS.primary };
    case "finished":
      return { bg: ERP_COLORS.okBg, border: ERP_COLORS.okFg, pill: ERP_COLORS.okFg };
    case "blocked":
      return { bg: ERP_COLORS.problemBg, border: ERP_COLORS.problemFg, pill: ERP_COLORS.problemFg };
    case "paused":
      return { bg: ERP_COLORS.waitBg, border: ERP_COLORS.waitFg, pill: ERP_COLORS.waitFg };
    case "waiting_release":
      return { bg: "rgba(79, 70, 229, 0.1)", border: "#4F46E5", pill: "#4F46E5" };
    default:
      return { bg: ERP_COLORS.neutralBg, border: ERP_COLORS.border, pill: ERP_COLORS.textSecondary };
  }
}

export default function PlannerBoardPage() {
  const [machines, setMachines] = useState<Machine[]>([]);
  const [selectedMachineId, setSelectedMachineId] = useState<number | null>(null);
  const [operations, setOperations] = useState<PlanningOperation[]>([]);
  const [calendar, setCalendar] = useState<MachineCalendarDay[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadMachines();
  }, []);

  useEffect(() => {
    if (selectedMachineId) loadMachineData(selectedMachineId);
  }, [selectedMachineId]);

  async function loadMachines() {
    const res = await akengFetch(`${API_BASE}/master-data/machines`);
    const data = await res.json();
    setMachines(data);
    if (data.length > 0 && !selectedMachineId) {
      setSelectedMachineId(data[0].id);
    }
  }

  async function loadMachineData(machineId: number) {
    setLoading(true);
    try {
      const [opsRes, calRes] = await Promise.all([
        akengFetch(`${API_BASE}/planning/operations?machine_id=${machineId}`),
        akengFetch(`${API_BASE}/planning/machine-calendar?machine_id=${machineId}`),
      ]);

      const ops = await opsRes.json();
      const cal = await calRes.json();

      setOperations(Array.isArray(ops) ? ops : []);
      setCalendar(Array.isArray(cal) ? cal : []);
    } finally {
      setLoading(false);
    }
  }

  async function rebuildSchedule() {
    if (!selectedMachineId) return;

    await akengFetch(`${API_BASE}/planning/build-schedule`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        machine_id: selectedMachineId,
        from_date: new Date().toISOString().slice(0, 10),
      }),
    });

    await loadMachineData(selectedMachineId);
  }

  async function moveOperation(operationId: number, direction: "up" | "down") {
    if (!selectedMachineId) return;

    await akengFetch(`${API_BASE}/planning/move`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        machine_id: selectedMachineId,
        planning_operation_id: operationId,
        direction,
      }),
    });

    await loadMachineData(selectedMachineId);
  }

  const selectedMachine = machines.find((m) => m.id === selectedMachineId);

  const scheduledOps = useMemo(
    () =>
      [...operations]
        .filter((o) => o.queue_position !== null)
        .sort((a, b) => (a.queue_position ?? 999) - (b.queue_position ?? 999)),
    [operations]
  );

  const waitingOps = useMemo(
    () => operations.filter((o) => o.queue_position === null),
    [operations]
  );

  function toMinutesFromShiftStart(dt: string | null) {
    if (!dt) return 0;
    const d = new Date(dt);
    return d.getHours() * 60 + d.getMinutes() - 6 * 60;
  }

  function durationMinutes(start: string | null, end: string | null) {
    if (!start || !end) return 0;
    return Math.max(0, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000));
  }

  const boardKpis = useMemo(() => {
    const totalShift = 480;
    const plannedMin = scheduledOps.reduce((acc, o) => acc + durationMinutes(o.planned_start, o.planned_end), 0);
    const utilizationPct = Math.min(100, Math.round((plannedMin / Math.max(1, totalShift)) * 100));
    const woo = (o: PlanningOperation) => (o.work_order_no || "").trim();
    const risk = new Set<string>();
    const delayed = new Set<string>();
    let blockedOps = 0;
    for (const o of operations) {
      const st = (o.status || "").toLowerCase();
      const w = woo(o);
      if (st === "blocked") blockedOps += 1;
      if (w && (st === "blocked" || st === "waiting_release")) risk.add(w);
      if (w && (st === "scheduling_late" || st.includes("late"))) delayed.add(w);
    }
    const coopReturn = operations.filter((o) => (o.status || "").toLowerCase() === "sent").length;
    return { utilizationPct, riskVp: risk.size, blockedOps, delayedOrders: delayed.size, coopReturn };
  }, [operations, scheduledOps]);

  function formatVp(row: PlanningOperation) {
    return row.work_order_no || "-";
  }

  const ghostBtn: React.CSSProperties = {
    marginRight: 6,
    padding: "4px 8px",
    borderRadius: 8,
    border: `1px solid ${ERP_COLORS.border}`,
    background: ERP_COLORS.card,
    color: ERP_COLORS.textPrimary,
    cursor: "pointer",
    fontWeight: 800,
  };

  const tableHead: React.CSSProperties = {
    textAlign: "left" as const,
    padding: "8px 10px",
    borderBottom: `2px solid ${ERP_COLORS.divider}`,
    color: ERP_COLORS.tableHeadText,
    fontWeight: 800,
    fontSize: 11,
    textTransform: "uppercase" as const,
    letterSpacing: "0.06em",
  };

  const tableCell: React.CSSProperties = {
    padding: "8px 10px",
    borderBottom: `1px solid ${ERP_COLORS.divider}`,
    color: ERP_COLORS.textPrimary,
    fontSize: 13,
  };

  const hourGridBg = `repeating-linear-gradient(90deg, transparent, transparent 12.5%, ${ERP_COLORS.divider} 12.5%, ${ERP_COLORS.divider} 25%)`;

  const panelCard: React.CSSProperties = {
    ...UI.card,
    borderRadius: 14,
    boxShadow: "0 1px 2px rgba(15, 23, 42, 0.04)",
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: UI.colors.pageBg,
        padding: 14,
        fontFamily: "Arial, Helvetica, sans-serif",
        color: ERP_COLORS.textPrimary,
      }}
    >
      <div
        style={{
          ...panelCard,
          padding: "14px 16px",
          marginBottom: 12,
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "space-between",
          gap: 12,
          alignItems: "center",
        }}
      >
        <div>
          <div style={{ ...UI.statLabel, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Planner Board
          </div>
          <h1 style={{ ...UI.pageTitle, margin: "6px 0 0" }}>
            {selectedMachine ? selectedMachine.name : "Planner Board"}
          </h1>
          <div style={{ ...UI.sectionSubtitle, marginTop: 4 }}>
            Stroje: {machines.length} · operace: {operations.length} · ve frontě: {scheduledOps.length} · čeká:{" "}
            {waitingOps.length}
          </div>
        </div>
        <button type="button" onClick={rebuildSchedule} style={{ ...UI.buttons.primary, padding: "9px 14px" }}>
          Přepočítat plán
        </button>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
          gap: 10,
          marginBottom: 12,
        }}
      >
        {(
          [
            ["Vytížení (směna)", `${boardKpis.utilizationPct}%`, "vs. 480 min"],
            ["Rizikové VP", String(boardKpis.riskVp), "Blok / čeká uvolnění"],
            ["Blokované operace", String(boardKpis.blockedOps), "status blocked"],
            ["Zpožděné zakázky", String(boardKpis.delayedOrders), "scheduling_late"],
            ["Kooperace → návrat", String(boardKpis.coopReturn), "status sent"],
          ] as const
        ).map(([label, value, hint]) => (
          <div key={label} style={{ ...UI.summaryTile, minHeight: 0 }}>
            <div style={UI.summaryTileLabel}>{label}</div>
            <div style={{ ...UI.summaryTileValue, marginTop: 6, fontSize: 22 }}>{value}</div>
            <div style={{ ...UI.summaryTileSubValue, marginTop: 4 }}>{hint}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(240px, 280px) minmax(0, 1fr) minmax(240px, 320px)", gap: 12 }}>
        <aside style={{ ...panelCard, padding: 14 }}>
          <h2 style={{ ...UI.statLabel, marginTop: 0, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Stroje
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }}>
            {machines.map((machine) => (
              <button
                key={machine.id}
                type="button"
                onClick={() => setSelectedMachineId(machine.id)}
                style={{
                  textAlign: "left",
                  padding: "10px 12px",
                  borderRadius: 10,
                  border:
                    selectedMachineId === machine.id
                      ? `2px solid ${ERP_COLORS.primary}`
                      : `1px solid ${ERP_COLORS.border}`,
                  background: selectedMachineId === machine.id ? ERP_COLORS.primaryLight : ERP_COLORS.card,
                  cursor: "pointer",
                  color: ERP_COLORS.textPrimary,
                }}
              >
                <div style={{ fontWeight: 800 }}>{machine.name}</div>
                <div style={{ fontSize: 12, color: ERP_COLORS.textSecondary }}>{machine.machine_code}</div>
              </button>
            ))}
          </div>
        </aside>

        <main style={{ ...panelCard, padding: 14, minWidth: 0 }}>
          {loading ? (
            <div style={{ color: ERP_COLORS.textSecondary }}>Načítání...</div>
          ) : (
            <>
              <h3 style={{ margin: "0 0 10px", fontSize: 13, fontWeight: 900, color: ERP_COLORS.textPrimary }}>
                Fronta stroje
              </h3>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
                  <thead>
                    <tr style={{ background: ERP_COLORS.tableHeadBg }}>
                      <th style={tableHead}>#</th>
                      <th style={{ ...tableHead, color: ERP_COLORS.primary }}>VP</th>
                      <th style={tableHead}>GPN</th>
                      <th style={tableHead}>Operace</th>
                      <th style={tableHead}>Ø</th>
                      <th style={tableHead}>Qty</th>
                      <th style={tableHead}>Setup</th>
                      <th style={tableHead}>Labor</th>
                      <th style={tableHead}>Celkem</th>
                      <th style={tableHead}>Expedice</th>
                      <th style={tableHead}>Start</th>
                      <th style={tableHead}>Konec</th>
                      <th style={tableHead}>Stav</th>
                      <th style={tableHead}>Akce</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scheduledOps.map((row) => {
                      const statusStyle = getStatusStyle(row.status);
                      return (
                        <tr
                          key={row.id}
                          style={{ background: statusStyle.bg }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.background = ROW_HOVER;
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background = statusStyle.bg;
                          }}
                        >
                          <td style={tableCell}>{row.queue_position}</td>
                          <td style={{ ...tableCell, color: ERP_COLORS.primary, fontWeight: 800 }}>{formatVp(row)}</td>
                          <td style={{ ...tableCell, fontWeight: 800 }}>{row.gpn}</td>
                          <td style={tableCell}>
                            {row.operation_no} / {row.operation_name}
                          </td>
                          <td style={tableCell}>{row.input_diameter_mm ?? "-"}</td>
                          <td style={tableCell}>{row.qty}</td>
                          <td style={tableCell}>{row.setup_time_min}</td>
                          <td style={tableCell}>{row.total_labor_time_min}</td>
                          <td style={tableCell}>{row.total_operation_time_min}</td>
                          <td style={tableCell}>{row.expedition_date}</td>
                          <td style={tableCell}>{row.planned_start ? row.planned_start.slice(11, 16) : "-"}</td>
                          <td style={tableCell}>{row.planned_end ? row.planned_end.slice(11, 16) : "-"}</td>
                          <td style={tableCell}>
                            <span
                              style={{
                                display: "inline-block",
                                padding: "4px 8px",
                                borderRadius: 999,
                                background: statusStyle.pill,
                                color: "#fff",
                                fontSize: 11,
                                fontWeight: 800,
                              }}
                            >
                              {row.status}
                            </span>
                          </td>
                          <td style={tableCell}>
                            <button type="button" onClick={() => moveOperation(row.id, "up")} style={ghostBtn}>
                              ↑
                            </button>
                            <button type="button" onClick={() => moveOperation(row.id, "down")} style={ghostBtn}>
                              ↓
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <h3 style={{ margin: "20px 0 10px", fontSize: 13, fontWeight: 900, color: ERP_COLORS.textPrimary }}>
                Timeline směny
              </h3>
              <div
                style={{
                  border: `1px solid ${ERP_COLORS.border}`,
                  borderRadius: 12,
                  padding: 12,
                  marginBottom: 20,
                  background: ERP_COLORS.neutralBg,
                }}
              >
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "220px 1fr",
                    gap: 8,
                    marginBottom: 10,
                    fontSize: 10,
                    fontWeight: 800,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    color: ERP_COLORS.textSecondary,
                  }}
                >
                  <div>Operace</div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(8, 1fr)", gap: 2 }}>
                    {["06", "07", "08", "09", "10", "11", "12", "13"].map((h) => (
                      <div key={h} style={{ textAlign: "center" }}>
                        {h}:00
                      </div>
                    ))}
                  </div>
                </div>

                {scheduledOps.map((row) => {
                  const left = toMinutesFromShiftStart(row.planned_start);
                  const width = durationMinutes(row.planned_start, row.planned_end);
                  const totalShift = 480;
                  const statusStyle = getStatusStyle(row.status);

                  return (
                    <div
                      key={`timeline-${row.id}`}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "220px 1fr",
                        gap: 8,
                        alignItems: "center",
                        marginBottom: 10,
                      }}
                    >
                      <div style={{ fontSize: 12 }}>
                        <div style={{ color: ERP_COLORS.primary, fontWeight: 800 }}>{formatVp(row)}</div>
                        <strong>{row.gpn}</strong>
                        <br />
                        <span style={{ color: ERP_COLORS.textSecondary }}>
                          {row.operation_no} / {row.operation_name}
                        </span>
                      </div>

                      <div
                        style={{
                          position: "relative",
                          height: 30,
                          background: `${hourGridBg}, ${ERP_COLORS.card}`,
                          border: `1px solid ${ERP_COLORS.border}`,
                          borderRadius: 8,
                          overflow: "hidden",
                        }}
                      >
                        <div
                          style={{
                            position: "absolute",
                            left: `${(left / totalShift) * 100}%`,
                            width: `${Math.max((width / totalShift) * 100, 3)}%`,
                            top: 0,
                            bottom: 0,
                            background: statusStyle.pill,
                            border: `1px solid rgba(15,23,42,0.12)`,
                            color: "#fff",
                            borderRadius: 6,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: 11,
                            fontWeight: 800,
                            whiteSpace: "nowrap",
                          }}
                        >
                          {row.planned_start && row.planned_end
                            ? `${row.planned_start.slice(11, 16)}-${row.planned_end.slice(11, 16)}`
                            : "-"}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <h3 style={{ margin: "0 0 10px", fontSize: 13, fontWeight: 900, color: ERP_COLORS.textPrimary }}>
                Neplánované operace
              </h3>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 520 }}>
                  <thead>
                    <tr style={{ background: ERP_COLORS.tableHeadBg }}>
                      <th style={{ ...tableHead, color: ERP_COLORS.primary }}>VP</th>
                      <th style={tableHead}>GPN</th>
                      <th style={tableHead}>Operace</th>
                      <th style={tableHead}>Ø</th>
                      <th style={tableHead}>Qty</th>
                      <th style={tableHead}>Expedice</th>
                      <th style={tableHead}>Stav</th>
                    </tr>
                  </thead>
                  <tbody>
                    {waitingOps.map((row) => {
                      const statusStyle = getStatusStyle(row.status);
                      return (
                        <tr key={row.id} style={{ background: statusStyle.bg }}>
                          <td style={{ ...tableCell, color: ERP_COLORS.primary, fontWeight: 800 }}>{formatVp(row)}</td>
                          <td style={{ ...tableCell, fontWeight: 800 }}>{row.gpn}</td>
                          <td style={tableCell}>
                            {row.operation_no} / {row.operation_name}
                          </td>
                          <td style={tableCell}>{row.input_diameter_mm ?? "-"}</td>
                          <td style={tableCell}>{row.qty}</td>
                          <td style={tableCell}>{row.expedition_date}</td>
                          <td style={tableCell}>
                            <span
                              style={{
                                display: "inline-block",
                                padding: "4px 8px",
                                borderRadius: 999,
                                background: statusStyle.pill,
                                color: "#fff",
                                fontSize: 11,
                                fontWeight: 800,
                              }}
                            >
                              {row.status}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </main>

        <aside style={{ ...panelCard, padding: 14 }}>
          <h2 style={{ ...UI.statLabel, marginTop: 0, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Kapacita stroje
          </h2>
          {calendar.slice(0, 10).map((day) => {
            const free =
              day.available_minutes -
              day.planned_minutes -
              day.maintenance_minutes -
              day.reserved_minutes;

            return (
              <div
                key={day.id}
                style={{
                  border: `1px solid ${ERP_COLORS.border}`,
                  borderRadius: 10,
                  padding: 10,
                  marginBottom: 8,
                  background: ERP_COLORS.card,
                  fontSize: 13,
                  color: ERP_COLORS.textPrimary,
                }}
              >
                <div style={{ fontWeight: 800 }}>{day.calendar_date}</div>
                <div style={{ color: ERP_COLORS.textSecondary, marginTop: 4 }}>Kapacita: {day.available_minutes} min</div>
                <div style={{ color: ERP_COLORS.textSecondary }}>Naplánováno: {day.planned_minutes} min</div>
                <div style={{ color: ERP_COLORS.primary, fontWeight: 700, marginTop: 4 }}>Volno: {free} min</div>
              </div>
            );
          })}
        </aside>
      </div>
    </div>
  );
}
