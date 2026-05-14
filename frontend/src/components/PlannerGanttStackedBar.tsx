import React from "react";
import { useDraggable } from "@dnd-kit/core";
import type { PlannerGanttItem } from "../services/plannerApi";
import { ERP_COLORS } from "../styles/ui";
import { PlannerGanttOperationBlock, plannerGanttHoverDetails } from "./PlannerGanttOperationBlock";
import { ganttCellItemKey } from "./plannerGanttDayUtils";

export type PlannerGanttStackedBarProps = {
  item: PlannerGanttItem;
  isDragging?: boolean;
  isSelected?: boolean;
  onSelect: (item: PlannerGanttItem) => void;
  barColor: string;
  minBlockHeight: number;
};

/** Blok v denní buňce — plná šířka sloupce, stejný obsah jako dříve. */
export function PlannerGanttStackedBar({
  item,
  isDragging = false,
  isSelected = false,
  onSelect,
  barColor,
  minBlockHeight,
}: PlannerGanttStackedBarProps) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id: `op-${ganttCellItemKey(item)}`,
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
        borderRadius: 8,
        padding: "3px 6px",
        background: `linear-gradient(180deg, ${barColor} 0%, ${barColor} 88%, rgba(15,23,42,0.18) 100%)`,
        color: "#fff",
        overflow: "hidden",
        boxSizing: "border-box",
        border: "1px solid rgba(255,255,255,0.35)",
        boxShadow: [
          "0 1px 3px rgba(15, 23, 42, 0.18)",
          !item.materialReady ? `inset 0 0 0 1px ${ERP_COLORS.waitFg}` : "",
          isSelected ? `0 0 0 2px ${ERP_COLORS.primary}` : "",
        ]
          .filter(Boolean)
          .join(", "),
        cursor: "grab",
        touchAction: "none",
        opacity: isDragging ? 0.35 : item.materialReady ? 1 : 0.9,
        transform: dragTransform,
        zIndex: transform ? 1000 : isSelected ? 5 : 2,
        flexShrink: 0,
        transition: "box-shadow 160ms ease, opacity 160ms ease, filter 160ms ease",
        filter: isDragging ? "saturate(0.85)" : "none",
      }}
      onMouseEnter={(e) => {
        if (transform) return;
        e.currentTarget.style.filter = "brightness(1.06)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.filter = isDragging ? "saturate(0.85)" : "none";
      }}
    >
      <PlannerGanttOperationBlock item={item} />
    </div>
  );
}
