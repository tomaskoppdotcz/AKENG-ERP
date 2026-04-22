/**
 * AKENG ERP — Login / Landing screen.
 *
 * Layout:
 * - Dvousloupcová úvodní obrazovka (responsive, 1 sloupec < 900 px).
 *   - Vlevo: branding, claim, popis systému, verze + prostředí.
 *   - Vpravo: login karta (username, heslo, volitelná test role).
 *
 * Datové zdroje:
 * - `GET /app-info` (backend) — název, verze, prostředí (DEV / TEST / PROD).
 *   Fallback: `FALLBACK_APP_INFO` z `constants/buildInfo.ts` (Vite env).
 *
 * Navázání na uživatele / actor identitu:
 * - `setUiActorIdentifier(username)` uloží login do localStorage → hlavička
 *   `X-AKENG-Actor` v `akengFetch`.
 * - `onLogin(role)` předá do `App.tsx`, který pak volá `refreshCurrentUser()`
 *   → `GET /users/me` → permissions → cache v `rbac.ts` store.
 * - Pole „Role" je ponecháno jen pro rychlé testování RBAC (legacy
 *   `X-AKENG-Role`); skutečná práva se derivují z knihovny uživatelů.
 */

import React, { FormEvent, useEffect, useMemo, useState } from "react";

import { ERP_ROLE_OPTIONS, type ErpRole } from "../auth/rbac";
import { setUiActorIdentifier } from "../auth/uiActor";
import { FALLBACK_APP_INFO } from "../constants/buildInfo";
import { fetchAppInfo, type AppEnvironment, type AppInfoDto } from "../services/appInfoApi";
import { loginWithPassword } from "../services/authApi";
import { UI } from "../styles/ui";

type Props = {
  onLogin: (role: ErpRole | null) => void;
};

const ENV_COLORS: Record<AppEnvironment, { bg: string; fg: string; border: string; dot: string }> = {
  DEV: { bg: "#DBEAFE", fg: "#1E3A8A", border: "#93C5FD", dot: "#2563EB" },
  TEST: { bg: "#FEF3C7", fg: "#92400E", border: "#FCD34D", dot: "#F59E0B" },
  PROD: { bg: "#DCFCE7", fg: "#065F46", border: "#86EFAC", dot: "#16A34A" },
};

const FEATURE_BULLETS: { title: string; description: string }[] = [
  { title: "Výroba", description: "Výrobní příkazy, výkazy práce, kiosk na dílně." },
  { title: "Plánování", description: "Planner Gantt, směny pracovišť, kapacita." },
  { title: "Sklad", description: "Materiál, výrobky, fulfillment a pohyby." },
  { title: "Zakázky & metriky", description: "Portfolio, průchodnost, KPI a metriky." },
];

