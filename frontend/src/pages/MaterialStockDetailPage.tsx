import React, { useCallback, useEffect, useState } from "react";
import DetailPageHeader from "../components/DetailPageHeader";
import { UI } from "../styles/ui";
import {
  createMaterialStockMovement,
  deleteMaterialStockMovement,
  getMaterialStockItems,
  getMaterialStockMovements,
  materialMovementAttachmentFileUrl,
  updateMaterialStockMovement,
  uploadMaterialMovementAttachments,
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
  const [heatLot, setHeatLot] = useState("");
  const [supplierName, setSupplierName] = useState("");
  const [deliveryNoteNo, setDeliveryNoteNo] = useState("");
  const [certificateNo, setCertificateNo] = useState("");
  const [attachmentFiles, setAttachmentFiles] = useState<File[]>([]);

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

  function resetMovementExtras() {
    setHeatLot("");
    setSupplierName("");
    setDeliveryNoteNo("");
    setCertificateNo("");
    setAttachmentFiles([]);
  }

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
    if (movementType === "prijem" && !heatLot.trim()) {
      setError("U příjmu je povinné pole Tavba / šarže.");
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
        heat_lot: movementType === "prijem" ? heatLot.trim() : heatLot.trim() || null,
        supplier_name: supplierName.trim() || null,
        delivery_note_no: deliveryNoteNo.trim() || null,
        certificate_no: certificateNo.trim() || null,
      };
      let movementId: number;
      if (editingMovementId == null) {
        const created = await createMaterialStockMovement(item.id, payload);
        movementId = created.id;
        if (movementType === "prijem" && attachmentFiles.length > 0) {
          await uploadMaterialMovementAttachments(movementId, attachmentFiles);
        }
      } else {
        await updateMaterialStockMovement(editingMovementId, payload);
        movementId = editingMovementId;
        if (movementType === "prijem" && attachmentFiles.length > 0) {
          await uploadMaterialMovementAttachments(movementId, attachmentFiles);
        }
      }
      setQty("");
      setMovementDate(nowLocalDateTimeValue());
      setReference("");
      setNote("");
      resetMovementExtras();
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
    setHeatLot(row.heat_lot ?? "");
    setSupplierName(row.supplier_name ?? "");
    setDeliveryNoteNo(row.delivery_note_no ?? "");
    setCertificateNo(row.certificate_no ?? "");
    setAttachmentFiles([]);
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

  const showTraceFields = movementType === "prijem";

  return (
    <div style={UI.container}>
      <div style={{ paddingTop: 10, display: "flex", flexDirection: "column", gap: 14 }}>
        <DetailPageHeader
          title={stockItem.material_name}
          subtitle={`${stockItem.material_code || "—"}${stockItem.material_dimension ? ` | ${stockItem.material_dimension}` : ""}`}
          actions={
            <button type="button" style={UI.buttons.secondary} onClick={onBack}>
              Zpět na sklad materiálu
            </button>
          }
          summaryTiles={
            <div style={UI.summaryTilesGrid}>
              <div style={{ ...UI.summaryTile, flex: "1 1 220px", minWidth: 180 }}>
                <div style={UI.summaryTileLabel}>Aktuální stav</div>
                <div style={UI.summaryTileValue}>{stockItem.current_qty} mm</div>
              </div>
              <div style={{ ...UI.summaryTile, flex: "1 1 220px", minWidth: 180 }}>
                <div style={UI.summaryTileLabel}>Min. zásoba</div>
                <div style={UI.summaryTileValue}>{stockItem.min_qty ?? "—"} mm</div>
              </div>
            </div>
          }
        />

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
                  resetMovementExtras();
                  setShowForm(true);
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

              {showTraceFields ? (
                <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
                  <div>
                    <div style={UI.inputs.label}>Tavba / šarže {movementType === "prijem" ? "(povinné)" : ""}</div>
                    <input value={heatLot} onChange={(e) => setHeatLot(e.target.value)} style={UI.inputs.base} />
                  </div>
                  <div>
                    <div style={UI.inputs.label}>Dodavatel</div>
                    <input value={supplierName} onChange={(e) => setSupplierName(e.target.value)} style={UI.inputs.base} />
                  </div>
                  <div>
                    <div style={UI.inputs.label}>Číslo dodacího listu</div>
                    <input value={deliveryNoteNo} onChange={(e) => setDeliveryNoteNo(e.target.value)} style={UI.inputs.base} />
                  </div>
                  <div>
                    <div style={UI.inputs.label}>Číslo atestu</div>
                    <input value={certificateNo} onChange={(e) => setCertificateNo(e.target.value)} style={UI.inputs.base} />
                  </div>
                  <div style={{ gridColumn: "1 / -1" }}>
                    <div style={UI.inputs.label}>Přílohy (PDF, JPG, PNG) — pouze u příjmu</div>
                    <input
                      type="file"
                      accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
                      multiple
                      onChange={(e) => setAttachmentFiles(e.target.files ? Array.from(e.target.files) : [])}
                      style={{ fontSize: 13 }}
                    />
                    {attachmentFiles.length > 0 ? (
                      <div style={{ fontSize: 12, color: "#64748b", marginTop: 6 }}>
                        Vybráno: {attachmentFiles.map((f) => f.name).join(", ")}
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : (
                <div style={{ marginTop: 14 }}>
                  <div style={UI.inputs.label}>Tavba / šarže (volitelné)</div>
                  <input value={heatLot} onChange={(e) => setHeatLot(e.target.value)} style={{ ...UI.inputs.base, maxWidth: 400 }} />
                </div>
              )}

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
                    {[
                      "Typ",
                      "Množství",
                      "Datum",
                      "Tavba / šarže",
                      "Dodavatel",
                      "DL",
                      "Atest",
                      "Reference",
                      "Přílohy",
                      "Poznámka",
                      "Akce",
                    ].map((h) => (
                      <th key={h} style={{ ...UI.th, fontSize: 12, padding: "10px 8px", whiteSpace: "nowrap" }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id}>
                      <td style={{ ...UI.td, padding: "10px 8px", whiteSpace: "nowrap", fontWeight: 800 }}>{row.movement_type}</td>
                      <td style={{ ...UI.td, padding: "10px 8px", whiteSpace: "nowrap" }}>{row.qty} mm</td>
                      <td style={{ ...UI.td, padding: "10px 8px", whiteSpace: "nowrap" }}>{formatDate(row.movement_date)}</td>
                      <td style={{ ...UI.td, padding: "10px 8px", maxWidth: 140 }}>{row.heat_lot || "—"}</td>
                      <td style={{ ...UI.td, padding: "10px 8px", maxWidth: 120 }}>{row.supplier_name || "—"}</td>
                      <td style={{ ...UI.td, padding: "10px 8px", maxWidth: 100 }}>{row.delivery_note_no || "—"}</td>
                      <td style={{ ...UI.td, padding: "10px 8px", maxWidth: 100 }}>{row.certificate_no || "—"}</td>
                      <td style={{ ...UI.td, padding: "10px 8px", maxWidth: 120 }}>{row.reference || "—"}</td>
                      <td style={{ ...UI.td, padding: "10px 8px", fontSize: 12 }}>
                        {(row.attachments && row.attachments.length > 0) ? (
                          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                            {row.attachments.map((a) => (
                              <a
                                key={a.id}
                                href={materialMovementAttachmentFileUrl(a.download_url)}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{ color: "#2563eb", fontWeight: 700 }}
                              >
                                {a.original_filename}
                              </a>
                            ))}
                          </div>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td style={{ ...UI.td, padding: "10px 8px", maxWidth: 160 }}>{row.note || "—"}</td>
                      <td style={{ ...UI.td, padding: "10px 8px", whiteSpace: "nowrap", display: "flex", gap: 6 }}>
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
                      <td colSpan={11} style={{ ...UI.td, textAlign: "center", color: "#64748b", padding: "14px 10px" }}>
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
