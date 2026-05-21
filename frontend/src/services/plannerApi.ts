import { akengFetch } from "./akengFetch";

/** Kalendářní úsek naplánované operace (např. konec směny + pokračování druhý den). */
export type PlannerGanttScheduleSegment = {
  segmentIndex: number;
  machineId: number;
  plannedStart: string | null;
  plannedEnd: string | null;
  durationMin: number;
};

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
  /** Kod stroje z DB (shoda s kioskem). */
  machineCode?: string | null;
  status: string;
  plannedStart: string | null;
  plannedEnd: string | null;
  /** Úplný seznam segmentů z backendu; pro Gantt buňku se často rozbalí na více řádků. */
  scheduleSegments?: PlannerGanttScheduleSegment[];
  /**
   * Když je položka jeden vizuální segment rozšířeného řádku (expandPlannerGanttItemsForCells).
   */
  ganttSegmentIndex?: number;
  setupTimeMin: number;
  laborTimeTotalMin: number;
  totalOperationTimeMin: number;
  qty: number;
  expeditionDate: string | null;
  queuePosition: number | null;
  materialReady: boolean;
  isLocked?: boolean;
  isCooperation?: boolean;
  cooperationStatus?: string | null;
  cooperationSupplierPurchaseOrderId?: number | null;
  cooperationSentAt?: string | null;
  cooperationReceivedAt?: string | null;
  blockedByCooperation?: boolean;
  cooperationBlocker?: {
    operationId: number;
    operationNo: number;
    operationName: string;
    cooperationStatus: string;
  } | null;
};

