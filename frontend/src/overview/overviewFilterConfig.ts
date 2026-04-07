import type { ErpWorkflowListFilter, OrdersOverviewOrderTypeFilter } from "../services/ordersApi";

/** Shodné s modulem Zakázky — typ zakázky v přehledu. */
export const OVERVIEW_ORDER_TYPE_OPTIONS: { id: OrdersOverviewOrderTypeFilter; label: string }[] = [
  { id: "customer", label: "Zákaznické" },
  { id: "internal", label: "Interní" },
  { id: "all", label: "Vše" },
];

/** Shodné s modulem Zakázky — workflow stav v seznamu. */
export const OVERVIEW_WORKFLOW_OPTIONS: { id: ErpWorkflowListFilter; label: string }[] = [
  { id: "active", label: "Aktivní" },
  { id: "cancelled", label: "Stornované" },
  { id: "all", label: "Vše" },
];
