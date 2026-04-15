import React, { useEffect, useMemo, useState } from "react";
import PageContainer from "../components/layout/PageContainer";
import PageHeader from "../components/layout/PageHeader";
import PageSection from "../components/layout/PageSection";
import { UI } from "../styles/ui";
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

function searchValue(v: string) {
  return v.trim().toLowerCase();
}

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

/** Pořadí variant pod jedním GPN: výroba → sklad zákazník → sklad (interní). */
const LOGISTIC_MODE_SORT: Record<string, number> = {
  vyroba_zakaznik: 0,
  sklad_zakaznik: 1,
  sklad: 2,
};

function sortPortfolioItemsByLogisticMode(a: PortfolioItem, b: PortfolioItem): number {
  const oa = LOGISTIC_MODE_SORT[(a.logistic_mode ?? "").trim()] ?? 99;
  const ob = LOGISTIC_MODE_SORT[(b.logistic_mode ?? "").trim()] ?? 99;
  if (oa !== ob) return oa - ob;
  return a.id - b.id;
}

function allSame<T>(items: PortfolioItem[], pick: (i: PortfolioItem) => T): boolean {
  if (items.length <= 1) return true;
  const first = pick(items[0]);
  return items.every((i) => pick(i) === first);
}

function formatCzk(value: number | null | undefined): string {
  if (value == null) return "—";
  return `${new Intl.NumberFormat("cs-CZ", { maximumFractionDigits: 2, minimumFractionDigits: 0 }).format(value)}\u00a0Kč`;
}

