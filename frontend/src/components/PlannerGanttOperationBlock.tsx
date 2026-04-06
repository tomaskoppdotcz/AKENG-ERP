import React from "react";
import type { PlannerGanttItem } from "../services/plannerApi";

const BLOCK_FONT_PX = 10;
const BLOCK_LINE_HEIGHT = 1.28;
const BLOCK_GAP_PX = 1;

function statusLabelForTooltip(status: string): string {
  const s = (status || "").toLowerCase();
  if (s === "bezi" || s === "running" || s === "in_progress") return "Běží";
  if (s === "hotovo" || s === "done" || s === "finished") return "Hotovo";
  if (s === "blokovano" || s === "blocked") return "Blokováno";
  if (s === "ceka" || s === "ready" || s === "waiting_release") return "Čeká";
  if (s === "naplanovano" || s === "planned") return "Naplánováno";
  return status || "—";
}

function formatPlanInstant(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("cs-CZ", { dateStyle: "short", timeStyle: "short" });
  } catch {
    return iso;
  }
}

/** Tooltip — kompletní detail (název operace, časy, materiál, …). */
export function plannerGanttHoverDetails(item: PlannerGanttItem): string {
  const mat = item.materialReady ? "Materiál: připraven" : "Materiál: čeká na vydání";
  return [
    item.operationName,
    `Operace č. ${item.operationNo} · WP: ${item.workplaceCode || item.machineName}`,
    `VP: ${item.workOrderNo ?? "—"}`,
    `GPN: ${item.gpn ?? "—"}`,
    `Další WP: ${item.nextWorkplaceCode ?? "—"}`,
    `Plán: ${formatPlanInstant(item.plannedStart)} → ${formatPlanInstant(item.plannedEnd)}`,
    `Časy: setup ${item.setupTimeMin} min · práce ${item.laborTimeTotalMin} min · celkem ${item.totalOperationTimeMin} min`,
    `Qty: ${item.qty}`,
    mat,
    `Stav: ${statusLabelForTooltip(item.status)}`,
    `Fronta: ${item.queuePosition ?? "—"}`,
  ].join("\n");
}

const rowBase: React.CSSProperties = {
  margin: 0,
  padding: 0,
  fontSize: BLOCK_FONT_PX,
  lineHeight: BLOCK_LINE_HEIGHT,
  fontWeight: 700,
  color: "#fff",
  overflow: "visible",
  wordBreak: "break-word" as const,
  overflowWrap: "anywhere" as const,
  hyphens: "auto" as const,
  maxWidth: "100%",
};

/**
 * Obsah Gantt bloku — 3 řádky bez ellipsis; text se zalamuje místo ořezu.
 */
export function PlannerGanttOperationBlock({ item }: { item: PlannerGanttItem }) {
  const wp = (item.workplaceCode || item.machineName || "?").toUpperCase();
  const next = item.nextWorkplaceCode ? item.nextWorkplaceCode.toUpperCase() : "—";
  const vp = item.workOrderNo ?? "—";
  const gpn = item.gpn ?? "—";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: BLOCK_GAP_PX,
        justifyContent: "center",
        minWidth: 0,
        width: "100%",
        height: "100%",
        boxSizing: "border-box",
      }}
    >
      <p style={{ ...rowBase, fontWeight: 800 }}>
        {item.operationNo} / {wp}
      </p>
      <p style={{ ...rowBase, fontWeight: 600, opacity: 0.96 }}>
        {vp} / {gpn}
      </p>
      <p style={{ ...rowBase, fontWeight: 600, opacity: 0.93 }}>
        → {next}
      </p>
    </div>
  );
}
