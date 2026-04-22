import type { ErpNavGroup } from "../navigation/erpNavConfig";

/** Stored under `ERP_ROLE_STORAGE_KEY`; empty / missing = unrestricted (legacy behaviour). */
export type ErpRole =
  | "CEO"
  | "Obchod"
  | "Plánování"
  | "Výroba"
  | "Sklad"
  | "Kvalita"
  | "Technologie"
  | "Administrativa";

export const ERP_ROLE_STORAGE_KEY = "akeng_role";

export const ERP_ROLE_OPTIONS: { value: ErpRole; label: string }[] = [
  { value: "CEO", label: "CEO" },
  { value: "Obchod", label: "Obchod" },
  { value: "Plánování", label: "Plánování" },
  { value: "Výroba", label: "Výroba" },
  { value: "Sklad", label: "Sklad" },
  { value: "Kvalita", label: "Kvalita" },
  { value: "Technologie", label: "Technologie" },
  { value: "Administrativa", label: "Administrativa" },
];

const FULL_ACCESS = new Set<ErpRole>(["CEO", "Administrativa"]);

const NAV_BY_ROLE: Record<ErpRole, Set<string>> = {
  CEO: new Set(),
  Obchod: new Set(["dashboard", "orders", "purchase", "master_data"]),
  Plánování: new Set(["dashboard", "orders", "planning", "production", "warehouse", "master_data"]),
  Výroba: new Set(["dashboard", "orders", "production", "master_data"]),
  Sklad: new Set(["dashboard", "orders", "warehouse", "master_data"]),
  Kvalita: new Set(["dashboard", "orders", "production", "warehouse", "quality", "master_data"]),
  Technologie: new Set(["dashboard", "orders", "production", "technology", "master_data"]),
  Administrativa: new Set(),
};

/** Roles allowed per action (CEO / Administrativa / missing role bypass in UI). */
const ACTION_ROLES: Record<string, Set<ErpRole>> = {
  "orders.write": new Set(["Obchod"]),
  "orders.storno": new Set(),
  "planning.write": new Set(["Plánování"]),
  "production.execute": new Set(["Plánování", "Výroba"]),
  "production.storno": new Set(["Plánování"]),
  "stock.mutate": new Set(["Sklad"]),
  "technology.write": new Set(["Technologie"]),
  "quality.write": new Set(["Kvalita"]),
  "purchase.write": new Set(["Obchod"]),
};

export function readStoredErpRole(): ErpRole | null {
  try {
    const raw = localStorage.getItem(ERP_ROLE_STORAGE_KEY)?.trim();
    if (!raw) return null;
    const hit = ERP_ROLE_OPTIONS.find((o) => o.value === raw);
    return hit ? hit.value : null;
  } catch {
    return null;
  }
}

export function writeStoredErpRole(role: ErpRole | null): void {
  try {
    if (!role) localStorage.removeItem(ERP_ROLE_STORAGE_KEY);
    else localStorage.setItem(ERP_ROLE_STORAGE_KEY, role);
  } catch {
    /* ignore */
  }
}

export function filterNavGroupsByRole(role: ErpRole | null, groups: ErpNavGroup[]): ErpNavGroup[] {
  if (role == null || FULL_ACCESS.has(role)) return groups;
  const allowed = NAV_BY_ROLE[role];
  if (!allowed || allowed.size === 0) return groups;
  return groups.filter((g) => allowed.has(g.id));
}

export function canPerformAction(role: ErpRole | null, action: string): boolean {
  if (role == null || FULL_ACCESS.has(role)) return true;
  const set = ACTION_ROLES[action];
  if (!set) return true;
  return set.has(role);
}

// ---------------------------------------------------------------------------
// Permission-based gating (nová cesta — navázáno na DB knihovnu uživatelů).
//
// Frontend si drží cache aktuálního uživatele (`MeDto`) získaného z `/users/me`.
// `hasPermission(code)` čte z této cache. Pokud cache není naplněná, chováme se
// defenzivně: vrátíme true (pilot režim) stejně jako legacy `canPerformAction`,
// aby se UI nezablokovalo před dokončením prvního fetch /users/me.
// ---------------------------------------------------------------------------

export type CurrentUserSnapshot = {
  permissions: Set<string>;
  roles: Set<string>;
  hasFullAccess: boolean;
  username: string | null;
  displayName: string | null;
  loaded: boolean;
};

let CURRENT_USER: CurrentUserSnapshot = {
  permissions: new Set(),
  roles: new Set(),
  hasFullAccess: true, // default allow before /users/me loads — legacy pilot chování
  username: null,
  displayName: null,
  loaded: false,
};

type Listener = (snapshot: CurrentUserSnapshot) => void;
const LISTENERS: Set<Listener> = new Set();

export function getCurrentUserSnapshot(): CurrentUserSnapshot {
  return CURRENT_USER;
}

export function setCurrentUserSnapshot(next: Partial<CurrentUserSnapshot>): void {
  CURRENT_USER = {
    ...CURRENT_USER,
    ...next,
    permissions: next.permissions ?? CURRENT_USER.permissions,
    roles: next.roles ?? CURRENT_USER.roles,
    loaded: next.loaded ?? true,
  };
  LISTENERS.forEach((fn) => {
    try {
      fn(CURRENT_USER);
    } catch {
      /* ignore */
    }
  });
}

export function subscribeCurrentUser(listener: Listener): () => void {
  LISTENERS.add(listener);
  return () => {
    LISTENERS.delete(listener);
  };
}

export function hasPermission(code: string): boolean {
  const snap = CURRENT_USER;
  if (!snap.loaded) return true; // pilot fallback dokud se /users/me nenačte
  if (snap.hasFullAccess) return true;
  return snap.permissions.has(code);
}

export function hasAnyPermission(codes: string[]): boolean {
  if (codes.length === 0) return true;
  return codes.some((c) => hasPermission(c));
}

/** Vhodné pro guard komponentu `<PermissionGate permission="manage_users">`. */
export function canSeeUsersLibrary(): boolean {
  return hasPermission("manage_users");
}
