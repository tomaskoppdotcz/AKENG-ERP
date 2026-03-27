import React, { useCallback, useEffect, useMemo, useState } from "react";
import { UI } from "../styles/ui";
import {
  createCustomer,
  deleteCustomer,
  getCustomers,
  updateCustomer,
  type CustomerListItem,
} from "../services/masterLibrariesApi";

function norm(s: string) {
  return s.trim().toLowerCase();
}

function cell(v: string | null | undefined) {
  if (v == null || String(v).trim() === "") return "—";
  return v;
}

const inputMultiline: React.CSSProperties = {
  ...UI.inputs.base,
  minHeight: 72,
  resize: "vertical" as const,
  fontFamily: "inherit",
};

export default function CustomerLibraryPage() {
  const [rows, setRows] = useState<CustomerListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [formName, setFormName] = useState("");
  const [formIco, setFormIco] = useState("");
  const [formDic, setFormDic] = useState("");
  const [formBilling, setFormBilling] = useState("");
  const [formDelivery, setFormDelivery] = useState("");
  const [formContact, setFormContact] = useState("");
  const [formEmail, setFormEmail] = useState("");
  const [formPhone, setFormPhone] = useState("");
  const [formNote, setFormNote] = useState("");
  const [formActive, setFormActive] = useState(true);

  const loadRows = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getCustomers();
      setRows(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Nepodařilo se načíst zákazníky.");
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
      const hay = [r.name, r.code, r.ico, r.dic, r.contact_person, r.email].map((x) => (x ?? "").trim()).join(" ");
      return norm(hay).includes(q);
    });
  }, [rows, query]);

  function resetFormFields() {
    setFormName("");
    setFormIco("");
    setFormDic("");
    setFormBilling("");
    setFormDelivery("");
    setFormContact("");
    setFormEmail("");
    setFormPhone("");
    setFormNote("");
    setFormActive(true);
  }

  function openCreate() {
    setEditingId(null);
    resetFormFields();
    setShowForm(true);
    setError(null);
  }

  function openEdit(r: CustomerListItem) {
    setEditingId(r.id);
    setFormName(r.name);
    setFormIco(r.ico ?? "");
    setFormDic(r.dic ?? "");
    setFormBilling(r.billing_address ?? "");
    setFormDelivery(r.delivery_address ?? "");
    setFormContact(r.contact_person ?? "");
    setFormEmail(r.email ?? "");
    setFormPhone(r.phone ?? "");
    setFormNote(r.note ?? "");
    setFormActive(r.is_active);
    setShowForm(true);
    setError(null);
  }

  function closeForm() {
    setShowForm(false);
    setEditingId(null);
  }

  function buildPayload() {
    const name = formName.trim();
    return {
      name,
      is_active: formActive,
      ico: formIco.trim() || null,
      dic: formDic.trim() || null,
      billing_address: formBilling.trim() || null,
      delivery_address: formDelivery.trim() || null,
      contact_person: formContact.trim() || null,
      email: formEmail.trim() || null,
      phone: formPhone.trim() || null,
      note: formNote.trim() || null,
    };
  }

  async function handleSave() {
    const name = formName.trim();
    if (!name) {
      setError("Vyplňte název zákazníka.");
      return;
    }
    setSaving(true);
    setError(null);
    const payload = buildPayload();
    try {
      if (editingId != null) {
        await updateCustomer(editingId, payload);
      } else {
        await createCustomer(payload);
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
    if (!window.confirm("Opravdu chcete smazat tohoto zákazníka?")) return;
    setError(null);
    try {
      await deleteCustomer(id);
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
          placeholder="Hledat název, IČ, DIČ, kontakt, e-mail…"
          style={{ ...UI.inputs.base, flex: "1 1 280px", minWidth: 200, maxWidth: 480 }}
        />
        <button type="button" style={UI.buttons.primary} onClick={openCreate}>
          Nový zákazník
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
            {editingId != null ? "Upravit zákazníka" : "Nový zákazník"}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
            <div>
              <div style={UI.inputs.label}>Název</div>
              <input value={formName} onChange={(e) => setFormName(e.target.value)} style={UI.inputs.base} />
            </div>
            <div>
              <div style={UI.inputs.label}>IČ</div>
              <input value={formIco} onChange={(e) => setFormIco(e.target.value)} style={UI.inputs.base} />
            </div>
            <div>
              <div style={UI.inputs.label}>DIČ</div>
              <input value={formDic} onChange={(e) => setFormDic(e.target.value)} style={UI.inputs.base} />
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <div style={UI.inputs.label}>Fakturační adresa</div>
              <textarea value={formBilling} onChange={(e) => setFormBilling(e.target.value)} style={inputMultiline} />
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <div style={UI.inputs.label}>Doručovací adresa</div>
              <textarea value={formDelivery} onChange={(e) => setFormDelivery(e.target.value)} style={inputMultiline} />
            </div>
            <div>
              <div style={UI.inputs.label}>Kontaktní osoba</div>
              <input value={formContact} onChange={(e) => setFormContact(e.target.value)} style={UI.inputs.base} />
            </div>
            <div>
              <div style={UI.inputs.label}>E-mail</div>
              <input value={formEmail} onChange={(e) => setFormEmail(e.target.value)} style={UI.inputs.base} type="email" />
            </div>
            <div>
              <div style={UI.inputs.label}>Telefon</div>
              <input value={formPhone} onChange={(e) => setFormPhone(e.target.value)} style={UI.inputs.base} />
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <div style={UI.inputs.label}>Poznámka</div>
              <textarea value={formNote} onChange={(e) => setFormNote(e.target.value)} style={inputMultiline} />
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

      {loading ? <div style={UI.sectionSubtitle}>Načítám zákazníky…</div> : null}
      {error ? <div style={{ color: "#b91c1c", fontWeight: 700, marginBottom: 8 }}>{error}</div> : null}

      {!loading ? (
        <div style={{ overflowX: "auto" }}>
          <table style={UI.table}>
            <thead>
              <tr style={{ background: "#f8fafc" }}>
                {["Název", "IČ", "DIČ", "Kontaktní osoba", "E-mail", "Telefon", "Aktivní", "Akce"].map((h) => (
                  <th key={h} style={{ ...UI.th, fontSize: 13, padding: "10px 10px", whiteSpace: "nowrap" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id}>
                  <td style={{ ...UI.td, padding: "10px 10px", fontWeight: 700 }}>{r.name}</td>
                  <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>{cell(r.ico)}</td>
                  <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>{cell(r.dic)}</td>
                  <td style={{ ...UI.td, padding: "10px 10px" }}>{cell(r.contact_person)}</td>
                  <td style={{ ...UI.td, padding: "10px 10px", wordBreak: "break-all" }}>{cell(r.email)}</td>
                  <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>{cell(r.phone)}</td>
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
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ ...UI.td, textAlign: "center", color: "#64748b", padding: "14px 10px" }}>
                    Žádní zákazníci.
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
