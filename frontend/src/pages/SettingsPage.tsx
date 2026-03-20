import React, { useState } from "react";
import { UI } from "../styles/ui";
import MaterialLibraryPage from "./MaterialLibraryPage";
import OperationLibraryPage from "./OperationLibraryPage";
import WorkplaceLibraryPage from "./WorkplaceLibraryPage";

const SUBTABS = ["Operace", "Pracoviště", "Materiály"] as const;
type SettingsSubtab = (typeof SUBTABS)[number];

type Props = {
  onBackToDashboard?: () => void;
};

export default function SettingsPage({ onBackToDashboard }: Props) {
  const [activeSubtab, setActiveSubtab] = useState<SettingsSubtab>("Operace");
  const [hoverSubtab, setHoverSubtab] = useState<SettingsSubtab | null>(null);

  return (
    <div style={UI.container}>
      <div style={{ paddingTop: 10, display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={UI.pageHeaderRow}>
          <div>
            <div style={UI.sectionTitle}>Nastavení</div>
            <div style={UI.sectionSubtitle}>Firemní knihovny a základní číselníky</div>
          </div>
          <div style={UI.pageHeaderActions}>
            <button type="button" style={UI.buttons.secondary} onClick={() => onBackToDashboard?.()}>
              Zpět na nástěnku
            </button>
          </div>
        </div>

        <div style={{ width: "100%", overflowX: "auto", overflowY: "hidden", marginBottom: 4 }}>
          <div
            style={{
              ...UI.subTabsContainer,
              overflow: "visible",
              width: "max-content",
              minWidth: "100%",
              justifyContent: "flex-start",
              marginTop: 0,
              marginBottom: 0,
            }}
          >
            {SUBTABS.map((tab) => {
              const active = tab === activeSubtab;
              return (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveSubtab(tab)}
                  onMouseEnter={() => setHoverSubtab(tab)}
                  onMouseLeave={() => setHoverSubtab((h) => (h === tab ? null : h))}
                  style={{
                    ...UI.subTab,
                    ...(active ? UI.subTabActive : {}),
                    ...(!active && hoverSubtab === tab ? UI.subTabHover : {}),
                  }}
                >
                  {tab}
                </button>
              );
            })}
          </div>
        </div>

        {activeSubtab === "Operace" ? (
          <OperationLibraryPage />
        ) : activeSubtab === "Pracoviště" ? (
          <WorkplaceLibraryPage />
        ) : (
          <MaterialLibraryPage />
        )}
      </div>
    </div>
  );
}
