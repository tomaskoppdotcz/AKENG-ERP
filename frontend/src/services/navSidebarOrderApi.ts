import { akengFetch } from "./akengFetch";
import type { NavSidebarOrderMap } from "../navigation/applyNavOrder";

const API_BASE = (import.meta as any).env?.VITE_API_BASE_URL || "http://127.0.0.1:8000";

export async function getNavSidebarOrder(): Promise<NavSidebarOrderMap> {
  const res = await akengFetch(`${API_BASE}/ui/nav-sidebar-order`);
  if (!res.ok) {
    throw new Error("Nepodařilo se načíst pořadí navigace.");
  }
  const data = await res.json();
  const order = data?.order;
  if (!order || typeof order !== "object") {
    return {};
  }
  return order as NavSidebarOrderMap;
}

export async function putNavSidebarOrder(order: NavSidebarOrderMap): Promise<void> {
  const res = await akengFetch(`${API_BASE}/ui/nav-sidebar-order`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ order }),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(detail || "Nepodařilo se uložit pořadí navigace.");
  }
}
