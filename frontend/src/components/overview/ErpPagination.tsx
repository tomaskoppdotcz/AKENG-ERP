import React from "react";
import { UI } from "../../styles/ui";

/**
 * Globální standard stránkování pro overview / přehledové tabulky v AKENG ERP.
 *
 * Použití:
 * - 4 volby velikosti stránky: 25 / 50 / 100 / 200
 * - zobrazení rozsahu „1–25 z 1842"
 * - tlačítka Předchozí / Další + ukazatel strana/celkem
 *
 * Komponenta je bez vlastního stavu — stránku a velikost řídí rodič,
 * aby se pagination dala snadno napojit na klientské i serverové řešení.
 */

/** Globální volba počtu řádků pro všechny overview stránky. */
export const ERP_PAGE_SIZE_OPTIONS: readonly number[] = [25, 50, 100, 200];

/** Výchozí velikost stránky pokud rodič neřeší persist. */
export const ERP_DEFAULT_PAGE_SIZE = 50;

export type ErpPaginationProps = {
  /** Velikost stránky (jedna z ERP_PAGE_SIZE_OPTIONS, ale komponenta toleruje i jiné). */
  pageSize: number;
  onPageSizeChange: (size: number) => void;
  /** Aktuální offset (server-side pagination) nebo index prvního zobrazeného řádku (client-side). */
  offset: number;
  onOffsetChange: (offset: number) => void;
  /**
   * Celkový počet záznamů po aplikaci filtrů a hledání.
   * Pro client-side pagination předávej délku filtrovaného/setříděného pole.
   * Pro server-side pagination předávej `total` z backendu.
   */
  total: number;
  /**
   * Počet řádků skutečně zobrazených na aktuální stránce (pro zobrazení „1–N z T").
   * Pokud není uveden, použije se `Math.min(pageSize, total - offset)`.
   */
  currentCount?: number;
  /** Zablokovat ovládání (např. při načítání). */
  disabled?: boolean;
  /** Volitelný override povolených velikostí stránky. */
  pageSizeOptions?: readonly number[];
};

/**
 * Patička s pagination — vizuálně sladěná s ERP standardem (UI.buttons.secondary,
 * UI.inputs.base, UI.colors).
 */
export default function ErpPagination({
  pageSize,
  onPageSizeChange,
  offset,
  onOffsetChange,
  total,
  currentCount,
  disabled,
  pageSizeOptions = ERP_PAGE_SIZE_OPTIONS,
}: ErpPaginationProps) {
  const safePageSize = Math.max(1, Math.floor(pageSize || 0) || ERP_DEFAULT_PAGE_SIZE);
  const safeTotal = Math.max(0, Math.floor(total || 0));
  const safeOffset = Math.max(0, Math.floor(offset || 0));

  const page = Math.floor(safeOffset / safePageSize) + 1;
  const totalPages = Math.max(1, Math.ceil(safeTotal / safePageSize));

  const shownCount =
    typeof currentCount === "number"
      ? Math.max(0, Math.floor(currentCount))
      : Math.max(0, Math.min(safePageSize, safeTotal - safeOffset));

  const rangeFrom = safeTotal === 0 ? 0 : safeOffset + 1;
  const rangeTo = Math.min(safeTotal, safeOffset + shownCount);

  const canPrev = !disabled && safeOffset > 0;
  const canNext = !disabled && safeOffset + safePageSize < safeTotal;

  const goPrev = () => {
    if (!canPrev) return;
    onOffsetChange(Math.max(0, safeOffset - safePageSize));
  };
  const goNext = () => {
    if (!canNext) return;
    onOffsetChange(safeOffset + safePageSize);
  };

  return (
    <div
      style={{
        marginTop: 14,
        paddingTop: 12,
        borderTop: `1px solid ${UI.colors.divider}`,
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 10,
        justifyContent: "space-between",
        fontSize: 13,
        color: UI.colors.textSecondary,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span>Na stránku</span>
          <select
            value={pageSizeOptions.includes(safePageSize) ? safePageSize : pageSizeOptions[0]}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
            style={{ ...UI.inputs.base, width: "auto", padding: "6px 10px" }}
            disabled={disabled}
          >
            {pageSizeOptions.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <span style={{ fontVariantNumeric: "tabular-nums" }}>
          {rangeFrom.toLocaleString("cs-CZ")}–{rangeTo.toLocaleString("cs-CZ")} z{" "}
          {safeTotal.toLocaleString("cs-CZ")}
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button
          type="button"
          style={{ ...UI.buttons.secondary, opacity: canPrev ? 1 : 0.5 }}
          onClick={goPrev}
          disabled={!canPrev}
        >
          ← Předchozí
        </button>
        <span style={{ fontVariantNumeric: "tabular-nums" }}>
          Str. {page.toLocaleString("cs-CZ")} / {totalPages.toLocaleString("cs-CZ")}
        </span>
        <button
          type="button"
          style={{ ...UI.buttons.secondary, opacity: canNext ? 1 : 0.5 }}
          onClick={goNext}
          disabled={!canNext}
        >
          Další →
        </button>
      </div>
    </div>
  );
}
