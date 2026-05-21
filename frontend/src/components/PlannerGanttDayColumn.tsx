import React from "react";
import { useDroppable } from "@dnd-kit/core";
import type { PlannerGanttItem } from "../services/plannerApi";
import { ERP_COLORS } from "../styles/ui";
import { plannerGanttItemColor } from "../utils/plannerGanttStatus";
import { PlannerGanttStackedBar } from "./PlannerGanttStackedBar";
import { ganttCellItemKey } from "./plannerGanttDayUtils";

function ColumnDropSpacer({
  machineId,
  day,
  queuePosition,
  droppableId,
  fillColumn = false,
}: {
  machineId: number;
  day: string;
  queuePosition: number;
  /** Musí být unikátní v rámci DndContext (více řádků stejné operace = stejné qp). */
  droppableId: string;
  fillColumn?: boolean;
}) {
  const { isOver, setNodeRef } = useDroppable({
    id: droppableId,
    data: {
      type: "queue-slot",
      machineId,
      queuePosition,
      day, // F2.2: target calendar day for cross-day DnD
    },
  });

  return (
    <div
      ref={setNodeRef}
      style={{
        width: "100%",
        minHeight: fillColumn ? "100%" : 5,
        height: fillColumn ? "100%" : 5,
        flex: fillColumn ? 1 : "none",
        flexShrink: 0,
        borderRadius: 2,
        background: isOver ? ERP_COLORS.primaryLight : "transparent",
        boxShadow: isOver ? `inset 0 -2px 0 ${ERP_COLORS.primary}` : "none",
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
  selectedOperationId?: number | null;
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
  selectedOperationId = null,
}: PlannerGanttDayColumnProps) {
  const gIndex = (opId: number) => globalOrder.findIndex((x) => x.operationId === opId);

  return (
    <div
      style={{
        width: dayColWidth,
        minWidth: dayColWidth,
        minHeight: rowMinHeight,
        boxSizing: "border-box",
        borderRight: `1px solid ${ERP_COLORS.divider}`,
        padding: cellPadPx,
        display: "flex",
        flexDirection: "column",
        gap: stackGapPx,
        alignItems: "stretch",
        background: `linear-gradient(180deg, ${ERP_COLORS.tableHeadBg} 0%, ${ERP_COLORS.neutralBg} 100%), repeating-linear-gradient(90deg, transparent, transparent 11px, ${ERP_COLORS.divider} 11px, ${ERP_COLORS.divider} 12px)`,
      }}
    >
      {items.length === 0 ? (
        // F2.2-fix: empty day still needs a drop zone so cross-day DnD works on empty calendar cells
        <ColumnDropSpacer
          machineId={machineId}
          day={day}
          queuePosition={1}
          droppableId={`slot-${machineId}-day-${day}-empty`}
          fillColumn={true}
        />
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
                isSelected={selectedOperationId != null && item.operationId === selectedOperationId}
                onSelect={onSelect}
                barColor={plannerGanttItemColor(item)}
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
