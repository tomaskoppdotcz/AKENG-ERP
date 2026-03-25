const API_BASE =
  (import.meta as any).env?.VITE_API_BASE_URL || "http://127.0.0.1:8000";

/** List/create use trailing slash to match FastAPI router (avoids 307). */
const MATERIALS_BASE = `${API_BASE}/materials/`;

export type MaterialLibraryItem = {
  id: number;
  scan_code?: string | null;
  code: string;
  name: string;
  /** Legacy pole z API; stránka knihovny ho nepoužívá. */
  material_type?: string;
  form: string;
  dimension: string;
  unit: string;
  density: number | null;
  price_per_kg: number | null;
  price_per_unit: number | null;
  material_group_id: number | null;
  material_group_name: string | null;
  is_active: boolean;
  /** Pouze výpočet u „Tyč kruhová“ + rozměr + hustota (GET/POST/PUT). */
  kg_per_mm: number | null;
  /** Pouze výpočet u „Tyč kruhová“ + cena/kg (GET/POST/PUT). */
  price_per_mm: number | null;
};

export type MaterialGroup = {
  id: number;
  code: string | null;
  name: string;
  is_active: boolean;
};

export type MaterialLibraryPayload = {
  code: string;
  name: string;
  material_type?: string;
  form?: string;
  dimension?: string;
  unit?: string;
  density?: number | null;
  price_per_kg?: number | null;
  price_per_unit?: number | null;
  material_group_id?: number | null;
  is_active?: boolean;
};

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

export async function getMaterialLibraryItems(): Promise<MaterialLibraryItem[]> {
  const res = await fetch(MATERIALS_BASE);
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "Nepodařilo se načíst materiály."));
  }
  return res.json();
}

export async function getMaterialGroups(): Promise<MaterialGroup[]> {
  const res = await fetch(`${MATERIALS_BASE}groups`);
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "Nepodařilo se načíst skupiny materiálů."));
  }
  return res.json();
}

export type MaterialGroupCreatePayload = {
  name: string;
  code: string | null;
  is_active: boolean;
};

export type MaterialGroupUpdatePayload = Partial<MaterialGroupCreatePayload>;

export async function createMaterialGroup(payload: MaterialGroupCreatePayload): Promise<MaterialGroup> {
  const res = await fetch(`${MATERIALS_BASE}groups`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "Nepodařilo se vytvořit skupinu materiálů."));
  }
  return res.json();
}

export async function updateMaterialGroup(id: number, payload: MaterialGroupUpdatePayload): Promise<MaterialGroup> {
  const res = await fetch(`${MATERIALS_BASE}groups/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "Nepodařilo se upravit skupinu materiálů."));
  }
  return res.json();
}

export async function deleteMaterialGroup(id: number): Promise<{ status: string }> {
  const res = await fetch(`${MATERIALS_BASE}groups/${id}`, { method: "DELETE" });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "Nepodařilo se smazat skupinu materiálů."));
  }
  return res.json();
}

export async function createMaterialLibraryItem(
  payload: MaterialLibraryPayload
): Promise<MaterialLibraryItem> {
  const res = await fetch(MATERIALS_BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "Nepodařilo se vytvořit materiál."));
  }
  return res.json();
}

export async function updateMaterialLibraryItem(
  id: number,
  payload: MaterialLibraryPayload
): Promise<MaterialLibraryItem> {
  const res = await fetch(`${API_BASE}/materials/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "Nepodařilo se upravit materiál."));
  }
  return res.json();
}

export async function deleteMaterialLibraryItem(id: number): Promise<{ status: string }> {
  const res = await fetch(`${API_BASE}/materials/${id}`, { method: "DELETE" });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "Nepodařilo se smazat materiál."));
  }
  return res.json();
}
