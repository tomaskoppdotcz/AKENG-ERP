import React, { useEffect, useState } from "react";
import DetailPageHeader from "./DetailPageHeader";
import { getPortfolioItem, type PortfolioItem } from "../services/portfolioApi";
import { getProductionOrderDetail, type ProductionOrderDetail } from "../services/productionOrdersApi";
import { UI } from "../styles/ui";

export type ErpPreviewDrawerState =
  | null
  | { kind: "portfolio"; portfolioItemId: number }
  | { kind: "productionOrder"; productionOrderId: number };

type Props = {
  open: ErpPreviewDrawerState;
  onClose: () => void;
};

export default function ErpPreviewDrawer({ open, onClose }: Props) {
  const [portfolio, setPortfolio] = useState<PortfolioItem | null>(null);
  const [productionOrder, setProductionOrder] = useState<ProductionOrderDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setPortfolio(null);
      setProductionOrder(null);
      setError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setPortfolio(null);
    setProductionOrder(null);
    const run =
      open.kind === "portfolio"
        ? getPortfolioItem(open.portfolioItemId).then((r) => {
            if (!cancelled) setPortfolio(r);
          })
        : getProductionOrderDetail(open.productionOrderId).then((r) => {
            if (!cancelled) setProductionOrder(r);
          });
    run
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Nepodařilo se načíst náhled.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  if (!open) return null;

  return (
    <>
      <button
        type="button"
        aria-label="Zavřít náhled"
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 1090,
          border: "none",
          margin: 0,
          padding: 0,
          background: "rgba(15, 23, 42, 0.35)",
          cursor: "default",
        }}
      />
      <aside
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          zIndex: 1100,
          width: "min(440px, 100vw)",
          height: "100vh",
          background: "#fff",
          borderLeft: "1px solid #e2e8f0",
          boxShadow: "-8px 0 24px rgba(15, 23, 42, 0.12)",
          display: "flex",
          flexDirection: "column",
          padding: 16,
          boxSizing: "border-box",
        }}
      >
        <div style={{ marginBottom: 12 }}>
          <DetailPageHeader
            title="Náhled"
            subtitle={open.kind === "portfolio" ? "Portfolio položka" : "Výrobní příkaz"}
            actions={
              <button type="button" style={UI.buttons.secondary} onClick={onClose}>
                Zavřít
              </button>
            }
          />
        </div>
        {loading ? (
          <div style={{ color: "#64748b", fontWeight: 700 }}>Načítám…</div>
        ) : error ? (
          <div style={{ color: "#991b1b", fontWeight: 700, lineHeight: 1.4 }}>{error}</div>
        ) : open.kind === "portfolio" && portfolio ? (
          <div style={{ overflowY: "auto", flex: 1, display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ fontSize: 22, fontWeight: 900, color: "#0f172a" }}>{portfolio.gpn}</div>
            <div style={{ fontSize: 14, color: "#475569", fontWeight: 600 }}>{portfolio.name}</div>
            <div style={{ ...UI.card, borderRadius: 12, fontSize: 13, color: "#334155" }}>
              <div>
                <strong>Zákazník:</strong> {portfolio.customer_name?.trim() || "—"}
              </div>
              <div style={{ marginTop: 6 }}>
                <strong>Výkres / revize:</strong> {(portfolio.drawing_no ?? "—") + " / " + (portfolio.revision ?? "—")}
              </div>
            </div>
          </div>
        ) : open.kind === "productionOrder" && productionOrder ? (
          <div style={{ overflowY: "auto", flex: 1, display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ fontSize: 22, fontWeight: 900, color: "#0f172a" }}>{productionOrder.vp_code}</div>
            <div style={{ fontSize: 14, color: "#475569", fontWeight: 600 }}>
              {productionOrder.description ?? productionOrder.gpn ?? "—"}
            </div>
            <div style={{ ...UI.card, borderRadius: 12, fontSize: 13, color: "#334155" }}>
              <div>
                <strong>Zakázka:</strong> {productionOrder.zakazka ?? "—"}
              </div>
              <div style={{ marginTop: 6 }}>
                <strong>GPN:</strong> {productionOrder.gpn ?? "—"}
              </div>
              <div style={{ marginTop: 6 }}>
                <strong>Stav:</strong> {productionOrder.status ?? "—"} · <strong>Množství:</strong>{" "}
                {productionOrder.quantity} ks
              </div>
            </div>
          </div>
        ) : (
          <div style={{ color: "#64748b", fontWeight: 600 }}>Žádná data.</div>
        )}
      </aside>
    </>
  );
}
