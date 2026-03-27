import React, { useState } from "react";
import { UI } from "../styles/ui";
import CustomerLibraryPage from "./CustomerLibraryPage";
import MaterialGroupLibraryPage from "./MaterialGroupLibraryPage";
import MaterialLibraryPage from "./MaterialLibraryPage";
import OperationLibraryPage from "./OperationLibraryPage";
import PortfolioGroupLibraryPage from "./PortfolioGroupLibraryPage";
import StorageLocationPage from "./StorageLocationPage";
import WorkplaceLibraryPage from "./WorkplaceLibraryPage";

const SECTIONS = ["Obchod", "Výroba", "Sklad"] as const;
type Section = (typeof SECTIONS)[number];

const SUBTABS_BY_SECTION: Record<Section, readonly string[]> = {
  Obchod: ["Zákazníci", "Portfolio skupiny"],
  Výroba: ["Operace", "Pracoviště"],
  Sklad: ["Materiály", "Skupiny materiálů", "Umístění"],
};

type Props = {
  onBackToDashboard?: () => void;
};

export default function SettingsPage({ onBackToDashboard }: Props) {
  const [activeSection, setActiveSection] = useState<Section>("Obchod");
  const [activeSubtab, setActiveSubtab] = useState<string>(SUBTABS_BY_SECTION.Obchod[0]);
  const [hoverSection, setHoverSection] = useState<Section | null>(null);
  const [hoverSubtab, setHoverSubtab] = useState<string | null>(null);

  function selectSection(s: Section) {
    setActiveSection(s);
    setActiveSubtab(SUBTABS_BY_SECTION[s][0]);
  }

  function renderLibraryPage() {
    if (activeSection === "Obchod") {
      if (activeSubtab === "Zákazníci") return <CustomerLibraryPage />;
      if (activeSubtab === "Portfolio skupiny") return <PortfolioGroupLibraryPage />;
    }
    if (activeSection === "Výroba") {
      if (activeSubtab === "Operace") return <OperationLibraryPage />;
      if (activeSubtab === "Pracoviště") return <WorkplaceLibraryPage />;
    }
    if (activeSection === "Sklad") {
      if (activeSubtab === "Materiály") return <MaterialLibraryPage />;
      if (activeSubtab === "Skupiny materiálů") return <MaterialGroupLibraryPage />;
      if (activeSubtab === "Umístění") return <StorageLocationPage />;
    }
    return null;
  }

  const subtabs = SUBTABS_BY_SECTION[activeSection];

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
            {SECTIONS.map((tab) => {
              const active = tab === activeSection;
              return (
                <button
                  key={tab}
                  type="button"
                  onClick={() => selectSection(tab)}
                  onMouseEnter={() => setHoverSection(tab)}
                  onMouseLeave={() => setHoverSection((h) => (h === tab ? null : h))}
                  style={{
                    ...UI.subTab,
                    ...(active ? UI.subTabActive : {}),
                    ...(!active && hoverSection === tab ? UI.subTabHover : {}),
                  }}
                >
                  {tab}
                </button>
              );
            })}
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
            {subtabs.map((tab) => {
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

        {renderLibraryPage()}
      </div>
    </div>
  );
}
