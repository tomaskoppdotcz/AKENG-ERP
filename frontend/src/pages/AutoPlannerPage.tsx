import React, { useEffect, useState } from "react";
import { autoPlanWorkOrder, AutoPlannerResult, getAutoPlannerWorkOrders } from "../services/plannerApi";

export default function AutoPlannerPage() {
  const [workOrders, setWorkOrders] = useState<string[]>([]);
  const [selectedWorkOrder, setSelectedWorkOrder] = useState("");
  const [loading, setLoading] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<AutoPlannerResult | null>(null);

  async function loadWorkOrders() {
    try {
      setLoading(true);
      setError("");
      const data = await getAutoPlannerWorkOrders();
      setWorkOrders(data.work_orders || []);
      if ((data.work_orders || []).length > 0) {
        setSelectedWorkOrder((prev) => prev || data.work_orders[0]);
      }
    } catch (e: any) {
      setError(e?.message || "Nepodarilo se nacist seznam zakazek.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadWorkOrders();
  }, []);

  async function handleAutoPlan() {
    if (!selectedWorkOrder) {
      setError("Vyber work order.");
      return;
    }

    try {
      setPlanning(true);
      setError("");
      setResult(null);
      const data = await autoPlanWorkOrder(selectedWorkOrder);
      setResult(data);
    } catch (e: any) {
      setError(e?.message || "Nepodarilo se automaticky naplanovat zakazku.");
    } finally {
      setPlanning(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc", padding: 24 }}>
      <div style={{ maxWidth: 1100, margin: "0 auto", display: "grid", gap: 20 }}>
        <div
          style={{
            background: "#fff",
            border: "1px solid #dbe2ea",
            borderRadius: 20,
            padding: 20,
            boxShadow: "0 1px 2px rgba(15,23,42,0.05)",
          }}
        >
          <div style={{ fontSize: 28, fontWeight: 900, color: "#0f172a" }}>Auto Planner</div>
          <div style={{ fontSize: 14, color: "#64748b", marginTop: 6 }}>
            Automaticke naplanovani zakazky / VP do planu stroju.
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 12, marginTop: 20, alignItems: "end" }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#334155", marginBottom: 6 }}>Work order / VP</div>
              <select
                value={selectedWorkOrder}
                onChange={(e) => setSelectedWorkOrder(e.target.value)}
                style={{
                  width: "100%",
                  border: "1px solid #cbd5e1",
                  borderRadius: 12,
                  padding: "12px 14px",
                  fontSize: 14,
                  background: "#fff",
                }}
              >
                {workOrders.map((wo) => (
                  <option key={wo} value={wo}>
                    {wo}
                  </option>
                ))}
              </select>
            </div>

            <button
              onClick={loadWorkOrders}
              disabled={loading}
              style={{
                border: "1px solid #cbd5e1",
                background: "#fff",
                color: "#0f172a",
                borderRadius: 12,
                padding: "12px 16px",
                fontWeight: 800,
                cursor: "pointer",
                opacity: loading ? 0.6 : 1,
              }}
            >
              {loading ? "Nacitam..." : "Obnovit seznam"}
            </button>

            <button
              onClick={handleAutoPlan}
              disabled={planning || !selectedWorkOrder}
              style={{
                border: "1px solid #0f172a",
                background: "#0f172a",
                color: "#fff",
                borderRadius: 12,
                padding: "12px 16px",
                fontWeight: 800,
                cursor: "pointer",
                opacity: planning ? 0.6 : 1,
              }}
            >
              {planning ? "Planovani..." : "Automaticky naplanovat"}
            </button>
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

        {result ? (
          <div
            style={{
              background: "#fff",
              border: "1px solid #dbe2ea",
              borderRadius: 20,
              padding: 20,
              boxShadow: "0 1px 2px rgba(15,23,42,0.05)",
            }}
          >
            <div style={{ fontSize: 22, fontWeight: 900, color: "#0f172a", marginBottom: 16 }}>
              Vysledek planovani
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(180px, 1fr))", gap: 16 }}>
              <div
                style={{
                  background: "#f8fafc",
                  border: "1px solid #e2e8f0",
                  borderRadius: 16,
                  padding: 16,
                }}
              >
                <div style={{ fontSize: 13, color: "#64748b", fontWeight: 700 }}>Work order</div>
                <div style={{ fontSize: 24, fontWeight: 900, color: "#0f172a", marginTop: 8 }}>{result.work_order_no}</div>
              </div>

              <div
                style={{
                  background: "#f8fafc",
                  border: "1px solid #e2e8f0",
                  borderRadius: 16,
                  padding: 16,
                }}
              >
                <div style={{ fontSize: 13, color: "#64748b", fontWeight: 700 }}>Operace nalezeny</div>
                <div style={{ fontSize: 24, fontWeight: 900, color: "#0f172a", marginTop: 8 }}>{result.operations_found}</div>
              </div>

              <div
                style={{
                  background: "#f8fafc",
                  border: "1px solid #e2e8f0",
                  borderRadius: 16,
                  padding: 16,
                }}
              >
                <div style={{ fontSize: 13, color: "#64748b", fontWeight: 700 }}>Stroje prepocteny</div>
                <div style={{ fontSize: 24, fontWeight: 900, color: "#0f172a", marginTop: 8 }}>{result.machines_rebuilt.length}</div>
              </div>
            </div>

            <div style={{ marginTop: 20 }}>
              <div style={{ fontSize: 16, fontWeight: 900, color: "#0f172a", marginBottom: 10 }}>Dotcene stroje</div>
              <div style={{ display: "grid", gap: 10 }}>
                {result.machines_rebuilt.map((row) => (
                  <div
                    key={row.machine_id}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 12,
                      padding: "12px 14px",
                      background: "#fff",
                      border: "1px solid #e2e8f0",
                      borderRadius: 12,
                    }}
                  >
                    <div style={{ fontWeight: 800, color: "#0f172a" }}>Machine ID: {row.machine_id}</div>
                    <div style={{ color: "#334155", fontWeight: 700 }}>Scheduled rows: {row.scheduled_rows}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
