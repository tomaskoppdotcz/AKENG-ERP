import React, { useCallback, useEffect, useMemo, useState } from "react";
import { UI } from "../styles/ui";
import TableRowActionsMenu from "../components/table/TableRowActionsMenu";
import { getCustomers, type CustomerListItem } from "../services/masterLibrariesApi";
import {
  createPortfolioGroup,
  deletePortfolioGroup,
  getPortfolioGroups,
  updatePortfolioGroup,
  type PortfolioGroup,
} from "../services/portfolioApi";

function norm(s: string) {
  return s.trim().toLowerCase();
}

export default function PortfolioGroupLibraryPage() {
  const [rows, setRows] = useState<PortfolioGroup[]>([]);
  const [customers, setCustomers] = useState<CustomerListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [formName, setFormName] = useState("");
  const [formCode, setFormCode] = useState("");
  const [formCustomerId, setFormCustomerId] = useState("");
  const [formActive, setFormActive] = useState(true);

  const customerNameById = useMemo(() => {
    const m = new Map<number, string>();
    customers.forEach((c) => m.set(c.id, c.name));
    return m;
  }, [customers]);

  const loadRows = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [g, c] = await Promise.all([getPortfolioGroups(), getCustomers()]);
      setRows(g);
      setCustomers(c);
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
      const cust = customerNameById.get(r.customer_id) ?? "";
      return norm(`${r.name} ${r.code ?? ""} ${cust}`).includes(q);
    });
  }, [rows, query, customerNameById]);

  function openCreate() {
    setEditingId(null);
    setFormName("");
    setFormCode("");
    const first = customers.find((c) => c.is_active) ?? customers[0];
    setFormCustomerId(first != null ? String(first.id) : "");
    setFormActive(true);
    setShowForm(true);
    setError(null);
  }

  function openEdit(r: PortfolioGroup) {
    setEditingId(r.id);
    setFormName(r.name);
    setFormCode(r.code ?? "");
    setFormCustomerId(String(r.customer_id));
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
    const customerId = Number(formCustomerId);
    if (!name) {
      setError("Vyplňte název skupiny.");
      return;
    }
    if (!Number.isFinite(customerId) || customerId <= 0) {
      setError("Vyberte zákazníka.");
      return;
    }
    setSaving(true);
    setError(null);
    const codeTrim = formCode.trim();
    try {
      if (editingId != null) {
        await updatePortfolioGroup(editingId, {
          name,
          customer_id: customerId,
          code: codeTrim || null,
          is_active: formActive,
        });
      } else {
        await createPortfolioGroup({
          name,
          customer_id: customerId,
          code: codeTrim || null,
          is_active: formActive,
        });
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
    if (!window.confirm("Opravdu chcete smazat tuto skupinu portfolia?")) return;
    setError(null);
    try {
      await deletePortfolioGroup(id);
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
          placeholder="Hledat název, kód nebo zákazníka…"
          style={{ ...UI.inputs.base, flex: "1 1 280px", minWidth: 200, maxWidth: 480 }}
        />
        <button
          type="button"
          style={UI.buttons.primary}
          onClick={openCreate}
          disabled={customers.length === 0}
        >
          Nová skupina
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
            {editingId != null ? "Upravit skupinu portfolia" : "Nová skupina portfolia"}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
            <div>
              <div style={UI.inputs.label}>Název</div>
              <input value={formName} onChange={(e) => setFormName(e.target.value)} style={UI.inputs.base} />
            </div>
            <div>
              <div style={UI.inputs.label}>Kód</div>
              <input value={formCode} onChange={(e) => setFormCode(e.target.value)} style={UI.inputs.base} placeholder="volitelné" />
            </div>
            <div>
              <div style={UI.inputs.label}>Zákazník</div>
              <select
                value={formCustomerId}
                onChange={(e) => setFormCustomerId(e.target.value)}
                style={UI.inputs.base}
                disabled={customers.length === 0}
              >
                {customers.length === 0 ? (
                  <option value="">Žádný zákazník</option>
                ) : (
                  customers.map((c) => (
                    <option key={c.id} value={String(c.id)}>
                      {c.name}
                      {!c.is_active ? " (neaktivní)" : ""}
                    </option>
                  ))
                )}
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

      {loading ? <div style={UI.sectionSubtitle}>Načítám skupiny…</div> : null}
      {error ? <div style={{ color: "#b91c1c", fontWeight: 700, marginBottom: 8 }}>{error}</div> : null}

      {!loading ? (
        <div style={{ overflowX: "auto" }}>
          <table style={UI.table}>
            <thead>
              <tr style={{ background: "#f8fafc" }}>
                {["Název", "Kód", "Zákazník", "Aktivní", "Akce"].map((h) => (
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
                  <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>{r.code ?? "—"}</td>
                  <td style={{ ...UI.td, padding: "10px 10px" }}>{customerNameById.get(r.customer_id) ?? `ID ${r.customer_id}`}</td>
                  <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>{r.is_active ? "ANO" : "NE"}</td>
                  <td style={{ ...UI.td, padding: "10px 10px", textAlign: "right", whiteSpace: "nowrap" }}>
                    <TableRowActionsMenu
                      compact
                      align="end"
                      triggerLabel={`Akce — ${r.name}`}
                      actions={[
                        { key: "edit", label: "Upravit", onClick: () => openEdit(r) },
                        { key: "delete", label: "Smazat", danger: true, onClick: () => handleDelete(r.id) },
                      ]}
                    />
                  </td>
                </tr>
              ))}
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ ...UI.td, textAlign: "center", color: "#64748b", padding: "14px 10px" }}>
                    Žádné skupiny.
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
