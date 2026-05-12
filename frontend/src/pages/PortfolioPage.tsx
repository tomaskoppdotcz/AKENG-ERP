import React, { useEffect, useMemo, useState } from "react";
import PageContainer from "../components/layout/PageContainer";
import PageHeader from "../components/layout/PageHeader";
import PageSection from "../components/layout/PageSection";
import OverviewSloupceButton from "../components/overview/OverviewSloupceButton";
import TableLayoutModal from "../components/overview/TableLayoutModal";
import { usePersistedTableLayout } from "../hooks/usePersistedTableLayout";
import type { TableColumnDef } from "../overview/tableLayoutMerge";
import { sortRowsWithConfig } from "../overview/tableLayoutMerge";
import { erpKpiTileBackground, UI } from "../styles/ui";
import { getCustomers, type CustomerListItem } from "../services/masterLibrariesApi";
import {
  copyPortfolioItem,
  createPortfolioItem,
  deletePortfolioItem,
  getPortfolioGroups,
  getPortfolioItems,
  updatePortfolioItem,
  type PortfolioGroup,
  type PortfolioItem,
} from "../services/portfolioApi";
import { buildSearchHaystack, matchesSearchQuery, normalizeSearchText } from "../overview/overviewSearch";
import TableRowActionsMenu from "../components/table/TableRowActionsMenu";

type Props = {
  onBackToDashboard?: () => void;
  /** Klasický fullscreen detail (záložka má přednost při kliknutí na řádek). */
  onOpenItemDetail?: (item: PortfolioItem) => void;
  /** Klik na řádek otevře položku v pracovní záložce. */
  onOpenItemInWorkspaceTab?: (item: PortfolioItem) => void;
  /** Po načtení vyplní vyhledávání (např. z odkazu GPN z jiného modulu). */
  initialSearchQuery?: string | null;
  onConsumedInitialSearch?: () => void;
};

function dash(v: string | null | undefined): string {
  const t = (v ?? "").trim();
  return t ? t : "—";
}

function logisticLabel(mode: string | null | undefined): string {
  const m = (mode ?? "").trim();
  if (!m) return "—";
  if (m === "sklad") return "Sklad";
  if (m === "sklad_zakaznik") return "Sklad zákazník";
  return "Výroba zákazník";
}

function logisticBadgeStyle(mode: string | null | undefined): React.CSSProperties {
  const base = UI.statusBadgeBase;
  const m = (mode ?? "").trim();
  if (m === "sklad") return { ...base, ...UI.statusBadgeOk };
  if (m === "sklad_zakaznik") return { ...base, ...UI.statusBadgeRunning };
  if (m === "vyroba_zakaznik") return { ...base, ...UI.statusBadgeWait };
  return { ...base, ...UI.statusBadgeNeutral };
}

function tpBadgeStyle(hasTp: boolean): React.CSSProperties {
  const base = UI.statusBadgeBase;
  return hasTp ? { ...base, ...UI.statusBadgeOk } : { ...base, ...UI.statusBadgeProblem };
}

function activeBadgeStyle(active: boolean): React.CSSProperties {
  const base = UI.statusBadgeBase;
  return active ? { ...base, ...UI.statusBadgeOk } : { ...base, ...UI.statusBadgeNeutral };
}

function formatCzk(value: number | null | undefined): string {
  if (value == null) return "—";
  return `${new Intl.NumberFormat("cs-CZ", { maximumFractionDigits: 2, minimumFractionDigits: 0 }).format(value)}\u00a0Kč`;
}

const PORTFOLIO_TABLE_DEFAULTS: readonly TableColumnDef[] = [
  { key: "gpn", label: "GPN", defaultWidth: 130 },
  { key: "name", label: "Název", defaultWidth: 200 },
  { key: "drawing_number", label: "Výkres", defaultWidth: 130 },
  { key: "revision", label: "Revize", defaultWidth: 90 },
  { key: "customer", label: "Zákazník", defaultWidth: 160 },
  { key: "group", label: "Skupina", defaultWidth: 140 },
  { key: "material", label: "Materiál", defaultWidth: 120 },
  { key: "logistic", label: "Logistický režim", defaultWidth: 160 },
  { key: "sale_price", label: "Prodejní cena / ks", defaultWidth: 140 },
  { key: "tp", label: "TP", defaultWidth: 80 },
  { key: "status", label: "Stav", defaultWidth: 110 },
  { key: "actions", label: "Akce", defaultWidth: 56 },
] as const;

