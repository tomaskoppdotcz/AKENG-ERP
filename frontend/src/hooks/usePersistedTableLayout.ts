import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildDefaultColumns,
  layoutToPayload,
  mergeLayoutWithDefaults,
  type SortConfig,
  type TableColumnDef,
  type TableColumnState,
} from "../overview/tableLayoutMerge";
import { getTableLayout, putTableLayout } from "../services/tableLayoutsApi";

function cloneColumns(cols: TableColumnState[]): TableColumnState[] {
  return cols.map((c) => ({ ...c }));
}

export function usePersistedTableLayout(pageKey: string, defaults: readonly TableColumnDef[]) {
  const defaultsRef = useRef(defaults);
  defaultsRef.current = defaults;

  const [columns, setColumns] = useState<TableColumnState[]>(() => buildDefaultColumns(defaults));
  const [sort, setSort] = useState<SortConfig | null>(null);
  const [density, setDensity] = useState<"comfortable" | "compact">("comfortable");
  const [pinned, setPinned] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const snapshotRef = useRef<TableColumnState[] | null>(null);
  const snapshotSortRef = useRef<SortConfig | null>(null);
  const snapshotDensityRef = useRef<"comfortable" | "compact">("comfortable");

  const visibleColumns = useMemo(() => {
    return [...columns].filter((c) => c.visible).sort((a, b) => a.order - b.order);
  }, [columns]);

  const cellPaddingPx = density === "compact" ? 6 : 10;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    getTableLayout(pageKey)
      .then((res) => {
        if (cancelled) return;
        const merged = mergeLayoutWithDefaults(res.layout ?? null, defaults);
        setColumns(merged.columns);
        setSort(merged.sort);
        setDensity(merged.density);
        setPinned(merged.pinned);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setLoadError(e instanceof Error ? e.message : "Chyba načtení rozložení");
          setColumns(buildDefaultColumns(defaultsRef.current));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [pageKey]);

  const openPanel = useCallback(() => {
    snapshotRef.current = cloneColumns(columns);
    snapshotSortRef.current = sort;
    snapshotDensityRef.current = density;
    setSaveError(null);
    setPanelOpen(true);
  }, [columns, sort, density]);

  const closePanelCancel = useCallback(() => {
    if (snapshotRef.current) {
      setColumns(snapshotRef.current);
      setSort(snapshotSortRef.current);
      setDensity(snapshotDensityRef.current);
    }
    setPanelOpen(false);
    setSaveError(null);
  }, []);

  const savePanel = useCallback(async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const payload = layoutToPayload(columns, sort, density, pinned);
      await putTableLayout(pageKey, payload);
      setPanelOpen(false);
    } catch (e: unknown) {
      setSaveError(e instanceof Error ? e.message : "Uložení se nezdařilo.");
    } finally {
      setSaving(false);
    }
  }, [columns, sort, density, pinned, pageKey]);

  const resetLocalToDefaults = useCallback(() => {
    const merged = mergeLayoutWithDefaults(null, defaultsRef.current);
    setColumns(merged.columns);
    setSort(merged.sort);
    setDensity(merged.density);
    setPinned(merged.pinned);
  }, []);

  const resetAndSave = useCallback(async () => {
    const merged = mergeLayoutWithDefaults(null, defaultsRef.current);
    setSaving(true);
    setSaveError(null);
    try {
      const payload = layoutToPayload(merged.columns, merged.sort, merged.density, merged.pinned);
      await putTableLayout(pageKey, payload);
      setColumns(merged.columns);
      setSort(merged.sort);
      setDensity(merged.density);
      setPinned(merged.pinned);
      setPanelOpen(false);
    } catch (e: unknown) {
      setSaveError(e instanceof Error ? e.message : "Uložení se nezdařilo.");
    } finally {
      setSaving(false);
    }
  }, [pageKey]);

  return {
    loading,
    loadError,
    columns,
    setColumns,
    visibleColumns,
    sort,
    setSort,
    density,
    setDensity,
    pinned,
    setPinned,
    cellPaddingPx,
    panelOpen,
    openPanel,
    closePanelCancel,
    savePanel,
    resetLocalToDefaults,
    resetAndSave,
    saving,
    saveError,
    sortableKeys: defaultsRef.current.map((d) => d.key),
  };
}
