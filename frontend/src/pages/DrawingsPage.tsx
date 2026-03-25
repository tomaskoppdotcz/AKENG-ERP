import React, { useEffect, useMemo, useState } from "react";
import { UI } from "../styles/ui";
import { getJobItems, getJobs, getProductionOrders } from "../services/ordersApi";

type DrawingItem = {
  zakazka: string;
  job_item_id: number;
  line_no: number;
  gpn: string;
  popis: string;
  material: string;
  mnozstvi: string;
  termin: string;
  vp: string;
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

function q(v: string) {
  return v.trim().toLowerCase();
}

function formatVpCodes(codes: string[]): string {
  const cleaned = codes.map((c) => c.trim()).filter((c) => c.length > 0);
  if (cleaned.length === 0) return "—";
  if (cleaned.length <= 2) return cleaned.join(", ");
  return `${cleaned[0]}, ${cleaned[1]} +${cleaned.length - 2}`;
}

export default function DrawingsPage({ onBackToDashboard, onOpenItemDetail }: Props) {
  const [activeSubtab, setActiveSubtab] = useState<DrawingsSubtab>("Přehled");
  const [hoverSubtab, setHoverSubtab] = useState<DrawingsSubtab | null>(null);
  const [query, setQuery] = useState("");
  const [activeFilters, setActiveFilters] = useState<DrawingFilter[]>([]);
  const [hoveredRow, setHoveredRow] = useState<number | null>(null);
  const [rows, setRows] = useState<DrawingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([getJobItems(), getJobs(), getProductionOrders()])
      .then(([jobItems, jobs, productionOrders]) => {
        if (cancelled) return;
        const jobById = new Map(jobs.map((j) => [j.id, j]));
        const vpByItemId = new Map<number, string[]>();
        for (const vp of productionOrders) {
          const arr = vpByItemId.get(vp.job_item_id) ?? [];
          arr.push(vp.vp_code);
          vpByItemId.set(vp.job_item_id, arr);
        }
        const mapped: DrawingItem[] = jobItems.map((row) => {
          const job = jobById.get(row.job_id);
          return {
            zakazka: job?.zak_code ?? "—",
            job_item_id: row.id,
            line_no: row.line_no,
            gpn: row.gpn,
            popis: "—",
            material: "—",
            mnozstvi: `${row.qty} ks`,
            termin: row.due_date ?? "—",
            vp: formatVpCodes(vpByItemId.get(row.id) ?? []),
            stav: "—",
          };
        });
        setRows(mapped);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Nepodařilo se načíst výkresy.");
        setRows([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const filteredRows = useMemo(() => {
    const normalized = q(query);
    return rows.filter((row) => {
      const haystack = [row.zakazka, row.gpn, row.popis, row.material, row.vp].join(" ").toLowerCase();
      const matchesQuery = !normalized || haystack.includes(normalized);
      const done = row.stav === "Hotovo";
      const late = row.termin !== "—" && row.termin < new Date().toISOString().slice(0, 10);
      const hasDelivery = row.line_no % 2 === 0;
      const invoiced = done && row.vp !== "—";

      const matchesFilters = activeFilters.every((f) => {
        if (f === "Po termínu") return late;
        if (f === "Dokončená") return done;
        if (f === "Dodací list") return hasDelivery;
        if (f === "Fakturováno") return invoiced;
        return true;
      });

      return matchesQuery && matchesFilters;
    });
  }, [rows, query, activeFilters]);

  const kpi = useMemo(() => {
    const celkemPolozek = rows.length;
    const celkemKusu = rows.reduce((sum, row) => {
      const qty = Number.parseInt(row.mnozstvi.replace(" ks", "").trim(), 10) || 0;
      return sum + qty;
    }, 0);
    const aktivniPolozky = rows.filter((row) => row.stav !== "Hotovo").length;
    const poTerminu = rows.filter((row) => row.termin !== "—" && row.termin < new Date().toISOString().slice(0, 10)).length;
    const kExpedici = rows.filter((row) => row.stav === "Hotovo").length;

    return [
      { label: "Celkem položek", value: String(celkemPolozek) },
      { label: "Celkem kusů", value: `${celkemKusu} ks` },
      { label: "Aktivní položky", value: String(aktivniPolozky) },
      { label: "Po termínu", value: String(poTerminu) },
      { label: "K expedici", value: String(kExpedici) },
    ] as const;
  }, [rows]);

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
            {loading ? <div style={UI.sectionSubtitle}>Načítám výkresy…</div> : null}
            {error ? <div style={{ color: "#b91c1c", fontWeight: 700, marginBottom: 10 }}>{error}</div> : null}
            {!loading && !error && rows.length === 0 ? (
              <div
                style={{
                  textAlign: "center",
                  color: "#64748b",
                  fontWeight: 700,
                  padding: "24px 12px",
                  border: "1px solid #e2e8f0",
                  borderRadius: 12,
                  background: "#f8fafc",
                }}
              >
                Výkresy jsou zatím prázdné. Po načtení reálných položek z backendu se zde objeví seznam.
              </div>
            ) : null}
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

            {!loading && rows.length > 0 ? (
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
                      key={`${row.zakazka}-${row.job_item_id}`}
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
                      <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap", fontWeight: 900 }}>{row.zakazka}</td>
                      <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>{row.line_no}</td>
                      <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap", fontWeight: 800 }}>{row.gpn}</td>
                      <td style={{ ...UI.td, padding: "10px 10px" }}>{row.popis}</td>
                      <td style={{ ...UI.td, padding: "10px 10px" }}>{row.material}</td>
                      <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>{row.mnozstvi}</td>
                      <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>{row.termin}</td>
                      <td style={{ ...UI.td, padding: "10px 10px", color: row.vp !== "—" ? "#15803d" : "#64748b", fontWeight: 700 }}>
                        {row.vp}
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
            ) : null}
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
