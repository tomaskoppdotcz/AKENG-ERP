import React from "react";
import { UI } from "../styles/ui";
import type { ProductionOrderLocationSummary, ProductionOrderWorkflowPhase } from "../utils/productionOrderLocationUi";

function badgeStyle(phase: ProductionOrderWorkflowPhase): React.CSSProperties {
  switch (phase) {
    case "finished":
      return { background: "#dcfce7", color: "#166534", border: "1px solid #86efac" };
    case "in_progress":
      return { background: "#dbeafe", color: "#1d4ed8", border: "1px solid #93c5fd" };
    case "waiting":
      return { background: "#fef3c7", color: "#b45309", border: "1px solid #fcd34d" };
    case "no_route":
      return { background: "#f1f5f9", color: "#64748b", border: "1px solid #e2e8f0" };
  }
}

function ctxField(label: string, value: string) {
  return (
    <div key={label}>
      <div style={UI.statLabel}>{label}</div>
      <div style={{ ...UI.statValue, marginTop: 4 }}>{value}</div>
    </div>
  );
}

type Props = {
  summary: ProductionOrderLocationSummary;
};

export default function ProductionOrderLocationContext({ summary }: Props) {
  const fields: React.ReactNode[] = [
    ctxField("Pracoviště (kde je díl)", summary.workplaceWherePartIs),
    ctxField("Aktuální operace", summary.operationCurrent),
    ctxField("Následující operace", summary.nextOperationLine),
    ctxField("Pracoviště následující operace", summary.nextOperationWorkplace),
  ];
  if (summary.followingLine !== "—") {
    fields.push(ctxField("Poté", summary.followingLine));
  }
  const showGrid = summary.phase === "waiting" || summary.phase === "in_progress";
  return (
    <div>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "baseline",
          gap: "10px 14px",
          marginBottom: showGrid ? 14 : 0,
        }}
      >
        <span style={{ ...UI.detailStatusBadge, ...badgeStyle(summary.phase) }}>{summary.statusBadge}</span>
        <span style={{ fontSize: 15, fontWeight: 900, color: "#0f172a" }}>{summary.headline}</span>
        <span style={{ fontSize: 13, color: "#64748b", fontWeight: 600 }}>{summary.subline}</span>
      </div>
      {showGrid ? <div style={UI.detailPageHeaderContextGrid}>{fields}</div> : null}
    </div>
  );
}
