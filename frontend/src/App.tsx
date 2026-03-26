import React, { useState } from "react";
import LoginPage from "./pages/LoginPage.tsx";
import DashboardPage from "./pages/DashboardPage.tsx";
import OrdersPage from "./pages/OrdersPage.tsx";
import OrderItemDetailPage from "./pages/OrderItemDetailPage.tsx";
import DrawingsPage from "./pages/DrawingsPage.tsx";
import PortfolioPage from "./pages/PortfolioPage";
import PortfolioItemDetailPage from "./pages/PortfolioItemDetailPage";
import MaterialStockPage from "./pages/MaterialStockPage";
import MaterialStockDetailPage from "./pages/MaterialStockDetailPage";
import ProductStockPage from "./pages/ProductStockPage";
import ProductStockDetailPage from "./pages/ProductStockDetailPage";
import ProductionOrdersPage from "./pages/ProductionOrdersPage";
import ProductionOrderDetailPage from "./pages/ProductionOrderDetailPage";
import ScanLookupPage from "./pages/ScanLookupPage";
import SettingsPage from "./pages/SettingsPage";
import TopNav from "./components/TopNav.tsx";
import { UI } from "./styles/ui";
import type { PortfolioItem } from "./services/portfolioApi";
import type { MaterialStockItem } from "./services/materialStockApi";
import type { ProductStockItem } from "./services/productStockApi";
import type { ScanLookupResponse } from "./services/scanLookupApi";

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
  "Scan lookup",
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

  const [selectedItem, setSelectedItem] = useState<{
    id: number;
    source: "orders" | "drawings";
  } | null>(null);
  const [selectedPortfolioItem, setSelectedPortfolioItem] = useState<PortfolioItem | null>(null);
  const [selectedProductStockItem, setSelectedProductStockItem] = useState<ProductStockItem | null>(null);
  const [selectedMaterialStockItem, setSelectedMaterialStockItem] = useState<(MaterialStockItem & { material_dimension?: string | null }) | null>(null);
  const [selectedProductionOrderId, setSelectedProductionOrderId] = useState<number | null>(null);
  const [ordersInitialCustomerOrderId, setOrdersInitialCustomerOrderId] = useState<number | null>(null);
  /** Po otevření portfolia z detailu zakázky/výkresů — zpět vrátí na stejnou položku. */
  const [portfolioReturnFromOrderItem, setPortfolioReturnFromOrderItem] = useState<{
    id: number;
    source: "orders" | "drawings";
  } | null>(null);

  function handleLogin() {
    setIsAuthenticated(true);
    setActiveModule("Nástěnka");
  }

  /** Horní lišta: ukončí případný detail a přepne modul. */
  function handleTopNavNavigate(module: string) {
    setSelectedItem(null);
    setSelectedPortfolioItem(null);
    setSelectedProductStockItem(null);
    setSelectedMaterialStockItem(null);
    setSelectedProductionOrderId(null);
    setOrdersInitialCustomerOrderId(null);
    setPortfolioReturnFromOrderItem(null);
    setActiveModule(module);
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
      <TopNav activeModule={activeModule} onNavigate={handleTopNavNavigate} navItems={NAV_ITEMS as unknown as string[]} />
      <div style={UI.mainContainer}>
        {selectedItem ? (
          <OrderItemDetailPage
            jobItemId={selectedItem.id}
            source={selectedItem.source}
            onBack={() => {
              setActiveModule(selectedItem.source === "orders" ? "Zakázky" : "Výkresy");
              setSelectedItem(null);
            }}
            onOpenPortfolioItem={(portfolioItem) => {
              setPortfolioReturnFromOrderItem({ id: selectedItem.id, source: selectedItem.source });
              setSelectedPortfolioItem(portfolioItem);
              setSelectedItem(null);
              setActiveModule("Portfolio");
            }}
          />
        ) : selectedPortfolioItem ? (
          <PortfolioItemDetailPage
            item={selectedPortfolioItem}
            backLabel={portfolioReturnFromOrderItem ? "Zpět na položku" : undefined}
            onBack={() => {
              if (portfolioReturnFromOrderItem) {
                const ctx = portfolioReturnFromOrderItem;
                setSelectedItem({ id: ctx.id, source: ctx.source });
                setSelectedPortfolioItem(null);
                setPortfolioReturnFromOrderItem(null);
                setActiveModule(ctx.source === "orders" ? "Zakázky" : "Výkresy");
              } else {
                setActiveModule("Portfolio");
                setSelectedPortfolioItem(null);
              }
            }}
          />
        ) : selectedProductStockItem ? (
          <ProductStockDetailPage
            item={selectedProductStockItem}
            onBack={() => {
              setSelectedProductStockItem(null);
              setActiveModule("Sklad výrobků");
            }}
          />
        ) : selectedMaterialStockItem ? (
          <MaterialStockDetailPage
            item={selectedMaterialStockItem}
            onBack={() => {
              setSelectedMaterialStockItem(null);
              setActiveModule("Sklad materiálu");
            }}
          />
        ) : selectedProductionOrderId !== null ? (
          <ProductionOrderDetailPage
            productionOrderId={selectedProductionOrderId}
            onBack={() => {
              setSelectedProductionOrderId(null);
              setActiveModule("Výroba");
            }}
          />
        ) : activeModule === "Nástěnka" ? (
          <DashboardPage />
        ) : activeModule === "Zakázky" ? (
          <OrdersPage
            initialCustomerOrderId={ordersInitialCustomerOrderId}
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
        ) : activeModule === "Sklad výrobků" ? (
          <ProductStockPage
            onOpenDetail={(item) => {
              setSelectedProductStockItem(item);
            }}
          />
        ) : activeModule === "Sklad materiálu" ? (
          <MaterialStockPage
            onOpenDetail={(item) => {
              setSelectedMaterialStockItem(item);
            }}
          />
        ) : activeModule === "Výroba" ? (
          <ProductionOrdersPage
            onOpenDetail={(productionOrderId) => {
              setSelectedProductionOrderId(productionOrderId);
            }}
          />
        ) : activeModule === "Scan lookup" ? (
          <ScanLookupPage
            onNavigateToTarget={(res: ScanLookupResponse) => {
              setSelectedItem(null);
              setSelectedPortfolioItem(null);
              setSelectedProductStockItem(null);
              setSelectedMaterialStockItem(null);
              setSelectedProductionOrderId(null);
              setOrdersInitialCustomerOrderId(null);
              if (res.target_page === "orders") {
                const coId = Number((res.target_params as any)?.customer_order_id);
                setOrdersInitialCustomerOrderId(Number.isFinite(coId) ? coId : null);
                setActiveModule("Zakázky");
                return;
              }
              if (res.target_page === "order_item") {
                const jobItemId = Number((res.target_params as any)?.job_item_id);
                if (Number.isFinite(jobItemId)) {
                  setSelectedItem({ id: jobItemId, source: "orders" });
                  setActiveModule("Zakázky");
                }
                return;
              }
              if (res.target_page === "production_order" || res.target_page === "production_order_operation") {
                const poId = Number((res.target_params as any)?.production_order_id);
                if (Number.isFinite(poId)) {
                  setSelectedProductionOrderId(poId);
                  setActiveModule("Výroba");
                }
                return;
              }
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
