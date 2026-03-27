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
  daily_capacity_hours: number | null;
  is_active: boolean;
};

export type OperationLibraryPayload = {
  code: string | null;
  name: string;
  description: string | null;
  is_active: boolean;
};

export type WorkplaceLibraryPayload = {
  code: string | null;
  name: string;
  workplace_type: string | null;
  hourly_rate: number | null;
  daily_capacity_hours: number | null;
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

export async function getOperationLibraryItems(): Promise<OperationLibraryItem[]> {
  const res = await fetch(`${API_BASE}/libraries/operations`);
  if (!res.ok) {
    throw new Error("Nepodařilo se načíst knihovnu operací.");
  }
  return res.json();
}

export async function createOperationLibraryItem(
  payload: OperationLibraryPayload
): Promise<OperationLibraryItem> {
  const res = await fetch(`${API_BASE}/libraries/operations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "Nepodařilo se vytvořit operaci."));
  }
  return res.json();
}

export async function updateOperationLibraryItem(
  id: number,
  payload: OperationLibraryPayload
): Promise<OperationLibraryItem> {
  const res = await fetch(`${API_BASE}/libraries/operations/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "Nepodařilo se upravit operaci."));
  }
  return res.json();
}

export async function deleteOperationLibraryItem(id: number): Promise<{ status: string }> {
  const res = await fetch(`${API_BASE}/libraries/operations/${id}`, { method: "DELETE" });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "Nepodařilo se smazat operaci."));
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

export async function createWorkplaceLibraryItem(
  payload: WorkplaceLibraryPayload
): Promise<WorkplaceLibraryItem> {
  const res = await fetch(`${API_BASE}/libraries/workplaces`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "Nepodařilo se vytvořit pracoviště."));
  }
  return res.json();
}

export async function updateWorkplaceLibraryItem(
  id: number,
  payload: WorkplaceLibraryPayload
): Promise<WorkplaceLibraryItem> {
  const res = await fetch(`${API_BASE}/libraries/workplaces/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "Nepodařilo se upravit pracoviště."));
  }
  return res.json();
}

export async function deleteWorkplaceLibraryItem(id: number): Promise<{ status: string }> {
  const res = await fetch(`${API_BASE}/libraries/workplaces/${id}`, { method: "DELETE" });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "Nepodařilo se smazat pracoviště."));
  }
  return res.json();
}

export type CustomerListItem = {
  id: number;
  name: string;
  code: string;
  is_active: boolean;
  ico: string | null;
  dic: string | null;
  billing_address: string | null;
  delivery_address: string | null;
  contact_person: string | null;
  email: string | null;
  phone: string | null;
  note: string | null;
};

export type CustomerCreatePayload = {
  name: string;
  is_active: boolean;
  ico: string | null;
  dic: string | null;
  billing_address: string | null;
  delivery_address: string | null;
  contact_person: string | null;
  email: string | null;
  phone: string | null;
  note: string | null;
};

export type CustomerUpdatePayload = Partial<CustomerCreatePayload>;

export async function getCustomers(): Promise<CustomerListItem[]> {
  const res = await fetch(`${API_BASE}/customers`);
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "Nepodařilo se načíst zákazníky."));
  }
  return res.json();
}

export async function createCustomer(payload: CustomerCreatePayload): Promise<CustomerListItem> {
  const res = await fetch(`${API_BASE}/customers`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "Nepodařilo se vytvořit zákazníka."));
  }
  return res.json();
}

export async function updateCustomer(id: number, payload: CustomerUpdatePayload): Promise<CustomerListItem> {
  const res = await fetch(`${API_BASE}/customers/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "Nepodařilo se upravit zákazníka."));
  }
  return res.json();
}

export async function deleteCustomer(id: number): Promise<{ status: string }> {
  const res = await fetch(`${API_BASE}/customers/${id}`, { method: "DELETE" });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "Nepodařilo se smazat zákazníka."));
  }
  return res.json();
}
