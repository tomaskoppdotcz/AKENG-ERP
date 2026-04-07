import { akengFetch } from "./akengFetch";

const API_BASE =
  (import.meta as any).env?.VITE_API_BASE_URL || "http://127.0.0.1:8000";

export type StorageLocationType = "material" | "product" | "both";

export type StorageLocation = {
  id: number;
  code: string;
  name: string;
  location_type: StorageLocationType;
  is_active: boolean;
};

export type StorageLocationPayload = {
  code: string;
  name: string;
  location_type: StorageLocationType;
  is_active: boolean;
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

export async function getStorageLocations(): Promise<StorageLocation[]> {
  const res = await akengFetch(`${API_BASE}/storage-locations`);
  if (!res.ok) throw new Error(await readErrorMessage(res, "Nepodařilo se načíst umístění."));
  return res.json();
}

export async function createStorageLocation(payload: StorageLocationPayload): Promise<StorageLocation> {
  const res = await akengFetch(`${API_BASE}/storage-locations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await readErrorMessage(res, "Nepodařilo se vytvořit umístění."));
  return res.json();
}

export async function updateStorageLocation(
  id: number,
  payload: Partial<StorageLocationPayload>
): Promise<StorageLocation> {
  const res = await akengFetch(`${API_BASE}/storage-locations/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await readErrorMessage(res, "Nepodařilo se upravit umístění."));
  return res.json();
}

export async function deleteStorageLocation(id: number): Promise<{ status: string }> {
  const res = await akengFetch(`${API_BASE}/storage-locations/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(await readErrorMessage(res, "Nepodařilo se smazat umístění."));
  return res.json();
}
