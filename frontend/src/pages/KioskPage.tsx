import React, { useState } from "react";
import { akengFetch } from "../services/akengFetch";
import { normalizeCzechKeyboardReaderNumeric } from "../utils/czCardReaderNormalize";

const API_BASE = "http://127.0.0.1:8001";
const KIOSK_CODE = "KIOSK_CTX_BETA_800";

type QueueItem = {
  planning_operation_id: number;
  queue_position: number;
  gpn: string;
  operation_name: string;
  qty: number;
  planned_start: string | null;
  planned_end: string | null;
  status: string;
};

type QueueResponse = {
  machine: { id: number; name: string };
  employee: { id: number; name: string } | null;
  queue: QueueItem[];
};

export default function KioskPage() {
  const [employeeName, setEmployeeName] = useState<string>("");
  const [machineName, setMachineName] = useState<string>("CTX BETA 800");
  const [loggedIn, setLoggedIn] = useState(false);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [runningOp, setRunningOp] = useState<QueueItem | null>(null);
  const [qtyOk, setQtyOk] = useState("0");
  const [qtyNok, setQtyNok] = useState("0");
  const [note, setNote] = useState("");

  async function refreshQueue() {
    const res = await akengFetch(
      `${API_BASE}/kiosk/machine-queue?kiosk_code=${encodeURIComponent(KIOSK_CODE)}`
    );
    const data: QueueResponse = await res.json();
    setMachineName(data.machine.name);
    setEmployeeName(data.employee?.name ?? "");
    const q = data.queue ?? [];
    setQueue(q);
    const runningStatuses = new Set(["bezi", "running"]);
    const live = q.find((x) => runningStatuses.has(String(x.status || "").toLowerCase()));
    setRunningOp((prev) => {
      if (live) return live;
      if (prev && q.some((x) => x.planning_operation_id === prev.planning_operation_id)) return prev;
      return null;
    });
  }

  async function loginCard(cardUid: string) {
    const res = await akengFetch(`${API_BASE}/kiosk/login-card`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kiosk_code: KIOSK_CODE,
        card_uid: normalizeCzechKeyboardReaderNumeric(cardUid.trim()),
      }),
    });

    if (!res.ok) {
      alert("Karta nebyla nalezena");
      return;
    }

    const data = await res.json();
    setEmployeeName(data.employee.name);
    setMachineName(data.machine.name);
    setLoggedIn(true);
    await refreshQueue();
  }

  async function startFirstOperation() {
    if (!queue.length) return;

    const first = queue[0];
    const runningStatuses = new Set(["bezi", "running"]);
    const already = queue.find((x) => runningStatuses.has(String(x.status || "").toLowerCase()));
    if (already) {
      setRunningOp(already);
      return;
    }

    const res = await akengFetch(`${API_BASE}/kiosk/start-operation`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kiosk_code: KIOSK_CODE,
        planning_operation_id: first.planning_operation_id,
      }),
    });

    if (!res.ok) {
      alert("Operaci se nepodařilo spustit");
      return;
    }

    setRunningOp(first);
  }

  async function finishOperation() {
    if (!runningOp) return;

    const res = await akengFetch(`${API_BASE}/kiosk/finish-operation`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kiosk_code: KIOSK_CODE,
        planning_operation_id: runningOp.planning_operation_id,
        qty_ok: Number(qtyOk || 0),
        qty_nok: Number(qtyNok || 0),
        note,
      }),
    });

    if (!res.ok) {
      alert("Operaci se nepodařilo ukončit");
      return;
    }

    setRunningOp(null);
    setQtyOk("0");
    setQtyNok("0");
    setNote("");
    await refreshQueue();
  }

  if (!loggedIn) {
    return (
      <div
        style={{
          minHeight: "100vh",
          background: "#0f172a",
          color: "#fff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "Arial, sans-serif",
          padding: 24,
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: 700,
            background: "#111827",
            borderRadius: 24,
            padding: 32,
            border: "1px solid #334155",
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: 20, opacity: 0.8, marginBottom: 12 }}>AKENG KIOSK</div>
          <div style={{ fontSize: 40, fontWeight: 700, marginBottom: 8 }}>{machineName}</div>
          <div style={{ fontSize: 24, marginBottom: 28 }}>Přiložte kartu</div>

          <div style={{ display: "grid", gap: 16 }}>
            <button
              onClick={() => loginCard("CARD001")}
              style={{
                fontSize: 28,
                padding: "22px 24px",
                borderRadius: 18,
                border: "none",
                background: "#22c55e",
                color: "#fff",
                cursor: "pointer",
                fontWeight: 700,
              }}
            >
              Simulovat kartu CARD001
            </button>

            <button
              onClick={() => loginCard("CARD002")}
              style={{
                fontSize: 28,
                padding: "22px 24px",
                borderRadius: 18,
                border: "none",
                background: "#3b82f6",
                color: "#fff",
                cursor: "pointer",
                fontWeight: 700,
              }}
            >
              Simulovat kartu CARD002
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (runningOp) {
    return (
      <div
        style={{
          minHeight: "100vh",
          background: "#f8fafc",
          fontFamily: "Arial, sans-serif",
          padding: 24,
        }}
      >
        <div
          style={{
            maxWidth: 1100,
            margin: "0 auto",
            background: "#fff",
            borderRadius: 24,
            border: "1px solid #d1d5db",
            padding: 32,
          }}
        >
          <div style={{ fontSize: 20, color: "#555", marginBottom: 10 }}>
            STROJ: {machineName}
          </div>
          <div style={{ fontSize: 20, color: "#555", marginBottom: 24 }}>
            OPERÁTOR: {employeeName}
          </div>

          <div style={{ fontSize: 40, fontWeight: 800, marginBottom: 12 }}>{runningOp.gpn}</div>
          <div style={{ fontSize: 32, marginBottom: 10 }}>{runningOp.operation_name}</div>
          <div style={{ fontSize: 24, marginBottom: 24 }}>Množství: {runningOp.qty} ks</div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 24,
              marginBottom: 28,
            }}
          >
            <div>
              <label style={{ display: "block", fontSize: 22, marginBottom: 8 }}>Kusy OK</label>
              <input
                value={qtyOk}
                onChange={(e) => setQtyOk(e.target.value)}
                style={{
                  width: "100%",
                  fontSize: 28,
                  padding: 16,
                  borderRadius: 14,
                  border: "1px solid #cbd5e1",
                }}
              />
            </div>

            <div>
              <label style={{ display: "block", fontSize: 22, marginBottom: 8 }}>Kusy NOK</label>
              <input
                value={qtyNok}
                onChange={(e) => setQtyNok(e.target.value)}
                style={{
                  width: "100%",
                  fontSize: 28,
                  padding: 16,
                  borderRadius: 14,
                  border: "1px solid #cbd5e1",
                }}
              />
            </div>
          </div>

          <div style={{ marginBottom: 28 }}>
            <label style={{ display: "block", fontSize: 22, marginBottom: 8 }}>Poznámka</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={4}
              style={{
                width: "100%",
                fontSize: 22,
                padding: 16,
                borderRadius: 14,
                border: "1px solid #cbd5e1",
              }}
            />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
            <button
              onClick={() => setRunningOp(null)}
              style={{
                fontSize: 28,
                padding: "24px 24px",
                borderRadius: 18,
                border: "none",
                background: "#f59e0b",
                color: "#fff",
                cursor: "pointer",
                fontWeight: 700,
              }}
            >
              Zpět
            </button>

            <button
              onClick={finishOperation}
              style={{
                fontSize: 28,
                padding: "24px 24px",
                borderRadius: 18,
                border: "none",
                background: "#16a34a",
                color: "#fff",
                cursor: "pointer",
                fontWeight: 700,
              }}
            >
              HOTOVO
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#f8fafc",
        fontFamily: "Arial, sans-serif",
        padding: 24,
      }}
    >
      <div
        style={{
          maxWidth: 1200,
          margin: "0 auto",
          background: "#fff",
          borderRadius: 24,
          border: "1px solid #d1d5db",
          padding: 32,
        }}
      >
        <div style={{ fontSize: 20, color: "#555", marginBottom: 10 }}>AKENG KIOSK</div>
        <div style={{ fontSize: 42, fontWeight: 800, marginBottom: 8 }}>{machineName}</div>
        <div style={{ fontSize: 26, marginBottom: 8 }}>Operátor: {employeeName}</div>
        <div style={{ fontSize: 22, color: "#666", marginBottom: 28 }}>Fronta stroje</div>

        <div style={{ display: "grid", gap: 16, marginBottom: 30 }}>
          {queue.map((item) => (
            <div
              key={item.planning_operation_id}
              style={{
                border: item.queue_position === 1 ? "3px solid #16a34a" : "1px solid #d1d5db",
                borderRadius: 18,
                padding: 20,
                background: item.queue_position === 1 ? "#f0fdf4" : "#fff",
              }}
            >
              <div style={{ fontSize: 18, color: "#666", marginBottom: 6 }}>
                Pozice {item.queue_position}
              </div>
              <div style={{ fontSize: 34, fontWeight: 800 }}>{item.gpn}</div>
              <div style={{ fontSize: 26, marginBottom: 6 }}>{item.operation_name}</div>
              <div style={{ fontSize: 22 }}>Množství: {item.qty} ks</div>
              <div style={{ fontSize: 20, color: "#666" }}>
                Plán: {item.planned_start?.slice(11, 16)}–{item.planned_end?.slice(11, 16)}
              </div>
            </div>
          ))}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
          <button
            onClick={refreshQueue}
            style={{
              fontSize: 28,
              padding: "24px 24px",
              borderRadius: 18,
              border: "none",
              background: "#3b82f6",
              color: "#fff",
              cursor: "pointer",
              fontWeight: 700,
            }}
          >
            Obnovit frontu
          </button>

          <button
            onClick={startFirstOperation}
            disabled={!queue.length}
            style={{
              fontSize: 28,
              padding: "24px 24px",
              borderRadius: 18,
              border: "none",
              background: queue.length ? "#16a34a" : "#94a3b8",
              color: "#fff",
              cursor: queue.length ? "pointer" : "not-allowed",
              fontWeight: 700,
            }}
          >
            START OPERACE
          </button>
        </div>
      </div>
    </div>
  );
}
