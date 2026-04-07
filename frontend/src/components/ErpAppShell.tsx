import React from "react";
import ErpShellSidebar from "./ErpShellSidebar";
import type { ErpNavGroup } from "../navigation/erpNavConfig";
import ErpTopBar from "./ErpTopBar";
import { UI } from "../styles/ui";

const S = UI.erpShell;

type Props = {
  activeModule: string;
  contextLine?: string | null;
  onNavigate: (moduleKey: string, tabTitle?: string) => void;
  rightSlot?: React.ReactNode;
  children: React.ReactNode;
  navGroups?: ErpNavGroup[];
};

export default function ErpAppShell({ activeModule, contextLine, onNavigate, rightSlot, children, navGroups }: Props) {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: S.background,
        fontFamily: "Arial, Helvetica, sans-serif",
      }}
    >
      <ErpShellSidebar activeModule={activeModule} onNavigate={onNavigate} navGroups={navGroups} />
      <div
        style={{
          marginLeft: S.sidebarWidth,
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          minWidth: 0,
          background: S.background,
        }}
      >
        <ErpTopBar activeModule={activeModule} contextLine={contextLine} rightSlot={rightSlot} />
        <main
          style={{
            flex: 1,
            minHeight: 0,
            overflow: "auto",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div
            style={{
              flex: 1,
              padding: "6px 10px 12px",
              boxSizing: "border-box",
              width: "100%",
            }}
          >
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