export type PlannerGanttMachineGroup = {
  /** Kotva řádku (MIN stroj na pracovišti) — DnD cíl; položky mají vlastní machineId. */
  machineId: number;
  machineName: string;
  /** Řádek Gantt = pracoviště z knihovny (Settings → Pracoviště). */
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
  /** Sdílené pracoviště knihovny; více strojů se stejným id se v kiosk selektoru slučuje. */
  workplace_library_item_id?: number | null;
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

function normalizePlannerGanttResponse(raw: unknown, fromDate: string, toDate: string): PlannerGanttResponse {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const days = Array.isArray(r.days) ? (r.days as string[]) : [];
  const machines = Array.isArray(r.machines) ? (r.machines as PlannerGanttMachineGroup[]) : [];
  const unscheduledItems = Array.isArray(r.unscheduledItems)
    ? (r.unscheduledItems as PlannerGanttItem[])
    : [];
  return {
    from: typeof r.from === "string" ? r.from : fromDate,
    to: typeof r.to === "string" ? r.to : toDate,
    days,
    machines,
    unscheduledItems,
  };
}

export async function getPlannerGantt(fromDate: string, toDate: string): Promise<PlannerGanttResponse> {
  const params = new URLSearchParams({
    from_date: fromDate,
    to_date: toDate,
  });

  const raw = await apiFetch<unknown>(`${API_BASE}/planning/gantt?${params.toString()}`);
  return normalizePlannerGanttResponse(raw, fromDate, toDate);
}

export type PlanningRebuildAllResponse = {
  status: string;
  machines?: unknown;
};

/** Globální přepočet rozvrhu (stejné jako engine rebuild_all). */
export async function rebuildPlanningAll(): Promise<PlanningRebuildAllResponse> {
  return apiFetch<PlanningRebuildAllResponse>(`${API_BASE}/planning/rebuild-all`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export type MachineShiftTemplateRow = {
  id: number;
  machine_id: number;
  workplace_library_item_id?: number | null;
  weekday: number;
  start_minutes: number;
  end_minutes: number;
  label: string | null;
  is_active: boolean;
};

export async function getMachineShiftTemplates(params?: {
  machineId?: number;
  workplaceLibraryItemId?: number;
}): Promise<MachineShiftTemplateRow[]> {
  const qs = new URLSearchParams();
  if (params?.workplaceLibraryItemId != null) {
    qs.set("workplace_library_item_id", String(params.workplaceLibraryItemId));
  } else if (params?.machineId != null) {
    qs.set("machine_id", String(params.machineId));
  }
  const q = qs.toString() ? `?${qs.toString()}` : "";
  return apiFetch<MachineShiftTemplateRow[]>(`${API_BASE}/planning/machine-shift-templates${q}`);
}

export async function upsertMachineShiftTemplate(payload: {
  machineId?: number;
  workplaceLibraryItemId?: number;
  weekday: number;
  startMinutes: number;
  endMinutes: number;
  label?: string | null;
  isActive?: boolean;
}): Promise<{ status: string; id: number }> {
  const body: Record<string, unknown> = {
    weekday: payload.weekday,
    start_minutes: payload.startMinutes,
    end_minutes: payload.endMinutes,
    label: payload.label ?? null,
    is_active: payload.isActive ?? true,
  };
  if (payload.workplaceLibraryItemId != null) {
    body.workplace_library_item_id = payload.workplaceLibraryItemId;
  }
  if (payload.machineId != null) {
    body.machine_id = payload.machineId;
  }
  return apiFetch(`${API_BASE}/planning/machine-shift-templates`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export async function regenerateMachineCalendarFromShifts(payload: {
  fromDate: string;
  toDate: string;
  machineId?: number | null;
  workplaceLibraryItemId?: number | null;
}): Promise<{ status: string; days_touched?: number; rows_upserted?: number }> {
  return apiFetch(`${API_BASE}/planning/machine-calendar/regenerate-from-shifts`, {
    method: "POST",
    body: JSON.stringify({
      from_date: payload.fromDate,
      to_date: payload.toDate,
      machine_id: payload.machineId ?? null,
      workplace_library_item_id: payload.workplaceLibraryItemId ?? null,
    }),
  });
}

export async function moveGanttOperation(
  planningOperationId: number,
  targetMachineId: number,
  targetQueuePosition?: number,
  targetDay?: string // F2.2: ISO date YYYY-MM-DD
) {
  return apiFetch(`${API_BASE}/planning/move-gantt`, {
    method: "POST",
    body: JSON.stringify({
      planning_operation_id: planningOperationId,
      target_machine_id: targetMachineId,
      target_queue_position: targetQueuePosition ?? null,
      target_day: targetDay ?? null, // F2.2: optional cross-day target
    }),
  });
}

export async function updatePlanningOperation(payload: {
  planningOperationId: number;
  status?: string;
  materialReady?: boolean;
  isLocked?: boolean;
  isCooperation?: boolean;
  cooperationStatus?: string | null;
  cooperationNote?: string | null;
}) {
  return apiFetch(`${API_BASE}/planning/update-operation`, {
    method: "POST",
    body: JSON.stringify({
      planning_operation_id: payload.planningOperationId,
      status: payload.status,
      material_ready: payload.materialReady,
      is_locked: payload.isLocked,
      is_cooperation: payload.isCooperation,
      cooperation_status: payload.cooperationStatus,
      cooperation_note: payload.cooperationNote,
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

export async function kioskPauseOperation(payload: {
  planningOperationId: number;
  operatorName?: string;
  pauseReason: string;
  note?: string | null;
}) {
  return apiFetch(`${API_BASE}/shopfloor-kiosk/pause`, {
    method: "POST",
    body: JSON.stringify({
      planning_operation_id: payload.planningOperationId,
      operator_name: payload.operatorName || null,
      pause_reason: payload.pauseReason,
      note: payload.note ?? null,
    }),
  });
}

export async function kioskResumeOperation(payload: { planningOperationId: number; operatorName?: string }) {
  return apiFetch(`${API_BASE}/shopfloor-kiosk/resume`, {
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
  note?: string | null;
}) {
  return apiFetch(`${API_BASE}/shopfloor-kiosk/finish`, {
    method: "POST",
    body: JSON.stringify({
      planning_operation_id: payload.planningOperationId,
      qty_ok: payload.qtyOk,
      qty_nok: payload.qtyNok,
      operator_name: payload.operatorName || null,
      note: payload.note ?? null,
    }),
  });
}
