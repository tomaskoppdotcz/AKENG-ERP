import { akengFetch } from "./akengFetch";
import { attachHttpErrorMeta } from "../utils/writeActionFeedback";

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
    throw attachHttpErrorMeta(new Error(message), res);
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
  code: string | null;
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
  has_work_report?: boolean;
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

export async function fetchPlanningOperationsForVp(
  productionOrderId: number,
  opts?: { onlyWithoutWorkReport?: boolean }
): Promise<PlanningOperationsForVpResponse> {
  const q = new URLSearchParams({
    production_order_id: String(productionOrderId),
  });
  if (opts?.onlyWithoutWorkReport) {
    q.set("only_without_work_report", "true");
  }
  return apiFetch<PlanningOperationsForVpResponse>(
    `${API_BASE}/work-reports/context/planning-operations?${q.toString()}`
  );
}

export async function resolveProductionOrderForPlanningOperation(
  planningOperationId: number
): Promise<ResolvePoFromPlanningOpResponse> {
  return apiFetch<ResolvePoFromPlanningOpResponse>(
    `${API_BASE}/work-reports/context/production-order-for-planning-operation?planning_operation_id=${planningOperationId}`
  );
}

export type WorkReportsKpi = {
  reported_min_today: number;
  total_count: number;
  open_count: number;
  distinct_employees: number;
};

export type WorkReportsPageLegacy = {
  reports: WorkReportDto[];
  total: number;
  limit: number;
  offset: number;
  kpi: WorkReportsKpi;
};

/**
 * Nový stránkovaný přehled výkazů (log) — GET /work-reports?page=&page_size=…
 */
export type WorkReportsPaginatedList = {
  items: WorkReportDto[];
  page: number;
  page_size: number;
  total_count: number;
};

export async function listWorkReportsPaginated(params?: {
  page?: number;
  page_size?: number;
  date_from?: string;
  date_to?: string;
  employee_id?: number;
  machine_id?: number;
  production_order_id?: number;
  status?: string;
  search?: string;
}): Promise<WorkReportsPaginatedList> {
  const q = new URLSearchParams();
  const page = Math.max(1, Math.floor(params?.page ?? 1));
  const pageSize = Math.max(1, Math.floor(params?.page_size ?? 50));
  q.set("page", String(page));
  q.set("page_size", String(pageSize));
  if (params?.date_from) q.set("date_from", params.date_from);
  if (params?.date_to) q.set("date_to", params.date_to);
  if (params?.employee_id != null) q.set("employee_id", String(params.employee_id));
  if (params?.machine_id != null) q.set("machine_id", String(params.machine_id));
  if (params?.production_order_id != null) q.set("production_order_id", String(params.production_order_id));
  if (params?.status != null && String(params.status).trim() !== "") q.set("status", String(params.status).trim());
  if (params?.search != null && params.search.trim() !== "") q.set("search", params.search.trim());
  const qs = q.toString();
  const data = await apiFetch<Record<string, unknown>>(`${API_BASE}/work-reports${qs ? `?${qs}` : ""}`);
  const items = (Array.isArray(data.items) ? data.items : Array.isArray(data.reports) ? data.reports : []) as WorkReportDto[];
  const totalRaw = data.total_count ?? data.total;
  const total_count =
    typeof totalRaw === "number" && Number.isFinite(totalRaw)
      ? Math.max(0, Math.floor(totalRaw))
      : items.length;
  const psRaw = data.page_size ?? data.limit;
  const page_size =
    typeof psRaw === "number" && Number.isFinite(psRaw) ? Math.max(1, Math.floor(psRaw)) : pageSize;
  let pageOut = typeof data.page === "number" && Number.isFinite(data.page) ? Math.max(1, Math.floor(data.page)) : page;
  if (typeof data.offset === "number" && Number.isFinite(data.offset)) {
    pageOut = Math.max(1, Math.floor(data.offset / page_size) + 1);
  }
  return { items, page: pageOut, page_size, total_count };
}

export async function listWorkReports(params?: {
  planningOperationId?: number;
  productionOrderId?: number;
  machineId?: number;
  employeeId?: number;
  workplaceLibraryItemId?: number;
  startedFrom?: string; // YYYY-MM-DD
  startedTo?: string; // YYYY-MM-DD
  openOnly?: boolean;
  limit?: number;
  offset?: number;
}): Promise<WorkReportsPageLegacy> {
  const q = new URLSearchParams();
  if (params?.planningOperationId != null) q.set("planning_operation_id", String(params.planningOperationId));
  if (params?.productionOrderId != null) q.set("production_order_id", String(params.productionOrderId));
  if (params?.machineId != null) q.set("machine_id", String(params.machineId));
  if (params?.employeeId != null) q.set("employee_id", String(params.employeeId));
  if (params?.workplaceLibraryItemId != null) q.set("workplace_library_item_id", String(params.workplaceLibraryItemId));
  if (params?.startedFrom) q.set("started_from", params.startedFrom);
  if (params?.startedTo) q.set("started_to", params.startedTo);
  if (params?.openOnly) q.set("open_only", "true");
  if (params?.limit != null) q.set("limit", String(params.limit));
  if (params?.offset != null) q.set("offset", String(params.offset));
  const qs = q.toString();
  const data = await apiFetch<{
    reports: WorkReportDto[];
    total?: number;
    limit?: number;
    offset?: number;
    kpi?: WorkReportsKpi;
  }>(`${API_BASE}/work-reports${qs ? `?${qs}` : ""}`);
  return {
    reports: data.reports || [],
    total: data.total ?? (data.reports?.length ?? 0),
    limit: data.limit ?? params?.limit ?? 200,
    offset: data.offset ?? params?.offset ?? 0,
    kpi:
      data.kpi ?? {
        reported_min_today: 0,
        total_count: data.total ?? (data.reports?.length ?? 0),
        open_count: 0,
        distinct_employees: 0,
      },
  };
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

export type DeleteWorkReportResponse = {
  status: string;
  deleted_id?: number;
  message?: string;
};

export async function deleteWorkReport(reportId: number): Promise<DeleteWorkReportResponse> {
  return apiFetch<DeleteWorkReportResponse>(`${API_BASE}/work-reports/${reportId}`, { method: "DELETE" });
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
