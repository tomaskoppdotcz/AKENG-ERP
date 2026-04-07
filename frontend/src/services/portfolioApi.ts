import { akengFetch } from "./akengFetch";

const API_BASE =
  (import.meta as any).env?.VITE_API_BASE_URL || "http://127.0.0.1:8000";

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

export type PortfolioGroup = {
  id: number;
  name: string;
  code: string | null;
  customer_id: number;
  is_active: boolean;
};

export type PortfolioGroupCreatePayload = {
  name: string;
  customer_id: number;
  code: string | null;
  is_active: boolean;
};

export type PortfolioGroupUpdatePayload = Partial<PortfolioGroupCreatePayload>;

export type PortfolioItem = {
  id: number;
  gpn: string;
  scan_code?: string | null;
  name: string;
  customer_id: number;
  customer_name?: string | null;
  group_id: number | null;
  group_name?: string | null;
  portfolio_group_id?: number | null;
  drawing_no?: string | null;
  revision?: string | null;
  material_default?: string | null;
  logistic_mode?: string;
  sale_price_per_piece?: number | null;
  is_active?: boolean;
  active_template_id: number | null;
};

/** Český popisek logistického režimu (shodně s přehledem portfolia). */
export function logisticModeLabelCs(mode: string | null | undefined): string {
  const m = (mode ?? "").trim();
  if (!m) return "—";
  if (m === "sklad") return "Sklad";
  if (m === "sklad_zakaznik") return "Sklad zákazník";
  return "Výroba zákazník";
}

/** Text pro rozlišení variant portfolia se stejným GPN (např. výběr v zakázce). */
export function portfolioVariantOptionText(item: PortfolioItem): string {
  const rev = (item.revision ?? "").trim() || "—";
  const drw = (item.drawing_no ?? "").trim() || "—";
  const nm = (item.name ?? "").trim() || "—";
  const log = logisticModeLabelCs(item.logistic_mode);
  return `ID ${item.id} · GPN ${item.gpn} · ${nm} · výkres ${drw} · rev. ${rev} · ${log}`;
}

export type PortfolioItemCreatePayload = {
  gpn: string;
  name: string;
  customer_id: number;
  portfolio_group_id: number | null;
  drawing_no: string | null;
  revision: string | null;
  material_default: string | null;
  logistic_mode: string;
  sale_price_per_piece: number | null;
  is_active: boolean;
};

export type PortfolioItemUpdatePayload = Partial<PortfolioItemCreatePayload>;

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
  input_type?: "material" | "product_stock";
  material_library_item_id: number | null;
  material_name: string;
  material_code: string | null;
  portfolio_item_id?: number | null;
  portfolio_item_gpn?: string | null;
  portfolio_item_name?: string | null;
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
  input_type: "material" | "product_stock";
  material_library_item_id: number | null;
  portfolio_item_id: number | null;
  consumption_per_piece: number | null;
  consumption_unit: string | null;
  scrap_allowance: number | null;
  note: string | null;
};

export type PortfolioTechnologyMaterialUpdatePayload = {
  input_type?: "material" | "product_stock";
  material_library_item_id?: number | null;
  portfolio_item_id?: number | null;
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

export async function getPortfolioGroups(customerId?: number | null): Promise<PortfolioGroup[]> {
  const url = new URL(`${API_BASE}/portfolio/groups`);
  if (customerId != null && Number.isFinite(customerId) && customerId > 0) {
    url.searchParams.set("customer_id", String(customerId));
  }
  const res = await akengFetch(url.toString());
  if (!res.ok) {
    throw new Error("Nepodařilo se načíst skupiny portfolia.");
  }
  return res.json();
}

export async function createPortfolioGroup(payload: PortfolioGroupCreatePayload): Promise<PortfolioGroup> {
  const res = await akengFetch(`${API_BASE}/portfolio/groups`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "Nepodařilo se vytvořit skupinu portfolia."));
  }
  return res.json();
}

