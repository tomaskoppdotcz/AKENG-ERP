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

export type VpMaterialLine = {
  material_library_item_id: number;
  material: {
    code: string | null;
    name: string | null;
    dimension: string | null;
    unit: string | null;
  };
  required_qty: number;
  reserved_qty: number;
  available: number;
  shortage: number;
  status: string | null;
  reservation_id: number;
  reservation_ids?: number[];
  reservation_count?: number;
  reservation_lines?: Array<{
    reservation_id: number;
    required_qty: number;
    reserved_qty: number;
    status: string | null;
  }>;
  production_order_id: number;
  vp_code: string | null;
  zakazka: string | null;
  customer_order_id: number | null;
  gpn: string | null;
};

export type VpRequirementRow = {
  production_order_id: number;
  vp_code: string | null;
  zakazka: string | null;
  customer_order_id: number | null;
  order_type: string | null;
  gpn: string | null;
  due_date: string | null;
  job_item_id: number | null;
  is_material_ready: boolean;
  coverage: "covered" | "uncovered";
  materials: VpMaterialLine[];
};

export type MaterialPurchaseLinePayload = {
  material_library_item_id: number;
  qty_ordered: number;
  traceability_note?: string | null;
};

export type CustomerOption = {
  id: number;
  code: string;
  name: string;
  is_active?: boolean;
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

export async function getMaterialRequirementsByVp(): Promise<VpRequirementRow[]> {
  const res = await fetch(`${API_BASE}/planning/material/requirements-by-vp`);
  if (!res.ok) {
    let message = "Nepodařilo se načíst požadavky podle VP.";
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

export async function listCustomersForPurchase(): Promise<CustomerOption[]> {
  const res = await fetch(`${API_BASE}/customers`);
  if (!res.ok) {
    throw new Error("Nepodařilo se načíst dodavatele (adresář zákazníků).");
  }
  const raw = await res.json();
  if (!Array.isArray(raw)) return [];
  return raw.map((c: { id: number; code: string; name: string; is_active?: boolean }) => ({
    id: c.id,
    code: c.code,
    name: c.name,
    is_active: c.is_active,
  }));
}

export async function postMaterialPurchaseOrder(payload: {
  supplier_customer_id: number;
  lines: MaterialPurchaseLinePayload[];
  header_note?: string | null;
}): Promise<{ status: string; material_purchase_order_id: number; lines_count: number; supplier_name: string }> {
  const res = await fetch(`${API_BASE}/planning/material/purchase-orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      supplier_customer_id: payload.supplier_customer_id,
      lines: payload.lines.map((l) => ({
        material_library_item_id: l.material_library_item_id,
        qty_ordered: l.qty_ordered,
        traceability_note: l.traceability_note?.trim() || null,
      })),
      header_note: payload.header_note?.trim() || null,
    }),
  });
  if (!res.ok) {
    let message = "Uložení nákupní objednávky se nepodařilo.";
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
