import { akengFetch } from "./akengFetch";
import type { TableLayoutPayload } from "../overview/tableLayoutMerge";

const API_BASE = (import.meta as any).env?.VITE_API_BASE_URL || "http://127.0.0.1:8000";

async function readErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const t = await res.text();
    if (t) return t.slice(0, 500);
  } catch {
    /* ignore */
  }
  return fallback;
}

export type TableLayoutResponse = {
  page_key: string;
  user_identifier: string;
  layout: TableLayoutPayload | null;
};

export async function getTableLayout(pageKey: string): Promise<TableLayoutResponse> {
  const res = await akengFetch(`${API_BASE}/ui/table-layouts/${encodeURIComponent(pageKey)}`);
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "Nepodařilo se načíst rozložení tabulky."));
  }
  return res.json();
}

export async function putTableLayout(pageKey: string, layout: TableLayoutPayload): Promise<void> {
  const res = await akengFetch(`${API_BASE}/ui/table-layouts/${encodeURIComponent(pageKey)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ layout }),
  });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "Nepodařilo se uložit rozložení tabulky."));
  }
}
