import { ERP_ROLE_STORAGE_KEY } from "../auth/rbac";
import { getUiActorIdentifier } from "../auth/uiActor";

/** Merges `X-AKENG-Role` when a role is stored (see Login + `rbac.ts`). */
export function withRoleHeaders(init?: RequestInit): RequestInit {
  const headers = new Headers(init?.headers ?? undefined);
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
