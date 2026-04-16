export type TableColumnDef = { key: string; label: string; defaultWidth?: number };

export type TableColumnState = {
  key: string;
  label: string;
  order: number;
  visible: boolean;
  width: number | null;
};

export type SortConfig = { columnKey: string; direction: "asc" | "desc" };

export type TableLayoutPayload = {
  columns?: Array<{ key: string; visible?: boolean; width?: number | null; order?: number }>;
  sort?: SortConfig | null;
  density?: "comfortable" | "compact";
  pinned_column_keys?: string[];
};

export function buildDefaultColumns(defs: readonly TableColumnDef[]): TableColumnState[] {
  return defs.map((d, i) => ({
    key: d.key,
    label: d.label,
    order: i,
    visible: true,
    width: d.defaultWidth ?? null,
  }));
}

export function mergeLayoutWithDefaults(
  saved: TableLayoutPayload | null | undefined,
  defs: readonly TableColumnDef[],
): { columns: TableColumnState[]; sort: SortConfig | null; density: "comfortable" | "compact"; pinned: string[] } {
  const defaultMap = new Map(defs.map((d) => [d.key, d]));
  const base = buildDefaultColumns(defs);
  if (!saved?.columns?.length) {
    return { columns: base, sort: null, density: "comfortable", pinned: [] };
  }
  const savedSorted = [...saved.columns].sort((a, b) => {
    const ao = typeof a.order === "number" ? a.order : 0;
    const bo = typeof b.order === "number" ? b.order : 0;
    return ao - bo;
  });
  const seen = new Set<string>();
  const out: TableColumnState[] = [];
  let ord = 0;
  for (const c of savedSorted) {
    const key = String(c.key || "").trim();
    const def = defaultMap.get(key);
    if (!def) continue;
    seen.add(key);
    const w = typeof c.width === "number" && Number.isFinite(c.width) ? Math.min(900, Math.max(40, c.width)) : null;
    out.push({
      key,
      label: def.label,
      order: ord++,
      visible: c.visible !== false,
      width: w ?? (def.defaultWidth ?? null),
    });
  }
  for (const def of defs) {
    if (!seen.has(def.key)) {
      out.push({
        key: def.key,
        label: def.label,
        order: ord++,
        visible: true,
        width: def.defaultWidth ?? null,
      });
    }
  }
  out.sort((a, b) => a.order - b.order);
  const density = saved.density === "compact" ? "compact" : "comfortable";
  const pinned = Array.isArray(saved.pinned_column_keys)
    ? saved.pinned_column_keys.filter((x): x is string => typeof x === "string" && defaultMap.has(x))
    : [];
  let sort: SortConfig | null = null;
  const s = saved.sort;
  if (s && typeof s === "object" && typeof s.columnKey === "string" && s.columnKey.trim()) {
    const dir = String(s.direction || "asc").toLowerCase() === "desc" ? "desc" : "asc";
    sort = { columnKey: s.columnKey.trim(), direction: dir };
  }
  return { columns: out, sort, density, pinned };
}

export function layoutToPayload(
  columns: TableColumnState[],
  sort: SortConfig | null,
  density: "comfortable" | "compact",
  pinned: string[],
): TableLayoutPayload {
  return {
    columns: columns.map((c, i) => ({
      key: c.key,
      visible: c.visible,
      width: c.width,
      order: i,
    })),
    sort: sort ?? undefined,
    density,
    pinned_column_keys: pinned.length ? pinned : undefined,
  };
}

export function visibleOrderedColumns(columns: TableColumnState[]): TableColumnState[] {
  return [...columns].filter((c) => c.visible).sort((a, b) => a.order - b.order);
}

export function sortRowsWithConfig<T>(
  rows: T[],
  sort: SortConfig | null,
  getValue: (row: T, columnKey: string) => string | number | null | undefined,
): T[] {
  if (!sort?.columnKey) return rows;
  const key = sort.columnKey;
  const dir = sort.direction === "desc" ? -1 : 1;
  const copy = [...rows];
  copy.sort((a, b) => {
    const va = getValue(a, key);
    const vb = getValue(b, key);
    if (typeof va === "number" && typeof vb === "number" && Number.isFinite(va) && Number.isFinite(vb)) {
      return (va - vb) * dir;
    }
    const sa = va == null ? "" : String(va).toLowerCase();
    const sb = vb == null ? "" : String(vb).toLowerCase();
    return sa.localeCompare(sb, "cs") * dir;
  });
  return copy;
}
