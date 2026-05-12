import React, { useEffect, useMemo, useState } from "react";
import PageContainer from "../components/layout/PageContainer";
import PageHeader from "../components/layout/PageHeader";
import PageSection from "../components/layout/PageSection";
import OverviewPrimaryFilterRow from "../components/overview/OverviewPrimaryFilterRow";
import OverviewSloupceButton from "../components/overview/OverviewSloupceButton";
import { OVERVIEW_ORDER_TYPE_OPTIONS, OVERVIEW_WORKFLOW_OPTIONS } from "../overview/overviewFilterConfig";
import { erpKpiTileBackground, UI } from "../styles/ui";
import type { ErpWorkflowListFilter, OrdersOverviewOrderTypeFilter } from "../services/ordersApi";
import {
  getProductionOrdersOverview,
  getRestockWipReservationNotices,
  openProductionOrderPdfInNewTab,
  type ProductionOrderOverviewRow,
  type RestockWipReservationNotice,
} from "../services/productionOrdersApi";
import { listPortfolioItemsByGpn } from "../services/portfolioApi";
import {
  formatProductionOrderOverviewOperationalStatus,
  isProductionOrderOverviewCompleted,
} from "../utils/productionOrderOverviewStatus";
import TableRowActionsMenu, { type TableRowActionItem } from "../components/table/TableRowActionsMenu";
import TableLayoutModal from "../components/overview/TableLayoutModal";
import ErpPagination from "../components/overview/ErpPagination";
import { useClientPagination } from "../hooks/useClientPagination";
import { usePersistedTableLayout } from "../hooks/usePersistedTableLayout";
import type { TableColumnDef } from "../overview/tableLayoutMerge";
import { sortRowsWithConfig } from "../overview/tableLayoutMerge";
import { buildSearchHaystack, matchesSearchQuery } from "../overview/overviewSearch";
import {
  formatOverviewDash,
  formatOverviewMoneyKc0,
  formatOverviewPercentAsShown,
  formatOverviewReportedMinutes,
} from "../overview/overviewMetricsFormat";

type Props = {
  onOpenDetail: (productionOrderId: number) => void;
  /** Otevře detail VP v pracovní záložce. */
  onOpenDetailInWorkspaceTab?: (productionOrderId: number, titleHint?: string) => void;
  onOpenPortfolioItemId?: (portfolioItemId: number) => void;
  onOpenCustomerOrderCard?: (customerOrderId: number) => void;
  onPreviewPortfolioById?: (portfolioItemId: number) => void;
};

const linkButtonReset: React.CSSProperties = {
  background: "none",
  border: "none",
  padding: 0,
  margin: 0,
  cursor: "pointer",
  font: "inherit",
  color: UI.colors.primary,
  textDecoration: "underline",
  textUnderlineOffset: "3px",
  fontWeight: 800,
};

function productionOrderStatusBadgeStyle(label: string): React.CSSProperties {
  const base = UI.statusBadgeBase;
  if (label === "Stornováno" || label === "Blokováno") return { ...base, ...UI.statusBadgeProblem };
  if (label === "Běží") return { ...base, ...UI.statusBadgeRunning };
  if (label === "Hotovo" || label === "Na skladě" || label === "K expedici")
    return { ...base, ...UI.statusBadgeOk };
  if (label === "Čeká na materiál" || label === "Naplánováno")
    return { ...base, ...UI.statusBadgeWait };
  return { ...base, ...UI.statusBadgeNeutral };
}

const NUMERIC_COLUMN_KEYS = new Set(["quantity", "reported", "completion", "labor", "performance", "line_no"]);

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

function productionOrderSearchHaystack(row: ProductionOrderOverviewRow): string {
  return buildSearchHaystack(
    row.vp_code,
    row.gpn,
    row.description,
    row.drawing_number,
    row.drawing_revision,
    row.zakazka,
    row.customer_order_no,
    row.logistic_mode,
  );
}

function labelSourceTypeRow(row: ProductionOrderOverviewRow): string {
  const base = labelSourceType(row.source_type);
  if (row.restock_redirected_from_internal) {
    return `${base} · Přesměrováno ze skladu`;
  }
  return base;
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
  return isProductionOrderOverviewCompleted(row);
}

