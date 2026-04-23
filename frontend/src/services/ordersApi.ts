import { attachHttpErrorMeta } from "../utils/writeActionFeedback";
import { akengFetch } from "./akengFetch";

const API_BASE =
  (import.meta as any).env?.VITE_API_BASE_URL || "http://127.0.0.1:8000";

export type ErpWorkflowListFilter = "active" | "cancelled" | "all";

export type OrdersOverviewRow = {
  zakazka: string;
  zakaznik: string | null;
  objednavka: string | null;
  datum: string | null;
  termin: string | null;
  vykresy: number;
  kusy_celkem: number;
  prodejni_cena: number;
  naklad: number;
  vykazany_cas: number;
  zbyvajici_hodiny?: number;
  planovane_hodiny?: number;
  vykonnost: number;
  hotovo: number;
  customer_order_id: number | null;
  job_id: number;
  workflow_status?: string | null;
  /** Provozní metriky (aktivní VP / položky), shodně s detail zakázky. */
  reported_time_min?: number;
  direct_labor_cost?: number;
  completion_percent?: number | null;
  performance_percent?: number | null;
  current_phase?: string | null;
  current_location?: string | null;
  operational_summary_cs?: string | null;
  /** GPN, popisy řádků, výkres, revize, kódy VP — pro klientské fulltextové hledání v přehledu. */
  overview_search_corpus?: string | null;
};

export type OrdersOverviewResponse = {
  orders: OrdersOverviewRow[];
};

export type OrdersOverviewOrderTypeFilter = "customer" | "internal" | "all";

export type CustomerOrderCreatePayload = {
  customer_id: number | null;
  customer_po_no: string;
  order_type: "customer" | "internal";
  order_date: string;
  requested_ship_date: string | null;
  note: string | null;
};

export type CustomerOrderCreateResponse = {
  customer_order_id: number;
  job_id: number;
  zakazka: string;
};

export type OrderDetailItem = {
  job_item_id: number;
  line_no: number;
  gpn: string;
  description: string | null;
  qty: number;
  due_date: string | null;
  sales_price_per_unit: number | null;
  /** Prodejní cena / ks z navázané portfolio položky (bez DPH). */
  sale_price_per_piece?: number | null;
  vp_code: string | undefined;
  vp_count?: number;
  drawing_number?: string | null;
  drawing_revision?: string | null;
  production_orders?: Array<{
    id: number;
    vp_code: string;
    quantity: number;
    logistic_mode: string | null;
    source_type: string | null;
    status: string | null;
    workflow_status?: string | null;
  }>;
  /** active | cancelled | …; null/empty = active (legacy) */
  workflow_status?: string | null;
  portfolio_item_id?: number | null;
  portfolio_item_name?: string | null;
  material_default?: string | null;
  effective_portfolio_item_id?: number | null;
  required_qty?: number | null;
  stock_qty?: number | null;
  from_stock_qty?: number | null;
  to_production_qty?: number | null;
  restock_qty?: number | null;
  /** Pokrytí zákaznické položky (jen stock / order alokace, bez restock VP). */
  customer_coverage?: Array<{
    source_type: string;
    source_label: string;
    quantity: number;
    vp_code: string | null;
    logistic_mode: string | null;
  }>;
  coverage_rows?: Array<{
    id: number;
    coverage_type: string;
    qty: number;
    source_production_order_code: string | null;
    source_stock_receipt_id: number | null;
    consuming_production_order_code: string | null;
    consuming_logistic_mode: string | null;
    note: string | null;
  }>;
  /** Agregace přes aktivní VP řádku (GET order-detail). */
  reported_time_min?: number;
  labor_cost?: number;
  direct_labor_cost?: number;
  completion_percent?: number | null;
  performance_percent?: number | null;
  current_phase?: string | null;
  current_location?: string | null;
  operational_summary_cs?: string | null;
  total_duration_min?: number;
  total_ok_qty?: number;
  total_nok_qty?: number;
  work_reports?: Array<{
    id: number;
    code: string | null;
    started_at: string | null;
    ended_at: string | null;
    duration_min: number | null;
    employee: string | null;
    production_order_code: string | null;
    operation_no: number | null;
    operation_label: string | null;
    ok_qty: number | null;
    nok_qty: number | null;
    source: string | null;
    status: string | null;
    status_display: string | null;
  }>;
};

