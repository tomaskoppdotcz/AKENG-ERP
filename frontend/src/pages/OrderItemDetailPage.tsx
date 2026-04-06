import React, { useCallback, useEffect, useMemo, useState } from "react";
import DetailPageHeader from "../components/DetailPageHeader";
import { UI } from "../styles/ui";
import {
  createMaterialReservation,
  getMaterialIssuesForJobItem,
  type JobItemMaterialIssueRow,
} from "../services/materialStockApi";
import { getMaterialRequirementsByVp, type VpRequirementRow } from "../services/materialRequirementsApi";
import {
  getJobItemDetailContext,
  type OrderDetailItem,
  type OrderDetailResponse,
} from "../services/ordersApi";
import {
  findPortfolioItemByGpn,
  getPortfolioItem,
  getPortfolioItems,
  getPortfolioItemTechnology,
  getPortfolioTechnologyMaterials,
  type PortfolioItem,
  type PortfolioItemTechnologyMaterialsResponse,
  type PortfolioItemTechnologyResponse,
  type PortfolioTechnologyMaterial,
} from "../services/portfolioApi";
import { buildErpUrl } from "../utils/erpDeepLink";

type Props = {
  jobItemId: number;
  source: "orders" | "drawings";
  onBack: () => void;
  onWorkspaceTabTitle?: (title: string) => void;
  /** Otevře detail portfolio položky (např. z GPN shody). */
  onOpenPortfolioItem?: (item: PortfolioItem) => void;
  onOpenProductionOrderDetail?: (productionOrderId: number) => void;
  onOpenCustomerOrderCard?: (customerOrderId: number) => void;
  onPreviewPortfolioById?: (portfolioItemId: number) => void;
  onPreviewProductionOrderById?: (productionOrderId: number) => void;
  onOpenMaterialRequirements?: () => void;
};

type ItemSubtab =
  | "Dokumenty"
  | "Technologický postup"
  | "Výkazy"
  | "Neshody"
  | "Zmetky"
  | "Reklamace"
  | "Výrobní plán"
  | "Expedice"
  | "Dodací list"
  | "Výdej materiálu"
  | "Náklady";

const SUBTABS: ItemSubtab[] = [
  "Dokumenty",
  "Technologický postup",
  "Výkazy",
  "Neshody",
  "Zmetky",
  "Reklamace",
  "Výrobní plán",
  "Expedice",
  "Dodací list",
  "Výdej materiálu",
  "Náklady",
];

function formatCenaZaKs(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return `${n.toLocaleString("cs-CZ", { maximumFractionDigits: 2 })} Kč`;
}

function formatLogisticModeCz(mode: string | null | undefined): string {
  if (mode == null || mode === "") return "—";
  const map: Record<string, string> = {
    sklad_zakaznik: "Sklad → zákazník",
    vyroba_zakaznik: "Výroba → zákazník",
    sklad: "Sklad",
  };
  return map[mode] ?? mode;
}

function formatCoverageTypeCz(value: string | null | undefined): string {
  if (value == null || value === "") return "—";
  const map: Record<string, string> = {
    stock: "Sklad",
    wip: "Rozpracovaná výroba",
    new_production: "Nová výroba",
  };
  return map[value] ?? value;
}

function formatMaterialNumber(value: number | null | undefined, empty = "—"): string {
  if (value == null || Number.isNaN(value)) return empty;
  if (Number.isInteger(value)) return String(value);
  return value.toLocaleString("cs-CZ", { maximumFractionDigits: 6 });
}

function vpHasPendingMaterialIssue(vp: VpRequirementRow): boolean {
  if (vp.coverage !== "covered") return false;
  for (const m of vp.materials) {
    const lines = m.reservation_lines;
    if (lines && lines.length > 0) {
      if (lines.some((l) => String(l.status || "").toLowerCase() !== "issued")) return true;
    } else if (String(m.status || "").toLowerCase() !== "issued") {
      return true;
    }
  }
  return false;
}

function materialRequirementStatus(
  row: PortfolioTechnologyMaterial,
  totalRequired: number
): "Není skladová karta" | "Dostatek" | "Nedostatek" {
  if (row.stock_item_id == null || row.stock_status === "neni_skladova_karta") {
    return "Není skladová karta";
  }
  const available =
    row.stock_available_qty != null && !Number.isNaN(row.stock_available_qty)
      ? row.stock_available_qty
      : (row.stock_current_qty ?? 0);
  return available >= totalRequired ? "Dostatek" : "Nedostatek";
}

type LoadedJobItemDetail = {
  customerOrderId: number;
  order: OrderDetailResponse;
  item: OrderDetailItem;
};

function PlaceholderCard({ text }: { text: string }) {
  return (
    <div style={UI.card}>
      <div style={{ ...UI.headerTitle, fontSize: 18, marginBottom: 8 }}>{text}</div>
    </div>
  );
}

