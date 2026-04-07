import { akengFetch } from "./akengFetch";

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
  vykonnost: number;
  hotovo: number;
  customer_order_id: number | null;
  job_id: number;
};

export type OrdersOverviewResponse = {
  orders: OrdersOverviewRow[];
};

export async function getOrdersOverview(): Promise<OrdersOverviewResponse> {
  const res = await akengFetch(`${API_BASE}/orders-overview/list`);
  if (!res.ok) {
    throw new Error("Nepodarilo se nacist prehled zakazek.");
  }
  // Backend already returns the correct aggregated shape:
  // { orders: [{ zakazka, zakaznik, objednavka, datum, termin, vykresy, kusy_celkem, ... }] }
  return res.json();
}

export type ImportPreviewLine = {
  line_no: number;
  gpn: string;
  description: string | null;
  due_date: string | null;
  qty: number;
  sales_price_per_unit?: number | null;
  sales_price_total?: number | null;
  portfolio_match_type?: string | null;
  portfolio_template_gpn?: string | null;
  portfolio_template_name?: string | null;
};

export type ImportPreviewResponse = {
  status: string;
  customer_po_no?: string;
  zak?: string;
  items_created?: ImportPreviewLine[];
  sample?: string[];
};

export type ImportConfirmResponse = {
  status: string;
  zak?: string;
  customer_order_id?: number;
};

export async function previewImportPdf(file: File): Promise<ImportPreviewResponse> {
  const form = new FormData();
  form.append("file", file);

  // Backend currently exposes a single-step import at /import/customer-order-pdf.
  const res = await akengFetch(`${API_BASE}/import/customer-order-pdf`, {
    method: "POST",
    body: form,
  });

  if (!res.ok) {
    throw new Error("Nepodarilo se nacist PDF objednavku (preview).");
  }

  return res.json();
}

export async function confirmImport(previewId: string): Promise<ImportConfirmResponse> {
  // There is no separate confirm step in the current backend.
  // We simply treat the first call as final; reuse preview as confirm.
  return {
    status: "ok",
  };
}

export type OrderDetailItem = {
  job_item_id: number;
  line_no: number;
  gpn: string;
  description: string | null;
  qty: number;
  due_date: string | null;
  sales_price_per_unit?: number | null;
  vp_code?: string | null;
};

export type OrderDetailResponse = {
  zakazka: string;
  zakaznik: string | null;
  objednavka: string | null;
  datum: string | null;
  termin: string | null;
  vykresy: number;
  kusy_celkem: number;
  prodejni_cena: number;
  items: OrderDetailItem[];
};

export async function getOrderDetail(
  customerOrderId: number
): Promise<OrderDetailResponse> {
  const res = await akengFetch(`${API_BASE}/order-detail/${customerOrderId}`);
  if (!res.ok) {
    throw new Error("Nepodarilo se nacist detail zakazky.");
  }
  return res.json();
}

export type OrderItemOperation = {
  id: number;
  operation_name: string | null;
  machine_name: string | null;
  queue_position: number | null;
  status: string | null;
  planned_minutes?: number | null;
};

export type OrderItemDetailResponse = {
  job_item_id: number;
  line_no: number;
  gpn: string;
  description: string | null;
  qty: number;
  due_date: string | null;
  drawing_no?: string | null;
  revision?: string | null;
  material?: string | null;
  sales_price_per_unit?: number | null;
  vp_code?: string | null;
  portfolio_match_type?: string | null;
  portfolio_template_gpn?: string | null;
  portfolio_template_name?: string | null;
  operations: OrderItemOperation[];
};

export async function getOrderItemDetail(
  jobItemId: number
): Promise<OrderItemDetailResponse> {
  const res = await akengFetch(`${API_BASE}/order-item-detail/${jobItemId}`);
  if (!res.ok) {
    throw new Error("Nepodarilo se nacist detail polozky zakazky.");
  }
  return res.json();
}

export async function createVpForItem(jobItemId: number) {
  const res = await akengFetch(`${API_BASE}/manual-order/create-vp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ job_item_id: jobItemId }),
  });
  if (!res.ok) {
    throw new Error("Nepodarilo se vytvorit VP.");
  }
  return res.json();
}

export async function addManualOperation(payload: {
  vp_code: string;
  operation_name: string;
  machine_id?: number | null;
  queue_position?: number;
  setup_minutes?: number;
  run_minutes_per_piece?: number;
  qty?: number;
  note?: string | null;
}) {
  const res = await akengFetch(`${API_BASE}/manual-order/add-operation`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error("Nepodarilo se pridat operaci.");
  }
  return res.json();
}

