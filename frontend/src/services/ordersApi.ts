const API_BASE =
  (import.meta as any).env?.VITE_API_BASE_URL || "http://127.0.0.1:8000";

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
};

export type OrdersOverviewResponse = {
  orders: OrdersOverviewRow[];
};

export type OrdersOverviewOrderTypeFilter = "customer" | "internal" | "all";

export type CustomerOrderCreatePayload = {
  customer_id: number;
  customer_po_no: string;
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
  production_orders?: Array<{
    id: number;
    vp_code: string;
    quantity: number;
    logistic_mode: string | null;
    source_type: string | null;
    status: string | null;
  }>;
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
  } | null;
  summary: {
    termin: string | null;
    vykresy: number;
    kusy_celkem: number;
    prodejni_cena: number;
    /** Součet (kusy × cena / ks) jen u položek s cenou z portfolia. */
    total_sales_price: number;
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
  description?: string | null;
  portfolio_item_id?: number | null;
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
  }>;
};

async function readErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const j = await res.json();
    if (typeof j.detail === "string") return j.detail;
  } catch {
    /* ignore */
  }
  return fallback;
}

export async function getOrdersOverview(
  orderType: OrdersOverviewOrderTypeFilter = "customer"
): Promise<OrdersOverviewRow[]> {
  const q = new URLSearchParams({ order_type: orderType });
  const res = await fetch(`${API_BASE}/orders-overview/list?${q.toString()}`);
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "Nepodařilo se načíst přehled zakázek."));
  }
  const data: OrdersOverviewResponse = await res.json();
  return data.orders ?? [];
}

export async function getOrderDetail(customerOrderId: number): Promise<OrderDetailResponse> {
  const res = await fetch(`${API_BASE}/order-detail/${customerOrderId}`);
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
  const res = await fetch(`${API_BASE}/orders/customer-orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "Nepodařilo se vytvořit zakázku."));
  }
  return res.json();
}

export async function getJobItems(): Promise<JobItemRow[]> {
  const res = await fetch(`${API_BASE}/orders/job-items`);
  if (!res.ok) {
    throw new Error("Nepodařilo se načíst položky zakázek.");
  }
  return res.json();
}

export async function createJobItem(payload: JobItemCreatePayload): Promise<JobItemRow> {
  const res = await fetch(`${API_BASE}/orders/job-items`, {
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
  const res = await fetch(`${API_BASE}/orders/job-items/${itemId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "Nepodařilo se upravit položku zakázky."));
  }
  return res.json();
}

export async function deleteJobItem(itemId: number): Promise<void> {
  const res = await fetch(`${API_BASE}/orders/job-items/${itemId}`, { method: "DELETE" });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "Nepodařilo se smazat položku zakázky."));
  }
}

export async function updateCustomerOrder(
  customerOrderId: number,
  payload: CustomerOrderUpdatePayload
): Promise<void> {
  const res = await fetch(`${API_BASE}/orders/customer-orders/${customerOrderId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "Nepodařilo se upravit hlavičku zakázky."));
  }
}

export async function deleteCustomerOrder(customerOrderId: number): Promise<void> {
  const res = await fetch(`${API_BASE}/orders/customer-orders/${customerOrderId}`, { method: "DELETE" });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "Nepodařilo se smazat zakázku."));
  }
}

export async function getJobs(): Promise<JobRow[]> {
  const res = await fetch(`${API_BASE}/orders/jobs`);
  if (!res.ok) {
    throw new Error("Nepodařilo se načíst zakázky (jobs).");
  }
  return res.json();
}

export async function getProductionOrders(): Promise<ProductionOrderRow[]> {
  const res = await fetch(`${API_BASE}/orders/production-orders`);
  if (!res.ok) {
    throw new Error("Nepodařilo se načíst výrobní příkazy.");
  }
  return res.json();
}

export async function createProductionOrdersFromAllocation(
  customerOrderId: number
): Promise<CreateProductionOrdersResponse> {
  const res = await fetch(`${API_BASE}/orders/${customerOrderId}/create-production-orders`, {
    method: "POST",
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
  const [items, jobs] = await Promise.all([getJobItems(), getJobs()]);
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