export async function updatePortfolioGroup(id: number, payload: PortfolioGroupUpdatePayload): Promise<PortfolioGroup> {
  const res = await akengFetch(`${API_BASE}/portfolio/groups/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "Nepodařilo se upravit skupinu portfolia."));
  }
  return res.json();
}

export async function deletePortfolioGroup(id: number): Promise<{ status: string }> {
  const res = await akengFetch(`${API_BASE}/portfolio/groups/${id}`, { method: "DELETE" });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "Nepodařilo se smazat skupinu portfolia."));
  }
  return res.json();
}

export async function getPortfolioItems(): Promise<PortfolioItem[]> {
  const res = await akengFetch(`${API_BASE}/portfolio/items`);
  if (!res.ok) {
    throw new Error("Nepodarilo se nacist portfolio polozky.");
  }
  return res.json();
}

export async function getPortfolioItem(id: number): Promise<PortfolioItem> {
  const res = await akengFetch(`${API_BASE}/portfolio/items/${id}`);
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "Nepodařilo se načíst položku portfolia."));
  }
  return res.json();
}

export async function createPortfolioItem(payload: PortfolioItemCreatePayload): Promise<PortfolioItem> {
  const res = await akengFetch(`${API_BASE}/portfolio/items`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error("Nepodarilo se vytvořit portfolio položku.");
  }
  return res.json();
}

export async function updatePortfolioItem(id: number, payload: PortfolioItemUpdatePayload): Promise<PortfolioItem> {
  const res = await akengFetch(`${API_BASE}/portfolio/items/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error("Nepodarilo se upravit portfolio položku.");
  }
  return res.json();
}

export async function deletePortfolioItem(id: number): Promise<{ status: string }> {
  const res = await akengFetch(`${API_BASE}/portfolio/items/${id}`, { method: "DELETE" });
  if (!res.ok) {
    throw new Error("Nepodarilo se smazat portfolio položku.");
  }
  return res.json();
}

export async function copyPortfolioItem(id: number, payload: PortfolioItemCreatePayload): Promise<PortfolioItem> {
  const res = await akengFetch(`${API_BASE}/portfolio/items/${id}/copy`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "Nepodařilo se zkopírovat portfolio položku."));
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
  const res = await akengFetch(`${API_BASE}/portfolio/items/${itemId}/technology`);
  if (!res.ok) {
    throw new Error("Nepodarilo se nacist technologicky postup.");
  }
  return res.json();
}

export async function reorderPortfolioTechnologyOperations(
  templateId: number,
  orderedOperationIds: number[]
): Promise<{ status: string }> {
  const res = await akengFetch(`${API_BASE}/portfolio/templates/${templateId}/operations/reorder`, {
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
  const res = await akengFetch(`${API_BASE}/portfolio/templates/${templateId}/operations`, {
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
  const res = await akengFetch(`${API_BASE}/portfolio/template-operations/${operationId}`, {
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
  const res = await akengFetch(`${API_BASE}/portfolio/template-operations/${operationId}`, {
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
  const res = await akengFetch(`${API_BASE}/portfolio/items/${itemId}/technology-template`, {
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
  const res = await akengFetch(`${API_BASE}/portfolio/items/${itemId}/technology-material`);
  if (!res.ok) {
    throw new Error("Nepodarilo se nacist material technologickeho postupu.");
  }
  return res.json();
}

export async function createPortfolioTechnologyMaterial(
  templateId: number,
  payload: PortfolioTechnologyMaterialCreatePayload
): Promise<PortfolioTechnologyMaterial> {
  const res = await akengFetch(`${API_BASE}/portfolio/templates/${templateId}/technology-material`, {
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
  const res = await akengFetch(`${API_BASE}/portfolio/technology-material/${id}`, {
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
  const res = await akengFetch(`${API_BASE}/portfolio/technology-material/${id}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    throw new Error("Nepodarilo se smazat material.");
  }
  return res.json();
}

