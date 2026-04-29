import React, { useCallback, useEffect, useState } from "react";
import { WORK_REPORT_PAUSE_REASONS } from "../constants/workReportPauseReasons";
import {
  kioskMachineQueue,
  kioskOperationDone,
  kioskOperationPause,
  kioskOperationResume,
  kioskOperationStart,
  kioskResolveScan,
  kioskSession,
  type KioskEmployee,
  type KioskMachineInfo,
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

function formatSeconds(seconds: number): string {
  const diffSec = Math.max(0, Math.floor(seconds || 0));
  const hh = Math.floor(diffSec / 3600)
    .toString()
    .padStart(2, "0");
  const mm = Math.floor((diffSec % 3600) / 60)
    .toString()
    .padStart(2, "0");
  const ss = Math.floor(diffSec % 60)
    .toString()
    .padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

function normStatus(op: KioskQueueOp | null): string {
  return (op?.status || "").trim().toLowerCase();
}

function isRunning(op: KioskQueueOp | null): boolean {
  return ["bezi", "running", "in_progress"].includes(normStatus(op));
}

function isPaused(op: KioskQueueOp | null): boolean {
  return ["paused", "ceka"].includes(normStatus(op));
}

function displayedRuntime(op: KioskQueueOp | null, tick: number) {
  void tick;
  const base = op?.runtime ?? { total_seconds: 0, pause_seconds: 0, working_seconds: 0 };
  if (!op || !op.actual_start || op.actual_end) return base;
  const start = new Date(op.actual_start).getTime();
  if (Number.isNaN(start)) return base;
  const elapsed = Math.max(0, Math.floor((Date.now() - start) / 1000));
  const total = Math.max(base.total_seconds, elapsed);
  if (isPaused(op)) {
    const pause = Math.max(base.pause_seconds, total - base.working_seconds);
    return { total_seconds: total, pause_seconds: pause, working_seconds: Math.max(0, total - pause) };
  }
  if (isRunning(op)) {
    return {
      total_seconds: total,
      pause_seconds: base.pause_seconds,
      working_seconds: Math.max(0, total - base.pause_seconds),
    };
  }
  return base;
}

export default function KioskProductionPage({ machineCode }: Props) {
  const [queue, setQueue] = useState<KioskQueueOp[]>([]);
  const [machineInfo, setMachineInfo] = useState<KioskMachineInfo | null>(null);
  const [sessionEmployee, setSessionEmployee] = useState<KioskEmployee | null>(null);
  const [loginState, setLoginState] = useState<"active" | "none" | "unknown">("unknown");
  const [sessionStartedAt, setSessionStartedAt] = useState<string | null>(null);
  const [selected, setSelected] = useState<KioskQueueOp | null>(null);
  const [scan, setScan] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pauseDialogOpen, setPauseDialogOpen] = useState(false);
  const [pauseReason, setPauseReason] = useState<string>("");
  const [runtimeTick, setRuntimeTick] = useState(0);

  const loadSession = useCallback(async () => {
    if (!machineCode.trim()) return;
    try {
      const s = await kioskSession(machineCode.trim());
      setMachineInfo(s.machine);
      setSessionEmployee(s.employee);
      setLoginState(s.login_state);
      setSessionStartedAt(s.session_started_at);
    } catch {
      setSessionEmployee(null);
      setLoginState("none");
      setSessionStartedAt(null);
    }
  }, [machineCode]);

  const loadQueue = useCallback(async () => {
    if (!machineCode.trim()) return;
    try {
      const q = await kioskMachineQueue(machineCode.trim());
      setMachineInfo(q.machine);
      setQueue(q.queue);
      setSelected((prev) =>
        prev ? q.queue.find((op) => op.planning_operation_id === prev.planning_operation_id) ?? prev : prev
      );
    } catch {
      setQueue([]);
    }
  }, [machineCode]);

  const refreshAll = useCallback(async () => {
    await Promise.all([loadSession(), loadQueue()]);
  }, [loadSession, loadQueue]);

  useEffect(() => {
    refreshAll();
    const t = window.setInterval(refreshAll, 6000);
    return () => window.clearInterval(t);
  }, [refreshAll]);

  useEffect(() => {
    const t = window.setInterval(() => setRuntimeTick((v) => v + 1), 1000);
    return () => window.clearInterval(t);
  }, []);

  const operatorLoggedIn = loginState === "active" && sessionEmployee != null;
  const runningOp = queue.find((op) => isRunning(op)) ?? null;
  const dominantOp = selected ?? runningOp;

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
    if (!operatorLoggedIn) {
      setMsg("Není přihlášen operátor");
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      await refreshAll();
    } catch (e: unknown) {
      setMsg(e instanceof Error ? e.message : "Chyba");
    } finally {
      setBusy(false);
    }
  }

  async function confirmPause() {
    if (!dominantOp?.planning_operation_id || !pauseReason) return;
    await run(dominantOp.planning_operation_id, () =>
      kioskOperationPause(machineCode.trim(), dominantOp.planning_operation_id, pauseReason)
    );
    setPauseDialogOpen(false);
    setPauseReason("");
  }

  if (!machineCode.trim()) {
    return (
      <div style={{ ...shell, color: "#ffb4b4" }}>
        <h1 style={{ fontSize: 28 }}>Chybí parametr machine</h1>
        <p style={{ fontSize: 18 }}>Otevřete např. /kiosk/production?machine=HAASST40</p>
      </div>
    );
  }

  const selId = dominantOp?.planning_operation_id;
  const mc = machineInfo?.machine_code ?? machineCode.trim();
  const currentRuntime = displayedRuntime(dominantOp, runtimeTick);
  const canStart = Boolean(dominantOp && !dominantOp.actual_start && normStatus(dominantOp) !== "hotovo");
  const canPause = Boolean(dominantOp && isRunning(dominantOp));
  const canResume = Boolean(dominantOp && isPaused(dominantOp));
  const canDone = Boolean(dominantOp && dominantOp.actual_start && normStatus(dominantOp) !== "hotovo");

  return (
    <div style={shell}>
      <div
        style={{
          background: operatorLoggedIn ? "#1b3a1e" : "#4a1818",
          border: `2px solid ${operatorLoggedIn ? "#66bb6a" : "#e57373"}`,
          borderRadius: 12,
          padding: "14px 18px",
          marginBottom: 16,
        }}
      >
        <div style={{ fontSize: 26, fontWeight: 800, marginBottom: 6 }}>Stroj: {machineInfo?.name || "…"}</div>
        <div style={{ fontSize: 22, opacity: 0.95 }}>
          <strong>Kód stroje:</strong> {mc || "—"}
        </div>
        <div style={{ fontSize: 22, marginTop: 6 }}>
          <strong>Operátor:</strong>{" "}
          {operatorLoggedIn && sessionEmployee ? sessionEmployee.name : "—"}
        </div>
        <div style={{ fontSize: 20, marginTop: 6 }}>
          <strong>Stav přihlášení:</strong>{" "}
          {operatorLoggedIn ? "Přihlášen" : "Nepřihlášen"}
          {sessionStartedAt ? ` · od ${sessionStartedAt}` : ""}
        </div>
        {!operatorLoggedIn && (
          <div style={{ fontSize: 24, fontWeight: 900, color: "#ffecb3", marginTop: 12 }}>
            Není přihlášen operátor
          </div>
        )}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap" }}>
        <h1 style={{ fontSize: 34, margin: 0 }}>Výroba</h1>
        <div style={{ fontSize: 18, opacity: 0.85 }}>Obnovení stavu cca každých 6 s</div>
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

      <div style={{ marginTop: 8, marginBottom: 12 }}>
        <div
          style={{
            background: "#133340",
            borderRadius: 12,
            padding: 16,
            border: "2px solid #4fc3f7",
          }}
        >
          <div style={{ fontSize: 24, fontWeight: 900, marginBottom: 8 }}>Aktivní fokus operace</div>
          {!dominantOp && <div style={{ opacity: 0.85 }}>Vyberte z fronty nebo naskenujte WOO.</div>}
          {dominantOp && (
            <div style={{ fontSize: 22, lineHeight: 1.35 }}>
              <div>
                <strong>GPN:</strong> {dominantOp.gpn}
              </div>
              <div>
                <strong>Operace:</strong> {dominantOp.operation_name}
              </div>
              <div>
                <strong>Stav:</strong> {dominantOp.status}
              </div>
              <div>
                <strong>Timer:</strong> {formatSeconds(currentRuntime.working_seconds)}
              </div>
            </div>
          )}
        </div>
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
                    dominantOp?.planning_operation_id === op.planning_operation_id
                      ? "3px solid #ffeb3b"
                      : "1px solid #666",
                  background:
                    dominantOp?.planning_operation_id === op.planning_operation_id ? "#2e4a35" : "#24382e",
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
          {!dominantOp && <div style={{ opacity: 0.85 }}>Vyberte z fronty nebo naskenujte WOO.</div>}
          {dominantOp && (
            <>
              <div style={{ fontSize: 20, marginBottom: 8 }}>
                <div>
                  <strong>WOO:</strong> {dominantOp.work_order_no || "—"}
                </div>
                <div>
                  <strong>Operace:</strong> {dominantOp.operation_name} (#{dominantOp.operation_no})
                </div>
                <div>
                  <strong>GPN:</strong> {dominantOp.gpn}
                </div>
                <div>
                  <strong>Stav:</strong> {dominantOp.status}
                </div>
                <div>
                  <strong>Plán ks:</strong> {dominantOp.qty}
                  {dominantOp.qty_ok != null ? ` · OK ${dominantOp.qty_ok}` : ""}
                </div>
              </div>
              <div style={{ background: "#0f2530", borderRadius: 10, padding: 12, marginBottom: 12 }}>
                <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 6 }}>Časy</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(120px, 1fr))", gap: 10 }}>
                  <div>Celkem: {formatSeconds(currentRuntime.total_seconds)}</div>
                  <div>Pauza: {formatSeconds(currentRuntime.pause_seconds)}</div>
                  <div>Práce: {formatSeconds(currentRuntime.working_seconds)}</div>
                </div>
              </div>
              <div style={{ background: "#173226", borderRadius: 10, padding: 12, marginBottom: 12 }}>
                <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 6 }}>Instrukce řezání</div>
                <pre style={{ whiteSpace: "pre-wrap", margin: 0, fontSize: 16, lineHeight: 1.35 }}>
                  {dominantOp.cutting_instructions || "—"}
                </pre>
              </div>
              <div>
                {canStart && (
                  <button
                    type="button"
                    style={{ ...bigBtn, background: "#2e7d32", color: "#fff", opacity: busy || !selId || !operatorLoggedIn ? 0.45 : 1 }}
                    disabled={busy || !selId || !operatorLoggedIn}
                    onClick={() => selId && run(selId, () => kioskOperationStart(machineCode.trim(), selId))}
                  >
                    START
                  </button>
                )}
                {canPause && (
                  <button
                    type="button"
                    style={{ ...bigBtn, background: "#f9a825", color: "#000", opacity: busy || !selId || !operatorLoggedIn ? 0.45 : 1 }}
                    disabled={busy || !selId || !operatorLoggedIn}
                    onClick={() => {
                      if (!selId || busy || !operatorLoggedIn) return;
                      setPauseDialogOpen(true);
                    }}
                  >
                    PAUZA
                  </button>
                )}
                {canResume && (
                  <button
                    type="button"
                    style={{ ...bigBtn, background: "#0288d1", color: "#fff", opacity: busy || !selId || !operatorLoggedIn ? 0.45 : 1 }}
                    disabled={busy || !selId || !operatorLoggedIn}
                    onClick={() => selId && run(selId, () => kioskOperationResume(machineCode.trim(), selId))}
                  >
                    POKRAČOVAT
                  </button>
                )}
                {canDone && (
                  <button
                    type="button"
                    style={{ ...bigBtn, background: "#c62828", color: "#fff", opacity: busy || !selId || !operatorLoggedIn ? 0.45 : 1 }}
                    disabled={busy || !selId || !operatorLoggedIn}
                    onClick={() =>
                      selId &&
                      run(selId, () => kioskOperationDone(machineCode.trim(), selId, 0, 0, null))
                    }
                  >
                    Řezání hotovo
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {msg && <div style={{ fontSize: 20, color: "#ffcc80", marginTop: 12 }}>{msg}</div>}

      {pauseDialogOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.55)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
            zIndex: 999,
          }}
        >
          <div
            style={{
              width: "min(680px, 96vw)",
              background: "#0f2530",
              border: "2px solid #90caf9",
              borderRadius: 14,
              padding: 18,
            }}
          >
            <div style={{ fontSize: 30, fontWeight: 900, marginBottom: 12 }}>Důvod pauzy</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              {WORK_REPORT_PAUSE_REASONS.map((reason) => (
                <button
                  key={reason}
                  type="button"
                  onClick={() => setPauseReason(reason)}
                  style={{
                    ...bigBtn,
                    minHeight: 56,
                    margin: 0,
                    background: pauseReason === reason ? "#f9a825" : "#29414f",
                    color: pauseReason === reason ? "#111" : "#fff",
                    border: pauseReason === reason ? "2px solid #ffe082" : "2px solid #44606f",
                  }}
                >
                  {reason}
                </button>
              ))}
            </div>

            {!pauseReason && (
              <div style={{ fontSize: 18, color: "#ffecb3", marginTop: 10 }}>
                Vyberte důvod pauzy pro potvrzení.
              </div>
            )}

            <div style={{ display: "flex", gap: 10, marginTop: 14, justifyContent: "flex-end" }}>
              <button
                type="button"
                style={{ ...bigBtn, background: "#455a64", color: "#fff", minHeight: 56 }}
                onClick={() => {
                  setPauseDialogOpen(false);
                  setPauseReason("");
                }}
                disabled={busy}
              >
                ZRUŠIT
              </button>
              <button
                type="button"
                style={{
                  ...bigBtn,
                  background: "#f9a825",
                  color: "#000",
                  minHeight: 56,
                  opacity: pauseReason ? 1 : 0.5,
                }}
                onClick={confirmPause}
                disabled={busy || !pauseReason}
              >
                POTVRDIT PAUZU
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
