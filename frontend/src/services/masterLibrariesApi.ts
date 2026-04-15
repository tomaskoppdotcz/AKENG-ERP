import { akengFetch } from "./akengFetch";

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
  /** Zobrazení řádku v Planner Gantt */
  is_plannable?: boolean;
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
  is_plannable: boolean;
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
  const res = await akengFetch(`${API_BASE}/libraries/operations`);
  if (!res.ok) {
    throw new Error("Nepodařilo se načíst knihovnu operací.");
  }
  return res.json();
}

export async function createOperationLibraryItem(
  payload: OperationLibraryPayload
): Promise<OperationLibraryItem> {
  const res = await akengFetch(`${API_BASE}/libraries/operations`, {
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
  const res = await akengFetch(`${API_BASE}/libraries/operations/${id}`, {
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
  const res = await akengFetch(`${API_BASE}/libraries/operations/${id}`, { method: "DELETE" });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "Nepodařilo se smazat operaci."));
  }
  return res.json();
}

export async function getWorkplaceLibraryItems(): Promise<WorkplaceLibraryItem[]> {
  const res = await akengFetch(`${API_BASE}/libraries/workplaces`);
  if (!res.ok) {
    throw new Error("Nepodařilo se načíst knihovnu pracovišť.");
  }
  return res.json();
}

export async function createWorkplaceLibraryItem(
  payload: WorkplaceLibraryPayload
): Promise<WorkplaceLibraryItem> {
  const res = await akengFetch(`${API_BASE}/libraries/workplaces`, {
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
  const res = await akengFetch(`${API_BASE}/libraries/workplaces/${id}`, {
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
  const res = await akengFetch(`${API_BASE}/libraries/workplaces/${id}`, { method: "DELETE" });
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
  const res = await akengFetch(`${API_BASE}/customers`);
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "Nepodařilo se načíst zákazníky."));
  }
  return res.json();
}

export async function createCustomer(payload: CustomerCreatePayload): Promise<CustomerListItem> {
  const res = await akengFetch(`${API_BASE}/customers`, {
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
  const res = await akengFetch(`${API_BASE}/customers/${id}`, {
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
  const res = await akengFetch(`${API_BASE}/customers/${id}`, { method: "DELETE" });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "Nepodařilo se smazat zákazníka."));
  }
  return res.json();
}

// --- Zaměstnanci (master-data) — kiosk login ---------------------------------

export type EmployeeSubgroupRow = {
  id: number;
  name: string;
  sort_order: number;
  is_active: boolean;
};

export type EmployeeSubgroupPayload = {
  name: string;
  sort_order: number;
  is_active: boolean;
};

export async function getEmployeeSubgroups(): Promise<EmployeeSubgroupRow[]> {
  const res = await akengFetch(`${API_BASE}/master-data/employee-subgroups`);
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "Nepodařilo se načíst role zaměstnanců."));
  }
  return res.json();
}

export async function createEmployeeSubgroup(payload: EmployeeSubgroupPayload): Promise<EmployeeSubgroupRow> {
  const res = await akengFetch(`${API_BASE}/master-data/employee-subgroups`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "Nepodařilo se vytvořit roli."));
  }
  return res.json();
}

export async function updateEmployeeSubgroup(
  id: number,
  payload: EmployeeSubgroupPayload
): Promise<EmployeeSubgroupRow> {
  const res = await akengFetch(`${API_BASE}/master-data/employee-subgroups/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "Nepodařilo se upravit roli."));
  }
  return res.json();
}

export type EmployeeMasterRow = {
  id: number;
  employee_code: string;
  first_name: string | null;
  last_name: string | null;
  full_name: string;
  name: string;
  phone: string | null;
  email: string | null;
  street: string | null;
  city: string | null;
  postal_code: string | null;
  country: string | null;
  birth_date: string | null;
  job_title: string | null;
  is_active: boolean;
  can_use_kiosk: boolean;
  cost_rate_per_hour: number | null;
  note: string | null;
  chip_card_uid: string | null;
  card_uid: string | null;
  scan_code: string | null;
  pin_is_set: boolean;
  has_chip_login: boolean;
  has_pin_login: boolean;
  has_scan_login: boolean;
  employee_subgroup_id: number | null;
  subgroup_name: string | null;
};

export type EmployeeMasterPayload = {
  first_name: string;
  last_name: string;
  employee_code: string;
  chip_card_uid?: string | null;
  card_uid?: string | null;
  scan_code?: string | null;
  pin_code?: string | null;
  clear_pin?: boolean;
  phone?: string | null;
  email?: string | null;
  street?: string | null;
  city?: string | null;
  postal_code?: string | null;
  country?: string | null;
  birth_date?: string | null;
  job_title?: string | null;
  employee_subgroup_id: number | null;
  is_active: boolean;
  can_use_kiosk: boolean;
  cost_rate_per_hour: number | null;
  note?: string | null;
};

export type EmployeeListActiveFilter = "all" | "active" | "inactive";

export async function getEmployeesMaster(
  active: EmployeeListActiveFilter = "all"
): Promise<EmployeeMasterRow[]> {
  const u = new URL(`${API_BASE}/master-data/employees`);
  if (active !== "all") u.searchParams.set("active", active);
  const res = await akengFetch(u.toString());
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "Nepodařilo se načíst zaměstnance."));
  }
  return res.json();
}

export async function getEmployeeMaster(id: number): Promise<EmployeeMasterRow> {
  const res = await akengFetch(`${API_BASE}/master-data/employees/${id}`);
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "Nepodařilo se načíst zaměstnance."));
  }
  return res.json();
}

export async function createEmployeeMaster(payload: EmployeeMasterPayload): Promise<EmployeeMasterRow> {
  const res = await akengFetch(`${API_BASE}/master-data/employees`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "Nepodařilo se vytvořit zaměstnance."));
  }
  return res.json();
}

export async function updateEmployeeMaster(
  id: number,
  payload: EmployeeMasterPayload
): Promise<EmployeeMasterRow> {
  const res = await akengFetch(`${API_BASE}/master-data/employees/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "Nepodařilo se upravit zaměstnance."));
  }
  return res.json();
}

export async function patchEmployeeMasterActive(
  id: number,
  is_active: boolean
): Promise<EmployeeMasterRow> {
  const res = await akengFetch(`${API_BASE}/master-data/employees/${id}/active`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ is_active }),
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "Nepodařilo se změnit stav zaměstnance."));
  }
  return res.json();
}

export async function deleteEmployeeMaster(id: number): Promise<{ status: string; detail?: string }> {
  const res = await akengFetch(`${API_BASE}/master-data/employees/${id}`, { method: "DELETE" });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "Nepodařilo se smazat zaměstnance."));
  }
  return res.json();
}
