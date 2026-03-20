const API_BASE =
  (import.meta as any).env?.VITE_API_BASE_URL || "http://127.0.0.1:8000";

export type OperationLibraryItem = {
  id: number;
  code: string | null;
  name: string;
  description: string | null;
  is_active: boolean;
};

export type WorkplaceLibraryItem = {
  id: number;
  code: string | null;
  name: string;
  workplace_type: string | null;
  hourly_rate: number | null;
  is_active: boolean;
};

export async function getOperationLibraryItems(): Promise<OperationLibraryItem[]> {
  const res = await fetch(`${API_BASE}/libraries/operations`);
  if (!res.ok) {
    throw new Error("Nepodařilo se načíst knihovnu operací.");
  }
  return res.json();
}

export async function getWorkplaceLibraryItems(): Promise<WorkplaceLibraryItem[]> {
  const res = await fetch(`${API_BASE}/libraries/workplaces`);
  if (!res.ok) {
    throw new Error("Nepodařilo se načíst knihovnu pracovišť.");
  }
  return res.json();
}
