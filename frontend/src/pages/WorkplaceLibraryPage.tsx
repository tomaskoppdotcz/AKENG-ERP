import React, { useCallback, useEffect, useMemo, useState } from "react";
import { UI } from "../styles/ui";
import {
  createWorkplaceLibraryItem,
  deleteWorkplaceLibraryItem,
  getWorkplaceLibraryItems,
  updateWorkplaceLibraryItem,
  type WorkplaceLibraryItem,
} from "../services/masterLibrariesApi";
import { buildSearchHaystack, matchesSearchQuery } from "../overview/overviewSearch";

function formatRate(v: number | null): string {
  if (v == null) return "—";
  return v.toLocaleString("cs-CZ", { maximumFractionDigits: 2 });
}

function formatHours(v: number | null): string {
  if (v == null) return "—";
  return v.toLocaleString("cs-CZ", { maximumFractionDigits: 2 });
}

function parseOptionalFloat(s: string): number | null {
  const t = s.trim().replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export default function WorkplaceLibraryPage() {
  const [rows, setRows] = useState<WorkplaceLibraryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [formCode, setFormCode] = useState("");
  const [formName, setFormName] = useState("");
  const [formType, setFormType] = useState("");
  const [formHourly, setFormHourly] = useState("");
  const [formDailyCap, setFormDailyCap] = useState("");
  const [formActive, setFormActive] = useState(true);
  const [formPlannable, setFormPlannable] = useState(true);

  const loadRows = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getWorkplaceLibraryItems();
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
    return rows.filter((r) => {
      const hay = buildSearchHaystack(
        r.code,
        r.name,
        r.workplace_type,
        r.hourly_rate != null ? String(r.hourly_rate) : "",
        r.daily_capacity_hours != null ? String(r.daily_capacity_hours) : "",
        r.is_plannable === false ? "neplanovat" : "",
        r.is_active === false ? "neaktivni" : ""
      );
      return matchesSearchQuery(query, hay);
    });
  }, [rows, query]);

  function openCreate() {
    setEditingId(null);
    setFormCode("");
    setFormName("");
    setFormType("");
    setFormHourly("");
    setFormDailyCap("");
    setFormActive(true);
    setFormPlannable(true);
    setShowForm(true);
    setError(null);
  }

  function openEdit(r: WorkplaceLibraryItem) {
    setEditingId(r.id);
    setFormCode(r.code ?? "");
    setFormName(r.name);
    setFormType(r.workplace_type ?? "");
    setFormHourly(r.hourly_rate != null ? String(r.hourly_rate) : "");
    setFormDailyCap(r.daily_capacity_hours != null ? String(r.daily_capacity_hours) : "");
    setFormActive(r.is_active);
    setFormPlannable(r.is_plannable !== false);
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
      setError("Vyplňte název pracoviště.");
      return;
    }
    const hourly = parseOptionalFloat(formHourly);
    const daily = parseOptionalFloat(formDailyCap);
    if (formHourly.trim() && hourly === null) {
      setError("Hodinová sazba musí být platné číslo.");
      return;
    }
    if (formDailyCap.trim() && daily === null) {
      setError("Denní kapacita musí být platné číslo.");
      return;
    }
    setSaving(true);
    setError(null);
    const payload = {
      code: formCode.trim() || null,
      name,
      workplace_type: formType.trim() || null,
      hourly_rate: hourly,
      daily_capacity_hours: daily,
      is_active: formActive,
      is_plannable: formPlannable,
    };
    try {
      if (editingId != null) {
        await updateWorkplaceLibraryItem(editingId, payload);
      } else {
        await createWorkplaceLibraryItem(payload);
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
    if (!window.confirm("Opravdu chcete smazat toto pracoviště?")) return;
    setError(null);
    try {
      await deleteWorkplaceLibraryItem(id);
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
          placeholder="Hledat kód, název, typ pracoviště…"
          style={{ ...UI.inputs.base, flex: "1 1 280px", minWidth: 200, maxWidth: 480 }}
        />
        <button type="button" style={UI.buttons.primary} onClick={openCreate}>
          Nové pracoviště
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
            {editingId != null ? "Upravit pracoviště" : "Nové pracoviště"}
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
            <div>
              <div style={UI.inputs.label}>Typ pracoviště</div>
              <input value={formType} onChange={(e) => setFormType(e.target.value)} style={UI.inputs.base} />
            </div>
            <div>
              <div style={UI.inputs.label}>Hodinová sazba</div>
              <input value={formHourly} onChange={(e) => setFormHourly(e.target.value)} style={UI.inputs.base} />
            </div>
            <div>
              <div style={UI.inputs.label}>Denní kapacita (h)</div>
              <input value={formDailyCap} onChange={(e) => setFormDailyCap(e.target.value)} style={UI.inputs.base} />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 20 }}>
              <label style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 700 }}>
                <input type="checkbox" checked={formActive} onChange={(e) => setFormActive(e.target.checked)} />
                Aktivní
              </label>
              <label style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 700 }}>
                <input type="checkbox" checked={formPlannable} onChange={(e) => setFormPlannable(e.target.checked)} />
                V Planneru (Gantt)
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

      {loading ? <div style={UI.sectionSubtitle}>Načítám pracoviště…</div> : null}
      {error ? <div style={{ color: "#b91c1c", fontWeight: 700, marginBottom: 8 }}>{error}</div> : null}

      {!loading ? (
        <div style={{ overflowX: "auto" }}>
          <table style={UI.table}>
            <thead>
              <tr style={{ background: "#f8fafc" }}>
                {[
                  "Kód",
                  "Název",
                  "Typ pracoviště",
                  "Hodinová sazba",
                  "Denní kapacita (h)",
                  "Aktivní",
                  "Planner",
                  "Akce",
                ].map((h) => (
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
                  <td style={{ ...UI.td, padding: "10px 10px" }}>{r.workplace_type ?? "—"}</td>
                  <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>{formatRate(r.hourly_rate)}</td>
                  <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>
                    {formatHours(r.daily_capacity_hours)}
                  </td>
                  <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>{r.is_active ? "ANO" : "NE"}</td>
                  <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>
                    {r.is_plannable !== false ? "ANO" : "NE"}
                  </td>
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
