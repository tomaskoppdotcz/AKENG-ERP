import React, { useEffect, useMemo, useState } from "react";
import { CapacityDashboardMachine, getCapacityDashboard } from "../services/plannerApi";

function utilizationColor(value: number) {
  if (value >= 85) return "#ef4444";
  if (value >= 60) return "#f59e0b";
  return "#10b981";
}

function utilizationBg(value: number) {
  if (value >= 85) return "#fef2f2";
  if (value >= 60) return "#fffbeb";
  return "#f0fdf4";
}

function minutesToHours(minutes: number) {
  return Math.round((minutes / 60) * 10) / 10;
}

function statusBadge(label: string, value: number, bg: string, color: string) {
  return (
    <div
      style={{
        padding: "6px 10px",
        borderRadius: 999,
        background: bg,
        color,
        fontSize: 12,
        fontWeight: 800,
      }}
    >
      {label}: {value}
    </div>
  );
}

export default function CapacityDashboardPage() {
  const [days, setDays] = useState(14);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [machines, setMachines] = useState<CapacityDashboardMachine[]>([]);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [liveStatus, setLiveStatus] = useState({
    bezi: 0,
    hotovo: 0,
    ceka: 0,
    blokovano: 0,
    naplanovano: 0,
  });

  async function loadData(nextDays: number = days) {
    try {
      setLoading(true);
      setError("");
      const data = await getCapacityDashboard(nextDays);
      setMachines(data.machines);
      setFromDate(data.from_date);
      setToDate(data.to_date);
      setLiveStatus(
        data.live_status || {
          bezi: 0,
          hotovo: 0,
          ceka: 0,
          blokovano: 0,
          naplanovano: 0,
        }
      );
    } catch (e: any) {
      setError(e?.message || "Nepodarilo se nacist capacity dashboard.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData(14);
  }, []);

  const totals = useMemo(() => {
    const available = machines.reduce((sum, m) => sum + m.available_minutes, 0);
    const planned = machines.reduce((sum, m) => sum + m.planned_minutes, 0);
    const free = machines.reduce((sum, m) => sum + m.free_minutes, 0);
    const operations = machines.reduce((sum, m) => sum + m.scheduled_operations, 0);
    const utilization = available > 0 ? Math.round((planned / available) * 1000) / 10 : 0;
    return { available, planned, free, operations, utilization };
  }, [machines]);

  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc", padding: 24 }}>
      <div style={{ maxWidth: 1600, margin: "0 auto", display: "grid", gap: 20 }}>
        <div
          style={{
            background: "#fff",
            border: "1px solid #dbe2ea",
            borderRadius: 20,
            padding: 20,
            boxShadow: "0 1px 2px rgba(15,23,42,0.05)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: 28, fontWeight: 900, color: "#0f172a" }}>Capacity Dashboard</div>
              <div style={{ fontSize: 14, color: "#64748b", marginTop: 6 }}>
                Prehled vytizeni stroju pro planovaci horizont i zivy stav vyroby.
              </div>
              <div style={{ fontSize: 13, color: "#334155", marginTop: 8, fontWeight: 700 }}>
                Rozsah: {fromDate || "-"} az {toDate || "-"}
              </div>
            </div>

            <div style={{ display: "flex", gap: 10, alignItems: "end", flexWrap: "wrap" }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#334155", marginBottom: 6 }}>Horizon dni</div>
                <select
                  value={days}
                  onChange={(e) => setDays(Number(e.target.value))}
                  style={{
                    border: "1px solid #cbd5e1",
                    borderRadius: 12,
                    padding: "10px 12px",
                    fontSize: 14,
                    background: "#fff",
                  }}
                >
                  <option value={7}>7 dni</option>
                  <option value={14}>14 dni</option>
                  <option value={30}>30 dni</option>
                  <option value={60}>60 dni</option>
                </select>
              </div>

              <button
                onClick={() => loadData(days)}
                disabled={loading}
                style={{
                  border: "1px solid #0f172a",
                  background: "#0f172a",
                  color: "#fff",
                  borderRadius: 12,
                  padding: "11px 16px",
                  fontWeight: 800,
                  cursor: "pointer",
                  opacity: loading ? 0.6 : 1,
                }}
              >
                {loading ? "Nacitam..." : "Obnovit dashboard"}
              </button>
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 16 }}>
            {statusBadge("Bezi", liveStatus.bezi, "#dbeafe", "#1d4ed8")}
            {statusBadge("Hotovo", liveStatus.hotovo, "#dcfce7", "#15803d")}
            {statusBadge("Ceka", liveStatus.ceka, "#e2e8f0", "#475569")}
            {statusBadge("Blokovano", liveStatus.blokovano, "#fee2e2", "#b91c1c")}
            {statusBadge("Naplanovano", liveStatus.naplanovano, "#fef3c7", "#b45309")}
          </div>

          {error ? (
            <div
              style={{
                marginTop: 16,
                padding: "12px 14px",
                borderRadius: 12,
                background: "#fef2f2",
                color: "#b91c1c",
                border: "1px solid #fecaca",
                fontSize: 14,
                fontWeight: 700,
              }}
            >
              {error}
            </div>
          ) : null}
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, minmax(180px, 1fr))",
            gap: 16,
          }}
        >
          {[
            ["Kapacita celkem", `${minutesToHours(totals.available)} h`],
            ["Plan celkem", `${minutesToHours(totals.planned)} h`],
            ["Volno celkem", `${minutesToHours(totals.free)} h`],
            ["Vytizeni", `${totals.utilization} %`],
          ].map(([label, value]) => (
            <div
              key={label}
              style={{
                background: "#fff",
                border: "1px solid #dbe2ea",
                borderRadius: 18,
                padding: 18,
                boxShadow: "0 1px 2px rgba(15,23,42,0.05)",
              }}
            >
              <div style={{ fontSize: 13, color: "#64748b", fontWeight: 700 }}>{label}</div>
              <div style={{ fontSize: 28, fontWeight: 900, color: "#0f172a", marginTop: 8 }}>{value}</div>
            </div>
          ))}
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
            gap: 16,
          }}
        >
          {machines.map((machine) => {
            const color = utilizationColor(machine.utilization_percent);
            const bg = utilizationBg(machine.utilization_percent);

            return (
              <div
                key={machine.machine_id}
                style={{
                  background: "#fff",
                  border: "1px solid #dbe2ea",
                  borderRadius: 18,
                  padding: 18,
                  boxShadow: "0 1px 2px rgba(15,23,42,0.05)",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "start" }}>
                  <div>
                    <div style={{ fontSize: 18, fontWeight: 900, color: "#0f172a" }}>{machine.machine_name}</div>
                    <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>{machine.machine_code}</div>
                  </div>

                  <div
                    style={{
                      background: bg,
                      color: color,
                      border: `1px solid ${color}33`,
                      borderRadius: 999,
                      padding: "6px 10px",
                      fontSize: 12,
                      fontWeight: 900,
                    }}
                  >
                    {machine.utilization_percent} %
                  </div>
                </div>

                <div style={{ marginTop: 16 }}>
                  <div
                    style={{
                      width: "100%",
                      height: 12,
                      background: "#e2e8f0",
                      borderRadius: 999,
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        width: `${Math.min(machine.utilization_percent, 100)}%`,
                        height: "100%",
                        background: color,
                        borderRadius: 999,
                      }}
                    />
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 16, fontSize: 14 }}>
                  <div>
                    <div style={{ color: "#64748b", fontWeight: 700 }}>Kapacita</div>
                    <div style={{ color: "#0f172a", fontWeight: 900 }}>{minutesToHours(machine.available_minutes)} h</div>
                  </div>

                  <div>
                    <div style={{ color: "#64748b", fontWeight: 700 }}>Plan</div>
                    <div style={{ color: "#0f172a", fontWeight: 900 }}>{minutesToHours(machine.planned_minutes)} h</div>
                  </div>

                  <div>
                    <div style={{ color: "#64748b", fontWeight: 700 }}>Volno</div>
                    <div style={{ color: "#0f172a", fontWeight: 900 }}>{minutesToHours(machine.free_minutes)} h</div>
                  </div>

                  <div>
                    <div style={{ color: "#64748b", fontWeight: 700 }}>Operace</div>
                    <div style={{ color: "#0f172a", fontWeight: 900 }}>{machine.scheduled_operations}</div>
                  </div>
                </div>

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 16 }}>
                  {statusBadge("Bezi", machine.live_status.bezi, "#dbeafe", "#1d4ed8")}
                  {statusBadge("Hotovo", machine.live_status.hotovo, "#dcfce7", "#15803d")}
                  {statusBadge("Ceka", machine.live_status.ceka, "#e2e8f0", "#475569")}
                  {statusBadge("Blok.", machine.live_status.blokovano, "#fee2e2", "#b91c1c")}
                  {statusBadge("Plan", machine.live_status.naplanovano, "#fef3c7", "#b45309")}
                </div>
              </div>
            );
          })}
        </div>

        {machines.length === 0 && !loading ? (
          <div
            style={{
              background: "#fff",
              border: "1px solid #dbe2ea",
              borderRadius: 18,
              padding: 24,
              color: "#64748b",
              fontWeight: 700,
            }}
          >
            Zadne stroje pro dashboard.
          </div>
        ) : null}
      </div>
    </div>
  );
}
