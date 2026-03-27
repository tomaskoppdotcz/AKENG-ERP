const API_BASE =
  (import.meta as any).env?.VITE_API_BASE_URL || "http://127.0.0.1:8000";

const BASE = `${API_BASE}/product-stock`;

async function readErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const j = await res.json();
    if (typeof j.detail === "string") return j.detail;
    if (Array.isArray(j.detail)) {
      const parts = j.detail.map((x: { msg?: string }) => x.msg).filter(Boolean);
      if (parts.length) return parts.join("; ");
    }
  } catch {
    /* ignore */
  }
  return fallback;
}

export type ProductStockItem = {
  id: number;
  portfolio_item_id: number;
  portfolio_gpn: string;
  portfolio_name: string;
  portfolio_customer_name?: string | null;
  location: string | null;
  current_qty: number;
  min_qty: number | null;
  unit: string | null;
  note: string | null;
  is_active: boolean;
  scan_code: string | null;
};

export type ProductStockMovement = {
  id: number;
  movement_type: "prijem" | "vydej" | "korekce";
  qty: number;
  movement_date: string;
  reference: string | null;
  note: string | null;
};

export type ProductStockItemCreatePayload = {
  portfolio_item_id: number;
  location: string | null;
  current_qty: number;
  min_qty: number | null;
  unit: string | null;
  note: string | null;
  is_active: boolean;
};

export type ProductStockItemUpdatePayload = {
  location?: string | null;
  current_qty?: number | null;
  min_qty?: number | null;
  unit?: string | null;
  note?: string | null;
  is_active?: boolean | null;
};

export type ProductStockMovementCreatePayload = {
  movement_type: "prijem" | "vydej" | "korekce";
  qty: number;
  movement_date: string;
  reference: string | null;
  note: string | null;
};

export type ProductStockMovementUpdatePayload = Partial<ProductStockMovementCreatePayload>;

export async function getProductStockItems(): Promise<ProductStockItem[]> {
  const res = await fetch(`${BASE}/items`);
  if (!res.ok) throw new Error(await readErrorMessage(res, "Nepodařilo se načíst sklad výrobků."));
  return res.json();
}

export async function createProductStockItem(payload: ProductStockItemCreatePayload): Promise<ProductStockItem> {
  const res = await fetch(`${BASE}/items`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await readErrorMessage(res, "Nepodařilo se vytvořit skladovou kartu."));
  return res.json();
}

export async function updateProductStockItem(
  id: number,
  payload: ProductStockItemUpdatePayload
): Promise<ProductStockItem> {
  const res = await fetch(`${BASE}/items/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await readErrorMessage(res, "Nepodařilo se upravit skladovou kartu."));
  return res.json();
}

export async function deleteProductStockItem(id: number): Promise<{ status: string }> {
  const res = await fetch(`${BASE}/items/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(await readErrorMessage(res, "Nepodařilo se smazat skladovou kartu."));
  return res.json();
}

export async function getProductStockMovements(stockItemId: number): Promise<ProductStockMovement[]> {
  const res = await fetch(`${BASE}/items/${stockItemId}/movements`);
  if (!res.ok) throw new Error(await readErrorMessage(res, "Nepodařilo se načíst pohyby."));
  return res.json();
}

export async function createProductStockMovement(
  stockItemId: number,
  payload: ProductStockMovementCreatePayload
): Promise<ProductStockMovement> {
  const res = await fetch(`${BASE}/items/${stockItemId}/movements`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await readErrorMessage(res, "Nepodařilo se uložit pohyb."));
  return res.json();
}

export async function updateProductStockMovement(
  movementId: number,
  payload: ProductStockMovementUpdatePayload
): Promise<ProductStockMovement> {
  const res = await fetch(`${BASE}/movements/${movementId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await readErrorMessage(res, "Nepodařilo se upravit pohyb."));
  return res.json();
}

export async function deleteProductStockMovement(movementId: number): Promise<{ status: string }> {
  const res = await fetch(`${BASE}/movements/${movementId}`, { method: "DELETE" });
  if (!res.ok) throw new Error(await readErrorMessage(res, "Nepodařilo se smazat pohyb."));
  return res.json();
}
