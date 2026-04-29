import React, { useCallback, useEffect, useMemo, useState } from "react";
import { UI } from "../styles/ui";
import {
  createEmployeeMaster,
  deleteEmployeeMaster,
  getEmployeeSubgroups,
  getEmployeesMaster,
  updateEmployeeMaster,
  type EmployeeListActiveFilter,
  type EmployeeMasterRow,
  type EmployeeSubgroupRow,
} from "../services/masterLibrariesApi";
import { normalizeCzechKeyboardReaderNumeric } from "../utils/czCardReaderNormalize";
import { buildSearchHaystack, matchesSearchQuery } from "../overview/overviewSearch";
import InlineBanner from "../components/InlineBanner";
import {
  interpretError,
  runWriteAction,
  type WriteFeedback,
} from "../utils/writeActionFeedback";

const pillBase: React.CSSProperties = {
  display: "inline-block",
  fontSize: 11,
  fontWeight: 700,
  padding: "2px 8px",
  borderRadius: 999,
  marginRight: 4,
  marginBottom: 4,
  whiteSpace: "nowrap",
};

function loginMethodPills(r: EmployeeMasterRow) {
  const items: { label: string; show: boolean }[] = [
    { label: "Kód", show: true },
    { label: "Čip", show: r.has_chip_login },
    { label: "PIN", show: r.has_pin_login },
    { label: "Sken", show: r.has_scan_login },
 ];
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, maxWidth: 300, alignItems: "center" }}>
      {items
        .filter((x) => x.show)
        .map((x) => (
          <span
            key={x.label}
            style={{
              ...pillBase,
              background: "#dbeafe",
              color: "#1e40af",
            }}
          >
            {x.label}
          </span>
        ))}
      <span
        style={{
          ...pillBase,
          background: r.can_use_kiosk ? "#dcfce7" : "#f1f5f9",
          color: r.can_use_kiosk ? "#166534" : "#64748b",
        }}
      >
        {r.can_use_kiosk ? "Kiosk" : "Kiosk vyp."}
      </span>
    </div>
  );
}

