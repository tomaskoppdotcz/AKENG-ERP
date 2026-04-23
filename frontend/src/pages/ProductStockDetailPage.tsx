import React, { useCallback, useEffect, useState } from "react";
import DetailPageHeader from "../components/DetailPageHeader";
import {
  erpDetailIdentGrid,
  erpDetailIdentLabel,
  erpDetailIdentValue,
  erpDetailKpiLabel,
  erpDetailKpiPanel,
  erpDetailKpiRow,
  erpDetailKpiValue,
  erpDetailRowLabel,
  erpDetailRowValue,
  erpDetailSectionEyebrow,
  erpDetailStateCard,
  UI,
} from "../styles/ui";
import {
  createProductStockMovement,
  deleteProductStockMovement,
  getProductStockItems,
  getProductStockMovements,
  updateProductStockMovement,
  type ProductStockItem,
  type ProductStockMovement,
} from "../services/productStockApi";

type Props = {
  item: ProductStockItem;
  onBack: () => void;
};

function formatDate(dateIso: string): string {
  const d = new Date(dateIso);
  if (Number.isNaN(d.getTime())) return dateIso;
  return d.toLocaleString("cs-CZ");
}

function nowLocalDateTimeValue() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function movementTypeLabel(t: string): string {
  if (t === "prijem") return "Příjem";
  if (t === "vydej") return "Výdej";
  if (t === "storno_vydeje") return "Storno výdeje";
  return "Korekce";
}

