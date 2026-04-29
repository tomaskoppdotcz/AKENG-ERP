/**
 * Jednotný odvozený model provozní hlavičky detailu VP — české stavy, žádné surové backend řetězce.
 */

import type { CSSProperties } from "react";

import type { ProductionOrderDetail, ProductionOrderOperationRow } from "../services/productionOrdersApi";

export type VpHeaderStatusTone = "success" | "info" | "warning" | "danger" | "neutral";

export type ProductionOrderDetailHeaderModel = {
  /** Hlavní štítek (česky, provozní) */
  mainStatusLabel: string;
  mainStatusTone: VpHeaderStatusTone;
  /** Krátká věta pod titulkem */
  headlineSentence: string;
  completedCount: number;
  totalCount: number;
  progressPercent: number;
  /** Např. "3 / 12 · 25 %" */
  progressLine: string;
  completedOperationLine: string;
  currentOperationLine: string;
  nextOperationLine: string;
  /** Třetí řádek karty */
  rowIdentifiers: Array<{ key: string; label: string; value: string }>;
  /** Čtvrtý řádek */
  rowSource: Array<{ key: string; label: string; value: string }>;
};

function norm(s: string | null | undefined): string {
  return (s || "").trim().toLowerCase();
}

function isHotovo(st: string | null | undefined): boolean {
  const x = norm(st);
  return x === "hotovo" || x === "done" || x === "finished";
}

function isBezi(st: string | null | undefined): boolean {
  const x = norm(st);
  return x === "bezi" || x === "in_progress" || x === "running";
}

function wpl(w: string | null | undefined): string {
  const t = (w || "").trim();
  return t || "—";
}

function formatOp(op: ProductionOrderOperationRow): string {
  const machineCode = op.machine_code?.trim() || "—";
  return `${op.operation_no}. ${op.operation_name} — ${machineCode}`;
}

/** Poslední dokončená operace (nejvyšší operation_no mezi hotovo). */
function lastCompleted(sorted: ProductionOrderOperationRow[]): ProductionOrderOperationRow | undefined {
  let best: ProductionOrderOperationRow | undefined;
  for (const o of sorted) {
    if (!isHotovo(o.operation_status)) continue;
    if (!best || o.operation_no > best.operation_no) best = o;
  }
  return best;
}

/**
 * Heuristika podle názvu TP operace: sklad vs expedice (poslední krok výroby).
 */
function terminalStepKind(op: ProductionOrderOperationRow | undefined): "stock" | "expedition" | null {
  if (!op || !isHotovo(op.operation_status)) return null;
  const n = norm(op.operation_name);
  if (/(exped|expedi|balen|odesl|pick|ship)/.test(n)) return "expedition";
  if (/(příjem|prijem|sklad|náklad|naklad|stock|receipt)/.test(n)) return "stock";
  return null;
}

function anyStartedOrReported(sorted: ProductionOrderOperationRow[]): boolean {
  return sorted.some((o) => Boolean(o.started_at) || isBezi(o.operation_status) || isHotovo(o.operation_status));
}

function isWorkflowCancelled(workflow: string | null | undefined): boolean {
  const w = norm(workflow);
  return w === "cancelled" || w === "canceled" || w === "storno";
}

function formatDueCs(d: string | null | undefined): string {
  const raw = (d || "").trim();
  if (!raw) return "—";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [y, m, da] = raw.split("-").map((x) => Number(x));
    return new Date(y, m - 1, da).toLocaleDateString("cs-CZ");
  }
  return raw;
}

