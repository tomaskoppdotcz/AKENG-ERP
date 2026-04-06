import React from "react";
import { useDraggable } from "@dnd-kit/core";
import type { PlannerGanttItem } from "../services/plannerApi";
import { PlannerGanttOperationBlock, plannerGanttHoverDetails } from "./PlannerGanttOperationBlock";

export type PlannerGanttStackedBarProps = {
  item: PlannerGanttItem;
  isDragging?: boolean;
  onSelect: (item: PlannerGanttItem) => void;
  barColor: string;
  minBlockHeight: number;
};

/** Blok v denní buňce — plná šířka sloupce, stejný obsah jako dříve. */
export function PlannerGanttStackedBar({
  item,
  isDragging = false,
  onSelect,
  barColor,
  minBlockHeight,
}: PlannerGanttStackedBarProps) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id: `op-${item.operationId}`,
    data: {
      type: "planning-operation",
      item,
    },
  });

  const dragTransform = transform
    ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
    : undefined;

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(item);
      }}
      title={plannerGanttHoverDetails(item)}
      style={{
        width: "100%",
        minWidth: 0,
        minHeight: minBlockHeight,
        borderRadius: 5,
        padding: "2px 5px",
        background: barColor,
        color: "#fff",
        overflow: "hidden",
        boxSizing: "border-box",
        boxShadow: item.materialReady
          ? "0 1px 3px rgba(15,23,42,0.12)"
          : "0 1px 3px rgba(15,23,42,0.12), inset 0 0 0 1px rgba(251,191,36,0.95)",
        cursor: "grab",
        touchAction: "none",
        opacity: isDragging ? 0.35 : item.materialReady ? 1 : 0.88,
        transform: dragTransform,
        zIndex: transform ? 1000 : 2,
        flexShrink: 0,
      }}
    >
      <PlannerGanttOperationBlock item={item} />
    </div>
  );
}
