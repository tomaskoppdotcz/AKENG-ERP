import React, { useCallback, useEffect, useState } from "react";
import {
  kioskMachineQueue,
  kioskOperationDone,
  kioskOperationPause,
  kioskOperationResume,
  kioskOperationStart,
  kioskResolveScan,
  type KioskQueueOp,
} from "../services/kioskApi";

const shell: React.CSSProperties = {
  minHeight: "100vh",
  background: "#102820",
  color: "#e8f5f6",
  fontFamily: "Arial, sans-serif",
  padding: 20,
  boxSizing: "border-box",
};

const bigBtn: React.CSSProperties = {
  minHeight: 64,
  fontSize: 22,
  fontWeight: 800,
  padding: "14px 18px",
  borderRadius: 12,
  border: "none",
  cursor: "pointer",
  margin: 6,
};

const inputStyle: React.CSSProperties = {
  fontSize: 24,
  padding: 16,
  width: "100%",
  maxWidth: 520,
  borderRadius: 10,
  border: "3px solid #4caf50",
  boxSizing: "border-box",
};

type Props = { machineCode: string };

export default function KioskProductionPage({ machineCode }: Props) {
  const [queue, setQueue] = useState<KioskQueueOp[]>([]);
  const [machineName, setMachineName] = useState("");
  const [selected, setSelected] = useState<KioskQueueOp | null>(null);
  const [scan, setScan] = useState("");
  const [qtyOk, setQtyOk] = useState(0);
  const [qtyNok, setQtyNok] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadQueue = useCallback(async () => {
    if (!machineCode.trim()) return;
    try {
      const q = await kioskMachineQueue(machineCode.trim());
      setMachineName(q.machine.name);
      setQueue(q.queue);
    } catch {
      setQueue([]);
    }
  }, [machineCode]);

  useEffect(() => {
    loadQueue();
    const t = window.setInterval(loadQueue, 5000);
    return () => window.clearInterval(t);
  }, [loadQueue]);

  async function onScanSubmit() {
    if (!machineCode.trim() || !scan.trim()) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await kioskResolveScan(machineCode.trim(), scan.trim());
      setSelected(r.operation);
      setScan("");
    } catch (e: unknown) {
      setMsg(e instanceof Error ? e.message : "Scan nebyl rozpoznán");
    } finally {
      setBusy(false);
    }
  }

  async function run(opId: number, fn: () => Promise<unknown>) {
    if (!machineCode.trim()) return;
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      await loadQueue();
    } catch (e: unknown) {
      setMsg(e instanceof Error ? e.message : "Chyba");
    } finally {
      setBusy(false);
    }
  }

  if (!machineCode.trim()) {
    return (
      <div style={{ ...shell, color: "#ffb4b4" }}>
        <h1 style={{ fontSize: 28 }}>Chybí parametr machine</h1>
        <p style={{ fontSize: 18 }}>Otevřete např. /kiosk/production?machine=HAAS_ST40</p>
      </div>
    );
  }

  const selId = selected?.planning_operation_id;

  return (
    <div style={shell}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap" }}>
        <h1 style={{ fontSize: 34, margin: 0 }}>{machineName || "Výroba"}</h1>
        <div style={{ fontSize: 20, opacity: 0.9 }}>{machineCode}</div>
      </div>

      <div style={{ marginTop: 16, marginBottom: 12 }}>
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Scan WOO / operace</div>
        <input
          style={inputStyle}
          value={scan}
          onChange={(e) => setScan(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onScanSubmit()}
          placeholder="WOO-…"
          disabled={busy}
        />
        <button
          type="button"
          style={{ ...bigBtn, background: "#2e7d32", color: "#fff", marginTop: 8 }}
          onClick={onScanSubmit}
          disabled={busy}
        >
          Načíst
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 8 }}>
        <div style={{ background: "#1b3328", borderRadius: 12, padding: 14, border: "1px solid #43a047" }}>
          <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 10 }}>Fronta</div>
          <div style={{ maxHeight: "48vh", overflow: "auto" }}>
            {queue.length === 0 && <div style={{ opacity: 0.8 }}>Žádné operace ve frontě</div>}
            {queue.map((op) => (
              <button
                key={op.planning_operation_id}
                type="button"
                onClick={() => setSelected(op)}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  marginBottom: 8,
                  padding: 12,
                  fontSize: 18,
                  borderRadius: 8,
                  border:
                    selected?.planning_operation_id === op.planning_operation_id
                      ? "3px solid #ffeb3b"
                      : "1px solid #666",
                  background:
                    selected?.planning_operation_id === op.planning_operation_id ? "#2e4a35" : "#24382e",
                  color: "#fff",
                  cursor: "pointer",
                }}
              >
                <strong>{op.work_order_no || `#${op.planning_operation_id}`}</strong> — {op.operation_name}
                <div style={{ fontSize: 14, opacity: 0.85 }}>
                  {op.gpn} · {op.status}
                </div>
              </button>
            ))}
          </div>
        </div>

        <div style={{ background: "#1a2f38", borderRadius: 12, padding: 14, border: "1px solid #29b6f6" }}>
          <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 10 }}>Aktivní operace</div>
          {!selected && <div style={{ opacity: 0.85 }}>Vyberte z fronty nebo naskenujte WOO.</div>}
          {selected && (
            <>
              <div style={{ fontSize: 20, marginBottom: 8 }}>
                <div>
                  <strong>WOO:</strong> {selected.work_order_no || "—"}
                </div>
                <div>
                  <strong>Operace:</strong> {selected.operation_name} (#{selected.operation_no})
                </div>
                <div>
                  <strong>GPN:</strong> {selected.gpn}
                </div>
                <div>
                  <strong>Stav:</strong> {selected.status}
                </div>
              </div>
              <div style={{ display: "flex", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
                <label style={{ fontSize: 18 }}>
                  OK{" "}
                  <input
                    type="number"
                    min={0}
                    value={qtyOk}
                    onChange={(e) => setQtyOk(Number(e.target.value))}
                    style={{ fontSize: 22, width: 100, padding: 8 }}
                  />
                </label>
                <label style={{ fontSize: 18 }}>
                  NOK{" "}
                  <input
                    type="number"
                    min={0}
                    value={qtyNok}
                    onChange={(e) => setQtyNok(Number(e.target.value))}
                    style={{ fontSize: 22, width: 100, padding: 8 }}
                  />
                </label>
              </div>
              <div>
                <button
                  type="button"
                  style={{ ...bigBtn, background: "#2e7d32", color: "#fff" }}
                  disabled={busy || !selId}
                  onClick={() => selId && run(selId, () => kioskOperationStart(machineCode.trim(), selId))}
                >
                  START
                </button>
                <button
                  type="button"
                  style={{ ...bigBtn, background: "#f9a825", color: "#000" }}
                  disabled={busy || !selId}
                  onClick={() => selId && run(selId, () => kioskOperationPause(machineCode.trim(), selId))}
                >
                  PAUZA
                </button>
                <button
                  type="button"
                  style={{ ...bigBtn, background: "#0288d1", color: "#fff" }}
                  disabled={busy || !selId}
                  onClick={() => selId && run(selId, () => kioskOperationResume(machineCode.trim(), selId))}
                >
                  POKRAČOVAT
                </button>
                <button
                  type="button"
                  style={{ ...bigBtn, background: "#c62828", color: "#fff" }}
                  disabled={busy || !selId}
                  onClick={() =>
                    selId &&
                    run(selId, () => kioskOperationDone(machineCode.trim(), selId, qtyOk, qtyNok))
                  }
                >
                  DOKONČIT
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {msg && <div style={{ fontSize: 20, color: "#ffcc80", marginTop: 12 }}>{msg}</div>}
    </div>
  );
}
