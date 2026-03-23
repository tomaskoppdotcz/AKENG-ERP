import React, { useEffect, useMemo, useState } from "react";
import { UI } from "../styles/ui";
import { getMaterialLibraryItems, type MaterialLibraryItem } from "../services/materialLibraryApi";
import { getMaterialStockItems, type MaterialStockItem } from "../services/materialStockApi";

type MaterialStockRow = MaterialStockItem & {
  material_dimension: string | null;
};

type Props = {
  onOpenDetail?: (item: MaterialStockRow) => void;
};

function norm(value: string): string {
  return value.trim().toLowerCase();
}

export default function MaterialStockPage({ onOpenDetail }: Props) {
  const [rows, setRows] = useState<MaterialStockRow[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.all([getMaterialStockItems(), getMaterialLibraryItems()])
      .then(([stockItems, libItems]) => {
        if (cancelled) return;
        const byMaterialId = new Map<number, MaterialLibraryItem>();
        for (const item of libItems) byMaterialId.set(item.id, item);
        const mapped = stockItems.map((s) => ({
          ...s,
          material_dimension: byMaterialId.get(s.material_library_item_id)?.dimension ?? null,
        }));
        setRows(mapped);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Nepodařilo se načíst sklad materiálu.");
          setRows([]);
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
    const q = norm(query);
    if (!q) return rows;
    return rows.filter((r) =>
      norm(
        `${r.material_name} ${r.material_code} ${r.material_dimension ?? ""} ${r.location ?? ""} ${r.unit ?? ""}`
      ).includes(q)
    );
  }, [rows, query]);

  return (
    <div style={UI.container}>
      <div style={{ paddingTop: 10, display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={UI.pageHeaderRow}>
          <div>
            <div style={UI.sectionTitle}>Sklad materiálu</div>
            <div style={UI.sectionSubtitle}>Přehled stavu materiálu</div>
          </div>
        </div>

        <div style={{ ...UI.card, borderRadius: 14, padding: 16 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12 }}>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Hledat materiál, kód, rozměr, lokaci..."
              style={UI.inputs.base}
            />
          </div>

          {loading ? <div style={UI.sectionSubtitle}>Načítám sklad materiálu...</div> : null}
          {error ? <div style={{ color: "#b91c1c", fontWeight: 700 }}>{error}</div> : null}

          {!loading && !error ? (
            <div style={{ overflowX: "auto" }}>
              <table style={UI.table}>
                <thead>
                  <tr style={{ background: "#f8fafc" }}>
                    {["Materiál", "Kód", "Rozměr", "Lokace", "Stav", "Min. zásoba"].map((h) => (
                      <th key={h} style={{ ...UI.th, fontSize: 13, padding: "10px 10px", whiteSpace: "nowrap" }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((row) => (
                    <tr
                      key={row.id}
                      onClick={() => onOpenDetail?.(row)}
                      onMouseEnter={() => setHoverId(row.id)}
                      onMouseLeave={() => setHoverId((id) => (id === row.id ? null : id))}
                      style={{ cursor: "pointer", background: hoverId === row.id ? "#eff6ff" : "#fff" }}
                    >
                      <td style={{ ...UI.td, padding: "10px 10px", fontWeight: 800 }}>{row.material_name}</td>
                      <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>{row.material_code || "—"}</td>
                      <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>{row.material_dimension || "—"}</td>
                      <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>{row.location || "—"}</td>
                      <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>
                        {row.current_qty} {row.unit || ""}
                      </td>
                      <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>
                        {row.min_qty == null ? "—" : `${row.min_qty} ${row.unit || ""}`}
                      </td>
                    </tr>
                  ))}
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={6} style={{ ...UI.td, textAlign: "center", color: "#64748b", padding: "14px 10px" }}>
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
