/** Jednoduchý identifikátor uživatele pro per-user UI (hlavička X-AKENG-Actor). */

export const ERP_UI_ACTOR_STORAGE_KEY = "akeng_erp_ui_actor";

export function getUiActorIdentifier(): string {
  try {
    const v = localStorage.getItem(ERP_UI_ACTOR_STORAGE_KEY)?.trim();
    if (v) return v.slice(0, 256);
  } catch {
    /* ignore */
  }
  return "default";
}

export function setUiActorIdentifier(value: string): void {
  try {
    const t = value.trim().slice(0, 256);
    if (!t) {
      localStorage.removeItem(ERP_UI_ACTOR_STORAGE_KEY);
      return;
    }
    localStorage.setItem(ERP_UI_ACTOR_STORAGE_KEY, t);
  } catch {
    /* ignore */
  }
}
