import React, { useCallback, useEffect, useMemo, useState } from "react";
import SimpleModal from "../components/SimpleModal";
import PageContainer from "../components/layout/PageContainer";
import PageHeader from "../components/layout/PageHeader";
import PageSection from "../components/layout/PageSection";
import { UI } from "../styles/ui";
import { getPortfolioItems, type PortfolioItem } from "../services/portfolioApi";
import { getStorageLocations, type StorageLocation } from "../services/storageLocationApi";
import {
  createProductStockItem,
  deleteProductStockItem,
  getProductStockItems,
  issueProductFromStock,
  updateProductStockItem,
  type ProductStockItem,
} from "../services/productStockApi";
import TableLayoutModal from "../components/overview/TableLayoutModal";
import OverviewSloupceButton from "../components/overview/OverviewSloupceButton";
import { usePersistedTableLayout } from "../hooks/usePersistedTableLayout";
import type { TableColumnDef } from "../overview/tableLayoutMerge";
import { sortRowsWithConfig } from "../overview/tableLayoutMerge";
import { formatOverviewQtyWithUnit } from "../overview/overviewMetricsFormat";
import { buildSearchHaystack, matchesSearchQuery } from "../overview/overviewSearch";

type Props = {
  /** Klik na řádek — otevře detail v pracovní záložce. */
  onOpenStockInWorkspaceTab: (item: ProductStockItem) => void;
};

function dashScan(v: string | null | undefined): string {
  const t = (v ?? "").trim();
  return t ? t : "—";
}

const PRODUCT_STOCK_TABLE_DEFAULTS: readonly TableColumnDef[] = [
  { key: "scan_code", label: "Scan kód", defaultWidth: 120 },
  { key: "gpn", label: "GPN", defaultWidth: 120 },
  { key: "name", label: "Název", defaultWidth: 200 },
  { key: "location", label: "Lokace", defaultWidth: 160 },
  { key: "qty", label: "Stav (ks)", defaultWidth: 120 },
  { key: "min_qty", label: "Min. zásoba (ks)", defaultWidth: 130 },
  { key: "unit", label: "Jednotka", defaultWidth: 90 },
  { key: "actions", label: "Akce", defaultWidth: 280 },
] as const;

const STOCK_COL_LABELS: Record<string, string> = Object.fromEntries(PRODUCT_STOCK_TABLE_DEFAULTS.map((c) => [c.key, c.label]));

