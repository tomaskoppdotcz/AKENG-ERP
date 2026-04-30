import { akengFetch } from "./akengFetch";

const API_BASE =
  (import.meta as any).env?.VITE_API_BASE_URL || "http://127.0.0.1:8000";

export type MaterialStockItem = {
  id: number;
  scan_code?: string | null;
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
  note: string | null;
  is_active: boolean;
  reserved_qty: number;
  available_qty: number;
  first_receipt?: MaterialStockFirstReceipt | null;
};

export type MaterialStockMovementAttachment = {
  id: number;
  original_filename: string;
  mime_type: string;
  size_bytes: number;
  created_at: string | null;
  /** Path-only; prepend API base for download */
  download_url: string;
};

export type MaterialStockFirstReceipt = {
  movement_id: number;
  movement_date: string | null;
  receipt_unit_code?: string | null;
  heat_lot: string | null;
  certificate_no: string | null;
  delivery_note_no: string | null;
  supplier_name: string | null;
  attachments: MaterialStockMovementAttachment[];
};

export type MaterialStockMovement = {
  id: number;
  stock_item_id?: number | null;
  stock_scan_code?: string | null;
  material_code?: string | null;
  material_name?: string | null;
  material_dimension?: string | null;
  movement_type: "prijem" | "vydej" | "vydej_zbytek" | "korekce" | "storno_vydeje" | "odpis_zbytku" | "likvidace_zbytku";
  qty: number;
  movement_date: string;
  reference: string | null;
  note: string | null;
  heat_lot?: string | null;
  scan_code?: string | null;
  supplier_name?: string | null;
  delivery_note_no?: string | null;
  certificate_no?: string | null;
  attachments?: MaterialStockMovementAttachment[];
  receipt_unit_id?: number | null;
  receipt_unit_code?: string | null;
  remnant_stock_item_id?: number | null;
};

export type MaterialReceiptUnit = {
  id: number;
  receipt_unit_code: string;
  stock_item_id: number;
  stock_scan_code?: string | null;
  material_code?: string | null;
  material_name?: string | null;
  material_dimension?: string | null;
  received_qty: number;
  remaining_qty: number;
  uom: string | null;
  heat_lot: string | null;
  certificate_no: string | null;
  delivery_note_no: string | null;
  invoice_no: string | null;
  supplier_name: string | null;
  received_at: string;
  status: "active" | "consumed" | string;
};

export type MaterialRemnantStockItem = {
  id: number;
  remnant_code?: string | null;
  source_receipt_unit_id: number;
  source_receipt_unit_code?: string | null;
  source_stock_item_id: number;
  stock_scan_code?: string | null;
  material_library_item_id: number;
  material_code: string | null;
  material_name: string | null;
  material_form: string | null;
  material_dimension: string | null;
  qty: number;
  uom: string | null;
  heat_lot: string | null;
  certificate_no: string | null;
  delivery_note_no: string | null;
  invoice_no: string | null;
  supplier_name: string | null;
  received_at: string | null;
  created_at: string | null;
  status: "active" | "consumed" | "scrapped" | string;
  note: string | null;
};

export type ScrapReceiptUnitResponse = {
  status: string;
  message: string;
  scrapped_qty: number;
  movement: MaterialStockMovement;
  remnant: MaterialRemnantStockItem;
  receipt_unit: MaterialReceiptUnit;
  stock_item: MaterialStockItem;
};

export type DisposeRemnantStockItemResponse = {
  status: string;
  message: string;
  movement: MaterialStockMovement;
  remnant: MaterialRemnantStockItem;
};

export type MaterialStockMovementCreatePayload = {
  movement_type: "prijem" | "vydej" | "korekce" | "storno_vydeje";
  qty: number;
  movement_date: string;
  reference: string | null;
  note: string | null;
  heat_lot?: string | null;
  supplier_name?: string | null;
  delivery_note_no?: string | null;
  certificate_no?: string | null;
};