export type OrderDetailResponse = {
  job: {
    id: number;
    zakazka: string | null;
    customer_order_id: number | null;
  } | null;
  customer_order: {
    id: number;
    zakaznik: string | null;
    objednavka: string | null;
    datum: string | null;
    customer_id?: number | null;
    requested_ship_date?: string | null;
    note?: string | null;
    order_type?: string | null;
    workflow_status?: string | null;
  } | null;
  summary: {
    termin: string | null;
    vykresy: number;
    kusy_celkem: number;
    prodejni_cena: number;
    /** Součet (kusy × cena / ks) jen u položek s cenou z portfolia. */
    total_sales_price: number;
    reported_time_min?: number;
    direct_labor_cost?: number;
    completion_percent?: number | null;
    performance_percent?: number | null;
    current_phase?: string | null;
    current_location?: string | null;
    operational_summary_cs?: string | null;
  };
  items: OrderDetailItem[];
};

export type JobItemRow = {
  id: number;
  job_id: number;
  line_no?: number | null;
  gpn: string;
  qty: number;
  due_date: string | null;
  workflow_status?: string | null;
  order_workflow_status?: string | null;
  /** customer | internal — z vazby na zakázku (GET /job-items). */
  order_type?: string | null;
  description?: string | null;
  portfolio_item_id?: number | null;
  /** Z `portfolio_items` (stejná logika jako u přehledu VP). */
  drawing_number?: string | null;
  drawing_revision?: string | null;
  /** Text z backendu (fáze výroby z VP / plánování). */
  production_phase_label?: string | null;
  /** Např. "2 / 5" z backendu. */
  production_progress_label?: string | null;
  reported_time_min?: number;
  direct_labor_cost?: number;
  completion_percent?: number | null;
  performance_percent?: number | null;
  current_phase?: string | null;
  current_location?: string | null;
  operational_summary_cs?: string | null;
  total_duration_min?: number;
  total_ok_qty?: number;
  total_nok_qty?: number;
};

export type JobItemCreatePayload = {
  job_id: number;
  gpn: string;
  name: string | null;
  quantity: number;
  due_date: string | null;
  portfolio_item_id: number | null;
};

export type JobRow = {
  id: number;
  zak_code: string;
  customer_order_id: number | null;
};

export type ProductionOrderRow = {
  id: number;
  vp_code: string;
  job_item_id: number;
  source_type?: string | null;
  logistic_mode?: string | null;
  quantity?: number | null;
  status?: string | null;
  /** null/empty/active = aktivní VP */
  workflow_status?: string | null;
};

export type DuplicateFlowWarning = {
  job_item_id: number;
  source_type: string;
  production_order_count: number;
  production_order_ids: number[];
  flag: string;
};

export type CreateProductionOrdersResponse = {
  production_orders: Array<{
    id: number;
    vp_code: string;
    job_item_id: number;
    source_type: string;
    logistic_mode: string;
    quantity: number;
    status: string;
    state: "created" | "existing";
    duplicate_flow?: boolean;
  }>;
  duplicate_flow_warnings?: DuplicateFlowWarning[];
};

export type RestockConflictStrategy =
  | "prefer_customer"
  | "prefer_stock"
  | "stock_and_wip"
  | "stock_and_new_production"
  | "wip_only"
  | "new_production_only"
  | "stock_only";

