import React, { useEffect, useMemo, useState } from "react";
import { UI } from "../styles/ui";
import { getMaterialLibraryItems, type MaterialLibraryItem } from "../services/materialLibraryApi";
import {
  createMaterialStockItem,
  getMaterialStockItems,
  type MaterialStockItem,
} from "../services/materialStockApi";

type MaterialStockRow = MaterialStockItem & {
  material_dimension: string | null;
};

type Props = {
  onOpenDetail?: (item: MaterialStockRow) => void;
};

function norm(value: string): string {
  return value.trim().toLowerCase();
}

export default function MaterialStockPage({ onOpenDetail }: Props) {
  const [rows, setRows] = useState<MaterialStockRow[]>([]);
  const [libraryItems, setLibraryItems] = useState<MaterialLibraryItem[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<number | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [materialLibraryItemId, setMaterialLibraryItemId] = useState<number | null>(null);
  const [location, setLocation] = useState("");
  const [currentQty, setCurrentQty] = useState("0");
  const [minQty, setMinQty] = useState("");
  const [unit, setUnit] = useState("");
  const [note, setNote] = useState("");
  const [isActive, setIsActive] = useState(true);

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const [stockItems, libItems] = await Promise.all([getMaterialStockItems(), getMaterialLibraryItems()]);
      const byMaterialId = new Map<number, MaterialLibraryItem>();
      for (const item of libItems) byMaterialId.set(item.id, item);
      const mapped = stockItems.map((s) => ({
        ...s,
        material_dimension: byMaterialId.get(s.material_library_item_id)?.dimension ?? null,
      }));
      setRows(mapped);
      setLibraryItems(libItems);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Nepodařilo se načíst sklad materiálu.");
      setRows([]);
      setLibraryItems([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    loadData().catch(() => {
      // handled in loadData
    });

    return () => {
      cancelled = true;
    };
  }, []);

  function parseOptionalNumber(value: string): number | null {
    const t = value.trim().replace(",", ".");
    if (!t) return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }

  function resetForm() {
    setMaterialLibraryItemId(null);
    setLocation("");
    setCurrentQty("0");
    setMinQty("");
    setUnit("");
    setNote("");
    setIsActive(true);
    setFormError(null);
    setShowCreateForm(false);
  }

  async function handleCreate() {
    if (materialLibraryItemId == null) {
      setFormError("Vyberte materiál.");
      return;
    }
    const parsedCurrent = parseOptionalNumber(currentQty);
    const parsedMin = parseOptionalNumber(minQty);
    if (parsedCurrent == null) {
      setFormError("Stav musí být platné číslo.");
      return;
    }
    if (minQty.trim() && parsedMin == null) {
      setFormError("Min. zásoba musí být platné číslo.");
      return;
    }

    setSaving(true);
    setFormError(null);
    try {
      await createMaterialStockItem({
        material_library_item_id: materialLibraryItemId,
        location: location.trim() || null,
        current_qty: parsedCurrent,
        min_qty: parsedMin,
        unit: unit.trim() || null,
        note: note.trim() || null,
        is_active: isActive,
      });
      await loadData();
      resetForm();
    } catch (e: unknown) {
      setFormError(e instanceof Error ? e.message : "Nepodařilo se vytvořit skladovou kartu.");
    } finally {
      setSaving(false);
    }
  }

  const filtered = useMemo(() => {
    const q = norm(query);
    if (!q) return rows;
    return rows.filter((r) =>
      norm(
        `${r.material_name} ${r.material_code} ${r.material_dimension ?? ""} ${r.location ?? ""} ${r.unit ?? ""}`
      ).includes(q)
    );
  }, [rows, query]);

  return (
    <div style={UI.container}>
      <div style={{ paddingTop: 10, display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={UI.pageHeaderRow}>
          <div>
            <div style={UI.sectionTitle}>Sklad materiálu</div>
            <div style={UI.sectionSubtitle}>Přehled stavu materiálu</div>
          </div>
          <div style={UI.pageHeaderActions}>
            <button type="button" style={UI.buttons.primary} onClick={() => setShowCreateForm((v) => !v)}>
              Nová skladová karta
            </button>
          </div>
        </div>

        <div style={{ ...UI.card, borderRadius: 14, padding: 16 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12 }}>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Hledat materiál, kód, rozměr, lokaci..."
              style={UI.inputs.base}
            />
          </div>

          {loading ? <div style={UI.sectionSubtitle}>Načítám sklad materiálu...</div> : null}
          {error ? <div style={{ color: "#b91c1c", fontWeight: 700 }}>{error}</div> : null}

          {showCreateForm ? (
            <div style={{ ...UI.card, padding: 12, marginBottom: 12, background: "#f8fafc", border: "1px solid #e2e8f0" }}>
              {formError ? <div style={{ color: "#b91c1c", fontWeight: 700, marginBottom: 10 }}>{formError}</div> : null}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
                <div>
                  <div style={UI.inputs.label}>Materiál</div>
                  <select
                    value={materialLibraryItemId == null ? "" : String(materialLibraryItemId)}
                    onChange={(e) => setMaterialLibraryItemId(e.target.value ? Number(e.target.value) : null)}
                    style={UI.inputs.base}
                  >
                    <option value="">Vyberte materiál</option>
                    {libraryItems.map((m) => (
                      <option key={m.id} value={String(m.id)}>
                        {m.code} | {m.name} | {m.dimension}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <div style={UI.inputs.label}>Lokace</div>
                  <input value={location} onChange={(e) => setLocation(e.target.value)} style={UI.inputs.base} />
                </div>
                <div>
                  <div style={UI.inputs.label}>Stav</div>
                  <input value={currentQty} onChange={(e) => setCurrentQty(e.target.value)} style={UI.inputs.base} />
                </div>
                <div>
                  <div style={UI.inputs.label}>Min. zásoba</div>
                  <input value={minQty} onChange={(e) => setMinQty(e.target.value)} style={UI.inputs.base} />
                </div>
                <div>
                  <div style={UI.inputs.label}>Jednotka</div>
                  <input value={unit} onChange={(e) => setUnit(e.target.value)} style={UI.inputs.base} />
                </div>
                <div>
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
              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <button type="button" style={UI.buttons.secondary} onClick={resetForm} disabled={saving}>
                  Zrušit
                </button>
                <button
                  type="button"
                  style={{ ...UI.buttons.primary, ...(saving ? { opacity: 0.7, cursor: "wait" } : {}) }}
                  onClick={handleCreate}
                  disabled={saving}
                >
                  {saving ? "Ukládám..." : "Uložit skladovou kartu"}
                </button>
              </div>
            </div>
          ) : null}

          {!loading && !error ? (
            <div style={{ overflowX: "auto" }}>
              <table style={UI.table}>
                <thead>
                  <tr style={{ background: "#f8fafc" }}>
                    {["Materiál", "Kód", "Rozměr", "Lokace", "Stav", "Min. zásoba"].map((h) => (
                      <th key={h} style={{ ...UI.th, fontSize: 13, padding: "10px 10px", whiteSpace: "nowrap" }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((row) => (
                    <tr
                      key={row.id}
                      onClick={() => onOpenDetail?.(row)}
                      onMouseEnter={() => setHoverId(row.id)}
                      onMouseLeave={() => setHoverId((id) => (id === row.id ? null : id))}
                      style={{ cursor: "pointer", background: hoverId === row.id ? "#eff6ff" : "#fff" }}
                    >
                      <td style={{ ...UI.td, padding: "10px 10px", fontWeight: 800 }}>{row.material_name}</td>
                      <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>{row.material_code || "—"}</td>
                      <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>{row.material_dimension || "—"}</td>
                      <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>{row.location || "—"}</td>
                      <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>
                        {row.current_qty} {row.unit || ""}
                      </td>
                      <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>
                        {row.min_qty == null ? "—" : `${row.min_qty} ${row.unit || ""}`}
                      </td>
                    </tr>
                  ))}
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={6} style={{ ...UI.td, textAlign: "center", color: "#64748b", padding: "14px 10px" }}>
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
