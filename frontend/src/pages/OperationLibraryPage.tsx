import React, { useCallback, useEffect, useMemo, useState } from "react";
import { UI } from "../styles/ui";
import {
  createOperationLibraryItem,
  deleteOperationLibraryItem,
  getOperationLibraryItems,
  updateOperationLibraryItem,
  type OperationLibraryItem,
} from "../services/masterLibrariesApi";

function norm(s: string) {
  return s.trim().toLowerCase();
}

export default function OperationLibraryPage() {
  const [rows, setRows] = useState<OperationLibraryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [formCode, setFormCode] = useState("");
  const [formName, setFormName] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formActive, setFormActive] = useState(true);

  const loadRows = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getOperationLibraryItems();
      setRows(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Nepodařilo se načíst data.");
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
    return rows.filter((r) => {
      const code = r.code ?? "";
      const desc = r.description ?? "";
      return norm(`${code} ${r.name} ${desc}`).includes(q);
    });
  }, [rows, query]);

  function openCreate() {
    setEditingId(null);
    setFormCode("");
    setFormName("");
    setFormDescription("");
    setFormActive(true);
    setShowForm(true);
    setError(null);
  }

  function openEdit(r: OperationLibraryItem) {
    setEditingId(r.id);
    setFormCode(r.code ?? "");
    setFormName(r.name);
    setFormDescription(r.description ?? "");
    setFormActive(r.is_active);
    setShowForm(true);
    setError(null);
  }

  function closeForm() {
    setShowForm(false);
    setEditingId(null);
  }

  async function handleSave() {
    const name = formName.trim();
    if (!name) {
      setError("Vyplňte název operace.");
      return;
    }
    setSaving(true);
    setError(null);
    const payload = {
      code: formCode.trim() || null,
      name,
      description: formDescription.trim() || null,
      is_active: formActive,
    };
    try {
      if (editingId != null) {
        await updateOperationLibraryItem(editingId, payload);
      } else {
        await createOperationLibraryItem(payload);
      }
      await loadRows();
      closeForm();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Uložení se nezdařilo.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: number) {
    if (!window.confirm("Opravdu chcete smazat tuto operaci?")) return;
    setError(null);
    try {
      await deleteOperationLibraryItem(id);
      await loadRows();
      if (editingId === id) closeForm();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Smazání se nezdařilo.");
    }
  }

  return (
    <div style={{ ...UI.card, borderRadius: 14, padding: 16 }}>
      <div
        style={{
          display: "flex",
          gap: 10,
          alignItems: "center",
          marginBottom: 12,
          flexWrap: "wrap",
          justifyContent: "space-between",
        }}
      >
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Hledat operaci nebo kód..."
          style={{ ...UI.inputs.base, flex: "1 1 280px", minWidth: 200, maxWidth: 480 }}
        />
        <button type="button" style={UI.buttons.primary} onClick={openCreate}>
          Nová operace
        </button>
      </div>

      {showForm ? (
        <div
          style={{
            ...UI.card,
            padding: 12,
            marginBottom: 12,
            background: "#f8fafc",
            border: "1px solid #e2e8f0",
          }}
        >
          <div style={{ ...UI.sectionTitle, fontSize: 16, marginBottom: 10 }}>
            {editingId != null ? "Upravit operaci" : "Nová operace"}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
            <div>
              <div style={UI.inputs.label}>Kód</div>
              <input value={formCode} onChange={(e) => setFormCode(e.target.value)} style={UI.inputs.base} />
            </div>
            <div>
              <div style={UI.inputs.label}>Název</div>
              <input value={formName} onChange={(e) => setFormName(e.target.value)} style={UI.inputs.base} />
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <div style={UI.inputs.label}>Popis</div>
              <input value={formDescription} onChange={(e) => setFormDescription(e.target.value)} style={UI.inputs.base} />
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
              {saving ? "Ukládám…" : "Uložit"}
            </button>
            <button type="button" style={UI.buttons.secondary} onClick={closeForm} disabled={saving}>
              Zrušit
            </button>
          </div>
        </div>
      ) : null}

      {loading ? <div style={UI.sectionSubtitle}>Načítám operace…</div> : null}
      {error ? <div style={{ color: "#b91c1c", fontWeight: 700, marginBottom: 8 }}>{error}</div> : null}

      {!loading ? (
        <div style={{ overflowX: "auto" }}>
          <table style={UI.table}>
            <thead>
              <tr style={{ background: "#f8fafc" }}>
                {["Kód", "Název", "Popis", "Aktivní", "Akce"].map((h) => (
                  <th key={h} style={{ ...UI.th, fontSize: 13, padding: "10px 10px", whiteSpace: "nowrap" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id}>
                  <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>{r.code ?? "—"}</td>
                  <td style={{ ...UI.td, padding: "10px 10px" }}>{r.name}</td>
                  <td style={{ ...UI.td, padding: "10px 10px" }}>{r.description ?? "—"}</td>
                  <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>{r.is_active ? "ANO" : "NE"}</td>
                  <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap", display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <button type="button" style={UI.buttons.secondary} onClick={() => openEdit(r)}>
                      Upravit
                    </button>
                    <button type="button" style={UI.buttons.secondary} onClick={() => handleDelete(r.id)}>
                      Smazat
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
