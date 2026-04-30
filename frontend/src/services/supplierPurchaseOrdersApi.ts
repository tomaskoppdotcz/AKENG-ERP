import { akengFetch } from "./akengFetch";

const API_BASE = (import.meta as any).env?.VITE_API_BASE_URL || "http://127.0.0.1:8000";

export const SUPPLIER_PURCHASE_ORDER_STATUSES = [
  "draft",
  "ordered",
  "partially_received",
  "received",
  "cancelled",
] as const;
export type SupplierPurchaseOrderStatus = (typeof SUPPLIER_PURCHASE_ORDER_STATUSES)[number];

export const SUPPLIER_PURCHASE_ORDER_CATEGORIES = ["cooperation", "tools", "oils", "material", "services", "other"] as const;
export type SupplierPurchaseOrderCategory = (typeof SUPPLIER_PURCHASE_ORDER_CATEGORIES)[number];

export const SUPPLIER_PURCHASE_ORDER_SOURCE_TYPES = ["manual", "rfq", "requirement"] as const;
export type SupplierPurchaseOrderSourceType = (typeof SUPPLIER_PURCHASE_ORDER_SOURCE_TYPES)[number];

export type SupplierPurchaseOrderItem = {
  id: number;
  purchase_order_id: number;
  rfq_item_id: number | null;
  material_library_item_id: number | null;
  item_name: string;
  description: string | null;
  qty: number;
  unit: string;
  unit_price: number | null;
  currency: string;
  total_price: number | null;
  received_qty: number;
  received_at: string | null;
  received_note: string | null;
  note: string | null;
};

export type SupplierPurchaseOrder = {
  id: number;
  po_no: string;
  supplier_id: number | null;
  supplier_name: string | null;
  status: SupplierPurchaseOrderStatus;
  source_type: SupplierPurchaseOrderSourceType;
  rfq_id: number | null;
  category: SupplierPurchaseOrderCategory;
  customer_order_id: number | null;
  job_item_id: number | null;
  production_order_id: number | null;
  planning_operation_id: number | null;
  relation_label: string;
  created_at: string | null;
  ordered_at: string | null;
  expected_delivery_date: string | null;
  note: string | null;
  is_from_material_requirement: boolean;
  items_count: number;
  total_price: number;
  currency: string;
  cooperation_operation?: {
    planning_operation_id: number;
    work_order_no: string | null;
    operation_no: number;
    operation_name: string;
    is_cooperation: boolean;
    cooperation_status: string;
    cooperation_sent_at: string | null;
    cooperation_received_at: string | null;
  } | null;
};

export type SupplierPurchaseOrderDetail = SupplierPurchaseOrder & {
  items: SupplierPurchaseOrderItem[];
};

export type SupplierPurchaseOrderPayload = {
  supplier_id?: number | null;
  supplier_name?: string | null;
  status: SupplierPurchaseOrderStatus;
  source_type?: SupplierPurchaseOrderSourceType | null;
  rfq_id?: number | null;
  category: SupplierPurchaseOrderCategory;
  customer_order_id?: number | null;
  job_item_id?: number | null;
  production_order_id?: number | null;
  planning_operation_id?: number | null;
  ordered_at?: string | null;
  expected_delivery_date?: string | null;
  note?: string | null;
  is_from_material_requirement?: boolean;
};

export type SupplierPurchaseOrderItemPayload = {
  rfq_item_id?: number | null;
  material_library_item_id?: number | null;
  item_name: string;
  description?: string | null;
  qty: number;
  unit: string;
  unit_price?: number | null;
  currency?: string;
  received_qty?: number;
  note?: string | null;
};

export type SupplierPurchaseOrderReceiveMode = "material" | "cooperation";

export type SupplierPurchaseOrderReceiveItemPayload = {
  item_id: number;
  received_qty: number;
  mode: SupplierPurchaseOrderReceiveMode;
  heat_lot?: string | null;
  certificate_no?: string | null;
  delivery_note_no?: string | null;
  supplier_batch?: string | null;
  note?: string | null;
};