const linkButtonReset: React.CSSProperties = {
  background: "none",
  border: "none",
  padding: 0,
  margin: 0,
  cursor: "pointer",
  font: "inherit",
  color: "#2563eb",
  textDecoration: "underline",
  textUnderlineOffset: "3px",
};

export default function OrderItemDetailPage({
  jobItemId,
  source,
  onBack,
  onWorkspaceTabTitle,
  onOpenPortfolioItem,
  onOpenProductionOrderDetail,
  onOpenCustomerOrderCard,
  onPreviewPortfolioById,
  onPreviewProductionOrderById,
  onOpenMaterialRequirements,
}: Props) {
  const [activeTab, setActiveTab] = useState<ItemSubtab>("Technologický postup");
  const [hoverTab, setHoverTab] = useState<ItemSubtab | null>(null);
  const [detail, setDetail] = useState<LoadedJobItemDetail | null>(null);
  const [pageLoading, setPageLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);

  const [matchedPortfolioItem, setMatchedPortfolioItem] = useState<PortfolioItem | null>(null);
  const [portfolioTechnology, setPortfolioTechnology] = useState<PortfolioItemTechnologyResponse | null>(null);
  const [portfolioTechnologyMaterials, setPortfolioTechnologyMaterials] =
    useState<PortfolioItemTechnologyMaterialsResponse | null>(null);
  const [portfolioTechLoading, setPortfolioTechLoading] = useState(false);
  const [portfolioTechError, setPortfolioTechError] = useState<string | null>(null);
  const [materialReserveError, setMaterialReserveError] = useState<string | null>(null);
  const [reservingTpMaterialId, setReservingTpMaterialId] = useState<number | null>(null);

  const [materialIssueRows, setMaterialIssueRows] = useState<JobItemMaterialIssueRow[]>([]);
  const [materialIssueLoading, setMaterialIssueLoading] = useState(false);
  const [materialIssueError, setMaterialIssueError] = useState<string | null>(null);
  const [vpReqForIssue, setVpReqForIssue] = useState<VpRequirementRow[] | null>(null);

  const reloadTechnologyMaterials = useCallback(async () => {
    const pid = matchedPortfolioItem?.id;
    if (pid == null) return;
    const res = await getPortfolioTechnologyMaterials(pid);
    setPortfolioTechnologyMaterials(res);
  }, [matchedPortfolioItem?.id]);

  useEffect(() => {
    let cancelled = false;
    setPageLoading(true);
    setPageError(null);
    setDetail(null);
    getJobItemDetailContext(jobItemId)
      .then((ctx) => {
        if (cancelled) return;
        setDetail(ctx);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setPageError(e instanceof Error ? e.message : "Nepodařilo se načíst položku.");
          setDetail(null);
        }
      })
      .finally(() => {
        if (!cancelled) setPageLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [jobItemId]);

  useEffect(() => {
    if (!onWorkspaceTabTitle || !detail) return;
    const line = detail.item.line_no;
    const gpn = (detail.item.gpn ?? "").trim();
    const second = gpn || String(detail.item.job_item_id);
    onWorkspaceTabTitle(`Položka ${line} / ${second}`);
  }, [detail, onWorkspaceTabTitle]);

  const gpnForPortfolio = (detail?.item.gpn ?? "").trim();

  useEffect(() => {
    const gpn = gpnForPortfolio;
    let cancelled = false;
    setPortfolioTechError(null);
    setMaterialReserveError(null);
    if (!gpn) {
      setMatchedPortfolioItem(null);
      setPortfolioTechnology(null);
      setPortfolioTechnologyMaterials(null);
      setPortfolioTechLoading(false);
      return;
    }
    setPortfolioTechLoading(true);
    setMatchedPortfolioItem(null);
    setPortfolioTechnology(null);
    setPortfolioTechnologyMaterials(null);
    const effectivePortfolioId = detail?.item.effective_portfolio_item_id ?? null;
    const loadMatchedItem = async (): Promise<PortfolioItem | null> => {
      if (effectivePortfolioId != null && Number.isFinite(effectivePortfolioId)) {
        const items = await getPortfolioItems();
        const byId = items.find((x) => x.id === effectivePortfolioId);
        if (byId) return byId;
      }
      return findPortfolioItemByGpn(gpn);
    };
    loadMatchedItem()
      .then(async (item) => {
        if (cancelled) return;
        setMatchedPortfolioItem(item);
        if (!item) {
          setPortfolioTechnology(null);
          setPortfolioTechnologyMaterials(null);
          setPortfolioTechLoading(false);
          return;
        }
        try {
          const [tech, materialsRes] = await Promise.all([
            getPortfolioItemTechnology(item.id),
            getPortfolioTechnologyMaterials(item.id),
          ]);
          if (!cancelled) {
            setPortfolioTechnology(tech);
            setPortfolioTechnologyMaterials(materialsRes);
          }
        } catch (e: unknown) {
          if (!cancelled) {
            setPortfolioTechError(
              e instanceof Error ? e.message : "Nepodařilo se načíst technologický postup z portfolia."
            );
            setPortfolioTechnology(null);
            setPortfolioTechnologyMaterials(null);
          }
        } finally {
          if (!cancelled) setPortfolioTechLoading(false);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setPortfolioTechError(e instanceof Error ? e.message : "Nepodařilo se načíst portfolio.");
          setMatchedPortfolioItem(null);
          setPortfolioTechnology(null);
          setPortfolioTechnologyMaterials(null);
          setPortfolioTechLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [gpnForPortfolio, detail?.item.effective_portfolio_item_id]);

  useEffect(() => {
    if (activeTab !== "Výdej materiálu") return;
    let cancelled = false;
    setMaterialIssueLoading(true);
    setMaterialIssueError(null);
    void Promise.all([getMaterialIssuesForJobItem(jobItemId), getMaterialRequirementsByVp()])
      .then(([iss, vp]) => {
        if (cancelled) return;
        setMaterialIssueRows(iss.items);
        setVpReqForIssue(vp);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setMaterialIssueError(e instanceof Error ? e.message : "Nepodařilo se načíst data výdeje.");
          setMaterialIssueRows([]);
          setVpReqForIssue(null);
        }
      })
      .finally(() => {
        if (!cancelled) setMaterialIssueLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeTab, jobItemId]);

  const itemOrderQuantity = useMemo(() => {
    const q = detail?.item.qty;
    if (q == null || !Number.isFinite(q) || q <= 0) return 1;
    return q;
  }, [detail?.item.qty]);

  async function handleReserveTpMaterial(row: PortfolioTechnologyMaterial, totalRequired: number) {
    if (row.stock_item_id == null || totalRequired <= 0) return;
    setMaterialReserveError(null);
    setReservingTpMaterialId(row.id);
    try {
      await createMaterialReservation({
        stock_item_id: row.stock_item_id,
        job_item_id: jobItemId,
        gpn: (detail?.item.gpn ?? "").trim() || null,
        reserved_qty: totalRequired,
        note: null,
      });
      await reloadTechnologyMaterials();
    } catch (e: unknown) {
      setMaterialReserveError(e instanceof Error ? e.message : "Nepodařilo se vytvořit rezervaci.");
    } finally {
      setReservingTpMaterialId(null);
    }
  }

  const stavLabel = "Neuvedeno";
  const stavBadgeStyle = { background: "#f1f5f9", color: "#475569", border: "1px solid #cbd5e1" };

  if (pageLoading) {
    return (
      <div style={UI.container}>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <button onClick={onBack} style={UI.buttonSecondary}>
            {source === "orders" ? "Zpět na zakázku" : "Zpět na výkresy"}
          </button>
          <div style={{ ...UI.card, padding: 24, borderRadius: 14 }}>
            <div style={UI.sectionSubtitle}>Načítám detail položky…</div>
          </div>
        </div>
      </div>
    );
  }

  if (pageError) {
    return (
      <div style={UI.container}>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <button onClick={onBack} style={UI.buttonSecondary}>
            {source === "orders" ? "Zpět na zakázku" : "Zpět na výkresy"}
          </button>
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
            {pageError}
          </div>
        </div>
      </div>
    );
  }

  if (!detail) {
    return (
      <div style={UI.container}>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <button onClick={onBack} style={UI.buttonSecondary}>
            {source === "orders" ? "Zpět na zakázku" : "Zpět na výkresy"}
          </button>
          <div
            style={{
              ...UI.card,
              padding: 24,
              borderRadius: 14,
              border: "1px solid #e2e8f0",
              background: "#f8fafc",
              color: "#64748b",
              fontWeight: 700,
              textAlign: "center",
            }}
          >
            Položku se nepodařilo najít v datech z backendu (neexistující ID nebo chybí vazba na objednávku).
          </div>
        </div>
      </div>
    );
  }

  const { order, item } = detail;
  const orderKind = order.customer_order?.order_type ?? "customer";
  const linkedProductionOrders =
    orderKind === "internal"
      ? (item.production_orders ?? [])
      : (item.production_orders ?? []).filter(
          (po) => po.source_type === "stock_allocation" || po.source_type === "order_allocation"
        );
  const vpLabel =
    linkedProductionOrders.length > 0
      ? linkedProductionOrders.map((po) => po.vp_code).filter(Boolean).join(", ")
      : (item.vp_code ?? "—");

  async function openPortfolioFromGpn() {
    if (!onOpenPortfolioItem) return;
    if (matchedPortfolioItem) {
      onOpenPortfolioItem(matchedPortfolioItem);
      return;
    }
    const pid = item.effective_portfolio_item_id ?? item.portfolio_item_id ?? null;
    if (pid != null) {
      try {
        const pi = await getPortfolioItem(pid);
        onOpenPortfolioItem(pi);
      } catch {
        /* ignore */
      }
      return;
    }
    const found = await findPortfolioItemByGpn(item.gpn);
    if (found) onOpenPortfolioItem(found);
  }

  const portfolioPreviewId =
    matchedPortfolioItem?.id ?? item.effective_portfolio_item_id ?? item.portfolio_item_id ?? null;

  const linkedPoIdsForMaterialTab = new Set(linkedProductionOrders.map((p) => p.id));
  const materialLinkedVpsForTab =
    vpReqForIssue?.filter(
      (v) => v.job_item_id === jobItemId || linkedPoIdsForMaterialTab.has(v.production_order_id)
    ) ?? [];
  const materialTabHasLines = materialLinkedVpsForTab.some((v) => v.materials.length > 0);
  const materialTabUncovered = materialLinkedVpsForTab.some((v) => v.coverage !== "covered");
  const materialTabShowIssueAction = materialLinkedVpsForTab.some(vpHasPendingMaterialIssue);
  const materialTabAnyMovements = materialIssueRows.length > 0;

  const materialIssueStateBadge = (() => {
    const base: React.CSSProperties = {
      display: "inline-flex",
      alignItems: "center",
      padding: "6px 12px",
      borderRadius: 999,
      fontSize: 12,
      fontWeight: 800,
      border: "1px solid #cbd5e1",
    };
    if (materialIssueLoading || vpReqForIssue == null) {
      return { label: "Načítám…", style: { ...base, background: "#f1f5f9", color: "#475569" } };
    }
    if (linkedProductionOrders.length === 0) {
      return { label: "Bez výrobního příkazu", style: { ...base, background: "#f1f5f9", color: "#64748b" } };
    }
    if (!materialTabHasLines) {
      return { label: "Žádné řádky k výdeji", style: { ...base, background: "#f1f5f9", color: "#64748b" } };
    }
    if (materialTabShowIssueAction && materialTabAnyMovements) {
      return {
        label: "Částečně vydáno",
        style: { ...base, background: "#fef3c7", color: "#b45309", border: "1px solid #fcd34d" },
      };
    }
    if (materialTabShowIssueAction) {
      return {
        label: "Nevydáno",
        style: { ...base, background: "#fee2e2", color: "#b91c1c", border: "1px solid #fecaca" },
      };
    }
    return {
      label: "Vydáno",
      style: { ...base, background: "#dcfce7", color: "#166534", border: "1px solid #86efac" },
    };
  })();

  return (
    <div style={UI.container}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <DetailPageHeader
          title={
            <button
              type="button"
              disabled={!onOpenPortfolioItem}
              onClick={() => void openPortfolioFromGpn()}
              title={onOpenPortfolioItem ? "Otevřít portfolio položku" : undefined}
              style={{
                ...UI.pageTitle,
                display: "block",
                background: "none",
                border: "none",
                padding: 0,
                textAlign: "left",
                cursor: onOpenPortfolioItem ? "pointer" : "default",
                textDecoration: onOpenPortfolioItem ? "underline" : "none",
                textUnderlineOffset: 4,
                maxWidth: "100%",
              }}
            >
              {item.gpn}
            </button>
          }
          subtitle={source === "drawings" ? "Detail položky napříč zakázkami" : item.description ?? "—"}
          headerAside={
            <>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  flexWrap: "wrap",
                  padding: "6px 12px",
                  borderRadius: 999,
                  fontSize: 12,
                  fontWeight: 800,
                  ...(linkedProductionOrders.length > 0 || (item.vp_code && vpLabel !== "—")
                    ? {
                        background: "#dcfce7",
                        color: "#15803d",
                        border: "1px solid #86efac",
                      }
                    : {
                        background: "#f1f5f9",
                        color: "#64748b",
                        border: "1px solid #e2e8f0",
                      }),
                }}
              >
                <span style={{ whiteSpace: "nowrap" }}>VP:</span>
                {linkedProductionOrders.length > 0 ? (
                  linkedProductionOrders.map((po, idx) => (
                    <span key={po.id} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                      {idx > 0 ? <span style={{ color: "#64748b" }}>·</span> : null}
                      <button
                        type="button"
                        disabled={!onOpenProductionOrderDetail}
                        onClick={() => onOpenProductionOrderDetail?.(po.id)}
                        style={{
                          ...linkButtonReset,
                          color: "#15803d",
                          fontWeight: 900,
                          fontSize: 12,
                        }}
                      >
                        {po.vp_code}
                      </button>
                    </span>
                  ))
                ) : item.vp_code && onOpenProductionOrderDetail ? (
                  (() => {
                    const po = (item.production_orders ?? []).find((p) => p.vp_code === item.vp_code);
                    if (!po) return <span style={{ color: "#15803d" }}>{item.vp_code}</span>;
                    return (
                      <button
                        type="button"
                        onClick={() => onOpenProductionOrderDetail(po.id)}
                        style={{
                          ...linkButtonReset,
                          color: "#15803d",
                          fontWeight: 900,
                          fontSize: 12,
                        }}
                      >
                        {item.vp_code}
                      </button>
                    );
                  })()
                ) : (
                  <span>{vpLabel}</span>
                )}
              </span>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  padding: "6px 12px",
                  borderRadius: 999,
                  fontSize: 12,
                  fontWeight: 800,
                  ...stavBadgeStyle,
                }}
              >
                Stav: {stavLabel}
              </span>
            </>
          }
          actions={
            <>
              <button onClick={onBack} style={UI.buttonSecondary}>
                {source === "orders" ? "Zpět na zakázku" : "Zpět na výkresy"}
              </button>
              <button
                type="button"
                style={UI.buttons.secondary}
                onClick={() =>
                  window.open(buildErpUrl({ view: "orderItem", jobItemId, source }), "_blank")
                }
              >
                Otevřít v novém okně
              </button>
            </>
          }
          summaryTiles={
            <div style={UI.summaryTilesGrid}>
              <div style={{ ...UI.summaryTile, flex: "1 1 200px", minWidth: 160, maxWidth: "100%" }}>
                <div style={UI.summaryTileLabel}>Zakázka</div>
                <div style={UI.summaryTileValue}>
                  {onOpenCustomerOrderCard ? (
                    <button type="button" style={linkButtonReset} onClick={() => onOpenCustomerOrderCard(detail.customerOrderId)}>
                      {order.job?.zakazka ?? "—"}
                    </button>
                  ) : (
                    order.job?.zakazka ?? "—"
                  )}
                </div>
              </div>
              {(
                [
                  ["Řádek", String(item.line_no)],
                  ["Množství", `${item.qty} ks`],
                  ["Termín", item.due_date ?? "—"],
                  ["Materiál", item.material_default ?? "—"],
                  ["Cena / ks", formatCenaZaKs(item.sale_price_per_piece ?? undefined)],
                ] as const
              ).map(([label, value]) => (
                <div key={label} style={{ ...UI.summaryTile, flex: "1 1 200px", minWidth: 160, maxWidth: "100%" }}>
                  <div style={UI.summaryTileLabel}>{label}</div>
                  <div style={UI.summaryTileValue}>{value}</div>
                </div>
              ))}
            </div>
          }
        />

        {orderKind === "customer" ? (
          <div style={{ ...UI.card, borderRadius: 14, padding: 16 }}>
            <div style={{ fontSize: 16, fontWeight: 900, color: "#0f172a", marginBottom: 10 }}>Pokrytí položky</div>
            {!(item.coverage_rows && item.coverage_rows.length > 0) ? (
              <div style={{ fontSize: 14, color: "#64748b", fontWeight: 600 }}>
                Zatím nejsou evidované žádné řádky pokrytí položky.
              </div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={UI.table}>
                  <thead>
                    <tr style={{ background: "#f8fafc" }}>
                      {["Zdroj", "Množství", "Původní VP", "Dokončovací VP", "Logistický režim", "Poznámka"].map((h) => (
                        <th key={h} style={{ ...UI.th, fontSize: 13, padding: "10px 10px", whiteSpace: "nowrap" }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(item.coverage_rows ?? []).map((row) => (
                      <tr key={`cov-${row.id}`}>
                        <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap", fontWeight: 700 }}>
                          {formatCoverageTypeCz(row.coverage_type)}
                        </td>
                        <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>{row.qty} ks</td>
                        <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap", fontWeight: 800 }}>
                          {row.source_production_order_code ?? "—"}
                        </td>
                        <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap", fontWeight: 800 }}>
                          {row.consuming_production_order_code ?? "—"}
                        </td>
                        <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>
                          {formatLogisticModeCz(row.consuming_logistic_mode)}
                        </td>
                        <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>
                          {row.note ?? "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : null}

        <div style={{ ...UI.card, borderRadius: 14, padding: 16 }}>
          <div style={{ fontSize: 16, fontWeight: 900, color: "#0f172a", marginBottom: 10 }}>
            Navázané výrobní příkazy
          </div>
          {linkedProductionOrders.length === 0 ? (
            <div style={{ fontSize: 14, color: "#64748b", fontWeight: 600 }}>
              K této položce zatím nejsou navázané žádné výrobní příkazy.
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={UI.table}>
                <thead>
                  <tr style={{ background: "#f8fafc" }}>
                    {["VP", "Typ zdroje", "Logistický režim", "Množství", "Stav"].map((h) => (
                      <th key={h} style={{ ...UI.th, fontSize: 13, padding: "10px 10px", whiteSpace: "nowrap" }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {linkedProductionOrders.map((po) => (
                    <tr key={po.id}>
                      <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap", fontWeight: 800 }}>
                        <button
                          type="button"
                          disabled={!onOpenProductionOrderDetail}
                          onClick={() => onOpenProductionOrderDetail?.(po.id)}
                          style={{ ...linkButtonReset, fontWeight: 800 }}
                        >
                          {po.vp_code}
                        </button>
                        {onPreviewProductionOrderById ? (
                          <button
                            type="button"
                            style={{ ...UI.buttons.secondary, marginLeft: 8, padding: "2px 8px", fontSize: 11 }}
                            onClick={() => onPreviewProductionOrderById(po.id)}
                          >
                            Náhled
                          </button>
                        ) : null}
                      </td>
                      <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>{po.source_type ?? "—"}</td>
                      <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>{po.logistic_mode ?? "—"}</td>
                      <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>{po.quantity} ks</td>
                      <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>{po.status ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Sekce 3 — průběh (bez demo dat; napojení na výrobu později) */}
        <div
          style={{
            paddingTop: 4,
            borderTop: "1px solid #e2e8f0",
          }}
        >
          <div style={{ fontSize: 15, fontWeight: 900, color: "#0f172a", marginBottom: 8 }}>Průběh výroby</div>
          <div style={{ fontSize: 14, color: "#64748b", fontWeight: 600, lineHeight: 1.5 }}>
            Údaj o průběhu zatím není k dispozici z backendu. Po napojení na výrobní data se zde zobrazí stav operací.
          </div>
        </div>

        {/* Související moduly */}
        <div
          style={{
            ...UI.card,
            borderRadius: 14,
            padding: 14,
            border: "1px solid #e2e8f0",
            background: "#fafbfc",
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 900, color: "#0f172a", marginBottom: 10 }}>Související odkazy</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
            {portfolioTechLoading ? (
              <span style={{ fontSize: 13, color: "#64748b", fontWeight: 600 }}>Ověřuji portfolio…</span>
            ) : matchedPortfolioItem ? (
              <>
                <button
                  type="button"
                  style={{
                    ...UI.buttons.primary,
                    ...(!onOpenPortfolioItem ? { opacity: 0.5, cursor: "not-allowed" } : {}),
                  }}
                  disabled={!onOpenPortfolioItem}
                  onClick={() => onOpenPortfolioItem?.(matchedPortfolioItem)}
                >
                  Otevřít portfolio
                </button>
                {onPreviewPortfolioById && portfolioPreviewId != null ? (
                  <button
                    type="button"
                    style={UI.buttons.secondary}
                    onClick={() => onPreviewPortfolioById(portfolioPreviewId)}
                  >
                    Náhled v panelu
                  </button>
                ) : null}
              </>
            ) : onPreviewPortfolioById && portfolioPreviewId != null ? (
              <button
                type="button"
                style={UI.buttons.secondary}
                onClick={() => onPreviewPortfolioById(portfolioPreviewId)}
              >
                Náhled portfolia v panelu
              </button>
            ) : (
              <span style={{ fontSize: 13, color: "#94a3b8", fontWeight: 700 }}>Portfolio nenalezeno</span>
            )}
            <button
              type="button"
              style={{
                ...UI.buttons.secondary,
                opacity: 0.55,
                cursor: "not-allowed",
              }}
              disabled
              title="Modul Sklad výrobků bude v budoucnu propojen odsud."
            >
              Otevřít sklad výrobků
            </button>
          </div>
        </div>

        {/* Lokální podkarty položky — obal kvůli viditelnosti celé řady (globální kontejner má overflow: hidden) */}
        <div
          style={{
            width: "100%",
            overflowX: "auto" as const,
            overflowY: "hidden" as const,
            marginTop: 12,
            marginBottom: 4,
          }}
        >
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
            {SUBTABS.map((tab) => {
              const active = tab === activeTab;
              return (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveTab(tab)}
                  onMouseEnter={() => setHoverTab(tab)}
                  onMouseLeave={() => setHoverTab((h) => (h === tab ? null : h))}
                  style={{
                    ...UI.subTab,
                    ...(active ? UI.subTabActive : {}),
                    ...(!active && hoverTab === tab ? UI.subTabHover : {}),
                  }}
                >
                  {tab}
                </button>
              );
            })}
          </div>
        </div>

        {activeTab === "Technologický postup" ? (
          <>
            <div style={{ ...UI.card, borderRadius: 14, padding: 16 }}>
              {portfolioTechLoading ? (
                <div style={{ ...UI.sectionSubtitle, fontWeight: 600 }}>Načítám technologii z portfolia…</div>
              ) : portfolioTechError ? (
                <div style={{ color: "#b45309", fontWeight: 700, fontSize: 14 }}>{portfolioTechError}</div>
              ) : !matchedPortfolioItem ? (
                <div style={{ fontSize: 14, color: "#475569", fontWeight: 600, lineHeight: 1.5 }}>
                  Pro tuto položku nebyla nalezena odpovídající portfolio položka.
                </div>
              ) : matchedPortfolioItem && portfolioTechnology && portfolioTechnology.template_id != null ? (
                <>
                  <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, marginBottom: 14 }}>
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        padding: "6px 12px",
                        borderRadius: 999,
                        fontSize: 12,
                        fontWeight: 800,
                        background: "#e0f2fe",
                        color: "#0369a1",
                        border: "1px solid #7dd3fc",
                      }}
                    >
                      Technologie z portfolia
                    </span>
                    <span style={{ ...UI.sectionSubtitle, marginBottom: 0 }}>
                      {portfolioTechnology.template_name ?? "Šablona"}
                    </span>
                  </div>
                  {portfolioTechnology.operations.length === 0 ? (
                    <div style={{ ...UI.sectionSubtitle, fontWeight: 600 }}>V šabloně nejsou definované žádné operace.</div>
                  ) : (
                    <div style={{ overflowX: "auto" }}>
                      <table style={UI.table}>
                        <thead>
                          <tr style={{ background: "#f8fafc" }}>
                            {[
                              "Pořadí",
                              "Operace",
                              "Pracoviště",
                              "Setup (min)",
                              "Čas / ks (min)",
                              "Kontrola",
                              "Kooperace",
                              "Poznámka",
                            ].map((h) => (
                              <th key={h} style={{ ...UI.th, fontSize: 13, padding: "10px 10px", whiteSpace: "nowrap" }}>
                                {h}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {portfolioTechnology.operations.map((op) => (
                            <tr key={op.id}>
                              <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap", fontWeight: 800 }}>
                                {op.operation_no}
                              </td>
                              <td style={{ ...UI.td, padding: "10px 10px" }}>{op.operation_name}</td>
                              <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>{op.machine_code ?? "—"}</td>
                              <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>{op.setup_time_min}</td>
                              <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>{op.labor_time_per_piece_min}</td>
                              <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>
                                {op.control_required ? "ANO" : "NE"}
                              </td>
                              <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>
                                {op.outsourcing ? "ANO" : "NE"}
                              </td>
                              <td style={{ ...UI.td, padding: "10px 10px" }}>{op.note ?? "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div style={{ fontSize: 14, color: "#475569", fontWeight: 600, lineHeight: 1.5, marginBottom: 12 }}>
                    Portfolio položka nalezena, ale nemá definovaný technologický postup.
                  </div>
                  <button
                    type="button"
                    style={{ ...UI.buttons.secondary, opacity: 0.65, cursor: "not-allowed" }}
                    disabled
                    title="Propojení s modulem Portfolio bude doplněno."
                  >
                    Otevřít portfolio položku
                  </button>
                </>
              )}
            </div>

            {matchedPortfolioItem && !portfolioTechError ? (
              <div style={{ ...UI.card, borderRadius: 14, padding: 16, marginTop: 4 }}>
                <div style={{ ...UI.sectionTitle, fontSize: 16, marginBottom: 10 }}>Materiálová potřeba</div>
                {materialReserveError ? (
                  <div style={{ color: "#b91c1c", fontWeight: 700, marginBottom: 10 }}>{materialReserveError}</div>
                ) : null}
                {portfolioTechLoading ? (
                  <div style={{ ...UI.sectionSubtitle, fontWeight: 600 }}>Načítám materiálovou potřebu…</div>
                ) : portfolioTechnologyMaterials == null ? (
                  <div style={{ ...UI.sectionSubtitle, color: "#94a3b8", fontWeight: 600 }}>
                    Materiálovou potřebu se nepodařilo načíst.
                  </div>
                ) : portfolioTechnologyMaterials.materials.length === 0 ? (
                  <div style={{ ...UI.sectionSubtitle, color: "#64748b", fontWeight: 600 }}>
                    Technologický postup neobsahuje žádný materiál.
                  </div>
                ) : (
                  <div style={{ overflowX: "auto" }}>
                    <table style={UI.table}>
                      <thead>
                        <tr style={{ background: "#f8fafc" }}>
                          {[
                            "Materiál",
                            "Kód",
                            "Spotřeba / ks",
                            "Prořez / odpad",
                            "Množství položky",
                            "Celková potřeba",
                            "Lokace",
                            "Skladem",
                            "Rezervováno",
                            "Volně k dispozici",
                            "Stav",
                            "Akce",
                          ].map((h) => (
                            <th key={h} style={{ ...UI.th, fontSize: 13, padding: "10px 10px", whiteSpace: "nowrap" }}>
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {portfolioTechnologyMaterials.materials.map((row) => {
                          const perPiece = row.consumption_per_piece ?? 0;
                          const scrap = row.scrap_allowance ?? 0;
                          const unitRow = row.consumption_unit?.trim();
                          const totalRequired = (perPiece + scrap) * itemOrderQuantity;
                          const stav = materialRequirementStatus(row, totalRequired);
                          return (
                            <tr key={row.id}>
                              <td style={{ ...UI.td, padding: "10px 10px", fontWeight: 800 }}>{row.material_name}</td>
                              <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>{row.material_code || "—"}</td>
                              <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>
                                {formatMaterialNumber(row.consumption_per_piece)}
                                {unitRow ? ` ${unitRow}` : ""}
                              </td>
                              <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>
                                {formatMaterialNumber(row.scrap_allowance)}
                                {unitRow ? ` ${unitRow}` : ""}
                              </td>
                              <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>{itemOrderQuantity}</td>
                              <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>
                                {formatMaterialNumber(totalRequired, "0")}
                                {unitRow ? ` ${unitRow}` : ""}
                              </td>
                              <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>{row.stock_location || "—"}</td>
                              <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>
                                {row.stock_current_qty != null ? formatMaterialNumber(row.stock_current_qty) : "—"}
                              </td>
                              <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>
                                {row.stock_reserved_qty != null ? formatMaterialNumber(row.stock_reserved_qty) : "—"}
                              </td>
                              <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>
                                {row.stock_available_qty != null ? formatMaterialNumber(row.stock_available_qty) : "—"}
                              </td>
                              <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap", fontWeight: 800 }}>{stav}</td>
                              <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>
                                {row.stock_item_id != null ? (
                                  <button
                                    type="button"
                                    style={{
                                      ...UI.buttons.secondary,
                                      ...(reservingTpMaterialId === row.id ? { opacity: 0.6, cursor: "wait" } : {}),
                                    }}
                                    disabled={reservingTpMaterialId != null || totalRequired <= 0}
                                    onClick={() => handleReserveTpMaterial(row, totalRequired)}
                                  >
                                    Rezervovat
                                  </button>
                                ) : (
                                  "—"
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ) : null}
          </>
        ) : activeTab === "Výdej materiálu" ? (
          <div style={{ ...UI.card, borderRadius: 14, padding: 16 }}>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, marginBottom: 14 }}>
              <span style={materialIssueStateBadge.style}>{materialIssueStateBadge.label}</span>
              {materialTabUncovered && vpReqForIssue != null && !materialIssueLoading ? (
                <span style={{ fontSize: 13, color: "#b45309", fontWeight: 600 }}>
                  Část materiálu není pokryta skladem.
                </span>
              ) : null}
              {materialTabShowIssueAction && onOpenMaterialRequirements ? (
                <button type="button" style={UI.buttons.primary} onClick={onOpenMaterialRequirements}>
                  Vydat materiál
                </button>
              ) : null}
            </div>
            {materialIssueError ? (
              <div style={{ color: "#b91c1c", fontWeight: 700, marginBottom: 10 }}>{materialIssueError}</div>
            ) : null}
            {materialIssueLoading ? (
              <div style={{ ...UI.sectionSubtitle, fontWeight: 600 }}>Načítám výdeje…</div>
            ) : materialIssueRows.length === 0 ? (
              <div style={{ ...UI.sectionSubtitle, color: "#64748b", fontWeight: 600 }}>
                Zatím žádný záznam výdeje materiálu pro tuto položku / napojené VP.
              </div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={UI.table}>
                  <thead>
                    <tr style={{ background: "#f8fafc" }}>
                      {[
                        "Datum výdeje",
                        "Kód materiálu",
                        "Materiál",
                        "Rozměr",
                        "Vydané množství",
                        "Tavba / šarže",
                        "Skladová karta",
                        "Scan kód pohybu",
                        "VP",
                        "Lokace",
                        "Operátor",
                      ].map((h) => (
                        <th key={h} style={{ ...UI.th, fontSize: 13, padding: "10px 10px", whiteSpace: "nowrap" }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {materialIssueRows.map((row) => (
                      <tr key={row.movement_id}>
                        <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>
                          {row.movement_date
                            ? new Date(row.movement_date).toLocaleString("cs-CZ", {
                                dateStyle: "short",
                                timeStyle: "short",
                              })
                            : "—"}
                        </td>
                        <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>
                          {row.material_code ?? "—"}
                        </td>
                        <td style={{ ...UI.td, padding: "10px 10px" }}>{row.material_name ?? "—"}</td>
                        <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>
                          {row.material_dimension ?? "—"}
                        </td>
                        <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap", fontWeight: 800 }}>
                          {formatMaterialNumber(row.qty, "0")}
                        </td>
                        <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>
                          {row.heat_lot ?? "—"}
                        </td>
                        <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>
                          {row.stock_item_id != null
                            ? `#${row.stock_item_id}${row.stock_scan_code ? ` · ${row.stock_scan_code}` : ""}`
                            : "—"}
                        </td>
                        <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap", fontFamily: "monospace" }}>
                          {row.scan_code ?? "—"}
                        </td>
                        <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>
                          {row.vp_code ?? "—"}
                        </td>
                        <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>
                          {row.stock_location ?? "—"}
                        </td>
                        <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>
                          {row.operator ?? "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : (
          <PlaceholderCard text={`Modul ${activeTab} pro tuto položku je ve vývoji.`} />
        )}
      </div>
    </div>
  );
}
