import React, { useState } from "react";
import LoginPage from "./pages/LoginPage.tsx";
import DashboardPage from "./pages/DashboardPage.tsx";
import OrdersPage from "./pages/OrdersPage.tsx";
import OrderItemDetailPage from "./pages/OrderItemDetailPage.tsx";
import TopNav from "./components/TopNav.tsx";
import { UI } from "./styles/ui";

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
  const [openedItemDetail, setOpenedItemDetail] = useState<{
    customerOrderId: number;
    jobItemId: number;
  } | null>(null);

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
        {activeModule === "Nástěnka" ? (
          <DashboardPage />
        ) : activeModule === "Zakázky" ? (
          openedItemDetail ? (
            <OrderItemDetailPage
              customerOrderId={openedItemDetail.customerOrderId}
              jobItemId={openedItemDetail.jobItemId}
              onBack={() => setOpenedItemDetail(null)}
            />
          ) : (
            <OrdersPage
              initialCustomerOrderId={orderCardReturnId}
              onBackToDashboard={() => setActiveModule("Nástěnka")}
              onOpenItemDetail={(customerOrderId, item) => {
                setOrderCardReturnId(customerOrderId);
                setOpenedItemDetail({
                  customerOrderId,
                  jobItemId: item.job_item_id,
                });
              }}
            />
          )
        ) : (
          <ModulePlaceholderPage moduleName={activeModule} />
        )}
      </div>
    </div>
  );
}
