/**
 * Provozní české popisky stavu VP v přehledu — stejná terminologie jako u detailu (operational, ne raw DB).
 */

import type { ProductionOrderOverviewRow } from "../services/productionOrdersApi";

/** Kanonický agregát z API po přepočtu z logů: planned | bezi | hotovo. */
export function normalizeProductionOrderAggregateStatus(raw: string | null | undefined): "planned" | "bezi" | "hotovo" {
  const s = (raw || "").trim().toLowerCase();
  if (s === "hotovo" || s === "done" || s === "finished" || s === "complete" || s === "completed") return "hotovo";
  if (s === "bezi" || s === "in_progress" || s === "running" || s === "started") return "bezi";
  return "planned";
}

function isWorkflowCancelled(workflow: string | null | undefined): boolean {
  const w = (workflow || "").trim().toLowerCase();
  return w === "cancelled" || w === "canceled" || w === "storno";
}

/** Filt „Dokončená“ — kanonicky hotovo + legacy aliasy. */
export function isProductionOrderOverviewCompleted(row: ProductionOrderOverviewRow): boolean {
  return normalizeProductionOrderAggregateStatus(row.status) === "hotovo";
}

/**
 * Text do sloupce „Stav“ v přehledu VP.
 * Pořadí: storno → blok WIP → dokončení (sklad/expedice/hotovo) → běží → materiál → naplánováno.
 */
export function formatProductionOrderOverviewOperationalStatus(row: ProductionOrderOverviewRow): string {
  if (isWorkflowCancelled(row.workflow_status)) return "Stornováno";
  if (row.blocked_until_reserved_stock_receipt === true) return "Blokováno";

  const agg = normalizeProductionOrderAggregateStatus(row.status);
  const terminal = row.completion_terminal;

  if (agg === "hotovo") {
    if (terminal === "stock") return "Na skladě";
    if (terminal === "expedition") return "K expedici";
    return "Hotovo";
  }
  if (agg === "bezi") return "Běží";

  const matReleased = Boolean(row.is_material_released_to_production ?? row.is_material_ready);
  if (!matReleased) return "Čeká na materiál";

  return "Naplánováno";
}
