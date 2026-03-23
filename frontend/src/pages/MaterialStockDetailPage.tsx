import React, { useCallback, useEffect, useState } from "react";
import { UI } from "../styles/ui";
import {
  createMaterialStockMovement,
  deleteMaterialStockMovement,
  getMaterialStockItems,
  getMaterialStockMovements,
  updateMaterialStockMovement,
  type MaterialStockItem,
  type MaterialStockMovement,
} from "../services/materialStockApi";

type DetailItem = MaterialStockItem & { material_dimension?: string | null };

type Props = {
  item: DetailItem;
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

export default function MaterialStockDetailPage({ item, onBack }: Props) {
  const [stockItem, setStockItem] = useState<DetailItem>(item);
  const [rows, setRows] = useState<MaterialStockMovement[]>([]);
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

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [movements, items] = await Promise.all([
        getMaterialStockMovements(item.id),
        getMaterialStockItems(),
      ]);
      setRows(movements);
      const refreshed = items.find((x) => x.id === item.id);
      if (refreshed) setStockItem((prev) => ({ ...prev, ...refreshed }));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Nepodařilo se načíst detail skladu.");
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
        await createMaterialStockMovement(item.id, payload);
      } else {
        await updateMaterialStockMovement(editingMovementId, payload);
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

  function openEditMovement(row: MaterialStockMovement) {
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

  async function handleDeleteMovement(row: MaterialStockMovement) {
    if (!window.confirm("Opravdu chcete smazat tento pohyb?")) return;
    setError(null);
    try {
      await deleteMaterialStockMovement(row.id);
      await loadData();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Nepodařilo se smazat pohyb.");
    }
  }

  return (
    <div style={UI.container}>
      <div style={{ paddingTop: 10, display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button type="button" style={UI.buttons.secondary} onClick={onBack}>
            Zpět na sklad materiálu
          </button>
        </div>

        <div style={UI.pageHeaderRow}>
          <div>
            <h1 style={{ margin: 0, fontSize: 30, fontWeight: 900, color: "#0f172a", lineHeight: 1.2 }}>
              {stockItem.material_name}
            </h1>
            <p style={{ ...UI.headerSubtitle, marginTop: 8, marginBottom: 0 }}>
              {stockItem.material_code || "—"} {stockItem.material_dimension ? `| ${stockItem.material_dimension}` : ""}
            </p>
          </div>
          <div style={{ ...UI.summaryTilesGrid, width: "auto", gap: 8 }}>
            <div style={{ ...UI.summaryTile, minHeight: 88, minWidth: 180 }}>
              <div style={UI.summaryTileLabel}>Aktuální stav</div>
              <div style={UI.summaryTileValue}>
                {stockItem.current_qty} mm
              </div>
            </div>
            <div style={{ ...UI.summaryTile, minHeight: 88, minWidth: 180 }}>
              <div style={UI.summaryTileLabel}>Min. zásoba</div>
              <div style={UI.summaryTileValue}>
                {stockItem.min_qty ?? "—"} mm
              </div>
            </div>
          </div>
        </div>

        <div style={{ ...UI.card, borderRadius: 14, padding: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 10 }}>
            <div style={{ ...UI.sectionTitle, fontSize: 16, marginBottom: 0 }}>Pohyby materiálu</div>
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
                }}
              >
                Přidat pohyb
              </button>
            ) : null}
          </div>

          {showForm ? (
            <div style={{ border: "1px solid #e2e8f0", borderRadius: 12, background: "#f8fafc", padding: 16, marginBottom: 14 }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: 12 }}>
                <div>
                  <div style={UI.inputs.label}>Typ</div>
                  <select
                    value={movementType}
                    onChange={(e) => setMovementType(e.target.value as "prijem" | "vydej" | "korekce")}
                    style={UI.inputs.base}
                  >
                    <option value="prijem">prijem</option>
                    <option value="vydej">vydej</option>
                    <option value="korekce">korekce</option>
                  </select>
                </div>
                <div>
                  <div style={UI.inputs.label}>Množství (mm)</div>
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
                <div>
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
                  {saving ? "Ukládám..." : editingMovementId == null ? "Uložit pohyb" : "Uložit změny pohybu"}
                </button>
              </div>
            </div>
          ) : null}

          {loading ? <div style={UI.sectionSubtitle}>Načítám pohyby...</div> : null}
          {error ? <div style={{ color: "#b91c1c", fontWeight: 700, marginBottom: 8 }}>{error}</div> : null}

          {!loading ? (
            <div style={{ overflowX: "auto" }}>
              <table style={UI.table}>
                <thead>
                  <tr style={{ background: "#f8fafc" }}>
                    {["Typ pohybu", "Množství (mm)", "Datum", "Reference", "Poznámka", "Akce"].map((h) => (
                      <th key={h} style={{ ...UI.th, fontSize: 13, padding: "10px 10px", whiteSpace: "nowrap" }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id}>
                      <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap", fontWeight: 800 }}>{row.movement_type}</td>
                      <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>{row.qty} mm</td>
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
