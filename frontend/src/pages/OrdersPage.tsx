import React, { useCallback, useEffect, useMemo, useState } from "react";
import { UI } from "../styles/ui";
import { getCustomers, type CustomerListItem } from "../services/masterLibrariesApi";
import {
  createCustomerOrder,
  getOrdersOverview,
  type ErpWorkflowListFilter,
  type OrdersOverviewOrderTypeFilter,
  type OrdersOverviewRow,
} from "../services/ordersApi";

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

const TABLE_COLUMNS = [
  "Zakázka",
  "Zákazník",
  "Objednávka",
  "Datum",
  "Výkresy",
  "Prodejní cena",
  "Celkový náklad",
  "Vykázaný čas",
  "Výroba výkonnost",
  "Hotovo",
] as const;

const ORDER_FILTERS = ["Po termínu", "Dokončená", "Dodací list", "Fakturováno"] as const;
type OrderFilter = (typeof ORDER_FILTERS)[number];

const OVERVIEW_ORDER_TYPE_OPTIONS: { id: OrdersOverviewOrderTypeFilter; label: string }[] = [
  { id: "customer", label: "Zákaznické" },
  { id: "internal", label: "Interní" },
  { id: "all", label: "Vše" },
];

const OVERVIEW_WORKFLOW_OPTIONS: { id: ErpWorkflowListFilter; label: string }[] = [
  { id: "active", label: "Aktivní" },
  { id: "cancelled", label: "Stornované" },
  { id: "all", label: "Vše" },
];

function formatSearchValue(v: string) {
  return v.trim().toLowerCase();
}

function formatMoneyKc(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return `${n.toLocaleString("cs-CZ", { maximumFractionDigits: 0 })} Kč`;
}

/** Součet z portfolia (shodně s kartou zakázky). */
function formatProdejniCenaOverview(n: number | null | undefined): string {
  const v = n == null || Number.isNaN(n) ? 0 : n;
  return `${v.toLocaleString("cs-CZ", { maximumFractionDigits: 2, minimumFractionDigits: 0 })} Kč`;
}

function formatHours(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return `${n.toLocaleString("cs-CZ", { maximumFractionDigits: 1 })} h`;
}

