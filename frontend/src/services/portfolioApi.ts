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

export type PortfolioOperationPayload = {
  operation_name: string;
  machine_code: string | null;
  setup_time_min: number;
  labor_time_per_piece_min: number;
  control_required: boolean;
  outsourcing: boolean;
  note: string | null;
};

export async function getPortfolioItems(): Promise<PortfolioItem[]> {
  const res = await fetch(`${API_BASE}/portfolio/items`);
  if (!res.ok) {
    throw new Error("Nepodarilo se nacist portfolio polozky.");
  }
  return res.json();
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

export async function createPortfolioTechnologyOperation(
  templateId: number,
  payload: PortfolioOperationPayload
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
  payload: PortfolioOperationPayload
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

