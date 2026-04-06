import type { ProductionOrderOperationRow } from "../services/productionOrdersApi";

export type ProductionOrderWorkflowPhase = "no_route" | "waiting" | "in_progress" | "finished";

export type ProductionOrderLocationSummary = {
  phase: ProductionOrderWorkflowPhase;
  statusBadge: string;
  headline: string;
  subline: string;
  /** Kde se díl nachází ve výrobě (čeká / probíhá) */
  workplaceWherePartIs: string;
  /** Probíhající operace nebo stav čekání */
  operationCurrent: string;
  /** Bezprostředně následující operace v postupu */
  nextOperationLine: string;
  /** Pracoviště následující operace (pro kontext) */
  nextOperationWorkplace: string;
  /** Operace / krok až za následujícím (může být —) */
  followingLine: string;
};

function formatOp(op: ProductionOrderOperationRow): string {
  return `${op.operation_no}. ${op.operation_name}`;
}

function wpl(w: string | null | undefined): string {
  const t = (w || "").trim();
  return t || "—";
}

export function buildProductionOrderLocationSummary(
  operations: ProductionOrderOperationRow[]
): ProductionOrderLocationSummary {
  const sorted = [...operations].sort((a, b) => a.operation_no - b.operation_no);
  if (sorted.length === 0) {
    return {
      phase: "no_route",
      statusBadge: "Bez postupu",
      headline: "Není definovaný technologický postup",
      subline: "Doplňte portfolio / TP pro sledování polohy ve výrobě.",
      workplaceWherePartIs: "—",
      operationCurrent: "—",
      nextOperationLine: "—",
      nextOperationWorkplace: "—",
      followingLine: "—",
    };
  }

  const allDone = sorted.every((o) => o.operation_status === "done");
  if (allDone) {
    return {
      phase: "finished",
      statusBadge: "Dokončeno",
      headline: "Výroba dokončena",
      subline: "Všechny operace uzavřeny; případně přijměte výrobek na sklad.",
      workplaceWherePartIs: "—",
      operationCurrent: "—",
      nextOperationLine: "—",
      nextOperationWorkplace: "—",
      followingLine: "—",
    };
  }

  const inProg = sorted.find((o) => o.operation_status === "in_progress");
  if (inProg) {
    const ix = sorted.indexOf(inProg);
    const next = sorted[ix + 1];
    const after = sorted[ix + 2];
    const wCur = wpl(inProg.workplace_name);
    return {
      phase: "in_progress",
      statusBadge: "Probíhá",
      headline: `Na pracovišti: ${wCur}`,
      subline: `Probíhá ${formatOp(inProg)}`,
      workplaceWherePartIs: wCur,
      operationCurrent: formatOp(inProg),
      nextOperationLine: next ? formatOp(next) : "—",
      nextOperationWorkplace: next ? wpl(next.workplace_name) : "—",
      followingLine: after ? formatOp(after) : "—",
    };
  }

  const frontier = sorted.find((o) => o.operation_status !== "done")!;
  const fi = sorted.indexOf(frontier);
  const after = sorted[fi + 1];
  const wF = wpl(frontier.workplace_name);
  return {
    phase: "waiting",
    statusBadge: "Čeká",
    headline: `Čeká na ${wF}`,
    subline: `Následuje ${formatOp(frontier)}`,
    workplaceWherePartIs: wF,
    operationCurrent: "Čeká na zahájení",
    nextOperationLine: formatOp(frontier),
    nextOperationWorkplace: wF,
    followingLine: after ? formatOp(after) : "—",
  };
}
