import React, { useMemo, useState } from "react";
import { UI } from "../styles/ui";

type DrawingItem = {
  customerOrderId: number;
  job_item_id: number;
  line_no: number;
  gpn: string;
  popis: string;
  material: string;
  mnozstvi: string;
  termin: string;
  vp: string | null;
  stav: string;
};

type Props = {
  onBackToDashboard?: () => void;
  onOpenItemDetail?: (jobItemId: number, source: "drawings") => void;
};

const SUBTABS = [
  "Přehled",
  "Dokumenty",
  "Historie",
  "Výkazy",
  "Neshody",
  "Zmetky",
  "Reklamace",
  "Technologie",
  "Expedice",
  "Náklady",
] as const;
type DrawingsSubtab = (typeof SUBTABS)[number];

const FILTERS = ["Po termínu", "Dokončená", "Dodací list", "Fakturováno"] as const;
type DrawingFilter = (typeof FILTERS)[number];

const DEMO_ROWS: DrawingItem[] = [
  { customerOrderId: 260061, job_item_id: 2010, line_no: 10, gpn: "102-045-772", popis: "Převlečná objímka (duplex) – zinkování", material: "Ocel 11 353.1 – pozink (Z-12)", mnozstvi: "120 ks", termin: "2026-03-15", vp: "VP260030", stav: "Plán" },
  { customerOrderId: 260061, job_item_id: 2020, line_no: 20, gpn: "107-118-504", popis: "Distanční kroužek (ring) – nitridace", material: "Legovaná ocel – nitridace (N-09)", mnozstvi: "80 ks", termin: "2026-03-16", vp: null, stav: "Ve výrobě" },
  { customerOrderId: 260061, job_item_id: 2030, line_no: 30, gpn: "114-030-919", popis: "Těleso spojky (sleeve) – broušení", material: "Ocel 16 111 – broušení (B-03)", mnozstvi: "55 ks", termin: "2026-03-18", vp: "VP260031", stav: "Hotovo" },
  { customerOrderId: 260060, job_item_id: 2040, line_no: 40, gpn: "119-207-633", popis: "Vratný kroužek (ring) – povrch AlMg", material: "Ocel 15 120 – povrch AlMg (A-17)", mnozstvi: "140 ks", termin: "2026-03-20", vp: null, stav: "Plán" },
  { customerOrderId: 260060, job_item_id: 2050, line_no: 50, gpn: "121-090-281", popis: "Spojovací pouzdro – finální kontrola", material: "Ocel 11 460 – finální kontrola (K-02)", mnozstvi: "36 ks", termin: "2026-03-21", vp: "VP260032", stav: "Hotovo" },
  { customerOrderId: 260059, job_item_id: 3060, line_no: 60, gpn: "132-774-018", popis: "Příruba ložiska – frézování", material: "Ocel 12 050 – frézování (F-11)", mnozstvi: "64 ks", termin: "2026-03-13", vp: null, stav: "Ve výrobě" },
  { customerOrderId: 260058, job_item_id: 3070, line_no: 70, gpn: "136-002-441", popis: "Výztuha rámu – svařování", material: "Ocel S355 – svařenec", mnozstvi: "22 ks", termin: "2026-03-09", vp: "VP260041", stav: "Hotovo" },
  { customerOrderId: 260058, job_item_id: 3080, line_no: 80, gpn: "140-911-320", popis: "Čelo převodovky – vrtání", material: "Ocel 14 220 – obrábění", mnozstvi: "48 ks", termin: "2026-03-12", vp: null, stav: "Plán" },
  { customerOrderId: 260057, job_item_id: 3090, line_no: 90, gpn: "144-330-507", popis: "Podložka fixační – kalení", material: "Ocel 13 240 – tepelné zpracování", mnozstvi: "300 ks", termin: "2026-03-11", vp: "VP260052", stav: "Ve výrobě" },
];

function q(v: string) {
  return v.trim().toLowerCase();
}

