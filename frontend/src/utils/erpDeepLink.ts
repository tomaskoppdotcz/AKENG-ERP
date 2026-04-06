export type ErpDeepLink =
  | { view: "portfolio"; portfolioItemId: number }
  | { view: "portfolioSearch"; gpn: string }
  | { view: "orderCard"; customerOrderId: number }
  | { view: "orderItem"; jobItemId: number; source?: "orders" | "drawings" }
  | { view: "productionOrder"; productionOrderId: number };

export function parseErpDeepLink(search: string): ErpDeepLink | null {
  const q = search.startsWith("?") ? search.slice(1) : search;
  const params = new URLSearchParams(q);
  const view = params.get("view");
  if (view === "portfolio") {
    const portfolioItemId = Number(params.get("portfolioItemId"));
    if (Number.isFinite(portfolioItemId) && portfolioItemId > 0) {
      return { view: "portfolio", portfolioItemId };
    }
  }
  if (view === "portfolioSearch") {
    const gpn = (params.get("gpn") ?? "").trim();
    if (gpn.length > 0) {
      return { view: "portfolioSearch", gpn };
    }
  }
  if (view === "orderCard") {
    const customerOrderId = Number(params.get("customerOrderId"));
    if (Number.isFinite(customerOrderId) && customerOrderId > 0) {
      return { view: "orderCard", customerOrderId };
    }
  }
  if (view === "orderItem") {
    const jobItemId = Number(params.get("jobItemId"));
    if (Number.isFinite(jobItemId) && jobItemId > 0) {
      const src = params.get("source");
      const source = src === "drawings" ? "drawings" : "orders";
      return { view: "orderItem", jobItemId, source };
    }
  }
  if (view === "productionOrder") {
    const productionOrderId = Number(params.get("productionOrderId"));
    if (Number.isFinite(productionOrderId) && productionOrderId > 0) {
      return { view: "productionOrder", productionOrderId };
    }
  }
  return null;
}

export function buildErpUrl(link: ErpDeepLink): string {
  const base = `${window.location.origin}${window.location.pathname}`;
  const p = new URLSearchParams();
  p.set("view", link.view);
  if (link.view === "portfolio") p.set("portfolioItemId", String(link.portfolioItemId));
  if (link.view === "portfolioSearch") p.set("gpn", link.gpn);
  if (link.view === "orderCard") p.set("customerOrderId", String(link.customerOrderId));
  if (link.view === "orderItem") {
    p.set("jobItemId", String(link.jobItemId));
    if (link.source === "drawings") p.set("source", "drawings");
  }
  if (link.view === "productionOrder") p.set("productionOrderId", String(link.productionOrderId));
  return `${base}?${p.toString()}`;
}
