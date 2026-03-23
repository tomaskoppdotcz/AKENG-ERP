const API_BASE =
  (import.meta as any).env?.VITE_API_BASE_URL || "http://127.0.0.1:8000";

export type MaterialStockItem = {
  id: number;
  material_library_item_id: number;
  material_code: string;
  material_name: string;
  material_form: string | null;
  material_group_id: number | null;
  material_group_name: string | null;
  location: string | null;
  current_qty: number;
  min_qty: number | null;
  unit: string | null;
  is_active: boolean;
  reserved_qty: number;
  available_qty: number;
};

export type MaterialStockMovement = {
  id: number;
  movement_type: "prijem" | "vydej" | "korekce";
  qty: number;
  movement_date: string;
  reference: string | null;
  note: string | null;
};

export type MaterialStockMovementCreatePayload = {
  movement_type: "prijem" | "vydej" | "korekce";
  qty: number;
  movement_date: string;
  reference: string | null;
  note: string | null;
};

export type MaterialStockReservation = {
  id: number;
  job_item_id: number;
  gpn: string | null;
  reserved_qty: number;
  created_at: string;
  note: string | null;
};

export type MaterialStockReservationCreatePayload = {
  stock_item_id: number;
  job_item_id: number;
  gpn: string | null;
  reserved_qty: number;
  note: string | null;
};

export type MaterialStockItemCreatePayload = {
  material_library_item_id: number;
  location: string | null;
  current_qty: number;
  min_qty: number | null;
  unit: string | null;
  note: string | null;
  is_active: boolean;
};

export async function getMaterialStockItems(): Promise<MaterialStockItem[]> {
  const res = await fetch(`${API_BASE}/material-stock/items`);
  if (!res.ok) throw new Error("Nepodařilo se načíst sklad materiálu.");
  return res.json();
}

export async function createMaterialStockItem(
  payload: MaterialStockItemCreatePayload
): Promise<MaterialStockItem> {
  const res = await fetch(`${API_BASE}/material-stock/items`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    let detail = "Nepodařilo se vytvořit skladovou kartu.";
    try {
      const data = await res.json();
      if (typeof data?.detail === "string" && data.detail) detail = data.detail;
    } catch {
      // ignore json parse fail
    }
    throw new Error(detail);
  }
  return res.json();
}

export async function getMaterialStockMovements(stockItemId: number): Promise<MaterialStockMovement[]> {
  const res = await fetch(`${API_BASE}/material-stock/items/${stockItemId}/movements`);
  if (!res.ok) throw new Error("Nepodařilo se načíst pohyby materiálu.");
  return res.json();
}

export async function getMaterialStockReservations(stockItemId: number): Promise<MaterialStockReservation[]> {
  const res = await fetch(`${API_BASE}/material-stock/items/${stockItemId}/reservations`);
  if (!res.ok) throw new Error("Nepodařilo se načíst rezervace materiálu.");
  return res.json();
}

export async function createMaterialReservation(
  payload: MaterialStockReservationCreatePayload
): Promise<MaterialStockReservation> {
  const res = await fetch(`${API_BASE}/material-stock/reservations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    let detail = "Nepodařilo se vytvořit rezervaci.";
    try {
      const data = await res.json();
      if (typeof data?.detail === "string" && data.detail) detail = data.detail;
    } catch {
      // ignore
    }
    throw new Error(detail);
  }
  return res.json();
}

export async function deleteMaterialReservation(id: number): Promise<{ status: string }> {
  const res = await fetch(`${API_BASE}/material-stock/reservations/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Nepodařilo se zrušit rezervaci.");
  return res.json();
}

export async function createMaterialStockMovement(
  stockItemId: number,
  payload: MaterialStockMovementCreatePayload
): Promise<MaterialStockMovement> {
  const res = await fetch(`${API_BASE}/material-stock/items/${stockItemId}/movements`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    let detail = "Nepodařilo se uložit pohyb.";
    try {
      const data = await res.json();
      if (typeof data?.detail === "string" && data.detail) detail = data.detail;
    } catch {
      // ignore json parse fail
    }
    throw new Error(detail);
  }
  return res.json();
}
