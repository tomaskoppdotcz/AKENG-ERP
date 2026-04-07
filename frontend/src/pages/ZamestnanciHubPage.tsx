import React, { useState } from "react";
import { UI } from "../styles/ui";
import EmployeeGroupLibraryPage from "./EmployeeGroupLibraryPage";
import EmployeeLibraryPage from "./EmployeeLibraryPage";

const SUBTABS = ["Zaměstnanci", "Role zaměstnanců"] as const;

/**
 * Zaměstnanci a role — provozní knihovny mimo modul Nastavení.
 */
export default function ZamestnanciHubPage() {
  const [activeSubtab, setActiveSubtab] = useState<(typeof SUBTABS)[number]>("Zaměstnanci");
  const [hover, setHover] = useState<(typeof SUBTABS)[number] | null>(null);

  return (
    <div style={UI.container}>
      <div style={{ paddingTop: 6, display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={UI.pageHeaderRow}>
          <div>
            <div style={UI.sectionTitle}>Zaměstnanci</div>
            <div style={UI.sectionSubtitle}>Evidence osob a rolí pro výrobu / kiosk</div>
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
        {activeSubtab === "Zaměstnanci" ? <EmployeeLibraryPage /> : null}
        {activeSubtab === "Role zaměstnanců" ? <EmployeeGroupLibraryPage /> : null}
      </div>
    </div>
  );
}
