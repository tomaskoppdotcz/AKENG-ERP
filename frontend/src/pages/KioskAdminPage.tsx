import React, { useCallback, useEffect, useState } from "react";
import {
  kioskActivity,
  kioskLogin,
  kioskLogout,
  kioskSession,
  type KioskEmployee,
  type KioskMachineInfo,
} from "../services/kioskApi";

const shell: React.CSSProperties = {
  minHeight: "100vh",
  background: "#0f2a30",
  color: "#e8f5f6",
  fontFamily: "Arial, sans-serif",
  padding: 24,
  boxSizing: "border-box",
};

const card: React.CSSProperties = {
  background: "#1a3d44",
  borderRadius: 12,
  padding: 20,
  marginBottom: 16,
  border: "1px solid #a8c7cc",
};

const bigBtn: React.CSSProperties = {
  minHeight: 56,
  fontSize: 20,
  fontWeight: 700,
  padding: "12px 20px",
  borderRadius: 10,
  border: "none",
  cursor: "pointer",
  margin: 6,
};

const inputStyle: React.CSSProperties = {
  fontSize: 22,
  padding: 14,
  width: "100%",
  maxWidth: 420,
  borderRadius: 8,
  border: "2px solid #a8c7cc",
  boxSizing: "border-box",
};

type Props = { machineCode: string };

export default function KioskAdminPage({ machineCode }: Props) {
  const [machine, setMachine] = useState<KioskMachineInfo | null>(null);
  const [employee, setEmployee] = useState<KioskEmployee | null>(null);
  const [sessionStarted, setSessionStarted] = useState<string | null>(null);
  const [loginInput, setLoginInput] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!machineCode.trim()) return;
    try {
      const s = await kioskSession(machineCode.trim());
      setMachine(s.machine);
      setEmployee(s.employee);
      setSessionStarted(s.session_started_at);
    } catch {
      setMachine(null);
      setEmployee(null);
      setSessionStarted(null);
    }
  }, [machineCode]);

  useEffect(() => {
    refresh();
    const t = window.setInterval(refresh, 4000);
    return () => window.clearInterval(t);
  }, [refresh]);

  async function onLogin() {
    if (!machineCode.trim() || !loginInput.trim()) return;
    setBusy(true);
    setMsg(null);
    try {
      await kioskLogin(machineCode.trim(), loginInput.trim());
      setLoginInput("");
      await refresh();
    } catch (e: unknown) {
      setMsg(e instanceof Error ? e.message : "Chyba přihlášení");
    } finally {
      setBusy(false);
    }
  }

  async function onLogout() {
    if (!machineCode.trim()) return;
    setBusy(true);
    setMsg(null);
    try {
      await kioskLogout(machineCode.trim());
      await refresh();
    } catch (e: unknown) {
      setMsg(e instanceof Error ? e.message : "Chyba odhlášení");
    } finally {
      setBusy(false);
    }
  }

  async function act(activityType: string) {
    if (!machineCode.trim()) return;
    setBusy(true);
    setMsg(null);
    try {
      await kioskActivity(machineCode.trim(), activityType);
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
        <p style={{ fontSize: 18 }}>Otevřete např. /kiosk/admin?machine=HAASST40</p>
      </div>
    );
  }

  return (
    <div style={shell}>
      <h1 style={{ fontSize: 32, marginTop: 0 }}>Kiosk — administrace</h1>
      <div style={card}>
        <div style={{ fontSize: 22, fontWeight: 700 }}>Stroj</div>
        <div style={{ fontSize: 20, marginTop: 8 }}>
          {machine ? `${machine.name} (${machine.machine_code})` : "…"}
        </div>
      </div>

      <div style={card}>
        <div style={{ fontSize: 22, fontWeight: 700 }}>Operátor</div>
        <div style={{ fontSize: 20, marginTop: 8 }}>
          {employee ? `${employee.name}` : "Nepřihlášen"}
        </div>
        {sessionStarted && (
          <div style={{ fontSize: 14, opacity: 0.85, marginTop: 6 }}>Session: {sessionStarted}</div>
        )}
      </div>

      <div style={card}>
        <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 10 }}>Přihlášení (kód / karta)</div>
        <input
          style={inputStyle}
          value={loginInput}
          onChange={(e) => setLoginInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onLogin()}
          placeholder="Naskenujte kód operátora"
          disabled={busy}
        />
        <div style={{ marginTop: 12 }}>
          <button type="button" style={{ ...bigBtn, background: "#4caf50", color: "#fff" }} onClick={onLogin} disabled={busy}>
            Přihlásit
          </button>
          <button type="button" style={{ ...bigBtn, background: "#c62828", color: "#fff" }} onClick={onLogout} disabled={busy}>
            Odhlásit
          </button>
        </div>
      </div>

      <div style={card}>
        <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 10 }}>Docházka</div>
        <button type="button" style={{ ...bigBtn, background: "#0277bd", color: "#fff" }} onClick={() => act("attendance_start")} disabled={busy}>
          Začátek směny
        </button>
        <button type="button" style={{ ...bigBtn, background: "#01579b", color: "#fff" }} onClick={() => act("attendance_end")} disabled={busy}>
          Konec směny
        </button>
      </div>

      <div style={card}>
        <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 10 }}>Režimy / režijní</div>
        <button type="button" style={{ ...bigBtn, background: "#6a1b9a", color: "#fff" }} onClick={() => act("overhead_setup")} disabled={busy}>
          Seřizování
        </button>
        <button type="button" style={{ ...bigBtn, background: "#4527a0", color: "#fff" }} onClick={() => act("overhead_maintenance")} disabled={busy}>
          Údržba
        </button>
        <button type="button" style={{ ...bigBtn, background: "#37474f", color: "#fff" }} onClick={() => act("overhead_wait")} disabled={busy}>
          Čekání
        </button>
        <button type="button" style={{ ...bigBtn, background: "#2e7d32", color: "#fff" }} onClick={() => act("overhead_internal")} disabled={busy}>
          Interní práce
        </button>
      </div>

      <div style={card}>
        <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>Dokumentace</div>
        <div style={{ fontSize: 16, opacity: 0.9 }}>Zde budou odkazy na výkresy / postupy (MVP placeholder).</div>
      </div>

      {msg && (
        <div style={{ fontSize: 18, color: "#ffcc80", marginTop: 8 }}>{msg}</div>
      )}
    </div>
  );
}
