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

export type MaterialStockMovement = {
  id: number;
  movement_type: "prijem" | "vydej" | "korekce";
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
};

export type MaterialStockMovementCreatePayload = {
  movement_type: "prijem" | "vydej" | "korekce";
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
  const res = await fetch(`${API_BASE}/material-stock/items${suffix}`);
  if (!res.ok) throw new Error("Nepodařilo se načíst sklad materiálu.");
  return res.json();
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
  const res = await fetch(
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

export type JobItemMaterialIssueRow = {
  movement_id: number;
  movement_date: string | null;
  qty: number;
  heat_lot: string | null;
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
  const res = await fetch(`${API_BASE}/material-stock/job-items/${encodeURIComponent(String(jobItemId))}/material-issues`);
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
  const res = await fetch(`${API_BASE}/material-stock/items`, {
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
  const res = await fetch(`${API_BASE}/material-stock/items/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error("Nepodařilo se upravit skladovou kartu.");
  return res.json();
}

export async function deleteMaterialStockItem(id: number): Promise<{ status: string }> {
  const res = await fetch(`${API_BASE}/material-stock/items/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Nepodařilo se smazat skladovou kartu.");
  return res.json();
}

export async function getMaterialStockMovements(stockItemId: number): Promise<MaterialStockMovement[]> {
  const res = await fetch(`${API_BASE}/material-stock/items/${stockItemId}/movements`);
  if (!res.ok) throw new Error("Nepodařilo se načíst pohyby materiálu.");
  return res.json();
}

export async function getMaterialStockReservations(stockItemId: number): Promise<MaterialStockReservation[]> {
  const res = await fetch(`${API_BASE}/material-stock/items/${stockItemId}/reservations`);
  if (!res.ok) throw new Error("Nepodařilo se načíst rezervace materiálu.");
  return res.json();
}

export async function createMaterialReservation(
  payload: MaterialStockReservationCreatePayload
): Promise<MaterialStockReservation> {
  const res = await fetch(`${API_BASE}/material-stock/reservations`, {
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
  const res = await fetch(`${API_BASE}/material-stock/reservations/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Nepodařilo se zrušit rezervaci.");
  return res.json();
}

export async function createMaterialStockMovement(
  stockItemId: number,
  payload: MaterialStockMovementCreatePayload
): Promise<MaterialStockMovement> {
  const res = await fetch(`${API_BASE}/material-stock/items/${stockItemId}/movements`, {
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
  const res = await fetch(`${API_BASE}/material-stock/movements/${movementId}/attachments`, {
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
  const res = await fetch(`${API_BASE}/material-stock/movements/${movementId}`, {
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
  const res = await fetch(`${API_BASE}/material-stock/movements/${movementId}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Nepodařilo se smazat pohyb.");
  return res.json();
}