export type RestockResolutionOption = {
  strategy: RestockConflictStrategy;
  label_cs: string;
  summary_cs: string;
  stock_issue_qty: number;
  wip_reservation_qty: number;
  new_customer_production_qty: number;
  stock_after_customer_issue_qty: number;
  future_stock_after_wip_qty: number;
  min_stock_replenishment_gap: number;
  unified_internal_replenishment_qty: number;
  is_recommended?: boolean;
};

export type RestockConflictResolution = {
  job_item_id: number;
  strategy: RestockConflictStrategy;
};

export type AllocationPreviewLine = {
  job_item_id: number;
  gpn: string;
  required_qty: number;
  from_stock_qty: number;
  to_production_qty: number;
  restock_qty: number;
  /** sklad_zakaznik: min. doplnění + náhrada za hotové zboží pro zákazníka */
  internal_replenishment_qty?: number;
  /** sklad_zakaznik: rozšířený náhled sklad vs. minimum vs. WIP (backend). */
  finished_stock_qty?: number;
  minimum_stock_target_qty?: number;
  wip_restock_qty?: number;
  stock_after_customer_issue_qty?: number;
  future_stock_after_wip_qty?: number;
  wip_covers_minimum_after_customer_issue?: boolean;
  restock_resolution_options?: RestockResolutionOption[];
  recommended_fulfillment_strategy?: RestockConflictStrategy | null;
  restock_wip: {
    quantity_open: number;
    production_order_ids: number[];
    vp_codes: string[];
  };
  needs_user_choice: boolean;
  /** logistic_mode navázané portfolio položky řádku (backend). */
  line_logistic_mode?: string | null;
  /** Náhled počtů pro volbu „rezervovat WIP pro zákazníka“ (skladový VP se nemění). */
  reserve_wip_plan?: {
    reserved_qty: number;
    customer_sklad_zakaznik_qty: number;
    replenishment_internal_qty: number;
    customer_vyroba_extra_qty: number;
    stock_restock_vp_unchanged: boolean;
  } | null;
};

export type AllocationPreviewResponse = {
  customer_order_id: number;
  lines: AllocationPreviewLine[];
  any_needs_user_choice: boolean;
};

function coerceNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeAllocationPreviewResponse(raw: unknown): AllocationPreviewResponse {
  if (raw == null || typeof raw !== "object") {
    throw new Error("Nepodařilo se načíst náhled alokace (neplatná odpověď serveru).");
  }
  const obj = raw as Record<string, unknown>;
  const rawLines = Array.isArray(obj.lines) ? obj.lines : [];
  const lines: AllocationPreviewLine[] = rawLines.map((lineRaw) => {
    const line = (lineRaw && typeof lineRaw === "object" ? lineRaw : {}) as Record<string, unknown>;
    const rawWip =
      line.restock_wip && typeof line.restock_wip === "object"
        ? (line.restock_wip as Record<string, unknown>)
        : {};
    const restock_wip = {
      quantity_open: coerceNumber(rawWip.quantity_open, 0),
      production_order_ids: Array.isArray(rawWip.production_order_ids)
        ? rawWip.production_order_ids.map((v) => coerceNumber(v, 0)).filter((v) => v > 0)
        : [],
      vp_codes: Array.isArray(rawWip.vp_codes)
        ? rawWip.vp_codes.map((v) => String(v ?? "").trim()).filter((v) => v.length > 0)
        : [],
    };
    return {
      job_item_id: coerceNumber(line.job_item_id, 0),
      gpn: typeof line.gpn === "string" ? line.gpn : "",
      required_qty: coerceNumber(line.required_qty, 0),
      from_stock_qty: coerceNumber(line.from_stock_qty, 0),
      to_production_qty: coerceNumber(line.to_production_qty, 0),
      restock_qty: coerceNumber(line.restock_qty, 0),
      internal_replenishment_qty:
        line.internal_replenishment_qty == null ? undefined : coerceNumber(line.internal_replenishment_qty, 0),
      finished_stock_qty: line.finished_stock_qty == null ? undefined : coerceNumber(line.finished_stock_qty, 0),
      minimum_stock_target_qty:
        line.minimum_stock_target_qty == null ? undefined : coerceNumber(line.minimum_stock_target_qty, 0),
      wip_restock_qty: line.wip_restock_qty == null ? undefined : coerceNumber(line.wip_restock_qty, 0),
      stock_after_customer_issue_qty:
        line.stock_after_customer_issue_qty == null ? undefined : coerceNumber(line.stock_after_customer_issue_qty, 0),
      future_stock_after_wip_qty:
        line.future_stock_after_wip_qty == null ? undefined : coerceNumber(line.future_stock_after_wip_qty, 0),
      wip_covers_minimum_after_customer_issue:
        line.wip_covers_minimum_after_customer_issue == null
          ? undefined
          : Boolean(line.wip_covers_minimum_after_customer_issue),
      restock_resolution_options: Array.isArray(line.restock_resolution_options)
        ? (line.restock_resolution_options as RestockResolutionOption[])
        : [],
      recommended_fulfillment_strategy:
        typeof line.recommended_fulfillment_strategy === "string"
          ? (line.recommended_fulfillment_strategy as RestockConflictStrategy)
          : null,
      restock_wip,
      needs_user_choice: Boolean(line.needs_user_choice),
      line_logistic_mode: line.line_logistic_mode == null ? undefined : String(line.line_logistic_mode),
      reserve_wip_plan:
        line.reserve_wip_plan && typeof line.reserve_wip_plan === "object"
          ? (line.reserve_wip_plan as AllocationPreviewLine["reserve_wip_plan"])
          : null,
    };
  });
  return {
    customer_order_id: coerceNumber(obj.customer_order_id, 0),
    lines,
    any_needs_user_choice: Boolean(obj.any_needs_user_choice),
  };
}