export type MaterialStockMovementUpdatePayload = MaterialStockMovementCreatePayload;

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

export type MaterialStockItemUpdatePayload = {
  location?: string | null;
  current_qty?: number;
  min_qty?: number | null;
  unit?: string | null;
  note?: string | null;
  is_active?: boolean;
};

export function materialMovementAttachmentFileUrl(downloadUrl: string): string {
  if (!downloadUrl) return "";
  if (downloadUrl.startsWith("http")) return downloadUrl;
  return `${API_BASE.replace(/\/$/, "")}${downloadUrl.startsWith("/") ? "" : "/"}${downloadUrl}`;
}

export async function getMaterialStockItems(opts?: { forJobItemId?: number }): Promise<MaterialStockItem[]> {
  const q = new URLSearchParams();
  if (opts?.forJobItemId != null && Number.isFinite(opts.forJobItemId)) {
    q.set("for_job_item_id", String(Math.floor(opts.forJobItemId)));
  }
  const suffix = q.toString() ? `?${q.toString()}` : "";
  const res = await akengFetch(`${API_BASE}/material-stock/items${suffix}`);
  if (!res.ok) throw new Error("Nepodařilo se načíst sklad materiálu.");
  const data = await res.json();
  // Endpoint vrací { items, total, limit, offset }; pro kompatibilitu držíme array-return.
  if (Array.isArray(data)) return data as MaterialStockItem[];
  return Array.isArray(data?.items) ? (data.items as MaterialStockItem[]) : [];
}

export type MaterialIssueProposal = {
  stock_item_id: number;
  scan_code?: string | null;
  location: string | null;
  current_qty: number;
  available_qty: number;
  heat_lot: string | null;
  oldest_prijem_at: string | null;
  suggested_issue_qty: number;
  strategy: string;
  /** True when FIFO z příjmu nenabídne tavbu — doplnit ručně. */
  heat_lot_must_be_manual?: boolean;
};

export type MaterialIssueProposalResponse = {
  reservation_id: number;
  required_qty: number;
  reserved_qty: number;
  material_library_item_id: number;
  material_code: string | null;
  material_name: string | null;
  proposal: MaterialIssueProposal | null;
};

