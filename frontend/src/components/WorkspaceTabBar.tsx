import React from "react";
import { UI } from "../styles/ui";

export type WorkspaceTabBarItem = { key: string; title: string };

type Props = {
  tabs: WorkspaceTabBarItem[];
  activeKey: string | null;
  onSelect: (key: string) => void;
  onClose: (key: string) => void;
  onCloseOthers: (keepKey: string) => void;
  onCloseAll: () => void;
};

const barStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "stretch",
  gap: 4,
  flexWrap: "wrap",
  padding: "8px 0 0",
  borderBottom: "1px solid #e2e8f0",
  marginBottom: 8,
  minHeight: 40,
};

const bulkActionBtn: React.CSSProperties = {
  border: "none",
  background: "transparent",
  color: "#64748b",
  fontSize: 12,
  fontWeight: 700,
  cursor: "pointer",
  padding: "6px 8px",
  borderRadius: 6,
  whiteSpace: "nowrap",
};

export default function WorkspaceTabBar({ tabs, activeKey, onSelect, onClose, onCloseOthers, onCloseAll }: Props) {
  if (tabs.length === 0) return null;

  const keepKey = activeKey ?? tabs[0]!.key;
  const canCloseOthers = tabs.length > 1;

  return (
    <div style={{ ...barStyle, alignItems: "flex-end" }} role="tablist" aria-label="Pracovní záložky">
      {tabs.map((t) => {
        const active = t.key === activeKey;
        return (
          <div
            key={t.key}
            role="tab"
            aria-selected={active}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              maxWidth: 280,
              padding: "6px 8px 6px 12px",
              borderRadius: active ? "10px 10px 0 0" : 10,
              border: "1px solid #e2e8f0",
              borderBottom: active ? "1px solid transparent" : undefined,
              marginBottom: active ? -1 : 0,
              background: active ? "#fff" : "#f1f5f9",
              fontWeight: active ? 900 : 600,
              fontSize: 13,
              color: active ? "#0f172a" : "#475569",
              cursor: "pointer",
              userSelect: "none",
            }}
            onClick={() => onSelect(t.key)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect(t.key);
              }
            }}
            tabIndex={0}
          >
            <span
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                flex: 1,
                minWidth: 0,
              }}
              title={t.title}
            >
              {t.title}
            </span>
            <button
              type="button"
              aria-label={`Zavřít záložku ${t.title}`}
              onClick={(e) => {
                e.stopPropagation();
                onClose(t.key);
              }}
              style={{
                ...UI.buttons.secondary,
                padding: "0 6px",
                minWidth: 26,
                height: 24,
                lineHeight: "22px",
                fontSize: 14,
                fontWeight: 900,
                borderRadius: 6,
                flexShrink: 0,
              }}
            >
              ×
            </button>
          </div>
        );
      })}
      <div
        style={{
          marginLeft: "auto",
          display: "flex",
          alignItems: "center",
          gap: 4,
          flexWrap: "wrap",
          paddingBottom: 4,
        }}
      >
        <button
          type="button"
          style={{
            ...bulkActionBtn,
            opacity: canCloseOthers ? 1 : 0.45,
            cursor: canCloseOthers ? "pointer" : "not-allowed",
          }}
          disabled={!canCloseOthers}
          onClick={() => {
            if (canCloseOthers) onCloseOthers(keepKey);
          }}
        >
          Zavřít ostatní
        </button>
        <span style={{ color: "#cbd5e1", fontSize: 12, userSelect: "none" }} aria-hidden>
          |
        </span>
        <button type="button" style={bulkActionBtn} onClick={() => onCloseAll()}>
          Zavřít všechny
        </button>
      </div>
    </div>
  );
}
