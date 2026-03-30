import React, { useEffect, useMemo, useState } from "react";
import { UI } from "../styles/ui";
import type { ErpWorkflowListFilter } from "../services/ordersApi";
import { getProductionOrdersOverview, type ProductionOrderOverviewRow } from "../services/productionOrdersApi";
import { findPortfolioItemByGpn } from "../services/portfolioApi";

type Props = {
  onOpenDetail: (productionOrderId: number) => void;
  /** Otevře detail VP v pracovní záložce. */
  onOpenDetailInWorkspaceTab?: (productionOrderId: number, titleHint?: string) => void;
  onOpenPortfolioItemId?: (portfolioItemId: number) => void;
  onOpenCustomerOrderCard?: (customerOrderId: number) => void;
  onPreviewPortfolioById?: (portfolioItemId: number) => void;
  onPreviewProductionOrderById?: (productionOrderId: number) => void;
};

const linkButtonReset: React.CSSProperties = {
  background: "none",
  border: "none",
  padding: 0,
  margin: 0,
  cursor: "pointer",
  font: "inherit",
  color: "#2563eb",
  textDecoration: "underline",
  textUnderlineOffset: "3px",
  fontWeight: 800,
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

const WORKFLOW_LIST_OPTIONS: { id: ErpWorkflowListFilter; label: string }[] = [
  { id: "active", label: "Aktivní" },
  { id: "cancelled", label: "Stornované" },
  { id: "all", label: "Vše" },
];

export default function ProductionOrdersPage({
  onOpenDetail,
  onOpenDetailInWorkspaceTab,
  onOpenPortfolioItemId,
  onOpenCustomerOrderCard,
  onPreviewPortfolioById,
  onPreviewProductionOrderById,
}: Props) {
  const [rows, setRows] = useState<ProductionOrderOverviewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [hoveredId, setHoveredId] = useState<number | null>(null);
  const [workflowListFilter, setWorkflowListFilter] = useState<ErpWorkflowListFilter>("active");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getProductionOrdersOverview(workflowListFilter)
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
  }, [workflowListFilter]);

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

        <div style={{ ...UI.card, borderRadius: 14, display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 13, fontWeight: 800, color: "#475569" }}>Zobrazit:</span>
            {WORKFLOW_LIST_OPTIONS.map(({ id, label }) => {
              const active = workflowListFilter === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setWorkflowListFilter(id)}
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
          </div>
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
                      onClick={() => {
                        onOpenDetailInWorkspaceTab?.(row.id, row.vp_code ?? undefined);
                        onOpenDetail(row.id);
                      }}
                      onMouseEnter={() => setHoveredId(row.id)}
                      onMouseLeave={() => setHoveredId((id) => (id === row.id ? null : id))}
                      style={{
                        cursor: "pointer",
                        background: hoveredId === row.id ? "#eff6ff" : "#fff",
                      }}
                    >
                      <td style={{ ...UI.td, fontWeight: 900 }} onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          style={{ ...linkButtonReset, fontWeight: 900 }}
                          onClick={() => {
                            onOpenDetailInWorkspaceTab?.(row.id, row.vp_code ?? undefined);
                            onOpenDetail(row.id);
                          }}
                        >
                          {row.vp_code}
                        </button>
                        {onPreviewProductionOrderById ? (
                          <button
                            type="button"
                            style={{ ...UI.buttons.secondary, marginLeft: 8, padding: "2px 8px", fontSize: 11 }}
                            onClick={() => onPreviewProductionOrderById(row.id)}
                          >
                            Náhled
                          </button>
                        ) : null}
                        {String(row.workflow_status ?? "").trim().toLowerCase() === "cancelled" ? (
                          <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 800, color: "#991b1b" }}>Storno</span>
                        ) : null}
                      </td>
                      <td style={UI.td} onClick={(e) => e.stopPropagation()}>
                        {row.gpn && onOpenPortfolioItemId ? (
                          <button
                            type="button"
                            style={linkButtonReset}
                            onClick={async () => {
                              if (row.portfolio_item_id != null) {
                                onOpenPortfolioItemId(row.portfolio_item_id);
                                return;
                              }
                              const g = row.gpn.trim();
                              if (!g) return;
                              const item = await findPortfolioItemByGpn(g);
                              if (item) onOpenPortfolioItemId(item.id);
                            }}
                          >
                            {row.gpn}
                          </button>
                        ) : (
                          row.gpn ?? "—"
                        )}
                        {row.portfolio_item_id != null && onPreviewPortfolioById ? (
                          <button
                            type="button"
                            style={{ ...UI.buttons.secondary, marginLeft: 8, padding: "2px 8px", fontSize: 11 }}
                            onClick={() => onPreviewPortfolioById(row.portfolio_item_id!)}
                          >
                            Náhled
                          </button>
                        ) : null}
                      </td>
                      <td style={UI.td}>{row.description ?? "—"}</td>
                      <td style={{ ...UI.td, whiteSpace: "nowrap" }}>{row.quantity} ks</td>
                      <td style={{ ...UI.td, whiteSpace: "nowrap" }}>{labelLogisticMode(row.logistic_mode)}</td>
                      <td style={{ ...UI.td, whiteSpace: "nowrap" }}>{labelSourceType(row.source_type)}</td>
                      <td style={{ ...UI.td, whiteSpace: "nowrap" }}>{row.status ?? "—"}</td>
                      <td style={{ ...UI.td, whiteSpace: "nowrap" }} onClick={(e) => e.stopPropagation()}>
                        {row.customer_order_id != null && onOpenCustomerOrderCard && row.zakazka ? (
                          <button
                            type="button"
                            style={linkButtonReset}
                            onClick={() => onOpenCustomerOrderCard(row.customer_order_id!)}
                          >
                            {row.zakazka}
                          </button>
                        ) : (
                          row.zakazka ?? "—"
                        )}
                      </td>
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
