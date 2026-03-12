export type PlannerGanttItem = {
  operationId: number;
  orderItemId: number | null;
  workOrderNo: string | null;
  gpn: string | null;
  operationName: string;
  operationNo: number;
  machineId: number;
  machineName: string;
  status: string;
  plannedStart: string | null;
  plannedEnd: string | null;
  setupTimeMin: number;
  laborTimeTotalMin: number;
  totalOperationTimeMin: number;
  qty: number;
  expeditionDate: string | null;
  queuePosition: number | null;
  materialReady: boolean;
};

export type PlannerGanttMachineGroup = {
  machineId: number;
  machineName: string;
  items: PlannerGanttItem[];
};

export type PlannerGanttResponse = {
  from: string;
  to: string;
  days: string[];
  machines: PlannerGanttMachineGroup[];
  unscheduledItems: PlannerGanttItem[];
};

const API_BASE = (import.meta as any).env?.VITE_API_BASE_URL || "http://127.0.0.1:8000";

async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
    },
    ...init,
  });

  if (!res.ok) {
    let message = "API chyba.";
    try {
      const data = await res.json();
      message = data?.detail || data?.error || message;
    } catch {
    }
    throw new Error(message);
  }

  return res.json();
}

export async function getPlannerGantt(fromDate: string, toDate: string): Promise<PlannerGanttResponse> {
  const params = new URLSearchParams({
    from_date: fromDate,
    to_date: toDate,
  });

  return apiFetch<PlannerGanttResponse>(`${API_BASE}/planning/gantt?${params.toString()}`);
}

export async function moveGanttOperation(
  planningOperationId: number,
  targetMachineId: number,
  targetQueuePosition?: number
) {
  return apiFetch(`${API_BASE}/planning/move-gantt`, {
    method: "POST",
    body: JSON.stringify({
      planning_operation_id: planningOperationId,
      target_machine_id: targetMachineId,
      target_queue_position: targetQueuePosition ?? null,
    }),
  });
}