export async function getMaterialIssueProposal(reservationId: number): Promise<MaterialIssueProposalResponse> {
  const res = await akengFetch(
    `${API_BASE}/material-stock/issue-proposal?reservation_id=${encodeURIComponent(String(reservationId))}`
  );
  if (!res.ok) {
    let message = "Nepodařilo se načíst návrh výdeje.";
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

export type MaterialIssueAllocationParams = {
  stock_item_id: number;
  requested_piece_count: number;
  delka_na_kus_mm: number;
  vyrabeno_po: number;
  na_upnuti_mm: number;
  prorez_mm: number;
  povolit_deleni_polotovaru: boolean;
  minimalni_zbytek_pouzitelny_mm: number;
  minimalni_vydavana_delka_mm: number;
};

export type MaterialIssueAllocationLine = {
  source_type: "receipt_unit" | "remnant" | string;
  movement_type: "vydej" | "vydej_zbytek" | string;
  receipt_unit_id: number | null;
  remnant_stock_item_id?: number | null;
  source_stock_item_id?: number | null;
  source_receipt_unit_id?: number | null;
  allocated_mm: number;
  finished_piece_count: number;
  cut_length_mm: number;
  cut_count: number;
  segment: string | null;
  heat_lot: string | null;
  certificate_no: string | null;
  delivery_note_no: string | null;
};

/** One required cut length aggregate (heuristic when FIFO blocks). */
export type MaterialIssueAllocationCutBucket = {
  cut_length_mm: number;
  cut_count: number;
};

/** Optimal reallocation hint (does not override FIFO issue; for planning only). */
export type MaterialIssueAllocationSuggestion = {
  can_issue: boolean;
  reason?: string | null;
  fifo_blocks?: boolean | null;
  alternate_order_tried?: boolean | null;
  usable_now: MaterialIssueAllocationCutBucket[];
  missing: MaterialIssueAllocationCutBucket[];
  recommendation: string;
  totals_mm?: { demand_mm?: number; available_stock_mm?: number } | null;
  single_bar_per_cut?: boolean | null;
  mixing_heat_lots_per_cut?: boolean | null;
};

export type MaterialIssueAllocationPreview = {
  ok: boolean;
  demand_total_mm: number;
  polotovar_length_mm: number;
  full_batches: number;
  remainder_pieces: number;
  remnant_selection?: string;
  remnant_stock_items?: MaterialRemnantStockItem[];
  lines: MaterialIssueAllocationLine[];
  error_code: string;
  message: string | null;
  allocation_suggestion?: MaterialIssueAllocationSuggestion | null;
};

function materialIssueAllocationQuery(params: MaterialIssueAllocationParams): string {
  const q = new URLSearchParams();
  q.set("stock_item_id", String(params.stock_item_id));
  q.set("requested_piece_count", String(params.requested_piece_count));
  q.set("delka_na_kus_mm", String(params.delka_na_kus_mm));
  q.set("vyrabeno_po", String(params.vyrabeno_po));
  q.set("na_upnuti_mm", String(params.na_upnuti_mm));
  q.set("prorez_mm", String(params.prorez_mm));
  q.set("povolit_deleni_polotovaru", String(params.povolit_deleni_polotovaru));
  q.set("minimalni_zbytek_pouzitelny_mm", String(params.minimalni_zbytek_pouzitelny_mm));
  q.set("minimalni_vydavana_delka_mm", String(params.minimalni_vydavana_delka_mm));
  return q.toString();
}

export async function getMaterialIssueAllocationPreview(
  params: MaterialIssueAllocationParams
): Promise<MaterialIssueAllocationPreview> {
  const res = await akengFetch(`${API_BASE}/material-stock/issue-allocation-preview?${materialIssueAllocationQuery(params)}`);
  if (!res.ok) {
    let message = "Návrh výdeje se nepodařilo načíst.";
    try {
      const data = await res.json();
      if (typeof data?.detail === "string") message = data.detail;
      else if (data?.detail && typeof data.detail.message === "string") message = data.detail.message;
    } catch {
      // ignore
    }
    throw new Error(message);
  }
  return res.json();
}

export type JobItemMaterialIssueRow = {
  movement_id: number;
  movement_date: string | null;
  movement_type?: "vydej" | "vydej_zbytek" | string;
  qty: number;
  heat_lot: string | null;
  receipt_unit_id?: number | null;
  remnant_stock_item_id?: number | null;
  scan_code: string | null;
  reference: string | null;
  note: string | null;
  production_order_id: number | null;
  vp_code: string | null;
  job_item_id: number | null;
  stock_item_id: number | null;
  stock_scan_code: string | null;
  stock_location: string | null;
  material_code: string | null;
  material_name: string | null;
  material_dimension: string | null;
  operator: string | null;
};

export async function getMaterialIssuesForJobItem(jobItemId: number): Promise<{ items: JobItemMaterialIssueRow[] }> {
  const res = await akengFetch(`${API_BASE}/material-stock/job-items/${encodeURIComponent(String(jobItemId))}/material-issues`);
  if (!res.ok) {
    let message = "Nepodařilo se načíst výdeje materiálu.";
    try {
      const data = await res.json();
      if (typeof data?.detail === "string") message = data.detail;
    } catch {
      // ignore
    }
    throw new Error(message);
  }
  const raw = await res.json();
  return { items: Array.isArray(raw?.items) ? raw.items : [] };
}

export async function createMaterialStockItem(
  payload: MaterialStockItemCreatePayload
): Promise<MaterialStockItem> {
  const res = await akengFetch(`${API_BASE}/material-stock/items`, {
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

export async function updateMaterialStockItem(
  id: number,
  payload: MaterialStockItemUpdatePayload
): Promise<MaterialStockItem> {
  const res = await akengFetch(`${API_BASE}/material-stock/items/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error("Nepodařilo se upravit skladovou kartu.");
  return res.json();
}

export async function deleteMaterialStockItem(id: number): Promise<{ status: string }> {
  const res = await akengFetch(`${API_BASE}/material-stock/items/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Nepodařilo se smazat skladovou kartu.");
  return res.json();
}

export async function getMaterialStockMovements(stockItemId: number): Promise<MaterialStockMovement[]> {
  const res = await akengFetch(`${API_BASE}/material-stock/items/${stockItemId}/movements`);
  if (!res.ok) throw new Error("Nepodařilo se načíst pohyby materiálu.");
  return res.json();
}

export async function getGlobalMaterialStockReceipts(opts?: { search?: string }): Promise<MaterialStockMovement[]> {
  const q = new URLSearchParams();
  if (opts?.search?.trim()) q.set("search", opts.search.trim());
  const suffix = q.toString() ? `?${q.toString()}` : "";
  const res = await akengFetch(`${API_BASE}/material-stock/receipts${suffix}`);
  if (!res.ok) throw new Error("Nepodařilo se načíst příjmy materiálu.");
  const data = await res.json();
  return Array.isArray(data?.items) ? (data.items as MaterialStockMovement[]) : [];
}

export async function getGlobalMaterialStockMovements(opts?: {
  search?: string;
  movementType?: string;
}): Promise<MaterialStockMovement[]> {
  const q = new URLSearchParams();
  if (opts?.search?.trim()) q.set("search", opts.search.trim());
  if (opts?.movementType?.trim()) q.set("movement_type", opts.movementType.trim());
  const suffix = q.toString() ? `?${q.toString()}` : "";
  const res = await akengFetch(`${API_BASE}/material-stock/movements${suffix}`);
  if (!res.ok) throw new Error("Nepodařilo se načíst pohyby materiálu.");
  const data = await res.json();
  return Array.isArray(data?.items) ? (data.items as MaterialStockMovement[]) : [];
}

export async function getMaterialReceiptUnits(stockItemId: number): Promise<MaterialReceiptUnit[]> {
  const res = await akengFetch(`${API_BASE}/material-stock/items/${stockItemId}/receipt-units`);
  if (!res.ok) throw new Error("Nepodařilo se načíst příjmy / zůstatky tyčí.");
  return res.json();
}

export async function getGlobalMaterialReceiptUnits(opts?: {
  search?: string;
  status?: string;
}): Promise<MaterialReceiptUnit[]> {
  const q = new URLSearchParams();
  if (opts?.search?.trim()) q.set("search", opts.search.trim());
  if (opts?.status?.trim()) q.set("status", opts.status.trim());
  const suffix = q.toString() ? `?${q.toString()}` : "";
  const res = await akengFetch(`${API_BASE}/material-stock/receipt-units${suffix}`);
  if (!res.ok) throw new Error("Nepodařilo se načíst zůstatky tyčí.");
  const data = await res.json();
  return Array.isArray(data?.items) ? (data.items as MaterialReceiptUnit[]) : [];
}

export async function scrapMaterialReceiptUnit(receiptUnitId: number): Promise<ScrapReceiptUnitResponse> {
  const res = await akengFetch(`${API_BASE}/material-stock/receipt-units/${receiptUnitId}/scrap`, {
    method: "POST",
  });
  if (!res.ok) {
    let detail = "Nepodařilo se odepsat zbytek.";
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

export async function getMaterialRemnantStockItems(opts?: {
  status?: string;
  sourceStockItemId?: number;
  materialLibraryItemId?: number;
  search?: string;
}): Promise<MaterialRemnantStockItem[]> {
  const q = new URLSearchParams();
  if (opts?.status) q.set("status", opts.status);
  if (opts?.search?.trim()) q.set("search", opts.search.trim());
  if (opts?.sourceStockItemId != null && Number.isFinite(opts.sourceStockItemId)) {
    q.set("source_stock_item_id", String(Math.floor(opts.sourceStockItemId)));
  }
  if (opts?.materialLibraryItemId != null && Number.isFinite(opts.materialLibraryItemId)) {
    q.set("material_library_item_id", String(Math.floor(opts.materialLibraryItemId)));
  }
  const suffix = q.toString() ? `?${q.toString()}` : "";
  const res = await akengFetch(`${API_BASE}/material-stock/remnants${suffix}`);
  if (!res.ok) throw new Error("Nepodařilo se načíst sklad zbytků.");
  const data = await res.json();
  return Array.isArray(data?.items) ? (data.items as MaterialRemnantStockItem[]) : [];
}

export async function disposeMaterialRemnantStockItem(remnantId: number): Promise<DisposeRemnantStockItemResponse> {
  const res = await akengFetch(`${API_BASE}/material-stock/remnants/${remnantId}/dispose`, {
    method: "POST",
  });
  if (!res.ok) {
    let detail = "Nepodařilo se zlikvidovat zbytek.";
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

export async function getMaterialStockReservations(stockItemId: number): Promise<MaterialStockReservation[]> {
  const res = await akengFetch(`${API_BASE}/material-stock/items/${stockItemId}/reservations`);
  if (!res.ok) throw new Error("Nepodařilo se načíst rezervace materiálu.");
  return res.json();
}

export async function createMaterialReservation(
  payload: MaterialStockReservationCreatePayload
): Promise<MaterialStockReservation> {
  const res = await akengFetch(`${API_BASE}/material-stock/reservations`, {
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
  const res = await akengFetch(`${API_BASE}/material-stock/reservations/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Nepodařilo se zrušit rezervaci.");
  return res.json();
}

export async function createMaterialStockMovement(
  stockItemId: number,
  payload: MaterialStockMovementCreatePayload
): Promise<MaterialStockMovement> {
  const res = await akengFetch(`${API_BASE}/material-stock/items/${stockItemId}/movements`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    let detail = "Nepodařilo se uložit pohyb.";
    try {
      const data = await res.json();
      if (typeof data?.detail === "string" && data.detail) detail = data.detail;
      if (Array.isArray(data?.detail) && data.detail[0]?.msg) detail = String(data.detail[0].msg);
    } catch {
      // ignore json parse fail
    }
    throw new Error(detail);
  }
  return res.json();
}

export async function uploadMaterialMovementAttachments(
  movementId: number,
  files: File[]
): Promise<{ status: string; attachments: MaterialStockMovementAttachment[] }> {
  if (!files.length) {
    throw new Error("Vyberte alespoň jeden soubor.");
  }
  const fd = new FormData();
  for (const f of files) {
    fd.append("files", f);
  }
  const res = await akengFetch(`${API_BASE}/material-stock/movements/${movementId}/attachments`, {
    method: "POST",
    body: fd,
  });
  if (!res.ok) {
    let detail = "Nahrání příloh se nepodařilo.";
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

export async function updateMaterialStockMovement(
  movementId: number,
  payload: MaterialStockMovementUpdatePayload
): Promise<MaterialStockMovement> {
  const res = await akengFetch(`${API_BASE}/material-stock/movements/${movementId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    let detail = "Nepodařilo se upravit pohyb.";
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

export async function deleteMaterialStockMovement(movementId: number): Promise<{ status: string }> {
  const res = await akengFetch(`${API_BASE}/material-stock/movements/${movementId}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Nepodařilo se smazat pohyb.");
  return res.json();
}
