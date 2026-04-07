import { akengFetch } from "./akengFetch";

export type PlannerGanttItem = {
  operationId: number;
  orderItemId: number | null;
  /** VP id when work_order_no matches production_orders.vp_code */
  productionOrderId?: number | null;
  workOrderNo: string | null;
  gpn: string | null;
  operationName: string;
  operationNo: number;
  machineId: number;
  machineName: string;
  /** Kód pracoviště (knihovna), pro štítky v Gantt bloku */
  workplaceCode?: string | null;
  /** Následující pracoviště na VP (routing) */
  nextWorkplaceCode?: string | null;
  workplaceId?: number;
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
  isLocked?: boolean;
};

export type PlannerGanttMachineGroup = {
  machineId: number;
  machineName: string;
  /** Řádek Gantt = pracoviště z knihovny (Settings → Pracoviště) */
  workplaceId?: number;
  workplaceCode?: string | null;
  items: PlannerGanttItem[];
};

export type PlannerGanttResponse = {
  from: string;
  to: string;
  days: string[];
  machines: PlannerGanttMachineGroup[];
  unscheduledItems: PlannerGanttItem[];
};

export type LiveStatusCounts = {
  bezi: number;
  hotovo: number;
  ceka: number;
  blokovano: number;
  naplanovano: number;
};

export type CapacityDashboardMachine = {
  machine_id: number;
  machine_name: string;
  machine_code: string;
  days: number;
  from_date: string;
  to_date: string;
  available_minutes: number;
  planned_minutes: number;
  free_minutes: number;
  utilization_percent: number;
  scheduled_operations: number;
  live_status: LiveStatusCounts;
};

export type CapacityDashboardResponse = {
  days: number;
  from_date: string;
  to_date: string;
  machines: CapacityDashboardMachine[];
  live_status: LiveStatusCounts;
};

export type AutoPlannerWorkOrdersResponse = {
  work_orders: string[];
};

export type AutoPlannerResult = {
  status: string;
  work_order_no: string;
  operations_found: number;
  machines_rebuilt: {
    machine_id: number;
    scheduled_rows: number;
  }[];
};

export type KioskMachine = {
  machine_id: number;
  machine_name: string;
  machine_code: string;
};

export type KioskMachinesResponse = {
  machines: KioskMachine[];
};

export type KioskOperation = {
  id: number;
  work_order_no: string | null;
  gpn: string | null;
  operation_name: string;
  operation_no: number;
  qty: number;
  queue_position: number | null;
  status: string;
  planned_start: string | null;
  planned_end: string | null;
  qty_ok: number | null;
  qty_nok: number | null;
  actual_start: string | null;
  actual_end: string | null;
};

export type KioskOperationsResponse = {
  operations: KioskOperation[];
};

const API_BASE = (import.meta as any).env?.VITE_API_BASE_URL || "http://127.0.0.1:8000";

async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const res = await akengFetch(url, { ...init, headers });

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

export async function updatePlanningOperation(payload: {
  planningOperationId: number;
  status?: string;
  materialReady?: boolean;
  isLocked?: boolean;
}) {
  return apiFetch(`${API_BASE}/planning/update-operation`, {
    method: "POST",
    body: JSON.stringify({
      planning_operation_id: payload.planningOperationId,
      status: payload.status,
      material_ready: payload.materialReady,
      is_locked: payload.isLocked,
    }),
  });
}

export async function getCapacityDashboard(days: number = 14): Promise<CapacityDashboardResponse> {
  return apiFetch<CapacityDashboardResponse>(`${API_BASE}/capacity-dashboard/overview?days=${days}`);
}

export async function getAutoPlannerWorkOrders(): Promise<AutoPlannerWorkOrdersResponse> {
  return apiFetch<AutoPlannerWorkOrdersResponse>(`${API_BASE}/auto-planner/work-orders`);
}

export async function autoPlanWorkOrder(workOrderNo: string): Promise<AutoPlannerResult> {
  return apiFetch<AutoPlannerResult>(`${API_BASE}/auto-planner/plan-work-order`, {
    method: "POST",
    body: JSON.stringify({
      work_order_no: workOrderNo,
    }),
  });
}

export async function getKioskMachines(): Promise<KioskMachinesResponse> {
  return apiFetch<KioskMachinesResponse>(`${API_BASE}/shopfloor-kiosk/machines`);
}

export async function getKioskMachineOperations(machineId: number): Promise<KioskOperationsResponse> {
  return apiFetch<KioskOperationsResponse>(`${API_BASE}/shopfloor-kiosk/machine-operations?machine_id=${machineId}`);
}

export async function kioskStartOperation(payload: {
  planningOperationId: number;
  operatorName?: string;
}) {
  return apiFetch(`${API_BASE}/shopfloor-kiosk/start`, {
    method: "POST",
    body: JSON.stringify({
      planning_operation_id: payload.planningOperationId,
      operator_name: payload.operatorName || null,
    }),
  });
}

export async function kioskStopOperation(payload: {
  planningOperationId: number;
  operatorName?: string;
}) {
  return apiFetch(`${API_BASE}/shopfloor-kiosk/stop`, {
    method: "POST",
    body: JSON.stringify({
      planning_operation_id: payload.planningOperationId,
      operator_name: payload.operatorName || null,
    }),
  });
}

export async function kioskFinishOperation(payload: {
  planningOperationId: number;
  qtyOk: number;
  qtyNok: number;
  operatorName?: string;
}) {
  return apiFetch(`${API_BASE}/shopfloor-kiosk/finish`, {
    method: "POST",
    body: JSON.stringify({
      planning_operation_id: payload.planningOperationId,
      qty_ok: payload.qtyOk,
      qty_nok: payload.qtyNok,
      operator_name: payload.operatorName || null,
    }),
  });
}
