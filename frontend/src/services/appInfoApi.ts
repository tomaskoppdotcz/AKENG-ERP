const API_BASE = (import.meta as any).env?.VITE_API_BASE_URL || "http://127.0.0.1:8000";

export type AppEnvironment = "DEV" | "TEST" | "PROD";

export type AppInfoDto = {
  name: string;
  version: string;
  environment: AppEnvironment;
  subtitle: string;
};

/** Pokud backend není dostupný, volající použije `FALLBACK_APP_INFO` z `constants/buildInfo`. */
export async function fetchAppInfo(): Promise<AppInfoDto> {
  const res = await fetch(`${API_BASE}/app-info`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as AppInfoDto;
  const env = (data.environment || "DEV").toString().toUpperCase() as AppEnvironment;
  return { ...data, environment: env };
}