export default function LoginPage({ onLogin }: Props) {
  const [usernameOrEmail, setUsernameOrEmail] = useState("");
  const [password, setPassword] = useState("");
  const [roleChoice, setRoleChoice] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [appInfo, setAppInfo] = useState<AppInfoDto>(FALLBACK_APP_INFO);
  const [appInfoLoaded, setAppInfoLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const info = await fetchAppInfo();
        if (!cancelled) {
          setAppInfo(info);
          setAppInfoLoaded(true);
        }
      } catch {
        if (!cancelled) setAppInfoLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const envPalette = useMemo(() => ENV_COLORS[appInfo.environment] ?? ENV_COLORS.DEV, [appInfo.environment]);
  const buildYear = useMemo(() => new Date().getFullYear(), []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    const username = usernameOrEmail.trim();
    if (!username || !password.trim()) {
      setError("Vyplňte uživatelské jméno nebo e-mail a heslo.");
      return;
    }
    setError(null);
    setSubmitting(true);
    const role: ErpRole | null =
      roleChoice && ERP_ROLE_OPTIONS.some((o) => o.value === roleChoice) ? (roleChoice as ErpRole) : null;
    try {
      // Ideální cesta: backend ověří heslo a vydá bearer token (`/auth/login`).
      // Actor nastavujeme podle skutečného username z odpovědi backendu.
      const res = await loginWithPassword(username, password);
      setUiActorIdentifier(res.user.username || username);
      onLogin(role);
    } catch (err) {
      // Pokud backend /auth/login zatím není dostupný (staré prostředí) nebo
      // selhal jinak než 401, raději nabízíme jasnou chybu. Pro 401 Python
      // serializuje "Neplatné přihlašovací údaje." — to se ukáže 1:1.
      const msg = err instanceof Error ? err.message : "Přihlášení se nezdařilo.";
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "stretch",
        justifyContent: "center",
        background: "linear-gradient(135deg, #F6F8FA 0%, #EEF2FF 55%, #E0E7FF 100%)",
        padding: "clamp(16px, 3vw, 40px)",
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 1180,
          display: "grid",
          gridTemplateColumns: "minmax(0, 1.05fr) minmax(360px, 440px)",
          gap: "clamp(24px, 4vw, 48px)",
          alignItems: "center",
        }}
        className="akeng-login-grid"
      >
        {/* ------------------------------- LEFT — BRAND ------------------------------- */}
        <div style={{ minWidth: 0, color: "#0F172A" }}>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 12,
              padding: "6px 12px",
              borderRadius: 999,
              background: "rgba(37, 99, 235, 0.08)",
              border: "1px solid rgba(37, 99, 235, 0.22)",
              color: "#1D4ED8",
              fontWeight: 800,
              fontSize: 12,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
            }}
          >
            <span
              style={{
                display: "inline-block",
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: "#2563EB",
                boxShadow: "0 0 0 4px rgba(37, 99, 235, 0.18)",
              }}
            />
            Industrial ERP · v{appInfo.version}
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 18,
              marginTop: 24,
              flexWrap: "wrap",
            }}
          >
            <LoginLogoMark />
            <div>
              <div
                style={{
                  fontSize: "clamp(42px, 5vw, 64px)",
                  lineHeight: 1,
                  fontWeight: 1000,
                  letterSpacing: "-0.03em",
                  color: "#0F172A",
                }}
              >
                AKENG ERP
              </div>
              <div
                style={{
                  marginTop: 10,
                  fontSize: "clamp(16px, 1.4vw, 19px)",
                  color: "#334155",
                  fontWeight: 600,
                  letterSpacing: "-0.005em",
                }}
              >
                {appInfo.subtitle}
              </div>
            </div>
          </div>

          <div
            style={{
              marginTop: 28,
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: 12,
              maxWidth: 620,
            }}
          >
            {FEATURE_BULLETS.map((b) => (
              <div
                key={b.title}
                style={{
                  background: "rgba(255, 255, 255, 0.7)",
                  border: "1px solid rgba(226, 232, 240, 0.9)",
                  borderRadius: 14,
                  padding: "12px 14px",
                  boxShadow: "0 1px 2px rgba(15, 23, 42, 0.03)",
                  backdropFilter: "blur(6px)",
                }}
              >
                <div style={{ fontWeight: 900, fontSize: 14, color: "#0F172A" }}>{b.title}</div>
                <div style={{ marginTop: 4, fontSize: 12.5, color: "#475569", lineHeight: 1.45 }}>
                  {b.description}
                </div>
              </div>
            ))}
          </div>

          <div
            style={{
              marginTop: 32,
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              gap: 10,
              fontSize: 12.5,
              color: "#475569",
            }}
          >
            <span
              style={{
                padding: "4px 10px",
                borderRadius: 999,
                border: "1px solid #E2E8F0",
                background: "#FFFFFF",
                fontWeight: 700,
                color: "#334155",
              }}
            >
              v{appInfo.version}
            </span>
            <EnvironmentBadge env={appInfo.environment} palette={envPalette} loaded={appInfoLoaded} />
            <span aria-hidden style={{ color: "#CBD5E1" }}>·</span>
            <span>© {buildYear} AKENG</span>
            <span aria-hidden style={{ color: "#CBD5E1" }}>·</span>
            <span>Provoz a podpora: AKENG IT</span>
          </div>
        </div>

        {/* ------------------------------- RIGHT — LOGIN ------------------------------- */}
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              background: "#FFFFFF",
              borderRadius: 20,
              border: "1px solid #E2E8F0",
              padding: "clamp(20px, 2.5vw, 28px)",
              boxShadow: "0 24px 60px -24px rgba(15, 23, 42, 0.25), 0 2px 8px rgba(15, 23, 42, 0.04)",
              position: "relative",
              overflow: "hidden",
            }}
          >
            <div
              aria-hidden
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                height: 4,
                background: "linear-gradient(90deg, #2563EB, #7C3AED)",
              }}
            />

            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 900,
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  color: "#64748B",
                }}
              >
                Přihlášení
              </div>
              <div style={{ flex: 1, height: 1, background: "#F1F5F9" }} />
              <EnvironmentBadge env={appInfo.environment} palette={envPalette} loaded={appInfoLoaded} compact />
            </div>

            <div
              style={{
                marginTop: 10,
                fontSize: 22,
                fontWeight: 900,
                color: "#0F172A",
                letterSpacing: "-0.01em",
              }}
            >
              Vítejte v AKENG ERP
            </div>
            <div style={{ marginTop: 4, fontSize: 13, color: "#64748B", lineHeight: 1.5 }}>
              Přihlaste se svým firemním účtem pro pokračování.
            </div>

            <form onSubmit={handleSubmit} style={{ marginTop: 20, display: "grid", gap: 14 }}>
              <div>
                <div style={UI.inputs.label}>Uživatelské jméno nebo e-mail</div>
                <input
                  value={usernameOrEmail}
                  onChange={(e) => setUsernameOrEmail(e.target.value)}
                  placeholder="např. jan.novak"
                  style={UI.inputs.base}
                  autoComplete="username"
                  autoFocus
                />
              </div>

              <div>
                <div style={UI.inputs.label}>Heslo</div>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  style={UI.inputs.base}
                  autoComplete="current-password"
                />
              </div>

              <details
                style={{
                  marginTop: 2,
                  border: "1px dashed #E2E8F0",
                  borderRadius: 10,
                  padding: "10px 12px",
                  background: "#F8FAFC",
                }}
              >
                <summary
                  style={{
                    cursor: "pointer",
                    listStyle: "none",
                    fontSize: 12,
                    fontWeight: 800,
                    color: "#475569",
                    letterSpacing: "0.02em",
                  }}
                >
                  Pokročilé — přepnutí role pro testování
                </summary>
                <div style={{ marginTop: 10 }}>
                  <div style={UI.inputs.label}>Role (pro test RBAC)</div>
                  <select
                    value={roleChoice}
                    onChange={(e) => setRoleChoice(e.target.value)}
                    style={UI.inputs.base}
                    aria-label="Role pro omezení přístupu"
                  >
                    <option value="">— Bez role (dle přiřazení uživatele) —</option>
                    {ERP_ROLE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  <div style={{ fontSize: 11, color: "#64748B", marginTop: 6, lineHeight: 1.4 }}>
                    Volba se posílá hlavičkou <code style={{ fontSize: 10 }}>X-AKENG-Role</code>.
                    Skutečná oprávnění se derivují z knihovny uživatelů.
                  </div>
                </div>
              </details>

              <button
                type="submit"
                disabled={submitting}
                style={{
                  ...UI.buttons.primary,
                  padding: "12px 16px",
                  borderRadius: 12,
                  fontSize: 15,
                  letterSpacing: "0.01em",
                  boxShadow: "0 10px 24px -10px rgba(37, 99, 235, 0.55)",
                  opacity: submitting ? 0.7 : 1,
                  cursor: submitting ? "wait" : "pointer",
                }}
              >
                {submitting ? "Přihlašuji…" : "Přihlásit se"}
              </button>

              {error ? (
                <div
                  role="alert"
                  style={{
                    padding: "10px 12px",
                    borderRadius: 12,
                    background: "#FEF2F2",
                    border: "1px solid #FECACA",
                    color: "#B91C1C",
                    fontWeight: 800,
                    fontSize: 13,
                  }}
                >
                  {error}
                </div>
              ) : null}
            </form>

            <div
              style={{
                marginTop: 18,
                fontSize: 11.5,
                color: "#94A3B8",
                lineHeight: 1.5,
                textAlign: "center",
              }}
            >
              AKENG ERP · v{appInfo.version} · prostředí {appInfo.environment}
            </div>
          </div>

          <div
            style={{
              marginTop: 12,
              textAlign: "center",
              fontSize: 11.5,
              color: "#94A3B8",
            }}
          >
            Potíže s přihlášením? Kontaktujte administrátora AKENG IT.
          </div>
        </div>
      </div>

      <style>{`
        @media (max-width: 900px) {
          .akeng-login-grid {
            grid-template-columns: 1fr !important;
            gap: 28px !important;
          }
        }
      `}</style>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Pomocné komponenty
// -----------------------------------------------------------------------------

function EnvironmentBadge({
  env,
  palette,
  loaded,
  compact = false,
}: {
  env: AppEnvironment;
  palette: { bg: string; fg: string; border: string; dot: string };
  loaded: boolean;
  compact?: boolean;
}) {
  return (
    <span
      title={loaded ? `Prostředí: ${env}` : "Prostředí se načítá…"}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: compact ? "3px 8px" : "4px 10px",
        borderRadius: 999,
        background: palette.bg,
        border: `1px solid ${palette.border}`,
        color: palette.fg,
        fontSize: compact ? 11 : 12,
        fontWeight: 900,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
      }}
    >
      <span
        style={{
          display: "inline-block",
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: palette.dot,
        }}
      />
      {env}
    </span>
  );
}

function LoginLogoMark() {
  return (
    <div
      aria-hidden
      style={{
        width: 72,
        height: 72,
        borderRadius: 18,
        background: "linear-gradient(135deg, #2563EB 0%, #7C3AED 100%)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#FFFFFF",
        fontWeight: 1000,
        fontSize: 26,
        letterSpacing: "-0.02em",
        boxShadow: "0 14px 30px -10px rgba(37, 99, 235, 0.55)",
        flex: "0 0 auto",
      }}
    >
      AE
    </div>
  );
}
