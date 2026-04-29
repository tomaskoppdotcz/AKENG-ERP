import { akengFetch } from "./akengFetch";
import { normalizeCzechKeyboardReaderNumeric } from "../utils/czCardReaderNormalize";

const API_BASE =
  (import.meta as any).env?.VITE_API_BASE_URL || "http://127.0.0.1:8000";

export type KioskMachineInfo = {
  id: number;
  name: string;
  machine_code: string;
};

export type KioskEmployee = {
  id: number;
  name: string;
  employee_code?: string;
};

export type KioskQueueOp = {
  planning_operation_id: number;
  work_order_no: string | null;
  queue_position: number | null;
  gpn: string;
  operation_name: string;
  operation_no: number;
  qty: number;
  planned_start: string | null;
  planned_end: string | null;
  status: string;
  qty_ok: number | null;
  qty_nok: number | null;
  actual_start: string | null;
  actual_end: string | null;
  cutting_instructions: string | null;
  runtime: {
    total_seconds: number;
    pause_seconds: number;
    working_seconds: number;
  };
};

async function parseJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const j = await res.json();
      if (j?.detail) detail = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail);
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  return res.json() as Promise<T>;
}

export async function kioskMachineQueue(machineCode: string) {
  const u = new URL(`${API_BASE}/kiosk/machine-queue`);
  u.searchParams.set("machine_code", machineCode);
  return parseJson<{
    kiosk_code: string;
    machine: KioskMachineInfo;
    employee: KioskEmployee | null;
    queue: KioskQueueOp[];
  }>(await akengFetch(u.toString()));
}

export async function kioskSession(machineCode: string) {
  const u = new URL(`${API_BASE}/kiosk/session`);
  u.searchParams.set("machine_code", machineCode);
  return parseJson<{
    kiosk_code: string;
    machine: KioskMachineInfo;
    employee: KioskEmployee | null;
    session_started_at: string | null;
    login_state: "active" | "none";
    has_active_session: boolean;
  }>(await akengFetch(u.toString()));
}

export async function kioskLogin(machineCode: string, employeeCode: string) {
  return parseJson<{
    status: string;
    employee: KioskEmployee & { employee_code: string };
    machine: KioskMachineInfo;
  }>(
    await akengFetch(`${API_BASE}/kiosk/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ machine_code: machineCode, employee_code: employeeCode }),
    })
  );
}

/** Přihlášení: nejdřív token jako u login (kód/čip/sken), pak ověření PIN. */
export async function kioskLoginWithPin(machineCode: string, employeeHint: string, pinCode: string) {
  const hint = normalizeCzechKeyboardReaderNumeric(employeeHint.trim());
  return parseJson<{
    status: string;
    employee: KioskEmployee & { employee_code: string };
    machine: KioskMachineInfo;
  }>(
    await akengFetch(`${API_BASE}/kiosk/login-pin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        machine_code: machineCode,
        employee_hint: hint,
        pin_code: pinCode,
      }),
    })
  );
}

/** Bez založení session — náhled operátora po načtení karty/skenem. */
export async function kioskResolveEmployee(machineCode: string, credential: string) {
  const u = new URL(`${API_BASE}/kiosk/employee/resolve`);
  u.searchParams.set("machine_code", machineCode);
  u.searchParams.set("credential", normalizeCzechKeyboardReaderNumeric(credential.trim()));
  return parseJson<{
    employee: KioskEmployee & { employee_code: string; has_pin: boolean };
  }>(await akengFetch(u.toString()));
}

export async function kioskLogout(machineCode: string) {
  return parseJson<{ status: string }>(
    await akengFetch(`${API_BASE}/kiosk/logout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ machine_code: machineCode }),
    })
  );
}

export async function kioskResolveScan(machineCode: string, code: string) {
  const u = new URL(`${API_BASE}/kiosk/resolve-scan`);
  u.searchParams.set("machine_code", machineCode);
  u.searchParams.set("code", normalizeCzechKeyboardReaderNumeric(code.trim()));
  return parseJson<{ status: string; operation: KioskQueueOp }>(await akengFetch(u.toString()));
}

export async function kioskOperationStart(machineCode: string, planningOperationId: number) {
  return parseJson<Record<string, unknown>>(
    await akengFetch(`${API_BASE}/kiosk/operation-tracking/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ machine_code: machineCode, planning_operation_id: planningOperationId }),
    })
  );
}

export async function kioskOperationPause(
  machineCode: string,
  planningOperationId: number,
  pauseReason?: string
) {
  return parseJson<Record<string, unknown>>(
    await akengFetch(`${API_BASE}/kiosk/operation-tracking/pause`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        machine_code: machineCode,
        planning_operation_id: planningOperationId,
        pause_reason: pauseReason,
        reason: pauseReason,
      }),
    })
  );
}

export async function kioskOperationResume(machineCode: string, planningOperationId: number) {
  return parseJson<Record<string, unknown>>(
    await akengFetch(`${API_BASE}/kiosk/operation-tracking/resume`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ machine_code: machineCode, planning_operation_id: planningOperationId }),
    })
  );
}

export async function kioskOperationDone(
  machineCode: string,
  planningOperationId: number,
  qtyOk: number,
  qtyNok: number,
  note?: string | null
) {
  return parseJson<Record<string, unknown>>(
    await akengFetch(`${API_BASE}/kiosk/operation-tracking/done`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        machine_code: machineCode,
        planning_operation_id: planningOperationId,
        qty_ok: qtyOk,
        qty_nok: qtyNok,
        note: note ?? null,
      }),
    })
  );
}

export async function kioskActivity(machineCode: string, activityType: string, note?: string) {
  return parseJson<{ status: string }>(
    await akengFetch(`${API_BASE}/kiosk/activity`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ machine_code: machineCode, activity_type: activityType, note }),
    })
  );
}
