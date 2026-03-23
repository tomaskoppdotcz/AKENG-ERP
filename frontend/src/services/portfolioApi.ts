const API_BASE =
  (import.meta as any).env?.VITE_API_BASE_URL || "http://127.0.0.1:8000";

export type PortfolioItem = {
  id: number;
  gpn: string;
  name: string;
  customer_id: number;
  group_id: number | null;
  active_template_id: number | null;
};

export type PortfolioTechnologyOperation = {
  id: number;
  operation_no: number;
  operation_name: string;
  machine_code: string | null;
  operation_library_item_id: number | null;
  workplace_library_item_id: number | null;
  setup_time_min: number;
  labor_time_per_piece_min: number;
  control_required: boolean;
  outsourcing: boolean;
  note: string | null;
};

export type PortfolioItemTechnologyResponse = {
  template_id: number | null;
  template_name: string | null;
  operations: PortfolioTechnologyOperation[];
};

export type PortfolioTechnologyMaterial = {
  id: number;
  material_library_item_id: number;
  material_name: string;
  material_code: string | null;
  consumption_per_piece: number | null;
  consumption_unit: string | null;
  scrap_allowance: number | null;
  note: string | null;
  stock_item_id: number | null;
  stock_location: string | null;
  stock_current_qty: number | null;
  stock_min_qty: number | null;
  stock_reserved_qty: number | null;
  stock_available_qty: number | null;
  stock_status: "neni_skladova_karta" | "pod_minimem" | "skladem";
};

export type PortfolioItemTechnologyMaterialsResponse = {
  template_id: number | null;
  materials: PortfolioTechnologyMaterial[];
};

export type PortfolioTechnologyMaterialCreatePayload = {
  material_library_item_id: number;
  consumption_per_piece: number | null;
  consumption_unit: string | null;
  scrap_allowance: number | null;
  note: string | null;
};

export type PortfolioTechnologyMaterialUpdatePayload = {
  material_library_item_id?: number;
  consumption_per_piece?: number | null;
  consumption_unit?: string | null;
  scrap_allowance?: number | null;
  note?: string | null;
};

/** POST /portfolio/templates/{id}/operations */
export type PortfolioTechnologyOperationCreatePayload = {
  operation_library_item_id: number;
  workplace_library_item_id: number | null;
  setup_time_min: number;
  labor_time_per_piece_min: number;
  control_required: boolean;
  outsourcing: boolean;
  note: string | null;
};

/** PUT /portfolio/template-operations/{id} — partial updates */
export type PortfolioTechnologyOperationUpdatePayload = {
  operation_no?: number;
  operation_library_item_id?: number | null;
  workplace_library_item_id?: number | null;
  setup_time_min?: number;
  labor_time_per_piece_min?: number;
  control_required?: boolean;
  outsourcing?: boolean;
  note?: string | null;
};

export type CreatePortfolioTechnologyTemplateResponse = {
  template_id: number;
  template_name: string;
  created: boolean;
};

export type OperationLibraryItem = {
  id: number;
  code: string | null;
  name: string;
  description: string | null;
  is_active: boolean;
};

export type WorkplaceLibraryItem = {
  id: number;
  code: string | null;
  name: string;
  workplace_type: string | null;
  hourly_rate: number | null;
  is_active: boolean;
};

export async function getOperationLibraryItems(): Promise<OperationLibraryItem[]> {
  const res = await fetch(`${API_BASE}/libraries/operations`);
  if (!res.ok) {
    throw new Error("Nepodarilo se nacist knihovnu operaci.");
  }
  return res.json();
}

export async function getWorkplaceLibraryItems(): Promise<WorkplaceLibraryItem[]> {
  const res = await fetch(`${API_BASE}/libraries/workplaces`);
  if (!res.ok) {
    throw new Error("Nepodarilo se nacist knihovnu pracovist.");
  }
  return res.json();
}

