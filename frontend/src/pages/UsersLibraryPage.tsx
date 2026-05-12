/**
 * Knihovna uživatelů AKENG ERP (první verze).
 *
 * - Seznam uživatelů s filtrem.
 * - Formulář pro vytvoření / úpravu uživatele.
 * - Přiřazení rolí (checkbox seznam podle `/roles`).
 * - Zobrazuje odvozená oprávnění (union všech rolí) — jen informativně.
 *
 * Zápis vyžaduje permission `manage_users` (gating řeší backend + `<App />`).
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";

import {
  assignUserRoles,
  createUser,
  deleteUser,
  listPermissions,
  listRoles,
  listUsers,
  updateUser,
  type PermissionDto,
  type RoleDto,
  type UserDto,
} from "../services/usersApi";
import { adminSetUserPassword } from "../services/authApi";
import { UI } from "../styles/ui";
import TableRowActionsMenu from "../components/table/TableRowActionsMenu";

function norm(s: string) {
  return s.trim().toLowerCase();
}

function cell(v: string | null | undefined) {
  if (v == null || String(v).trim() === "") return "—";
  return v;
}

export default function UsersLibraryPage() {
  const [users, setUsers] = useState<UserDto[]>([]);
  const [roles, setRoles] = useState<RoleDto[]>([]);
  const [permissions, setPermissions] = useState<PermissionDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [formUsername, setFormUsername] = useState("");
  const [formDisplayName, setFormDisplayName] = useState("");
  const [formChip, setFormChip] = useState("");
  const [formNote, setFormNote] = useState("");
  const [formActive, setFormActive] = useState(true);
  const [formRoleCodes, setFormRoleCodes] = useState<string[]>([]);

  const [pwdUser, setPwdUser] = useState<UserDto | null>(null);
  const [pwdValue, setPwdValue] = useState("");
  const [pwdConfirm, setPwdConfirm] = useState("");
  const [pwdSaving, setPwdSaving] = useState(false);
  const [pwdError, setPwdError] = useState<string | null>(null);
  const [pwdSuccess, setPwdSuccess] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [u, r, p] = await Promise.all([listUsers(), listRoles(), listPermissions()]);
      setUsers(u);
      setRoles(r);
      setPermissions(p);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Nepodařilo se načíst uživatele.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const permissionByCode = useMemo(() => {
    const m = new Map<string, PermissionDto>();
    permissions.forEach((p) => m.set(p.code, p));
    return m;
  }, [permissions]);

  const roleByCode = useMemo(() => {
    const m = new Map<string, RoleDto>();
    roles.forEach((r) => m.set(r.code, r));
    return m;
  }, [roles]);

  const filtered = useMemo(() => {
    const q = norm(query);
    if (!q) return users;
    return users.filter((u) => {
      const hay = [u.username, u.display_name, u.role_legacy, u.chip_code, u.note, u.roles.join(" ")]
        .map((x) => (x ?? "").toString().trim())
        .join(" ");
      return norm(hay).includes(q);
    });
  }, [users, query]);

  const derivedFormPermissions = useMemo(() => {
    const s = new Set<string>();
    formRoleCodes.forEach((code) => {
      const r = roleByCode.get(code);
      if (r) r.permissions.forEach((p) => s.add(p));
    });
    return Array.from(s).sort();
  }, [formRoleCodes, roleByCode]);

  function resetForm() {
    setFormUsername("");
    setFormDisplayName("");
    setFormChip("");
    setFormNote("");
    setFormActive(true);
    setFormRoleCodes([]);
  }

  function openCreate() {
    resetForm();
    setEditingId(null);
    setShowForm(true);
    setError(null);
  }

  function openEdit(u: UserDto) {
    setEditingId(u.id);
    setFormUsername(u.username);
    setFormDisplayName(u.display_name ?? "");
    setFormChip(u.chip_code ?? "");
    setFormNote(u.note ?? "");
    setFormActive(u.is_active);
    setFormRoleCodes([...u.roles]);
    setShowForm(true);
    setError(null);
  }

  function closeForm() {
    setShowForm(false);
    setEditingId(null);
  }

  function toggleRoleCode(code: string) {
    setFormRoleCodes((prev) =>
      prev.includes(code) ? prev.filter((x) => x !== code) : [...prev, code]
    );
  }

  async function handleSave() {
    const username = formUsername.trim();
    if (!username) {
      setError("Uživatelské jméno je povinné.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (editingId != null) {
        await updateUser(editingId, {
          display_name: formDisplayName.trim() || null,
          is_active: formActive,
          chip_code: formChip.trim() || null,
          note: formNote.trim() || null,
        });
        await assignUserRoles(editingId, formRoleCodes);
      } else {
        const created = await createUser({
          username,
          display_name: formDisplayName.trim() || null,
          is_active: formActive,
          chip_code: formChip.trim() || null,
          note: formNote.trim() || null,
          role_codes: formRoleCodes,
        });
        setEditingId(created.id);
      }
      await load();
      closeForm();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Uložení se nezdařilo.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: number) {
    if (!window.confirm("Opravdu chcete smazat tohoto uživatele?")) return;
    setError(null);
    try {
      await deleteUser(id);
      await load();
      if (editingId === id) closeForm();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Smazání se nezdařilo.");
    }
  }

  function openPasswordDialog(u: UserDto) {
    setPwdUser(u);
    setPwdValue("");
    setPwdConfirm("");
    setPwdError(null);
    setPwdSuccess(null);
  }

  function closePasswordDialog() {
    setPwdUser(null);
    setPwdValue("");
    setPwdConfirm("");
    setPwdError(null);
    setPwdSuccess(null);
    setPwdSaving(false);
  }

  async function handleSavePassword() {
    if (!pwdUser) return;
    const v = pwdValue.trim();
    if (v.length < 4) {
      setPwdError("Heslo musí mít alespoň 4 znaky.");
      return;
    }
    if (v !== pwdConfirm.trim()) {
      setPwdError("Hesla se neshodují.");
      return;
    }
    setPwdSaving(true);
    setPwdError(null);
    try {
      await adminSetUserPassword(pwdUser.id, v);
      setPwdSuccess(`Heslo pro uživatele „${pwdUser.username}" bylo nastaveno.`);
      setPwdValue("");
      setPwdConfirm("");
    } catch (e: unknown) {
      setPwdError(e instanceof Error ? e.message : "Nastavení hesla selhalo.");
    } finally {
      setPwdSaving(false);
    }
  }

  const groupedPermissions = useMemo(() => {
    const byCategory = new Map<string, PermissionDto[]>();
    permissions.forEach((p) => {
      const arr = byCategory.get(p.category) ?? [];
      arr.push(p);
      byCategory.set(p.category, arr);
    });
    return Array.from(byCategory.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [permissions]);

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
        <div>
          <div style={UI.sectionTitle}>Uživatelé</div>
          <div style={UI.sectionSubtitle}>Knihovna uživatelů a přiřazení rolí.</div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Hledat jméno, login, roli, poznámku…"
            style={{ ...UI.inputs.base, flex: "1 1 240px", minWidth: 200, maxWidth: 420 }}
          />
          <button type="button" style={UI.buttons.primary} onClick={openCreate}>
            Nový uživatel
          </button>
        </div>
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
            {editingId != null ? "Upravit uživatele" : "Nový uživatel"}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
            <div>
              <div style={UI.inputs.label}>Login (username)</div>
              <input
                value={formUsername}
                onChange={(e) => setFormUsername(e.target.value)}
                style={UI.inputs.base}
                disabled={editingId != null}
              />
            </div>
            <div>
              <div style={UI.inputs.label}>Jméno</div>
              <input
                value={formDisplayName}
                onChange={(e) => setFormDisplayName(e.target.value)}
                style={UI.inputs.base}
                placeholder="Např. Jan Novák"
              />
            </div>
            <div>
              <div style={UI.inputs.label}>Čip / karta (volitelné)</div>
              <input
                value={formChip}
                onChange={(e) => setFormChip(e.target.value)}
                style={UI.inputs.base}
                placeholder="ID čipu"
              />
            </div>
            <div style={{ display: "flex", alignItems: "center", paddingTop: 20 }}>
              <label style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 700 }}>
                <input
                  type="checkbox"
                  checked={formActive}
                  onChange={(e) => setFormActive(e.target.checked)}
                />
                Aktivní
              </label>
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <div style={UI.inputs.label}>Poznámka</div>
              <textarea
                value={formNote}
                onChange={(e) => setFormNote(e.target.value)}
                style={{ ...UI.inputs.base, minHeight: 60, resize: "vertical", fontFamily: "inherit" }}
              />
            </div>
          </div>

          <div style={{ marginTop: 14 }}>
            <div style={{ ...UI.inputs.label, marginBottom: 6 }}>Role</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 8 }}>
              {roles.map((r) => {
                const checked = formRoleCodes.includes(r.code);
                return (
                  <label
                    key={r.code}
                    style={{
                      display: "flex",
                      gap: 10,
                      alignItems: "flex-start",
                      padding: "8px 10px",
                      border: "1px solid #e2e8f0",
                      borderRadius: 8,
                      background: checked ? "#eff6ff" : "#ffffff",
                      cursor: "pointer",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleRoleCode(r.code)}
                      style={{ marginTop: 3 }}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, color: "#0f172a" }}>{r.name}</div>
                      <div style={{ fontSize: 12, color: "#64748b" }}>{r.description || `Role ${r.code}`}</div>
                      <div style={{ fontSize: 11, color: "#475569", marginTop: 4 }}>
                        {r.permissions.length} oprávnění
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>

          {derivedFormPermissions.length > 0 ? (
            <div style={{ marginTop: 14 }}>
              <div style={{ ...UI.inputs.label, marginBottom: 6 }}>Odvozená oprávnění</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {derivedFormPermissions.map((code) => {
                  const meta = permissionByCode.get(code);
                  return (
                    <span
                      key={code}
                      title={meta?.description ?? code}
                      style={{
                        fontSize: 12,
                        padding: "3px 8px",
                        borderRadius: 999,
                        background: "#ecfdf5",
                        border: "1px solid #bbf7d0",
                        color: "#065f46",
                        fontWeight: 600,
                      }}
                    >
                      {code}
                    </span>
                  );
                })}
              </div>
            </div>
          ) : null}

          <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
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

      {loading ? <div style={UI.sectionSubtitle}>Načítám uživatele…</div> : null}
      {error ? <div style={{ color: "#b91c1c", fontWeight: 700, marginBottom: 8 }}>{error}</div> : null}

      {!loading ? (
        <div style={{ overflowX: "auto" }}>
          <table style={UI.table}>
            <thead>
              <tr style={{ background: "#f8fafc" }}>
                {["Login", "Jméno", "Role", "Čip", "Aktivní", "Akce"].map((h) => (
                  <th key={h} style={{ ...UI.th, fontSize: 13, padding: "10px 10px", whiteSpace: "nowrap" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((u) => (
                <tr key={u.id}>
                  <td style={{ ...UI.td, padding: "10px 10px", fontWeight: 700 }}>{u.username}</td>
                  <td style={{ ...UI.td, padding: "10px 10px" }}>{cell(u.display_name)}</td>
                  <td style={{ ...UI.td, padding: "10px 10px" }}>
                    {u.roles.length === 0 ? (
                      <span style={{ color: "#94a3b8" }}>—</span>
                    ) : (
                      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                        {u.roles.map((c) => (
                          <span
                            key={c}
                            style={{
                              fontSize: 12,
                              padding: "2px 8px",
                              borderRadius: 999,
                              background: "#eff6ff",
                              border: "1px solid #bfdbfe",
                              color: "#1e40af",
                              fontWeight: 600,
                            }}
                          >
                            {roleByCode.get(c)?.name ?? c}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>{cell(u.chip_code)}</td>
                  <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>
                    {u.is_active ? "ANO" : "NE"}
                  </td>
                  <td style={{ ...UI.td, padding: "10px 10px", textAlign: "right", whiteSpace: "nowrap" }}>
                    <TableRowActionsMenu
                      compact
                      align="end"
                      triggerLabel={`Akce — ${u.username}`}
                      actions={[
                        { key: "edit", label: "Upravit", onClick: () => openEdit(u) },
                        { key: "password", label: "Heslo", onClick: () => openPasswordDialog(u) },
                        { key: "delete", label: "Smazat", danger: true, onClick: () => handleDelete(u.id) },
                      ]}
                    />
                  </td>
                </tr>
              ))}
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ ...UI.td, textAlign: "center", color: "#64748b", padding: "14px 10px" }}>
                    Žádní uživatelé.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      ) : null}

      {!loading && roles.length > 0 ? (
        <div style={{ marginTop: 24 }}>
          <div style={{ ...UI.sectionTitle, fontSize: 16, marginBottom: 8 }}>Matice rolí a oprávnění</div>
          <div style={UI.sectionSubtitle}>
            Přehled všech systémových rolí a jejich přiřazených oprávnění. Úprava rolí je zatím dostupná jen přes API.
          </div>
          <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
            {roles.map((r) => (
              <div
                key={r.code}
                style={{
                  border: "1px solid #e2e8f0",
                  borderRadius: 10,
                  padding: "10px 12px",
                  background: "#ffffff",
                }}
              >
                <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                  <div style={{ fontWeight: 800, color: "#0f172a" }}>{r.name}</div>
                  <code style={{ fontSize: 12, color: "#475569" }}>{r.code}</code>
                  {r.is_system ? (
                    <span
                      style={{
                        fontSize: 11,
                        padding: "2px 6px",
                        borderRadius: 999,
                        background: "#f1f5f9",
                        color: "#475569",
                        fontWeight: 700,
                      }}
                    >
                      systémová
                    </span>
                  ) : null}
                </div>
                {r.description ? (
                  <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>{r.description}</div>
                ) : null}
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                  {r.permissions.length === 0 ? (
                    <span style={{ color: "#94a3b8", fontSize: 12 }}>Bez oprávnění</span>
                  ) : (
                    r.permissions.map((code) => (
                      <span
                        key={code}
                        title={permissionByCode.get(code)?.description ?? code}
                        style={{
                          fontSize: 11,
                          padding: "2px 8px",
                          borderRadius: 999,
                          background: "#f8fafc",
                          border: "1px solid #e2e8f0",
                          color: "#334155",
                          fontWeight: 600,
                        }}
                      >
                        {code}
                      </span>
                    ))
                  )}
                </div>
              </div>
            ))}
          </div>

          <div style={{ marginTop: 18 }}>
            <div style={{ ...UI.sectionTitle, fontSize: 16, marginBottom: 8 }}>Oprávnění podle modulů</div>
            {groupedPermissions.map(([category, items]) => (
              <div key={category} style={{ marginTop: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 800, textTransform: "uppercase", color: "#64748b" }}>
                  {category}
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
                  {items.map((p) => (
                    <span
                      key={p.code}
                      title={p.description}
                      style={{
                        fontSize: 12,
                        padding: "2px 8px",
                        borderRadius: 999,
                        background: "#ffffff",
                        border: "1px solid #e2e8f0",
                        color: "#334155",
                        fontWeight: 600,
                      }}
                    >
                      {p.code}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {pwdUser ? (
        <div
          role="dialog"
          aria-modal="true"
          onClick={closePasswordDialog}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15, 23, 42, 0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: 16,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%",
              maxWidth: 420,
              background: "#ffffff",
              borderRadius: 14,
              border: "1px solid #e2e8f0",
              padding: 18,
              boxShadow: "0 24px 60px -24px rgba(15, 23, 42, 0.35)",
            }}
          >
            <div style={{ ...UI.sectionTitle, fontSize: 16 }}>Nastavit heslo</div>
            <div style={{ ...UI.sectionSubtitle, marginTop: 2 }}>
              Uživatel <code>{pwdUser.username}</code>
              {pwdUser.display_name ? ` · ${pwdUser.display_name}` : ""}. Staré heslo
              se neověřuje (admin reset).
            </div>

            <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
              <div>
                <div style={UI.inputs.label}>Nové heslo</div>
                <input
                  type="password"
                  value={pwdValue}
                  onChange={(e) => setPwdValue(e.target.value)}
                  style={UI.inputs.base}
                  autoComplete="new-password"
                  autoFocus
                />
              </div>
              <div>
                <div style={UI.inputs.label}>Potvrdit heslo</div>
                <input
                  type="password"
                  value={pwdConfirm}
                  onChange={(e) => setPwdConfirm(e.target.value)}
                  style={UI.inputs.base}
                  autoComplete="new-password"
                />
              </div>
            </div>

            {pwdError ? (
              <div
                style={{
                  marginTop: 10,
                  padding: "8px 10px",
                  borderRadius: 10,
                  background: "#FEF2F2",
                  border: "1px solid #FECACA",
                  color: "#B91C1C",
                  fontWeight: 700,
                  fontSize: 13,
                }}
              >
                {pwdError}
              </div>
            ) : null}

            {pwdSuccess ? (
              <div
                style={{
                  marginTop: 10,
                  padding: "8px 10px",
                  borderRadius: 10,
                  background: "#ECFDF5",
                  border: "1px solid #A7F3D0",
                  color: "#047857",
                  fontWeight: 700,
                  fontSize: 13,
                }}
              >
                {pwdSuccess}
              </div>
            ) : null}

            <div style={{ display: "flex", gap: 8, marginTop: 14, justifyContent: "flex-end" }}>
              <button
                type="button"
                style={UI.buttons.secondary}
                onClick={closePasswordDialog}
                disabled={pwdSaving}
              >
                Zavřít
              </button>
              <button
                type="button"
                style={{ ...UI.buttons.primary, ...(pwdSaving ? { opacity: 0.7, cursor: "wait" } : {}) }}
                onClick={handleSavePassword}
                disabled={pwdSaving}
              >
                {pwdSaving ? "Ukládám…" : "Nastavit heslo"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
