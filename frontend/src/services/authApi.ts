/**
 * AKENG ERP — autentizační API volání.
 *
 * Backend (viz `backend/app/api/auth.py`):
 * - POST /auth/login    { username, password }       → { token, expires_at, user }
 * - POST /auth/logout   (Authorization: Bearer …)
 * - POST /auth/password { old_password, new_password }
 * - POST /users/{id}/password { password }  (admin reset, vyžaduje `edit_users`)
 */

import { akengFetch } from "./akengFetch";
import { clearAuthToken, setAuthToken } from "../auth/authToken";

const API_BASE = (import.meta as any).env?.VITE_API_BASE_URL || "http://127.0.0.1:8000";

async function readErr(res: Response, fallback: string): Promise<string> {
  try {
    const text = await res.text();
    if (!text) return fallback;
    try {
      const j = JSON.parse(text) as { detail?: string };
      if (j?.detail) return String(j.detail).slice(0, 500);
    } catch {
      /* fall through to raw text */
    }
    return text.slice(0, 500);
  } catch {
    return fallback;
  }
}

export type LoginUserDto = {
  actor: string | null;
  username: string | null;
  display_name: string | null;
  user_id: number | null;
  is_active: boolean;
  roles: string[];
  permissions: string[];
  has_full_access: boolean;
};

export type LoginResponseDto = {
  token: string;
  expires_at: string | null;
  user: LoginUserDto;
};

export async function loginWithPassword(username: string, password: string): Promise<LoginResponseDto> {
  const res = await akengFetch(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    throw new Error(await readErr(res, "Přihlášení se nezdařilo."));
  }
  const data = (await res.json()) as LoginResponseDto;
  setAuthToken(data.token);
  return data;
}

export async function logout(): Promise<void> {
  try {
    await akengFetch(`${API_BASE}/auth/logout`, { method: "POST" });
  } catch {
    /* ignore — lokální token smažeme tak či tak */
  } finally {
    clearAuthToken();
  }
}

export async function changeMyPassword(oldPassword: string, newPassword: string): Promise<void> {
  const res = await akengFetch(`${API_BASE}/auth/password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ old_password: oldPassword, new_password: newPassword }),
  });
  if (!res.ok) {
    throw new Error(await readErr(res, "Změna hesla selhala."));
  }
}

export async function adminSetUserPassword(userId: number, newPassword: string): Promise<void> {
  const res = await akengFetch(`${API_BASE}/users/${userId}/password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: newPassword }),
  });
  if (!res.ok) {
    throw new Error(await readErr(res, "Nastavení hesla selhalo."));
  }
}
