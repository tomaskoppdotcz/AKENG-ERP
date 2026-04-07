import { akengFetch } from "./akengFetch";

const API_BASE = (import.meta as any).env?.VITE_API_BASE_URL || "http://127.0.0.1:8000";

export const MATERIAL_PURCHASE_STATUSES = ["draft", "ordered", "confirmed", "received", "cancelled"] as const;
export type MaterialPurchaseStatus = (typeof MATERIAL_PURCHASE_STATUSES)[number];

export type MaterialPurchaseOrderListRow = {
  id: number;
  order_number: string;
  supplier_name: string;
  supplier_customer_id: number;
  created_at: string;
  status: string;
  lines_count: number;
  total_qty_ordered: number;
};

export type MaterialPurchaseOrderLineDetail = {
  id: number;
  material_library_item_id: number;
  qty_ordered: number;
  unit: string | null;
  traceability_note: string | null;
  material: { code: string | null; name: string | null; dimension: string | null; unit: string | null };
};

export type MaterialPurchaseOrderDetail = {
  id: number;
  order_number: string;
  supplier_customer_id: number;
  supplier_name: string;
  status: string;
  created_at: string;
  header_note: string | null;
  lines: MaterialPurchaseOrderLineDetail[];
};

export async function listMaterialPurchaseOrders(): Promise<MaterialPurchaseOrderListRow[]> {
  const res = await akengFetch(`${API_BASE}/planning/material/purchase-orders`);
  if (!res.ok) throw new Error("Nepodařilo se načíst nákupní objednávky materiálu.");
  const raw = await res.json();
  return Array.isArray(raw?.items) ? raw.items : [];
}

export async function getMaterialPurchaseOrder(id: number): Promise<MaterialPurchaseOrderDetail> {
  const res = await akengFetch(`${API_BASE}/planning/material/purchase-orders/${id}`);
  if (res.status === 404) throw new Error("Objednávka nebyla nalezena.");
  if (!res.ok) throw new Error("Nepodařilo se načíst detail objednávky.");
  return res.json();
}

export async function patchMaterialPurchaseOrderStatus(
  id: number,
  status: string
): Promise<{ status: string; material_purchase_order_id: number }> {
  const res = await akengFetch(`${API_BASE}/planning/material/purchase-orders/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
  if (!res.ok) {
    let message = "Změna stavu se nepodařila.";
    try {
      const data = await res.json();
      if (typeof data?.detail === "string") message = data.detail;
    } catch {
      // ignore
    }
    throw new Error(message);
  }
  return res.json();
}