async function readErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const j = await res.json();
    if (typeof j.detail === "string") return j.detail;
    if (j.detail && typeof j.detail === "object" && typeof j.detail.message === "string") {
      return j.detail.message;
    }
  } catch {
    /* ignore */
  }
  return fallback;
}

/** Úspěšná odpověď s volitelným JSON tělem (204 / prázdné tělo → `undefined`). */
async function readOptionalJsonBody(res: Response): Promise<unknown> {
  if (res.status === 204 || res.status === 205) return undefined;
  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("application/json")) return undefined;
  try {
    const text = await res.text();
    if (!text.trim()) return undefined;
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

export async function getOrdersOverview(
  orderType: OrdersOverviewOrderTypeFilter = "customer",
  workflowFilter: ErpWorkflowListFilter = "active"
): Promise<OrdersOverviewRow[]> {
  const q = new URLSearchParams({ order_type: orderType, workflow_filter: workflowFilter });
  const res = await akengFetch(`${API_BASE}/orders-overview/list?${q.toString()}`);
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "Nepodařilo se načíst přehled zakázek."));
  }
  const data: OrdersOverviewResponse = await res.json();
  return data.orders ?? [];
}

export async function getOrderDetail(customerOrderId: number): Promise<OrderDetailResponse> {
  const res = await akengFetch(`${API_BASE}/order-detail/${customerOrderId}`);
  if (res.status === 404) {
    throw new Error("Objednávka nebyla nalezena.");
  }
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "Nepodařilo se načíst kartu zakázky."));
  }
  const raw = await res.json();
  // backward/forward compatibility: normalize legacy flat shape to nested shape
  if (raw && typeof raw === "object" && ("job" in raw || "customer_order" in raw)) {
    const co = raw.customer_order;
    return {
      job: raw.job ?? null,
      customer_order:
        co && typeof co === "object"
          ? {
              id: co.id,
              zakaznik: co.zakaznik ?? null,
              objednavka: co.objednavka ?? null,
              datum: co.datum ?? null,
              customer_id: co.customer_id ?? null,
              requested_ship_date: co.requested_ship_date ?? null,
              note: co.note ?? null,
              order_type: co.order_type ?? "customer",
              workflow_status: co.workflow_status ?? null,
            }
          : null,
      summary: (() => {
        const s = raw.summary;
        if (s && typeof s === "object") {
          return {
            termin: s.termin ?? null,
            vykresy: Number(s.vykresy ?? 0),
            kusy_celkem: Number(s.kusy_celkem ?? 0),
            prodejni_cena: Number(s.prodejni_cena ?? 0),
            total_sales_price: Number(s.total_sales_price ?? 0),
            reported_time_min: s.reported_time_min != null ? Number(s.reported_time_min) : undefined,
            direct_labor_cost: s.direct_labor_cost != null ? Number(s.direct_labor_cost) : undefined,
            completion_percent:
              s.completion_percent === undefined
                ? undefined
                : s.completion_percent === null
                  ? null
                  : Number(s.completion_percent),
            performance_percent:
              s.performance_percent === undefined
                ? undefined
                : s.performance_percent === null
                  ? null
                  : Number(s.performance_percent),
            current_phase: s.current_phase ?? null,
            current_location: s.current_location ?? null,
            operational_summary_cs: s.operational_summary_cs ?? null,
          };
        }
        return {
          termin: null,
          vykresy: Array.isArray(raw.items) ? raw.items.length : 0,
          kusy_celkem: 0,
          prodejni_cena: 0,
          total_sales_price: 0,
        };
      })(),
      items: Array.isArray(raw.items) ? raw.items : [],
    };
  }
  return {
    job: {
      id: 0,
      zakazka: raw?.zakazka ?? null,
      customer_order_id: customerOrderId,
    },
    customer_order: {
      id: customerOrderId,
      zakaznik: raw?.zakaznik ?? null,
      objednavka: raw?.objednavka ?? null,
      datum: raw?.datum ?? null,
      customer_id: raw?.customer_id ?? null,
      requested_ship_date: raw?.requested_ship_date ?? null,
      note: raw?.note ?? null,
      order_type: raw?.order_type ?? "customer",
      workflow_status: raw?.workflow_status ?? null,
    },
    summary: {
      termin: raw?.termin ?? null,
      vykresy: Number(raw?.vykresy ?? 0),
      kusy_celkem: Number(raw?.kusy_celkem ?? 0),
      prodejni_cena: Number(raw?.prodejni_cena ?? 0),
      total_sales_price: Number(raw?.total_sales_price ?? 0),
    },
    items: Array.isArray(raw?.items) ? raw.items : [],
  };
}

