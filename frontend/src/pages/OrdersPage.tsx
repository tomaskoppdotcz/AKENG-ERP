import React, { useMemo, useState } from "react";
import { UI } from "../styles/ui";
import OrderCardPage from "./OrderCardPage";

type DemoOrderItem = {
  job_item_id: number;
  line_no: number;
  gpn: string;
  description: string;
  material: string;
  qty: string;
  pricePerPiece: string;
  due_date: string;
  vp_code?: string | null;
  stav: string;
};

type Props = {
  onOpenOrderCard?: (customerOrderId: number) => void;
  onOpenItemDetail?: (customerOrderId: number, item: DemoOrderItem) => void;
  initialCustomerOrderId?: number | null;
};

type OrderRow = {
  zakazka: string;
  zakaznik: string;
  objednavka: string;
  datum: string;
  vykresy: string;
  prodejniCena: string;
  celkovyNaklad: string;
  vykazanyCas: string;
  vyrobaVykonnost: string;
  hotovo: string;
};

const TABLE_COLUMNS = [
  "Zakázka",
  "Zákazník",
  "Objednávka",
  "Datum",
  "Výkresy",
  "Prodejní cena",
  "Celkový náklad",
  "Vykázaný čas",
  "Výroba výkonnost",
  "Hotovo",
] as const;

const DEMO_ORDERS: OrderRow[] = [
  {
    zakazka: "ZAK260061",
    zakaznik: "KovoTech CZ s.r.o.",
    objednavka: "OBJ-2026-061",
    datum: "2026-03-10",
    vykresy: "18",
    prodejniCena: "3 450 000 Kč",
    celkovyNaklad: "2 620 000 Kč",
    vykazanyCas: "164 h",
    vyrobaVykonnost: "92 %",
    hotovo: "45 %",
  },
  {
    zakazka: "ZAK260060",
    zakaznik: "Strojírny BETA a.s.",
    objednavka: "OBJ-2026-060",
    datum: "2026-03-09",
    vykresy: "12",
    prodejniCena: "2 890 000 Kč",
    celkovyNaklad: "2 180 000 Kč",
    vykazanyCas: "132 h",
    vyrobaVykonnost: "88 %",
    hotovo: "58 %",
  },
  {
    zakazka: "ZAK260059",
    zakaznik: "Výroba ALFA s.r.o.",
    objednavka: "OBJ-2026-059",
    datum: "2026-03-07",
    vykresy: "9",
    prodejniCena: "2 120 000 Kč",
    celkovyNaklad: "1 690 000 Kč",
    vykazanyCas: "98 h",
    vyrobaVykonnost: "84 %",
    hotovo: "33 %",
  },
  {
    zakazka: "ZAK260058",
    zakaznik: "Průmyslové díly GAMMA, a.s.",
    objednavka: "OBJ-2026-058",
    datum: "2026-03-06",
    vykresy: "21",
    prodejniCena: "4 120 000 Kč",
    celkovyNaklad: "3 080 000 Kč",
    vykazanyCas: "176 h",
    vyrobaVykonnost: "90 %",
    hotovo: "52 %",
  },
  {
    zakazka: "ZAK260057",
    zakaznik: "TECHNIKA Delta s.r.o.",
    objednavka: "OBJ-2026-057",
    datum: "2026-03-04",
    vykresy: "15",
    prodejniCena: "3 010 000 Kč",
    celkovyNaklad: "2 230 000 Kč",
    vykazanyCas: "141 h",
    vyrobaVykonnost: "86 %",
    hotovo: "39 %",
  },
];

function formatSearchValue(v: string) {
  return v.trim().toLowerCase();
}

export default function OrdersPage(_props: Props) {
  const [query, setQuery] = useState("");
  const [selectedCustomerOrderId, setSelectedCustomerOrderId] = useState<number | null>(_props.initialCustomerOrderId ?? null);
  const [hoveredZakazka, setHoveredZakazka] = useState<string | null>(null);

  function parseCustomerOrderId(zakazka: string): number {
    const raw = zakazka.replace(/^ZAK/i, "");
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  }

  const filtered = useMemo(() => {
    const q = formatSearchValue(query);
    if (!q) return DEMO_ORDERS;

    return DEMO_ORDERS.filter((row) => {
      const haystack = [row.zakazka, row.zakaznik, row.objednavka].join(" ").toLowerCase();
      return haystack.includes(q);
    });
  }, [query]);

  if (selectedCustomerOrderId !== null) {
    return (
      <OrderCardPage
        customerOrderId={selectedCustomerOrderId}
        onBack={() => setSelectedCustomerOrderId(null)}
        onOpenItemDetail={(item) => {
          _props.onOpenItemDetail?.(selectedCustomerOrderId, item);
        }}
      />
    );
  }

  return (
    <div style={{ paddingTop: 10 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={UI.sectionTitle}>Zakázky</div>
          <div style={UI.sectionSubtitle}>Přehled zakázek</div>
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <button type="button" style={UI.buttons.primary} onClick={() => {}}>
            Nová zakázka
          </button>
          <button type="button" style={UI.buttons.secondary} onClick={() => {}}>
            Import objednávky
          </button>
        </div>
      </div>

      <div style={{ marginTop: 16, ...UI.card, padding: 16, borderRadius: 14 }}>
        <div>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Hledat zakázku, zákazníka nebo objednávku..."
            style={UI.inputs.base}
          />
        </div>

        <div style={{ marginTop: 14, overflowX: "auto" }}>
          <table style={UI.table}>
            <thead>
              <tr style={{ background: "#f8fafc" }}>
                {TABLE_COLUMNS.map((col) => (
                  <th key={col} style={{ ...UI.th, fontSize: 13, padding: "10px 10px", whiteSpace: "nowrap" }}>
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => {
                const isHovered = hoveredZakazka === row.zakazka;
                return (
                  <tr
                    key={row.zakazka}
                    onClick={() => setSelectedCustomerOrderId(parseCustomerOrderId(row.zakazka))}
                    onMouseEnter={() => setHoveredZakazka(row.zakazka)}
                    onMouseLeave={() => setHoveredZakazka(null)}
                    style={{
                      cursor: "pointer",
                      background: isHovered ? "#eff6ff" : "#fff",
                    }}
                  >
                    <td style={{ ...UI.td, fontWeight: 1000, color: "#0f172a", padding: "10px 10px", whiteSpace: "nowrap" }}>
                      {row.zakazka}
                    </td>
                    <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>{row.zakaznik}</td>
                    <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>{row.objednavka}</td>
                    <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>{row.datum}</td>
                    <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>{row.vykresy}</td>
                    <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap", fontWeight: 900, color: "#0f172a" }}>
                      {row.prodejniCena}
                    </td>
                    <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap", fontWeight: 900, color: "#0f172a" }}>
                      {row.celkovyNaklad}
                    </td>
                    <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>{row.vykazanyCas}</td>
                    <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>{row.vyrobaVykonnost}</td>
                    <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap", fontWeight: 1000, color: "#2563eb" }}>
                      {row.hotovo}
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 ? (
                <tr>
                  <td
                    colSpan={TABLE_COLUMNS.length}
                    style={{ ...UI.td, textAlign: "center", color: "#64748b", padding: "14px 10px" }}
                  >
                    Žádné výsledky.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