export default function PortfolioPage({
  onOpenItemDetail,
  onOpenItemInWorkspaceTab,
  initialSearchQuery,
  onConsumedInitialSearch,
}: Props) {
  const [items, setItems] = useState<PortfolioItem[]>([]);
  const [loading, setLoading] = useState(true);
  /** Master zákazníci pro dropdown (musí být deklaráno před jakýmkoli useMemo/JSX, které je používá). */
  const [customers, setCustomers] = useState<CustomerListItem[]>([]);
  const [customersLoading, setCustomersLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [hoveredId, setHoveredId] = useState<number | null>(null);
  const [expandedGpnKeys, setExpandedGpnKeys] = useState<Set<string>>(() => new Set());
  const [showForm, setShowForm] = useState(false);
  /** Režim úpravy existující položky (null = nová položka nebo kopie). */
  const [editingId, setEditingId] = useState<number | null>(null);
  /** Zdroj pro kopírování (POST …/copy); vzájemně se vylučuje s editingId. */
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
  const customerRows = Array.isArray(customers) ? customers : [];

  async function loadItems() {
    setLoading(true);
    setError(null);
    try {
      const rows = await getPortfolioItems();
      setItems(rows);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Nepodarilo se nacist portfolio.");
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
    setQuery(q);
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

  const filtered = useMemo(() => {
    const q = searchValue(query);
    if (!q) return items;
    return items.filter((i) =>
      [
        i.gpn,
        i.scan_code ?? "",
        i.name,
        String(i.customer_id),
        i.customer_name ?? "",
        i.group_id == null ? "" : String(i.group_id),
        i.group_name ?? "",
        i.drawing_no ?? "",
        i.revision ?? "",
        i.material_default ?? "",
        i.logistic_mode ?? "",
        logisticLabel(i.logistic_mode),
        i.sale_price_per_piece != null ? String(i.sale_price_per_piece) : "",
        formatCzk(i.sale_price_per_piece),
      ]
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }, [items, query]);

  const portfolioGpnGroups = useMemo(() => {
    const map = new Map<string, PortfolioItem[]>();
    for (const item of filtered) {
      const gpnRaw = (item.gpn ?? "").trim();
      const gpnKey = gpnRaw.toLowerCase() || "—";
      const key = `${item.customer_id}\0${gpnKey}`;
      const arr = map.get(key);
      if (arr) arr.push(item);
      else map.set(key, [item]);
    }
    const groups: { key: string; items: PortfolioItem[] }[] = [];
    for (const [key, rawItems] of map) {
      groups.push({ key, items: [...rawItems].sort(sortPortfolioItemsByLogisticMode) });
    }
    groups.sort((a, b) => {
      const ca = (a.items[0].customer_name ?? "").toLowerCase();
      const cb = (b.items[0].customer_name ?? "").toLowerCase();
      if (ca !== cb) return ca.localeCompare(cb, "cs");
      const ga = (a.items[0].gpn ?? "").trim().toLowerCase();
      const gb = (b.items[0].gpn ?? "").trim().toLowerCase();
      return ga.localeCompare(gb, "cs");
    });
    return groups;
  }, [filtered]);

  function togglePortfolioGpnGroup(key: string) {
    setExpandedGpnKeys((prev) => {
      const n = new Set(prev);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  }

  const customerSelectHasCurrent = useMemo(() => {
    const id = Number(formCustomerId);
    if (!formCustomerId.trim() || !Number.isFinite(id) || id <= 0) return true;
    return customerRows.some((c) => c.id === id);
  }, [formCustomerId, customerRows]);

  const kpi = useMemo(() => {
    const celkemPolozek = filtered.length;
    const skupinyPortfolio = new Set(filtered.map((i) => i.group_id).filter((v): v is number => v != null)).size;
    const skupinyGpn = portfolioGpnGroups.length;
    const sTechnologii = filtered.filter((i) => i.active_template_id != null).length;
    const bezTechnologie = filtered.filter((i) => i.active_template_id == null).length;
    const revize = "A / B / C";

    return [
      { label: "Celkem položek", value: String(celkemPolozek) },
      { label: "Skupiny GPN (řádky)", value: String(skupinyGpn) },
      { label: "Skupiny portfolia", value: String(skupinyPortfolio) },
      { label: "Revize", value: revize },
      { label: "S technologií", value: String(sTechnologii) },
      { label: "Bez technologie", value: String(bezTechnologie) },
    ] as const;
  }, [filtered, portfolioGpnGroups.length]);

  const customerIdOptions = useMemo(
    () => Array.from(new Set(items.map((i) => i.customer_id))).sort((a, b) => a - b),
    [items]
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
        : customerIdOptions[0] != null
          ? String(customerIdOptions[0])
          : ""
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

  function closeForm() {
    setShowForm(false);
    setEditingId(null);
    setCopySourceId(null);
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

  return (
    <PageContainer style={{ paddingTop: 10 }}>
      <PageHeader
        title="Portfolio"
        subtitle="Přehled portfolia výrobků"
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
            <button type="button" style={UI.buttons.secondary} onClick={() => {}}>
              Import
            </button>
          </>
        }
      />

      <div style={UI.summaryTilesGridOuter}>
        <div
          style={{
            ...UI.summaryTilesGridSix,
            gridTemplateColumns: "repeat(6, minmax(0, 1fr))",
            minWidth: 0,
            width: "100%",
          }}
        >
          {kpi.map((tile) => (
            <div key={tile.label} style={UI.summaryTile}>
              <div style={UI.summaryTileLabel}>{tile.label}</div>
              <div style={UI.summaryTileValue}>{tile.value}</div>
            </div>
          ))}
        </div>
      </div>

      <PageSection>
        <div style={{ ...UI.card, borderRadius: 14, padding: 16, width: "100%", boxSizing: "border-box" }}>
          {showForm ? (
            <div style={{ ...UI.card, padding: 12, marginBottom: 12, background: "#f8fafc", border: "1px solid #e2e8f0" }}>
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
          ) : null}

          <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12 }}>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Hledat"
              style={UI.inputs.base}
            />
          </div>

          {loading ? <div style={UI.sectionSubtitle}>Načítám portfolio...</div> : null}
          {error ? <div style={{ color: "#b91c1c", fontWeight: 700 }}>{error}</div> : null}

          {!loading && !error && items.length === 0 ? (
            <div
              style={{
                textAlign: "center",
                color: "#64748b",
                fontWeight: 700,
                padding: "24px 12px",
                border: "1px solid #e2e8f0",
                borderRadius: 12,
                background: "#f8fafc",
              }}
            >
              Portfolio je zatím prázdné. Po vytvoření reálných položek v backendu se zde zobrazí seznam.
            </div>
          ) : null}

          {!loading && !error && items.length > 0 ? (
            <div style={{ overflowX: "auto" }}>
              <table style={UI.table}>
                <thead>
                  <tr style={{ background: "#f8fafc" }}>
                    <th style={{ ...UI.th, width: 44, fontSize: 13, padding: "10px 6px" }} aria-label="Rozbalit varianty" />
                    {[
                      "GPN",
                      "Scan kód",
                      "Název",
                      "Zákazník",
                      "Skupina",
                      "Výkres",
                      "Revize",
                      "Materiál",
                      "Logistický režim",
                      "Prodejní cena / ks",
                      "Technologie",
                      "Akce",
                    ].map((h) => (
                      <th key={h} style={{ ...UI.th, fontSize: 13, padding: "10px 10px", whiteSpace: "nowrap" }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {portfolioGpnGroups.map((g) => {
                    const exp = expandedGpnKeys.has(g.key);
                    const first = g.items[0];
                    const variantSummary = g.items.map((i) => logisticLabel(i.logistic_mode)).join(" · ");
                    const nameCell =
                      g.items.length > 1 && !allSame(g.items, (i) => (i.name ?? "").trim())
                        ? `${dash(first.name)} (+${g.items.length} variant)`
                        : dash(first.name);
                    const drawingCell = allSame(g.items, (i) => (i.drawing_no ?? "").trim())
                      ? dash(first.drawing_no)
                      : "různé";
                    const revCell = allSame(g.items, (i) => (i.revision ?? "").trim())
                      ? dash(first.revision)
                      : "různé";
                    const matCell = allSame(g.items, (i) => (i.material_default ?? "").trim())
                      ? dash(first.material_default)
                      : "různé";
                    const priceCell = allSame(g.items, (i) => i.sale_price_per_piece)
                      ? formatCzk(first.sale_price_per_piece)
                      : "různé";
                    const allTp = g.items.every((i) => i.active_template_id != null);
                    const anyTp = g.items.some((i) => i.active_template_id != null);
                    return (
                      <React.Fragment key={g.key}>
                        <tr style={{ background: "#f8fafc", borderLeft: "4px solid #0ea5e9" }}>
                          <td style={{ ...UI.td, padding: "8px 6px", verticalAlign: "middle" }}>
                            <button
                              type="button"
                              style={UI.buttons.secondary}
                              onClick={() => togglePortfolioGpnGroup(g.key)}
                              aria-expanded={exp}
                              title={exp ? "Sbalit varianty logistiky" : "Rozbalit varianty logistiky"}
                            >
                              {exp ? "▼" : "▶"}
                            </button>
                          </td>
                          <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap", fontWeight: 800 }}>
                            {dash(first.gpn)}
                          </td>
                          <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap", color: "#64748b" }}>
                            {g.items.length > 1 ? `${g.items.length}×` : dash(first.scan_code)}
                          </td>
                          <td style={{ ...UI.td, padding: "10px 10px" }}>{nameCell}</td>
                          <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>
                            {dash(first.customer_name)}
                          </td>
                          <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>{dash(first.group_name)}</td>
                          <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>{drawingCell}</td>
                          <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>{revCell}</td>
                          <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>{matCell}</td>
                          <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap", fontSize: 12, fontWeight: 700 }}>
                            {variantSummary}
                          </td>
                          <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>{priceCell}</td>
                          <td
                            style={{
                              ...UI.td,
                              padding: "10px 10px",
                              whiteSpace: "nowrap",
                              fontWeight: 900,
                              color: allTp ? "#15803d" : anyTp ? "#ca8a04" : "#dc2626",
                            }}
                          >
                            {allTp ? "ANO" : anyTp ? "ČÁST." : "NE"}
                          </td>
                          <td style={{ ...UI.td, padding: "10px 10px", color: "#64748b", fontSize: 12 }}>
                            Rozbalte řádek
                          </td>
                        </tr>
                        {exp ? (
                          <tr>
                            <td colSpan={13} style={{ ...UI.td, background: "#fff", padding: 12 }}>
                              <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 8, color: "#0f172a" }}>
                                Varianty logistiky (stejné GPN a zákazník)
                              </div>
                              <div style={{ overflowX: "auto" }}>
                                <table style={{ ...UI.table, width: "100%" }}>
                                  <thead>
                                    <tr style={{ background: "#f1f5f9" }}>
                                      {[
                                        "Logistický režim",
                                        "Scan kód",
                                        "Název",
                                        "Skupina",
                                        "Výkres",
                                        "Revize",
                                        "Materiál",
                                        "Prodejní cena / ks",
                                        "Technologie",
                                        "Akce",
                                      ].map((h) => (
                                        <th key={h} style={{ ...UI.th, fontSize: 11 }}>
                                          {h}
                                        </th>
                                      ))}
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {g.items.map((item) => (
                                      <tr
                                        key={item.id}
                                        onClick={() => {
                                          if (onOpenItemInWorkspaceTab) onOpenItemInWorkspaceTab(item);
                                          else onOpenItemDetail?.(item);
                                        }}
                                        onMouseEnter={() => setHoveredId(item.id)}
                                        onMouseLeave={() => setHoveredId((id) => (id === item.id ? null : id))}
                                        style={{
                                          cursor: "pointer",
                                          background: hoveredId === item.id ? "#eff6ff" : "#fff",
                                        }}
                                      >
                                        <td style={{ ...UI.td, fontWeight: 800, whiteSpace: "nowrap" }}>
                                          {logisticLabel(item.logistic_mode)}
                                        </td>
                                        <td style={{ ...UI.td, whiteSpace: "nowrap" }}>{dash(item.scan_code)}</td>
                                        <td style={UI.td}>{dash(item.name)}</td>
                                        <td style={{ ...UI.td, whiteSpace: "nowrap" }}>{dash(item.group_name)}</td>
                                        <td style={{ ...UI.td, whiteSpace: "nowrap" }}>{dash(item.drawing_no)}</td>
                                        <td style={{ ...UI.td, whiteSpace: "nowrap" }}>{dash(item.revision)}</td>
                                        <td style={{ ...UI.td, whiteSpace: "nowrap" }}>{dash(item.material_default)}</td>
                                        <td style={{ ...UI.td, whiteSpace: "nowrap" }}>{formatCzk(item.sale_price_per_piece)}</td>
                                        <td
                                          style={{
                                            ...UI.td,
                                            whiteSpace: "nowrap",
                                            fontWeight: 900,
                                            color: item.active_template_id != null ? "#15803d" : "#dc2626",
                                          }}
                                        >
                                          {item.active_template_id != null ? "ANO" : "NE"}
                                        </td>
                                        <td
                                          style={{
                                            ...UI.td,
                                            whiteSpace: "nowrap",
                                            display: "flex",
                                            gap: 6,
                                            flexWrap: "wrap",
                                          }}
                                          onClick={(e) => e.stopPropagation()}
                                        >
                                          <button
                                            type="button"
                                            style={UI.buttons.secondary}
                                            onClick={() => openCopyForm(item)}
                                          >
                                            Kopírovat
                                          </button>
                                          <button
                                            type="button"
                                            style={UI.buttons.secondary}
                                            onClick={() => openEditForm(item)}
                                          >
                                            Upravit
                                          </button>
                                          <button
                                            type="button"
                                            style={UI.buttons.secondary}
                                            onClick={() => handleDelete(item.id)}
                                          >
                                            Smazat
                                          </button>
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </td>
                          </tr>
                        ) : null}
                      </React.Fragment>
                    );
                  })}
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={13} style={{ ...UI.td, textAlign: "center", color: "#64748b", padding: "14px 10px" }}>
                        Žádné výsledky.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      </PageSection>
    </PageContainer>
  );
}