export async function createCustomerOrder(
  payload: CustomerOrderCreatePayload
): Promise<CustomerOrderCreateResponse> {
  const res = await akengFetch(`${API_BASE}/orders/customer-orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "Nepodařilo se vytvořit zakázku."));
  }
  return res.json();
}

export async function getJobItems(workflowFilter: ErpWorkflowListFilter = "active"): Promise<JobItemRow[]> {
  const q = new URLSearchParams({ workflow_filter: workflowFilter });
  const res = await akengFetch(`${API_BASE}/orders/job-items?${q.toString()}`);
  if (!res.ok) {
    throw new Error("Nepodařilo se načíst položky zakázek.");
  }
  const data = await res.json();
  // Endpoint vrací { items, total, limit, offset }; pro kompatibilitu držíme array-return.
  if (Array.isArray(data)) return data as JobItemRow[];
  return Array.isArray(data?.items) ? (data.items as JobItemRow[]) : [];
}

export async function createJobItem(payload: JobItemCreatePayload): Promise<JobItemRow> {
  const res = await akengFetch(`${API_BASE}/orders/job-items`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "Nepodařilo se vytvořit položku zakázky."));
  }
  return res.json();
}

export async function updateJobItem(itemId: number, payload: JobItemUpdatePayload): Promise<JobItemRow> {
  const res = await akengFetch(`${API_BASE}/orders/job-items/${itemId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "Nepodařilo se upravit položku zakázky."));
  }
  return res.json();
}

