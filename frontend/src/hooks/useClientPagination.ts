import { useEffect, useMemo, useState } from "react";
import { ERP_DEFAULT_PAGE_SIZE } from "../components/overview/ErpPagination";

/**
 * Klientská pagination nad již setříděným/filtrovaným polem řádků.
 *
 * Backend endpointy v ERP již podporují server-side `limit`/`offset` + `total`,
 * ale drtivá většina overview stránek zatím drží plný dataset v paměti,
 * aby fungovalo univerzální hledání / filtry / setřídění napříč všemi řádky.
 * Tento hook vrací slice aktuální stránky pro tabulku + stav pro <ErpPagination />.
 *
 * - `rows` musí být již po aplikaci filtrů + search + sort (tj. finální pořadí k zobrazení).
 * - `resetKey` (volitelně) přepne, když se změní filtr/search/sort, aby pagination
 *   spadla zpět na první stránku.
 */
export function useClientPagination<T>(
  rows: readonly T[],
  opts?: {
    initialPageSize?: number;
    resetKey?: string | number | null;
  }
): {
  pagedRows: T[];
  pageSize: number;
  setPageSize: (size: number) => void;
  offset: number;
  setOffset: (offset: number) => void;
  total: number;
} {
  const initialPageSize = opts?.initialPageSize ?? ERP_DEFAULT_PAGE_SIZE;
  const [pageSize, setPageSizeState] = useState<number>(initialPageSize);
  const [offset, setOffsetState] = useState<number>(0);

  const total = rows.length;

  // Reset offsetu při změně dat (filtr/search/sort) nebo velikosti stránky.
  useEffect(() => {
    setOffsetState(0);
  }, [opts?.resetKey]);

  // Bezpečnostní guard: kdyby offset přerostl total (např. po změně filtru),
  // držet ho na platném rozsahu.
  useEffect(() => {
    if (offset > 0 && offset >= total) {
      setOffsetState(0);
    }
  }, [total, offset]);

  const pagedRows = useMemo(
    () => rows.slice(offset, offset + pageSize),
    [rows, offset, pageSize]
  );

  const setPageSize = (size: number) => {
    const n = Math.max(1, Math.floor(size || 0) || initialPageSize);
    setPageSizeState(n);
    setOffsetState(0);
  };

  const setOffset = (next: number) => {
    setOffsetState(Math.max(0, Math.floor(next || 0)));
  };

  return {
    pagedRows,
    pageSize,
    setPageSize,
    offset,
    setOffset,
    total,
  };
}
