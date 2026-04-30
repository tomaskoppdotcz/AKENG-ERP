import { akengFetch } from "./akengFetch";

const API_BASE = (import.meta as any).env?.VITE_API_BASE_URL || "http://127.0.0.1:8000";

async function readErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const t = await res.text();
    if (t) return t.slice(0, 500);
  } catch {
    /* ignore */
  }
  return fallback;
}

export type UserDto = {
  id: number;
  username: string;
  display_name: string | null;
  is_active: boolean;
  role_legacy: string | null;
  chip_code: string | null;
  note: string | null;
  created_at: string | null;
  roles: string[];
};

export type RoleDto = {
  id: number;
  code: string;
  name: string;
  description: string | null;
  is_system: boolean;
  permissions: string[];
};

export type PermissionDto = {
  id: number;
  code: string;
  description: string;
  category: string;
};

export type MeDto = {
  actor: string | null;
  username: string | null;
  display_name: string | null;
  user_id: number | null;
  is_active: boolean;
  role?: string | null;
  is_admin?: boolean;
  roles: string[];
  legacy_role: string | null;
  permissions: string[];
  has_full_access: boolean;
};

export type CreateUserBody = {
  username: string;
  display_name?: string | null;
  is_active?: boolean;
  chip_code?: string | null;
  note?: string | null;
  role_codes?: string[];
  role_legacy?: string | null;
};

export type UpdateUserBody = {
  display_name?: string | null;
  is_active?: boolean;
  chip_code?: string | null;
  note?: string | null;
  role_legacy?: string | null;
};

export async function fetchMe(): Promise<MeDto> {
  const res = await akengFetch(`${API_BASE}/users/me`);
  if (!res.ok) throw new Error(await readErrorMessage(res, "Nepodařilo se načíst uživatele."));
  return res.json();
}

export async function listUsers(): Promise<UserDto[]> {
  const res = await akengFetch(`${API_BASE}/users`);
  if (!res.ok) throw new Error(await readErrorMessage(res, "Nepodařilo se načíst uživatele."));
  return res.json();
}

export async function createUser(body: CreateUserBody): Promise<UserDto> {
  const res = await akengFetch(`${API_BASE}/users`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await readErrorMessage(res, "Nepodařilo se vytvořit uživatele."));
  return res.json();
}

export async function updateUser(userId: number, body: UpdateUserBody): Promise<UserDto> {
  const res = await akengFetch(`${API_BASE}/users/${userId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await readErrorMessage(res, "Nepodařilo se uložit uživatele."));
  return res.json();
}

export async function assignUserRoles(userId: number, roleCodes: string[]): Promise<UserDto> {
  const res = await akengFetch(`${API_BASE}/users/${userId}/roles`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role_codes: roleCodes }),
  });
  if (!res.ok) throw new Error(await readErrorMessage(res, "Nepodařilo se přiřadit role."));
  return res.json();
}

export async function deleteUser(userId: number): Promise<void> {
  const res = await akengFetch(`${API_BASE}/users/${userId}`, { method: "DELETE" });
  if (!res.ok) throw new Error(await readErrorMessage(res, "Nepodařilo se smazat uživatele."));
}

export async function listRoles(): Promise<RoleDto[]> {
  const res = await akengFetch(`${API_BASE}/roles`);
  if (!res.ok) throw new Error(await readErrorMessage(res, "Nepodařilo se načíst role."));
  return res.json();
}

export async function listPermissions(): Promise<PermissionDto[]> {
  const res = await akengFetch(`${API_BASE}/permissions`);
  if (!res.ok) throw new Error(await readErrorMessage(res, "Nepodařilo se načíst oprávnění."));
  return res.json();
}