export async function stornoJobItem(itemId: number): Promise<unknown> {
  const res = await akengFetch(`${API_BASE}/orders/job-items/${itemId}/storno`, { method: "POST" });
  if (!res.ok) {
    const msg = await readErrorMessage(res, "Nepodařilo se stornovat položku zakázky.");
    throw attachHttpErrorMeta(new Error(msg), res);
  }
  return readOptionalJsonBody(res);
}

export async function updateCustomerOrder(
  customerOrderId: number,
  payload: CustomerOrderUpdatePayload
): Promise<void> {
  const res = await akengFetch(`${API_BASE}/orders/customer-orders/${customerOrderId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "Nepodařilo se upravit hlavičku zakázky."));
  }
}

export async function stornoCustomerOrder(customerOrderId: number): Promise<unknown> {
  const res = await akengFetch(`${API_BASE}/orders/customer-orders/${customerOrderId}/storno`, { method: "POST" });
  if (!res.ok) {
    const msg = await readErrorMessage(res, "Nepodařilo se stornovat zakázku.");
    throw attachHttpErrorMeta(new Error(msg), res);
  }
  return readOptionalJsonBody(res);
}

export async function getJobs(): Promise<JobRow[]> {
  const res = await akengFetch(`${API_BASE}/orders/jobs`);
  if (!res.ok) {
    throw new Error("Nepodařilo se načíst zakázky (jobs).");
  }
  const data = await res.json();
  if (Array.isArray(data)) return data as JobRow[];
  return Array.isArray(data?.items) ? (data.items as JobRow[]) : [];
}

export async function getProductionOrders(workflowFilter: ErpWorkflowListFilter = "active"): Promise<ProductionOrderRow[]> {
  const q = new URLSearchParams({ workflow_filter: workflowFilter });
  const res = await akengFetch(`${API_BASE}/orders/production-orders?${q.toString()}`);
  if (!res.ok) {
    throw new Error("Nepodařilo se načíst výrobní příkazy.");
  }
  const data = await res.json();
  if (Array.isArray(data)) return data as ProductionOrderRow[];
  return Array.isArray(data?.items) ? (data.items as ProductionOrderRow[]) : [];
}

export async function getAllocationPreview(customerOrderId: number): Promise<AllocationPreviewResponse> {
  const res = await akengFetch(`${API_BASE}/orders/${customerOrderId}/allocation-preview`);
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "Nepodařilo se načíst náhled alokace."));
  }
  const raw = await res.json();
  return normalizeAllocationPreviewResponse(raw);
}

export async function createProductionOrdersFromAllocation(
  customerOrderId: number,
  restockConflictResolutions: RestockConflictResolution[] = []
): Promise<CreateProductionOrdersResponse> {
  const res = await akengFetch(`${API_BASE}/orders/${customerOrderId}/create-production-orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ restock_conflict_resolutions: restockConflictResolutions }),
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "Nepodařilo se vytvořit výrobní příkazy."));
  }
  return res.json();
}

/** Složí kontext položky z existujících endpointů (bez nového backendu). */
export async function getJobItemDetailContext(
  jobItemId: number
): Promise<{ customerOrderId: number; order: OrderDetailResponse; item: OrderDetailItem } | null> {
  const [items, jobs] = await Promise.all([getJobItems("all"), getJobs()]);
  const ji = items.find((x) => x.id === jobItemId);
  if (!ji) return null;
  const job = jobs.find((j) => j.id === ji.job_id);
  if (job == null || job.customer_order_id == null) return null;
  let order: OrderDetailResponse;
  try {
    order = await getOrderDetail(job.customer_order_id);
  } catch {
    return null;
  }
  const item = order.items.find((it) => it.job_item_id === jobItemId);
  if (!item) return null;
  return { customerOrderId: job.customer_order_id, order, item };
}
