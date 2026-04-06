import React, { useCallback, useEffect, useMemo, useState } from "react";
import { UI } from "../styles/ui";
import {
  createEmployeeMaster,
  getEmployeeSubgroups,
  getEmployeesMaster,
  updateEmployeeMaster,
  type EmployeeMasterRow,
  type EmployeeSubgroupRow,
} from "../services/masterLibrariesApi";

function norm(s: string) {
  return s.trim().toLowerCase();
}

export default function EmployeeLibraryPage() {
  const [rows, setRows] = useState<EmployeeMasterRow[]>([]);
  const [subgroups, setSubgroups] = useState<EmployeeSubgroupRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [formFirst, setFormFirst] = useState("");
  const [formLast, setFormLast] = useState("");
  const [formCode, setFormCode] = useState("");
  const [formCard, setFormCard] = useState("");
  const [formSubgroupId, setFormSubgroupId] = useState<number | "">("");
  const [formActive, setFormActive] = useState(true);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [emps, sgs] = await Promise.all([getEmployeesMaster(), getEmployeeSubgroups()]);
      setRows(emps);
      setSubgroups(sgs.filter((s) => s.is_active));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Nepodařilo se načíst zaměstnance.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const filtered = useMemo(() => {
    const q = norm(query);
    if (!q) return rows;
    return rows.filter((r) =>
      norm(`${r.first_name ?? ""} ${r.last_name ?? ""} ${r.name} ${r.employee_code} ${r.card_uid}`).includes(q)
    );
  }, [rows, query]);

  function openCreate() {
    setEditingId(null);
    setFormFirst("");
    setFormLast("");
    setFormCode("");
    setFormCard("");
    setFormSubgroupId("");
    setFormActive(true);
    setShowForm(true);
    setError(null);
  }

  function openEdit(r: EmployeeMasterRow) {
    setEditingId(r.id);
    setFormFirst(r.first_name ?? "");
    setFormLast(r.last_name ?? "");
    setFormCode(r.employee_code);
    setFormCard(r.card_uid);
    setFormSubgroupId(r.employee_subgroup_id ?? "");
    setFormActive(r.is_active);
    setShowForm(true);
    setError(null);
  }

  function closeForm() {
    setShowForm(false);
    setEditingId(null);
  }

  async function handleSave() {
    const first = formFirst.trim();
    const last = formLast.trim();
    const code = formCode.trim();
    const card = formCard.trim();
    if (!first || !last) {
      setError("Vyplňte jméno a příjmení.");
      return;
    }
    if (!code || !card) {
      setError("Vyplňte kód zaměstnance a UID karty (pro kiosk).");
      return;
    }
    setSaving(true);
    setError(null);
    const payload = {
      first_name: first,
      last_name: last,
      employee_code: code,
      card_uid: card,
      employee_subgroup_id: formSubgroupId === "" ? null : Number(formSubgroupId),
      is_active: formActive,
    };
    try {
      if (editingId != null) {
        await updateEmployeeMaster(editingId, payload);
      } else {
        await createEmployeeMaster(payload);
      }
      await loadAll();
      closeForm();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Uložení se nezdařilo.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ ...UI.card, borderRadius: 14, padding: 16 }}>
      <div style={{ marginBottom: 10 }}>
        <div style={UI.sectionTitle}>Zaměstnanci</div>
        <div style={UI.sectionSubtitle}>
          Záznamy pro přihlášení na kiosk (kód nebo UID karty). Jméno se použije i v přehledech.
        </div>
      </div>

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
          placeholder="Hledat jméno, kód, kartu…"
          style={{ ...UI.inputs.base, flex: "1 1 280px", minWidth: 200, maxWidth: 480 }}
        />
        <button type="button" style={UI.buttons.primary} onClick={openCreate}>
          Nový zaměstnanec
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
            {editingId != null ? "Upravit zaměstnance" : "Nový zaměstnanec"}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
            <div>
              <div style={UI.inputs.label}>Jméno</div>
              <input value={formFirst} onChange={(e) => setFormFirst(e.target.value)} style={UI.inputs.base} />
            </div>
            <div>
              <div style={UI.inputs.label}>Příjmení</div>
              <input value={formLast} onChange={(e) => setFormLast(e.target.value)} style={UI.inputs.base} />
            </div>
            <div>
              <div style={UI.inputs.label}>Kód zaměstnance (login kiosk)</div>
              <input value={formCode} onChange={(e) => setFormCode(e.target.value)} style={UI.inputs.base} />
            </div>
            <div>
              <div style={UI.inputs.label}>UID karty (login kiosk)</div>
              <input value={formCard} onChange={(e) => setFormCard(e.target.value)} style={UI.inputs.base} />
            </div>
            <div>
              <div style={UI.inputs.label}>Role / podskupina</div>
              <select
                value={formSubgroupId === "" ? "" : String(formSubgroupId)}
                onChange={(e) => setFormSubgroupId(e.target.value === "" ? "" : Number(e.target.value))}
                style={UI.inputs.base}
              >
                <option value="">—</option>
                {subgroups.map((s) => (
                  <option key={s.id} value={String(s.id)}>
                    {s.name}
                  </option>
                ))}
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
              {saving ? "Ukládám…" : "Uložit"}
            </button>
            <button type="button" style={UI.buttons.secondary} onClick={closeForm} disabled={saving}>
              Zrušit
            </button>
          </div>
        </div>
      ) : null}

      {loading ? <div style={UI.sectionSubtitle}>Načítám…</div> : null}
      {error ? <div style={{ color: "#b91c1c", fontWeight: 700, marginBottom: 8 }}>{error}</div> : null}

      {!loading ? (
        <div style={{ overflowX: "auto" }}>
          <table style={UI.table}>
            <thead>
              <tr style={{ background: "#f8fafc" }}>
                {["Jméno", "Kód", "Karta", "Role", "Aktivní", "Akce"].map((h) => (
                  <th key={h} style={{ ...UI.th, fontSize: 13, padding: "10px 10px", whiteSpace: "nowrap" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id}>
                  <td style={{ ...UI.td, padding: "10px 10px" }}>{r.name}</td>
                  <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>{r.employee_code}</td>
                  <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap", fontFamily: "monospace" }}>
                    {r.card_uid}
                  </td>
                  <td style={{ ...UI.td, padding: "10px 10px" }}>{r.subgroup_name ?? "—"}</td>
                  <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>{r.is_active ? "ANO" : "NE"}</td>
                  <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>
                    <button type="button" style={UI.buttons.secondary} onClick={() => openEdit(r)}>
                      Upravit
                    </button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ ...UI.td, textAlign: "center", color: "#64748b", padding: "14px 10px" }}>
                    Žádní zaměstnanci — vytvořte nejdříve role v záložce „Role zaměstnanců“.
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
