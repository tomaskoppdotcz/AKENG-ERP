/** Dual-screen kiosk (obrazovky bez ERP loginu): `/kiosk/admin?machine=…` a `/kiosk/production?machine=…` — vstup v `main.tsx`. */
import React, { useCallback, useEffect, useMemo, useState } from "react";
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
import MaterialRequirementsPage from "./pages/MaterialRequirementsPage";
import MaterialPurchaseOrdersPage from "./pages/MaterialPurchaseOrdersPage";
import PlannerPage from "./pages/PlannerPage";
import ShopfloorKioskPage from "./pages/ShopfloorKioskPage";
import WorkReportsPage from "./pages/WorkReportsPage";
import MachinePlanningPage from "./pages/MachinePlanningPage";
import CustomerLibraryPage from "./pages/CustomerLibraryPage";
import WorkplaceLibraryPage from "./pages/WorkplaceLibraryPage";
import OperationLibraryPage from "./pages/OperationLibraryPage";
import PortfolioGroupLibraryPage from "./pages/PortfolioGroupLibraryPage";
import SkladCiselnikyPage from "./pages/SkladCiselnikyPage";
import MaterialLibraryPage from "./pages/MaterialLibraryPage";
import MaterialGroupLibraryPage from "./pages/MaterialGroupLibraryPage";
import ZamestnanciHubPage from "./pages/ZamestnanciHubPage";
import CapacityDashboardPage from "./pages/CapacityDashboardPage";
import WorkplaceShiftsPage from "./pages/WorkplaceShiftsPage";
import PortfolioGpnTpPage from "./pages/PortfolioGpnTpPage";
import StorageLocationPage from "./pages/StorageLocationPage";
import ErpAppShell from "./components/ErpAppShell.tsx";
import GlobalShellScanLookup from "./components/GlobalShellScanLookup.tsx";
import ErpPreviewDrawer, { type ErpPreviewDrawerState } from "./components/ErpPreviewDrawer";
import { UI } from "./styles/ui";
import { getPortfolioItem } from "./services/portfolioApi";
import { parseErpDeepLink } from "./utils/erpDeepLink";
import type { ScanLookupResponse } from "./services/scanLookupApi";
import { tabFromInput, type OpenWorkspaceInput, type WorkspaceTab } from "./workspace/workspaceTabTypes";
import { ERP_NAV_GROUPS } from "./navigation/erpNavConfig";
import { applyNavOrder } from "./navigation/applyNavOrder";
import { getNavSidebarOrder } from "./services/navSidebarOrderApi";
import NavSidebarOrderPage from "./pages/NavSidebarOrderPage";
import UsersLibraryPage from "./pages/UsersLibraryPage";
import {
  filterNavGroupsByRole,
  readStoredErpRole,
  writeStoredErpRole,
  type ErpRole,
} from "./auth/rbac";
import { getAuthToken } from "./auth/authToken";
import { setUiActorIdentifier } from "./auth/uiActor";
import { refreshCurrentUser, useCurrentUser } from "./auth/useCurrentUser";
import { changeMyPassword, logout as apiLogout } from "./services/authApi";

function ModulePlaceholderPage({ moduleName }: { moduleName: string }) {
  return (
    <div style={{ paddingTop: 18 }}>
      <div style={UI.sectionTitle}>{moduleName}</div>
      <div style={UI.sectionSubtitle}>Modul je ve vývoji</div>
    </div>
  );
}

