import React, { useCallback, useEffect, useMemo, useState } from "react";
import { UI } from "../styles/ui";
import {
  createStorageLocation,
  deleteStorageLocation,
  getStorageLocations,
  updateStorageLocation,
  type StorageLocation,
  type StorageLocationType,
} from "../services/storageLocationApi";

function norm(v: string): string {
  return v.trim().toLowerCase();
}

function typeLabel(t: StorageLocationType): string {
  if (t === "material") return "Materiál";
  if (t === "product") return "Výrobky";
  return "Oba";
}

export default function StorageLocationPage() {
  const [rows, setRows] = useState<StorageLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [formCode, setFormCode] = useState("");
  const [formName, setFormName] = useState("");
  const [formType, setFormType] = useState<StorageLocationType>("both");
  const [formActive, setFormActive] = useState(true);

  const loadRows = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await getStorageLocations());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Nepodařilo se načíst umístění.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRows();
  }, [loadRows]);

  const filtered = useMemo(() => {
    const q = norm(query);
    if (!q) return rows;
    return rows.filter((r) => norm(`${r.code} ${r.name} ${typeLabel(r.location_type)}`).includes(q));
  }, [rows, query]);

  function openCreate() {
    setEditingId(null);
    setFormCode("");
    setFormName("");
    setFormType("both");
    setFormActive(true);
    setShowForm(true);
  }

  function openEdit(row: StorageLocation) {
    setEditingId(row.id);
    setFormCode(row.code);
    setFormName(row.name);
    setFormType(row.location_type);
    setFormActive(row.is_active);
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setEditingId(null);
  }

  async function handleSave() {
    const code = formCode.trim();
    const name = formName.trim();
    if (!code) return setError("Vyplňte kód.");
    if (!name) return setError("Vyplňte název.");
    setSaving(true);
    setError(null);
    try {
      const payload = { code, name, location_type: formType, is_active: formActive };
      if (editingId == null) await createStorageLocation(payload);
      else await updateStorageLocation(editingId, payload);
      await loadRows();
      closeForm();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Uložení se nezdařilo.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: number) {
    if (!window.confirm("Opravdu chcete smazat toto umístění?")) return;
    setError(null);
    try {
      await deleteStorageLocation(id);
      await loadRows();
      if (editingId === id) closeForm();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Smazání se nezdařilo.");
    }
  }

  return (
    <div style={{ ...UI.card, borderRadius: 14, padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={UI.sectionTitle}>Umístění</div>
        <button type="button" style={UI.buttons.primary} onClick={openCreate}>
          Nové umístění
        </button>
      </div>

      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12 }}>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Hledat" style={UI.inputs.base} />
      </div>

      {showForm ? (
        <div style={{ ...UI.card, padding: 12, marginBottom: 12, background: "#f8fafc", border: "1px solid #e2e8f0" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
            <div>
              <div style={UI.inputs.label}>Kód</div>
              <input value={formCode} onChange={(e) => setFormCode(e.target.value)} style={UI.inputs.base} />
            </div>
            <div>
              <div style={UI.inputs.label}>Název</div>
              <input value={formName} onChange={(e) => setFormName(e.target.value)} style={UI.inputs.base} />
            </div>
            <div>
              <div style={UI.inputs.label}>Typ</div>
              <select value={formType} onChange={(e) => setFormType(e.target.value as StorageLocationType)} style={UI.inputs.base}>
                <option value="material">Materiál</option>
                <option value="product">Výrobky</option>
                <option value="both">Oba</option>
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
            <button type="button" style={UI.buttons.primary} onClick={handleSave} disabled={saving}>
              {saving ? "Ukládám..." : editingId == null ? "Uložit umístění" : "Uložit změny"}
            </button>
            <button type="button" style={UI.buttons.secondary} onClick={closeForm} disabled={saving}>
              Zrušit
            </button>
          </div>
        </div>
      ) : null}

      {loading ? <div style={UI.sectionSubtitle}>Načítám umístění...</div> : null}
      {error ? <div style={{ color: "#b91c1c", fontWeight: 700, marginBottom: 8 }}>{error}</div> : null}

      {!loading ? (
        <div style={{ overflowX: "auto" }}>
          <table style={UI.table}>
            <thead>
              <tr style={{ background: "#f8fafc" }}>
                <th style={{ ...UI.th, fontSize: 13, padding: "10px 10px", whiteSpace: "nowrap" }}>Kód</th>
                <th style={{ ...UI.th, fontSize: 13, padding: "10px 10px", whiteSpace: "nowrap" }}>Název</th>
                <th style={{ ...UI.th, fontSize: 13, padding: "10px 10px", whiteSpace: "nowrap" }}>Typ</th>
                <th style={{ ...UI.th, fontSize: 13, padding: "10px 10px", whiteSpace: "nowrap" }}>Aktivní</th>
                <th style={{ ...UI.th, fontSize: 13, padding: "10px 10px", whiteSpace: "nowrap" }}>Akce</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id}>
                  <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>{r.code}</td>
                  <td style={{ ...UI.td, padding: "10px 10px" }}>{r.name}</td>
                  <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>{typeLabel(r.location_type)}</td>
                  <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>{r.is_active ? "ANO" : "NE"}</td>
                  <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap", display: "flex", gap: 6 }}>
                    <button type="button" style={UI.buttons.secondary} onClick={() => openEdit(r)}>
                      Upravit
                    </button>
                    <button type="button" style={UI.buttons.secondary} onClick={() => handleDelete(r.id)}>
                      Smazat
                    </button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ ...UI.td, textAlign: "center", color: "#64748b", padding: "14px 10px" }}>
                    Žádné výsledky.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
