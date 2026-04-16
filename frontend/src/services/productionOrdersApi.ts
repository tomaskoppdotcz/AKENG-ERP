import type { ErpWorkflowListFilter } from "./ordersApi";
import { akengFetch } from "./akengFetch";

const API_BASE =
  (import.meta as any).env?.VITE_API_BASE_URL || "http://127.0.0.1:8000";

export type ProductionOrderOverviewRow = {
  id: number;
  vp_code: string;
  scan_code?: string | null;
  gpn: string | null;
  /** Z `portfolio_items.drawing_no` (portfolio řádku / VP). */
  drawing_number?: string | null;
  /** Z `portfolio_items.revision`. */
  drawing_revision?: string | null;
  description: string | null;
  quantity: number;
  logistic_mode: string | null;
  source_type: string | null;
  status: string | null;
  /** Po dokončení všech operací: sklad vs expedice podle názvu poslední operace TP (jen přehled). */
  completion_terminal?: "stock" | "expedition" | null;
  zakazka: string | null;
  /** Číslo objednávky zákazníka (customer_po_no) */
  customer_order_no?: string | null;
  line_no: number | null;
  due_date: string | null;
  order_type: string | null;
  portfolio_item_id?: number | null;
  customer_order_id?: number | null;
  job_item_id?: number | null;
  /** VP přesunutý z interního doplnění skladu (prefer_customer) */
  restock_redirected_from_internal?: boolean | null;
  /** sklad_zakaznik VP čekající na příjem z rezervovaného restock WIP */
  blocked_until_reserved_stock_receipt?: boolean | null;
  /** Obchodní workflow; prázdné / active = aktivní VP */
  workflow_status?: string | null;
  /** Pokryto — lze vydat */
  is_material_covered?: boolean | null;
  /** Vydáno na výrobu — plánovač / start operace */
  is_material_released_to_production?: boolean | null;
  /** Alias: stejné jako is_material_released_to_production */
  is_material_ready?: boolean | null;
  /** Součet duration_min z work_reports pro VP */
  reported_time_min?: number;
  /** Součet (min/60)*cost_rate jen u záznamů se zaměstnancem a sazbou */
  direct_labor_cost?: number;
  /** Podíl dokončených planning_operations (hotovo) / celkem, % */
  completion_percent?: number | null;
  /** planned_runtime / vykázaný čas * 100; null bez plánu nebo vykázaného času */
  performance_percent?: number | null;
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
  /** Log-derived: naplánováno / běží / hotovo (canonical with planning shopfloor). */
  operation_status?: "planned" | "bezi" | "hotovo";
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
  /** Termín řádku zakázky (YYYY-MM-DD), pokud je u položky vyplněn. */
  due_date?: string | null;
  quantity: number;
  is_material_covered?: boolean | null;
  is_material_released_to_production?: boolean | null;
  is_material_ready?: boolean | null;
  customer_order_no?: string | null;
  restock_redirected_from_internal?: boolean | null;
  blocked_until_reserved_stock_receipt?: boolean | null;
  technology_template: {
    id: number;
    name: string;
  } | null;
  operations: ProductionOrderOperationRow[];
  inputs: ProductionOrderInputRow[];
  reported_time_min?: number;
  direct_labor_cost?: number;
  completion_percent?: number | null;
  performance_percent?: number | null;
  /** Poloha z běžící planning operace (stroj) */
  current_location?: string | null;
  /** Fáze z planning_operations: planned | bezi | hotovo */
  current_phase?: string | null;
};

/** Nedávno splněné rezervace výstupu z restock VP (GET restock-wip-reservation-notices). */
export type RestockWipReservationNotice = {
  reservation_id: number;
  fulfilled_at: string | null;
  reserved_qty: number;
  source_production_order_id: number;
  source_vp_code: string | null;
  customer_production_order_id: number | null;
  customer_vp_code: string | null;
  user_message_cs: string;
};

export async function getRestockWipReservationNotices(limit = 30): Promise<RestockWipReservationNotice[]> {
  const q = new URLSearchParams({ limit: String(Math.min(200, Math.max(1, limit))) });
  const res = await akengFetch(`${API_BASE}/production-orders/restock-wip-reservation-notices?${q}`);
  if (!res.ok) {
    return [];
  }
  try {
    const raw = await res.json();
    return Array.isArray(raw?.items) ? raw.items : [];
  } catch {
    return [];
  }
}

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

export async function regenerateProductionOrderFromTp(
  productionOrderId: number
): Promise<{ status: string; production_order_id: number; vp_code: string; planner_rows: number }> {
  const res = await akengFetch(`${API_BASE}/production-orders/${productionOrderId}/regenerate-from-tp`, {
    method: "POST",
  });
  if (!res.ok) {
    let message = "Přegenerování VP z TP se nepodařilo.";
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

/** Otevře PDF VP v nové záložce; posílá `X-AKENG-Role` jako ostatní API volání. */
export async function openProductionOrderPdfInNewTab(productionOrderId: number): Promise<void> {
  const res = await akengFetch(`${API_BASE}/production-orders/${productionOrderId}/print`);
  if (!res.ok) {
    let message =
      res.status === 403
        ? "Nemáte oprávnění k tisku výrobního příkazu."
        : `Tisk VP se nepodařil (HTTP ${res.status}).`;
    try {
      const data = await res.json();
      if (typeof data?.detail === "string") message = data.detail;
      else if (res.status === 403 && Array.isArray(data?.detail) && data.detail[0]?.msg) {
        message = String(data.detail[0].msg);
      }
    } catch {
      // ignore
    }
    throw new Error(message);
  }
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const w = window.open(objectUrl, "_blank", "noopener,noreferrer");
  if (!w) {
    URL.revokeObjectURL(objectUrl);
    throw new Error("Prohlížeč zablokoval nové okno — povolte vyskakovací okna.");
  }
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 120_000);
}
