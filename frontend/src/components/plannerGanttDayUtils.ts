import type { PlannerGanttItem } from "../services/plannerApi";

/** Stabilní klíč pro řádek buňky (operace může mít více segmentů). */
export function ganttCellItemKey(item: PlannerGanttItem): string {
  const s = item.ganttSegmentIndex ?? 0;
  return `${item.operationId}-${s}`;
}

/**
 * Pro vykreslení Gantt buňky: jedna API položka → jeden nebo více řádků (segmentů).
 * Zachová `scheduleSegments` pro detail panel.
 */
export function expandPlannerGanttItemsForCells(items: PlannerGanttItem[]): PlannerGanttItem[] {
  const out: PlannerGanttItem[] = [];
  for (const item of items) {
    const segs = item.scheduleSegments;
    if (!segs?.length) {
      out.push({ ...item, ganttSegmentIndex: 0 });
      continue;
    }
    if (segs.length === 1) {
      const s = segs[0];
      out.push({
        ...item,
        plannedStart: s.plannedStart ?? item.plannedStart,
        plannedEnd: s.plannedEnd ?? item.plannedEnd,
        ganttSegmentIndex: s.segmentIndex,
      });
      continue;
    }
    for (const s of segs) {
      out.push({
        ...item,
        plannedStart: s.plannedStart ?? item.plannedStart,
        plannedEnd: s.plannedEnd ?? item.plannedEnd,
        ganttSegmentIndex: s.segmentIndex,
      });
    }
  }
  return out;
}

/** Lokální kalendářní den operace (YYYY-MM-DD) z plannedStart. */
export function plannerItemStartDayKey(iso: string): string {
  const t = new Date(iso);
  const y = t.getFullYear();
  const m = `${t.getMonth() + 1}`.padStart(2, "0");
  const d = `${t.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Řazení uvnitř buňky dne: planned_start ↑, pak fronta, pak id. */
export function sortItemsInDayCell(a: PlannerGanttItem, b: PlannerGanttItem): number {
  const ta = a.plannedStart ? new Date(a.plannedStart).getTime() : 0;
  const tb = b.plannedStart ? new Date(b.plannedStart).getTime() : 0;
  if (ta !== tb) return ta - tb;
  const qa = a.queuePosition ?? 999999;
  const qb = b.queuePosition ?? 999999;
  if (qa !== qb) return qa - qb;
  if (a.operationId !== b.operationId) return a.operationId - b.operationId;
  return (a.ganttSegmentIndex ?? 0) - (b.ganttSegmentIndex ?? 0);
}

/** Globální pořadí na stroji (stejné kritérium jako buňka). */
export function plannerGlobalMachineOrder(items: PlannerGanttItem[]): PlannerGanttItem[] {
  return [...items].sort(sortItemsInDayCell);
}

/**
 * Přiřadí operaci do sloupce viditelného dne: primárně den začátku, jinak první viditelný den, který se s intervalem protne.
 */
export function resolveVisibleDayColumn(item: PlannerGanttItem, days: string[]): string | null {
  if (!item.plannedStart) return null;
  const daySet = new Set(days);
  const startK = plannerItemStartDayKey(item.plannedStart);
  if (daySet.has(startK)) return startK;
  const t0 = new Date(item.plannedStart).getTime();
  const t1 = new Date(item.plannedEnd ?? item.plannedStart).getTime();
  for (const d of days) {
    const ds = new Date(`${d}T00:00:00`).getTime();
    const de = new Date(`${d}T23:59:59.999`).getTime();
    if (t0 <= de && t1 >= ds) return d;
  }
  return null;
}

export function groupItemsByVisibleDay(
  items: PlannerGanttItem[],
  days: string[]
): Map<string, PlannerGanttItem[]> {
  const map = new Map<string, PlannerGanttItem[]>();
  for (const d of days) map.set(d, []);
  for (const item of items) {
    const col = resolveVisibleDayColumn(item, days);
    if (col) map.get(col)!.push(item);
  }
  for (const d of days) {
    map.set(d, [...(map.get(d) ?? [])].sort(sortItemsInDayCell));
  }
  return map;
}

export function maxDayStackCount(grouped: Map<string, PlannerGanttItem[]>, days: string[]): number {
  let m = 0;
  for (const d of days) {
    const n = grouped.get(d)?.length ?? 0;
    if (n > m) m = n;
  }
  return m;
}
