export type MaterialRequirementRelatedOrder = {
  reservation_id: number;
  /** Merged VP link: underlying reservation ids (issue picks one line). */
  reservation_ids?: number[];
  reservation_count?: number;
  reservation_lines?: Array<{
    reservation_id: number;
    required_qty: number;
    reserved_qty: number;
    status: string | null;
  }>;
  production_order_id: number | null;
  vp_code: string | null;
  job_item_id: number | null;
  customer_order_id: number | null;
  zakazka: string | null;
  gpn: string | null;
  required_qty: number;
  reserved_qty: number;
  status: string | null;
};

export type MaterialRequirementRow = {
  material_library_item_id: number;
  material: {
    code: string | null;
    name: string | null;
  };
  required: number;
  available: number;
  shortage: number;
  related_orders: MaterialRequirementRelatedOrder[];
};

const API_BASE = (import.meta as any).env?.VITE_API_BASE_URL || "http://127.0.0.1:8000";

export async function postMaterialReservationsRebuildAll(): Promise<{ status: string } & Record<string, unknown>> {
  const res = await fetch(`${API_BASE}/planning/material-reservations/rebuild-all`, { method: "POST" });
  if (!res.ok) {
    let message = "Globální přepočet rezervací se nepodařil.";
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

export async function getMaterialRequirements(): Promise<MaterialRequirementRow[]> {
  const res = await fetch(`${API_BASE}/planning/material/requirements`);
  if (!res.ok) {
    let message = "Nepodařilo se načíst požadavky materiálu.";
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

export type MaterialIssuePayload = {
  reservation_id: number;
  qty: number;
  stock_item_id?: number | null;
  note?: string | null;
};

export async function postMaterialIssue(payload: MaterialIssuePayload): Promise<{
  status: string;
  reservation_id: number;
  issued_qty: number;
}> {
  const res = await fetch(`${API_BASE}/material-stock/issue`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      reservation_id: payload.reservation_id,
      qty: payload.qty,
      stock_item_id: payload.stock_item_id ?? null,
      note: payload.note?.trim() || null,
    }),
  });
  if (!res.ok) {
    let message = "Vydání materiálu se nepodařilo.";
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
