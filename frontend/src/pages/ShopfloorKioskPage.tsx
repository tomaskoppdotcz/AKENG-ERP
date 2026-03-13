import React, { useEffect, useState } from "react";
import {
  getKioskMachineOperations,
  getKioskMachines,
  kioskFinishOperation,
  kioskStartOperation,
  kioskStopOperation,
  KioskMachine,
  KioskOperation,
} from "../services/plannerApi";

function statusColor(status: string) {
  switch ((status || "").toLowerCase()) {
    case "hotovo":
      return "#10b981";
    case "bezi":
      return "#3b82f6";
    case "blokovano":
      return "#ef4444";
    case "ceka":
      return "#94a3b8";
    case "planned":
    case "naplanovano":
    default:
      return "#f59e0b";
  }
}

function statusLabel(status: string) {
  switch ((status || "").toLowerCase()) {
    case "hotovo":
      return "Hotovo";
    case "bezi":
      return "Bezi";
    case "blokovano":
      return "Blokovano";
    case "ceka":
      return "Ceka";
    case "planned":
      return "Planned";
    case "naplanovano":
      return "Naplanovano";
    default:
      return status || "-";
  }
}

export default function ShopfloorKioskPage() {
  const [machines, setMachines] = useState<KioskMachine[]>([]);
  const [selectedMachineId, setSelectedMachineId] = useState<number | "">("");
  const [operations, setOperations] = useState<KioskOperation[]>([]);
  const [selectedOperation, setSelectedOperation] = useState<KioskOperation | null>(null);
  const [operatorName, setOperatorName] = useState("");
  const [qtyOk, setQtyOk] = useState(0);
  const [qtyNok, setQtyNok] = useState(0);
  const [loading, setLoading] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function loadMachines() {
    try {
      setError("");
      const data = await getKioskMachines();
      const nextMachines = data.machines || [];
      setMachines(nextMachines);

      if (nextMachines.length > 0) {
        setSelectedMachineId((prev) => {
          if (prev !== "") return prev;
          return nextMachines[0].machine_id;
        });
      }
    } catch (e: any) {
      setError(e?.message || "Nepodarilo se nacist stroje.");
    }
  }

  async function loadOperations(machineId: number) {
    try {
      setLoading(true);
      setError("");
      const data = await getKioskMachineOperations(machineId);
      const nextOperations = data.operations || [];
      setOperations(nextOperations);

      const firstOp =
        nextOperations.find((x) => (x.status || "").toLowerCase() !== "hotovo") ||
        nextOperations[0] ||
        null;

      setSelectedOperation(firstOp);

      if (firstOp) {
        setQtyOk(firstOp.qty_ok ?? firstOp.qty ?? 0);
        setQtyNok(firstOp.qty_nok ?? 0);
      } else {
        setQtyOk(0);
        setQtyNok(0);
      }
    } catch (e: any) {
      setError(e?.message || "Nepodarilo se nacist operace stroje.");
      setOperations([]);
      setSelectedOperation(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadMachines();
  }, []);

  useEffect(() => {
    if (selectedMachineId !== "") {
      setMessage("");
      loadOperations(Number(selectedMachineId));
    }
  }, [selectedMachineId]);

  async function handleStart() {
    if (!selectedOperation) return;
    try {
      setWorking(true);
      setMessage("");
      setError("");
      await kioskStartOperation({
        planningOperationId: selectedOperation.id,
        operatorName,
      });
      await loadOperations(Number(selectedMachineId));
      setMessage("Operace byla spustena.");
    } catch (e: any) {
      setError(e?.message || "Nepodarilo se spustit operaci.");
    } finally {
      setWorking(false);
    }
  }

  async function handleStop() {
    if (!selectedOperation) return;
    try {
      setWorking(true);
      setMessage("");
      setError("");
      await kioskStopOperation({
        planningOperationId: selectedOperation.id,
        operatorName,
      });
      await loadOperations(Number(selectedMachineId));
      setMessage("Operace byla zastavena.");
    } catch (e: any) {
      setError(e?.message || "Nepodarilo se zastavit operaci.");
    } finally {
      setWorking(false);
    }
  }

  async function handleFinish() {
    if (!selectedOperation) return;
    try {
      setWorking(true);
      setMessage("");
      setError("");
      await kioskFinishOperation({
        planningOperationId: selectedOperation.id,
        qtyOk,
        qtyNok,
        operatorName,
      });
      await loadOperations(Number(selectedMachineId));
      setMessage("Operace byla dokoncena.");
    } catch (e: any) {
      setError(e?.message || "Nepodarilo se dokoncit operaci.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc", padding: 24 }}>
      <div style={{ maxWidth: 1400, margin: "0 auto", display: "grid", gap: 20 }}>
        <div
          style={{
            background: "#fff",
            border: "1px solid #dbe2ea",
            borderRadius: 20,
            padding: 20,
            boxShadow: "0 1px 2px rgba(15,23,42,0.05)",
          }}
        >
          <div style={{ fontSize: 28, fontWeight: 900, color: "#0f172a" }}>Shopfloor Kiosk</div>
          <div style={{ fontSize: 14, color: "#64748b", marginTop: 6 }}>
            Terminal pro operatora vyroby na stroji.
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 20 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#334155", marginBottom: 6 }}>Stroj</div>
              <select
                value={selectedMachineId}
                onChange={(e) => setSelectedMachineId(Number(e.target.value))}
                style={{
                  width: "100%",
                  border: "1px solid #cbd5e1",
                  borderRadius: 12,
                  padding: "12px 14px",
                  fontSize: 14,
                  background: "#fff",
                }}
              >
                {machines.map((machine) => (
                  <option key={machine.machine_id} value={machine.machine_id}>
                    {machine.machine_name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#334155", marginBottom: 6 }}>Operator</div>
              <input
                type="text"
                value={operatorName}
                onChange={(e) => setOperatorName(e.target.value)}
                placeholder="napr. Tomas / operator 1"
                style={{
                  width: "100%",
                  border: "1px solid #cbd5e1",
                  borderRadius: 12,
                  padding: "12px 14px",
                  fontSize: 14,
                  background: "#fff",
                }}
              />
            </div>
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

          {message ? (
            <div
              style={{
                marginTop: 16,
                padding: "12px 14px",
                borderRadius: 12,
                background: "#f0fdf4",
                color: "#15803d",
                border: "1px solid #bbf7d0",
                fontSize: 14,
                fontWeight: 700,
              }}
            >
              {message}
            </div>
          ) : null}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "420px 1fr", gap: 20 }}>
          <div
            style={{
              background: "#fff",
              border: "1px solid #dbe2ea",
              borderRadius: 20,
              padding: 20,
              boxShadow: "0 1px 2px rgba(15,23,42,0.05)",
              maxHeight: "70vh",
              overflowY: "auto",
            }}
          >
            <div style={{ fontSize: 20, fontWeight: 900, color: "#0f172a", marginBottom: 16 }}>
              Operace stroje
            </div>

            {loading ? (
              <div style={{ color: "#64748b", fontWeight: 700 }}>Nacitam...</div>
            ) : operations.length === 0 ? (
              <div style={{ color: "#64748b", fontWeight: 700 }}>Zadne operace pro stroj.</div>
            ) : (
              <div style={{ display: "grid", gap: 10 }}>
                {operations.map((op) => (
                  <button
                    key={op.id}
                    onClick={() => {
                      setSelectedOperation(op);
                      setQtyOk(op.qty_ok ?? op.qty ?? 0);
                      setQtyNok(op.qty_nok ?? 0);
                      setMessage("");
                      setError("");
                    }}
                    style={{
                      textAlign: "left",
                      border: selectedOperation?.id === op.id ? "2px solid #0f172a" : "1px solid #dbe2ea",
                      background: "#fff",
                      borderRadius: 14,
                      padding: 14,
                      cursor: "pointer",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                      <div style={{ fontWeight: 900, color: "#0f172a" }}>{op.operation_name}</div>
                      <span
                        style={{
                          display: "inline-block",
                          padding: "4px 8px",
                          borderRadius: 999,
                          color: "#fff",
                          background: statusColor(op.status),
                          fontSize: 12,
                          fontWeight: 800,
                        }}
                      >
                        {statusLabel(op.status)}
                      </span>
                    </div>

                    <div style={{ fontSize: 13, color: "#334155", marginTop: 8 }}>
                      {op.work_order_no || "-"} | {op.gpn || "-"}
                    </div>
                    <div style={{ fontSize: 12, color: "#64748b", marginTop: 6 }}>
                      Fronta: {op.queue_position ?? "-"} | Qty: {op.qty}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div
            style={{
              background: "#fff",
              border: "1px solid #dbe2ea",
              borderRadius: 20,
              padding: 20,
              boxShadow: "0 1px 2px rgba(15,23,42,0.05)",
            }}
          >
            <div style={{ fontSize: 20, fontWeight: 900, color: "#0f172a", marginBottom: 16 }}>
              Detail operace
            </div>

            {!selectedOperation ? (
              <div style={{ color: "#64748b", fontWeight: 700 }}>Vyber operaci vlevo.</div>
            ) : (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "140px 1fr", gap: 10, fontSize: 15 }}>
                  <div style={{ color: "#64748b", fontWeight: 700 }}>VP</div>
                  <div style={{ color: "#0f172a", fontWeight: 900 }}>{selectedOperation.work_order_no || "-"}</div>

                  <div style={{ color: "#64748b", fontWeight: 700 }}>GPN</div>
                  <div style={{ color: "#0f172a", fontWeight: 900 }}>{selectedOperation.gpn || "-"}</div>

                  <div style={{ color: "#64748b", fontWeight: 700 }}>Operace</div>
                  <div style={{ color: "#0f172a", fontWeight: 900 }}>{selectedOperation.operation_name}</div>

                  <div style={{ color: "#64748b", fontWeight: 700 }}>Stav</div>
                  <div>
                    <span
                      style={{
                        display: "inline-block",
                        padding: "4px 8px",
                        borderRadius: 999,
                        color: "#fff",
                        background: statusColor(selectedOperation.status),
                        fontSize: 12,
                        fontWeight: 800,
                      }}
                    >
                      {statusLabel(selectedOperation.status)}
                    </span>
                  </div>

                  <div style={{ color: "#64748b", fontWeight: 700 }}>Plan start</div>
                  <div style={{ color: "#0f172a", fontWeight: 700 }}>
                    {selectedOperation.planned_start ? new Date(selectedOperation.planned_start).toLocaleString("cs-CZ") : "-"}
                  </div>

                  <div style={{ color: "#64748b", fontWeight: 700 }}>Plan end</div>
                  <div style={{ color: "#0f172a", fontWeight: 700 }}>
                    {selectedOperation.planned_end ? new Date(selectedOperation.planned_end).toLocaleString("cs-CZ") : "-"}
                  </div>

                  <div style={{ color: "#64748b", fontWeight: 700 }}>Actual start</div>
                  <div style={{ color: "#0f172a", fontWeight: 700 }}>
                    {selectedOperation.actual_start ? new Date(selectedOperation.actual_start).toLocaleString("cs-CZ") : "-"}
                  </div>

                  <div style={{ color: "#64748b", fontWeight: 700 }}>Actual end</div>
                  <div style={{ color: "#0f172a", fontWeight: 700 }}>
                    {selectedOperation.actual_end ? new Date(selectedOperation.actual_end).toLocaleString("cs-CZ") : "-"}
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 24 }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#334155", marginBottom: 6 }}>Qty OK</div>
                    <input
                      type="number"
                      value={qtyOk}
                      onChange={(e) => setQtyOk(Number(e.target.value))}
                      style={{
                        width: "100%",
                        border: "1px solid #cbd5e1",
                        borderRadius: 12,
                        padding: "12px 14px",
                        fontSize: 16,
                        background: "#fff",
                      }}
                    />
                  </div>

                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#334155", marginBottom: 6 }}>Qty NOK</div>
                    <input
                      type="number"
                      value={qtyNok}
                      onChange={(e) => setQtyNok(Number(e.target.value))}
                      style={{
                        width: "100%",
                        border: "1px solid #cbd5e1",
                        borderRadius: 12,
                        padding: "12px 14px",
                        fontSize: 16,
                        background: "#fff",
                      }}
                    />
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14, marginTop: 24 }}>
                  <button
                    onClick={handleStart}
                    disabled={working}
                    style={{
                      border: "1px solid #2563eb",
                      background: "#2563eb",
                      color: "#fff",
                      borderRadius: 14,
                      padding: "16px 18px",
                      fontWeight: 900,
                      fontSize: 16,
                      cursor: "pointer",
                      opacity: working ? 0.6 : 1,
                    }}
                  >
                    START
                  </button>

                  <button
                    onClick={handleStop}
                    disabled={working}
                    style={{
                      border: "1px solid #64748b",
                      background: "#64748b",
                      color: "#fff",
                      borderRadius: 14,
                      padding: "16px 18px",
                      fontWeight: 900,
                      fontSize: 16,
                      cursor: "pointer",
                      opacity: working ? 0.6 : 1,
                    }}
                  >
                    STOP
                  </button>

                  <button
                    onClick={handleFinish}
                    disabled={working}
                    style={{
                      border: "1px solid #16a34a",
                      background: "#16a34a",
                      color: "#fff",
                      borderRadius: 14,
                      padding: "16px 18px",
                      fontWeight: 900,
                      fontSize: 16,
                      cursor: "pointer",
                      opacity: working ? 0.6 : 1,
                    }}
                  >
                    HOTOVO
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
