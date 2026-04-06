const API_BASE =
  (import.meta as any).env?.VITE_API_BASE_URL || "http://127.0.0.1:8000";

export type ScanLookupResponse = {
  entity_type:
    | "customer_order"
    | "order_item"
    | "production_order"
    | "production_order_operation"
    | "portfolio_item"
    | "material_stock_item"
    | "product_stock_item";
  entity_id: number;
  scan_code: string;
  label: string;
  target_page:
    | "orders"
    | "order_item"
    | "production_order"
    | "production_order_operation"
    | "portfolio"
    | "material_stock"
    | "product_stock";
  target_params: Record<string, unknown>;
};

export async function scanLookup(scanCode: string): Promise<ScanLookupResponse> {
  const res = await fetch(`${API_BASE}/scan-lookup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scan_code: scanCode }),
  });
  if (res.status === 404) {
    throw new Error("Kód nenalezen");
  }
  if (!res.ok) {
    throw new Error("Nepodařilo se vyhledat scan kód.");
  }
  return res.json();
}