const PRODUCTION_ORDERS_TABLE_DEFAULTS: readonly TableColumnDef[] = [
  { key: "vp", label: "VP", defaultWidth: 200 },
  { key: "gpn", label: "GPN", defaultWidth: 120 },
  { key: "drawing_number", label: "Výkres", defaultWidth: 130 },
  { key: "drawing_revision", label: "Revize", defaultWidth: 90 },
  { key: "description", label: "Název", defaultWidth: 160 },
  { key: "quantity", label: "Množství", defaultWidth: 100 },
  { key: "logistic", label: "Logistický režim", defaultWidth: 160 },
  { key: "source", label: "Typ zdroje", defaultWidth: 160 },
  { key: "status", label: "Stav", defaultWidth: 120 },
  { key: "reported", label: "Vykázaný čas", defaultWidth: 110 },
  { key: "completion", label: "Hotovo", defaultWidth: 90 },
  { key: "labor", label: "Náklad práce", defaultWidth: 120 },
  { key: "performance", label: "Výkonnost", defaultWidth: 100 },
  { key: "zakazka", label: "Zakázka", defaultWidth: 140 },
  { key: "customer_order_no", label: "Objednávka", defaultWidth: 120 },
  { key: "line_no", label: "Řádek", defaultWidth: 80 },
  { key: "due", label: "Termín", defaultWidth: 110 },
  { key: "actions", label: "Akce", defaultWidth: 52 },
] as const;

const PROD_COL_LABELS: Record<string, string> = Object.fromEntries(PRODUCTION_ORDERS_TABLE_DEFAULTS.map((c) => [c.key, c.label]));

type ProdCellCtx = Pick<
  Props,
  | "onOpenDetail"
  | "onOpenDetailInWorkspaceTab"
  | "onOpenPortfolioItemId"
  | "onOpenCustomerOrderCard"
  | "onPreviewPortfolioById"
> & {
  setActionsMenuRowId: (id: number | null) => void;
};

function renderProductionCell(key: string, row: ProductionOrderOverviewRow, ctx: ProdCellCtx): React.ReactNode {
  switch (key) {
    case "vp":
      return (
        <div onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            className="erp-table-link"
            style={{ ...UI.tableLinkButtonReset, fontWeight: 900, textDecoration: "none" }}
            onClick={() => {
              if (ctx.onOpenDetailInWorkspaceTab) {
                ctx.onOpenDetailInWorkspaceTab(row.id, row.vp_code ?? undefined);
              } else {
                ctx.onOpenDetail(row.id);
              }
            }}
          >
            {row.vp_code}
          </button>
          {String(row.workflow_status ?? "").trim().toLowerCase() === "cancelled" ? (
            <span
              style={{
                marginLeft: 8,
                display: "inline-flex",
                alignItems: "center",
                fontSize: 12,
                fontWeight: 800,
                color: UI.colors.problemFg,
                background: UI.colors.problemBg,
                padding: "4px 10px",
                borderRadius: 6,
              }}
            >
              Storno
            </span>
          ) : null}
        </div>
      );
    case "drawing_number":
      return formatOverviewDash(row.drawing_number ?? null);
    case "drawing_revision":
      return formatOverviewDash(row.drawing_revision ?? null);
    case "gpn":
      return (
        <div onClick={(e) => e.stopPropagation()}>
          {row.gpn && ctx.onOpenPortfolioItemId ? (
            <button
              type="button"
              className="erp-table-link"
              style={{ ...UI.tableLinkButtonReset, textDecoration: "none" }}
              onClick={async () => {
                if (row.portfolio_item_id != null) {
                  ctx.onOpenPortfolioItemId!(row.portfolio_item_id);
                  return;
                }
                const g = String(row.gpn ?? "").trim();
                if (!g) return;
                const variants = await listPortfolioItemsByGpn(g);
                if (variants.length === 1) {
                  ctx.onOpenPortfolioItemId!(variants[0].id);
                } else if (variants.length > 1) {
                  window.alert(
                    "U tohoto GPN existuje více logistických variant v portfoliu. Otevřete správnou variantu z modulu Portfolio, nebo použijte náhled VP s navázaným portfolio_item_id.",
                  );
                }
              }}
            >
              {row.gpn}
            </button>
          ) : (
            row.gpn ?? "—"
          )}
        </div>
      );
    case "description":
      return row.description ?? "—";
    case "quantity":
      return `${row.quantity} ks`;
    case "logistic":
      return labelLogisticMode(row.logistic_mode);
    case "source":
      return labelSourceTypeRow(row);
    case "status": {
      const label = formatProductionOrderOverviewOperationalStatus(row);
      return (
        <span className="erp-status-badge" style={productionOrderStatusBadgeStyle(label)}>
          {label}
        </span>
      );
    }
    case "reported":
      return formatOverviewReportedMinutes(row.reported_time_min);
    case "completion":
      return formatOverviewPercentAsShown(row.completion_percent);
    case "labor":
      return formatOverviewMoneyKc0(row.direct_labor_cost);
    case "performance":
      return formatOverviewPercentAsShown(row.performance_percent);
    case "zakazka":
      return (
        <div onClick={(e) => e.stopPropagation()}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
            <span style={{ fontWeight: 800 }}>{row.zakazka ?? "—"}</span>
          </div>
        </div>
      );
    case "customer_order_no":
      return row.customer_order_no?.trim() ? row.customer_order_no : "—";
    case "line_no":
      return row.line_no ?? "—";
    case "due":
      return row.due_date ?? "—";
    case "actions": {
      const items: TableRowActionItem[] = [
        {
          key: "print_vp",
          label: "Tisk VP",
          onClick: () => {
            void openProductionOrderPdfInNewTab(row.id).catch((err) =>
              window.alert(err instanceof Error ? err.message : String(err)),
            );
          },
        },
      ];
      if (row.portfolio_item_id != null && ctx.onPreviewPortfolioById) {
        items.push({
          key: "preview_portfolio",
          label: "Náhled portfolia",
          onClick: () => ctx.onPreviewPortfolioById!(row.portfolio_item_id!),
        });
      }
      if (row.customer_order_id != null && ctx.onOpenCustomerOrderCard) {
        items.push({
          key: "preview_order",
          label: "Náhled zakázky",
          onClick: () => ctx.onOpenCustomerOrderCard!(row.customer_order_id!),
        });
      }
      return (
        <TableRowActionsMenu
          compact
          align="end"
          triggerLabel={`Akce — ${row.vp_code ?? row.id}`}
          onOpenChange={(open) => ctx.setActionsMenuRowId(open ? row.id : null)}
          actions={items}
        />
      );
    }
    default:
      return "—";
  }
}

