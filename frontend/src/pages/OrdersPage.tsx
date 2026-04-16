import React, { useCallback, useEffect, useMemo, useState } from "react";
import PageContainer from "../components/layout/PageContainer";
import PageHeader from "../components/layout/PageHeader";
import PageSection from "../components/layout/PageSection";
import { UI } from "../styles/ui";
import { getCustomers, type CustomerListItem } from "../services/masterLibrariesApi";
import {
  createCustomerOrder,
  getOrdersOverview,
  type ErpWorkflowListFilter,
  type OrdersOverviewOrderTypeFilter,
  type OrdersOverviewRow,
} from "../services/ordersApi";
import OverviewPrimaryFilterRow from "../components/overview/OverviewPrimaryFilterRow";
import OverviewSloupceButton from "../components/overview/OverviewSloupceButton";
import TableLayoutModal from "../components/overview/TableLayoutModal";
import { usePersistedTableLayout } from "../hooks/usePersistedTableLayout";
import type { TableColumnDef } from "../overview/tableLayoutMerge";
import { sortRowsWithConfig } from "../overview/tableLayoutMerge";
import { OVERVIEW_ORDER_TYPE_OPTIONS, OVERVIEW_WORKFLOW_OPTIONS } from "../overview/overviewFilterConfig";
import {
  formatOverviewCurrency,
  formatOverviewDecimalHours,
  formatOverviewHoursFromMinutes,
  formatOverviewMoneyKc0,
  formatOverviewPercentInteger,
} from "../overview/overviewMetricsFormat";
import { buildSearchHaystack, matchesSearchQuery } from "../overview/overviewSearch";

const orderCodeLink: React.CSSProperties = {
  background: "none",
  border: "none",
  padding: 0,
  margin: 0,
  cursor: "pointer",
  font: "inherit",
  fontWeight: 1000,
  color: "#0f172a",
  textDecoration: "underline",
  textUnderlineOffset: "3px",
};

type Props = {
  /** Klik na řádek / kód zakázky otevře kartu v pracovní záložce. */
  onOpenOrderInWorkspaceTab: (customerOrderId: number, titleHint?: string) => void;
  onBackToDashboard?: () => void;
};

const ORDERS_TABLE_DEFAULTS: readonly TableColumnDef[] = [
  { key: "zakazka", label: "Zakázka", defaultWidth: 160 },
  { key: "zakaznik", label: "Zákazník", defaultWidth: 160 },
  { key: "objednavka", label: "Objednávka", defaultWidth: 140 },
  { key: "datum", label: "Datum", defaultWidth: 120 },
  { key: "vykresy", label: "Výkresy", defaultWidth: 90 },
  { key: "prodejni_cena", label: "Prodejní cena", defaultWidth: 130 },
  { key: "naklad", label: "Celkový náklad", defaultWidth: 120 },
  { key: "reported_time", label: "Vykázaný čas", defaultWidth: 120 },
  { key: "completion", label: "Hotovo", defaultWidth: 90 },
  { key: "labor", label: "Náklad práce", defaultWidth: 120 },
  { key: "performance", label: "Výkonnost", defaultWidth: 100 },
] as const;

const ORDERS_COL_LABELS: Record<string, string> = Object.fromEntries(ORDERS_TABLE_DEFAULTS.map((c) => [c.key, c.label]));

type OrdersCellCtx = { onOpenOrderInWorkspaceTab: (customerOrderId: number, titleHint?: string) => void };

function renderOrdersCell(
  key: string,
  row: OrdersOverviewRow,
  ctx: OrdersCellCtx,
  linkStyle: React.CSSProperties,
): React.ReactNode {
  const openable = row.customer_order_id != null;
  switch (key) {
    case "zakazka":
      return (
        <>
          {openable && row.customer_order_id != null ? (
            <button
              type="button"
              style={linkStyle}
              onClick={(e) => {
                e.stopPropagation();
                ctx.onOpenOrderInWorkspaceTab(row.customer_order_id!, row.zakazka ?? undefined);
              }}
            >
              {row.zakazka}
            </button>
          ) : (
            <span style={{ fontWeight: 1000, color: "#0f172a" }}>{row.zakazka}</span>
          )}
          {String(row.workflow_status ?? "").trim().toLowerCase() === "cancelled" ? (
            <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 800, color: "#991b1b" }}>Storno</span>
          ) : null}
        </>
      );
    case "zakaznik":
      return row.zakaznik ?? "—";
    case "objednavka":
      return row.objednavka ?? "—";
    case "datum":
      return row.datum ?? "—";
    case "vykresy":
      return row.vykresy;
    case "prodejni_cena":
      return formatOverviewCurrency(row.prodejni_cena);
    case "naklad":
      return formatOverviewMoneyKc0(row.naklad);
    case "reported_time":
      return formatOverviewHoursFromMinutes(
        row.reported_time_min != null && Number.isFinite(Number(row.reported_time_min))
          ? Number(row.reported_time_min)
          : null,
      );
    case "completion":
      return (
        <span style={{ fontWeight: 1000, color: "#2563eb" }}>
          {formatOverviewPercentInteger(
            row.completion_percent != null && Number.isFinite(Number(row.completion_percent))
              ? Number(row.completion_percent)
              : null,
          )}
        </span>
      );
    case "labor":
      return formatOverviewMoneyKc0(
        row.direct_labor_cost != null && Number.isFinite(Number(row.direct_labor_cost)) ? Number(row.direct_labor_cost) : null,
      );
    case "performance":
      return formatOverviewPercentInteger(
        row.performance_percent != null && Number.isFinite(Number(row.performance_percent))
          ? Number(row.performance_percent)
          : null,
      );
    default:
      return "—";
  }
}

