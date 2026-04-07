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
