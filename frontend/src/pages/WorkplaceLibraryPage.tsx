import React, { useEffect, useMemo, useState } from "react";
import { UI } from "../styles/ui";
import { getWorkplaceLibraryItems, type WorkplaceLibraryItem } from "../services/masterLibrariesApi";

function norm(s: string) {
  return s.trim().toLowerCase();
}

function formatRate(v: number | null): string {
  if (v == null) return "—";
  return v.toLocaleString("cs-CZ", { maximumFractionDigits: 2 });
}

export default function WorkplaceLibraryPage() {
  const [rows, setRows] = useState<WorkplaceLibraryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getWorkplaceLibraryItems()
      .then((data) => {
        if (!cancelled) setRows(data);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Nepodařilo se načíst data.");
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
    return rows.filter((r) => {
      const code = r.code ?? "";
      const typ = r.workplace_type ?? "";
      return norm(`${code} ${r.name} ${typ}`).includes(q);
    });
  }, [rows, query]);

  return (
    <div style={{ ...UI.card, borderRadius: 14, padding: 16 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12 }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Hledat pracoviště nebo kód..."
          style={UI.inputs.base}
        />
      </div>

      {loading ? <div style={UI.sectionSubtitle}>Načítám pracoviště…</div> : null}
      {error ? <div style={{ color: "#b91c1c", fontWeight: 700 }}>{error}</div> : null}

      {!loading && !error ? (
        <div style={{ overflowX: "auto" }}>
          <table style={UI.table}>
            <thead>
              <tr style={{ background: "#f8fafc" }}>
                {["Kód", "Název", "Typ pracoviště", "Hodinová sazba", "Aktivní"].map((h) => (
                  <th key={h} style={{ ...UI.th, fontSize: 13, padding: "10px 10px", whiteSpace: "nowrap" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id}>
                  <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>{r.code ?? "—"}</td>
                  <td style={{ ...UI.td, padding: "10px 10px" }}>{r.name}</td>
                  <td style={{ ...UI.td, padding: "10px 10px" }}>{r.workplace_type ?? "—"}</td>
                  <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>{formatRate(r.hourly_rate)}</td>
                  <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>{r.is_active ? "ANO" : "NE"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
