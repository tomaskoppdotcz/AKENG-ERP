import React from "react";
import { useDroppable } from "@dnd-kit/core";
import type { PlannerGanttItem } from "../services/plannerApi";
import { plannerGanttBarColor } from "../utils/plannerGanttStatus";
import { PlannerGanttStackedBar } from "./PlannerGanttStackedBar";
import { ganttCellItemKey } from "./plannerGanttDayUtils";

function ColumnDropSpacer({
  machineId,
  day,
  queuePosition,
  droppableId,
}: {
  machineId: number;
  day: string;
  queuePosition: number;
  /** Musí být unikátní v rámci DndContext (více řádků stejné operace = stejné qp). */
  droppableId: string;
}) {
  const { isOver, setNodeRef } = useDroppable({
    id: droppableId,
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
  activeDragItemKey: string | null;
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
  activeDragItemKey,
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
          const prev = idx > 0 ? items[idx - 1] : null;
          const sameOpAsPrev = prev && prev.operationId === item.operationId;
          const showSpacerBefore =
            idx === 0 ||
            (prev && !sameOpAsPrev);
          const qpBefore = gIdx + 1;
          const qpAfterPrev =
            prev != null ? gIndex(prev.operationId) + 2 : gIdx + 2;

          return (
            <React.Fragment key={ganttCellItemKey(item)}>
              {showSpacerBefore ? (
                <ColumnDropSpacer
                  machineId={machineId}
                  day={day}
                  queuePosition={idx === 0 ? qpBefore : qpAfterPrev}
                  droppableId={`slot-${machineId}-day-${day}-before-${ganttCellItemKey(item)}`}
                />
              ) : (
                <div style={{ minHeight: 5, height: 5, flexShrink: 0 }} aria-hidden />
              )}
              <PlannerGanttStackedBar
                item={item}
                isDragging={activeDragItemKey === ganttCellItemKey(item)}
                onSelect={onSelect}
                barColor={plannerGanttBarColor(item.status)}
                minBlockHeight={minBlockHeight}
              />
              <ColumnDropSpacer
                machineId={machineId}
                day={day}
                queuePosition={gIdx + 2}
                droppableId={`slot-${machineId}-day-${day}-after-${ganttCellItemKey(item)}`}
              />
            </React.Fragment>
          );
        })
      )}
    </div>
  );
}