export default function ProductStockPage({ onOpenStockInWorkspaceTab }: Props) {
  const [rows, setRows] = useState<ProductStockItem[]>([]);
  const [portfolioItems, setPortfolioItems] = useState<PortfolioItem[]>([]);
  const [locations, setLocations] = useState<StorageLocation[]>([]);
  const [query, setQuery] = useState("");
  const [customerFilter, setCustomerFilter] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [portfolioItemId, setPortfolioItemId] = useState<number | null>(null);
  const [location, setLocation] = useState("");
  const [currentQty, setCurrentQty] = useState("0");
  const [minQty, setMinQty] = useState("");
  const [unit, setUnit] = useState("ks");
  const [note, setNote] = useState("");
  const [isActive, setIsActive] = useState(true);

  const [issueRow, setIssueRow] = useState<ProductStockItem | null>(null);
  const [issueQty, setIssueQty] = useState("");
  const [issueJobItemId, setIssueJobItemId] = useState("");
  const [issueCustomerOrderId, setIssueCustomerOrderId] = useState("");
  const [issueBusy, setIssueBusy] = useState(false);
  const [issueError, setIssueError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [stock, portfolio, allLocations] = await Promise.all([
        getProductStockItems(),
        getPortfolioItems(),
        getStorageLocations(),
      ]);
      setRows(stock);
      setPortfolioItems(portfolio);
      setLocations(allLocations.filter((x) => x.location_type === "product" || x.location_type === "both"));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Nepodařilo se načíst sklad výrobků.");
      setRows([]);
      setPortfolioItems([]);
      setLocations([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData().catch(() => {});
  }, [loadData]);

  async function submitIssue() {
    if (!issueRow) return;
    const q = Number(String(issueQty).replace(",", "."));
    if (!Number.isFinite(q) || q <= 0) {
      setIssueError("Zadejte platné množství větší než 0.");
      return;
    }
    if (q > issueRow.current_qty + 1e-9) {
      setIssueError("Množství je větší než stav na skladě.");
      return;
    }
    const ji = issueJobItemId.trim();
    const co = issueCustomerOrderId.trim();
    const jobItemId = ji === "" ? null : Number(ji);
    const customerOrderId = co === "" ? null : Number(co);
    if (ji !== "" && !Number.isFinite(jobItemId)) {
      setIssueError("ID položky zakázky musí být číslo.");
      return;
    }
    if (co !== "" && !Number.isFinite(customerOrderId)) {
      setIssueError("ID zakázky musí být číslo.");
      return;
    }
    setIssueBusy(true);
    setIssueError(null);
    try {
      await issueProductFromStock({
        product_stock_item_id: issueRow.id,
        qty: q,
        job_item_id: jobItemId,
        customer_order_id: customerOrderId,
      });
      setIssueRow(null);
      await loadData();
    } catch (e: unknown) {
      setIssueError(e instanceof Error ? e.message : "Výdej se nepodařil.");
    } finally {
      setIssueBusy(false);
    }
  }

  const customerOptions = useMemo(() => {
    const names = new Set<string>();
    for (const r of rows) {
      const n = r.portfolio_customer_name?.trim();
      if (n) names.add(n);
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b, "cs"));
  }, [rows]);

  const portfolioItemsForStock = useMemo(
    () => portfolioItems.filter((p) => p.logistic_mode === "sklad_zakaznik"),
    [portfolioItems]
  );

  const portfolioSelectOptions = useMemo(() => {
    if (portfolioItemId == null) return portfolioItemsForStock;
    if (portfolioItemsForStock.some((p) => p.id === portfolioItemId)) return portfolioItemsForStock;
    const current = portfolioItems.find((p) => p.id === portfolioItemId);
    return current ? [current, ...portfolioItemsForStock] : portfolioItemsForStock;
  }, [portfolioItemsForStock, portfolioItems, portfolioItemId]);

  const filtered = useMemo(() => {
    const locationByCode = new Map(locations.map((l) => [l.code, l.name]));
    return rows.filter((r) => {
      const locationName = r.location ? locationByCode.get(r.location) ?? "" : "";
      const hay = buildSearchHaystack(
        r.portfolio_gpn,
        r.portfolio_name,
        r.drawing_number,
        r.drawing_revision,
        r.location,
        locationName,
        r.scan_code,
        r.unit,
      );
      const matchesText = matchesSearchQuery(query, hay);
      const cust = r.portfolio_customer_name?.trim() ?? "";
      const matchesCustomer = !customerFilter || cust === customerFilter;
      return matchesText && matchesCustomer;
    });
  }, [rows, query, customerFilter, locations]);

  const tb = usePersistedTableLayout("product_stock_table", PRODUCT_STOCK_TABLE_DEFAULTS);

  const stockSummary = useMemo(() => {
    const sumQty = filtered.reduce((s, r) => s + (Number.isFinite(r.current_qty) ? r.current_qty : 0), 0);
    return [
      { label: "Položek ve skladu", value: String(rows.length) },
      { label: "Po filtru", value: String(filtered.length) },
      { label: "Součet stavu (ks)", value: sumQty.toLocaleString("cs-CZ", { maximumFractionDigits: 0 }) },
    ] as const;
  }, [rows.length, filtered]);

  const sortedFiltered = useMemo(
    () =>
      sortRowsWithConfig(filtered, tb.sort, (row, key) => {
        switch (key) {
          case "scan_code":
            return row.scan_code ?? "";
          case "gpn":
            return row.portfolio_gpn;
          case "name":
            return row.portfolio_name;
          case "location":
            return row.location ?? "";
          case "qty":
            return row.current_qty;
          case "min_qty":
            return row.min_qty ?? -1;
          case "unit":
            return row.unit ?? "";
          case "actions":
            return row.id;
          default:
            return "";
        }
      }),
    [filtered, tb.sort],
  );

  function parseOptionalNumber(value: string): number | null {
    const t = value.trim().replace(",", ".");
    if (!t) return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }

  function resetForm() {
    setEditingId(null);
    setPortfolioItemId(null);
    setLocation("");
    setCurrentQty("0");
    setMinQty("");
    setUnit("ks");
    setNote("");
    setIsActive(true);
    setFormError(null);
    setShowForm(false);
  }

  async function handleSave() {
    if (portfolioItemId == null) {
      setFormError("Vyberte portfolio položku.");
      return;
    }
    const parsedCurrent = parseOptionalNumber(currentQty);
    const parsedMin = parseOptionalNumber(minQty);
    if (parsedCurrent == null) {
      setFormError("Aktuální stav musí být platné číslo.");
      return;
    }
    if (minQty.trim() && parsedMin == null) {
      setFormError("Min. zásoba musí být platné číslo.");
      return;
    }

    setSaving(true);
    setFormError(null);
    try {
      const payloadBase = {
        location: location.trim() || null,
        current_qty: parsedCurrent,
        min_qty: parsedMin,
        unit: unit.trim() || "ks",
        note: note.trim() || null,
        is_active: isActive,
      };
      if (editingId == null) {
        await createProductStockItem({
          portfolio_item_id: portfolioItemId,
          ...payloadBase,
        });
      } else {
        await updateProductStockItem(editingId, payloadBase);
      }
      await loadData();
      resetForm();
    } catch (e: unknown) {
      setFormError(e instanceof Error ? e.message : "Uložení se nezdařilo.");
    } finally {
      setSaving(false);
    }
  }

  function openEdit(row: ProductStockItem) {
    setEditingId(row.id);
    setPortfolioItemId(row.portfolio_item_id);
    setLocation(row.location ?? "");
    setCurrentQty(String(row.current_qty));
    setMinQty(row.min_qty == null ? "" : String(row.min_qty));
    setUnit(row.unit ?? "ks");
    setNote(row.note ?? "");
    setIsActive(row.is_active);
    setFormError(null);
    setShowForm(true);
  }

  async function handleDelete(row: ProductStockItem) {
    if (!window.confirm("Opravdu chcete smazat tuto skladovou kartu?")) return;
    setError(null);
    try {
      await deleteProductStockItem(row.id);
      await loadData();
      if (editingId === row.id) resetForm();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Smazání se nezdařilo.");
    }
  }

  const unitLabel = "ks";

  function renderStockCell(key: string, row: ProductStockItem): React.ReactNode {
    switch (key) {
      case "scan_code":
        return dashScan(row.scan_code);
      case "gpn":
        return row.portfolio_gpn;
      case "name":
        return row.portfolio_name;
      case "location":
        return row.location?.trim()
          ? (() => {
              const loc = locations.find((x) => x.code === row.location);
              return loc ? `${loc.code} — ${loc.name}` : row.location;
            })()
          : "—";
      case "qty":
        return formatOverviewQtyWithUnit(row.current_qty, row.unit ?? unitLabel);
      case "min_qty":
        return row.min_qty == null ? "—" : formatOverviewQtyWithUnit(row.min_qty, row.unit ?? unitLabel);
      case "unit":
        return row.unit?.trim() ? row.unit : "—";
      case "actions":
        return (
          <span onClick={(e) => e.stopPropagation()} style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button
              type="button"
              style={UI.buttons.primary}
              onClick={(e) => {
                e.stopPropagation();
                setIssueRow(row);
                setIssueQty(row.current_qty > 0 ? String(row.current_qty) : "1");
                setIssueJobItemId("");
                setIssueCustomerOrderId("");
                setIssueError(null);
              }}
            >
              Vydat výrobek
            </button>
            <button
              type="button"
              style={UI.buttons.secondary}
              onClick={(e) => {
                e.stopPropagation();
                openEdit(row);
              }}
            >
              Upravit
            </button>
            <button
              type="button"
              style={UI.buttons.secondary}
              onClick={(e) => {
                e.stopPropagation();
                void handleDelete(row);
              }}
            >
              Smazat
            </button>
          </span>
        );
      default:
        return "—";
    }
  }

  return (
    <>
      <PageContainer style={{ paddingTop: 10 }}>
        <PageHeader
          title="Sklad výrobků"
          subtitle="Přehled hotových výrobků (portfolio)"
          actions={
            <button
              type="button"
              style={UI.buttons.primary}
              onClick={() => {
                resetForm();
                setShowForm(true);
              }}
              disabled={portfolioItemsForStock.length === 0}
            >
              Nová skladová karta
            </button>
          }
        />

        <div style={UI.summaryTilesGridOuter}>
          <div style={UI.summaryTilesGridThree}>
            {stockSummary.map((t) => (
              <div key={t.label} style={UI.summaryTile}>
                <div style={UI.summaryTileLabel}>{t.label}</div>
                <div style={UI.summaryTileValue}>{t.value}</div>
              </div>
            ))}
          </div>
        </div>

        <PageSection gapTop={16}>
          <div style={UI.overviewMainCard}>
          {showForm ? (
            <div
              style={{
                ...UI.card,
                padding: 12,
                margin: 16,
                marginBottom: 0,
                background: "#f8fafc",
                border: "1px solid #e2e8f0",
              }}
            >
              <div style={{ ...UI.sectionTitle, fontSize: 16, marginBottom: 10 }}>
                {editingId == null ? "Nová skladová karta" : "Upravit skladovou kartu"}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
                <div>
                  <div style={UI.inputs.label}>Portfolio položka</div>
                  <select
                    value={portfolioItemId == null ? "" : String(portfolioItemId)}
                    onChange={(e) => setPortfolioItemId(e.target.value === "" ? null : Number(e.target.value))}
                    style={UI.inputs.base}
                    disabled={editingId != null || portfolioItemsForStock.length === 0}
                  >
                    <option value="">Vyberte položku</option>
                    {portfolioSelectOptions.map((p) => (
                      <option key={p.id} value={String(p.id)}>
                        {p.gpn} — {p.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <div style={UI.inputs.label}>Lokace</div>
                  <select value={location} onChange={(e) => setLocation(e.target.value)} style={UI.inputs.base}>
                    <option value="">Bez umístění</option>
                    {locations.map((loc) => (
                      <option key={loc.id} value={loc.code}>
                        {loc.code} — {loc.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <div style={UI.inputs.label}>Aktuální stav</div>
                  <input value={currentQty} onChange={(e) => setCurrentQty(e.target.value)} style={UI.inputs.base} />
                </div>
                <div>
                  <div style={UI.inputs.label}>Min. zásoba</div>
                  <input value={minQty} onChange={(e) => setMinQty(e.target.value)} style={UI.inputs.base} />
                </div>
                <div>
                  <div style={UI.inputs.label}>Jednotka</div>
                  <input value={unit} onChange={(e) => setUnit(e.target.value)} style={UI.inputs.base} placeholder="ks" />
                </div>
                <div style={{ gridColumn: "1 / -1" }}>
                  <div style={UI.inputs.label}>Poznámka</div>
                  <input value={note} onChange={(e) => setNote(e.target.value)} style={UI.inputs.base} />
                </div>
                <div style={{ display: "flex", alignItems: "center", paddingTop: 20 }}>
                  <label style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 700 }}>
                    <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
                    Aktivní
                  </label>
                </div>
              </div>
              {formError ? <div style={{ color: "#b91c1c", fontWeight: 700, marginTop: 8 }}>{formError}</div> : null}
              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <button
                  type="button"
                  style={{ ...UI.buttons.primary, ...(saving ? { opacity: 0.7, cursor: "wait" } : {}) }}
                  onClick={handleSave}
                  disabled={saving}
                >
                  {saving ? "Ukládám…" : editingId == null ? "Uložit kartu" : "Uložit změny"}
                </button>
                <button type="button" style={UI.buttons.secondary} onClick={resetForm} disabled={saving}>
                  Zrušit
                </button>
              </div>
            </div>
          ) : null}

          <div style={UI.overviewCardHeaderBand}>
            <div style={UI.overviewSecondaryFilterRow}>
              <OverviewSloupceButton onClick={() => tb.openPanel()} disabled={loading} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Hledat GPN, název, výkres, revizi, lokaci, scan kód…"
                style={{ ...UI.inputs.base, minWidth: 200, flex: "1 1 240px" }}
              />
              {customerOptions.length > 0 ? (
                <select
                  value={customerFilter}
                  onChange={(e) => setCustomerFilter(e.target.value)}
                  style={{ ...UI.inputs.base, minWidth: 200, flex: "0 1 260px" }}
                >
                  <option value="">Všichni zákazníci</option>
                  {customerOptions.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              ) : null}
            </div>
          </div>

          <div style={UI.overviewCardBody}>
          {loading ? <div style={{ ...UI.overviewStateLoading, padding: "0 0 12px" }}>Načítám…</div> : null}
          {error ? <div style={{ ...UI.overviewStateError, padding: "0 0 12px" }}>{error}</div> : null}
          {tb.loadError ? <div style={UI.overviewStateWarn}>{tb.loadError}</div> : null}

          {!loading && !error && rows.length === 0 ? (
            <div style={UI.overviewEmptyInCard}>Zatím žádné skladové položky. Vytvořte novou skladovou kartu.</div>
          ) : null}

          {!loading && !error && rows.length > 0 ? (
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
                        {col.key === "qty"
                          ? `Stav (${unitLabel})`
                          : col.key === "min_qty"
                            ? `Min. zásoba (${unitLabel})`
                            : col.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedFiltered.map((row) => (
                    <tr
                      key={row.id}
                      onClick={() => onOpenStockInWorkspaceTab(row)}
                      onMouseEnter={() => setHoverId(row.id)}
                      onMouseLeave={() => setHoverId((id) => (id === row.id ? null : id))}
                      style={{ cursor: "pointer", background: hoverId === row.id ? "#eff6ff" : "#fff" }}
                    >
                      {tb.visibleColumns.map((col) => (
                        <td
                          key={col.key}
                          style={{
                            ...UI.td,
                            padding: `${tb.cellPaddingPx}px`,
                            whiteSpace: col.key === "name" ? "normal" : "nowrap",
                            fontWeight: col.key === "gpn" ? 800 : undefined,
                          }}
                        >
                          {renderStockCell(col.key, row)}
                        </td>
                      ))}
                    </tr>
                  ))}
                  {filtered.length === 0 ? (
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
          title="Sloupce — sklad výrobků"
          columns={tb.columns}
          onColumnsChange={tb.setColumns}
          sort={tb.sort}
          onSortChange={tb.setSort}
          sortableKeys={tb.sortableKeys}
          columnLabels={STOCK_COL_LABELS}
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

      <SimpleModal
        title="Vydat výrobek"
        open={issueRow != null}
        onClose={() => !issueBusy && setIssueRow(null)}
        footer={
          <>
            <button type="button" style={UI.buttons.secondary} disabled={issueBusy} onClick={() => setIssueRow(null)}>
              Zrušit
            </button>
            <button type="button" style={UI.buttons.primary} disabled={issueBusy} onClick={() => void submitIssue()}>
              {issueBusy ? "Ukládám…" : "Potvrdit výdej"}
            </button>
          </>
        }
      >
        {issueRow ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ fontSize: 13, color: "#64748b" }}>
              {issueRow.portfolio_gpn} — {issueRow.portfolio_name} (stav {issueRow.current_qty} {issueRow.unit || "ks"})
            </div>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontWeight: 800 }}>Množství</span>
              <input
                style={UI.inputs.base}
                type="text"
                inputMode="decimal"
                value={issueQty}
                onChange={(e) => setIssueQty(e.target.value)}
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontWeight: 800 }}>ID položky zakázky (volitelné)</span>
              <input
                style={UI.inputs.base}
                type="text"
                inputMode="numeric"
                value={issueJobItemId}
                onChange={(e) => setIssueJobItemId(e.target.value)}
                placeholder="job_item_id"
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontWeight: 800 }}>ID zakázky zákazníka (volitelné)</span>
              <input
                style={UI.inputs.base}
                type="text"
                inputMode="numeric"
                value={issueCustomerOrderId}
                onChange={(e) => setIssueCustomerOrderId(e.target.value)}
                placeholder="customer_order_id"
              />
            </label>
            {issueError ? <div style={{ color: "#b91c1c", fontWeight: 700 }}>{issueError}</div> : null}
          </div>
        ) : null}
      </SimpleModal>
    </>
  );
}
