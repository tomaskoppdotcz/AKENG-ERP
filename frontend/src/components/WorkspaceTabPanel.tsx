import React, { useCallback, useEffect, useState } from "react";
import { UI } from "../styles/ui";
import MaterialStockDetailPage from "../pages/MaterialStockDetailPage";
import OrderCardPage from "../pages/OrderCardPage";
import OrderItemDetailPage from "../pages/OrderItemDetailPage";
import ProductStockDetailPage from "../pages/ProductStockDetailPage";
import ProductionOrderDetailPage from "../pages/ProductionOrderDetailPage";
import PortfolioItemDetailPage from "../pages/PortfolioItemDetailPage";
import MaterialPurchaseOrderDetailPage from "../pages/MaterialPurchaseOrderDetailPage";
import { getMaterialLibraryItems } from "../services/materialLibraryApi";
import { getMaterialStockItems } from "../services/materialStockApi";
import { getPortfolioItem, type PortfolioItem } from "../services/portfolioApi";
import { getProductStockItems, type ProductStockItem } from "../services/productStockApi";
import type { MaterialStockDetailSnapshot, OpenWorkspaceInput, WorkspaceTab } from "../workspace/workspaceTabTypes";
import type { ErpPreviewDrawerState } from "./ErpPreviewDrawer";

type Props = {
  tab: WorkspaceTab;
  onCloseThisTab: () => void;
  /** Aktualizuje titulek záložky podle klíče (bez změny dedupe logiky). */
  onUpdateTabTitle: (key: string, title: string) => void;
  openWorkspaceTab: (input: OpenWorkspaceInput) => void;
  setPreviewDrawer: (s: ErpPreviewDrawerState) => void;
  /** Hlavní modulové stránky (přehledy) podle klíče z horní lišty. */
  renderModule: (moduleKey: string) => React.ReactNode;
};

