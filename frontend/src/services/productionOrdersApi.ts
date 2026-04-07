import type { ErpWorkflowListFilter } from "./ordersApi";
import { akengFetch } from "./akengFetch";

const API_BASE =
  (import.meta as any).env?.VITE_API_BASE_URL || "http://127.0.0.1:8000";

export type ProductionOrderOverviewRow = {
  id: number;
  vp_code: string;
  scan_code?: string | null;
  gpn: string | null;
  description: string | null;
  quantity: number;
  logistic_mode: string | null;
  source_type: string | null;
  status: string | null;
  zakazka: string | null;
  line_no: number | null;
  due_date: string | null;
  order_type: string | null;
  portfolio_item_id?: number | null;
  customer_order_id?: number | null;
  job_item_id?: number | null;
  /** Obchodní workflow; prázdné / active = aktivní VP */
  workflow_status?: string | null;
  /** Pokryto — lze vydat */
  is_material_covered?: boolean | null;
  /** Vydáno na výrobu — plánovač / start operace */
  is_material_released_to_production?: boolean | null;
  /** Alias: stejné jako is_material_released_to_production */
  is_material_ready?: boolean | null;
};

export type ProductionOrderOperationRow = {
  id: number;
  operation_no: number;
  operation_name: string;
  workplace_name: string | null;
  setup_time_min: number;
  run_min_per_piece: number;
  control_required: boolean;
  outsourcing: boolean;
  note: string | null;
  operation_scan_code?: string | null;
  operation_status?: "planned" | "in_progress" | "done";
  started_at?: string | null;
  last_reported_at?: string | null;
  reported_ok_qty_total?: number;
  reported_nok_qty_total?: number;
  reported_minutes_total?: number;
};

export type MaterialTraceabilityAttachment = {
  id: number;
  original_filename: string;
  download_url: string;
};

/** Resolved from VP-linked výdej → příjem batch (audit / certificate). */
export type MaterialTraceabilityForInput = {
  heat_lot: string | null;
  supplier_name: string | null;
  delivery_note_no: string | null;
  certificate_no: string | null;
  attachments: MaterialTraceabilityAttachment[];
  /** True pokud existuje pohyb výdej navázaný na VP (viz issue_movement_id). */
  has_issued_movement?: boolean;
  issue_movement_id?: number | null;
  /** production_order | job_item — jak byla nalezena vazba výdeje */
  linkage?: string | null;
  movement_scan_code?: string | null;
  stock_location?: string | null;
  length_per_piece_mm?: number | null;
  weight_per_piece_kg?: number | null;
  material_code?: string | null;
  material_name?: string | null;
  material_dimension?: string | null;
};

export type ProductionOrderInputRow = {
  id: number;
  input_type: string;
  material_code: string | null;
  material_name: string | null;
  portfolio_item_gpn: string | null;
  portfolio_item_name: string | null;
  consumption_per_piece: number;
  consumption_unit: string | null;
  scrap_allowance: number;
  /** (consumption_per_piece + scrap_allowance) * VP quantity; same unit as consumption */
  total_consumption?: number | null;
  note: string | null;
  material_library_item_id?: number | null;
  material_traceability?: MaterialTraceabilityForInput | null;
};

export type ProductionOrderDetail = {
  id: number;
  vp_code: string;
  scan_code?: string | null;
  workflow_status?: string | null;
  zakazka: string | null;
  customer_order_id?: number | null;
  job_item_id?: number | null;
  order_type: string | null;
  line_no: number | null;
  gpn: string | null;
  description: string | null;
  portfolio_item_id: number | null;
  portfolio_item_name: string | null;
  portfolio_item_logistic_mode: string | null;
  logistic_mode: string | null;
  source_type: string | null;
  status: string | null;
  quantity: number;
  is_material_covered?: boolean | null;
  is_material_released_to_production?: boolean | null;
  is_material_ready?: boolean | null;
  technology_template: {
    id: number;
    name: string;
  } | null;
  operations: ProductionOrderOperationRow[];
  inputs: ProductionOrderInputRow[];
};

export async function getProductionOrdersOverview(
  workflowFilter: ErpWorkflowListFilter = "active"
): Promise<ProductionOrderOverviewRow[]> {
  const q = new URLSearchParams({ workflow_filter: workflowFilter });
  const res = await akengFetch(`${API_BASE}/production-orders?${q.toString()}`);
  if (!res.ok) {
    throw new Error("Nepodařilo se načíst výrobní příkazy.");
  }
  const raw = await res.json();
  return Array.isArray(raw?.items) ? raw.items : [];
}

export async function getProductionOrderDetail(productionOrderId: number): Promise<ProductionOrderDetail> {
  const res = await akengFetch(`${API_BASE}/production-orders/${productionOrderId}`);
  if (res.status === 404) {
    throw new Error("Výrobní příkaz nebyl nalezen.");
  }
  if (!res.ok) {
    throw new Error("Nepodařilo se načíst detail výrobního příkazu.");
  }
  return res.json();
}

export async function stornoProductionOrder(productionOrderId: number): Promise<void> {
  const res = await akengFetch(`${API_BASE}/production-orders/${productionOrderId}/storno`, { method: "POST" });
  if (!res.ok) {
    let message = "Storno výrobního příkazu se nepodařilo.";
    try {
      const data = await res.json();
      if (typeof data?.detail === "string") message = data.detail;
    } catch {
      // ignore
    }
    throw new Error(message);
  }
}

export type ProductionOperationReportPayload = {
  ok_qty: number;
  nok_qty: number;
  reported_minutes: number;
  note: string | null;
};

export async function startProductionOrderOperation(productionOrderId: number, operationNo: number): Promise<void> {
  const res = await akengFetch(`${API_BASE}/production-orders/${productionOrderId}/operations/${operationNo}/start`, {
    method: "POST",
  });
  if (!res.ok) {
    throw new Error("Nepodařilo se zahájit operaci.");
  }
}

export async function reportProductionOrderOperation(
  productionOrderId: number,
  operationNo: number,
  payload: ProductionOperationReportPayload
): Promise<{ status: string; po_status?: string }> {
  const res = await akengFetch(`${API_BASE}/production-orders/${productionOrderId}/operations/${operationNo}/report`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error("Nepodařilo se odvést operaci.");
  }
  return res.json();
}

export async function receiveFinishedGoodsToStock(
  productionOrderId: number,
  payload: { qty: number; location: string | null }
): Promise<{ status: string; product_stock_item_id: number; qty_received: number; current_qty: number }> {
  const res = await akengFetch(`${API_BASE}/production-orders/${productionOrderId}/receive-to-stock`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      qty: payload.qty,
      location: payload.location?.trim() || null,
    }),
  });
  if (!res.ok) {
    let message = "Příjem na sklad se nepodařil.";
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
