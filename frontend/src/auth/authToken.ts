/**
 * AKENG ERP — správa bearer tokenu v localStorage.
 *
 * Token je opaque string vydaný backendem při `/auth/login` a reprezentuje
 * aktivní session uživatele. Frontend ho ukládá lokálně a posílá v hlavičce
 * `Authorization: Bearer <token>` pro každý request (viz `akengFetch`).
 */

export const ERP_AUTH_TOKEN_KEY = "akeng_auth_token";

export function getAuthToken(): string | null {
  try {
    const v = localStorage.getItem(ERP_AUTH_TOKEN_KEY)?.trim();
    return v ? v : null;
  } catch {
    return null;
  }
}

export function setAuthToken(token: string | null): void {
  try {
    if (!token || !token.trim()) {
      localStorage.removeItem(ERP_AUTH_TOKEN_KEY);
      return;
    }
    localStorage.setItem(ERP_AUTH_TOKEN_KEY, token.trim().slice(0, 512));
  } catch {
    /* ignore */
  }
}

export function clearAuthToken(): void {
  setAuthToken(null);
}
