import React, { useCallback, useEffect, useMemo, useState } from "react";
import { UI } from "../styles/ui";
import {
  createMaterialLibraryItem,
  deleteMaterialLibraryItem,
  getMaterialGroups,
  getMaterialLibraryItems,
  updateMaterialLibraryItem,
  type MaterialGroup,
  type MaterialLibraryItem,
} from "../services/materialLibraryApi";
import { buildSearchHaystack, matchesSearchQuery } from "../overview/overviewSearch";

function formatMoney(v: number | null): string {
  if (v == null) return "—";
  return v.toLocaleString("cs-CZ", { maximumFractionDigits: 2 });
}

const fmtKgPerMm = new Intl.NumberFormat("cs-CZ", {
  minimumFractionDigits: 6,
  maximumFractionDigits: 6,
});
const fmtPricePerMm = new Intl.NumberFormat("cs-CZ", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatKgPerMm(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return "—";
  return fmtKgPerMm.format(v);
}

function formatPricePerMm(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return "—";
  return fmtPricePerMm.format(v);
}

function parseOptionalFloat(s: string): number | null {
  const t = s.trim().replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

const MATERIAL_FORM_OPTIONS = [
  "Tyč kruhová",
  "Tyč čtyřhranná",
  "Tyč šestihranná",
  "Trubka",
  "Plech",
  "Výkovek",
  "Odlitek",
  "Profil",
  "Jiný",
] as const;

const MATERIAL_FORM_OPTION_SET = new Set<string>(MATERIAL_FORM_OPTIONS);

export default function MaterialLibraryPage() {
  const [rows, setRows] = useState<MaterialLibraryItem[]>([]);
  const [groups, setGroups] = useState<MaterialGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [groupFilter, setGroupFilter] = useState<number | "">("");
  const [formFilter, setFormFilter] = useState<string>("");
  const [dimensionSort, setDimensionSort] = useState<"asc" | "desc" | null>("asc");

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [formCode, setFormCode] = useState("");
  const [formName, setFormName] = useState("");
  const [formForm, setFormForm] = useState("");
  const [formDimension, setFormDimension] = useState("");
  const [formUnit, setFormUnit] = useState("");
  const [formDensity, setFormDensity] = useState("");
  const [formPriceKg, setFormPriceKg] = useState("");
  const [formPriceUnit, setFormPriceUnit] = useState("");
  const [formMaterialGroupId, setFormMaterialGroupId] = useState<number | "">("");
  const [formActive, setFormActive] = useState(true);

  const loadRows = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [data, groupData] = await Promise.all([getMaterialLibraryItems(), getMaterialGroups()]);
      setRows(data);
      setGroups(groupData);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Nepodařilo se načíst data.");
      setRows([]);
      setGroups([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRows();
  }, [loadRows]);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      const groupLabel = r.material_group_name ?? "";
      const hay = buildSearchHaystack(
        r.scan_code,
        r.code,
        r.name,
        groupLabel,
        r.form,
        r.dimension,
        r.unit,
        r.density != null ? String(r.density) : "",
        r.price_per_kg != null ? String(r.price_per_kg) : "",
        r.price_per_unit != null ? String(r.price_per_unit) : "",
        r.kg_per_mm != null ? String(r.kg_per_mm) : "",
        r.price_per_mm != null ? String(r.price_per_mm) : ""
      );
      const matchesText = matchesSearchQuery(query, hay);
      const matchesGroup = groupFilter === "" || r.material_group_id === groupFilter;
      const matchesForm = !formFilter || r.form === formFilter;
      return matchesText && matchesGroup && matchesForm;
    });
  }, [rows, query, groupFilter, formFilter]);

  const formFilterOptions = useMemo(() => {
    const fromRows = new Set(rows.map((r) => r.form?.trim()).filter((v): v is string => Boolean(v)));
    const fixed = [...MATERIAL_FORM_OPTIONS];
    const extras = Array.from(fromRows).filter((v) => !MATERIAL_FORM_OPTION_SET.has(v)).sort((a, b) => a.localeCompare(b, "cs"));
    return [...fixed, ...extras];
  }, [rows]);

  const filteredAndSorted = useMemo(() => {
    if (!dimensionSort) return filtered;
    const withNum = [...filtered];
    withNum.sort((a, b) => {
      const av = parseFloat(a.dimension);
      const bv = parseFloat(b.dimension);
      const an = Number.isFinite(av) ? av : Number.POSITIVE_INFINITY;
      const bn = Number.isFinite(bv) ? bv : Number.POSITIVE_INFINITY;
      return dimensionSort === "asc" ? an - bn : bn - an;
    });
    return withNum;
  }, [filtered, dimensionSort]);

  function toggleDimensionSort() {
    setDimensionSort((prev) => (prev === "asc" ? "desc" : "asc"));
  }

  function openCreate() {
    setEditingId(null);
    setFormCode("");
    setFormName("");
    setFormForm("");
    setFormDimension("");
    setFormUnit("");
    setFormDensity("");
    setFormPriceKg("");
    setFormPriceUnit("");
    setFormMaterialGroupId("");
    setFormActive(true);
    setShowForm(true);
    setError(null);
  }

  function openEdit(r: MaterialLibraryItem) {
    setEditingId(r.id);
    setFormCode(r.code);
    setFormName(r.name);
    setFormForm(r.form);
    setFormDimension(r.dimension);
    setFormUnit(r.unit);
    setFormDensity(r.density != null ? String(r.density) : "");
    setFormPriceKg(r.price_per_kg != null ? String(r.price_per_kg) : "");
    setFormPriceUnit(r.price_per_unit != null ? String(r.price_per_unit) : "");
    setFormMaterialGroupId(r.material_group_id ?? "");
    setFormActive(r.is_active);
    setShowForm(true);
    setError(null);
  }

  function closeForm() {
    setShowForm(false);
    setEditingId(null);
  }

  async function handleSave() {
    const code = formCode.trim();
    const name = formName.trim();
    if (!code) {
      setError("Vyplňte kód materiálu.");
      return;
    }
    if (!name) {
      setError("Vyplňte název materiálu.");
      return;
    }
    const density = parseOptionalFloat(formDensity);
    const priceKg = parseOptionalFloat(formPriceKg);
    const priceUnit = parseOptionalFloat(formPriceUnit);
    if (formDensity.trim() && density === null) {
      setError("Hustota musí být platné číslo.");
      return;
    }
    if (formPriceKg.trim() && priceKg === null) {
      setError("Cena/kg musí být platné číslo.");
      return;
    }
    if (formPriceUnit.trim() && priceUnit === null) {
      setError("Cena/jednotka musí být platné číslo.");
      return;
    }

    setSaving(true);
    setError(null);
    const payload = {
      code,
      name,
      material_type: "",
      form: formForm.trim(),
      dimension: formDimension.trim(),
      unit: formUnit.trim(),
      density,
      price_per_kg: priceKg,
      price_per_unit: priceUnit,
      material_group_id: formMaterialGroupId === "" ? null : formMaterialGroupId,
      is_active: formActive,
    };
    try {
      if (editingId != null) {
        await updateMaterialLibraryItem(editingId, payload);
      } else {
        await createMaterialLibraryItem(payload);
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
    if (!window.confirm("Opravdu chcete smazat tento materiál?")) return;
    setError(null);
    try {
      await deleteMaterialLibraryItem(id);
      await loadRows();
      if (editingId === id) closeForm();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Smazání se nezdařilo.");
    }
  }

  return (
    <div className="erp-overview-page" style={{ ...UI.card, borderRadius: 14, padding: 16 }}>
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
          placeholder="Hledat kód, název, rozměr, skupinu…"
          style={{ ...UI.inputs.base, flex: "1 1 280px", minWidth: 200, maxWidth: 480 }}
        />
        <select
          value={groupFilter === "" ? "" : String(groupFilter)}
          onChange={(e) => setGroupFilter(e.target.value ? Number(e.target.value) : "")}
          style={{ ...UI.inputs.base, width: 220 }}
        >
          <option value="">Skupina: vše</option>
          {groups.map((g) => (
            <option key={g.id} value={String(g.id)}>
              {g.name}
            </option>
          ))}
        </select>
        <select
          value={formFilter}
          onChange={(e) => setFormFilter(e.target.value)}
          style={{ ...UI.inputs.base, width: 220 }}
          title="Forma"
        >
          <option value="">Forma: vše</option>
          {formFilterOptions.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
        <button type="button" style={UI.buttons.primary} onClick={openCreate}>
          Nový materiál
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
            {editingId != null ? "Upravit materiál" : "Nový materiál"}
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
              <div style={UI.inputs.label}>Forma</div>
              <select
                value={formForm}
                onChange={(e) => setFormForm(e.target.value)}
                style={UI.inputs.base}
              >
                <option value="">Vyberte formu</option>
                {formForm && !MATERIAL_FORM_OPTION_SET.has(formForm) ? (
                  <option value={formForm}>{formForm}</option>
                ) : null}
                {MATERIAL_FORM_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <div style={UI.inputs.label}>Skupina</div>
              <select
                value={formMaterialGroupId === "" ? "" : String(formMaterialGroupId)}
                onChange={(e) => setFormMaterialGroupId(e.target.value ? Number(e.target.value) : "")}
                style={UI.inputs.base}
              >
                <option value="">Bez skupiny</option>
                {groups.map((g) => (
                  <option key={g.id} value={String(g.id)}>
                    {g.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <div style={UI.inputs.label}>Rozměr</div>
              <input value={formDimension} onChange={(e) => setFormDimension(e.target.value)} style={UI.inputs.base} />
            </div>
            <div>
              <div style={UI.inputs.label}>Jednotka</div>
              <input value={formUnit} onChange={(e) => setFormUnit(e.target.value)} style={UI.inputs.base} />
            </div>
            <div>
              <div style={UI.inputs.label}>Hustota</div>
              <input value={formDensity} onChange={(e) => setFormDensity(e.target.value)} style={UI.inputs.base} />
            </div>
            <div>
              <div style={UI.inputs.label}>Cena/kg</div>
              <input value={formPriceKg} onChange={(e) => setFormPriceKg(e.target.value)} style={UI.inputs.base} />
            </div>
            <div>
              <div style={UI.inputs.label}>Cena/jednotka</div>
              <input value={formPriceUnit} onChange={(e) => setFormPriceUnit(e.target.value)} style={UI.inputs.base} />
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

      {loading ? <div style={UI.sectionSubtitle}>Načítám materiály…</div> : null}
      {error ? <div style={{ color: "#b91c1c", fontWeight: 700, marginBottom: 8 }}>{error}</div> : null}

      {!loading ? (
        <div className="erp-table-wrap" style={{ overflowX: "auto" }}>
          <table style={UI.table}>
            <thead>
              <tr style={{ background: "#f8fafc" }}>
                <th style={{ ...UI.th, fontSize: 13, padding: "10px 10px", whiteSpace: "nowrap" }}>Kód</th>
                <th style={{ ...UI.th, fontSize: 13, padding: "10px 10px", whiteSpace: "nowrap" }}>Scan kód</th>
                <th style={{ ...UI.th, fontSize: 13, padding: "10px 10px", whiteSpace: "nowrap" }}>Název</th>
                <th style={{ ...UI.th, fontSize: 13, padding: "10px 10px", whiteSpace: "nowrap" }}>Forma</th>
                <th style={{ ...UI.th, fontSize: 13, padding: "10px 10px", whiteSpace: "nowrap" }}>Skupina</th>
                <th
                  style={{ ...UI.th, fontSize: 13, padding: "10px 10px", whiteSpace: "nowrap", cursor: "pointer", userSelect: "none" }}
                  onClick={toggleDimensionSort}
                  title="Seřadit podle rozměru"
                >
                  Rozměr {dimensionSort === "asc" ? "↑" : dimensionSort === "desc" ? "↓" : ""}
                </th>
                <th style={{ ...UI.th, fontSize: 13, padding: "10px 10px", whiteSpace: "nowrap" }}>Jednotka</th>
                <th style={{ ...UI.th, fontSize: 13, padding: "10px 10px", whiteSpace: "nowrap" }}>Cena/kg</th>
                <th style={{ ...UI.th, fontSize: 13, padding: "10px 10px", whiteSpace: "nowrap" }}>Cena/jednotka</th>
                <th style={{ ...UI.th, fontSize: 13, padding: "10px 10px", whiteSpace: "nowrap" }}>kg / mm</th>
                <th style={{ ...UI.th, fontSize: 13, padding: "10px 10px", whiteSpace: "nowrap" }}>Kč / mm</th>
                <th style={{ ...UI.th, fontSize: 13, padding: "10px 10px", whiteSpace: "nowrap" }}>Aktivní</th>
                <th style={{ ...UI.th, fontSize: 13, padding: "10px 10px", whiteSpace: "nowrap" }}>Akce</th>
              </tr>
            </thead>
            <tbody>
              {filteredAndSorted.map((r) => (
                <tr key={r.id}>
                  <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>{r.code}</td>
                  <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>
                    {r.scan_code?.trim() ? r.scan_code : "—"}
                  </td>
                  <td style={{ ...UI.td, padding: "10px 10px" }}>{r.name}</td>
                  <td style={{ ...UI.td, padding: "10px 10px" }}>{r.form || "—"}</td>
                  <td style={{ ...UI.td, padding: "10px 10px" }}>{r.material_group_name || "—"}</td>
                  <td style={{ ...UI.td, padding: "10px 10px" }}>{r.dimension || "—"}</td>
                  <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>{r.unit || "—"}</td>
                  <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>{formatMoney(r.price_per_kg)}</td>
                  <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>{formatMoney(r.price_per_unit)}</td>
                  <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>{formatKgPerMm(r.kg_per_mm)}</td>
                  <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>{formatPricePerMm(r.price_per_mm)}</td>
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
