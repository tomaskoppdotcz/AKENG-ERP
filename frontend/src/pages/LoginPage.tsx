import React, { FormEvent, useState } from "react";
import { ERP_ROLE_OPTIONS, type ErpRole } from "../auth/rbac";
import { setUiActorIdentifier } from "../auth/uiActor";
import { UI } from "../styles/ui";

type Props = {
  onLogin: (role: ErpRole | null) => void;
};

export default function LoginPage({ onLogin }: Props) {
  const [usernameOrEmail, setUsernameOrEmail] = useState("");
  const [password, setPassword] = useState("");
  const [roleChoice, setRoleChoice] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();

    if (!usernameOrEmail.trim() || !password.trim()) {
      setError("Vyplňte uživatelské jméno nebo e-mail a heslo.");
      return;
    }

    setError(null);
    const role: ErpRole | null =
      roleChoice && ERP_ROLE_OPTIONS.some((o) => o.value === roleChoice) ? (roleChoice as ErpRole) : null;
    setUiActorIdentifier(usernameOrEmail.trim() || "default");
    onLogin(role);
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: 24,
      }}
    >
      <div style={{ width: "100%", maxWidth: 420 }}>
        <div style={UI.card}>
          <div style={UI.sectionTitle}>Přihlášení do AKENG ERP</div>
          <div style={UI.sectionSubtitle}>Přihlaste se pro zobrazení Nástěnky.</div>

          <form onSubmit={handleSubmit} style={{ marginTop: 18, display: "grid", gap: 12 }}>
            <div>
              <div style={UI.inputs.label}>Uživatelské jméno nebo e-mail</div>
              <input
                value={usernameOrEmail}
                onChange={(e) => setUsernameOrEmail(e.target.value)}
                placeholder="Uživatelské jméno nebo e-mail"
                style={UI.inputs.base}
                autoComplete="username"
              />
            </div>

            <div>
              <div style={UI.inputs.label}>Heslo</div>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Heslo"
                style={UI.inputs.base}
                autoComplete="current-password"
              />
            </div>

            <div>
              <div style={UI.inputs.label}>Role (pro test RBAC)</div>
              <select
                value={roleChoice}
                onChange={(e) => setRoleChoice(e.target.value)}
                style={UI.inputs.base}
                aria-label="Role pro omezení přístupu"
              >
                <option value="">— Bez role (vše povoleno, výchozí) —</option>
                {ERP_ROLE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <div style={{ fontSize: 11, color: "#64748b", marginTop: 6, lineHeight: 1.4 }}>
                Role se uloží do prohlížeče a posílá se hlavičkou <code style={{ fontSize: 10 }}>X-AKENG-Role</code> na API.
              </div>
            </div>

            <button type="submit" style={UI.buttons.primary}>
              Přihlásit se
            </button>

            {error ? (
              <div
                style={{
                  marginTop: 2,
                  padding: "10px 12px",
                  borderRadius: 12,
                  background: "#fef2f2",
                  border: "1px solid #fecaca",
                  color: "#b91c1c",
                  fontWeight: 800,
                  fontSize: 13,
                }}
              >
                {error}
              </div>
            ) : null}
          </form>
        </div>
      </div>
    </div>
  );
}
