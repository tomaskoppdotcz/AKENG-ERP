import React from "react";
import { UI } from "../../styles/ui";

/** Řádek filtrů jako na stránce Zakázky (Typ přehledu → Stav zakázky). */
export const overviewPrimaryFilterLabelStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 800,
  color: UI.colors.tableHeadText,
};

export const overviewPrimaryFilterRowStyle: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: 10,
  marginBottom: 12,
};

export type OverviewFilterChipOption = { id: string; label: string };

type Props = {
  /** Např. tlačítko „Sloupce“ — vždy před „Typ přehledu:“ (jednotná pozice napříč přehledy). */
  leading?: React.ReactNode;
  loading?: boolean;
  typPrehleduOptions: OverviewFilterChipOption[];
  typPrehleduActiveId: string;
  onTypPrehledu: (id: string) => void;
  stavZakazkyOptions: OverviewFilterChipOption[];
  stavZakazkyActiveId: string;
  onStavZakazky: (id: string) => void;
  /** Chips / prvky za „Stav zakázky“ ve stejném flex řádku (rychlé filtry). */
  trailing?: React.ReactNode;
  /** Sloučení přes výchozí řádek (např. margin při vložení do hlavičky karty). */
  rowStyle?: React.CSSProperties;
};

export default function OverviewPrimaryFilterRow({
  leading,
  loading,
  typPrehleduOptions,
  typPrehleduActiveId,
  onTypPrehledu,
  stavZakazkyOptions,
  stavZakazkyActiveId,
  onStavZakazky,
  trailing,
  rowStyle,
}: Props) {
  return (
    <div style={{ ...overviewPrimaryFilterRowStyle, ...rowStyle }}>
      {leading}
      <span style={overviewPrimaryFilterLabelStyle}>Typ přehledu:</span>
      {typPrehleduOptions.map(({ id, label }) => {
        const active = typPrehleduActiveId === id;
        return (
          <button
            key={id}
            type="button"
            onClick={() => onTypPrehledu(id)}
            disabled={loading}
            style={{
              ...UI.ordersFilterChip,
              ...(active ? UI.ordersFilterChipActive : {}),
              ...(loading ? { opacity: 0.6, cursor: "wait" } : {}),
            }}
          >
            {label}
          </button>
        );
      })}
      <span style={{ ...overviewPrimaryFilterLabelStyle, marginLeft: 8 }}>Stav zakázky:</span>
      {stavZakazkyOptions.map(({ id, label }) => {
        const active = stavZakazkyActiveId === id;
        return (
          <button
            key={id}
            type="button"
            onClick={() => onStavZakazky(id)}
            disabled={loading}
            style={{
              ...UI.ordersFilterChip,
              ...(active ? UI.ordersFilterChipActive : {}),
              ...(loading ? { opacity: 0.6, cursor: "wait" } : {}),
            }}
          >
            {label}
          </button>
        );
      })}
      {trailing}
    </div>
  );
}
