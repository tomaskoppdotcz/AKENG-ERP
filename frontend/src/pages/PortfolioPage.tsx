import React, { useEffect, useMemo, useState } from "react";
import { UI } from "../styles/ui";
import { getPortfolioItems, type PortfolioItem } from "../services/portfolioApi";

type Props = {
  onBackToDashboard?: () => void;
  onOpenItemDetail?: (item: PortfolioItem) => void;
};

function searchValue(v: string) {
  return v.trim().toLowerCase();
}

export default function PortfolioPage({ onOpenItemDetail }: Props) {
  const [items, setItems] = useState<PortfolioItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [hoveredId, setHoveredId] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    getPortfolioItems()
      .then((rows) => {
        if (!cancelled) setItems(rows);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Nepodarilo se nacist portfolio.");
          setItems([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    const q = searchValue(query);
    if (!q) return items;
    return items.filter((i) =>
      [i.gpn, i.name, String(i.customer_id), i.group_id == null ? "" : String(i.group_id)].join(" ").toLowerCase().includes(q)
    );
  }, [items, query]);

  const kpi = useMemo(() => {
    const celkemPolozek = filtered.length;
    const skupiny = new Set(filtered.map((i) => i.group_id).filter((v): v is number => v != null)).size;
    const sTechnologii = filtered.filter((i) => i.active_template_id != null).length;
    const bezTechnologie = filtered.filter((i) => i.active_template_id == null).length;
    const revize = "A / B / C";

    return [
      { label: "Celkem položek", value: String(celkemPolozek) },
      { label: "Skupiny", value: String(skupiny) },
      { label: "Revize", value: revize },
      { label: "S technologií", value: String(sTechnologii) },
      { label: "Bez technologie", value: String(bezTechnologie) },
    ] as const;
  }, [filtered]);

  return (
    <div style={UI.container}>
      <div style={{ paddingTop: 10, display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={UI.pageHeaderRow}>
          <div>
            <div style={UI.sectionTitle}>Portfolio</div>
            <div style={UI.sectionSubtitle}>Přehled portfolia výrobků</div>
          </div>
          <div style={UI.pageHeaderActions}>
            <button type="button" style={UI.buttons.primary} onClick={() => {}}>
              Nová položka
            </button>
            <button type="button" style={UI.buttons.secondary} onClick={() => {}}>
              Import
            </button>
          </div>
        </div>

        <div style={UI.summaryTilesGridOuter}>
          <div style={{ ...UI.summaryTilesGridSix, gridTemplateColumns: "repeat(5, minmax(0, 1fr))", minWidth: 820 }}>
            {kpi.map((tile) => (
              <div key={tile.label} style={UI.summaryTile}>
                <div style={UI.summaryTileLabel}>{tile.label}</div>
                <div style={UI.summaryTileValue}>{tile.value}</div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ ...UI.card, borderRadius: 14, padding: 16 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12 }}>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Hledat"
              style={UI.inputs.base}
            />
          </div>

          {loading ? <div style={UI.sectionSubtitle}>Načítám portfolio...</div> : null}
          {error ? <div style={{ color: "#b91c1c", fontWeight: 700 }}>{error}</div> : null}

          {!loading && !error ? (
            <div style={{ overflowX: "auto" }}>
              <table style={UI.table}>
                <thead>
                  <tr style={{ background: "#f8fafc" }}>
                    {["GPN", "Název", "Zákazník", "Skupina", "Technologie"].map((h) => (
                      <th key={h} style={{ ...UI.th, fontSize: 13, padding: "10px 10px", whiteSpace: "nowrap" }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((item) => (
                    <tr
                      key={item.id}
                      onClick={() => onOpenItemDetail?.(item)}
                      onMouseEnter={() => setHoveredId(item.id)}
                      onMouseLeave={() => setHoveredId((id) => (id === item.id ? null : id))}
                      style={{ cursor: "pointer", background: hoveredId === item.id ? "#eff6ff" : "#fff" }}
                    >
                      <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap", fontWeight: 800 }}>{item.gpn}</td>
                      <td style={{ ...UI.td, padding: "10px 10px" }}>{item.name}</td>
                      <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>{item.customer_id}</td>
                      <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>{item.group_id ?? "—"}</td>
                      <td
                        style={{
                          ...UI.td,
                          padding: "10px 10px",
                          whiteSpace: "nowrap",
                          fontWeight: 900,
                          color: item.active_template_id != null ? "#15803d" : "#dc2626",
                        }}
                      >
                        {item.active_template_id != null ? "ANO" : "NE"}
                      </td>
                    </tr>
                  ))}
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={5} style={{ ...UI.td, textAlign: "center", color: "#64748b", padding: "14px 10px" }}>
                        Žádné výsledky.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

