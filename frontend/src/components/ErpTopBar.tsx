import React from "react";
import { UI } from "../styles/ui";

const S = UI.erpShell;

type Props = {
  activeModule: string;
  /** Volitelně titulek aktivní pracovní záložky (kontext). */
  contextLine?: string | null;
  rightSlot?: React.ReactNode;
};

export default function ErpTopBar({ activeModule, contextLine, rightSlot }: Props) {
  return (
    <header
      style={{
        flexShrink: 0,
        height: S.topBarHeight,
        minHeight: S.topBarHeight,
        background: S.topBarBg,
        borderBottom: S.topBarBorder,
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "0 10px 0 12px",
        boxSizing: "border-box",
      }}
    >
      <div style={{ minWidth: 0, flex: "1 1 auto", display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, fontWeight: 800, color: "#0f172a" }}>{activeModule}</span>
        {contextLine && contextLine.trim() && contextLine.trim() !== activeModule ? (
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: "#64748b",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              maxWidth: "min(520px, 45vw)",
            }}
            title={contextLine}
          >
            {contextLine}
          </span>
        ) : null}
      </div>
      {rightSlot ? (
        <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 8 }}>{rightSlot}</div>
      ) : null}
    </header>
  );
}
