import type { AppEnvironment, AppInfoDto } from "../services/appInfoApi";

/**
 * Build-time fallback pro login obrazovku, když backend `/app-info` není
 * dostupný. Hodnoty lze přebít Vite env proměnnými:
 *   VITE_APP_VERSION
 *   VITE_APP_ENV       (DEV | TEST | PROD)
 *
 * Runtime reálně čte verzi z backendu (jeden zdroj pravdy = `app.core.config.settings`).
 */

const ENV = (import.meta as any).env || {};

function normalizeEnv(raw: unknown): AppEnvironment {
  const v = String(raw || "").toUpperCase();
  if (v === "PROD" || v === "TEST" || v === "DEV") return v;
  if (ENV.PROD) return "PROD";
  return "DEV";
}

export const FALLBACK_APP_INFO: AppInfoDto = {
  name: "AKENG ERP",
  version: String(ENV.VITE_APP_VERSION || "0.1.0"),
  environment: normalizeEnv(ENV.VITE_APP_ENV),
  subtitle: "Řízení výroby, plánování, sklad a provoz",
};
