import React, { useState } from "react";
import { UI } from "../styles/ui";
import MaterialGroupLibraryPage from "./MaterialGroupLibraryPage";
import MaterialLibraryPage from "./MaterialLibraryPage";
import StorageLocationPage from "./StorageLocationPage";

const SUBTABS = ["Materiály", "Skupiny materiálů", "Umístění"] as const;

/**
 * Skladové číselníky (knihovny) — mimo modul Nastavení.
 */
export default function SkladCiselnikyPage() {
  const [activeSubtab, setActiveSubtab] = useState<(typeof SUBTABS)[number]>("Materiály");
  const [hover, setHover] = useState<(typeof SUBTABS)[number] | null>(null);

  return (
    <div style={UI.container}>
      <div style={{ paddingTop: 6, display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={UI.pageHeaderRow}>
          <div>
            <div style={UI.sectionTitle}>Číselníky skladu</div>
            <div style={UI.sectionSubtitle}>Materiály, skupiny a umístění</div>
          </div>
        </div>
        <div style={{ width: "100%", overflowX: "auto" }}>
          <div style={{ ...UI.subTabsContainer, marginTop: 0, marginBottom: 0 }}>
            {SUBTABS.map((tab) => {
              const a = tab === activeSubtab;
              return (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveSubtab(tab)}
                  onMouseEnter={() => setHover(tab)}
                  onMouseLeave={() => setHover((h) => (h === tab ? null : h))}
                  style={{
                    ...UI.subTab,
                    ...(a ? UI.subTabActive : {}),
                    ...(!a && hover === tab ? UI.subTabHover : {}),
                  }}
                >
                  {tab}
                </button>
              );
            })}
          </div>
        </div>
        {activeSubtab === "Materiály" ? <MaterialLibraryPage /> : null}
        {activeSubtab === "Skupiny materiálů" ? <MaterialGroupLibraryPage /> : null}
        {activeSubtab === "Umístění" ? <StorageLocationPage /> : null}
      </div>
    </div>
  );
}
