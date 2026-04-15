import { akengFetch } from "./akengFetch";

const API_BASE = (import.meta as any).env?.VITE_API_BASE_URL || "http://127.0.0.1:8000";

async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const res = await akengFetch(url, { ...init, headers });
  if (!res.ok) {
    let message = "API chyba.";
    try {
      const data = await res.json();
      message = typeof data?.detail === "string" ? data.detail : data?.detail?.[0]?.msg || message;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export type WorkReportPauseDto = {
  id: number;
  work_report_id: number;
  pause_start: string | null;
  pause_end: string | null;
  pause_reason: string;
  note: string | null;
  created_at: string | null;
};

export type WorkReportDto = {
  id: number;
  employee_id: number | null;
  operator_display: string | null;
  customer_order_id: number | null;
  job_item_id: number | null;
  production_order_id: number | null;
  planning_operation_id: number;
  machine_id: number;
  workplace_library_item_id: number | null;
  operation_no: number;
  operation_name: string;
  started_at: string | null;
  ended_at: string | null;
  duration_min: number | null;
  qty_ok: number | null;
  qty_nok: number | null;
  note: string | null;
  source: string;
  kiosk_session_id: number | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string | null;
  updated_at: string | null;
  pauses: WorkReportPauseDto[];
};

export async function fetchWorkReportPauseReasons(): Promise<string[]> {
  const data = await apiFetch<{ pause_reasons: string[] }>(`${API_BASE}/work-reports/pause-reasons`);
  return data.pause_reasons || [];
}

export type WorkReportPlanningOperationRow = {
  planning_operation_id: number;
  operation_no: number;
  operation_name: string;
  machine_id: number;
  machine_name: string | null;
  machine_code: string | null;
  workplace_library_item_id: number | null;
  workplace_name: string | null;
  status: string;
  work_order_no: string | null;
  gpn: string;
};

export type PlanningOperationsForVpResponse = {
  production_order_id: number;
  vp_code: string | null;
  job_item_id: number | null;
  operations: WorkReportPlanningOperationRow[];
};

export type ResolvePoFromPlanningOpResponse = {
  production_order_id: number | null;
  vp_code: string | null;
  planning_operation_id: number;
};

export async function fetchPlanningOperationsForVp(productionOrderId: number): Promise<PlanningOperationsForVpResponse> {
  return apiFetch<PlanningOperationsForVpResponse>(
    `${API_BASE}/work-reports/context/planning-operations?production_order_id=${productionOrderId}`
  );
}

export async function resolveProductionOrderForPlanningOperation(
  planningOperationId: number
): Promise<ResolvePoFromPlanningOpResponse> {
  return apiFetch<ResolvePoFromPlanningOpResponse>(
    `${API_BASE}/work-reports/context/production-order-for-planning-operation?planning_operation_id=${planningOperationId}`
  );
}

export async function listWorkReports(params?: {
  planningOperationId?: number;
  productionOrderId?: number;
  machineId?: number;
  employeeId?: number;
  openOnly?: boolean;
  limit?: number;
}): Promise<WorkReportDto[]> {
  const q = new URLSearchParams();
  if (params?.planningOperationId != null) q.set("planning_operation_id", String(params.planningOperationId));
  if (params?.productionOrderId != null) q.set("production_order_id", String(params.productionOrderId));
  if (params?.machineId != null) q.set("machine_id", String(params.machineId));
  if (params?.employeeId != null) q.set("employee_id", String(params.employeeId));
  if (params?.openOnly) q.set("open_only", "true");
  if (params?.limit != null) q.set("limit", String(params.limit));
  const qs = q.toString();
  const data = await apiFetch<{ reports: WorkReportDto[] }>(
    `${API_BASE}/work-reports${qs ? `?${qs}` : ""}`
  );
  return data.reports || [];
}

export async function getWorkReport(reportId: number): Promise<WorkReportDto> {
  return apiFetch<WorkReportDto>(`${API_BASE}/work-reports/${reportId}`);
}

export async function createWorkReport(body: {
  planning_operation_id: number;
  machine_id: number;
  employee_id?: number | null;
  operator_display?: string | null;
  started_at: string;
  ended_at?: string | null;
  qty_ok?: number | null;
  qty_nok?: number | null;
  note?: string | null;
  source?: string;
  use_as_completion?: boolean;
}): Promise<WorkReportDto> {
  return apiFetch<WorkReportDto>(`${API_BASE}/work-reports`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function patchWorkReport(
  reportId: number,
  patch: Partial<{
    employee_id: number | null;
    operator_display: string | null;
    machine_id: number | null;
    planning_operation_id: number | null;
    started_at: string | null;
    ended_at: string | null;
    qty_ok: number | null;
    qty_nok: number | null;
    note: string | null;
    source: string | null;
  }>
): Promise<WorkReportDto> {
  return apiFetch<WorkReportDto>(`${API_BASE}/work-reports/${reportId}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export async function deleteWorkReport(reportId: number): Promise<void> {
  await apiFetch<{ status: string }>(`${API_BASE}/work-reports/${reportId}`, { method: "DELETE" });
}

export async function createWorkReportPause(
  reportId: number,
  body: { pause_start: string; pause_end?: string | null; pause_reason: string; note?: string | null }
): Promise<WorkReportPauseDto> {
  return apiFetch<WorkReportPauseDto>(`${API_BASE}/work-reports/${reportId}/pauses`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function patchWorkReportPause(
  reportId: number,
  pauseId: number,
  patch: Partial<{
    pause_start: string | null;
    pause_end: string | null;
    pause_reason: string | null;
    note: string | null;
  }>
): Promise<WorkReportPauseDto> {
  return apiFetch<WorkReportPauseDto>(`${API_BASE}/work-reports/${reportId}/pauses/${pauseId}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export async function deleteWorkReportPause(reportId: number, pauseId: number): Promise<void> {
  await apiFetch<{ status: string }>(`${API_BASE}/work-reports/${reportId}/pauses/${pauseId}`, {
    method: "DELETE",
  });
}