const ORDER_FILTERS = ["Po termínu", "Dokončená", "Dodací list", "Fakturováno"] as const;
type OrderFilter = (typeof ORDER_FILTERS)[number];

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

const ZAKAZKY_MODULE_SUBTABS = [
  { id: "prehled" as const, label: "Přehled" },
  { id: "dokumenty" as const, label: "Dokumenty" },
  { id: "historie" as const, label: "Historie" },
  { id: "vykazy" as const, label: "Výkazy" },
  { id: "neshody" as const, label: "Neshody" },
  { id: "zmetky" as const, label: "Zmetky" },
  { id: "reklamace" as const, label: "Reklamace" },
  { id: "kooperace" as const, label: "Kooperace" },
  { id: "pozadavky_material" as const, label: "Požadavky materiál" },
  { id: "poptavky" as const, label: "Poptávky" },
  { id: "objednavky" as const, label: "Objednávky" },
  { id: "dodaci_listy" as const, label: "Dodací listy" },
  { id: "expedice" as const, label: "Expedice" },
  { id: "naklady" as const, label: "Náklady" },
] as const;

export default function OrdersPage(_props: Props) {
  const [query, setQuery] = useState("");
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const [activeSubtab, setActiveSubtab] = useState("prehled");
  const [hoverSubtab, setHoverSubtab] = useState<string | null>(null);
  const [activeFilters, setActiveFilters] = useState<OrderFilter[]>([]);
  const [rows, setRows] = useState<OrdersOverviewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [customers, setCustomers] = useState<CustomerListItem[]>([]);
  const [customersLoading, setCustomersLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [formOrderType, setFormOrderType] = useState<"customer" | "internal">("customer");
  const [formCustomerId, setFormCustomerId] = useState("");
  const [formCustomerPoNo, setFormCustomerPoNo] = useState("");
  const [formOrderDate, setFormOrderDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [formShipDate, setFormShipDate] = useState("");
  const [formNote, setFormNote] = useState("");
  const [overviewOrderType, setOverviewOrderType] = useState<OrdersOverviewOrderTypeFilter>("customer");
  const [overviewWorkflowFilter, setOverviewWorkflowFilter] = useState<ErpWorkflowListFilter>("active");

  const tb = usePersistedTableLayout("orders_table", ORDERS_TABLE_DEFAULTS);

  const loadOverview = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await getOrdersOverview(overviewOrderType, overviewWorkflowFilter);
      setRows(data);
    } catch (e: unknown) {
      setLoadError(e instanceof Error ? e.message : "Nepodařilo se načíst zakázky.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [overviewOrderType, overviewWorkflowFilter]);

  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  useEffect(() => {
    let cancelled = false;
    setCustomersLoading(true);
    getCustomers()
      .then((rows) => {
        if (!cancelled) setCustomers(rows);
      })
      .catch(() => {
        if (!cancelled) setCustomers([]);
      })
      .finally(() => {
        if (!cancelled) setCustomersLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const summaryTiles = useMemo(() => {
    const count = rows.length;
    const sumSales = rows.reduce((s, r) => s + (Number(r.prodejni_cena) || 0), 0);
    const remainingByOrder = (r: OrdersOverviewRow) => Number(r.zbyvajici_hodiny ?? 0);
    const hasRemaining = (r: OrdersOverviewRow) => remainingByOrder(r) > 0.0001;
    const nedodelane = rows.filter((r) => hasRemaining(r)).length;
    const celkemZbyvaHodin = rows.reduce((s, r) => s + Math.max(remainingByOrder(r), 0), 0);
    const poTerminu = rows.filter((r) => {
      if (!hasRemaining(r)) return false;
      if (!r.termin) return false;
      const t = new Date(r.termin);
      return !Number.isNaN(t.getTime()) && t < startOfToday();
    }).length;
    return [
      { label: "Celkem objednávky", value: count ? formatOverviewCurrency(sumSales) : "—" },
      { label: "Počet zakázek", value: count ? String(count) : "—" },
      { label: "Nedodělané zakázky", value: count ? String(nedodelane) : "—" },
      { label: "Celkem hodin", value: count ? formatOverviewDecimalHours(celkemZbyvaHodin) : "—" },
      { label: "Po termínu", value: count ? String(poTerminu) : "—" },
      { label: "K expedici", value: "—" },
    ] as const;
  }, [rows]);

  const filtered = useMemo(() => {
    return rows.filter((row) => {
      const hay = buildSearchHaystack(
        row.zakazka,
        row.zakaznik,
        row.objednavka,
        row.overview_search_corpus,
      );
      const matchesQuery = matchesSearchQuery(query, hay);

      const hotovoNum = Number(row.hotovo) || 0;
      const matchesFilters = activeFilters.every((f) => {
        if (f === "Po termínu") {
          if (!row.termin) return false;
          const t = new Date(row.termin);
          return !Number.isNaN(t.getTime()) && t < startOfToday();
        }
        if (f === "Dokončená") return hotovoNum >= 100;
        if (f === "Dodací list") return true;
        if (f === "Fakturováno") return true;
        return true;
      });

      return matchesQuery && matchesFilters;
    });
  }, [rows, query, activeFilters]);

  const sortedFiltered = useMemo(
    () =>
      sortRowsWithConfig(filtered, tb.sort, (row, key) => {
        switch (key) {
          case "zakazka":
            return row.zakazka ?? "";
          case "zakaznik":
            return row.zakaznik ?? "";
          case "objednavka":
            return row.objednavka ?? "";
          case "datum":
            return row.datum ?? "";
          case "vykresy":
            return row.vykresy;
          case "prodejni_cena":
            return row.prodejni_cena;
          case "naklad":
            return row.naklad;
          case "reported_time":
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
          default:
            return "";
        }
      }),
    [filtered, tb.sort],
  );

  const activeSubtabLabel = ZAKAZKY_MODULE_SUBTABS.find((t) => t.id === activeSubtab)?.label ?? "Přehled";

  function openCreateForm() {
    setShowCreateForm(true);
    setCreateError(null);
    setFormOrderType("customer");
    const firstActive = customers.find((c) => c.is_active) ?? customers[0];
    setFormCustomerId(firstActive ? String(firstActive.id) : "");
    setFormCustomerPoNo("");
    setFormOrderDate(new Date().toISOString().slice(0, 10));
    setFormShipDate("");
    setFormNote("");
  }

  async function handleCreateOrder() {
    const orderType = formOrderType;
    const customerId = Number(formCustomerId);
    const poNo = formCustomerPoNo.trim();
    if (orderType === "customer" && (!Number.isFinite(customerId) || customerId <= 0)) {
      setCreateError("Vyberte zákazníka.");
      return;
    }
    if (orderType === "customer" && !poNo) {
      setCreateError("Vyplňte číslo objednávky zákazníka.");
      return;
    }
    if (!formOrderDate.trim()) {
      setCreateError("Vyplňte datum objednávky.");
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      const created = await createCustomerOrder({
        customer_id: orderType === "customer" ? customerId : null,
        customer_po_no: poNo,
        order_type: orderType,
        order_date: formOrderDate,
        requested_ship_date: formShipDate.trim() || null,
        note: formNote.trim() || null,
      });
      await loadOverview();
      setShowCreateForm(false);
      _props.onOpenOrderInWorkspaceTab(created.customer_order_id);
    } catch (e: unknown) {
      setCreateError(e instanceof Error ? e.message : "Nepodařilo se vytvořit zakázku.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <PageContainer style={{ paddingTop: 10 }}>
      <PageHeader
        title="Zakázky"
        subtitle="Přehled zakázek"
        actions={
          <>
            <button type="button" style={UI.buttons.secondary} onClick={() => _props.onBackToDashboard?.()}>
              Zpět na nástěnku
            </button>
            <button
              type="button"
              style={UI.buttons.primary}
              onClick={openCreateForm}
            >
              Nová zakázka
            </button>
            <button type="button" style={UI.buttons.secondary} onClick={() => {}}>
              Import objednávky
            </button>
          </>
        }
      />

      <div style={UI.summaryTilesGridOuter}>
        <div style={UI.summaryTilesGridSix}>
          {summaryTiles.map((tile) => (
            <div key={tile.label} style={UI.summaryTile}>
              <div style={UI.summaryTileLabel}>{tile.label}</div>
              <div style={UI.summaryTileValue}>{tile.value}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={UI.subTabsContainer}>
        {ZAKAZKY_MODULE_SUBTABS.map(({ id, label }) => {
          const active = id === activeSubtab;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setActiveSubtab(id)}
              onMouseEnter={() => setHoverSubtab(id)}
              onMouseLeave={() => setHoverSubtab((h) => (h === id ? null : h))}
              style={{
                ...UI.subTab,
                ...(active ? UI.subTabActive : {}),
                ...(!active && hoverSubtab === id ? UI.subTabHover : {}),
              }}
            >
              {label}
            </button>
          );
        })}
      </div>

      {showCreateForm ? (
        <PageSection gapTop={16}>
          <div style={{ ...UI.card, padding: 12, background: "#f8fafc", border: "1px solid #e2e8f0" }}>
            <div style={{ ...UI.sectionTitle, fontSize: 16, marginBottom: 10 }}>Nová zakázka</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
              <div>
                <div style={UI.inputs.label}>Typ zakázky</div>
                <select value={formOrderType} onChange={(e) => setFormOrderType(e.target.value as "customer" | "internal")} style={UI.inputs.base}>
                  <option value="customer">Zákaznická</option>
                  <option value="internal">Interní</option>
                </select>
              </div>
              {formOrderType === "customer" ? (
                <div>
                <div style={UI.inputs.label}>Zákazník</div>
                <select
                  value={formCustomerId}
                  onChange={(e) => setFormCustomerId(e.target.value)}
                  style={UI.inputs.base}
                  disabled={customersLoading || customers.length === 0}
                >
                  <option value="">Vyberte zákazníka</option>
                  {customers.map((c) => (
                    <option key={c.id} value={String(c.id)}>
                      {c.name}
                    </option>
                  ))}
                </select>
                </div>
              ) : null}
              <div>
                <div style={UI.inputs.label}>{formOrderType === "customer" ? "Číslo objednávky zákazníka" : "Interní reference (volitelné)"}</div>
                <input value={formCustomerPoNo} onChange={(e) => setFormCustomerPoNo(e.target.value)} style={UI.inputs.base} />
              </div>
              <div>
                <div style={UI.inputs.label}>Datum objednávky</div>
                <input type="date" value={formOrderDate} onChange={(e) => setFormOrderDate(e.target.value)} style={UI.inputs.base} />
              </div>
              <div>
                <div style={UI.inputs.label}>Termín expedice</div>
                <input type="date" value={formShipDate} onChange={(e) => setFormShipDate(e.target.value)} style={UI.inputs.base} />
              </div>
              <div style={{ gridColumn: "1 / -1" }}>
                <div style={UI.inputs.label}>Poznámka</div>
                <input value={formNote} onChange={(e) => setFormNote(e.target.value)} style={UI.inputs.base} />
              </div>
            </div>
            {createError ? <div style={{ color: "#b91c1c", fontWeight: 700, marginTop: 8 }}>{createError}</div> : null}
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button type="button" style={UI.buttons.primary} onClick={handleCreateOrder} disabled={creating}>
                {creating ? "Ukládám..." : "Vytvořit zakázku"}
              </button>
              <button type="button" style={UI.buttons.secondary} onClick={() => setShowCreateForm(false)} disabled={creating}>
                Zrušit
              </button>
            </div>
          </div>
        </PageSection>
      ) : null}

      {activeSubtab === "prehled" ? (
        <PageSection gapTop={16}>
          <div style={UI.overviewMainCard}>
            <div style={UI.overviewCardHeaderBand}>
              <OverviewPrimaryFilterRow
                leading={<OverviewSloupceButton onClick={() => tb.openPanel()} disabled={loading} />}
                loading={loading}
                typPrehleduOptions={OVERVIEW_ORDER_TYPE_OPTIONS}
                typPrehleduActiveId={overviewOrderType}
                onTypPrehledu={(id) => setOverviewOrderType(id as OrdersOverviewOrderTypeFilter)}
                stavZakazkyOptions={OVERVIEW_WORKFLOW_OPTIONS}
                stavZakazkyActiveId={overviewWorkflowFilter}
                onStavZakazky={(id) => setOverviewWorkflowFilter(id as ErpWorkflowListFilter)}
                rowStyle={{ marginBottom: !loading && rows.length > 0 ? 12 : 0 }}
                trailing={
                  <>
                    {!loading && rows.length > 0 ? (
                      <>
                      {ORDER_FILTERS.map((filter) => {
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
                    ) : null}
                  </>
                }
              />
              {!loading && rows.length > 0 ? (
                <div style={UI.overviewSecondaryFilterRow}>
                  <div style={{ ...UI.ordersFilterSearchWrap, flex: "1 1 280px", minWidth: 200 }}>
                    <input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Hledat zakázku, objednávku, zákazníka, GPN, název, výkres, revizi, VP…"
                      style={UI.inputs.base}
                    />
                  </div>
                </div>
              ) : null}
            </div>

            <div style={UI.overviewCardBody}>
              {loadError ? <div style={{ ...UI.overviewStateError, padding: "0 0 12px" }}>{loadError}</div> : null}
              {tb.loadError ? <div style={UI.overviewStateWarn}>{tb.loadError}</div> : null}
              {loading ? <div style={{ ...UI.overviewStateLoading, padding: "0 0 12px" }}>Načítám zakázky…</div> : null}

              {!loading && !loadError && rows.length === 0 ? (
                <div style={UI.overviewEmptyInCard}>
                  Žádné zakázky k zobrazení. Po načtení reálných dat z backendu se zde objeví přehled.
                </div>
              ) : null}

              {!loading && rows.length > 0 ? (
                <div style={UI.overviewTableWrap}>
                  <table style={UI.table}>
                    <thead>
                      <tr style={UI.overviewTableHeadRow}>
                        {tb.visibleColumns.map((col) => (
                          <th
                            key={col.key}
                            style={{
                              ...UI.th,
                              fontSize: 13,
                              padding: `${tb.cellPaddingPx}px`,
                              whiteSpace: "nowrap",
                              width: col.width ?? undefined,
                            }}
                          >
                            {col.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {sortedFiltered.map((row) => {
                        const rowKey = `${row.job_id}-${row.zakazka}`;
                        const isHovered = hoveredKey === rowKey;
                        const openable = row.customer_order_id != null;
                        const ctx: OrdersCellCtx = { onOpenOrderInWorkspaceTab: _props.onOpenOrderInWorkspaceTab };
                        return (
                          <tr
                            key={rowKey}
                            onClick={() => {
                              if (openable && row.customer_order_id != null) {
                                _props.onOpenOrderInWorkspaceTab(row.customer_order_id, row.zakazka ?? undefined);
                              }
                            }}
                            onMouseEnter={() => setHoveredKey(rowKey)}
                            onMouseLeave={() => setHoveredKey(null)}
                            style={{
                              cursor: openable ? "pointer" : "default",
                              background: isHovered && openable ? "#eff6ff" : "#fff",
                              opacity: openable ? 1 : 0.85,
                            }}
                          >
                            {tb.visibleColumns.map((col) => (
                              <td
                                key={col.key}
                                style={{
                                  ...UI.td,
                                  padding: `${tb.cellPaddingPx}px`,
                                  whiteSpace: "nowrap",
                                  fontWeight: col.key === "prodejni_cena" || col.key === "naklad" ? 900 : undefined,
                                  color:
                                    col.key === "prodejni_cena" || col.key === "naklad" ? "#0f172a" : undefined,
                                }}
                              >
                                {renderOrdersCell(col.key, row, ctx, orderCodeLink)}
                              </td>
                            ))}
                          </tr>
                        );
                      })}
                      {filtered.length === 0 && rows.length > 0 ? (
                        <tr>
                          <td
                            colSpan={Math.max(1, tb.visibleColumns.length)}
                            style={{ ...UI.td, textAlign: "center", color: "#64748b", padding: "14px 10px" }}
                          >
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
          <TableLayoutModal
            open={tb.panelOpen}
            title="Sloupce — zakázky"
            columns={tb.columns}
            onColumnsChange={tb.setColumns}
            sort={tb.sort}
            onSortChange={tb.setSort}
            sortableKeys={tb.sortableKeys}
            columnLabels={ORDERS_COL_LABELS}
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
      ) : (
        <PageSection gapTop={16}>
          <div
            style={{
              ...UI.card,
              padding: 16,
              borderRadius: 14,
              width: "100%",
              boxSizing: "border-box",
            }}
          >
            <div style={{ ...UI.sectionTitle, fontSize: 16, marginBottom: 0, fontWeight: 900 }}>
              {`Modul ${activeSubtabLabel} pro zakázky je ve vývoji.`}
            </div>
          </div>
        </PageSection>
      )}
    </PageContainer>
  );
}
