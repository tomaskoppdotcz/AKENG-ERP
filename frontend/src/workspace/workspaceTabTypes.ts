import type { MaterialStockItem } from "../services/materialStockApi";
import type { PortfolioItem } from "../services/portfolioApi";
import type { ProductStockItem } from "../services/productStockApi";

export type MaterialStockDetailSnapshot = MaterialStockItem & { material_dimension?: string | null };

export type OpenWorkspaceInput =
  | { kind: "module"; moduleKey: string; title?: string }
  | { kind: "orderCard"; customerOrderId: number; title?: string }
  | { kind: "orderItem"; jobItemId: number; source: "orders" | "drawings"; title?: string }
  | { kind: "productionOrder"; productionOrderId: number; title?: string }
  | { kind: "portfolio"; portfolioItemId: number; item?: PortfolioItem | null; title?: string }
  | { kind: "materialStock"; stockItemId: number; snapshot?: MaterialStockDetailSnapshot | null; title?: string }
  | { kind: "productStock"; stockItemId: number; snapshot?: ProductStockItem | null; title?: string }
  | { kind: "materialPurchaseOrder"; materialPurchaseOrderId: number; title?: string }
  | { kind: "workReport"; workReportId: number; title?: string }
  | { kind: "workReportEdit"; workReportId: number; title?: string }
  | { kind: "workReportNew"; title?: string };

export type WorkspaceTab =
  | { key: string; kind: "module"; moduleKey: string; title: string }
  | { key: string; kind: "orderCard"; customerOrderId: number; title: string }
  | { key: string; kind: "orderItem"; jobItemId: number; source: "orders" | "drawings"; title: string }
  | { key: string; kind: "productionOrder"; productionOrderId: number; title: string }
  | { key: string; kind: "portfolio"; portfolioItemId: number; item: PortfolioItem | null; title: string }
  | { key: string; kind: "materialStock"; stockItemId: number; snapshot: MaterialStockDetailSnapshot | null; title: string }
  | { key: string; kind: "productStock"; stockItemId: number; snapshot: ProductStockItem | null; title: string }
  | { key: string; kind: "materialPurchaseOrder"; materialPurchaseOrderId: number; title: string }
  | { key: string; kind: "workReport"; workReportId: number; title: string }
  | { key: string; kind: "workReportEdit"; workReportId: number; title: string }
  | { key: string; kind: "workReportNew"; title: string };

export function workspaceKeyFromInput(input: OpenWorkspaceInput): string {
  switch (input.kind) {
    case "module":
      return `module-${input.moduleKey}`;
    case "orderCard":
      return `orderCard-${input.customerOrderId}`;
    case "orderItem":
      return `orderItem-${input.jobItemId}`;
    case "productionOrder":
      return `productionOrder-${input.productionOrderId}`;
    case "portfolio":
      return `portfolio-${input.portfolioItemId}`;
    case "materialStock":
      return `materialStock-${input.stockItemId}`;
    case "productStock":
      return `productStock-${input.stockItemId}`;
    case "materialPurchaseOrder":
      return `materialPurchaseOrder-${input.materialPurchaseOrderId}`;
    case "workReport":
      return `workReport-${input.workReportId}`;
    case "workReportEdit":
      return `workReportEdit-${input.workReportId}`;
    case "workReportNew":
      return "workReportNew";
  }
}

export function tabFromInput(input: OpenWorkspaceInput): WorkspaceTab {
  const key = workspaceKeyFromInput(input);
  switch (input.kind) {
    case "module":
      return {
        key,
        kind: "module",
        moduleKey: input.moduleKey,
        title: input.title?.trim() || input.moduleKey,
      };
    case "orderCard":
      return {
        key,
        kind: "orderCard",
        customerOrderId: input.customerOrderId,
        title: input.title?.trim() || `Zakázka ${input.customerOrderId}`,
      };
    case "orderItem":
      return {
        key,
        kind: "orderItem",
        jobItemId: input.jobItemId,
        source: input.source,
        title: input.title?.trim() || `Položka ${input.jobItemId}`,
      };
    case "productionOrder":
      return {
        key,
        kind: "productionOrder",
        productionOrderId: input.productionOrderId,
        title: input.title?.trim() || `VP · #${input.productionOrderId}`,
      };
    case "portfolio":
      return {
        key,
        kind: "portfolio",
        portfolioItemId: input.portfolioItemId,
        item: input.item ?? null,
        title:
          input.title?.trim() ||
          (input.item?.gpn?.trim()
            ? `Portfolio ${input.item.gpn.trim()}`
            : `Portfolio #${input.portfolioItemId}`),
      };
    case "materialStock":
      return {
        key,
        kind: "materialStock",
        stockItemId: input.stockItemId,
        snapshot: input.snapshot ?? null,
        title: input.title?.trim() || `Sklad materiálu · #${input.stockItemId}`,
      };
    case "productStock":
      return {
        key,
        kind: "productStock",
        stockItemId: input.stockItemId,
        snapshot: input.snapshot ?? null,
        title: input.title?.trim() || `Sklad výrobků · #${input.stockItemId}`,
      };
    case "materialPurchaseOrder":
      return {
        key,
        kind: "materialPurchaseOrder",
        materialPurchaseOrderId: input.materialPurchaseOrderId,
        title: input.title?.trim() || `NMPO · #${input.materialPurchaseOrderId}`,
      };
    case "workReport":
      return {
        key,
        kind: "workReport",
        workReportId: input.workReportId,
        title: input.title?.trim() || "Výkaz",
      };
    case "workReportEdit":
      return {
        key,
        kind: "workReportEdit",
        workReportId: input.workReportId,
        title: input.title?.trim() || "Úprava výkazu",
      };
    case "workReportNew":
      return {
        key,
        kind: "workReportNew",
        title: input.title?.trim() || "Nový výkaz práce",
      };
  }
}