function formatNoticeFulfilledAt(iso: string | null): string {
  if (!iso || !String(iso).trim()) return "—";
  try {
    return new Date(iso).toLocaleString("cs-CZ", { dateStyle: "short", timeStyle: "short" });
  } catch {
    return iso;
  }
}

export default function ProductionOrdersPage({
  onOpenDetail,
  onOpenDetailInWorkspaceTab,
  onOpenPortfolioItemId,
  onOpenCustomerOrderCard,
  onPreviewPortfolioById,
}: Props) {
  const [rows, setRows] = useState<ProductionOrderOverviewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [workflowListFilter, setWorkflowListFilter] = useState<ErpWorkflowListFilter>("active");
  const [overviewOrderType, setOverviewOrderType] = useState<OrdersOverviewOrderTypeFilter>("all");
  const [activeQuickFilters, setActiveQuickFilters] = useState<ProductionQuickFilter[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [restockNotices, setRestockNotices] = useState<RestockWipReservationNotice[]>([]);
  const [hoveredProdRowId, setHoveredProdRowId] = useState<number | null>(null);
  const [prodActionsMenuRowId, setProdActionsMenuRowId] = useState<number | null>(null);

  const tb = usePersistedTableLayout("production_orders_table", PRODUCTION_ORDERS_TABLE_DEFAULTS);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      getProductionOrdersOverview(workflowListFilter),
      getRestockWipReservationNotices(20).catch(() => [] as RestockWipReservationNotice[]),
    ])
      .then(([data, notices]) => {
        if (!cancelled) {
          setRows(data);
          setRestockNotices(notices);
        }
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

  const textFilteredRows = useMemo(
    () => displayRows.filter((row) => matchesSearchQuery(searchQuery, productionOrderSearchHaystack(row))),
    [displayRows, searchQuery],
  );

  const sortedDisplayRows = useMemo(
    () =>
      sortRowsWithConfig(textFilteredRows, tb.sort, (row, key) => {
        switch (key) {
          case "vp":
            return row.vp_code ?? "";
          case "gpn":
            return row.gpn ?? "";
          case "drawing_number":
            return row.drawing_number ?? "";
          case "drawing_revision":
            return row.drawing_revision ?? "";
          case "description":
            return row.description ?? "";
          case "quantity":
            return row.quantity ?? 0;
          case "logistic":
            return row.logistic_mode ?? "";
          case "source":
            return row.source_type ?? "";
          case "status":
            return formatProductionOrderOverviewOperationalStatus(row);
          case "reported":
            return row.reported_time_min != null && Number.isFinite(Number(row.reported_time_min))
              ? Number(row.reported_time_min)
              : -1;
          case "completion":
            return row.completion_percent != null && Number.isFinite(Number(row.completion_percent))
              ? Number(row.completion_percent)
              : -1;
          case "labor":
            return row.direct_labor_cost != null && Number.isFinite(Number(row.direct_labor_cost))
              ? Number(row.direct_labor_cost)
              : -1;
          case "performance":
            return row.performance_percent != null && Number.isFinite(Number(row.performance_percent))
              ? Number(row.performance_percent)
              : -1;
          case "zakazka":
            return row.zakazka ?? "";
          case "customer_order_no":
            return row.customer_order_no ?? "";
          case "line_no":
            return row.line_no ?? -1;
          case "due":
            return row.due_date ?? "";
          default:
            return "";
        }
      }),
    [textFilteredRows, tb.sort],
  );

  // Klientská pagination nad již setříděným/filtrovaným polem.
  // Backend `/production-orders` podporuje server-side limit/offset/total, zde zatím
  // držíme plný dataset kvůli universal search + sortingu přes všechny řádky.
  const paginationResetKey = `${workflowListFilter}|${overviewOrderType}|${activeQuickFilters.join(",")}|${searchQuery}|${tb.sort?.columnKey ?? ""}|${tb.sort?.direction ?? ""}`;
  const {
    pagedRows: pagedDisplayRows,
    pageSize,
    setPageSize,
    offset,
    setOffset,
    total: pagedTotal,
  } = useClientPagination(sortedDisplayRows, { resetKey: paginationResetKey });

  const prodCtx: ProdCellCtx = {
    onOpenDetail,
    onOpenDetailInWorkspaceTab,
    onOpenPortfolioItemId,
    onOpenCustomerOrderCard,
    onPreviewPortfolioById,
    setActionsMenuRowId: setProdActionsMenuRowId,
  };

  const summaryTiles = useMemo(() => {
    const todayIso = new Date().toISOString().slice(0, 10);
    const poTerminu = displayRows.filter((r) => isVpRowOverdue(r, todayIso)).length;
    return [
      {
        label: "Celkem VP",
        value: String(rows.length),
        accent: UI.colors.primary,
        hint: "Všechny načtené VP podle filtru stavu zakázky.",
        kpiKind: "total" as const,
      },
      {
        label: "Zobrazeno",
        value: String(displayRows.length),
        accent: UI.colors.neutralFg,
        hint: "Po zapnutí typu přehledu (zákazník / interní).",
        kpiKind: "filtered" as const,
      },
      {
        label: "Po termínu",
        value: String(poTerminu),
        accent: UI.colors.problemFg,
        hint: "V aktuálně zobrazené množině (termin < dnes).",
        kpiKind: "overdue" as const,
      },
    ] as const;
  }, [rows.length, displayRows]);

  return (
    <PageContainer className="erp-overview-page" style={{ paddingTop: 10, background: UI.colors.pageBg, minHeight: "100%" }}>
      <PageHeader
        title="Výrobní příkazy"
        subtitle="Přehled všech VP napříč zákaznickými i interními zakázkami — stav, termíny a metriky v jedné tabulce."
      />

      <div style={{ ...UI.summaryTilesGridOuter, marginTop: 4 }}>
        <div style={UI.summaryTilesGridThree}>
          {summaryTiles.map((t) => {
            const kpiKind =
              t.kpiKind === "total" ? "primary" : t.kpiKind === "filtered" ? "neutral" : "danger";
            return (
            <div
              key={t.label}
              className="erp-kpi-tile"
              style={{
                ...UI.overviewKpiTile,
                borderLeftColor: t.accent,
                background: erpKpiTileBackground(kpiKind),
                boxShadow: `${UI.overviewKpiTile.boxShadow as string}, inset 0 1px 0 rgba(255, 255, 255, 0.9)`,
              }}
            >
              <div style={UI.overviewKpiLabel}>{t.label}</div>
              <div style={{ ...UI.overviewKpiValue, fontSize: 31, lineHeight: 1.05 }}>{t.value}</div>
              <div style={UI.overviewKpiHint}>{t.hint}</div>
            </div>
            );
          })}
        </div>
      </div>

      {restockNotices.length > 0 ? (
        <PageSection gapTop={12}>
          <div
            role="region"
            aria-label="Oznámení o příjmu rezervovaného výstupu ze skladového doplnění"
            style={{
              ...UI.card,
              borderRadius: 12,
              padding: 14,
              background: "#ecfdf5",
              border: "1px solid #6ee7b7",
              boxSizing: "border-box",
            }}
          >
            <div style={{ fontWeight: 800, color: "#065f46", marginBottom: 10, fontSize: 14 }}>
              Příjem rezervovaného výstupu — zákaznický VP (sklad) lze plánovat
            </div>
            <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 12 }}>
              {restockNotices.map((n) => (
                <li key={n.reservation_id} style={{ color: "#064e3b", fontSize: 13, lineHeight: 1.45 }}>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 12px", alignItems: "baseline" }}>
                    <span style={{ fontWeight: 700 }}>Zdroj (restock):</span>
                    <button
                      type="button"
                      onClick={() => {
                        if (onOpenDetailInWorkspaceTab) {
                          onOpenDetailInWorkspaceTab(n.source_production_order_id, n.source_vp_code ?? undefined);
                        } else {
                          onOpenDetail(n.source_production_order_id);
                        }
                      }}
                      style={linkButtonReset}
                    >
                      {n.source_vp_code ?? `VP #${n.source_production_order_id}`}
                    </button>
                    <span style={{ fontWeight: 700 }}>Zákazník (sklad):</span>
                    {n.customer_production_order_id != null ? (
                      <button
                        type="button"
                        onClick={() => {
                          if (onOpenDetailInWorkspaceTab) {
                            onOpenDetailInWorkspaceTab(
                              n.customer_production_order_id!,
                              n.customer_vp_code ?? undefined
                            );
                          } else {
                            onOpenDetail(n.customer_production_order_id!);
                          }
                        }}
                        style={linkButtonReset}
                      >
                        {n.customer_vp_code ?? `VP #${n.customer_production_order_id}`}
                      </button>
                    ) : (
                      <span>—</span>
                    )}
                    <span style={{ color: "#047857", whiteSpace: "nowrap" }}>
                      {formatNoticeFulfilledAt(n.fulfilled_at)}
                    </span>
                    {n.reserved_qty > 0 ? (
                      <span style={{ color: "#059669" }}>({n.reserved_qty} ks)</span>
                    ) : null}
                  </div>
                  <div style={{ marginTop: 4, color: "#065f46" }}>{n.user_message_cs}</div>
                </li>
              ))}
            </ul>
          </div>
        </PageSection>
      ) : null}

      <PageSection gapTop={16}>
        <div style={UI.overviewMainCard}>
          <div style={UI.overviewCardHeaderBand}>
            <OverviewPrimaryFilterRow
              leading={
                <OverviewSloupceButton onClick={() => tb.openPanel()} disabled={loading} />
              }
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
                          className="po-filter-chip"
                          disabled
                          title="Tento filtr zatím není napojen na data v přehledu VP."
                          style={{
                            ...UI.ordersFilterChip,
                            ...UI.ordersFilterChipDisabled,
                          }}
                        >
                          {filter}
                        </button>
                      );
                    }
                    const active = activeQuickFilters.includes(filter);
                    const activeStyle =
                      active && filter === "Po termínu"
                        ? UI.ordersFilterChipActiveWarn
                        : active && filter === "Dokončená"
                          ? UI.ordersFilterChipActiveOk
                          : active
                            ? UI.ordersFilterChipActive
                            : {};
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
                          ...activeStyle,
                        }}
                      >
                        {filter}
                      </button>
                    );
                  })}
                </>
              }
            />
            {!loading && rows.length > 0 ? (
              <div style={UI.overviewSecondaryFilterRow}>
                <div style={{ ...UI.ordersFilterSearchWrap, flex: "1 1 360px", minWidth: 240 }}>
                  <input
                    className="erp-overview-search"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onFocus={() => setSearchFocused(true)}
                    onBlur={() => setSearchFocused(false)}
                    placeholder="Hledat VP, GPN, název, výkres, revizi, zakázku, objednávku, logistiku…"
                    aria-label="Fulltextové hledání v přehledu výrobních příkazů"
                    style={{
                      ...UI.inputs.overviewSearch,
                      ...(searchFocused ? UI.inputs.overviewSearchFocus : {}),
                    }}
                  />
                </div>
              </div>
            ) : null}
          </div>
          <div style={UI.overviewCardBody}>
            {loading ? <div style={UI.overviewStateLoading}>Načítám výrobní příkazy…</div> : null}
            {!loading && error ? <div style={UI.overviewStateError}>{error}</div> : null}
            {!loading && !error && rows.length === 0 ? (
              <div style={UI.overviewEmptyInCard}>Žádné výrobní příkazy k zobrazení.</div>
            ) : null}
            {!loading && !error && rows.length > 0 ? (
              <>
                {tb.loadError ? <div style={UI.overviewStateWarn}>{tb.loadError}</div> : null}
                <div className="erp-table-wrap" style={UI.overviewTableWrap}>
                  <table style={UI.table}>
                    <thead>
                      <tr style={UI.overviewTableHeadRow}>
                        {tb.visibleColumns.map((col) => (
                          <th
                            key={col.key}
                            style={{
                              ...UI.th,
                              whiteSpace: "nowrap",
                              padding: `${tb.cellPaddingPx}px`,
                              width: col.width ?? undefined,
                              textAlign: NUMERIC_COLUMN_KEYS.has(col.key) ? "right" : "left",
                            }}
                          >
                            {col.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {pagedDisplayRows.map((row) => {
                        const rowHot = hoveredProdRowId === row.id || prodActionsMenuRowId === row.id;
                        return (
                        <tr
                          key={row.id}
                          onClick={() => {
                            if (onOpenDetailInWorkspaceTab) {
                              onOpenDetailInWorkspaceTab(row.id, row.vp_code ?? undefined);
                            } else {
                              onOpenDetail(row.id);
                            }
                          }}
                          onMouseEnter={() => setHoveredProdRowId(row.id)}
                          onMouseLeave={() => setHoveredProdRowId((id) => (id === row.id ? null : id))}
                          style={{
                            cursor: "pointer",
                            background: rowHot ? "#EFF6FF" : UI.colors.card,
                            boxShadow: rowHot ? `inset 3px 0 0 0 ${UI.colors.primary}` : "none",
                            transition: "background 120ms ease, box-shadow 120ms ease",
                          }}
                        >
                          {tb.visibleColumns.map((col) => (
                            <td
                              key={col.key}
                              style={{
                                ...UI.td,
                                padding: `${tb.cellPaddingPx}px`,
                                whiteSpace: "nowrap",
                                textAlign: NUMERIC_COLUMN_KEYS.has(col.key)
                                  ? "right"
                                  : col.key === "actions"
                                    ? "right"
                                    : "left",
                                fontVariantNumeric: NUMERIC_COLUMN_KEYS.has(col.key)
                                  ? ("tabular-nums" as const)
                                  : undefined,
                                fontWeight: col.key === "vp" ? 900 : undefined,
                                color: UI.colors.textPrimary,
                              }}
                            >
                              {renderProductionCell(col.key, row, prodCtx)}
                            </td>
                          ))}
                        </tr>
                      );
                      })}
                      {displayRows.length === 0 ? (
                        <tr>
                          <td
                            colSpan={Math.max(1, tb.visibleColumns.length)}
                            style={{
                              ...UI.td,
                              textAlign: "center",
                              color: UI.colors.textSecondary,
                              padding: "24px 12px",
                            }}
                          >
                            Žádné výsledky pro zvolené rychlé filtry.
                          </td>
                        </tr>
                      ) : textFilteredRows.length === 0 ? (
                        <tr>
                          <td
                            colSpan={Math.max(1, tb.visibleColumns.length)}
                            style={{
                              ...UI.td,
                              textAlign: "center",
                              color: UI.colors.textSecondary,
                              padding: "24px 12px",
                            }}
                          >
                            Žádné výsledky pro zadané hledání.
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
                <ErpPagination
                  pageSize={pageSize}
                  onPageSizeChange={setPageSize}
                  offset={offset}
                  onOffsetChange={setOffset}
                  total={pagedTotal}
                  currentCount={pagedDisplayRows.length}
                  disabled={loading}
                />
              </>
            ) : null}
          </div>
        </div>
        <TableLayoutModal
          open={tb.panelOpen}
          title="Sloupce — výrobní příkazy"
          columns={tb.columns}
          onColumnsChange={tb.setColumns}
          sort={tb.sort}
          onSortChange={tb.setSort}
          sortableKeys={tb.sortableKeys}
          columnLabels={PROD_COL_LABELS}
          density={tb.density}
          onDensityChange={tb.setDensity}
          onCancel={tb.closePanelCancel}
          onSave={() => void tb.savePanel()}
          onResetLocal={tb.resetLocalToDefaults}
          onResetAndSave={() => void tb.resetAndSave()}
          saving={tb.saving}
          errorMessage={tb.saveError}
        />
      </PageSection>
    </PageContainer>
  );
}