export default function DrawingsPage({ onBackToDashboard, onOpenItemDetail }: Props) {
  const [activeSubtab, setActiveSubtab] = useState<DrawingsSubtab>("Přehled");
  const [hoverSubtab, setHoverSubtab] = useState<DrawingsSubtab | null>(null);
  const [query, setQuery] = useState("");
  const [activeFilters, setActiveFilters] = useState<DrawingFilter[]>([]);
  const [hoveredRow, setHoveredRow] = useState<number | null>(null);

  const filteredRows = useMemo(() => {
    const normalized = q(query);
    return DEMO_ROWS.filter((row) => {
      const haystack = [`ZAK${row.customerOrderId}`, row.gpn, row.popis, row.material, row.vp ?? ""].join(" ").toLowerCase();
      const matchesQuery = !normalized || haystack.includes(normalized);
      const done = row.stav === "Hotovo";
      const late = row.termin < "2026-03-12";
      const hasDelivery = row.line_no % 2 === 0;
      const invoiced = done && !!row.vp;

      const matchesFilters = activeFilters.every((f) => {
        if (f === "Po termínu") return late;
        if (f === "Dokončená") return done;
        if (f === "Dodací list") return hasDelivery;
        if (f === "Fakturováno") return invoiced;
        return true;
      });

      return matchesQuery && matchesFilters;
    });
  }, [query, activeFilters]);

  const kpi = useMemo(() => {
    const celkemPolozek = DEMO_ROWS.length;
    const celkemKusu = DEMO_ROWS.reduce((sum, row) => {
      const qty = Number.parseInt(row.mnozstvi.replace(" ks", "").trim(), 10) || 0;
      return sum + qty;
    }, 0);
    const aktivniPolozky = DEMO_ROWS.filter((row) => row.stav !== "Hotovo").length;
    const poTerminu = DEMO_ROWS.filter((row) => row.termin < "2026-03-12").length;
    const kExpedici = DEMO_ROWS.filter((row) => row.stav === "Hotovo").length;

    return [
      { label: "Celkem položek", value: String(celkemPolozek) },
      { label: "Celkem kusů", value: `${celkemKusu} ks` },
      { label: "Aktivní položky", value: String(aktivniPolozky) },
      { label: "Po termínu", value: String(poTerminu) },
      { label: "K expedici", value: String(kExpedici) },
    ] as const;
  }, []);

  return (
    <div style={{ paddingTop: 10 }}>
      <div style={UI.pageHeaderRow}>
        <div>
          <div style={UI.sectionTitle}>Výkresy</div>
          <div style={UI.sectionSubtitle}>Položky ze všech zakázek</div>
        </div>
        <div style={UI.pageHeaderActions}>
          <button type="button" style={UI.buttons.secondary} onClick={() => onBackToDashboard?.()}>
            Zpět na nástěnku
          </button>
          <button type="button" style={UI.buttons.primary} onClick={() => {}}>
            Nový výkres
          </button>
          <button type="button" style={UI.buttons.secondary} onClick={() => {}}>
            Import výkresů
          </button>
        </div>
      </div>

      <div style={UI.summaryTilesGridOuter}>
        <div style={UI.summaryTilesGridSix}>
          {kpi.map((k) => (
            <div key={k.label} style={UI.summaryTile}>
              <div style={UI.summaryTileLabel}>{k.label}</div>
              <div style={UI.summaryTileValue}>{k.value}</div>
            </div>
          ))}
        </div>
      </div>

      <div
        style={{
          width: "100%",
          overflowX: "auto",
          overflowY: "hidden",
          marginBottom: 4,
        }}
      >
        <div
          style={{
            ...UI.subTabsContainer,
            overflow: "visible",
            width: "max-content",
            minWidth: "100%",
            justifyContent: "flex-start",
            marginTop: 0,
            marginBottom: 0,
          }}
        >
          {SUBTABS.map((tab) => {
            const active = tab === activeSubtab;
            return (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveSubtab(tab)}
                onMouseEnter={() => setHoverSubtab(tab)}
                onMouseLeave={() => setHoverSubtab((h) => (h === tab ? null : h))}
                style={{
                  ...UI.subTab,
                  ...(active ? UI.subTabActive : {}),
                  ...(!active && hoverSubtab === tab ? UI.subTabHover : {}),
                }}
              >
                {tab}
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ marginTop: 16, ...UI.card, padding: 16, borderRadius: 14 }}>
        {activeSubtab === "Přehled" ? (
          <>
            <div style={UI.ordersFilterBar}>
              <div style={UI.ordersFilterSearchWrap}>
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Hledat GPN, výkres, zakázku, materiál nebo VP..."
                  style={UI.inputs.base}
                />
              </div>
              <div style={UI.ordersFilterChips}>
                {FILTERS.map((filter) => {
                  const active = activeFilters.includes(filter);
                  return (
                    <button
                      key={filter}
                      type="button"
                      onClick={() =>
                        setActiveFilters((prev) =>
                          prev.includes(filter) ? prev.filter((f) => f !== filter) : [...prev, filter]
                        )
                      }
                      style={{ ...UI.ordersFilterChip, ...(active ? UI.ordersFilterChipActive : {}) }}
                    >
                      {filter}
                    </button>
                  );
                })}
              </div>
            </div>

            <div style={{ overflowX: "auto" }}>
              <table style={UI.table}>
                <thead>
                  <tr style={{ background: "#f8fafc" }}>
                    {["Zakázka", "Řádek", "GPN", "Popis", "Materiál", "Množství", "Termín", "VP", "Stav"].map((h) => (
                      <th key={h} style={{ ...UI.th, fontSize: 13, padding: "10px 10px", whiteSpace: "nowrap" }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((row) => (
                    <tr
                      key={`${row.customerOrderId}-${row.job_item_id}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => onOpenItemDetail?.(row.job_item_id, "drawings")}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onOpenItemDetail?.(row.job_item_id, "drawings");
                        }
                      }}
                      onMouseEnter={() => setHoveredRow(row.job_item_id)}
                      onMouseLeave={() => setHoveredRow((id) => (id === row.job_item_id ? null : id))}
                      style={{
                        cursor: "pointer",
                        background: hoveredRow === row.job_item_id ? "#eff6ff" : "#fff",
                      }}
                    >
                      <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap", fontWeight: 900 }}>{`ZAK${row.customerOrderId}`}</td>
                      <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>{row.line_no}</td>
                      <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap", fontWeight: 800 }}>{row.gpn}</td>
                      <td style={{ ...UI.td, padding: "10px 10px" }}>{row.popis}</td>
                      <td style={{ ...UI.td, padding: "10px 10px" }}>{row.material}</td>
                      <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>{row.mnozstvi}</td>
                      <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>{row.termin}</td>
                      <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap", color: row.vp ? "#15803d" : "#64748b", fontWeight: 700 }}>
                        {row.vp ?? "—"}
                      </td>
                      <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap", fontWeight: 900 }}>{row.stav}</td>
                    </tr>
                  ))}
                  {filteredRows.length === 0 ? (
                    <tr>
                      <td colSpan={9} style={{ ...UI.td, textAlign: "center", color: "#64748b", padding: "14px 10px" }}>
                        Žádné výsledky.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <div style={{ ...UI.sectionTitle, fontSize: 16, marginBottom: 0, fontWeight: 900 }}>
            {`Modul ${activeSubtab} pro výkresy je ve vývoji.`}
          </div>
        )}
      </div>
    </div>
  );
}