export function buildProductionOrderDetailHeaderModel(d: ProductionOrderDetail): ProductionOrderDetailHeaderModel {
  const sorted = [...d.operations].sort((a, b) => a.operation_no - b.operation_no);
  const totalCount = sorted.length;
  const completedCount = sorted.filter((o) => isHotovo(o.operation_status)).length;
  const progressPercent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;
  const progressLine = `${completedCount} / ${totalCount} · ${progressPercent} %`;

  const running = sorted.find((o) => isBezi(o.operation_status));
  const firstIncomplete = sorted.find((o) => !isHotovo(o.operation_status));
  const currentIndex = firstIncomplete ? sorted.findIndex((o) => o === firstIncomplete) : -1;
  const nextOp = currentIndex >= 0 && currentIndex + 1 < sorted.length ? sorted[currentIndex + 1] : undefined;
  const lastDone = lastCompleted(sorted);
  const terminalKind = lastDone ? terminalStepKind(lastDone) : null;
  const allDone = totalCount > 0 && completedCount === totalCount;
  const matReleased = Boolean(d.is_material_released_to_production ?? d.is_material_ready);
  const blockedRelease = d.blocked_until_reserved_stock_receipt === true;
  const cancelled = isWorkflowCancelled(d.workflow_status);

  let completedOperationLine = lastDone ? formatOp(lastDone) : "—";
  let currentOperationLine = firstIncomplete ? formatOp(firstIncomplete) : "Hotovo";
  let nextOperationLine = nextOp ? formatOp(nextOp) : "—";

  const backendHeader = d.operation_header ?? null;
  if (backendHeader) {
    completedOperationLine = backendHeader.completed_operation?.trim() || "—";
    currentOperationLine = backendHeader.current_operation?.trim() || "Hotovo";
    nextOperationLine = backendHeader.next_operation?.trim() || "—";
  }

  if (!backendHeader && running) {
    currentOperationLine = formatOp(running);
  } else if (!backendHeader && allDone && lastDone) {
    currentOperationLine = "Hotovo";
    nextOperationLine = "—";
  } else if (!backendHeader && lastDone && !allDone) {
    currentOperationLine = firstIncomplete ? formatOp(firstIncomplete) : "Hotovo";
  } else if (!backendHeader && nextOp) {
    currentOperationLine = firstIncomplete ? formatOp(firstIncomplete) : "Hotovo";
  }

  let mainStatusLabel = "Naplánováno";
  let mainStatusTone: VpHeaderStatusTone = "neutral";
  let headlineSentence = "Výrobní příkaz je připraven k rozvrhu a provozu.";

  if (cancelled) {
    mainStatusLabel = "Stornováno";
    mainStatusTone = "danger";
    headlineSentence = "Výrobní příkaz je stornován; provozní akce nejsou povoleny.";
  } else if (blockedRelease) {
    mainStatusLabel = "Blokováno";
    mainStatusTone = "warning";
    headlineSentence = "Čeká na uvolnění rezervovaného materiálu (restock WIP).";
  } else if (totalCount === 0) {
    mainStatusLabel = "Čeká";
    mainStatusTone = "warning";
    headlineSentence = "Chybí technologický postup v portfoliu — nelze odvodit operace.";
  } else if (allDone) {
    if (terminalKind === "stock") {
      mainStatusLabel = "Na skladě";
      mainStatusTone = "success";
      headlineSentence = "Výroba uzavřena; poslední krok odpovídá příjmu / skladové poloze.";
    } else if (terminalKind === "expedition") {
      mainStatusLabel = "K expedici";
      mainStatusTone = "success";
      headlineSentence = "Výroba uzavřena; díl je připraven k expedici.";
    } else {
      mainStatusLabel = "Hotovo";
      mainStatusTone = "success";
      headlineSentence = "Všechny operace výroby jsou uzavřeny.";
    }
  } else if (running) {
    mainStatusLabel = "Běží";
    mainStatusTone = "info";
    headlineSentence = `Probíhá ${formatOp(running)} na pracovišti ${wpl(running.workplace_name)}.`;
  } else if (!matReleased && firstIncomplete) {
    mainStatusLabel = "Čeká na materiál";
    mainStatusTone = "warning";
    headlineSentence = "Materiál ještě nebyl vydán na výrobu — nelze spouštět operace.";
  } else if (firstIncomplete) {
    const progressed = anyStartedOrReported(sorted);
    if (!progressed) {
      mainStatusLabel = "Naplánováno";
      mainStatusTone = "neutral";
      headlineSentence = `První krok: ${formatOp(firstIncomplete)} (${wpl(firstIncomplete.workplace_name)}).`;
    } else {
      mainStatusLabel = "Čeká";
      mainStatusTone = "warning";
      headlineSentence = `Čeká se na ${formatOp(firstIncomplete)} — pracoviště ${wpl(firstIncomplete.workplace_name)}.`;
    }
  }

  const lm = (() => {
    const v = d.logistic_mode;
    if (!v) return "—";
    if (v === "sklad") return "Sklad";
    if (v === "sklad_zakaznik") return "Sklad → zákazník";
    if (v === "vyroba_zakaznik") return "Výroba → zákazník";
    return v;
  })();

  const src = (() => {
    const v = d.source_type;
    if (!v) return "—";
    if (v === "stock_allocation") return "Ze skladu";
    if (v === "order_allocation") return "Výroba pro zakázku";
    if (v === "restock_allocation") return "Doplnění skladu";
    return v;
  })();

  const orderTypeLabel = d.order_type === "internal" ? "Interní zakázka" : "Zakázka";

  const term = formatDueCs(d.due_date);

  const drawingNumber = d.drawing_number?.trim() ? d.drawing_number : "—";
  const drawingRevision = d.drawing_revision?.trim() ? d.drawing_revision : "—";

  const rowIdentifiers: Array<{ key: string; label: string; value: string }> = [
    { key: "vp", label: "VP", value: d.vp_code || "—" },
    { key: "zakazka", label: orderTypeLabel, value: d.zakazka ?? "—" },
    {
      key: "order_ref",
      label: "Objednávka / reference",
      value: d.customer_order_no?.trim() ? d.customer_order_no : "—",
    },
    { key: "line", label: "\u0158\u00e1dek", value: d.line_no != null ? String(d.line_no) : "—" },
    { key: "gpn", label: "GPN", value: d.gpn ?? "—" },
    { key: "drawing_number", label: "Výkres", value: drawingNumber },
    { key: "drawing_revision", label: "Revize", value: drawingRevision },
    { key: "name", label: "Název", value: d.description ?? "—" },
    { key: "qty", label: "Množství", value: `${d.quantity} ks` },
    { key: "due", label: "Termín", value: term },
  ];

  const portfolioLine = (() => {
    const gpn = d.portfolio_item_gpn?.trim();
    const name = d.portfolio_item_name?.trim();
    const primary = gpn || name;
    if (!primary) return "—";
    if (d.portfolio_item_id != null) return `${primary} (ID ${d.portfolio_item_id})`;
    return primary;
  })();

  const rowSource: Array<{ key: string; label: string; value: string }> = [
    { key: "portfolio", label: "Portfolio varianta", value: portfolioLine },
    { key: "logistics", label: "Logistický režim", value: lm },
    {
      key: "source",
      label: "Typ zdroje",
      value: d.restock_redirected_from_internal ? `${src} · přesměrováno ze skladu` : src,
    },
  ];

  return {
    mainStatusLabel,
    mainStatusTone,
    headlineSentence,
    completedCount,
    totalCount,
    progressPercent,
    progressLine,
    completedOperationLine,
    currentOperationLine,
    nextOperationLine,
    rowIdentifiers,
    rowSource,
  };
}

export function vpHeaderBadgeStyle(tone: VpHeaderStatusTone): CSSProperties {
  const base: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    padding: "6px 14px",
    borderRadius: 999,
    fontSize: 13,
    fontWeight: 900,
    letterSpacing: "0.02em",
  };
  switch (tone) {
    case "success":
      return { ...base, background: "#dcfce7", color: "#166534", border: "1px solid #86efac" };
    case "info":
      return { ...base, background: "#dbeafe", color: "#1e40af", border: "1px solid #93c5fd" };
    case "warning":
      return { ...base, background: "#ffedd5", color: "#9a3412", border: "1px solid #fdba74" };
    case "danger":
      return { ...base, background: "#fee2e2", color: "#991b1b", border: "1px solid #fca5a5" };
    default:
      return { ...base, background: "#f1f5f9", color: "#475569", border: "1px solid #cbd5e1" };
  }
}
