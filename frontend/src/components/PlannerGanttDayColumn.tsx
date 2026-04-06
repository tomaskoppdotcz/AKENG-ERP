import React from "react";
import { useDroppable } from "@dnd-kit/core";
import type { PlannerGanttItem } from "../services/plannerApi";
import { PlannerGanttStackedBar } from "./PlannerGanttStackedBar";

function statusColor(status: string): string {
  const s = (status || "").toLowerCase();
  if (s === "hotovo" || s === "done" || s === "finished") return "#10b981";
  if (s === "bezi" || s === "running" || s === "in_progress") return "#3b82f6";
  if (s === "blokovano" || s === "blocked") return "#ef4444";
  if (s === "ceka" || s === "ready" || s === "waiting_release") return "#94a3b8";
  if (s === "naplanovano" || s === "planned") return "#f59e0b";
  return "#f59e0b";
}

function ColumnDropSpacer({
  machineId,
  day,
  queuePosition,
}: {
  machineId: number;
  day: string;
  queuePosition: number;
}) {
  const { isOver, setNodeRef } = useDroppable({
    id: `slot-${machineId}-day-${day}-qp-${queuePosition}`,
    data: {
      type: "queue-slot",
      machineId,
      queuePosition,
    },
  });

  return (
    <div
      ref={setNodeRef}
      style={{
        width: "100%",
        minHeight: 5,
        height: 5,
        flexShrink: 0,
        borderRadius: 2,
        background: isOver ? "rgba(59,130,246,0.28)" : "transparent",
        boxShadow: isOver ? "inset 0 -2px 0 #3b82f6" : "none",
        transition: "background 100ms ease",
      }}
    />
  );
}

export type PlannerGanttDayColumnProps = {
  day: string;
  machineId: number;
  dayColWidth: number;
  rowMinHeight: number;
  items: PlannerGanttItem[];
  globalOrder: PlannerGanttItem[];
  activeDragItemId: number | null;
  onSelect: (item: PlannerGanttItem) => void;
  stackGapPx: number;
  cellPadPx: number;
  minBlockHeight: number;
};

/** Jedna denní buňka — operace pod sebou, kompaktní mezery. */
export function PlannerGanttDayColumn({
  day,
  machineId,
  dayColWidth,
  rowMinHeight,
  items,
  globalOrder,
  activeDragItemId,
  onSelect,
  stackGapPx,
  cellPadPx,
  minBlockHeight,
}: PlannerGanttDayColumnProps) {
  const gIndex = (opId: number) => globalOrder.findIndex((x) => x.operationId === opId);

  return (
    <div
      style={{
        width: dayColWidth,
        minWidth: dayColWidth,
        minHeight: rowMinHeight,
        boxSizing: "border-box",
        borderRight: "1px solid rgba(148,163,184,0.35)",
        padding: cellPadPx,
        display: "flex",
        flexDirection: "column",
        gap: stackGapPx,
        alignItems: "stretch",
        background: "rgba(248,250,252,0.65)",
      }}
    >
      {items.length === 0 ? (
        <div style={{ flex: 1, minHeight: 8 }} />
      ) : (
        items.map((item, idx) => {
          const gIdx = gIndex(item.operationId);
          return (
            <React.Fragment key={item.operationId}>
              {idx === 0 ? (
                <ColumnDropSpacer machineId={machineId} day={day} queuePosition={gIdx + 1} />
              ) : null}
              <PlannerGanttStackedBar
                item={item}
                isDragging={activeDragItemId === item.operationId}
                onSelect={onSelect}
                barColor={statusColor(item.status)}
                minBlockHeight={minBlockHeight}
              />
              <ColumnDropSpacer machineId={machineId} day={day} queuePosition={gIdx + 2} />
            </React.Fragment>
          );
        })
      )}
    </div>
  );
}
