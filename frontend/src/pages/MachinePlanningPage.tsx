import React, { useEffect, useMemo, useState } from "react";

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
    const res = await fetch(`${API_BASE}/master-data/machines`);
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
        fetch(`${API_BASE}/planning/operations?machine_id=${machineId}`),
        fetch(`${API_BASE}/planning/machine-calendar?machine_id=${machineId}`),
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

    await fetch(`${API_BASE}/planning/build-schedule`, {
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

    await fetch(`${API_BASE}/planning/move`, {
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

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#f8fafc",
        padding: 16,
        fontFamily: "Arial, sans-serif",
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "280px 1fr 320px",
          gap: 16,
        }}
      >
        <aside
          style={{
            background: "#fff",
            padding: 16,
            border: "1px solid #ddd",
            borderRadius: 12,
          }}
        >
          <h2>Stroje</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {machines.map((machine) => (
              <button
                key={machine.id}
                onClick={() => setSelectedMachineId(machine.id)}
                style={{
                  textAlign: "left",
                  padding: 12,
                  borderRadius: 10,
                  border:
                    selectedMachineId === machine.id
                      ? "2px solid #111"
                      : "1px solid #ddd",
                  background: selectedMachineId === machine.id ? "#f1f5f9" : "#fff",
                  cursor: "pointer",
                }}
              >
                <div style={{ fontWeight: 700 }}>{machine.name}</div>
                <div style={{ fontSize: 12, color: "#666" }}>{machine.machine_code}</div>
              </button>
            ))}
          </div>
        </aside>

        <main
          style={{
            background: "#fff",
            padding: 16,
            border: "1px solid #ddd",
            borderRadius: 12,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 16,
            }}
          >
            <div>
              <h1 style={{ margin: 0 }}>
                {selectedMachine ? `Plánování: ${selectedMachine.name}` : "Plánování"}
              </h1>
              <div style={{ color: "#666", fontSize: 14 }}>
                Fronta stroje a neplánované operace
              </div>
            </div>

            <button
              onClick={rebuildSchedule}
              style={{
                padding: "10px 14px",
                borderRadius: 10,
                border: "1px solid #111",
                background: "#fff",
                cursor: "pointer",
              }}
            >
              Přepočítat plán
            </button>
          </div>

          {loading ? (
            <div>Načítání...</div>
          ) : (
            <>
              <h3>Fronta stroje</h3>
              <table width="100%" cellPadding={6} style={{ borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>GPN</th>
                    <th>Operace</th>
                    <th>Ø</th>
                    <th>Qty</th>
                    <th>Setup</th>
                    <th>Labor</th>
                    <th>Celkem</th>
                    <th>Expedice</th>
                    <th>Start</th>
                    <th>Konec</th>
                    <th>Stav</th>
                    <th>Akce</th>
                  </tr>
                </thead>
                <tbody>
                  {scheduledOps.map((row) => (
                    <tr key={row.id} style={{ borderTop: "1px solid #eee" }}>
                      <td>{row.queue_position}</td>
                      <td>
                        <b>{row.gpn}</b>
                      </td>
                      <td>
                        {row.operation_no} / {row.operation_name}
                      </td>
                      <td>{row.input_diameter_mm ?? "-"}</td>
                      <td>{row.qty}</td>
                      <td>{row.setup_time_min}</td>
                      <td>{row.total_labor_time_min}</td>
                      <td>{row.total_operation_time_min}</td>
                      <td>{row.expedition_date}</td>
                      <td>{row.planned_start ?? "-"}</td>
                      <td>{row.planned_end ?? "-"}</td>
                      <td>{row.status}</td>
                      <td>
                        <button onClick={() => moveOperation(row.id, "up")}>↑</button>
                        <button onClick={() => moveOperation(row.id, "down")}>↓</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <h3 style={{ marginTop: 24 }}>Timeline směny</h3>

              <div
                style={{
                  border: "1px solid #ddd",
                  borderRadius: 12,
                  padding: 12,
                  marginBottom: 24,
                  background: "#fafafa",
                }}
              >
                {scheduledOps.map((row) => {
                  const left = toMinutesFromShiftStart(row.planned_start);
                  const width = durationMinutes(row.planned_start, row.planned_end);
                  const totalShift = 480;

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
                        <b>{row.gpn}</b>
                        <br />
                        <span style={{ color: "#666" }}>{row.operation_name}</span>
                      </div>

                      <div
                        style={{
                          position: "relative",
                          height: 28,
                          background: "#fff",
                          border: "1px solid #ddd",
                          borderRadius: 8,
                          overflow: "hidden",
                        }}
                      >
                        <div
                          style={{
                            position: "absolute",
                            left: `${(left / totalShift) * 100}%`,
                            width: `${(width / totalShift) * 100}%`,
                            top: 0,
                            bottom: 0,
                            background: "#cbd5e1",
                            border: "1px solid #94a3b8",
                            borderRadius: 6,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: 12,
                            fontWeight: 700,
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

              <h3>Neplánované operace</h3>
              <table width="100%" cellPadding={6} style={{ borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th>GPN</th>
                    <th>Operace</th>
                    <th>Ø</th>
                    <th>Qty</th>
                    <th>Expedice</th>
                    <th>Stav</th>
                  </tr>
                </thead>
                <tbody>
                  {waitingOps.map((row) => (
                    <tr key={row.id} style={{ borderTop: "1px solid #eee" }}>
                      <td>
                        <b>{row.gpn}</b>
                      </td>
                      <td>
                        {row.operation_no} / {row.operation_name}
                      </td>
                      <td>{row.input_diameter_mm ?? "-"}</td>
                      <td>{row.qty}</td>
                      <td>{row.expedition_date}</td>
                      <td>{row.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </main>

        <aside
          style={{
            background: "#fff",
            padding: 16,
            border: "1px solid #ddd",
            borderRadius: 12,
          }}
        >
          <h2>Kapacita stroje</h2>
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
                  border: "1px solid #ddd",
                  borderRadius: 10,
                  padding: 10,
                  marginBottom: 10,
                }}
              >
                <div>
                  <b>{day.calendar_date}</b>
                </div>
                <div>Kapacita: {day.available_minutes} min</div>
                <div>Naplánováno: {day.planned_minutes} min</div>
                <div>Volno: {free} min</div>
              </div>
            );
          })}
        </aside>
      </div>
    </div>
  );
}