function PortfolioTabBody({
  portfolioItemId,
  initialItem,
  onBack,
  onUpdateTabTitle,
}: {
  portfolioItemId: number;
  initialItem: PortfolioItem | null;
  onBack: () => void;
  onUpdateTabTitle: (title: string) => void;
}) {
  const [item, setItem] = useState<PortfolioItem | null>(initialItem);
  const [loading, setLoading] = useState(!initialItem);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initialItem?.id === portfolioItemId) {
      setItem(initialItem);
      setLoading(false);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void getPortfolioItem(portfolioItemId)
      .then((row) => {
        if (!cancelled) {
          setItem(row);
          setLoading(false);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Nepodařilo se načíst portfolio.");
          setItem(null);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [portfolioItemId, initialItem]);

  useEffect(() => {
    if (!item) return;
    const g = (item.gpn ?? "").trim();
    onUpdateTabTitle(g ? `Portfolio ${g}` : `Portfolio #${item.id}`);
  }, [item, onUpdateTabTitle]);

  if (loading) {
    return (
      <div style={{ paddingTop: 10 }}>
        <div style={{ ...UI.card, padding: 24, borderRadius: 14 }}>
          <div style={UI.sectionSubtitle}>Načítám portfolio…</div>
        </div>
      </div>
    );
  }

  if (error || !item) {
    return (
      <div style={{ paddingTop: 10 }}>
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
          <button type="button" style={UI.buttons.secondary} onClick={onBack}>
            Zavřít záložku
          </button>
        </div>
        <div
          style={{
            ...UI.card,
            padding: 24,
            borderRadius: 14,
            border: "1px solid #fecaca",
            background: "#fef2f2",
            color: "#991b1b",
            fontWeight: 700,
          }}
        >
          {error ?? "Položku portfolio se nepodařilo zobrazit."}
        </div>
      </div>
    );
  }

  return <PortfolioItemDetailPage item={item} onBack={onBack} />;
}

function MaterialStockTabBody({
  stockItemId,
  initialSnapshot,
  onBack,
  onUpdateTabTitle,
}: {
  stockItemId: number;
  initialSnapshot: MaterialStockDetailSnapshot | null;
  onBack: () => void;
  onUpdateTabTitle: (title: string) => void;
}) {
  const [item, setItem] = useState<MaterialStockDetailSnapshot | null>(initialSnapshot);
  const [loading, setLoading] = useState(!initialSnapshot);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initialSnapshot?.id === stockItemId) {
      setItem(initialSnapshot);
      setLoading(false);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void Promise.all([getMaterialStockItems(), getMaterialLibraryItems()])
      .then(([stockItems, libItems]) => {
        if (cancelled) return;
        const row = stockItems.find((s) => s.id === stockItemId);
        if (!row) {
          setError("Položka skladu materiálu neexistuje.");
          setItem(null);
          setLoading(false);
          return;
        }
        const byMat = new Map(libItems.map((l) => [l.id, l]));
        const dim = byMat.get(row.material_library_item_id)?.dimension ?? null;
        setItem({ ...row, material_dimension: dim });
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Nepodařilo se načíst sklad.");
          setItem(null);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [stockItemId, initialSnapshot]);

  useEffect(() => {
    if (!item) return;
    const code = (item.material_code ?? "").trim();
    const name = (item.material_name ?? "").trim();
    const label = code || name || `#${item.id}`;
    onUpdateTabTitle(`Sklad materiálu · ${label}`);
  }, [item, onUpdateTabTitle]);

  if (loading) {
    return (
      <div style={{ paddingTop: 10 }}>
        <div style={{ ...UI.card, padding: 24, borderRadius: 14 }}>
          <div style={UI.sectionSubtitle}>Načítám sklad materiálu…</div>
        </div>
      </div>
    );
  }

  if (error || !item) {
    return (
      <div style={{ paddingTop: 10 }}>
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
          <button type="button" style={UI.buttons.secondary} onClick={onBack}>
            Zavřít záložku
          </button>
        </div>
        <div
          style={{
            ...UI.card,
            padding: 24,
            borderRadius: 14,
            border: "1px solid #fecaca",
            background: "#fef2f2",
            color: "#991b1b",
            fontWeight: 700,
          }}
        >
          {error ?? "Položku se nepodařilo zobrazit."}
        </div>
      </div>
    );
  }

  return <MaterialStockDetailPage item={item} onBack={onBack} />;
}

function ProductStockTabBody({
  stockItemId,
  initialSnapshot,
  onBack,
  onUpdateTabTitle,
}: {
  stockItemId: number;
  initialSnapshot: ProductStockItem | null;
  onBack: () => void;
  onUpdateTabTitle: (title: string) => void;
}) {
  const [item, setItem] = useState(initialSnapshot);
  const [loading, setLoading] = useState(!initialSnapshot);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initialSnapshot?.id === stockItemId) {
      setItem(initialSnapshot);
      setLoading(false);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void getProductStockItems()
      .then((rows) => {
        if (cancelled) return;
        const row = rows.find((s) => s.id === stockItemId);
        if (!row) {
          setError("Položka skladu výrobků neexistuje.");
          setItem(null);
          setLoading(false);
          return;
        }
        setItem(row);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Nepodařilo se načíst sklad výrobků.");
          setItem(null);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [stockItemId, initialSnapshot]);

  useEffect(() => {
    if (!item) return;
    const gpn = (item.portfolio_gpn ?? "").trim();
    onUpdateTabTitle(gpn ? `Sklad výrobků · ${gpn}` : `Sklad výrobků · #${item.id}`);
  }, [item, onUpdateTabTitle]);

  if (loading) {
    return (
      <div style={{ paddingTop: 10 }}>
        <div style={{ ...UI.card, padding: 24, borderRadius: 14 }}>
          <div style={UI.sectionSubtitle}>Načítám sklad výrobků…</div>
        </div>
      </div>
    );
  }

  if (error || !item) {
    return (
      <div style={{ paddingTop: 10 }}>
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
          <button type="button" style={UI.buttons.secondary} onClick={onBack}>
            Zavřít záložku
          </button>
        </div>
        <div
          style={{
            ...UI.card,
            padding: 24,
            borderRadius: 14,
            border: "1px solid #fecaca",
            background: "#fef2f2",
            color: "#991b1b",
            fontWeight: 700,
          }}
        >
          {error ?? "Položku se nepodařilo zobrazit."}
        </div>
      </div>
    );
  }

  return <ProductStockDetailPage item={item} onBack={onBack} />;
}

export default function WorkspaceTabPanel({
  tab,
  onCloseThisTab,
  onUpdateTabTitle,
  openWorkspaceTab,
  setPreviewDrawer,
  renderModule,
}: Props) {
  const updateThisTabTitle = useCallback(
    (title: string) => onUpdateTabTitle(tab.key, title),
    [onUpdateTabTitle, tab.key]
  );

  switch (tab.kind) {
    case "module":
      return <>{renderModule(tab.moduleKey)}</>;
    case "orderCard":
      return (
        <OrderCardPage
          customerOrderId={tab.customerOrderId}
          onBack={onCloseThisTab}
          onWorkspaceTabTitle={updateThisTabTitle}
          onOpenItemDetail={(jobItemId, source) => {
            openWorkspaceTab({ kind: "orderItem", jobItemId, source });
          }}
          onOrderDeleted={onCloseThisTab}
        />
      );
    case "orderItem":
      return (
        <OrderItemDetailPage
          jobItemId={tab.jobItemId}
          source={tab.source}
          onBack={onCloseThisTab}
          onWorkspaceTabTitle={updateThisTabTitle}
          onOpenPortfolioItem={(portfolioItem) => {
            openWorkspaceTab({
              kind: "portfolio",
              portfolioItemId: portfolioItem.id,
              item: portfolioItem,
              title: portfolioItem.gpn ? `Portfolio ${portfolioItem.gpn}` : undefined,
            });
          }}
          onOpenProductionOrderDetail={(productionOrderId) => {
            openWorkspaceTab({ kind: "productionOrder", productionOrderId });
          }}
          onOpenCustomerOrderCard={(customerOrderId) => {
            openWorkspaceTab({ kind: "orderCard", customerOrderId });
          }}
          onPreviewPortfolioById={(portfolioItemId) => setPreviewDrawer({ kind: "portfolio", portfolioItemId })}
          onPreviewProductionOrderById={(productionOrderId) =>
            setPreviewDrawer({ kind: "productionOrder", productionOrderId })
          }
          onOpenMaterialRequirements={() => {
            openWorkspaceTab({
              kind: "module",
              moduleKey: "Požadavky materiálu",
              title: "Požadavky materiálu",
            });
          }}
        />
      );
    case "productionOrder":
      return (
        <ProductionOrderDetailPage
          productionOrderId={tab.productionOrderId}
          onBack={onCloseThisTab}
          onWorkspaceTabTitle={updateThisTabTitle}
          onOpenPortfolioItemId={(portfolioItemId) => {
            openWorkspaceTab({ kind: "portfolio", portfolioItemId, item: null });
          }}
          onOpenCustomerOrderCard={(customerOrderId) => {
            openWorkspaceTab({ kind: "orderCard", customerOrderId });
          }}
          onPreviewPortfolioById={(portfolioItemId) => setPreviewDrawer({ kind: "portfolio", portfolioItemId })}
        />
      );
    case "portfolio":
      return (
        <PortfolioTabBody
          portfolioItemId={tab.portfolioItemId}
          initialItem={tab.item}
          onBack={onCloseThisTab}
          onUpdateTabTitle={updateThisTabTitle}
        />
      );
    case "materialStock":
      return (
        <MaterialStockTabBody
          stockItemId={tab.stockItemId}
          initialSnapshot={tab.snapshot}
          onBack={onCloseThisTab}
          onUpdateTabTitle={updateThisTabTitle}
        />
      );
    case "productStock":
      return (
        <ProductStockTabBody
          stockItemId={tab.stockItemId}
          initialSnapshot={tab.snapshot}
          onBack={onCloseThisTab}
          onUpdateTabTitle={updateThisTabTitle}
        />
      );
    case "materialPurchaseOrder":
      return (
        <MaterialPurchaseOrderDetailPage
          materialPurchaseOrderId={tab.materialPurchaseOrderId}
          onBack={onCloseThisTab}
          onWorkspaceTabTitle={updateThisTabTitle}
        />
      );
    default: {
      const _x: never = tab;
      return _x;
    }
  }
}