function TopBarSessionBadge({
  user,
  onLogout,
}: {
  user: { username: string | null; displayName: string | null; loaded: boolean };
  onLogout: () => void;
}) {
  const label = (user.displayName || user.username || "").trim();
  const initials = label
    ? label
        .split(/\s+/)
        .slice(0, 2)
        .map((p) => p[0])
        .filter(Boolean)
        .join("")
        .toUpperCase()
    : "??";

  const [pwdOpen, setPwdOpen] = useState(false);
  const [pwdOld, setPwdOld] = useState("");
  const [pwdNew, setPwdNew] = useState("");
  const [pwdConfirm, setPwdConfirm] = useState("");
  const [pwdSaving, setPwdSaving] = useState(false);
  const [pwdError, setPwdError] = useState<string | null>(null);
  const [pwdSuccess, setPwdSuccess] = useState<string | null>(null);

  function openPwdDialog() {
    setPwdOpen(true);
    setPwdOld("");
    setPwdNew("");
    setPwdConfirm("");
    setPwdError(null);
    setPwdSuccess(null);
  }

  function closePwdDialog() {
    setPwdOpen(false);
    setPwdSaving(false);
  }

  async function handleChangePassword() {
    const oldValue = pwdOld;
    const newValue = pwdNew.trim();
    if (newValue.length < 4) {
      setPwdError("Nové heslo musí mít alespoň 4 znaky.");
      return;
    }
    if (newValue !== pwdConfirm.trim()) {
      setPwdError("Nové heslo a potvrzení se neshodují.");
      return;
    }
    setPwdError(null);
    setPwdSuccess(null);
    setPwdSaving(true);
    try {
      await changeMyPassword(oldValue, newValue);
      setPwdSuccess("Heslo bylo úspěšně změněno.");
      setPwdOld("");
      setPwdNew("");
      setPwdConfirm("");
    } catch (e: unknown) {
      setPwdError(e instanceof Error ? e.message : "Změna hesla selhala.");
    } finally {
      setPwdSaving(false);
    }
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      {label ? (
        <div
          title={label}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "3px 8px 3px 3px",
            borderRadius: 999,
            background: "#F1F5F9",
            border: "1px solid #E2E8F0",
            color: "#334155",
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.02em",
          }}
        >
          <span
            aria-hidden
            style={{
              width: 20,
              height: 20,
              borderRadius: "50%",
              background: "linear-gradient(135deg, #2563EB 0%, #7C3AED 100%)",
              color: "#FFFFFF",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 10,
              fontWeight: 900,
              letterSpacing: 0,
            }}
          >
            {initials}
          </span>
          <span
            style={{
              maxWidth: 180,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {label}
          </span>
        </div>
      ) : null}
      <button
        type="button"
        onClick={openPwdDialog}
        title="Změnit heslo"
        style={{
          padding: "4px 10px",
          fontSize: 11,
          fontWeight: 800,
          color: "#334155",
          background: "#FFFFFF",
          border: "1px solid #E2E8F0",
          borderRadius: 8,
          cursor: "pointer",
          letterSpacing: "0.02em",
        }}
      >
        Heslo
      </button>
      <button
        type="button"
        onClick={onLogout}
        title="Odhlásit se"
        style={{
          padding: "4px 10px",
          fontSize: 11,
          fontWeight: 800,
          color: "#334155",
          background: "#FFFFFF",
          border: "1px solid #E2E8F0",
          borderRadius: 8,
          cursor: "pointer",
          letterSpacing: "0.02em",
        }}
      >
        Odhlásit
      </button>

      {pwdOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          onClick={closePwdDialog}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15, 23, 42, 0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: 16,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%",
              maxWidth: 420,
              background: "#ffffff",
              borderRadius: 14,
              border: "1px solid #e2e8f0",
              padding: 18,
              boxShadow: "0 24px 60px -24px rgba(15, 23, 42, 0.35)",
              fontSize: 13,
              color: "#0F172A",
            }}
          >
            <div style={{ fontWeight: 900, fontSize: 16, color: "#0F172A" }}>Změna hesla</div>
            <div style={{ marginTop: 2, color: "#64748B", fontSize: 12 }}>
              {label ? `Přihlášen jako ${label}.` : ""} Nové heslo se aplikuje
              okamžitě; stávající sessions zůstanou platné.
            </div>

            <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
              <div>
                <div style={UI.inputs.label}>Stávající heslo</div>
                <input
                  type="password"
                  value={pwdOld}
                  onChange={(e) => setPwdOld(e.target.value)}
                  style={UI.inputs.base}
                  autoComplete="current-password"
                  autoFocus
                />
                <div style={{ fontSize: 11, color: "#94A3B8", marginTop: 4 }}>
                  Nechejte prázdné, pokud heslo ještě nemáte nastavené.
                </div>
              </div>
              <div>
                <div style={UI.inputs.label}>Nové heslo</div>
                <input
                  type="password"
                  value={pwdNew}
                  onChange={(e) => setPwdNew(e.target.value)}
                  style={UI.inputs.base}
                  autoComplete="new-password"
                />
              </div>
              <div>
                <div style={UI.inputs.label}>Potvrdit nové heslo</div>
                <input
                  type="password"
                  value={pwdConfirm}
                  onChange={(e) => setPwdConfirm(e.target.value)}
                  style={UI.inputs.base}
                  autoComplete="new-password"
                />
              </div>
            </div>

            {pwdError ? (
              <div
                style={{
                  marginTop: 10,
                  padding: "8px 10px",
                  borderRadius: 10,
                  background: "#FEF2F2",
                  border: "1px solid #FECACA",
                  color: "#B91C1C",
                  fontWeight: 700,
                  fontSize: 13,
                }}
              >
                {pwdError}
              </div>
            ) : null}

            {pwdSuccess ? (
              <div
                style={{
                  marginTop: 10,
                  padding: "8px 10px",
                  borderRadius: 10,
                  background: "#ECFDF5",
                  border: "1px solid #A7F3D0",
                  color: "#047857",
                  fontWeight: 700,
                  fontSize: 13,
                }}
              >
                {pwdSuccess}
              </div>
            ) : null}

            <div style={{ display: "flex", gap: 8, marginTop: 14, justifyContent: "flex-end" }}>
              <button
                type="button"
                style={UI.buttons.secondary}
                onClick={closePwdDialog}
                disabled={pwdSaving}
              >
                Zavřít
              </button>
              <button
                type="button"
                style={{ ...UI.buttons.primary, ...(pwdSaving ? { opacity: 0.7, cursor: "wait" } : {}) }}
                onClick={handleChangePassword}
                disabled={pwdSaving}
              >
                {pwdSaving ? "Ukládám…" : "Změnit heslo"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SystemSettingsPlaceholder({ title }: { title: string }) {
  return (
    <div style={{ paddingTop: 18 }}>
      <div style={UI.sectionTitle}>{title}</div>
      <div style={UI.sectionSubtitle}>Systémové nastavení — ve vývoji</div>
    </div>
  );
}

export default function App() {
  // Pokud máme uložený bearer token v localStorage, předpokládáme aktivní
  // session (validaci provede `refreshCurrentUser()` — pokud /users/me selže,
  // session se považuje za vadnou a uživatel se odhlásí).
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => Boolean(getAuthToken()));
  const [erpRole, setErpRole] = useState<ErpRole | null>(() => readStoredErpRole());
  const [activeModule, setActiveModule] = useState<string>("Nástěnka");

  const [ordersInitialCustomerOrderId, setOrdersInitialCustomerOrderId] = useState<number | null>(null);
  const [previewDrawer, setPreviewDrawer] = useState<ErpPreviewDrawerState>(null);
  const [portfolioInitialSearch, setPortfolioInitialSearch] = useState<string | null>(null);
  const [workspaceTabs, setWorkspaceTabs] = useState<WorkspaceTab[]>([]);
  const [activeWorkspaceTabId, setActiveWorkspaceTabId] = useState<string | null>(null);
  const [navSidebarOrder, setNavSidebarOrder] = useState<Record<string, string[]> | null>(null);

  const clearPortfolioInitialSearch = useCallback(() => setPortfolioInitialSearch(null), []);

  const loadNavSidebarOrder = useCallback(async () => {
    try {
      const o = await getNavSidebarOrder();
      setNavSidebarOrder(o);
    } catch {
      setNavSidebarOrder({});
    }
  }, []);

  useEffect(() => {
    if (!isAuthenticated) return;
    void loadNavSidebarOrder();
    void refreshCurrentUser();
  }, [isAuthenticated, loadNavSidebarOrder]);

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

  useEffect(() => {
    if (!isAuthenticated) return;
    try {
      const raw = sessionStorage.getItem("akeng_pending_module");
      if (!raw) return;
      sessionStorage.removeItem("akeng_pending_module");
      const o = JSON.parse(raw) as { moduleKey?: string; title?: string };
      if (o?.moduleKey) {
        let mk = o.moduleKey;
        if (mk === "Plán směny strojů") mk = "Plán směny pracovišť";
        openWorkspaceTab({
          kind: "module",
          moduleKey: mk,
          title: (o.title?.trim() || mk) as string,
        });
        setActiveModule(mk);
      }
    } catch {
      try {
        sessionStorage.removeItem("akeng_pending_module");
      } catch {
        /* ignore */
      }
    }
  }, [isAuthenticated, openWorkspaceTab]);

  useEffect(() => {
    if (!isAuthenticated) return;
    try {
      const raw = sessionStorage.getItem("akeng_pending_work_report_edit");
      if (!raw) return;
      sessionStorage.removeItem("akeng_pending_work_report_edit");
      const o = JSON.parse(raw) as { workReportId?: number };
      const wid = o?.workReportId;
      if (typeof wid === "number" && Number.isFinite(wid) && wid > 0) {
        openWorkspaceTab({
          kind: "module",
          moduleKey: "Výroba výkazy",
          title: "Výkazy práce",
        });
        openWorkspaceTab({ kind: "workReportEdit", workReportId: wid });
        setActiveModule("Výroba výkazy");
      }
    } catch {
      try {
        sessionStorage.removeItem("akeng_pending_work_report_edit");
      } catch {
        /* ignore */
      }
    }
  }, [isAuthenticated, openWorkspaceTab]);

  useEffect(() => {
    if (!isAuthenticated) return;
    try {
      const raw = sessionStorage.getItem("akeng_pending_work_report");
      if (!raw) return;
      sessionStorage.removeItem("akeng_pending_work_report");
      const o = JSON.parse(raw) as { workReportId?: number };
      const wid = o?.workReportId;
      if (typeof wid === "number" && Number.isFinite(wid) && wid > 0) {
        openWorkspaceTab({
          kind: "module",
          moduleKey: "Výroba výkazy",
          title: "Výkazy práce",
        });
        openWorkspaceTab({ kind: "workReport", workReportId: wid });
        setActiveModule("Výroba výkazy");
      }
    } catch {
      try {
        sessionStorage.removeItem("akeng_pending_work_report");
      } catch {
        /* ignore */
      }
    }
  }, [isAuthenticated, openWorkspaceTab]);

  useEffect(() => {
    if (!isAuthenticated) return;
    try {
      const flag = sessionStorage.getItem("akeng_pending_work_report_new");
      if (flag == null) return;
      sessionStorage.removeItem("akeng_pending_work_report_new");
      if (flag === "1" || flag === "true") {
        openWorkspaceTab({ kind: "module", moduleKey: "Výroba výkazy", title: "Výkazy práce" });
        openWorkspaceTab({ kind: "workReportNew" });
        setActiveModule("Výroba výkazy");
      }
    } catch {
      try {
        sessionStorage.removeItem("akeng_pending_work_report_new");
      } catch {
        /* ignore */
      }
    }
  }, [isAuthenticated, openWorkspaceTab]);

  const dashboardLinkProps = useMemo(
    () => ({
      onOpenProductionOrder: (productionOrderId: number, title?: string) => {
        openWorkspaceTab({
          kind: "productionOrder",
          productionOrderId,
          title: title ?? `VP #${productionOrderId}`,
        });
        setActiveModule("Výroba");
      },
      onOpenCustomerOrder: (customerOrderId: number, title?: string) => {
        openWorkspaceTab({
          kind: "orderCard",
          customerOrderId,
          title: title?.trim() || `Zakázka #${customerOrderId}`,
        });
        setActiveModule("Zakázky");
      },
      onOpenMaterialRequirements: () => {
        openWorkspaceTab({
          kind: "module",
          moduleKey: "Požadavky materiálu",
          title: "Požadavky materiálu",
        });
        setActiveModule("Požadavky materiálu");
      },
      onOpenMaterialPurchase: () => {
        openWorkspaceTab({
          kind: "module",
          moduleKey: "Nákup materiálu",
          title: "Nákup materiálu",
        });
        setActiveModule("Nákup materiálu");
      },
      onOpenPlanning: () => {
        openWorkspaceTab({ kind: "module", moduleKey: "Plánování", title: "Plánování" });
        setActiveModule("Plánování");
      },
    }),
    [openWorkspaceTab]
  );

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
      return;
    }
    if (tab.kind === "materialPurchaseOrder") {
      setActiveModule("Nákup materiálu");
      return;
    }
    if (tab.kind === "workReport" || tab.kind === "workReportEdit" || tab.kind === "workReportNew") {
      setActiveModule("Výroba výkazy");
    }
  }, [isAuthenticated, activeWorkspaceTabId, workspaceTabs]);

  useEffect(() => {
    if (!isAuthenticated) return;
    if (ordersInitialCustomerOrderId == null) return;
    const id = ordersInitialCustomerOrderId;
    openWorkspaceTab({ kind: "orderCard", customerOrderId: id });
    setOrdersInitialCustomerOrderId(null);
  }, [isAuthenticated, ordersInitialCustomerOrderId, openWorkspaceTab]);

  function resetDetailStack() {
    setOrdersInitialCustomerOrderId(null);
  }

  const openPortfolioByItemId = useCallback(
    (portfolioItemId: number) => {
      void getPortfolioItem(portfolioItemId).then((item) => {
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
          openWorkspaceTab({ kind: "module", moduleKey: "Portfolio", title: "Portfolio výrobků" });
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
      openWorkspaceTab({ kind: "module", moduleKey: "Výroba", title: "Výrobní příkazy" });
      openWorkspaceTab({ kind: "productionOrder", productionOrderId: link.productionOrderId });
      setActiveModule("Výroba");
      stripQuery();
      return;
    }
    if (link.view === "workReport") {
      openWorkspaceTab({ kind: "module", moduleKey: "Výroba výkazy", title: "Výkazy práce" });
      openWorkspaceTab({ kind: "workReport", workReportId: link.workReportId });
      setActiveModule("Výroba výkazy");
      stripQuery();
      return;
    }
    if (link.view === "portfolioSearch") {
      setPortfolioInitialSearch(link.gpn);
      openWorkspaceTab({ kind: "module", moduleKey: "Portfolio", title: "Portfolio výrobků" });
      setActiveModule("Portfolio");
      stripQuery();
      return;
    }
  }, [isAuthenticated, openWorkspaceTab]);

  const currentUser = useCurrentUser();

  const baseNavGroups = useMemo(
    () => filterNavGroupsByRole(erpRole, ERP_NAV_GROUPS),
    [erpRole]
  );

  const permissionFilteredNav = useMemo(() => {
    if (!currentUser.loaded || currentUser.hasFullAccess) return baseNavGroups;
    const canManageUsers = currentUser.permissions.has("manage_users");
    return baseNavGroups
      .map((g) => {
        if (g.id !== "settings") return g;
        const items = g.items.filter((it) => {
          if (it.moduleKey === "SYS uživatelé" || it.moduleKey === "SYS role") {
            return canManageUsers;
          }
          return true;
        });
        return { ...g, items };
      })
      .filter((g) => g.items.length > 0);
  }, [baseNavGroups, currentUser]);

  const sidebarNavGroups = useMemo(() => {
    if (navSidebarOrder === null) return permissionFilteredNav;
    return applyNavOrder(permissionFilteredNav, navSidebarOrder);
  }, [permissionFilteredNav, navSidebarOrder]);

  function handleLogin(role: ErpRole | null) {
    writeStoredErpRole(role);
    setErpRole(role);
    setIsAuthenticated(true);
    const home = tabFromInput({ kind: "module", moduleKey: "Nástěnka", title: "Nástěnka" });
    setWorkspaceTabs([home]);
    setActiveWorkspaceTabId(home.key);
    setActiveModule("Nástěnka");
  }

  const handleLogout = useCallback(async () => {
    try {
      await apiLogout();
    } catch {
      /* ignore — lokální stav stejně vyčistíme */
    }
    writeStoredErpRole(null);
    setUiActorIdentifier("");
    setErpRole(null);
    setIsAuthenticated(false);
    setWorkspaceTabs([]);
    setActiveWorkspaceTabId(null);
    setActiveModule("Nástěnka");
  }, []);

  function handleTopNavNavigate(moduleKey: string, tabTitle?: string) {
    setPreviewDrawer(null);
    setPortfolioInitialSearch(null);
    setOrdersInitialCustomerOrderId(null);
    const title = (tabTitle?.trim() || moduleKey).trim();
    openWorkspaceTab({ kind: "module", moduleKey, title });
    setActiveModule(moduleKey);
  }

  function openHomeModuleTab() {
    openWorkspaceTab({ kind: "module", moduleKey: "Nástěnka", title: "Nástěnka" });
  }

  if (!isAuthenticated) {
    return (
      <div style={{ minHeight: "100vh", fontFamily: "Arial, Helvetica, sans-serif" }}>
        <LoginPage onLogin={handleLogin} />
      </div>
    );
  }

  const activeWorkspaceTab =
    activeWorkspaceTabId === null ? undefined : workspaceTabs.find((t) => t.key === activeWorkspaceTabId);
  const topBarContextLine = activeWorkspaceTab?.title?.trim() || null;

  function renderModuleBody(moduleKey: string): React.ReactNode {
    if (moduleKey === "Nástěnka") {
      return <DashboardPage {...dashboardLinkProps} />;
    }
    if (moduleKey === "Zakázky" || moduleKey === "Obchod karty zakázek") {
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
            openWorkspaceTab({ kind: "module", moduleKey: "Portfolio", title: "Portfolio výrobků" });
          }}
          onOpenPortfolioItemId={openPortfolioByItemId}
          onOpenPortfolioInWorkspaceTab={(portfolioItemId) =>
            openWorkspaceTab({ kind: "portfolio", portfolioItemId, item: null })
          }
          onOpenProductionOrderDetail={(productionOrderId) => {
            openWorkspaceTab({ kind: "productionOrder", productionOrderId });
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
    if (moduleKey === "Portfolio" || moduleKey === "Technologie postupy") {
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
    if (moduleKey === "Technologie šablony TP") {
      return <PortfolioGpnTpPage />;
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
    if (moduleKey === "Zakázky nabídky") {
      return <ModulePlaceholderPage moduleName="Nabídky" />;
    }
    if (moduleKey === "Výroba" || moduleKey === "Zakázky výrobní příkazy") {
      const openVpDetailTab = (productionOrderId: number, titleHint?: string) =>
        openWorkspaceTab({ kind: "productionOrder", productionOrderId, title: titleHint });
      return (
        <ProductionOrdersPage
          onOpenDetail={(productionOrderId) => openVpDetailTab(productionOrderId)}
          onOpenDetailInWorkspaceTab={(productionOrderId, titleHint) =>
            openVpDetailTab(productionOrderId, titleHint)
          }
          onOpenPortfolioItemId={openPortfolioByItemId}
          onOpenCustomerOrderCard={(customerOrderId) => {
            openWorkspaceTab({ kind: "orderCard", customerOrderId });
            setActiveModule("Zakázky");
          }}
          onPreviewPortfolioById={(portfolioItemId) => setPreviewDrawer({ kind: "portfolio", portfolioItemId })}
        />
      );
    }
    if (moduleKey === "Výroba detail VP") {
      return (
        <ModulePlaceholderPage moduleName="Detail VP — otevřete ze seznamu výrobních příkazů nebo ze záložky" />
      );
    }
    if (moduleKey === "Výroba operace") {
      return <ModulePlaceholderPage moduleName="Operace ve výrobě" />;
    }
    if (moduleKey === "Výroba výkazy") {
      return (
        <WorkReportsPage
          onOpenProductionOrderInWorkspaceTab={(productionOrderId, titleHint) =>
            openWorkspaceTab({ kind: "productionOrder", productionOrderId, title: titleHint })
          }
          onOpenWorkReportDetail={(workReportId, titleHint) =>
            openWorkspaceTab({
              kind: "workReport",
              workReportId,
              title: titleHint?.trim() || undefined,
            })
          }
          onOpenNewWorkReport={() => openWorkspaceTab({ kind: "workReportNew" })}
        />
      );
    }
    if (moduleKey === "Výroba kooperace") {
      return <ModulePlaceholderPage moduleName="Kooperace" />;
    }
    if (moduleKey === "Výroba zmetky") {
      return <ModulePlaceholderPage moduleName="Zmetky" />;
    }
    if (moduleKey === "Výroba příjem") {
      return <ModulePlaceholderPage moduleName="Příjem z výroby" />;
    }
    if (moduleKey === "Plán fronty") {
      return <ShopfloorKioskPage />;
    }
    if (moduleKey === "Plán neplánované") {
      return <MachinePlanningPage />;
    }
    if (moduleKey === "Plán vytížení") {
      return <CapacityDashboardPage />;
    }
    if (moduleKey === "Plán rebuild") {
      return <ModulePlaceholderPage moduleName="Rebuild plánu" />;
    }
    if (moduleKey === "Technologie normy") {
      return <ModulePlaceholderPage moduleName="Normy" />;
    }
    if (moduleKey === "Technologie měření") {
      return <ModulePlaceholderPage moduleName="Měření" />;
    }
    if (moduleKey === "Sklad příjemky") {
      return <ModulePlaceholderPage moduleName="Příjemky" />;
    }
    if (moduleKey === "Sklad výdeje") {
      return <ModulePlaceholderPage moduleName="Výdeje" />;
    }
    if (moduleKey === "Sklad lokace") {
      return <StorageLocationPage />;
    }
    if (moduleKey === "Sklad inventura") {
      return <ModulePlaceholderPage moduleName="Inventura" />;
    }
    if (moduleKey === "Kvalita atesty") {
      return <ModulePlaceholderPage moduleName="Atesty" />;
    }
    if (moduleKey === "Požadavky materiálu") {
      return (
        <MaterialRequirementsPage
          onOpenProductionOrderInWorkspaceTab={(productionOrderId, titleHint) =>
            openWorkspaceTab({ kind: "productionOrder", productionOrderId, title: titleHint })
          }
          onOpenCustomerOrderInWorkspaceTab={(customerOrderId, titleHint) =>
            openWorkspaceTab({ kind: "orderCard", customerOrderId, title: titleHint })
          }
          onOpenMaterialPurchaseOrderInWorkspaceTab={(materialPurchaseOrderId, titleHint) =>
            openWorkspaceTab({ kind: "materialPurchaseOrder", materialPurchaseOrderId, title: titleHint })
          }
        />
      );
    }
    if (moduleKey === "Nákup materiálu") {
      return (
        <MaterialPurchaseOrdersPage
          onOpenPurchaseOrderInWorkspaceTab={(materialPurchaseOrderId, titleHint) =>
            openWorkspaceTab({ kind: "materialPurchaseOrder", materialPurchaseOrderId, title: titleHint })
          }
        />
      );
    }
    if (moduleKey === "Nákup dodavatelé") {
      return <CustomerLibraryPage />;
    }
    if (moduleKey === "Zákazníci") {
      return <CustomerLibraryPage />;
    }
    if (moduleKey === "Portfolio skupiny") {
      return <PortfolioGroupLibraryPage />;
    }
    if (moduleKey === "Kiosk") {
      return <ShopfloorKioskPage />;
    }
    if (moduleKey === "Pracoviště") {
      return <WorkplaceLibraryPage />;
    }
    if (moduleKey === "Stroje") {
      return <MachinePlanningPage />;
    }
    if (moduleKey === "Knihovna operací") {
      return <OperationLibraryPage />;
    }
    if (moduleKey === "Materiály") {
      return <MaterialLibraryPage />;
    }
    if (moduleKey === "Skupiny materiálů") {
      return <MaterialGroupLibraryPage />;
    }
    if (moduleKey === "Zaměstnanci") {
      return <ZamestnanciHubPage />;
    }
    if (moduleKey === "Sklad pohyby") {
      return <ModulePlaceholderPage moduleName="Pohyby materiálu" />;
    }
    if (moduleKey === "Pohyby výrobků") {
      return <ModulePlaceholderPage moduleName="Pohyby výrobků" />;
    }
    if (moduleKey === "Sklad číselníky") {
      return <SkladCiselnikyPage />;
    }
    if (moduleKey === "Kvalita kontrola") {
      return <ModulePlaceholderPage moduleName="Kontrola kvality" />;
    }
    if (moduleKey === "Kvalita neshody") {
      return <ModulePlaceholderPage moduleName="Neshody" />;
    }
    if (moduleKey === "Kvalita reklamace") {
      return <ModulePlaceholderPage moduleName="Reklamace" />;
    }
    if (moduleKey === "SYS konfigurace") {
      return <SystemSettingsPlaceholder title="Konfigurace systému" />;
    }
    if (moduleKey === "SYS uživatelé" || moduleKey === "SYS role") {
      return <UsersLibraryPage />;
    }
    if (moduleKey === "SYS číselné řady") {
      return <SystemSettingsPlaceholder title="Číselné řady" />;
    }
    if (moduleKey === "SYS tiskové sestavy") {
      return <SystemSettingsPlaceholder title="Tiskové sestavy" />;
    }
    if (moduleKey === "SYS texty") {
      return <SystemSettingsPlaceholder title="Texty" />;
    }
    if (moduleKey === "SYS barcode") {
      return <SystemSettingsPlaceholder title="Barcode" />;
    }
    if (moduleKey === "SYS import export") {
      return <SystemSettingsPlaceholder title="Import / export" />;
    }
    if (moduleKey === "SYS pořadí navigace") {
      return <NavSidebarOrderPage onOrderSaved={loadNavSidebarOrder} />;
    }
    if (moduleKey === "Plán směny pracovišť" || moduleKey === "Plán směny strojů") {
      return <WorkplaceShiftsPage />;
    }
    if (moduleKey === "Plánování") {
      return <PlannerPage {...dashboardLinkProps} />;
    }
    return <ModulePlaceholderPage moduleName={moduleKey} />;
  }

  return (
    <ErpAppShell
      activeModule={activeModule}
      contextLine={topBarContextLine}
      onNavigate={handleTopNavNavigate}
      navGroups={sidebarNavGroups}
      rightSlot={
        <>
          <GlobalShellScanLookup onResolve={applyScanLookupResult} />
          <TopBarSessionBadge user={currentUser} onLogout={handleLogout} />
        </>
      }
    >
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
        <DashboardPage {...dashboardLinkProps} />
      )}
      <ErpPreviewDrawer open={previewDrawer} onClose={() => setPreviewDrawer(null)} />
    </ErpAppShell>
  );
}
