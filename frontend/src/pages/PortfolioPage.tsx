import React, { useEffect, useMemo, useState } from "react";
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
  onOpenItemDetail?: (item: PortfolioItem) => void;
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

export default function PortfolioPage({ onOpenItemDetail }: Props) {
  const [items, setItems] = useState<PortfolioItem[]>([]);
  const [loading, setLoading] = useState(true);
  /** Master zákazníci pro dropdown (musí být deklaráno před jakýmkoli useMemo/JSX, které je používá). */
  const [customers, setCustomers] = useState<CustomerListItem[]>([]);
  const [customersLoading, setCustomersLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [hoveredId, setHoveredId] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
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
  const [formActive, setFormActive] = useState(true);
  const [copyingFromId, setCopyingFromId] = useState<number | null>(null);
  const [copyGpn, setCopyGpn] = useState("");
  const [copyName, setCopyName] = useState("");
  const [copyDrawing, setCopyDrawing] = useState("");
  const [copyRevision, setCopyRevision] = useState("");
  const [copySaving, setCopySaving] = useState(false);

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
      ]
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }, [items, query]);

  const customerSelectHasCurrent = useMemo(() => {
    const id = Number(formCustomerId);
    if (!formCustomerId.trim() || !Number.isFinite(id) || id <= 0) return true;
    return customerRows.some((c) => c.id === id);
  }, [formCustomerId, customerRows]);

  const kpi = useMemo(() => {
    const celkemPolozek = filtered.length;
    const skupiny = new Set(filtered.map((i) => i.group_id).filter((v): v is number => v != null)).size;
    const sTechnologii = filtered.filter((i) => i.active_template_id != null).length;
    const bezTechnologie = filtered.filter((i) => i.active_template_id == null).length;
    const revize = "A / B / C";

    return [
      { label: "Celkem položek", value: String(celkemPolozek) },
      { label: "Skupiny", value: String(skupiny) },
      { label: "Revize", value: revize },
      { label: "S technologií", value: String(sTechnologii) },
      { label: "Bez technologie", value: String(bezTechnologie) },
    ] as const;
  }, [filtered]);

  const customerIdOptions = useMemo(
    () => Array.from(new Set(items.map((i) => i.customer_id))).sort((a, b) => a - b),
    [items]
  );
  function openCreateForm() {
    setEditingId(null);
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
    setFormActive(true);
    setShowForm(true);
  }

  function openEditForm(item: PortfolioItem) {
    setEditingId(item.id);
    setFormGpn(item.gpn);
    setFormName(item.name);
    setFormCustomerId(String(item.customer_id));
    setFormPortfolioGroupId(item.portfolio_group_id ?? item.group_id ?? null);
    setFormDrawingNo(item.drawing_no ?? "");
    setFormRevision(item.revision ?? "");
    setFormMaterialDefault(item.material_default ?? "");
    setFormLogisticMode(item.logistic_mode ?? "vyroba_zakaznik");
    setFormActive(item.is_active ?? true);
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setEditingId(null);
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
    const payload = {
      gpn,
      name,
      customer_id: customerId,
      portfolio_group_id: formPortfolioGroupId,
      drawing_no: formDrawingNo.trim() || null,
      revision: formRevision.trim() || null,
      material_default: formMaterialDefault.trim() || null,
      logistic_mode: formLogisticMode,
      is_active: formActive,
    };
    setSaving(true);
    setError(null);
    try {
      if (editingId == null) {
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
      if (editingId === id) closeForm();
      if (copyingFromId === id) closeCopyForm();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Smazání se nezdařilo.");
    }
  }

  function openCopyForm(item: PortfolioItem) {
    setCopyingFromId(item.id);
    setCopyGpn("");
    setCopyName(item.name);
    setCopyDrawing(item.drawing_no ?? "");
    setCopyRevision(item.revision ?? "");
    setError(null);
  }

  function closeCopyForm() {
    setCopyingFromId(null);
    setCopyGpn("");
    setCopyName("");
    setCopyDrawing("");
    setCopyRevision("");
  }

  async function handleCopySave() {
    if (copyingFromId == null) return;
    const gpn = copyGpn.trim();
    if (!gpn) {
      setError("Vyplňte nové GPN.");
      return;
    }
    setCopySaving(true);
    setError(null);
    try {
      await copyPortfolioItem(copyingFromId, {
        gpn,
        name: copyName.trim() || undefined,
        drawing_no: copyDrawing.trim() || undefined,
        revision: copyRevision.trim() || undefined,
      });
      await loadItems();
      closeCopyForm();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Kopírování se nezdařilo.");
    } finally {
      setCopySaving(false);
    }
  }

  return (
    <div style={UI.container}>
      <div style={{ paddingTop: 10, display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={UI.pageHeaderRow}>
          <div>
            <div style={UI.sectionTitle}>Portfolio</div>
            <div style={UI.sectionSubtitle}>Přehled portfolia výrobků</div>
          </div>
          <div style={UI.pageHeaderActions}>
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
          </div>
        </div>

        <div style={UI.summaryTilesGridOuter}>
          <div style={{ ...UI.summaryTilesGridSix, gridTemplateColumns: "repeat(5, minmax(0, 1fr))", minWidth: 820 }}>
            {kpi.map((tile) => (
              <div key={tile.label} style={UI.summaryTile}>
                <div style={UI.summaryTileLabel}>{tile.label}</div>
                <div style={UI.summaryTileValue}>{tile.value}</div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ ...UI.card, borderRadius: 14, padding: 16 }}>
          {showForm ? (
            <div style={{ ...UI.card, padding: 12, marginBottom: 12, background: "#f8fafc", border: "1px solid #e2e8f0" }}>
              <div style={{ ...UI.sectionTitle, fontSize: 16, marginBottom: 10 }}>
                {editingId == null ? "Nová portfolio položka" : "Upravit portfolio položku"}
              </div>
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
                  {saving ? "Ukládám..." : editingId == null ? "Uložit položku" : "Uložit změny"}
                </button>
                <button type="button" style={UI.buttons.secondary} onClick={closeForm} disabled={saving}>
                  Zrušit
                </button>
              </div>
            </div>
          ) : null}

          {copyingFromId != null ? (
            <div style={{ ...UI.card, padding: 12, marginBottom: 12, background: "#f0fdf4", border: "1px solid #bbf7d0" }}>
              <div style={{ ...UI.sectionTitle, fontSize: 16, marginBottom: 10 }}>Kopírovat portfolio položku</div>
              <div style={{ fontSize: 13, color: "#166534", marginBottom: 10, fontWeight: 600 }}>
                Zdroj: {items.find((i) => i.id === copyingFromId)?.gpn ?? copyingFromId}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
                <div>
                  <div style={UI.inputs.label}>Nové GPN</div>
                  <input value={copyGpn} onChange={(e) => setCopyGpn(e.target.value)} style={UI.inputs.base} />
                </div>
                <div>
                  <div style={UI.inputs.label}>Nový název (volitelné)</div>
                  <input value={copyName} onChange={(e) => setCopyName(e.target.value)} style={UI.inputs.base} />
                </div>
                <div>
                  <div style={UI.inputs.label}>Nový výkres (volitelné)</div>
                  <input value={copyDrawing} onChange={(e) => setCopyDrawing(e.target.value)} style={UI.inputs.base} />
                </div>
                <div>
                  <div style={UI.inputs.label}>Nová revize (volitelné)</div>
                  <input value={copyRevision} onChange={(e) => setCopyRevision(e.target.value)} style={UI.inputs.base} />
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <button
                  type="button"
                  style={{ ...UI.buttons.primary, ...(copySaving ? { opacity: 0.7, cursor: "wait" } : {}) }}
                  onClick={handleCopySave}
                  disabled={copySaving}
                >
                  {copySaving ? "Kopíruji…" : "Vytvořit kopii"}
                </button>
                <button type="button" style={UI.buttons.secondary} onClick={closeCopyForm} disabled={copySaving}>
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
                    {[
                      "GPN",
                      "Název",
                      "Zákazník",
                      "Skupina",
                      "Výkres",
                      "Revize",
                      "Materiál",
                      "Logistický režim",
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
                  {filtered.map((item) => (
                    <tr
                      key={item.id}
                      onClick={() => onOpenItemDetail?.(item)}
                      onMouseEnter={() => setHoveredId(item.id)}
                      onMouseLeave={() => setHoveredId((id) => (id === item.id ? null : id))}
                      style={{ cursor: "pointer", background: hoveredId === item.id ? "#eff6ff" : "#fff" }}
                    >
                      <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap", fontWeight: 800 }}>{dash(item.gpn)}</td>
                      <td style={{ ...UI.td, padding: "10px 10px" }}>{dash(item.name)}</td>
                      <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>{dash(item.customer_name)}</td>
                      <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>{dash(item.group_name)}</td>
                      <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>{dash(item.drawing_no)}</td>
                      <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>{dash(item.revision)}</td>
                      <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>{dash(item.material_default)}</td>
                      <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>{logisticLabel(item.logistic_mode)}</td>
                      <td
                        style={{
                          ...UI.td,
                          padding: "10px 10px",
                          whiteSpace: "nowrap",
                          fontWeight: 900,
                          color: item.active_template_id != null ? "#15803d" : "#dc2626",
                        }}
                      >
                        {item.active_template_id != null ? "ANO" : "NE"}
                      </td>
                      <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap", display: "flex", gap: 6 }}>
                        <button
                          type="button"
                          style={UI.buttons.secondary}
                          onClick={(e) => {
                            e.stopPropagation();
                            openCopyForm(item);
                          }}
                        >
                          Kopírovat
                        </button>
                        <button
                          type="button"
                          style={UI.buttons.secondary}
                          onClick={(e) => {
                            e.stopPropagation();
                            openEditForm(item);
                          }}
                        >
                          Upravit
                        </button>
                        <button
                          type="button"
                          style={UI.buttons.secondary}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDelete(item.id);
                          }}
                        >
                          Smazat
                        </button>
                      </td>
                    </tr>
                  ))}
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={10} style={{ ...UI.td, textAlign: "center", color: "#64748b", padding: "14px 10px" }}>
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
    </div>
  );
}

