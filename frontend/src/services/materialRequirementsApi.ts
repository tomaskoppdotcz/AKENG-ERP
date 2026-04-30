import { akengFetch } from "./akengFetch";

export type MaterialIssueAllocationDefaults = {
  requested_piece_count: number;
  delka_na_kus_mm: number;
  vyrabeno_po: number;
  na_upnuti_mm: number;
  prorez_mm: number;
  povolit_deleni_polotovaru: boolean;
  minimalni_zbytek_pouzitelny_mm: number;
  minimalni_vydavana_delka_mm: number;
};

export type MaterialCutPlanLine = {
  cut_length_mm: number;
  cut_count: number;
  finished_pieces_per_cut: number;
  total_finished_pieces: number;
};

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
    issue_allocation_params?: MaterialIssueAllocationDefaults | null;
  }>;
  production_order_id: number | null;
  vp_code: string | null;
  job_item_id: number | null;
  customer_order_id: number | null;
  zakazka: string | null;
  gpn: string | null;
  required_qty: number;
  reserved_qty: number;
  required_qty_total_mm?: number;
  available_qty_mm?: number;
  raw_available_qty_mm?: number;
  usable_reserved_qty_mm?: number;
  raw_shortage_mm?: number;
  covered_piece_count?: number | null;
  missing_piece_count?: number | null;
  purchase_required_qty_mm?: number;
  purchase_cut_plan?: MaterialCutPlanLine[];
  required_cut_plan?: MaterialCutPlanLine[];
  current_usable_cut_plan?: MaterialCutPlanLine[];
  unusable_leftover_mm?: number;
  purchase_feasibility_validated?: boolean | null;
  status: string | null;
};

export type MaterialRequirementRow = {
  material_library_item_id: number;
  material: {
    code: string | null;
    name: string | null;
  };
  required: number;
  /** Součet reserved_qty z aktivních rezervací (shodně s backendem). */
  reserved?: number;
  /** Fyzický stav skladu (součet current_qty). */
  available: number;
  /** Volné množství po odečtu eligible rezervací (volitelné, backend ≥ tato úprava). */
  free_for_allocation?: number;
  shortage: number;
  required_qty_total_mm?: number;
  available_qty_mm?: number;
  raw_available_qty_mm?: number;
  usable_reserved_qty_mm?: number;
  raw_shortage_mm?: number;
  covered_piece_count?: number | null;
  missing_piece_count?: number | null;
  purchase_required_qty_mm?: number;
  purchase_cut_plan?: MaterialCutPlanLine[];
  required_cut_plan?: MaterialCutPlanLine[];
  current_usable_cut_plan?: MaterialCutPlanLine[];
  unusable_leftover_mm?: number;
  purchase_feasibility_validated?: boolean | null;
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
  free_for_allocation?: number;
  shortage: number;
  required_qty_total_mm?: number;
  available_qty_mm?: number;
  raw_available_qty_mm?: number;
  usable_reserved_qty_mm?: number;
  raw_shortage_mm?: number;
  covered_piece_count?: number | null;
  missing_piece_count?: number | null;
  purchase_required_qty_mm?: number;
  purchase_cut_plan?: MaterialCutPlanLine[];
  required_cut_plan?: MaterialCutPlanLine[];
  current_usable_cut_plan?: MaterialCutPlanLine[];
  unusable_leftover_mm?: number;
  purchase_feasibility_validated?: boolean | null;
  status: string | null;
  reservation_id: number;
  reservation_ids?: number[];
  reservation_count?: number;
  reservation_lines?: Array<{
    reservation_id: number;
    required_qty: number;
    reserved_qty: number;
    status: string | null;
    issue_allocation_params?: MaterialIssueAllocationDefaults | null;
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
  /** Pokrytí skladem + rezervacemi (Vydat vs Objednat). */
  is_material_covered?: boolean;
  /** Skutečné vydání na výrobu — shodně s plánovačem. */
  is_material_released_to_production?: boolean;
  /** @deprecated alias pro is_material_released_to_production */
  is_material_ready: boolean;
  coverage: "covered" | "uncovered";
  materials: VpMaterialLine[];
};

const API_BASE = (import.meta as any).env?.VITE_API_BASE_URL || "http://127.0.0.1:8000";

export async function postMaterialReservationsRebuildAll(): Promise<{ status: string } & Record<string, unknown>> {
  const res = await akengFetch(`${API_BASE}/planning/material-reservations/rebuild-all`, { method: "POST" });
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
  const res = await akengFetch(`${API_BASE}/planning/material/requirements`);
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
  const res = await akengFetch(`${API_BASE}/planning/material/requirements-by-vp`);
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

export type MaterialIssuePayload = {
  reservation_id: number;
  qty?: number | null;
  stock_item_id?: number | null;
  heat_lot?: string | null;
  note?: string | null;
  requested_piece_count?: number | null;
  delka_na_kus_mm?: number | null;
  vyrabeno_po?: number | null;
  na_upnuti_mm?: number | null;
  prorez_mm?: number | null;
  povolit_deleni_polotovaru?: boolean | null;
  minimalni_zbytek_pouzitelny_mm?: number | null;
  minimalni_vydavana_delka_mm?: number | null;
};

export async function postMaterialIssue(payload: MaterialIssuePayload): Promise<{
  status: string;
  reservation_id: number;
  issued_qty: number;
}> {
  const res = await akengFetch(`${API_BASE}/material-stock/issue`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      reservation_id: payload.reservation_id,
      qty: payload.qty ?? null,
      stock_item_id: payload.stock_item_id ?? null,
      heat_lot: payload.heat_lot?.trim() || null,
      note: payload.note?.trim() || null,
      requested_piece_count: payload.requested_piece_count ?? null,
      delka_na_kus_mm: payload.delka_na_kus_mm ?? null,
      vyrabeno_po: payload.vyrabeno_po ?? null,
      na_upnuti_mm: payload.na_upnuti_mm ?? null,
      prorez_mm: payload.prorez_mm ?? null,
      povolit_deleni_polotovaru: payload.povolit_deleni_polotovaru ?? null,
      minimalni_zbytek_pouzitelny_mm: payload.minimalni_zbytek_pouzitelny_mm ?? null,
      minimalni_vydavana_delka_mm: payload.minimalni_vydavana_delka_mm ?? null,
    }),
  });
  if (!res.ok) {
    let message = "Vydání materiálu se nepodařilo.";
    let extraSuggestion: string | undefined;
    try {
      const data = await res.json();
      if (typeof data?.detail === "string") message = data.detail;
      else if (data?.detail && typeof data.detail.message === "string") message = data.detail.message;
      const sug =
        data?.detail && typeof data.detail === "object" && data.detail.allocation_suggestion
          ? (data.detail.allocation_suggestion as { recommendation?: string })
          : null;
      extraSuggestion =
        typeof sug?.recommendation === "string" && sug.recommendation.trim() !== "" ? sug.recommendation : undefined;
    } catch {
      // ignore
    }
    throw new Error(extraSuggestion ? `${message}\n\n${extraSuggestion}` : message);
  }
  return res.json();
}