export async function getPortfolioItems(): Promise<PortfolioItem[]> {
  const res = await fetch(`${API_BASE}/portfolio/items`);
  if (!res.ok) {
    throw new Error("Nepodarilo se nacist portfolio polozky.");
  }
  return res.json();
}

/** Najde portfolio položku podle GPN (trim, přesná shoda). */
export async function findPortfolioItemByGpn(gpn: string): Promise<PortfolioItem | null> {
  const needle = gpn.trim();
  if (!needle) return null;
  const items = await getPortfolioItems();
  const found = items.find((i) => i.gpn.trim() === needle);
  return found ?? null;
}

export async function getPortfolioItemTechnology(
  itemId: number
): Promise<PortfolioItemTechnologyResponse> {
  const res = await fetch(`${API_BASE}/portfolio/items/${itemId}/technology`);
  if (!res.ok) {
    throw new Error("Nepodarilo se nacist technologicky postup.");
  }
  return res.json();
}

export async function reorderPortfolioTechnologyOperations(
  templateId: number,
  orderedOperationIds: number[]
): Promise<{ status: string }> {
  const res = await fetch(`${API_BASE}/portfolio/templates/${templateId}/operations/reorder`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ordered_operation_ids: orderedOperationIds }),
  });
  if (!res.ok) {
    throw new Error("Nepodarilo se zmenit poradi operaci.");
  }
  return res.json();
}

export async function createPortfolioTechnologyOperation(
  templateId: number,
  payload: PortfolioTechnologyOperationCreatePayload
): Promise<PortfolioTechnologyOperation> {
  const res = await fetch(`${API_BASE}/portfolio/templates/${templateId}/operations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error("Nepodarilo se pridat operaci.");
  }
  return res.json();
}

export async function updatePortfolioTechnologyOperation(
  operationId: number,
  payload: PortfolioTechnologyOperationUpdatePayload
): Promise<PortfolioTechnologyOperation> {
  const res = await fetch(`${API_BASE}/portfolio/template-operations/${operationId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error("Nepodarilo se upravit operaci.");
  }
  return res.json();
}

export async function deletePortfolioTechnologyOperation(
  operationId: number
): Promise<{ status: string }> {
  const res = await fetch(`${API_BASE}/portfolio/template-operations/${operationId}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    throw new Error("Nepodarilo se smazat operaci.");
  }
  return res.json();
}

export async function createPortfolioTechnologyTemplate(
  itemId: number
): Promise<CreatePortfolioTechnologyTemplateResponse> {
  const res = await fetch(`${API_BASE}/portfolio/items/${itemId}/technology-template`, {
    method: "POST",
  });
  if (!res.ok) {
    throw new Error("Nepodarilo se vytvorit technologicky postup.");
  }
  return res.json();
}

export async function getPortfolioTechnologyMaterials(
  itemId: number
): Promise<PortfolioItemTechnologyMaterialsResponse> {
  const res = await fetch(`${API_BASE}/portfolio/items/${itemId}/technology-material`);
  if (!res.ok) {
    throw new Error("Nepodarilo se nacist material technologickeho postupu.");
  }
  return res.json();
}

export async function createPortfolioTechnologyMaterial(
  templateId: number,
  payload: PortfolioTechnologyMaterialCreatePayload
): Promise<PortfolioTechnologyMaterial> {
  const res = await fetch(`${API_BASE}/portfolio/templates/${templateId}/technology-material`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error("Nepodarilo se pridat material.");
  }
  return res.json();
}

export async function updatePortfolioTechnologyMaterial(
  id: number,
  payload: PortfolioTechnologyMaterialUpdatePayload
): Promise<PortfolioTechnologyMaterial> {
  const res = await fetch(`${API_BASE}/portfolio/technology-material/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error("Nepodarilo se upravit material.");
  }
  return res.json();
}

export async function deletePortfolioTechnologyMaterial(id: number): Promise<{ status: string }> {
  const res = await fetch(`${API_BASE}/portfolio/technology-material/${id}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    throw new Error("Nepodarilo se smazat material.");
  }
  return res.json();
}

