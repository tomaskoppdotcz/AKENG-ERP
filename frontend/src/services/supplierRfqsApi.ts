import { akengFetch } from "./akengFetch";

const API_BASE = (import.meta as any).env?.VITE_API_BASE_URL || "http://127.0.0.1:8000";

export const SUPPLIER_RFQ_CATEGORIES = ["cooperation", "tools", "oils", "material", "services", "other"] as const;
export type SupplierRfqCategory = (typeof SUPPLIER_RFQ_CATEGORIES)[number];

export const SUPPLIER_RFQ_STATUSES = ["draft", "sent", "quoted", "ordered", "cancelled"] as const;
export type SupplierRfqStatus = (typeof SUPPLIER_RFQ_STATUSES)[number];

export type SupplierRfqItem = {
  id: number;
  rfq_id: number;
  item_name: string;
  description: string | null;
  qty: number;
  unit: string;
  target_price: number | null;
  offered_price: number | null;
  currency: string;
  supplier_lead_time_days: number | null;
  note: string | null;
  total_offered_price: number | null;
};

export type SupplierRfq = {
  id: number;
  rfq_no: string;
  supplier_id: number | null;
  supplier_name: string | null;
  category: SupplierRfqCategory;
  status: SupplierRfqStatus;
  title: string;
  description: string | null;
  customer_order_id: number | null;
  job_item_id: number | null;
  production_order_id: number | null;
  planning_operation_id: number | null;
  production_order_operation_id: number | null;
  relation_label: string;
  requested_date: string | null;
  due_date: string | null;
  created_at: string;
  updated_at: string;
  note: string | null;
  items_count: number;
  total_offered_price: number;
};

export type SupplierRfqDetail = SupplierRfq & {
  items: SupplierRfqItem[];
};

export type SupplierRfqPayload = {
  supplier_id?: number | null;
  supplier_name?: string | null;
  category: SupplierRfqCategory;
  status: SupplierRfqStatus;
  title: string;
  description?: string | null;
  customer_order_id?: number | null;
  job_item_id?: number | null;
  production_order_id?: number | null;
  planning_operation_id?: number | null;
  production_order_operation_id?: number | null;
  requested_date?: string | null;
  due_date?: string | null;
  note?: string | null;
};

export type SupplierRfqItemPayload = {
  item_name: string;
  description?: string | null;
  qty: number;
  unit: string;
  target_price?: number | null;
  offered_price?: number | null;
  currency?: string;
  supplier_lead_time_days?: number | null;
  note?: string | null;
};

export type ApprovedSupplierOption = {
  id: number;
  supplier_code: string;
  name: string;
  category: string | null;
  is_approved: boolean;
  is_active: boolean;
  email: string | null;
  phone: string | null;
  note: string | null;
};

export type SupplierRfqCustomerOrderOption = {
  id: number;
  label: string;
  customer_po_no: string | null;
  customer_name: string | null;
  workflow_status: string | null;
};

export type SupplierRfqJobItemOption = {
  id: number;
  job_id: number | null;
  customer_order_id: number | null;
  label: string;
  line_no: number | null;
  gpn: string | null;
  workflow_status: string | null;
};

export type SupplierRfqProductionOrderOption = {
  id: number;
  vp_code: string;
  label: string;
  customer_order_id: number | null;
  job_item_id: number | null;
  gpn: string | null;
  description: string | null;
  workflow_status: string | null;
};

export type SupplierRfqLinkOptions = {
  customer_orders: SupplierRfqCustomerOrderOption[];
  job_items: SupplierRfqJobItemOption[];
  production_orders: SupplierRfqProductionOrderOption[];
};

export type SupplierRfqOperationOption = {
  source: "planning" | "production_order";
  planning_operation_id: number | null;
  production_order_operation_id: number | null;
  operation_no: number;
  operation_name: string;
  label: string;
};

async function parseOrThrow(res: Response, fallback: string) {
  if (res.ok) return res.json();
  let message = fallback;
  try {
    const data = await res.json();
    if (typeof data?.detail === "string") message = data.detail;
  } catch {
    // ignore
  }
  throw new Error(message);
}

export async function listSupplierRfqs(): Promise<SupplierRfq[]> {
  const res = await akengFetch(`${API_BASE}/supplier-rfqs`);
  const raw = await parseOrThrow(res, "Nepodařilo se načíst poptávky.");
  return Array.isArray(raw?.items) ? raw.items : [];
}

export async function listApprovedSuppliersForRfqs(): Promise<ApprovedSupplierOption[]> {
  const res = await akengFetch(`${API_BASE}/supplier-rfqs/suppliers`);
  const raw = await parseOrThrow(res, "Nepodařilo se načíst schválené dodavatele.");
  return Array.isArray(raw?.items) ? raw.items : [];
}

export async function getSupplierRfqLinkOptions(): Promise<SupplierRfqLinkOptions> {
  const res = await akengFetch(`${API_BASE}/supplier-rfqs/link-options`);
  const raw = await parseOrThrow(res, "Nepodařilo se načíst vazby pro poptávku.");
  return {
    customer_orders: Array.isArray(raw?.customer_orders) ? raw.customer_orders : [],
    job_items: Array.isArray(raw?.job_items) ? raw.job_items : [],
    production_orders: Array.isArray(raw?.production_orders) ? raw.production_orders : [],
  };
}

export async function getSupplierRfqOperationOptions(productionOrderId: number): Promise<SupplierRfqOperationOption[]> {
  const res = await akengFetch(`${API_BASE}/supplier-rfqs/production-orders/${productionOrderId}/operations`);
  const raw = await parseOrThrow(res, "Nepodařilo se načíst operace VP.");
  return Array.isArray(raw?.operations) ? raw.operations : [];
}

export async function getSupplierRfq(id: number): Promise<SupplierRfqDetail> {
  const res = await akengFetch(`${API_BASE}/supplier-rfqs/${id}`);
  return parseOrThrow(res, "Nepodařilo se načíst detail poptávky.");
}

export async function createSupplierRfq(payload: SupplierRfqPayload): Promise<SupplierRfqDetail> {
  const res = await akengFetch(`${API_BASE}/supplier-rfqs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseOrThrow(res, "Poptávku se nepodařilo vytvořit.");
}

export async function updateSupplierRfq(id: number, payload: SupplierRfqPayload): Promise<SupplierRfqDetail> {
  const res = await akengFetch(`${API_BASE}/supplier-rfqs/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseOrThrow(res, "Poptávku se nepodařilo uložit.");
}

export async function createSupplierRfqItem(
  rfqId: number,
  payload: SupplierRfqItemPayload
): Promise<SupplierRfqDetail> {
  const res = await akengFetch(`${API_BASE}/supplier-rfqs/${rfqId}/items`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseOrThrow(res, "Položku se nepodařilo přidat.");
}

export async function updateSupplierRfqItem(
  rfqId: number,
  itemId: number,
  payload: SupplierRfqItemPayload
): Promise<SupplierRfqDetail> {
  const res = await akengFetch(`${API_BASE}/supplier-rfqs/${rfqId}/items/${itemId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseOrThrow(res, "Položku se nepodařilo uložit.");
}

export async function deleteSupplierRfqItem(rfqId: number, itemId: number): Promise<SupplierRfqDetail> {
  const res = await akengFetch(`${API_BASE}/supplier-rfqs/${rfqId}/items/${itemId}`, {
    method: "DELETE",
  });
  return parseOrThrow(res, "Položku se nepodařilo smazat.");
}
