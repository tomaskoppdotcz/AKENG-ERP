import React, { useState } from "react";
import LoginPage from "./pages/LoginPage.tsx";
import DashboardPage from "./pages/DashboardPage.tsx";
import OrdersPage from "./pages/OrdersPage.tsx";
import OrderItemDetailPage from "./pages/OrderItemDetailPage.tsx";
import DrawingsPage from "./pages/DrawingsPage.tsx";
import PortfolioPage from "./pages/PortfolioPage";
import PortfolioItemDetailPage from "./pages/PortfolioItemDetailPage";
import SettingsPage from "./pages/SettingsPage";
import TopNav from "./components/TopNav.tsx";
import { UI } from "./styles/ui";
import type { PortfolioItem } from "./services/portfolioApi";

const NAV_ITEMS = [
  "Nástěnka",
  "Zakázky",
  "Výkresy",
  "Portfolio",
  "Sklad výrobků",
  "Sklad materiálu",
  "Výroba",
  "Plánování",
  "Kvalita",
  "Nastavení",
] as const;

function ModulePlaceholderPage({ moduleName }: { moduleName: string }) {
  return (
    <div style={{ paddingTop: 18 }}>
      <div style={UI.sectionTitle}>{moduleName}</div>
      <div style={UI.sectionSubtitle}>Modul je ve vývoji</div>
    </div>
  );
}

export default function App() {
  // UI skeleton state (no auth/backend yet)
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [activeModule, setActiveModule] = useState<string>("Nástěnka");

  const [orderCardReturnId, setOrderCardReturnId] = useState<number | null>(null);
  const [selectedItem, setSelectedItem] = useState<{
    id: number;
    source: "orders" | "drawings";
  } | null>(null);
  const [selectedPortfolioItem, setSelectedPortfolioItem] = useState<PortfolioItem | null>(null);

  function handleLogin() {
    setIsAuthenticated(true);
    setActiveModule("Nástěnka");
  }

  if (!isAuthenticated) {
    return (
      <div style={{ minHeight: "100vh", background: UI.appBackground, fontFamily: "Arial, sans-serif" }}>
        <LoginPage onLogin={handleLogin} />
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: UI.appBackground, fontFamily: "Arial, sans-serif" }}>
      <TopNav activeModule={activeModule} onNavigate={setActiveModule} navItems={NAV_ITEMS as unknown as string[]} />
      <div style={UI.mainContainer}>
        {selectedItem ? (
          <OrderItemDetailPage
            jobItemId={selectedItem.id}
            source={selectedItem.source}
            onBack={() => {
              setActiveModule(selectedItem.source === "orders" ? "Zakázky" : "Výkresy");
              setSelectedItem(null);
            }}
          />
        ) : selectedPortfolioItem ? (
          <PortfolioItemDetailPage
            item={selectedPortfolioItem}
            onBack={() => {
              setActiveModule("Portfolio");
              setSelectedPortfolioItem(null);
            }}
          />
        ) : activeModule === "Nástěnka" ? (
          <DashboardPage />
        ) : activeModule === "Zakázky" ? (
          <OrdersPage
            initialCustomerOrderId={orderCardReturnId}
            onBackToDashboard={() => setActiveModule("Nástěnka")}
              onOpenItemDetail={(id, source) => {
                setSelectedItem({ id, source });
            }}
          />
        ) : activeModule === "Výkresy" ? (
          <DrawingsPage
            onBackToDashboard={() => setActiveModule("Nástěnka")}
            onOpenItemDetail={(id, source) => {
              setSelectedItem({ id, source });
            }}
          />
        ) : activeModule === "Portfolio" ? (
          <PortfolioPage
            onOpenItemDetail={(item) => {
              setSelectedPortfolioItem(item);
            }}
          />
        ) : activeModule === "Nastavení" ? (
          <SettingsPage onBackToDashboard={() => setActiveModule("Nástěnka")} />
        ) : (
          <ModulePlaceholderPage moduleName={activeModule} />
        )}
      </div>
    </div>
  );
}
