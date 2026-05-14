import React, { useEffect, useMemo, useState } from "react";
import PageContainer from "../components/layout/PageContainer";
import PageHeader from "../components/layout/PageHeader";
import PageSection from "../components/layout/PageSection";
import { akengFetch } from "../services/akengFetch";
import { ERP_COLORS, UI } from "../styles/ui";

type Machine = {
  id: number;
  machine_code: string;
  name: string;
  machine_type: string;
};

type PlanningOperation = {
  id: number;
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
  product_group_id: number | null;
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

const API_BASE = "http://127.0.0.1:8001";

const ROW_HOVER = "#F1F5F9";

export default function MachinePlanningPage() {
  const [machines, setMachines] = useState<Machine[]>([]);
  const [selectedMachineId, setSelectedMachineId] = useState<number | null>(null);
  const [operations, setOperations] = useState<PlanningOperation[]>([]);
  const [calendar, setCalendar] = useState<MachineCalendarDay[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadMachines();
  }, []);

  useEffect(() => {
    if (selectedMachineId) {
      loadMachineData(selectedMachineId);
    }
  }, [selectedMachineId]);

  async function loadMachines() {
    const res = await akengFetch(`${API_BASE}/master-data/machines`);
    const data = await res.json();
    setMachines(data);
    if (data.length > 0) {
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

      setOperations(ops);
      setCalendar(cal);
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

    const date = new Date(dt);
    const hours = date.getHours();
    const minutes = date.getMinutes();

    return hours * 60 + minutes - 6 * 60;
  }

  function durationMinutes(start: string | null, end: string | null) {
    if (!start || !end) return 0;

    const s = new Date(start).getTime();
    const e = new Date(end).getTime();

    return Math.max(0, Math.round((e - s) / 60000));
  }

  const machineKpis = useMemo(() => {
    const totalShift = 480;
    const plannedMin = scheduledOps.reduce((a, o) => a + durationMinutes(o.planned_start, o.planned_end), 0);
    const utilizationPct = Math.min(100, Math.round((plannedMin / Math.max(1, totalShift)) * 100));
    const st = (x: string) => (x || "").toLowerCase();
    const blockedOps = operations.filter((o) => st(o.status) === "blocked" || st(o.status) === "blokovano").length;
    const delayedOrders = operations.filter((o) => st(o.status) === "scheduling_late" || st(o.status).includes("late")).length;
    const riskItems = operations.filter((o) => {
      const s = st(o.status);
      return s === "blocked" || s === "blokovano" || s === "waiting_release" || s === "scheduling_late" || s.includes("late");
    }).length;
    return { utilizationPct, riskVp: riskItems, blockedOps, delayedOrders, coopReturn: 0 };
  }, [operations, scheduledOps]);

  function statusPillStyle(status: string) {
    const s = (status || "").toLowerCase();
    if (s === "running" || s === "bezi") return ERP_COLORS.primary;
    if (s === "blocked" || s === "blokovano") return ERP_COLORS.problemFg;
    if (s === "finished" || s === "hotovo") return ERP_COLORS.okFg;
    if (s === "waiting_release") return "#4F46E5";
    if (s === "scheduling_late" || s.includes("late")) return ERP_COLORS.problemFg;
    if (s === "ready" || s === "ceka") return ERP_COLORS.textSecondary;
    return ERP_COLORS.waitFg;
  }

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

  const hourGridBg = `repeating-linear-gradient(90deg, transparent, transparent 12.5%, ${ERP_COLORS.divider} 12.5%, ${ERP_COLORS.divider} 25%)`;

  const panelCard: React.CSSProperties = {
    ...UI.card,
    borderRadius: 14,
    boxShadow: "0 1px 2px rgba(15, 23, 42, 0.04)",
  };

  return (
    <PageContainer
      style={{
        paddingTop: 8,
        background: UI.colors.pageBg,
        color: ERP_COLORS.textPrimary,
        fontFamily: "Arial, Helvetica, sans-serif",
        minHeight: "100%",
      }}
    >
      <PageHeader
        style={{ borderBottom: `1px solid ${ERP_COLORS.border}`, paddingBottom: 12, marginBottom: 8 }}
        title={
          <div>
            <div style={{ ...UI.statLabel, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em" }}>
              Plánování stroje
            </div>
            <div style={{ ...UI.pageTitle, marginTop: 4 }}>Neplánované operace</div>
          </div>
        }
        subtitle={
          <span style={UI.sectionSubtitle}>Plánování fronty stroje a neplánovaných operací</span>
        }
        actions={
          <button
            type="button"
            onClick={() => void rebuildSchedule()}
            disabled={!selectedMachineId}
            style={{
              ...UI.buttons.primary,
              padding: "9px 14px",
              opacity: !selectedMachineId ? 0.45 : 1,
            }}
          >
            Přepočítat plán
          </button>
        }
      />

      <PageSection gapTop={10}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
            gap: 10,
            marginBottom: 12,
          }}
        >
          {(
            [
              ["Vytížení (směna)", `${machineKpis.utilizationPct}%`, "480 min okno"],
              ["Rizikové položky", String(machineKpis.riskVp), "Blok / čekání / termín"],
              ["Blokované operace", String(machineKpis.blockedOps), ""],
              ["Zpožděné (stav)", String(machineKpis.delayedOrders), "scheduling_late"],
              ["Kooperace → návrat", String(machineKpis.coopReturn), "—"],
            ] as const
          ).map(([label, value, hint]) => (
            <div key={label} style={{ ...UI.summaryTile, minHeight: 0, padding: "10px 12px" }}>
              <div style={{ ...UI.summaryTileLabel, fontSize: 10 }}>{label}</div>
              <div style={{ ...UI.summaryTileValue, marginTop: 4, fontSize: 20 }}>{value}</div>
              {hint ? (
                <div style={{ ...UI.summaryTileSubValue, marginTop: 2, fontSize: 10 }}>{hint}</div>
              ) : null}
            </div>
          ))}
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(200px, 260px) minmax(0, 1fr) minmax(200px, 300px)",
            gap: 12,
            width: "100%",
            minWidth: 0,
          }}
        >
          <aside style={{ ...panelCard, padding: 14, minWidth: 0 }}>
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
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 15, fontWeight: 900, color: ERP_COLORS.textPrimary }}>
                {selectedMachine ? `Plánování: ${selectedMachine.name}` : "Vyberte stroj"}
              </div>
              <div style={{ ...UI.sectionSubtitle, marginTop: 4 }}>Fronta naplánovaných a čekajících operací</div>
            </div>

            {loading ? (
              <div style={{ color: ERP_COLORS.textSecondary }}>Načítání...</div>
            ) : (
              <>
                <h3 style={{ margin: "0 0 8px", fontSize: 12, fontWeight: 900, color: ERP_COLORS.textPrimary }}>
                  Fronta stroje
                </h3>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 640 }}>
                    <thead>
                      <tr style={{ background: ERP_COLORS.tableHeadBg }}>
                        <th style={tableHead}>#</th>
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
                      {scheduledOps.map((row) => (
                        <tr
                          key={row.id}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.background = ROW_HOVER;
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background = "transparent";
                          }}
                        >
                          <td style={tableCell}>{row.queue_position}</td>
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
                          <td style={tableCell}>{row.planned_start ?? "-"}</td>
                          <td style={tableCell}>{row.planned_end ?? "-"}</td>
                          <td style={tableCell}>
                            <span
                              style={{
                                display: "inline-block",
                                padding: "3px 8px",
                                borderRadius: 999,
                                background: statusPillStyle(row.status),
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
                      ))}
                    </tbody>
                  </table>
                </div>

                <h3 style={{ margin: "18px 0 8px", fontSize: 12, fontWeight: 900, color: ERP_COLORS.textPrimary }}>
                  Timeline směny
                </h3>

                <div
                  style={{
                    border: `1px solid ${ERP_COLORS.border}`,
                    borderRadius: 12,
                    padding: 12,
                    marginBottom: 18,
                    background: ERP_COLORS.neutralBg,
                  }}
                >
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "120px 1fr",
                      gap: 8,
                      marginBottom: 8,
                      fontSize: 10,
                      fontWeight: 800,
                      letterSpacing: "0.08em",
                      textTransform: "uppercase",
                      color: ERP_COLORS.textSecondary,
                    }}
                  >
                    <div>Operace</div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(8, 1fr)" }}>
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
                    const pill = statusPillStyle(row.status);

                    return (
                      <div
                        key={`timeline-${row.id}`}
                        style={{
                          display: "grid",
                          gridTemplateColumns: "120px 1fr",
                          gap: 8,
                          alignItems: "center",
                          marginBottom: 10,
                        }}
                      >
                        <div style={{ fontSize: 12 }}>
                          <strong>{row.gpn}</strong>
                          <br />
                          <span style={{ color: ERP_COLORS.textSecondary }}>{row.operation_name}</span>
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
                              width: `${Math.max((width / totalShift) * 100, 2)}%`,
                              top: 0,
                              bottom: 0,
                              background: pill,
                              border: `1px solid rgba(15,23,42,0.12)`,
                              borderRadius: 6,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              fontSize: 11,
                              fontWeight: 800,
                              color: "#fff",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {row.planned_start?.slice(11, 16)}–{row.planned_end?.slice(11, 16)}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <h3 style={{ margin: "0 0 8px", fontSize: 12, fontWeight: 900, color: ERP_COLORS.textPrimary }}>
                  Neplánované operace
                </h3>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 480 }}>
                    <thead>
                      <tr style={{ background: ERP_COLORS.tableHeadBg }}>
                        <th style={tableHead}>GPN</th>
                        <th style={tableHead}>Operace</th>
                        <th style={tableHead}>Ø</th>
                        <th style={tableHead}>Qty</th>
                        <th style={tableHead}>Expedice</th>
                        <th style={tableHead}>Stav</th>
                      </tr>
                    </thead>
                    <tbody>
                      {waitingOps.map((row) => (
                        <tr
                          key={row.id}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.background = ROW_HOVER;
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background = "transparent";
                          }}
                        >
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
                                padding: "3px 8px",
                                borderRadius: 999,
                                background: statusPillStyle(row.status),
                                color: "#fff",
                                fontSize: 11,
                                fontWeight: 800,
                              }}
                            >
                              {row.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </main>

          <aside style={{ ...panelCard, padding: 14, minWidth: 0 }}>
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
      </PageSection>
    </PageContainer>
  );
}
