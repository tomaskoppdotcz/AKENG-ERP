import React, { useEffect, useState } from "react";
import { ERP_NAV_GROUPS, type ErpNavGroup, groupContainsActiveModule } from "../navigation/erpNavConfig";
import { UI } from "../styles/ui";

const S = UI.erpShell;

type Props = {
  activeModule: string;
  onNavigate: (moduleKey: string, tabTitle?: string) => void;
  /** When omitted, full `ERP_NAV_GROUPS` is used (legacy). */
  navGroups?: ErpNavGroup[];
};

export default function ErpShellSidebar({ activeModule, onNavigate, navGroups }: Props) {
  const groups = navGroups ?? ERP_NAV_GROUPS;

  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    for (const g of groups) init[g.id] = true;
    return init;
  });

  useEffect(() => {
    setExpanded((prev) => {
      const next = { ...prev };
      for (const g of groups) {
        if (groupContainsActiveModule(g, activeModule)) next[g.id] = true;
      }
      return next;
    });
  }, [activeModule, groups]);

  return (
    <aside
      style={{
        position: "fixed",
        left: 0,
        top: 0,
        bottom: 0,
        width: S.sidebarWidth,
        zIndex: 60,
        background: S.sidebarBg,
        borderRight: S.sidebarBorder,
        display: "flex",
        flexDirection: "column",
        boxSizing: "border-box",
      }}
      aria-label="Hlavní navigace"
    >
      <div
        style={{
          flexShrink: 0,
          padding: "10px 12px 8px",
          borderBottom: "1px solid rgba(255,255,255,0.08)",
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 900, color: S.sidebarText, letterSpacing: "0.02em" }}>
          AKENG ERP
        </div>
        <div style={{ fontSize: 10, fontWeight: 700, color: S.sidebarGroupHeader, marginTop: 2, textTransform: "uppercase" }}>
          Provozní přehled
        </div>
      </div>

      <nav
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          overflowX: "hidden",
          padding: "6px 0 12px",
        }}
      >
        {groups.map((group) => {
          const isOpen = expanded[group.id] !== false;
          const hasActive = groupContainsActiveModule(group, activeModule);
          return (
            <div key={group.id} style={{ marginBottom: 2 }}>
              <button
                type="button"
                aria-expanded={isOpen}
                onClick={() => setExpanded((s) => ({ ...s, [group.id]: !isOpen }))}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "5px 10px",
                  border: "none",
                  background: hasActive ? "rgba(255,255,255,0.06)" : "transparent",
                  cursor: "pointer",
                  fontSize: 11,
                  fontWeight: 800,
                  color: S.sidebarGroupHeader,
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  textAlign: "left",
                  fontFamily: "inherit",
                }}
              >
                <span style={{ fontSize: 9, width: 10, color: S.sidebarTextMuted }}>{isOpen ? "▼" : "▶"}</span>
                <span style={{ flex: 1, minWidth: 0 }}>{group.label}</span>
              </button>
              {isOpen ? (
                <ul style={{ listStyle: "none", margin: 0, padding: "2px 0 4px" }}>
                  {group.items.map((item) => {
                    const active = item.moduleKey === activeModule;
                    return (
                      <li key={item.moduleKey}>
                        <button
                          type="button"
                          onClick={() => onNavigate(item.moduleKey, item.tabTitle ?? item.label)}
                          style={{
                            width: "100%",
                            display: "block",
                            padding: "5px 10px 5px 26px",
                            border: "none",
                            borderLeft: active ? `3px solid ${S.itemActiveBar}` : "3px solid transparent",
                            background: active ? S.itemActive : "transparent",
                            color: active ? "#fff" : S.sidebarText,
                            fontSize: 12,
                            fontWeight: active ? 800 : 600,
                            cursor: "pointer",
                            textAlign: "left",
                            fontFamily: "inherit",
                            lineHeight: 1.35,
                          }}
                          onMouseEnter={(e) => {
                            if (!active) (e.currentTarget as HTMLButtonElement).style.background = S.itemHover;
                          }}
                          onMouseLeave={(e) => {
                            if (!active) (e.currentTarget as HTMLButtonElement).style.background = "transparent";
                          }}
                        >
                          {item.label}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