const PORTFOLIO_COL_LABELS: Record<string, string> = Object.fromEntries(
  PORTFOLIO_TABLE_DEFAULTS.map((c) => [c.key, c.label]),
);

const LOGISTIC_MODE_OPTIONS: Array<{ id: string; label: string }> = [
  { id: "all", label: "Vše" },
  { id: "vyroba_zakaznik", label: "Výroba zákazník" },
  { id: "sklad_zakaznik", label: "Sklad zákazník" },
  { id: "sklad", label: "Sklad" },
];

export default function PortfolioPage({
  onOpenItemDetail,
  onOpenItemInWorkspaceTab,
  initialSearchQuery,
  onConsumedInitialSearch,
}: Props) {
  const [items, setItems] = useState<PortfolioItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [customers, setCustomers] = useState<CustomerListItem[]>([]);
  const [customersLoading, setCustomersLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);

  const [customerFilterId, setCustomerFilterId] = useState<string>("all");
  const [groupFilterId, setGroupFilterId] = useState<string>("all");
  const [logisticFilter, setLogisticFilter] = useState<string>("all");
  const [activeOnly, setActiveOnly] = useState<boolean>(false);

  /** CRUD form state. */
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [copySourceId, setCopySourceId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [formGpn, setFormGpn] = useState("");
  const [formName, setFormName] = useState("");
  const [formCustomerId, setFormCustomerId] = useState("");
  const [formPortfolioGroupId, setFormPortfolioGroupId] = useState<number | null>(null);
  const [portfolioGroups, setPortfolioGroups] = useState<PortfolioGroup[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [formDrawingNo, setFormDrawingNo] = useState("");
  const [formRevision, setFormRevision] = useState("");
  const [formMaterialDefault, setFormMaterialDefault] = useState("");
  const [formLogisticMode, setFormLogisticMode] = useState("vyroba_zakaznik");
  const [formSalePrice, setFormSalePrice] = useState("");
  const [formActive, setFormActive] = useState(true);
  const [hoveredPortfolioRowId, setHoveredPortfolioRowId] = useState<number | null>(null);
  const [portfolioActionsMenuRowId, setPortfolioActionsMenuRowId] = useState<number | null>(null);

  const customerRows = Array.isArray(customers) ? customers : [];

  const tb = usePersistedTableLayout("portfolio_table", PORTFOLIO_TABLE_DEFAULTS);

  async function loadItems() {
    setLoading(true);
    setError(null);
    try {
      const rows = await getPortfolioItems();
      setItems(rows);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Nepodařilo se načíst portfolio.");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (cancelled) return;
      await loadItems();
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const q = initialSearchQuery?.trim();
    if (!q) return;
    setSearchQuery(q);
    onConsumedInitialSearch?.();
  }, [initialSearchQuery, onConsumedInitialSearch]);

  useEffect(() => {
    let cancelled = false;
    setCustomersLoading(true);
    getCustomers()
      .then((rows) => {
        if (!cancelled) setCustomers(rows);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setCustomers([]);
          setError(e instanceof Error ? e.message : "Nepodařilo se načíst zákazníky.");
        }
      })
      .finally(() => {
        if (!cancelled) setCustomersLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!showForm) return;
    const cid = Number(formCustomerId);
    if (!Number.isFinite(cid) || cid <= 0) {
      setPortfolioGroups([]);
      return;
    }
    let cancelled = false;
    setGroupsLoading(true);
    getPortfolioGroups(cid)
      .then((rows) => {
        if (!cancelled) setPortfolioGroups(rows);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setPortfolioGroups([]);
          setError(e instanceof Error ? e.message : "Nepodařilo se načíst skupiny.");
        }
      })
      .finally(() => {
        if (!cancelled) setGroupsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [showForm, formCustomerId]);

  useEffect(() => {
    if (formPortfolioGroupId == null) return;
    if (portfolioGroups.length === 0) return;
    if (!portfolioGroups.some((g) => g.id === formPortfolioGroupId)) {
      setFormPortfolioGroupId(null);
    }
  }, [portfolioGroups, formPortfolioGroupId]);

  function portfolioSearchHaystack(i: PortfolioItem): string {
    return buildSearchHaystack(
      i.gpn,
      i.scan_code,
      i.name,
      i.customer_id,
      i.customer_name,
      i.group_id,
      i.group_name,
      i.drawing_no,
      i.revision,
      i.material_default,
      i.logistic_mode,
      logisticLabel(i.logistic_mode),
      i.sale_price_per_piece != null ? String(i.sale_price_per_piece) : "",
      formatCzk(i.sale_price_per_piece),
      i.active_template_id,
    );
  }

  const customerOptions = useMemo(() => {
    const seen = new Map<number, string>();
    for (const i of items) {
      if (!seen.has(i.customer_id)) {
        seen.set(i.customer_id, (i.customer_name ?? `Zákazník #${i.customer_id}`).trim() || `Zákazník #${i.customer_id}`);
      }
    }
    return Array.from(seen.entries())
      .map(([id, name]) => ({ id: String(id), label: name }))
      .sort((a, b) => a.label.localeCompare(b.label, "cs"));
  }, [items]);

  const groupOptions = useMemo(() => {
    const seen = new Map<number, string>();
    for (const i of items) {
      if (i.group_id != null && !seen.has(i.group_id)) {
        seen.set(i.group_id, (i.group_name ?? `Skupina #${i.group_id}`).trim() || `Skupina #${i.group_id}`);
      }
    }
    return Array.from(seen.entries())
      .map(([id, name]) => ({ id: String(id), label: name }))
      .sort((a, b) => a.label.localeCompare(b.label, "cs"));
  }, [items]);

  const filteredRows = useMemo(() => {
    const q = searchQuery;
    const hasText = !!normalizeSearchText(q);
    return items.filter((i) => {
      if (customerFilterId !== "all" && String(i.customer_id) !== customerFilterId) return false;
      if (groupFilterId !== "all") {
        if (i.group_id == null) return false;
        if (String(i.group_id) !== groupFilterId) return false;
      }
      if (logisticFilter !== "all" && (i.logistic_mode ?? "").trim() !== logisticFilter) return false;
      if (activeOnly && i.is_active === false) return false;
      if (hasText && !matchesSearchQuery(q, portfolioSearchHaystack(i))) return false;
      return true;
    });
  }, [items, searchQuery, customerFilterId, groupFilterId, logisticFilter, activeOnly]);

  const sortedRows = useMemo(
    () =>
      sortRowsWithConfig(filteredRows, tb.sort, (row, key) => {
        switch (key) {
          case "gpn":
            return row.gpn ?? "";
          case "name":
            return row.name ?? "";
          case "drawing_number":
            return row.drawing_no ?? "";
          case "revision":
            return row.revision ?? "";
          case "customer":
            return row.customer_name ?? "";
          case "group":
            return row.group_name ?? "";
          case "material":
            return row.material_default ?? "";
          case "logistic":
            return logisticLabel(row.logistic_mode);
          case "sale_price":
            return row.sale_price_per_piece != null && Number.isFinite(Number(row.sale_price_per_piece))
              ? Number(row.sale_price_per_piece)
              : -1;
          case "tp":
            return row.active_template_id != null ? 1 : 0;
          case "status":
            return row.is_active === false ? 0 : 1;
          default:
            return "";
        }
      }),
    [filteredRows, tb.sort],
  );

  const kpi = useMemo(() => {
    const total = filteredRows.length;
    const active = filteredRows.filter((i) => i.is_active !== false).length;
    const bezTp = filteredRows.filter((i) => i.active_template_id == null).length;
    const naSklade = filteredRows.filter((i) => (i.logistic_mode ?? "").trim() === "sklad").length;
    return [
      {
        label: "Celkem položek",
        value: String(total),
        accent: UI.colors.primary,
        kind: "primary" as const,
        hint: "Počet položek v aktuálním filtru.",
      },
      {
        label: "Aktivní",
        value: String(active),
        accent: UI.colors.okFg,
        kind: "success" as const,
        hint: "Položky s příznakem Aktivní.",
      },
      {
        label: "Bez TP",
        value: String(bezTp),
        accent: UI.colors.problemFg,
        kind: "danger" as const,
        hint: "Položky bez aktivní technologie.",
      },
      {
        label: "Na skladě",
        value: String(naSklade),
        accent: UI.colors.neutralFg,
        kind: "neutral" as const,
        hint: "Položky v režimu Sklad.",
      },
    ] as const;
  }, [filteredRows]);

  const customerSelectHasCurrent = useMemo(() => {
    const id = Number(formCustomerId);
    if (!formCustomerId.trim() || !Number.isFinite(id) || id <= 0) return true;
    return customerRows.some((c) => c.id === id);
  }, [formCustomerId, customerRows]);

  const customerIdOptionsForForm = useMemo(
    () => Array.from(new Set(items.map((i) => i.customer_id))).sort((a, b) => a - b),
    [items],
  );

  function openCreateForm() {
    setEditingId(null);
    setCopySourceId(null);
    setFormGpn("");
    setFormName("");
    const firstMaster = customerRows.find((c) => c.is_active) ?? customerRows[0];
    setFormCustomerId(
      firstMaster != null
        ? String(firstMaster.id)
        : customerIdOptionsForForm[0] != null
          ? String(customerIdOptionsForForm[0])
          : "",
    );
    setFormPortfolioGroupId(null);
    setFormDrawingNo("");
    setFormRevision("");
    setFormMaterialDefault("");
    setFormLogisticMode("vyroba_zakaznik");
    setFormSalePrice("");
    setFormActive(true);
    setShowForm(true);
  }

  function openEditForm(item: PortfolioItem) {
    setEditingId(item.id);
    setCopySourceId(null);
    setFormGpn(item.gpn);
    setFormName(item.name);
    setFormCustomerId(String(item.customer_id));
    setFormPortfolioGroupId(item.portfolio_group_id ?? item.group_id ?? null);
    setFormDrawingNo(item.drawing_no ?? "");
    setFormRevision(item.revision ?? "");
    setFormMaterialDefault(item.material_default ?? "");
    setFormLogisticMode(item.logistic_mode ?? "vyroba_zakaznik");
    setFormSalePrice(item.sale_price_per_piece != null ? String(item.sale_price_per_piece) : "");
    setFormActive(item.is_active ?? true);
    setShowForm(true);
  }

  function openCopyForm(item: PortfolioItem) {
    setEditingId(null);
    setCopySourceId(item.id);
    const base = (item.gpn ?? "").trim();
    setFormGpn(base ? `${base}-KOP` : "");
    setFormName(item.name);
    setFormCustomerId(String(item.customer_id));
    setFormPortfolioGroupId(item.portfolio_group_id ?? item.group_id ?? null);
    setFormDrawingNo(item.drawing_no ?? "");
    setFormRevision(item.revision ?? "");
    setFormMaterialDefault(item.material_default ?? "");
    setFormLogisticMode(item.logistic_mode ?? "vyroba_zakaznik");
    setFormSalePrice(item.sale_price_per_piece != null ? String(item.sale_price_per_piece) : "");
    setFormActive(item.is_active ?? true);
    setError(null);
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setEditingId(null);
    setCopySourceId(null);
  }

  async function handleSave() {
    const gpn = formGpn.trim();
    const name = formName.trim();
    const customerId = Number(formCustomerId);
    if (!gpn) return setError("Vyplňte GPN.");
    if (!name) return setError("Vyplňte název.");
    if (!formCustomerId.trim() || !Number.isFinite(customerId) || customerId <= 0) {
      return setError("Vyberte zákazníka.");
    }
    const priceRaw = formSalePrice.trim().replace(/\s/g, "").replace(",", ".");
    let sale_price_per_piece: number | null = null;
    if (priceRaw !== "") {
      const n = Number(priceRaw);
      if (!Number.isFinite(n)) return setError("Neplatná prodejní cena.");
      sale_price_per_piece = n;
    }
    const payload = {
      gpn,
      name,
      customer_id: customerId,
      portfolio_group_id: formPortfolioGroupId,
      drawing_no: formDrawingNo.trim() || null,
      revision: formRevision.trim() || null,
      material_default: formMaterialDefault.trim() || null,
      logistic_mode: formLogisticMode,
      sale_price_per_piece,
      is_active: formActive,
    };
    setSaving(true);
    setError(null);
    try {
      if (copySourceId != null) {
        await copyPortfolioItem(copySourceId, payload);
      } else if (editingId == null) {
        await createPortfolioItem(payload);
      } else {
        await updatePortfolioItem(editingId, payload);
      }
      await loadItems();
      closeForm();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Uložení se nezdařilo.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: number) {
    if (!window.confirm("Opravdu chcete smazat tuto portfolio položku?")) return;
    setError(null);
    try {
      await deletePortfolioItem(id);
      await loadItems();
      if (editingId === id || copySourceId === id) closeForm();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Smazání se nezdařilo.");
    }
  }

  function openItem(item: PortfolioItem) {
    if (onOpenItemInWorkspaceTab) onOpenItemInWorkspaceTab(item);
    else onOpenItemDetail?.(item);
  }

  function renderCell(key: string, row: PortfolioItem): React.ReactNode {
    switch (key) {
      case "gpn":
        return (
          <span onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="erp-table-link"
              style={{ ...UI.tableLinkButtonReset, fontWeight: 900, textDecoration: "none" }}
              onClick={() => openItem(row)}
            >
              {dash(row.gpn)}
            </button>
          </span>
        );
      case "name":
        return dash(row.name);
      case "drawing_number":
        return dash(row.drawing_no);
      case "revision":
        return dash(row.revision);
      case "customer":
        return dash(row.customer_name);
      case "group":
        return dash(row.group_name);
      case "material":
        return dash(row.material_default);
      case "logistic":
        return (
          <span className="erp-status-badge" style={logisticBadgeStyle(row.logistic_mode)}>
            {logisticLabel(row.logistic_mode)}
          </span>
        );
      case "sale_price":
        return formatCzk(row.sale_price_per_piece);
      case "tp": {
        const hasTp = row.active_template_id != null;
        return (
          <span className="erp-status-badge" style={tpBadgeStyle(hasTp)}>
            {hasTp ? "ANO" : "NE"}
          </span>
        );
      }
      case "status": {
        const active = row.is_active !== false;
        return (
          <span className="erp-status-badge" style={activeBadgeStyle(active)}>
            {active ? "Aktivní" : "Neaktivní"}
          </span>
        );
      }
      case "actions":
        return (
          <TableRowActionsMenu
            align="end"
            compact
            triggerLabel={`Akce — ${row.gpn ?? row.id}`}
            onOpenChange={(open) => setPortfolioActionsMenuRowId(open ? row.id : null)}
            actions={[
              {
                key: "edit",
                label: "Upravit",
                onClick: () => openEditForm(row),
              },
              {
                key: "copy",
                label: "Kopírovat",
                onClick: () => openCopyForm(row),
              },
              {
                key: "delete",
                label: "Smazat",
                danger: true,
                onClick: () => void handleDelete(row.id),
              },
            ]}
          />
        );
      default:
        return "—";
    }
  }

  const hasAnyFilter =
    customerFilterId !== "all" ||
    groupFilterId !== "all" ||
    logisticFilter !== "all" ||
    activeOnly ||
    normalizeSearchText(searchQuery).length > 0;

  return (
    <PageContainer className="erp-overview-page" style={{ paddingTop: 10, background: UI.colors.pageBg, minHeight: "100%" }}>
      <PageHeader
        title="Portfolio výrobků"
        subtitle="Přehled portfolia napříč zákazníky — GPN, výkresy, revize, logistický režim a stav technologie."
        actions={
          <>
            <button
              type="button"
              style={UI.buttons.primary}
              onClick={openCreateForm}
              disabled={customersLoading || customerRows.length === 0}
            >
              Nová položka
            </button>
          </>
        }
      />

      <div style={{ ...UI.summaryTilesGridOuter, marginTop: 4 }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
            gap: 12,
            alignItems: "stretch",
            minWidth: 720,
            width: "100%",
            boxSizing: "border-box",
          }}
        >
          {kpi.map((t) => (
            <div
              key={t.label}
              className="erp-kpi-tile"
              style={{
                ...UI.overviewKpiTile,
                borderLeftColor: t.accent,
                background: erpKpiTileBackground(t.kind),
                boxShadow: `${UI.overviewKpiTile.boxShadow as string}, inset 0 1px 0 rgba(255, 255, 255, 0.9)`,
              }}
            >
              <div style={UI.overviewKpiLabel}>{t.label}</div>
              <div style={{ ...UI.overviewKpiValue, fontSize: 31, lineHeight: 1.05 }}>{t.value}</div>
              <div style={UI.overviewKpiHint}>{t.hint}</div>
            </div>
          ))}
        </div>
      </div>

      {showForm ? (
        <PageSection gapTop={12}>
          <div
            style={{
              ...UI.card,
              borderRadius: 14,
              padding: 16,
              background: "#f8fafc",
              border: "1px solid #e2e8f0",
              width: "100%",
              boxSizing: "border-box",
            }}
          >
            <div style={{ ...UI.sectionTitle, fontSize: 16, marginBottom: copySourceId != null ? 6 : 10 }}>
              {copySourceId != null
                ? "Kopie portfolio položky"
                : editingId == null
                  ? "Nová portfolio položka"
                  : "Upravit portfolio položku"}
            </div>
            {copySourceId != null ? (
              <div style={{ fontSize: 13, color: "#64748b", marginBottom: 10, fontWeight: 600 }}>
                Zdroj: {items.find((i) => i.id === copySourceId)?.gpn ?? `#${copySourceId}`}
              </div>
            ) : null}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
              <div>
                <div style={UI.inputs.label}>GPN</div>
                <input value={formGpn} onChange={(e) => setFormGpn(e.target.value)} style={UI.inputs.base} />
              </div>
              <div>
                <div style={UI.inputs.label}>Název</div>
                <input value={formName} onChange={(e) => setFormName(e.target.value)} style={UI.inputs.base} />
              </div>
              <div>
                <div style={UI.inputs.label}>Zákazník</div>
                <select
                  value={formCustomerId}
                  onChange={(e) => setFormCustomerId(e.target.value)}
                  style={UI.inputs.base}
                  disabled={customersLoading || customerRows.length === 0}
                >
                  {customersLoading ? (
                    <option value="">Načítám…</option>
                  ) : customerRows.length === 0 ? (
                    <option value="">Žádný zákazník</option>
                  ) : (
                    <>
                      <option value="">Vyberte zákazníka</option>
                      {!customerSelectHasCurrent && formCustomerId.trim() ? (
                        <option value={formCustomerId}>Zákazník #{formCustomerId}</option>
                      ) : null}
                      {customerRows.map((c) => (
                        <option key={c.id} value={String(c.id)}>
                          {c.name}
                          {!c.is_active ? " (neaktivní)" : ""}
                        </option>
                      ))}
                    </>
                  )}
                </select>
              </div>
              <div>
                <div style={UI.inputs.label}>Skupina</div>
                <select
                  value={formPortfolioGroupId == null ? "" : String(formPortfolioGroupId)}
                  onChange={(e) => {
                    const v = e.target.value;
                    setFormPortfolioGroupId(v === "" ? null : Number(v));
                  }}
                  style={UI.inputs.base}
                  disabled={
                    groupsLoading ||
                    !formCustomerId.trim() ||
                    !Number.isFinite(Number(formCustomerId)) ||
                    Number(formCustomerId) <= 0
                  }
                >
                  <option value="">Bez skupiny</option>
                  {portfolioGroups.map((g) => (
                    <option key={g.id} value={String(g.id)}>
                      {g.code ? `${g.name} (${g.code})` : g.name}
                    </option>
                  ))}
                </select>
                {groupsLoading ? (
                  <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>Načítám skupiny…</div>
                ) : null}
              </div>
              <div>
                <div style={UI.inputs.label}>Výkres</div>
                <input value={formDrawingNo} onChange={(e) => setFormDrawingNo(e.target.value)} style={UI.inputs.base} />
              </div>
              <div>
                <div style={UI.inputs.label}>Revize</div>
                <input value={formRevision} onChange={(e) => setFormRevision(e.target.value)} style={UI.inputs.base} />
              </div>
              <div>
                <div style={UI.inputs.label}>Materiál</div>
                <input
                  value={formMaterialDefault}
                  onChange={(e) => setFormMaterialDefault(e.target.value)}
                  style={UI.inputs.base}
                />
              </div>
              <div>
                <div style={UI.inputs.label}>Logistický režim</div>
                <select value={formLogisticMode} onChange={(e) => setFormLogisticMode(e.target.value)} style={UI.inputs.base}>
                  <option value="vyroba_zakaznik">Výroba zákazník</option>
                  <option value="sklad_zakaznik">Sklad zákazník</option>
                  <option value="sklad">Sklad</option>
                </select>
              </div>
              <div>
                <div style={UI.inputs.label}>Prodejní cena / ks (bez DPH)</div>
                <input
                  type="number"
                  inputMode="decimal"
                  step="any"
                  value={formSalePrice}
                  onChange={(e) => setFormSalePrice(e.target.value)}
                  style={UI.inputs.base}
                  placeholder="—"
                />
              </div>
              <div style={{ display: "flex", alignItems: "center", paddingTop: 20 }}>
                <label style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 700 }}>
                  <input type="checkbox" checked={formActive} onChange={(e) => setFormActive(e.target.checked)} />
                  Aktivní
                </label>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button
                type="button"
                style={{ ...UI.buttons.primary, ...(saving ? { opacity: 0.7, cursor: "wait" } : {}) }}
                onClick={handleSave}
                disabled={saving}
              >
                {saving
                  ? "Ukládám..."
                  : copySourceId != null
                    ? "Uložit kopii"
                    : editingId == null
                      ? "Uložit položku"
                      : "Uložit změny"}
              </button>
              <button type="button" style={UI.buttons.secondary} onClick={closeForm} disabled={saving}>
                Zrušit
              </button>
            </div>
          </div>
        </PageSection>
      ) : null}

      <PageSection gapTop={16}>
        <div style={UI.overviewMainCard}>
          <div style={UI.overviewCardHeaderBand}>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                gap: 10,
                marginBottom: 0,
              }}
            >
              <OverviewSloupceButton onClick={() => tb.openPanel()} disabled={loading} />

              <span style={{ fontSize: 13, fontWeight: 800, color: UI.colors.tableHeadText, marginLeft: 6 }}>
                Zákazník:
              </span>
              <select
                value={customerFilterId}
                onChange={(e) => {
                  setCustomerFilterId(e.target.value);
                  setGroupFilterId("all");
                }}
                style={{ ...UI.inputs.base, minWidth: 180, maxWidth: 240 }}
                disabled={loading}
              >
                <option value="all">Vše</option>
                {customerOptions.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>

              <span style={{ fontSize: 13, fontWeight: 800, color: UI.colors.tableHeadText }}>Skupina:</span>
              <select
                value={groupFilterId}
                onChange={(e) => setGroupFilterId(e.target.value)}
                style={{ ...UI.inputs.base, minWidth: 160, maxWidth: 220 }}
                disabled={loading || groupOptions.length === 0}
              >
                <option value="all">Vše</option>
                {groupOptions.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>

              <span style={{ fontSize: 13, fontWeight: 800, color: UI.colors.tableHeadText }}>Logistický režim:</span>
              {LOGISTIC_MODE_OPTIONS.map((o) => {
                const active = logisticFilter === o.id;
                return (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => setLogisticFilter(o.id)}
                    disabled={loading}
                    style={{ ...UI.ordersFilterChip, ...(active ? UI.ordersFilterChipActive : {}) }}
                  >
                    {o.label}
                  </button>
                );
              })}

              <button
                type="button"
                onClick={() => setActiveOnly((v) => !v)}
                disabled={loading}
                style={{ ...UI.ordersFilterChip, ...(activeOnly ? UI.ordersFilterChipActiveOk : {}) }}
                title="Skrýt neaktivní položky"
              >
                Jen aktivní
              </button>

              {hasAnyFilter ? (
                <button
                  type="button"
                  onClick={() => {
                    setCustomerFilterId("all");
                    setGroupFilterId("all");
                    setLogisticFilter("all");
                    setActiveOnly(false);
                    setSearchQuery("");
                  }}
                  style={{ ...UI.buttons.secondary, padding: "6px 12px", fontSize: 12 }}
                >
                  Vynulovat filtry
                </button>
              ) : null}
            </div>

            {!loading && items.length > 0 ? (
              <div style={UI.overviewSecondaryFilterRow}>
                <div style={{ ...UI.ordersFilterSearchWrap, flex: "1 1 360px", minWidth: 240 }}>
                  <input
                    className="erp-overview-search"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onFocus={() => setSearchFocused(true)}
                    onBlur={() => setSearchFocused(false)}
                    placeholder="Hledat GPN, název, výkres, revizi, zákazníka, materiál…"
                    aria-label="Fulltextové hledání v portfoliu"
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
            {loading ? <div style={UI.overviewStateLoading}>Načítám portfolio…</div> : null}
            {!loading && error ? <div style={UI.overviewStateError}>{error}</div> : null}
            {!loading && !error && items.length === 0 ? (
              <div style={UI.overviewEmptyInCard}>
                Portfolio je zatím prázdné. Po vytvoření reálných položek se zde zobrazí seznam.
              </div>
            ) : null}

            {!loading && !error && items.length > 0 ? (
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
                              textAlign:
                                col.key === "sale_price" ? "right" : col.key === "actions" ? "right" : "left",
                            }}
                          >
                            {col.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {sortedRows.map((row) => {
                        const rowHot =
                          hoveredPortfolioRowId === row.id || portfolioActionsMenuRowId === row.id;
                        return (
                        <tr
                          key={row.id}
                          role="button"
                          tabIndex={0}
                          onClick={() => openItem(row)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              openItem(row);
                            }
                          }}
                          onMouseEnter={() => setHoveredPortfolioRowId(row.id)}
                          onMouseLeave={() =>
                            setHoveredPortfolioRowId((id) => (id === row.id ? null : id))
                          }
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
                                whiteSpace: col.key === "name" ? "normal" : "nowrap",
                                textAlign:
                                  col.key === "sale_price"
                                    ? "right"
                                    : col.key === "actions"
                                      ? "right"
                                      : "left",
                                fontVariantNumeric: col.key === "sale_price" ? ("tabular-nums" as const) : undefined,
                                fontWeight: col.key === "gpn" ? 900 : undefined,
                                color: UI.colors.textPrimary,
                              }}
                            >
                              {renderCell(col.key, row)}
                            </td>
                          ))}
                        </tr>
                      );
                      })}
                      {filteredRows.length === 0 ? (
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
                            Žádné výsledky pro zvolené filtry nebo hledání.
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </>
            ) : null}
          </div>
        </div>

        <TableLayoutModal
          open={tb.panelOpen}
          title="Sloupce — portfolio"
          columns={tb.columns}
          onColumnsChange={tb.setColumns}
          sort={tb.sort}
          onSortChange={tb.setSort}
          sortableKeys={tb.sortableKeys}
          columnLabels={PORTFOLIO_COL_LABELS}
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
