import React, { FormEvent, useState } from "react";
import { UI } from "../styles/ui";

type Props = {
  onLogin: () => void;
};

export default function LoginPage({ onLogin }: Props) {
  const [usernameOrEmail, setUsernameOrEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();

    if (!usernameOrEmail.trim() || !password.trim()) {
      setError("Vyplňte uživatelské jméno nebo e-mail a heslo.");
      return;
    }

    setError(null);
    onLogin();
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

