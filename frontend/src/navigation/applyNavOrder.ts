import type { ErpNavGroup, ErpNavLeaf } from "./erpNavConfig";

/** Globální mapa: `group.id` → pořadí `moduleKey` (jen známé klíče z configu). */
export type NavSidebarOrderMap = Record<string, string[]>;

/**
 * Aplikuje uložené pořadí na skupiny. Neznámé / nové položky se připojí na konec.
 * Neznámé klíče v `orderMap` se ignorují (nemají odpovídající leaf).
 */
export function applyNavOrder(groups: ErpNavGroup[], orderMap: NavSidebarOrderMap | null | undefined): ErpNavGroup[] {
  if (!orderMap || Object.keys(orderMap).length === 0) {
    return groups;
  }
  return groups.map((g) => {
    const keys = orderMap[g.id];
    if (!keys || keys.length === 0) {
      return g;
    }
    const byKey = new Map<string, ErpNavLeaf>();
    for (const leaf of g.items) {
      byKey.set(leaf.moduleKey, leaf);
    }
    const ordered: ErpNavLeaf[] = [];
    const seen = new Set<string>();
    for (const mk of keys) {
      const leaf = byKey.get(mk);
      if (leaf) {
        ordered.push(leaf);
        seen.add(mk);
      }
    }
    for (const leaf of g.items) {
      if (!seen.has(leaf.moduleKey)) {
        ordered.push(leaf);
      }
    }
    return { ...g, items: ordered };
  });
}