export default function EmployeeLibraryPage() {
  const [rows, setRows] = useState<EmployeeMasterRow[]>([]);
  const [subgroups, setSubgroups] = useState<EmployeeSubgroupRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionFeedback, setActionFeedback] = useState<WriteFeedback | null>(null);

  function showError(message: string) {
    setActionFeedback({ kind: "error", message });
  }
  function clearFeedback() {
    setActionFeedback(null);
  }
  const [query, setQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<EmployeeListActiveFilter>("all");

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [formFirst, setFormFirst] = useState("");
  const [formLast, setFormLast] = useState("");
  const [formCode, setFormCode] = useState("");
  const [formChip, setFormChip] = useState("");
  const [formScan, setFormScan] = useState("");
  const [formPin, setFormPin] = useState("");
  const [formClearPin, setFormClearPin] = useState(false);
  const [formSubgroupId, setFormSubgroupId] = useState<number | "">("");
  const [formActive, setFormActive] = useState(true);
  const [formKiosk, setFormKiosk] = useState(true);
  const [formPhone, setFormPhone] = useState("");
  const [formEmail, setFormEmail] = useState("");
  const [formStreet, setFormStreet] = useState("");
  const [formCity, setFormCity] = useState("");
  const [formPostal, setFormPostal] = useState("");
  const [formCountry, setFormCountry] = useState("");
  const [formBirth, setFormBirth] = useState("");
  const [formJob, setFormJob] = useState("");
  const [formRate, setFormRate] = useState("");
  const [formNote, setFormNote] = useState("");

  const loadAll = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent === true;
    if (!silent) setLoading(true);
    try {
      const [emps, sgs] = await Promise.all([
        getEmployeesMaster(activeFilter),
        getEmployeeSubgroups(),
      ]);
      setRows(emps);
      setSubgroups(sgs.filter((s) => s.is_active));
    } catch (e: unknown) {
      setActionFeedback(interpretError(e, "Nepodařilo se načíst zaměstnance."));
      setRows([]);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [activeFilter]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      const hay = buildSearchHaystack(
        r.employee_code,
        r.name,
        r.full_name,
        r.first_name,
        r.last_name,
        r.email,
        r.phone,
        r.chip_card_uid,
        r.card_uid,
        r.scan_code
      );
      return matchesSearchQuery(query, hay);
    });
  }, [rows, query]);

  function resetForm() {
    setFormFirst("");
    setFormLast("");
    setFormCode("");
    setFormChip("");
    setFormScan("");
    setFormPin("");
    setFormClearPin(false);
    setFormSubgroupId("");
    setFormActive(true);
    setFormKiosk(true);
    setFormPhone("");
    setFormEmail("");
    setFormStreet("");
    setFormCity("");
    setFormPostal("");
    setFormCountry("");
    setFormBirth("");
    setFormJob("");
    setFormRate("");
    setFormNote("");
  }

  function openCreate() {
    setEditingId(null);
    resetForm();
    setShowForm(true);
    clearFeedback();
  }

  function openEdit(r: EmployeeMasterRow) {
    setEditingId(r.id);
    setFormFirst(r.first_name ?? "");
    setFormLast(r.last_name ?? "");
    setFormCode(r.employee_code);
    setFormChip(r.chip_card_uid ?? "");
    setFormScan(r.scan_code ?? "");
    setFormPin("");
    setFormClearPin(false);
    setFormSubgroupId(r.employee_subgroup_id ?? "");
    setFormActive(r.is_active);
    setFormKiosk(r.can_use_kiosk);
    setFormPhone(r.phone ?? "");
    setFormEmail(r.email ?? "");
    setFormStreet(r.street ?? "");
    setFormCity(r.city ?? "");
    setFormPostal(r.postal_code ?? "");
    setFormCountry(r.country ?? "");
    setFormBirth(r.birth_date ? String(r.birth_date).slice(0, 10) : "");
    setFormJob(r.job_title ?? "");
    setFormRate(
      r.hourly_cost_rate != null
        ? String(r.hourly_cost_rate)
        : r.cost_rate_per_hour != null
          ? String(r.cost_rate_per_hour)
          : ""
    );
    setFormNote(r.note ?? "");
    setShowForm(true);
    clearFeedback();
  }

  function closeForm() {
    setShowForm(false);
    setEditingId(null);
  }

  async function handleSave() {
    const first = formFirst.trim();
    const last = formLast.trim();
    const code = formCode.trim();
    if (!first || !last) {
      showError("Vyplňte jméno a příjmení.");
      return;
    }
    if (!code) {
      showError("Vyplňte kód zaměstnance.");
      return;
    }
    const pin = formPin.trim();
    if (pin && pin.length < 4) {
      showError("PIN musí mít alespoň 4 znaky.");
      return;
    }
    let rate: number | null = null;
    if (formRate.trim()) {
      const n = Number(formRate.replace(",", "."));
      if (Number.isNaN(n)) {
        showError("Neplatná sazba (Kč/h).");
        return;
      }
      rate = n;
    }

    setSaving(true);
    clearFeedback();
    const chipNorm = normalizeCzechKeyboardReaderNumeric(formChip.trim());
    const scanNorm = normalizeCzechKeyboardReaderNumeric(formScan.trim());
    const payload = {
      first_name: first,
      last_name: last,
      employee_code: code,
      chip_card_uid: chipNorm || null,
      scan_code: scanNorm || null,
      pin_code: pin || undefined,
      clear_pin: editingId != null ? formClearPin : false,
      phone: formPhone.trim() || null,
      email: formEmail.trim() || null,
      street: formStreet.trim() || null,
      city: formCity.trim() || null,
      postal_code: formPostal.trim() || null,
      country: formCountry.trim() || null,
      birth_date: formBirth.trim() || null,
      job_title: formJob.trim() || null,
      employee_subgroup_id: formSubgroupId === "" ? null : Number(formSubgroupId),
      is_active: formActive,
      can_use_kiosk: formKiosk,
      hourly_cost_rate: rate,
      cost_rate_per_hour: rate,
      note: formNote.trim() || null,
    };
    const isEdit = editingId != null;
    const fb = await runWriteAction(
      async () => {
        if (isEdit) {
          await updateEmployeeMaster(editingId!, payload);
        } else {
          await createEmployeeMaster(payload);
        }
        return null;
      },
      {
        successMessage: isEdit
          ? `Zaměstnanec „${first} ${last}" byl uložen.`
          : `Zaměstnanec „${first} ${last}" byl vytvořen.`,
        errorMessage: "Uložení zaměstnance se nezdařilo.",
      },
    );
    setActionFeedback(fb);
    setSaving(false);
    if (fb.kind === "success") {
      await loadAll();
      closeForm();
    }
  }

  async function handleDelete(r: EmployeeMasterRow) {
    const ok = window.confirm(`Smazat zaměstnance „${r.full_name}“? (Při historii pouze deaktivace.)`);
    if (!ok) return;
    // `deleteEmployeeMaster` vrací `{status, detail?}`:
    //   - "deleted"      → fyzicky smazán
    //   - "soft_deleted" → měl historické vazby (work reports atd.) a byl
    //                      jen deaktivován; pro uživatele to NENÍ chyba.
    // Helper to namapuje na success / info banner.
    const fb = await runWriteAction(
      () => deleteEmployeeMaster(r.id),
      {
        successMessage: `Zaměstnanec „${r.full_name}" byl smazán.`,
        errorMessage: "Smazání zaměstnance se nezdařilo.",
      },
    );
    setActionFeedback(fb);
    if (fb.kind === "success" || fb.kind === "info") {
      // Bez `setLoading(true)`: celostránkový „Načítám…“ schová tabulku a banner
      // nad ní pak působí jako „nic se nestalo“. Tichý reload ponechá banner vidět.
      await loadAll({ silent: true });
    }
  }

  return (
    <div className="erp-overview-page" style={{ ...UI.card, borderRadius: 14, padding: 16 }}>
      <div style={{ marginBottom: 10 }}>
        <div style={UI.sectionTitle}>Zaměstnanci</div>
        <div style={UI.sectionSubtitle}>
          Master data pro kiosk (čip, PIN, sken), náklady práce a budoucí výkazy. Kód zaměstnance lze vždy zadat na
          kiosk.
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
          placeholder="Hledat jméno, kód, telefon, e-mail, čip, sken…"
          style={{ ...UI.inputs.base, flex: "1 1 280px", minWidth: 200, maxWidth: 480 }}
        />
        <select
          value={activeFilter}
          onChange={(e) => setActiveFilter(e.target.value as EmployeeListActiveFilter)}
          style={{ ...UI.inputs.base, minWidth: 160 }}
        >
          <option value="all">Všichni</option>
          <option value="active">Pouze aktivní</option>
          <option value="inactive">Neaktivní</option>
        </select>
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
              <div style={UI.inputs.label}>Kód zaměstnance (kiosk)</div>
              <input value={formCode} onChange={(e) => setFormCode(e.target.value)} style={UI.inputs.base} />
            </div>
            <div>
              <div style={UI.inputs.label}>UID čipové karty</div>
              <input
                value={formChip}
                onChange={(e) => setFormChip(e.target.value)}
                onBlur={() => setFormChip((v) => normalizeCzechKeyboardReaderNumeric(v.trim()))}
                style={UI.inputs.base}
                placeholder="Volitelné (po opuštění pole: CZ klávesnice → číslice)"
              />
            </div>
            <div>
              <div style={UI.inputs.label}>Skenovací kód (čárový / QR)</div>
              <input
                value={formScan}
                onChange={(e) => setFormScan(e.target.value)}
                onBlur={() => setFormScan((v) => normalizeCzechKeyboardReaderNumeric(v.trim()))}
                style={UI.inputs.base}
                placeholder="Volitelné"
              />
            </div>
            <div>
              <div style={UI.inputs.label}>
                {editingId != null ? "Nový PIN (volitelně)" : "PIN (volitelně)"}
              </div>
              <input
                type="password"
                autoComplete="new-password"
                value={formPin}
                onChange={(e) => setFormPin(e.target.value)}
                style={UI.inputs.base}
                placeholder="Min. 4 znaky; neukládá se otevřeně"
              />
            </div>
            {editingId != null ? (
              <div style={{ display: "flex", alignItems: "center", paddingTop: 20 }}>
                <label style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 700 }}>
                  <input
                    type="checkbox"
                    checked={formClearPin}
                    onChange={(e) => setFormClearPin(e.target.checked)}
                  />
                  Odstranit PIN
                </label>
              </div>
            ) : null}
            <div>
              <div style={UI.inputs.label}>Telefon</div>
              <input value={formPhone} onChange={(e) => setFormPhone(e.target.value)} style={UI.inputs.base} />
            </div>
            <div>
              <div style={UI.inputs.label}>E-mail</div>
              <input value={formEmail} onChange={(e) => setFormEmail(e.target.value)} style={UI.inputs.base} />
            </div>
            <div>
              <div style={UI.inputs.label}>Ulice</div>
              <input value={formStreet} onChange={(e) => setFormStreet(e.target.value)} style={UI.inputs.base} />
            </div>
            <div>
              <div style={UI.inputs.label}>Město</div>
              <input value={formCity} onChange={(e) => setFormCity(e.target.value)} style={UI.inputs.base} />
            </div>
            <div>
              <div style={UI.inputs.label}>PSČ</div>
              <input value={formPostal} onChange={(e) => setFormPostal(e.target.value)} style={UI.inputs.base} />
            </div>
            <div>
              <div style={UI.inputs.label}>Země</div>
              <input value={formCountry} onChange={(e) => setFormCountry(e.target.value)} style={UI.inputs.base} />
            </div>
            <div>
              <div style={UI.inputs.label}>Datum narození</div>
              <input type="date" value={formBirth} onChange={(e) => setFormBirth(e.target.value)} style={UI.inputs.base} />
            </div>
            <div>
              <div style={UI.inputs.label}>Pracovní pozice</div>
              <input value={formJob} onChange={(e) => setFormJob(e.target.value)} style={UI.inputs.base} />
            </div>
            <div>
              <div style={UI.inputs.label}>Sazba nákladů (Kč / hod.)</div>
              <input value={formRate} onChange={(e) => setFormRate(e.target.value)} style={UI.inputs.base} />
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
            <div style={{ display: "flex", alignItems: "center", paddingTop: 20, gap: 16, flexWrap: "wrap" }}>
              <label style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 700 }}>
                <input type="checkbox" checked={formActive} onChange={(e) => setFormActive(e.target.checked)} />
                Aktivní
              </label>
              <label style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 700 }}>
                <input type="checkbox" checked={formKiosk} onChange={(e) => setFormKiosk(e.target.checked)} />
                Smí používat kiosk
              </label>
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <div style={UI.inputs.label}>Poznámka</div>
              <textarea
                value={formNote}
                onChange={(e) => setFormNote(e.target.value)}
                style={{ ...UI.inputs.base, minHeight: 72, width: "100%", resize: "vertical" as const }}
              />
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
      {actionFeedback ? (
        <InlineBanner
          kind={actionFeedback.kind}
          message={actionFeedback.message}
          onClose={clearFeedback}
          style={{ marginBottom: 8 }}
        />
      ) : null}

      {!loading ? (
        <div className="erp-table-wrap" style={{ overflowX: "auto" }}>
          <table style={UI.table}>
            <thead>
              <tr style={{ background: "#f8fafc" }}>
                {["Jméno", "Kód", "Přihlášení", "Role", "Aktivní", "Akce"].map((h) => (
                  <th key={h} style={{ ...UI.th, fontSize: 13, padding: "10px 10px", whiteSpace: "nowrap" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id}>
                  <td style={{ ...UI.td, padding: "10px 10px" }}>{r.full_name}</td>
                  <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>{r.employee_code}</td>
                  <td style={{ ...UI.td, padding: "10px 10px" }}>{loginMethodPills(r)}</td>
                  <td style={{ ...UI.td, padding: "10px 10px" }}>{r.subgroup_name ?? "—"}</td>
                  <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>{r.is_active ? "ANO" : "NE"}</td>
                  <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>
                    <button type="button" style={UI.buttons.secondary} onClick={() => openEdit(r)}>
                      Upravit
                    </button>{" "}
                    <button type="button" style={UI.buttons.secondary} onClick={() => handleDelete(r)}>
                      Smazat
                    </button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ ...UI.td, textAlign: "center", color: "#64748b", padding: "14px 10px" }}>
                    Žádní zaměstnanci — upravte filtr nebo vytvořte záznam.
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
