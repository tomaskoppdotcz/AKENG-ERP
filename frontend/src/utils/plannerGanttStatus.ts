import type { PlannerGanttItem } from "../services/plannerApi";
import { ERP_COLORS } from "../styles/ui";

/** True when this op is waiting_release and an earlier op on the same VP is scheduling_late. */
export function hasSchedulingLateEarlierOnVp(item: PlannerGanttItem, allItems: PlannerGanttItem[]): boolean {
  const woo = (item.workOrderNo || "").trim();
  if (!woo) return false;
  if ((item.status || "").toLowerCase() !== "waiting_release") return false;
  return allItems.some(
    (o) =>
      (o.workOrderNo || "").trim() === woo &&
      (o.status || "").toLowerCase() === "scheduling_late" &&
      o.operationNo < item.operationNo
  );
}

/** Bar / badge background color for Gantt and lists (ERP palette). */
export function plannerGanttBarColor(status: string): string {
  const s = (status || "").toLowerCase();
  if (s === "hotovo" || s === "done" || s === "finished") return ERP_COLORS.okFg;
  if (s === "bezi" || s === "running" || s === "in_progress") return ERP_COLORS.primary;
  if (s === "blokovano" || s === "blocked") return ERP_COLORS.problemFg;
  if (s === "scheduling_late") return ERP_COLORS.problemFg;
  if (s === "waiting_release") return "#4F46E5";
  if (s === "ceka" || s === "ready") return ERP_COLORS.textSecondary;
  if (s === "naplanovano" || s === "planned") return ERP_COLORS.waitFg;
  return ERP_COLORS.waitFg;
}

export function plannerGanttItemColor(item: PlannerGanttItem): string {
  if (item.isCooperation) return ERP_COLORS.waitFg;
  if (item.blockedByCooperation) return ERP_COLORS.problemFg;
  return plannerGanttBarColor(item.status);
}

export type PlannerStatusLabelContext = {
  item?: PlannerGanttItem;
  allItems?: PlannerGanttItem[];
};

/** User-facing label; optional VP context refines waiting_release after a late op. */
export function plannerGanttStatusLabel(status: string, ctx?: PlannerStatusLabelContext): string {
  if (ctx?.item?.blockedByCooperation) return "Blokováno kooperací";
  if (ctx?.item?.isCooperation) {
    const s = String(ctx.item.cooperationStatus ?? "").trim().toLowerCase();
    if (s === "received") return "Přijato z kooperace";
    if (s === "sent") return "Odesláno do kooperace";
    if (s === "cancelled") return "Kooperace zrušena";
    return "Kooperace čeká na odeslání";
  }
  const s = (status || "").toLowerCase();
  if (s === "scheduling_late") return "Po termínu / Nelze naplánovat do termínu";
  if (s === "waiting_release") {
    if (ctx?.item && ctx.allItems?.length && hasSchedulingLateEarlierOnVp(ctx.item, ctx.allItems)) {
      return "Čeká na uvolnění (předchozí po termínu)";
    }
    return "Čeká na uvolnění";
  }
  if (s === "bezi" || s === "running" || s === "in_progress") return "Běží";
  if (s === "hotovo" || s === "done" || s === "finished") return "Hotovo";
  if (s === "blokovano" || s === "blocked") return "Blokováno";
  if (s === "ceka" || s === "ready") return "Čeká";
  if (s === "naplanovano" || s === "planned") return "Naplánováno";
  return status || "—";
}
