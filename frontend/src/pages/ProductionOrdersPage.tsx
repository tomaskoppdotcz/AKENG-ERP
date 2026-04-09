import React, { useEffect, useMemo, useState } from "react";
import PageContainer from "../components/layout/PageContainer";
import PageHeader from "../components/layout/PageHeader";
import PageSection from "../components/layout/PageSection";
import OverviewPrimaryFilterRow from "../components/overview/OverviewPrimaryFilterRow";
import { OVERVIEW_ORDER_TYPE_OPTIONS, OVERVIEW_WORKFLOW_OPTIONS } from "../overview/overviewFilterConfig";
import { UI } from "../styles/ui";
import type { ErpWorkflowListFilter, OrdersOverviewOrderTypeFilter } from "../services/ordersApi";
import {
  getProductionOrdersOverview,
  openProductionOrderPdfInNewTab,
  type ProductionOrderOverviewRow,
} from "../services/productionOrdersApi";
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

/** Stejné popisky jako u ostatních přehledů; u VP zatím nefiltrují Dodací list / Fakturováno. */
const VP_QUICK_FILTER_LABELS = ["Po termínu", "Dokončená", "Dodací list", "Fakturováno"] as const;

type ProductionQuickFilter = "Po termínu" | "Dokončená";

function isVpQuickFilterDisabledLabel(label: (typeof VP_QUICK_FILTER_LABELS)[number]): label is "Dodací list" | "Fakturováno" {
  return label === "Dodací list" || label === "Fakturováno";
}

function isVpRowOverdue(row: ProductionOrderOverviewRow, todayIso: string): boolean {
  return (
    row.due_date != null &&
    String(row.due_date).trim() !== "" &&
    String(row.due_date).slice(0, 10) < todayIso
  );
}

function isVpRowDone(row: ProductionOrderOverviewRow): boolean {
  return String(row.status ?? "").trim().toLowerCase() === "done";
}

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
  const [hoveredId, setHoveredId] = useState<number | null>(null);
  const [workflowListFilter, setWorkflowListFilter] = useState<ErpWorkflowListFilter>("active");
  const [overviewOrderType, setOverviewOrderType] = useState<OrdersOverviewOrderTypeFilter>("all");
  const [activeQuickFilters, setActiveQuickFilters] = useState<ProductionQuickFilter[]>([]);

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

  const rowsByOrderType = useMemo(() => {
    if (overviewOrderType === "all") return rows;
    return rows.filter((r) => {
      const ot = String(r.order_type ?? "customer").trim().toLowerCase();
      const normalized = ot === "internal" ? "internal" : "customer";
      if (overviewOrderType === "customer") return normalized === "customer";
      if (overviewOrderType === "internal") return normalized === "internal";
      return true;
    });
  }, [rows, overviewOrderType]);

  const displayRows = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return rowsByOrderType.filter((row) =>
      activeQuickFilters.every((f) => {
        if (f === "Po termínu") return isVpRowOverdue(row, today);
        if (f === "Dokončená") return isVpRowDone(row);
        return true;
      })
    );
  }, [rowsByOrderType, activeQuickFilters]);

  return (
    <PageContainer style={{ paddingTop: 10 }}>
      <PageHeader
        title="Výrobní příkazy"
        subtitle="Přehled všech VP napříč zákaznickými i interními zakázkami"
      />

      <PageSection gapTop={16}>
        <div
          style={{
            ...UI.card,
            borderRadius: 14,
            padding: 0,
            overflow: "hidden",
            width: "100%",
            boxSizing: "border-box",
          }}
        >
          <div style={{ padding: 16, paddingBottom: 14, borderBottom: "1px solid #e2e8f0" }}>
            <OverviewPrimaryFilterRow
              loading={loading}
              typPrehleduOptions={OVERVIEW_ORDER_TYPE_OPTIONS}
              typPrehleduActiveId={overviewOrderType}
              onTypPrehledu={(id) => setOverviewOrderType(id as OrdersOverviewOrderTypeFilter)}
              stavZakazkyOptions={OVERVIEW_WORKFLOW_OPTIONS}
              stavZakazkyActiveId={workflowListFilter}
              onStavZakazky={(id) => setWorkflowListFilter(id as ErpWorkflowListFilter)}
              rowStyle={{ marginBottom: 0 }}
              trailing={
                <>
                  {VP_QUICK_FILTER_LABELS.map((filter) => {
                    if (isVpQuickFilterDisabledLabel(filter)) {
                      return (
                        <button
                          key={filter}
                          type="button"
                          disabled
                          title="Tento filtr zatím není napojen na data v přehledu VP."
                          style={{
                            ...UI.ordersFilterChip,
                            opacity: 0.5,
                            cursor: "not-allowed",
                          }}
                        >
                          {filter}
                        </button>
                      );
                    }
                    const active = activeQuickFilters.includes(filter);
                    return (
                      <button
                        key={filter}
                        type="button"
                        onClick={() =>
                          setActiveQuickFilters((prev) =>
                            prev.includes(filter) ? prev.filter((f) => f !== filter) : [...prev, filter]
                          )
                        }
                        style={{
                          ...UI.ordersFilterChip,
                          ...(active ? UI.ordersFilterChipActive : {}),
                        }}
                      >
                        {filter}
                      </button>
                    );
                  })}
                </>
              }
            />
          </div>
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
                  {displayRows.map((row) => (
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
                        <button
                          type="button"
                          style={{ ...UI.buttons.secondary, marginLeft: 8, padding: "2px 8px", fontSize: 11 }}
                          onClick={(e) => {
                            e.stopPropagation();
                            void openProductionOrderPdfInNewTab(row.id).catch((err) =>
                              window.alert(err instanceof Error ? err.message : String(err))
                            );
                          }}
                        >
                          Tisk VP
                        </button>
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
                        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
                          <span style={{ fontWeight: 800 }}>{row.zakazka ?? "—"}</span>
                          {row.customer_order_id != null && onOpenCustomerOrderCard ? (
                            <button
                              type="button"
                              style={{ ...UI.buttons.secondary, padding: "2px 8px", fontSize: 11 }}
                              onClick={() => onOpenCustomerOrderCard(row.customer_order_id!)}
                            >
                              Náhled
                            </button>
                          ) : null}
                        </div>
                      </td>
                      <td style={{ ...UI.td, whiteSpace: "nowrap" }}>{row.line_no ?? "—"}</td>
                      <td style={{ ...UI.td, whiteSpace: "nowrap" }}>{row.due_date ?? "—"}</td>
                    </tr>
                  ))}
                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={10} style={{ ...UI.td, textAlign: "center", color: "#64748b" }}>
                        Žádné výrobní příkazy.
                      </td>
                    </tr>
                  ) : displayRows.length === 0 ? (
                    <tr>
                      <td colSpan={10} style={{ ...UI.td, textAlign: "center", color: "#64748b" }}>
                        Žádné výsledky.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </PageSection>
    </PageContainer>
  );
}
