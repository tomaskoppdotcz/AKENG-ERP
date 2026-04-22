import { getAuthToken } from "../auth/authToken";
import { ERP_ROLE_STORAGE_KEY } from "../auth/rbac";
import { getUiActorIdentifier } from "../auth/uiActor";

/**
 * Merges identity headers for every backend request:
 * - `Authorization: Bearer <token>` — pokud je uložený session token
 *   (po `/auth/login`). Backend z něj přečte skutečnou identitu.
 * - `X-AKENG-Role`  — legacy role header (fallback / test RBAC).
 * - `X-AKENG-Actor` — free-form actor string (audit + pilot identifier).
 *
 * Caller nesmí přepsat Authorization header, který už sám nastavil (nechává
 * případné zákaznické tokeny — momentálně nepoužíváme).
 */
export function withRoleHeaders(init?: RequestInit): RequestInit {
  const headers = new Headers(init?.headers ?? undefined);
  try {
    const token = getAuthToken();
    if (token && !headers.has("Authorization")) {
      headers.set("Authorization", `Bearer ${token}`);
    }
  } catch {
    /* ignore */
  }
  try {
    const role = localStorage.getItem(ERP_ROLE_STORAGE_KEY)?.trim();
    if (role) headers.set("X-AKENG-Role", role);
  } catch {
    /* ignore */
  }
  try {
    headers.set("X-AKENG-Actor", getUiActorIdentifier());
  } catch {
    /* ignore */
  }
  return { ...init, headers };
}

export async function akengFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return fetch(input, withRoleHeaders(init));
}
