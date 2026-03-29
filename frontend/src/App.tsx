/** Dual-screen kiosk (obrazovky bez ERP loginu): `/kiosk/admin?machine=…` a `/kiosk/production?machine=…` — vstup v `main.tsx`. */
import React, { useCallback, useEffect, useState } from "react";
import WorkspaceTabBar from "./components/WorkspaceTabBar.tsx";
import WorkspaceTabPanel from "./components/WorkspaceTabPanel.tsx";
import LoginPage from "./pages/LoginPage.tsx";
import DashboardPage from "./pages/DashboardPage.tsx";
import OrdersPage from "./pages/OrdersPage.tsx";
import DrawingsPage from "./pages/DrawingsPage.tsx";
import PortfolioPage from "./pages/PortfolioPage";
import MaterialStockPage from "./pages/MaterialStockPage";
import ProductStockPage from "./pages/ProductStockPage";
import ProductionOrdersPage from "./pages/ProductionOrdersPage";
import ProductionOrderDetailPage from "./pages/ProductionOrderDetailPage";
import SettingsPage from "./pages/SettingsPage";
import GlobalShellScanLookup from "./components/GlobalShellScanLookup.tsx";
import TopNav from "./components/TopNav.tsx";
import ErpPreviewDrawer, { type ErpPreviewDrawerState } from "./components/ErpPreviewDrawer";
import { UI } from "./styles/ui";
import { getPortfolioItem } from "./services/portfolioApi";
import { parseErpDeepLink } from "./utils/erpDeepLink";
import type { ScanLookupResponse } from "./services/scanLookupApi";
import { tabFromInput, type OpenWorkspaceInput, type WorkspaceTab } from "./workspace/workspaceTabTypes";

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
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [activeModule, setActiveModule] = useState<string>("Nástěnka");

  const [selectedProductionOrderId, setSelectedProductionOrderId] = useState<number | null>(null);
  const [ordersInitialCustomerOrderId, setOrdersInitialCustomerOrderId] = useState<number | null>(null);
  const [previewDrawer, setPreviewDrawer] = useState<ErpPreviewDrawerState>(null);
  const [portfolioInitialSearch, setPortfolioInitialSearch] = useState<string | null>(null);
  const [productionWideSplit, setProductionWideSplit] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(min-width: 1320px)").matches
  );
  const [workspaceTabs, setWorkspaceTabs] = useState<WorkspaceTab[]>([]);
  const [activeWorkspaceTabId, setActiveWorkspaceTabId] = useState<string | null>(null);

  const clearPortfolioInitialSearch = useCallback(() => setPortfolioInitialSearch(null), []);

  const openWorkspaceTab = useCallback((input: OpenWorkspaceInput) => {
    const built = tabFromInput(input);
    setWorkspaceTabs((prev) => {
      const existing = prev.find((t) => t.key === built.key);
      if (!existing) return [...prev, built];
      let merged: WorkspaceTab = built;
      if (built.kind === "portfolio" && existing.kind === "portfolio" && !built.item && existing.item) {
        merged = { ...built, item: existing.item };
      }
      if (built.kind === "materialStock" && existing.kind === "materialStock" && !built.snapshot && existing.snapshot) {
        merged = { ...built, snapshot: existing.snapshot };
      }
      if (built.kind === "productStock" && existing.kind === "productStock" && !built.snapshot && existing.snapshot) {
        merged = { ...built, snapshot: existing.snapshot };
      }
      const title = input.title?.trim() || existing.title;
      return prev.map((t) => (t.key === built.key ? ({ ...merged, title } as WorkspaceTab) : t));
    });
    setActiveWorkspaceTabId(built.key);
  }, []);

  const applyScanLookupResult = useCallback(
    (res: ScanLookupResponse) => {
      setPreviewDrawer(null);
      const tp = res.target_page;
      if (tp === "orders") {
        const coId = Number(res.target_params.customer_order_id);
        if (Number.isFinite(coId)) {
          openWorkspaceTab({ kind: "orderCard", customerOrderId: coId, title: res.label });
          setActiveModule("Zakázky");
        }
        return;
      }
      if (tp === "order_item") {
        const jobItemId = Number(res.target_params.job_item_id);
        if (Number.isFinite(jobItemId)) {
          openWorkspaceTab({ kind: "orderItem", jobItemId, source: "orders", title: res.label });
          setActiveModule("Zakázky");
        }
        return;
      }
      if (tp === "production_order" || tp === "production_order_operation") {
        const poId = Number(res.target_params.production_order_id);
        if (Number.isFinite(poId)) {
          openWorkspaceTab({ kind: "productionOrder", productionOrderId: poId, title: res.label });
          setActiveModule("Výroba");
        }
        return;
      }
      if (tp === "portfolio") {
        const pid = Number(res.target_params.portfolio_item_id);
        if (Number.isFinite(pid)) {
          openWorkspaceTab({ kind: "portfolio", portfolioItemId: pid, item: null, title: res.label });
          setActiveModule("Portfolio");
        }
        return;
      }
      if (tp === "material_stock") {
        const sid = Number(res.target_params.material_stock_item_id);
        if (Number.isFinite(sid)) {
          openWorkspaceTab({ kind: "materialStock", stockItemId: sid, title: res.label });
          setActiveModule("Sklad materiálu");
        }
        return;
      }
      if (tp === "product_stock") {
        const sid = Number(res.target_params.product_stock_item_id);
        if (Number.isFinite(sid)) {
          openWorkspaceTab({ kind: "productStock", stockItemId: sid, title: res.label });
          setActiveModule("Sklad výrobků");
        }
      }
    },
    [openWorkspaceTab]
  );

  const closeWorkspaceTab = useCallback((key: string) => {
    setWorkspaceTabs((prev) => {
      const idx = prev.findIndex((t) => t.key === key);
      let next = prev.filter((t) => t.key !== key);
      if (next.length === 0) {
        next = [tabFromInput({ kind: "module", moduleKey: "Nástěnka", title: "Nástěnka" })];
      }
      setActiveWorkspaceTabId((active) => {
        if (active !== key) return active;
        const pick = idx > 0 ? next[idx - 1]!.key : next[0]!.key;
        return pick;
      });
      return next;
    });
  }, []);

  const updateWorkspaceTabTitle = useCallback((key: string, title: string) => {
    const trimmed = title.trim();
    if (!trimmed) return;
    setWorkspaceTabs((prev) => prev.map((t) => (t.key === key ? { ...t, title: trimmed } : t)));
  }, []);

  const closeOtherWorkspaceTabs = useCallback((keepKey: string) => {
    setWorkspaceTabs((prev) => {
      const kept = prev.filter((t) => t.key === keepKey);
      const next =
        kept.length > 0
          ? kept
          : [tabFromInput({ kind: "module", moduleKey: "Nástěnka", title: "Nástěnka" })];
      setActiveWorkspaceTabId(kept.length > 0 ? keepKey : next[0]!.key);
      return next;
    });
  }, []);

  const closeAllWorkspaceTabs = useCallback(() => {
    const home = tabFromInput({ kind: "module", moduleKey: "Nástěnka", title: "Nástěnka" });
    setWorkspaceTabs([home]);
    setActiveWorkspaceTabId(home.key);
  }, []);

  useEffect(() => {
    if (!isAuthenticated) return;
    if (activeWorkspaceTabId && workspaceTabs.every((t) => t.key !== activeWorkspaceTabId)) {
      setActiveWorkspaceTabId(workspaceTabs[0]?.key ?? null);
    }
  }, [isAuthenticated, activeWorkspaceTabId, workspaceTabs]);

  useEffect(() => {
    if (!isAuthenticated) return;
    const tab = workspaceTabs.find((t) => t.key === activeWorkspaceTabId);
    if (!tab) return;
    if (tab.kind === "module") {
      setActiveModule(tab.moduleKey);
      return;
    }
    if (tab.kind === "orderCard" || tab.kind === "orderItem") {
      setActiveModule(tab.kind === "orderItem" && tab.source === "drawings" ? "Výkresy" : "Zakázky");
      return;
    }
    if (tab.kind === "productionOrder") {
      setActiveModule("Výroba");
      return;
    }
    if (tab.kind === "portfolio") {
      setActiveModule("Portfolio");
      return;
    }
    if (tab.kind === "materialStock") {
      setActiveModule("Sklad materiálu");
      return;
    }
    if (tab.kind === "productStock") {
      setActiveModule("Sklad výrobků");
    }
  }, [isAuthenticated, activeWorkspaceTabId, workspaceTabs]);

  useEffect(() => {
    if (!isAuthenticated) return;
    if (ordersInitialCustomerOrderId == null) return;
    const id = ordersInitialCustomerOrderId;
    openWorkspaceTab({ kind: "orderCard", customerOrderId: id });
    setOrdersInitialCustomerOrderId(null);
  }, [isAuthenticated, ordersInitialCustomerOrderId, openWorkspaceTab]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(min-width: 1320px)");
    const apply = () => setProductionWideSplit(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  function resetDetailStack() {
    setSelectedProductionOrderId(null);
    setOrdersInitialCustomerOrderId(null);
  }

  const openPortfolioByItemId = useCallback(
    (portfolioItemId: number) => {
      void getPortfolioItem(portfolioItemId).then((item) => {
        setSelectedProductionOrderId(null);
        openWorkspaceTab({
          kind: "portfolio",
          portfolioItemId: item.id,
          item,
          title: item.gpn ? `Portfolio ${item.gpn}` : undefined,
        });
        setActiveModule("Portfolio");
      });
    },
    [openWorkspaceTab]
  );

  useEffect(() => {
    if (!isAuthenticated) return;
    const link = parseErpDeepLink(window.location.search);
    if (!link) return;
    const stripQuery = () => window.history.replaceState({}, "", window.location.pathname);
    if (link.view === "portfolio") {
      void getPortfolioItem(link.portfolioItemId)
        .then((item) => {
          resetDetailStack();
          openWorkspaceTab({ kind: "module", moduleKey: "Portfolio", title: "Portfolio" });
          openWorkspaceTab({
            kind: "portfolio",
            portfolioItemId: item.id,
            item,
            title: item.gpn ? `Portfolio ${item.gpn}` : undefined,
          });
          setActiveModule("Portfolio");
          stripQuery();
        })
        .catch(() => stripQuery());
      return;
    }
    resetDetailStack();
    if (link.view === "orderCard") {
      setOrdersInitialCustomerOrderId(link.customerOrderId);
      openWorkspaceTab({ kind: "module", moduleKey: "Zakázky", title: "Zakázky" });
      setActiveModule("Zakázky");
      stripQuery();
      return;
    }
    if (link.view === "orderItem") {
      const src = link.source === "drawings" ? "drawings" : "orders";
      const mod = src === "drawings" ? "Výkresy" : "Zakázky";
      openWorkspaceTab({ kind: "module", moduleKey: mod, title: mod });
      openWorkspaceTab({ kind: "orderItem", jobItemId: link.jobItemId, source: src });
      setActiveModule(mod);
      stripQuery();
      return;
    }
    if (link.view === "productionOrder") {
      openWorkspaceTab({ kind: "module", moduleKey: "Výroba", title: "Výroba" });
      openWorkspaceTab({ kind: "productionOrder", productionOrderId: link.productionOrderId });
      setActiveModule("Výroba");
      stripQuery();
      return;
    }
    if (link.view === "portfolioSearch") {
      setPortfolioInitialSearch(link.gpn);
      openWorkspaceTab({ kind: "module", moduleKey: "Portfolio", title: "Portfolio" });
      setActiveModule("Portfolio");
      stripQuery();
      return;
    }
  }, [isAuthenticated, openWorkspaceTab]);

  function handleLogin() {
    setIsAuthenticated(true);
    const home = tabFromInput({ kind: "module", moduleKey: "Nástěnka", title: "Nástěnka" });
    setWorkspaceTabs([home]);
    setActiveWorkspaceTabId(home.key);
    setActiveModule("Nástěnka");
  }

  function handleTopNavNavigate(module: string) {
    setPreviewDrawer(null);
    setPortfolioInitialSearch(null);
    setSelectedProductionOrderId(null);
    setOrdersInitialCustomerOrderId(null);
    openWorkspaceTab({ kind: "module", moduleKey: module, title: module });
    setActiveModule(module);
  }

  function openHomeModuleTab() {
    openWorkspaceTab({ kind: "module", moduleKey: "Nástěnka", title: "Nástěnka" });
  }

  if (!isAuthenticated) {
    return (
      <div style={{ minHeight: "100vh", background: UI.appBackground, fontFamily: "Arial, sans-serif" }}>
        <LoginPage onLogin={handleLogin} />
      </div>
    );
  }

  const activeWorkspaceTab =
    activeWorkspaceTabId === null ? undefined : workspaceTabs.find((t) => t.key === activeWorkspaceTabId);

  function renderModuleBody(moduleKey: string): React.ReactNode {
    if (moduleKey === "Nástěnka") {
      return <DashboardPage />;
    }
    if (moduleKey === "Zakázky") {
      return (
        <OrdersPage
          onBackToDashboard={openHomeModuleTab}
          onOpenOrderInWorkspaceTab={(customerOrderId, titleHint) =>
            openWorkspaceTab({ kind: "orderCard", customerOrderId, title: titleHint })
          }
        />
      );
    }
    if (moduleKey === "Výkresy") {
      return (
        <DrawingsPage
          onBackToDashboard={openHomeModuleTab}
          onOpenItemInWorkspaceTab={(jobItemId, source) => openWorkspaceTab({ kind: "orderItem", jobItemId, source })}
          onOpenPortfolioSearch={(gpn) => {
            resetDetailStack();
            setPortfolioInitialSearch(gpn);
            openWorkspaceTab({ kind: "module", moduleKey: "Portfolio", title: "Portfolio" });
          }}
          onOpenPortfolioItemId={openPortfolioByItemId}
          onOpenPortfolioInWorkspaceTab={(portfolioItemId) =>
            openWorkspaceTab({ kind: "portfolio", portfolioItemId, item: null })
          }
          onOpenProductionOrderDetail={(productionOrderId) => {
            setSelectedProductionOrderId(productionOrderId);
            openWorkspaceTab({ kind: "module", moduleKey: "Výroba", title: "Výroba" });
          }}
          onOpenProductionOrderInWorkspaceTab={(productionOrderId, vpCode) =>
            openWorkspaceTab({ kind: "productionOrder", productionOrderId, title: vpCode })
          }
          onOpenCustomerOrderCard={(customerOrderId) => {
            resetDetailStack();
            openWorkspaceTab({ kind: "orderCard", customerOrderId });
            setActiveModule("Zakázky");
          }}
          onOpenCustomerOrderInWorkspaceTab={(customerOrderId, zakazkaLabel) =>
            openWorkspaceTab({ kind: "orderCard", customerOrderId, title: zakazkaLabel })
          }
          onPreviewPortfolioById={(portfolioItemId) => setPreviewDrawer({ kind: "portfolio", portfolioItemId })}
          onPreviewProductionOrderById={(productionOrderId) =>
            setPreviewDrawer({ kind: "productionOrder", productionOrderId })
          }
        />
      );
    }
    if (moduleKey === "Portfolio") {
      return (
        <PortfolioPage
          initialSearchQuery={portfolioInitialSearch}
          onConsumedInitialSearch={clearPortfolioInitialSearch}
          onOpenItemInWorkspaceTab={(item) =>
            openWorkspaceTab({
              kind: "portfolio",
              portfolioItemId: item.id,
              item,
              title: item.gpn ? `Portfolio ${item.gpn}` : undefined,
            })
          }
        />
      );
    }
    if (moduleKey === "Sklad výrobků") {
      return (
        <ProductStockPage
          onOpenStockInWorkspaceTab={(item) =>
            openWorkspaceTab({
              kind: "productStock",
              stockItemId: item.id,
              snapshot: { ...item },
              title: item.portfolio_gpn ? `${item.portfolio_gpn} · sklad` : undefined,
            })
          }
        />
      );
    }
    if (moduleKey === "Sklad materiálu") {
      return (
        <MaterialStockPage
          onOpenStockInWorkspaceTab={(item) =>
            openWorkspaceTab({
              kind: "materialStock",
              stockItemId: item.id,
              snapshot: { ...item },
              title: item.material_name || item.material_code || undefined,
            })
          }
        />
      );
    }
    if (moduleKey === "Výroba") {
      if (
        productionWideSplit &&
        selectedProductionOrderId !== null
      ) {
        return (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 1fr) minmax(320px, 40%)",
              gap: 16,
              alignItems: "start",
            }}
          >
            <div style={{ minWidth: 0 }}>
              <ProductionOrdersPage
                onOpenDetail={(productionOrderId) => {
                  setSelectedProductionOrderId(productionOrderId);
                }}
                onOpenDetailInWorkspaceTab={(productionOrderId, titleHint) =>
                  openWorkspaceTab({ kind: "productionOrder", productionOrderId, title: titleHint })
                }
                onOpenPortfolioItemId={openPortfolioByItemId}
                onOpenCustomerOrderCard={(customerOrderId) => {
                  openWorkspaceTab({ kind: "orderCard", customerOrderId });
                  setActiveModule("Zakázky");
                }}
                onPreviewPortfolioById={(portfolioItemId) => setPreviewDrawer({ kind: "portfolio", portfolioItemId })}
                onPreviewProductionOrderById={(productionOrderId) =>
                  setPreviewDrawer({ kind: "productionOrder", productionOrderId })
                }
              />
            </div>
            <div
              style={{
                position: "sticky",
                top: 12,
                alignSelf: "start",
                maxHeight: "calc(100vh - 96px)",
                overflowY: "auto",
                minWidth: 0,
              }}
            >
              <ProductionOrderDetailPage
                productionOrderId={selectedProductionOrderId}
                onBack={() => {
                  setSelectedProductionOrderId(null);
                }}
                onOpenPortfolioItemId={openPortfolioByItemId}
                onOpenCustomerOrderCard={(customerOrderId) => {
                  setSelectedProductionOrderId(null);
                  openWorkspaceTab({ kind: "orderCard", customerOrderId });
                  setActiveModule("Zakázky");
                }}
                onPreviewPortfolioById={(portfolioItemId) => setPreviewDrawer({ kind: "portfolio", portfolioItemId })}
              />
            </div>
          </div>
        );
      }
      return (
        <ProductionOrdersPage
          onOpenDetail={(productionOrderId) => {
            setSelectedProductionOrderId(productionOrderId);
          }}
          onOpenDetailInWorkspaceTab={(productionOrderId, titleHint) =>
            openWorkspaceTab({ kind: "productionOrder", productionOrderId, title: titleHint })
          }
          onOpenPortfolioItemId={openPortfolioByItemId}
          onOpenCustomerOrderCard={(customerOrderId) => {
            openWorkspaceTab({ kind: "orderCard", customerOrderId });
            setActiveModule("Zakázky");
          }}
          onPreviewPortfolioById={(portfolioItemId) => setPreviewDrawer({ kind: "portfolio", portfolioItemId })}
          onPreviewProductionOrderById={(productionOrderId) =>
            setPreviewDrawer({ kind: "productionOrder", productionOrderId })
          }
        />
      );
    }
    if (moduleKey === "Nastavení") {
      return <SettingsPage onBackToDashboard={openHomeModuleTab} />;
    }
    if (moduleKey === "Plánování" || moduleKey === "Kvalita") {
      return <ModulePlaceholderPage moduleName={moduleKey} />;
    }
    return <ModulePlaceholderPage moduleName={moduleKey} />;
  }

  return (
    <div style={{ minHeight: "100vh", background: UI.appBackground, fontFamily: "Arial, sans-serif" }}>
      <TopNav
        activeModule={activeModule}
        onNavigate={handleTopNavNavigate}
        navItems={NAV_ITEMS as unknown as string[]}
        rightSlot={<GlobalShellScanLookup onResolve={applyScanLookupResult} />}
      />
      <div style={UI.mainContainer}>
        <WorkspaceTabBar
          tabs={workspaceTabs.map((t) => ({ key: t.key, title: t.title }))}
          activeKey={activeWorkspaceTabId}
          onSelect={setActiveWorkspaceTabId}
          onClose={closeWorkspaceTab}
          onCloseOthers={closeOtherWorkspaceTabs}
          onCloseAll={closeAllWorkspaceTabs}
        />
        {activeWorkspaceTab ? (
          <WorkspaceTabPanel
            tab={activeWorkspaceTab}
            onCloseThisTab={() => closeWorkspaceTab(activeWorkspaceTab.key)}
            onUpdateTabTitle={updateWorkspaceTabTitle}
            openWorkspaceTab={openWorkspaceTab}
            setPreviewDrawer={setPreviewDrawer}
            renderModule={renderModuleBody}
          />
        ) : (
          <DashboardPage />
        )}
      </div>
      <ErpPreviewDrawer open={previewDrawer} onClose={() => setPreviewDrawer(null)} />
    </div>
  );
}