export type MaterialRequirementSupplierPurchaseOrderPayload = {
  supplier_id: number;
  customer_order_id?: number | null;
  job_item_id?: number | null;
  production_order_id?: number | null;
  note?: string | null;
  items: Array<{
    material_library_item_id: number;
    material_code?: string | null;
    qty: number;
    unit?: string | null;
    note?: string | null;
  }>;
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

export async function listSupplierPurchaseOrders(): Promise<SupplierPurchaseOrder[]> {
  const res = await akengFetch(`${API_BASE}/supplier-purchase-orders`);
  const raw = await parseOrThrow(res, "Nepodařilo se načíst objednávky.");
  return Array.isArray(raw?.items) ? raw.items : [];
}

export async function getSupplierPurchaseOrder(id: number): Promise<SupplierPurchaseOrderDetail> {
  const res = await akengFetch(`${API_BASE}/supplier-purchase-orders/${id}`);
  return parseOrThrow(res, "Nepodařilo se načíst detail objednávky.");
}

export async function createSupplierPurchaseOrder(
  payload: SupplierPurchaseOrderPayload
): Promise<SupplierPurchaseOrderDetail> {
  const res = await akengFetch(`${API_BASE}/supplier-purchase-orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseOrThrow(res, "Objednávku se nepodařilo vytvořit.");
}

export async function createSupplierPurchaseOrderFromRfq(rfqId: number): Promise<SupplierPurchaseOrderDetail> {
  const res = await akengFetch(`${API_BASE}/supplier-purchase-orders/from-rfq/${rfqId}`, {
    method: "POST",
  });
  return parseOrThrow(res, "Objednávku z poptávky se nepodařilo vytvořit.");
}

export async function createSupplierPurchaseOrderFromMaterialRequirement(
  payload: MaterialRequirementSupplierPurchaseOrderPayload
): Promise<SupplierPurchaseOrderDetail> {
  const res = await akengFetch(`${API_BASE}/supplier-purchase-orders/from-material-requirement`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseOrThrow(res, "Objednávku z požadavku materiálu se nepodařilo vytvořit.");
}

export async function updateSupplierPurchaseOrder(
  id: number,
  payload: SupplierPurchaseOrderPayload
): Promise<SupplierPurchaseOrderDetail> {
  const res = await akengFetch(`${API_BASE}/supplier-purchase-orders/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseOrThrow(res, "Objednávku se nepodařilo uložit.");
}

export async function receiveSupplierPurchaseOrderCooperation(id: number): Promise<SupplierPurchaseOrderDetail> {
  const res = await akengFetch(`${API_BASE}/supplier-purchase-orders/${id}/receive-cooperation`, {
    method: "POST",
  });
  return parseOrThrow(res, "Kooperaci se nepodařilo přijmout zpět.");
}

export async function receiveSupplierPurchaseOrderItem(
  poId: number,
  payload: SupplierPurchaseOrderReceiveItemPayload
): Promise<SupplierPurchaseOrderDetail> {
  const res = await akengFetch(`${API_BASE}/supplier-purchase-orders/${poId}/receive-item`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseOrThrow(res, "Položku objednávky se nepodařilo přijmout.");
}

export async function createSupplierPurchaseOrderItem(
  poId: number,
  payload: SupplierPurchaseOrderItemPayload
): Promise<SupplierPurchaseOrderDetail> {
  const res = await akengFetch(`${API_BASE}/supplier-purchase-orders/${poId}/items`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseOrThrow(res, "Položku se nepodařilo přidat.");
}

export async function updateSupplierPurchaseOrderItem(
  poId: number,
  itemId: number,
  payload: SupplierPurchaseOrderItemPayload
): Promise<SupplierPurchaseOrderDetail> {
  const res = await akengFetch(`${API_BASE}/supplier-purchase-orders/${poId}/items/${itemId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseOrThrow(res, "Položku se nepodařilo uložit.");
}

export async function deleteSupplierPurchaseOrderItem(
  poId: number,
  itemId: number
): Promise<SupplierPurchaseOrderDetail> {
  const res = await akengFetch(`${API_BASE}/supplier-purchase-orders/${poId}/items/${itemId}`, {
    method: "DELETE",
  });
  return parseOrThrow(res, "Položku se nepodařilo smazat.");
}