function formatPercent(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return `${Math.round(n)} %`;
}

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
  const [formCustomerId, setFormCustomerId] = useState("");
  const [formCustomerPoNo, setFormCustomerPoNo] = useState("");
  const [formOrderDate, setFormOrderDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [formShipDate, setFormShipDate] = useState("");
  const [formNote, setFormNote] = useState("");
  const [overviewOrderType, setOverviewOrderType] = useState<OrdersOverviewOrderTypeFilter>("customer");
  const [overviewWorkflowFilter, setOverviewWorkflowFilter] = useState<ErpWorkflowListFilter>("active");

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
      { label: "Celkem objednávky", value: count ? formatProdejniCenaOverview(sumSales) : "—" },
      { label: "Počet zakázek", value: count ? String(count) : "—" },
      { label: "Nedodělané zakázky", value: count ? String(nedodelane) : "—" },
      { label: "Celkem hodin", value: count ? formatHours(celkemZbyvaHodin) : "—" },
      { label: "Po termínu", value: count ? String(poTerminu) : "—" },
      { label: "K expedici", value: "—" },
    ] as const;
  }, [rows]);

  const filtered = useMemo(() => {
    const q = formatSearchValue(query);
    return rows.filter((row) => {
      const haystack = [row.zakazka, row.zakaznik ?? "", row.objednavka ?? ""].join(" ").toLowerCase();
      const matchesQuery = !q || haystack.includes(q);

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

  const activeSubtabLabel = ZAKAZKY_MODULE_SUBTABS.find((t) => t.id === activeSubtab)?.label ?? "Přehled";

  function openCreateForm() {
    setShowCreateForm(true);
    setCreateError(null);
    const firstActive = customers.find((c) => c.is_active) ?? customers[0];
    setFormCustomerId(firstActive ? String(firstActive.id) : "");
    setFormCustomerPoNo("");
    setFormOrderDate(new Date().toISOString().slice(0, 10));
    setFormShipDate("");
    setFormNote("");
  }

  async function handleCreateOrder() {
    const customerId = Number(formCustomerId);
    const poNo = formCustomerPoNo.trim();
    if (!Number.isFinite(customerId) || customerId <= 0) {
      setCreateError("Vyberte zákazníka.");
      return;
    }
    if (!poNo) {
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
        customer_id: customerId,
        customer_po_no: poNo,
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
    <div style={{ paddingTop: 10 }}>
      <div style={UI.pageHeaderRow}>
        <div>
          <div style={UI.sectionTitle}>Zakázky</div>
          <div style={UI.sectionSubtitle}>Přehled zakázek</div>
        </div>

        <div style={UI.pageHeaderActions}>
          <button type="button" style={UI.buttons.secondary} onClick={() => _props.onBackToDashboard?.()}>
            Zpět na nástěnku
          </button>
          <button
            type="button"
            style={UI.buttons.primary}
            onClick={openCreateForm}
            disabled={customersLoading || customers.length === 0}
          >
            Nová zakázka
          </button>
          <button type="button" style={UI.buttons.secondary} onClick={() => {}}>
            Import objednávky
          </button>
        </div>
      </div>

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

      <div style={{ marginTop: 16, ...UI.card, padding: 16, borderRadius: 14 }}>
        {showCreateForm ? (
          <div style={{ ...UI.card, padding: 12, marginBottom: 12, background: "#f8fafc", border: "1px solid #e2e8f0" }}>
            <div style={{ ...UI.sectionTitle, fontSize: 16, marginBottom: 10 }}>Nová zakázka</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
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
              <div>
                <div style={UI.inputs.label}>Číslo objednávky zákazníka</div>
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
        ) : null}

        {activeSubtab === "prehled" ? (
          <>
            {loadError ? (
              <div style={{ color: "#b91c1c", fontWeight: 700, marginBottom: 12 }}>{loadError}</div>
            ) : null}
            {loading ? <div style={{ ...UI.sectionSubtitle, marginBottom: 12 }}>Načítám zakázky…</div> : null}

            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, marginBottom: 12 }}>
              <span style={{ fontSize: 13, fontWeight: 800, color: "#475569" }}>Typ přehledu:</span>
              {OVERVIEW_ORDER_TYPE_OPTIONS.map(({ id, label }) => {
                const active = overviewOrderType === id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setOverviewOrderType(id)}
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
              <span style={{ fontSize: 13, fontWeight: 800, color: "#475569", marginLeft: 8 }}>Stav zakázky:</span>
              {OVERVIEW_WORKFLOW_OPTIONS.map(({ id, label }) => {
                const active = overviewWorkflowFilter === id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setOverviewWorkflowFilter(id)}
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

            {!loading && !loadError && rows.length === 0 ? (
              <div
                style={{
                  textAlign: "center",
                  color: "#64748b",
                  fontWeight: 700,
                  padding: "28px 12px",
                  background: "#f8fafc",
                  borderRadius: 12,
                  border: "1px solid #e2e8f0",
                }}
              >
                Žádné zakázky k zobrazení. Po načtení reálných dat z backendu se zde objeví přehled.
              </div>
            ) : null}

            {!loading && rows.length > 0 ? (
              <>
                <div style={UI.ordersFilterBar}>
                  <div style={UI.ordersFilterSearchWrap}>
                    <input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Hledat zakázku, zákazníka nebo objednávku..."
                      style={UI.inputs.base}
                    />
                  </div>
                  <div style={UI.ordersFilterChips}>
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
                  </div>
                </div>

                <div style={{ overflowX: "auto" }}>
                  <table style={UI.table}>
                    <thead>
                      <tr style={{ background: "#f8fafc" }}>
                        {TABLE_COLUMNS.map((col) => (
                          <th key={col} style={{ ...UI.th, fontSize: 13, padding: "10px 10px", whiteSpace: "nowrap" }}>
                            {col}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((row) => {
                        const rowKey = `${row.job_id}-${row.zakazka}`;
                        const isHovered = hoveredKey === rowKey;
                        const openable = row.customer_order_id != null;
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
                            <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>
                              {openable && row.customer_order_id != null ? (
                                <button
                                  type="button"
                                  style={orderCodeLink}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    _props.onOpenOrderInWorkspaceTab(row.customer_order_id!, row.zakazka ?? undefined);
                                  }}
                                >
                                  {row.zakazka}
                                </button>
                              ) : (
                                <span style={{ fontWeight: 1000, color: "#0f172a" }}>{row.zakazka}</span>
                              )}
                              {String(row.workflow_status ?? "").trim().toLowerCase() === "cancelled" ? (
                                <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 800, color: "#991b1b" }}>
                                  Storno
                                </span>
                              ) : null}
                            </td>
                            <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>{row.zakaznik ?? "—"}</td>
                            <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>{row.objednavka ?? "—"}</td>
                            <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>{row.datum ?? "—"}</td>
                            <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>{row.vykresy}</td>
                            <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap", fontWeight: 900, color: "#0f172a" }}>
                              {formatProdejniCenaOverview(row.prodejni_cena)}
                            </td>
                            <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap", fontWeight: 900, color: "#0f172a" }}>
                              {formatMoneyKc(row.naklad)}
                            </td>
                            <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>{formatHours(row.vykazany_cas)}</td>
                            <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>{formatPercent(row.vykonnost)}</td>
                            <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap", fontWeight: 1000, color: "#2563eb" }}>
                              {formatPercent(row.hotovo)}
                            </td>
                          </tr>
                        );
                      })}
                      {filtered.length === 0 && rows.length > 0 ? (
                        <tr>
                          <td
                            colSpan={TABLE_COLUMNS.length}
                            style={{ ...UI.td, textAlign: "center", color: "#64748b", padding: "14px 10px" }}
                          >
                            Žádné výsledky.
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </>
            ) : null}
          </>
        ) : (
          <div style={{ ...UI.sectionTitle, fontSize: 16, marginBottom: 0, fontWeight: 900 }}>
            {`Modul ${activeSubtabLabel} pro zakázky je ve vývoji.`}
          </div>
        )}
      </div>
    </div>
  );
}
