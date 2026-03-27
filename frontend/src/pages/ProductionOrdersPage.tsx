import React, { useEffect, useMemo, useState } from "react";
import { UI } from "../styles/ui";
import { getProductionOrdersOverview, type ProductionOrderOverviewRow } from "../services/productionOrdersApi";

type Props = {
  onOpenDetail: (productionOrderId: number) => void;
};

function labelLogisticMode(v: string | null | undefined): string {
  if (!v) return "—";
  if (v === "sklad") return "Sklad";
  if (v === "sklad_zakaznik") return "Sklad -> zákazník";
  if (v === "vyroba_zakaznik") return "Výroba -> zákazník";
  return v;
}

function labelSourceType(v: string | null | undefined): string {
  if (!v) return "—";
  if (v === "stock_allocation") return "Ze skladu";
  if (v === "order_allocation") return "Výroba pro zakázku";
  if (v === "restock_allocation") return "Doplnění skladu";
  return v;
}

export default function ProductionOrdersPage({ onOpenDetail }: Props) {
  const [rows, setRows] = useState<ProductionOrderOverviewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [hoveredId, setHoveredId] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getProductionOrdersOverview()
      .then((data) => {
        if (!cancelled) setRows(data);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Nepodařilo se načíst výrobní příkazy.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [
        r.vp_code,
        r.gpn ?? "",
        r.description ?? "",
        r.zakazka ?? "",
        r.source_type ?? "",
        r.logistic_mode ?? "",
        r.status ?? "",
      ]
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }, [rows, query]);

  return (
    <div style={{ paddingTop: 10 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <div style={UI.pageTitle}>Výrobní příkazy</div>
          <div style={UI.sectionSubtitle}>Přehled všech VP napříč zákaznickými i interními zakázkami</div>
        </div>

        <div style={{ ...UI.card, borderRadius: 14 }}>
          <div style={UI.ordersFilterSearchWrap}>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Hledat VP, GPN, název, zakázku…"
              style={UI.inputs.base}
            />
          </div>
        </div>

        <div style={{ ...UI.card, borderRadius: 14, padding: 0, overflow: "hidden" }}>
          {loading ? (
            <div style={{ padding: 16, color: "#64748b", fontWeight: 600 }}>Načítám výrobní příkazy…</div>
          ) : error ? (
            <div style={{ padding: 16, color: "#991b1b", fontWeight: 700 }}>{error}</div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={UI.table}>
                <thead>
                  <tr style={{ background: "#f8fafc" }}>
                    {["VP", "GPN", "Název", "Množství", "Logistický režim", "Typ zdroje", "Stav", "Zakázka", "Řádek", "Termín"].map((h) => (
                      <th key={h} style={{ ...UI.th, whiteSpace: "nowrap" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((row) => (
                    <tr
                      key={row.id}
                      onClick={() => onOpenDetail(row.id)}
                      onMouseEnter={() => setHoveredId(row.id)}
                      onMouseLeave={() => setHoveredId((id) => (id === row.id ? null : id))}
                      style={{
                        cursor: "pointer",
                        background: hoveredId === row.id ? "#eff6ff" : "#fff",
                      }}
                    >
                      <td style={{ ...UI.td, fontWeight: 900 }}>{row.vp_code}</td>
                      <td style={UI.td}>{row.gpn ?? "—"}</td>
                      <td style={UI.td}>{row.description ?? "—"}</td>
                      <td style={{ ...UI.td, whiteSpace: "nowrap" }}>{row.quantity} ks</td>
                      <td style={{ ...UI.td, whiteSpace: "nowrap" }}>{labelLogisticMode(row.logistic_mode)}</td>
                      <td style={{ ...UI.td, whiteSpace: "nowrap" }}>{labelSourceType(row.source_type)}</td>
                      <td style={{ ...UI.td, whiteSpace: "nowrap" }}>{row.status ?? "—"}</td>
                      <td style={{ ...UI.td, whiteSpace: "nowrap" }}>{row.zakazka ?? "—"}</td>
                      <td style={{ ...UI.td, whiteSpace: "nowrap" }}>{row.line_no ?? "—"}</td>
                      <td style={{ ...UI.td, whiteSpace: "nowrap" }}>{row.due_date ?? "—"}</td>
                    </tr>
                  ))}
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={10} style={{ ...UI.td, textAlign: "center", color: "#64748b" }}>
                        Žádné výrobní příkazy.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