export default function ProductStockDetailPage({ item, onBack }: Props) {
  const [stockItem, setStockItem] = useState<ProductStockItem>(item);
  const [rows, setRows] = useState<ProductStockMovement[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingMovementId, setEditingMovementId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const [movementType, setMovementType] = useState<"prijem" | "vydej" | "korekce">("prijem");
  const [qty, setQty] = useState("");
  const [movementDate, setMovementDate] = useState(nowLocalDateTimeValue());
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");

  const u = stockItem.unit?.trim() || "ks";

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [movements, items] = await Promise.all([
        getProductStockMovements(item.id),
        getProductStockItems(),
      ]);
      setRows(movements);
      const refreshed = items.find((x) => x.id === item.id);
      if (refreshed) setStockItem(refreshed);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Nepodařilo se načíst detail.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [item.id]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  async function handleSaveMovement() {
    const parsedQty = Number(qty.replace(",", "."));
    if (!Number.isFinite(parsedQty) || parsedQty <= 0) {
      setError("Množství musí být číslo větší než 0.");
      return;
    }
    if (!movementDate.trim()) {
      setError("Datum je povinné.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const payload = {
        movement_type: movementType,
        qty: parsedQty,
        movement_date: new Date(movementDate).toISOString(),
        reference: reference.trim() || null,
        note: note.trim() || null,
      };
      if (editingMovementId == null) {
        await createProductStockMovement(item.id, payload);
      } else {
        await updateProductStockMovement(editingMovementId, payload);
      }
      setQty("");
      setMovementDate(nowLocalDateTimeValue());
      setReference("");
      setNote("");
      setEditingMovementId(null);
      setShowForm(false);
      await loadData();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Nepodařilo se uložit pohyb.");
    } finally {
      setSaving(false);
    }
  }

  function openEditMovement(row: ProductStockMovement) {
    const d = new Date(row.movement_date);
    const pad = (n: number) => String(n).padStart(2, "0");
    const localValue = Number.isNaN(d.getTime())
      ? nowLocalDateTimeValue()
      : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    setEditingMovementId(row.id);
    setMovementType(row.movement_type);
    setQty(String(row.qty));
    setMovementDate(localValue);
    setReference(row.reference ?? "");
    setNote(row.note ?? "");
    setShowForm(true);
    setError(null);
  }

  async function handleDeleteMovement(row: ProductStockMovement) {
    if (!window.confirm("Opravdu chcete smazat tento pohyb?")) return;
    setError(null);
    try {
      await deleteProductStockMovement(row.id);
      await loadData();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Nepodařilo se smazat pohyb.");
    }
  }

  const belowMin =
    stockItem.min_qty != null && Number.isFinite(stockItem.min_qty) && stockItem.current_qty < stockItem.min_qty;
  const lastMovement = rows[0]?.movement_date ?? null;
  const totalMovements = rows.length;
  const statusLabel = stockItem.is_active ? "Aktivní" : "Neaktivní";
  const statusStyle: React.CSSProperties = {
    ...UI.statusBadgeBase,
    ...(stockItem.is_active ? UI.statusBadgeOk : UI.statusBadgeProblem),
  };

  return (
    <div className="erp-overview-page" style={UI.container}>
      <div style={{ paddingTop: 10, display: "flex", flexDirection: "column", gap: 22 }}>
        <DetailPageHeader
          title={
            <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 28,
                  fontWeight: 1000,
                  color: UI.colors.primary,
                  letterSpacing: 0.3,
                  lineHeight: 1.05,
                }}
              >
                {stockItem.portfolio_gpn}
              </div>
              <div style={{ fontSize: 15, fontWeight: 700, color: UI.colors.textPrimary }}>
                {stockItem.portfolio_name}
              </div>
            </div>
          }
          headerAside={
            <span className="erp-status-badge" style={statusStyle}>
              {statusLabel}
            </span>
          }
          actions={
            <button type="button" style={UI.buttons.secondary} onClick={onBack}>
              Zpět na sklad výrobků
            </button>
          }
          context={
            <div style={erpDetailStateCard}>
              <div style={erpDetailSectionEyebrow}>Aktuální stav skladu</div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
                  gap: 14,
                }}
              >
                <div>
                  <div style={erpDetailRowLabel}>Aktuální stav</div>
                  <div
                    style={{
                      ...erpDetailRowValue,
                      color: belowMin ? UI.colors.problemFg : UI.colors.textPrimary,
                    }}
                  >
                    {stockItem.current_qty} {u}
                    {belowMin ? (
                      <span
                        style={{
                          marginLeft: 8,
                          fontSize: 11,
                          fontWeight: 800,
                          color: UI.colors.problemFg,
                          textTransform: "uppercase",
                          letterSpacing: 0.5,
                        }}
                      >
                        pod min.
                      </span>
                    ) : null}
                  </div>
                </div>
                <div>
                  <div style={erpDetailRowLabel}>Min. zásoba</div>
                  <div style={erpDetailRowValue}>
                    {stockItem.min_qty == null ? "—" : `${stockItem.min_qty} ${u}`}
                  </div>
                </div>
                <div>
                  <div style={erpDetailRowLabel}>Lokace</div>
                  <div style={erpDetailRowValue}>
                    {stockItem.location?.trim() ? stockItem.location : "—"}
                  </div>
                </div>
                <div>
                  <div style={erpDetailRowLabel}>Scan kód</div>
                  <div style={erpDetailRowValue}>
                    {stockItem.scan_code?.trim() ? stockItem.scan_code : "—"}
                  </div>
                </div>
              </div>
            </div>
          }
          summaryTiles={
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={erpDetailKpiPanel}>
                <div style={erpDetailSectionEyebrow}>Pohyby</div>
                <div style={erpDetailKpiRow}>
                  <div>
                    <div style={erpDetailKpiLabel}>Počet pohybů</div>
                    <div style={erpDetailKpiValue}>{totalMovements}</div>
                  </div>
                  <div>
                    <div style={erpDetailKpiLabel}>Poslední pohyb</div>
                    <div style={erpDetailKpiValue}>
                      {lastMovement ? formatDate(lastMovement) : "—"}
                    </div>
                  </div>
                  <div>
                    <div style={erpDetailKpiLabel}>Jednotka</div>
                    <div style={erpDetailKpiValue}>{u}</div>
                  </div>
                  <div>
                    <div style={erpDetailKpiLabel}>Stav karty</div>
                    <div style={erpDetailKpiValue}>{statusLabel}</div>
                  </div>
                </div>
              </div>
              <div
                style={{
                  padding: "12px 14px",
                  borderRadius: 12,
                  background: UI.colors.card,
                  border: `1px solid ${UI.colors.border}`,
                }}
              >
                <div style={{ ...erpDetailSectionEyebrow, color: UI.colors.neutralFg, marginBottom: 8 }}>
                  Identifikace
                </div>
                <div style={erpDetailIdentGrid}>
                  <div>
                    <div style={erpDetailIdentLabel}>GPN</div>
                    <div style={erpDetailIdentValue}>{stockItem.portfolio_gpn}</div>
                  </div>
                  <div>
                    <div style={erpDetailIdentLabel}>Název</div>
                    <div style={erpDetailIdentValue}>{stockItem.portfolio_name}</div>
                  </div>
                  <div>
                    <div style={erpDetailIdentLabel}>Výkres</div>
                    <div style={erpDetailIdentValue}>
                      {stockItem.drawing_number?.trim() ? stockItem.drawing_number : "—"}
                    </div>
                  </div>
                  <div>
                    <div style={erpDetailIdentLabel}>Revize</div>
                    <div style={erpDetailIdentValue}>
                      {stockItem.drawing_revision?.trim() ? stockItem.drawing_revision : "—"}
                    </div>
                  </div>
                  <div>
                    <div style={erpDetailIdentLabel}>Poznámka</div>
                    <div style={erpDetailIdentValue}>
                      {stockItem.note?.trim() ? stockItem.note : "—"}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          }
        />

        <div style={{ ...UI.card, borderRadius: 14, padding: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 10 }}>
            <div style={{ ...UI.sectionTitle, fontSize: 16, marginBottom: 0 }}>Pohyby</div>
            {!showForm ? (
              <button
                type="button"
                style={UI.buttons.primary}
                onClick={() => {
                  setEditingMovementId(null);
                  setMovementType("prijem");
                  setQty("");
                  setMovementDate(nowLocalDateTimeValue());
                  setReference("");
                  setNote("");
                  setShowForm(true);
                  setError(null);
                }}
              >
                Přidat pohyb
              </button>
            ) : null}
          </div>

          {showForm ? (
            <div style={{ border: "1px solid #e2e8f0", borderRadius: 12, background: "#f8fafc", padding: 16, marginBottom: 14 }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
                <div>
                  <div style={UI.inputs.label}>Typ pohybu</div>
                  <select
                    value={movementType}
                    onChange={(e) => setMovementType(e.target.value as "prijem" | "vydej" | "korekce")}
                    style={UI.inputs.base}
                  >
                    <option value="prijem">Příjem</option>
                    <option value="vydej">Výdej</option>
                    <option value="korekce">Korekce</option>
                  </select>
                </div>
                <div>
                  <div style={UI.inputs.label}>Množství</div>
                  <input value={qty} onChange={(e) => setQty(e.target.value)} style={UI.inputs.base} />
                </div>
                <div>
                  <div style={UI.inputs.label}>Datum</div>
                  <input
                    type="datetime-local"
                    value={movementDate}
                    onChange={(e) => setMovementDate(e.target.value)}
                    style={UI.inputs.base}
                  />
                </div>
                <div>
                  <div style={UI.inputs.label}>Reference</div>
                  <input value={reference} onChange={(e) => setReference(e.target.value)} style={UI.inputs.base} />
                </div>
                <div style={{ gridColumn: "1 / -1" }}>
                  <div style={UI.inputs.label}>Poznámka</div>
                  <input value={note} onChange={(e) => setNote(e.target.value)} style={UI.inputs.base} />
                </div>
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
                <button
                  type="button"
                  style={UI.buttons.secondary}
                  onClick={() => {
                    setShowForm(false);
                    setEditingMovementId(null);
                  }}
                  disabled={saving}
                >
                  Zrušit
                </button>
                <button
                  type="button"
                  style={{ ...UI.buttons.primary, ...(saving ? { opacity: 0.7, cursor: "wait" } : {}) }}
                  onClick={handleSaveMovement}
                  disabled={saving}
                >
                  {saving ? "Ukládám…" : editingMovementId == null ? "Uložit pohyb" : "Uložit změny pohybu"}
                </button>
              </div>
            </div>
          ) : null}

          {loading ? <div style={UI.sectionSubtitle}>Načítám pohyby…</div> : null}
          {error ? <div style={{ color: "#b91c1c", fontWeight: 700, marginBottom: 8 }}>{error}</div> : null}

          {!loading ? (
            <div style={{ overflowX: "auto" }}>
              <table style={UI.table}>
                <thead>
                  <tr style={{ background: "#f8fafc" }}>
                    {["Typ pohybu", "Množství", "Datum", "Reference", "Poznámka", "Akce"].map((h) => (
                      <th key={h} style={{ ...UI.th, fontSize: 13, padding: "10px 10px", whiteSpace: "nowrap" }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id}>
                      <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap", fontWeight: 800 }}>
                        {movementTypeLabel(row.movement_type)}
                      </td>
                      <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>
                        {row.qty} {u}
                      </td>
                      <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>{formatDate(row.movement_date)}</td>
                      <td style={{ ...UI.td, padding: "10px 10px" }}>{row.reference || "—"}</td>
                      <td style={{ ...UI.td, padding: "10px 10px" }}>{row.note || "—"}</td>
                      <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap", display: "flex", gap: 6 }}>
                        <button type="button" style={UI.buttons.secondary} onClick={() => openEditMovement(row)}>
                          Upravit
                        </button>
                        <button type="button" style={UI.buttons.secondary} onClick={() => handleDeleteMovement(row)}>
                          Smazat
                        </button>
                      </td>
                    </tr>
                  ))}
                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={6} style={{ ...UI.td, textAlign: "center", color: "#64748b", padding: "14px 10px" }}>
                        Zatím nejsou evidovány žádné pohyby.
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
