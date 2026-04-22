import React, { useCallback, useEffect, useMemo, useState } from "react";
import DetailPageHeader from "../components/DetailPageHeader";
import {
  erpDetailKpiLabel,
  erpDetailKpiPanel,
  erpDetailKpiRow,
  erpDetailKpiValue,
  erpDetailRowLabel,
  erpDetailRowValue,
  erpDetailSectionEyebrow,
  erpDetailStateCard,
  UI,
} from "../styles/ui";
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
  getPortfolioItem,
  getPortfolioItems,
  getPortfolioItemTechnology,
  getPortfolioTechnologyMaterials,
  listPortfolioItemsByGpn,
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
  onOpenWorkReportDetail?: (workReportId: number) => void;
};

type ItemSubtab =
  | "Dokumenty"
  | "Technologický postup"
  | "Výrobní příkazy"
  | "Výkazy práce"
  | "Průběh výroby"
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
  "Výrobní příkazy",
  "Výkazy práce",
  "Průběh výroby",
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

function formatItemReportedMin(m: number | null | undefined): string {
  if (m == null || !Number.isFinite(Number(m))) return "—";
  return `${Math.round(Number(m))} min`;
}

function formatItemPct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  return `${Number(v)} %`;
}

function formatItemLaborCzk(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  if (Number(v) === 0) return "0 Kč";
  try {
    return new Intl.NumberFormat("cs-CZ", {
      style: "currency",
      currency: "CZK",
      maximumFractionDigits: 0,
    }).format(Number(v));
  } catch {
    return `${Math.round(Number(v))} Kč`;
  }
}

function formatCompactDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("cs-CZ", { dateStyle: "short", timeStyle: "short" });
}

function formatDurationMinutes(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  return `${Math.round(Number(value))} min`;
}

function asNonEmptyText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function labelAggregatedPhase(phase: string | null | undefined): string {
  const s = String(phase ?? "").trim().toLowerCase();
  if (s === "hotovo") return "Hotovo";
  if (s === "bezi") return "Běží";
  return "Naplánováno";
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
  onOpenMaterialRequirements,
  onOpenWorkReportDetail,
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
    const linkedPortfolioId = detail?.item.portfolio_item_id ?? null;
    const loadMatchedItem = async (): Promise<PortfolioItem | null> => {
      if (effectivePortfolioId != null && Number.isFinite(effectivePortfolioId)) {
        try {
          return await getPortfolioItem(effectivePortfolioId);
        } catch {
          const items = await getPortfolioItems();
          const byId = items.find((x) => x.id === effectivePortfolioId);
          if (byId) return byId;
        }
      }
      if (linkedPortfolioId != null && Number.isFinite(linkedPortfolioId)) {
        try {
          return await getPortfolioItem(linkedPortfolioId);
        } catch {
          const items = await getPortfolioItems();
          const byId = items.find((x) => x.id === linkedPortfolioId);
          if (byId) return byId;
        }
      }
      const variants = await listPortfolioItemsByGpn(gpn);
      if (variants.length === 1) return variants[0];
      return null;
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
  }, [gpnForPortfolio, detail?.item.effective_portfolio_item_id, detail?.item.portfolio_item_id]);

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
    const variants = await listPortfolioItemsByGpn(item.gpn);
    if (variants.length === 1) {
      onOpenPortfolioItem(variants[0]);
      return;
    }
    if (variants.length > 1) {
      window.alert(
        "V portfoliu je více logistických variant se stejným GPN. Otevřete správnou variantu v modulu Portfolio, nebo u řádku navážte konkrétní portfolio položku."
      );
    }
  }

  const linkedPoIdsForMaterialTab = new Set(linkedProductionOrders.map((p) => p.id));
  const materialLinkedVpsForTab =
    vpReqForIssue?.filter(
      (v) => v.job_item_id === jobItemId || linkedPoIdsForMaterialTab.has(v.production_order_id)
    ) ?? [];
  const materialTabHasLines = materialLinkedVpsForTab.some((v) => v.materials.length > 0);
  const materialTabUncovered = materialLinkedVpsForTab.some((v) => v.coverage !== "covered");
  const materialTabShowIssueAction = materialLinkedVpsForTab.some(vpHasPendingMaterialIssue);
  const materialTabAnyMovements = materialIssueRows.length > 0;
  const reportedDurationMin = item.total_duration_min ?? item.reported_time_min;
  const laborCost = item.labor_cost ?? item.direct_labor_cost;
  const hasOkNokTotals = item.total_ok_qty != null || item.total_nok_qty != null;
  const linkedWorkReports = Array.isArray(item.work_reports) ? item.work_reports : [];

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
          actions={
            <>
              <button onClick={onBack} style={UI.buttons.secondary}>
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
          context={
            <div style={erpDetailStateCard}>
              <div style={erpDetailSectionEyebrow}>Identita položky</div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
                  gap: 14,
                }}
              >
                <div>
                  <div style={erpDetailRowLabel}>Zakázka</div>
                  <div style={{ ...erpDetailRowValue, fontWeight: 700 }}>
                    {onOpenCustomerOrderCard ? (
                      <button
                        type="button"
                        className="erp-table-link"
                        style={{
                          ...linkButtonReset,
                          color: UI.colors.textPrimary,
                          fontWeight: 700,
                          fontSize: "inherit",
                          textDecoration: "underline",
                          textUnderlineOffset: 3,
                        }}
                        onClick={() => onOpenCustomerOrderCard(detail.customerOrderId)}
                      >
                        {order.job?.zakazka ?? "—"}
                      </button>
                    ) : (
                      order.job?.zakazka ?? "—"
                    )}
                  </div>
                </div>
                <div>
                  <div style={erpDetailRowLabel}>Řádek</div>
                  <div
                    style={{
                      ...erpDetailRowValue,
                      fontSize: 13,
                      fontWeight: 600,
                      color: UI.colors.textSecondary,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {item.line_no ?? "—"}
                  </div>
                </div>
                <div>
                  <div style={erpDetailRowLabel}>GPN</div>
                  <div>
                    {onOpenPortfolioItem ? (
                      <button
                        type="button"
                        className="erp-table-link"
                        onClick={() => void openPortfolioFromGpn()}
                        title="Otevřít portfolio položku"
                        style={{
                          ...linkButtonReset,
                          fontSize: 16,
                          fontWeight: 900,
                          color: UI.colors.primary,
                          textDecoration: "underline",
                          textUnderlineOffset: 3,
                        }}
                      >
                        {item.gpn}
                      </button>
                    ) : (
                      <span
                        style={{
                          fontSize: 16,
                          fontWeight: 900,
                          color: UI.colors.primary,
                          lineHeight: 1.2,
                        }}
                      >
                        {item.gpn}
                      </span>
                    )}
                  </div>
                </div>
                <div>
                  <div style={erpDetailRowLabel}>Výkres</div>
                  <div style={erpDetailRowValue}>
                    {item.drawing_number?.trim() ? item.drawing_number : "—"}
                  </div>
                </div>
                <div>
                  <div style={erpDetailRowLabel}>Revize</div>
                  <div style={erpDetailRowValue}>
                    {item.drawing_revision?.trim() ? item.drawing_revision : "—"}
                  </div>
                </div>
                <div>
                  <div style={erpDetailRowLabel}>Název</div>
                  <div style={erpDetailRowValue}>
                    {item.description?.trim() ? item.description : "—"}
                  </div>
                </div>
                <div>
                  <div style={erpDetailRowLabel}>Množství</div>
                  <div style={{ ...erpDetailRowValue, fontVariantNumeric: "tabular-nums" }}>
                    {item.qty} ks
                  </div>
                </div>
                <div>
                  <div style={erpDetailRowLabel}>Termín</div>
                  <div style={erpDetailRowValue}>{item.due_date ?? "—"}</div>
                </div>
                <div>
                  <div style={erpDetailRowLabel}>Materiál</div>
                  <div style={erpDetailRowValue}>
                    {item.material_default?.trim() ? item.material_default : "—"}
                  </div>
                </div>
                <div>
                  <div style={erpDetailRowLabel}>Cena / ks</div>
                  <div style={{ ...erpDetailRowValue, fontVariantNumeric: "tabular-nums" }}>
                    {formatCenaZaKs(item.sale_price_per_piece ?? undefined)}
                  </div>
                </div>
              </div>
            </div>
          }
          summaryTiles={
            <div style={erpDetailKpiPanel}>
              <div style={{ ...erpDetailSectionEyebrow, color: UI.colors.neutralFg }}>
                Souhrn položky
              </div>
              <div style={erpDetailKpiRow}>
                <div style={{ minWidth: 0 }}>
                  <div style={erpDetailKpiLabel}>Vykázaný čas</div>
                  <div style={{ ...erpDetailKpiValue, fontVariantNumeric: "tabular-nums" }}>
                    {formatItemReportedMin(reportedDurationMin)}
                  </div>
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={erpDetailKpiLabel}>Náklad práce</div>
                  <div style={{ ...erpDetailKpiValue, fontVariantNumeric: "tabular-nums" }}>
                    {formatItemLaborCzk(laborCost)}
                  </div>
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={erpDetailKpiLabel}>Hotovo</div>
                  <div style={{ ...erpDetailKpiValue, fontVariantNumeric: "tabular-nums" }}>
                    {formatItemPct(item.completion_percent)}
                  </div>
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={erpDetailKpiLabel}>Výkonnost</div>
                  <div style={{ ...erpDetailKpiValue, fontVariantNumeric: "tabular-nums" }}>
                    {formatItemPct(item.performance_percent)}
                  </div>
                </div>
              </div>
              <div
                style={{
                  marginTop: 2,
                  paddingTop: 10,
                  borderTop: `1px solid ${UI.colors.divider}`,
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "baseline",
                  columnGap: 20,
                  rowGap: 6,
                  fontSize: 12.5,
                  color: UI.colors.textSecondary,
                  lineHeight: 1.4,
                }}
              >
                <span style={{ minWidth: 0, display: "inline-flex", alignItems: "baseline", gap: 6 }}>
                  <span
                    style={{
                      textTransform: "uppercase",
                      letterSpacing: 0.5,
                      fontSize: 10.5,
                      fontWeight: 700,
                      color: UI.colors.neutralFg,
                    }}
                  >
                    Souhrn VP:
                  </span>
                  <span style={{ fontWeight: 700, color: UI.colors.textSecondary }}>
                    {item.operational_summary_cs?.trim() ? item.operational_summary_cs : "—"}
                  </span>
                </span>
                <span style={{ minWidth: 0, display: "inline-flex", alignItems: "baseline", gap: 6 }}>
                  <span
                    style={{
                      textTransform: "uppercase",
                      letterSpacing: 0.5,
                      fontSize: 10.5,
                      fontWeight: 700,
                      color: UI.colors.neutralFg,
                    }}
                  >
                    Dominantní fáze:
                  </span>
                  <span style={{ fontWeight: 700, color: UI.colors.textSecondary }}>
                    {labelAggregatedPhase(item.current_phase)}
                  </span>
                </span>
                <span style={{ minWidth: 0, display: "inline-flex", alignItems: "baseline", gap: 6 }}>
                  <span
                    style={{
                      textTransform: "uppercase",
                      letterSpacing: 0.5,
                      fontSize: 10.5,
                      fontWeight: 700,
                      color: UI.colors.neutralFg,
                    }}
                  >
                    Poloha:
                  </span>
                  <span style={{ fontWeight: 700, color: UI.colors.textSecondary }}>
                    {item.current_location?.trim() ? item.current_location : "—"}
                  </span>
                </span>
                {hasOkNokTotals ? (
                  <span style={{ minWidth: 0, display: "inline-flex", alignItems: "baseline", gap: 6 }}>
                    <span
                      style={{
                        textTransform: "uppercase",
                        letterSpacing: 0.5,
                        fontSize: 10.5,
                        fontWeight: 700,
                        color: UI.colors.neutralFg,
                      }}
                    >
                      OK/NOK:
                    </span>
                    <span style={{ fontWeight: 700, color: UI.colors.textSecondary, fontVariantNumeric: "tabular-nums" }}>
                      {item.total_ok_qty ?? 0} / {item.total_nok_qty ?? 0}
                    </span>
                  </span>
                ) : null}
              </div>
            </div>
          }
        />

        {orderKind === "customer" ? (
          <div style={{ ...UI.card, borderRadius: 14, padding: 16 }}>
            <div style={{ ...erpDetailSectionEyebrow, marginBottom: 2 }}>Sekce</div>
            <div style={{ ...UI.sectionTitle, fontSize: 16, marginBottom: 10 }}>Pokrytí položky</div>
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
              <div style={{ ...erpDetailSectionEyebrow, marginBottom: 2 }}>Sekce</div>
              <div style={{ ...UI.sectionTitle, fontSize: 16, marginBottom: 12 }}>Technologický postup</div>
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
                <div style={{ ...erpDetailSectionEyebrow, marginBottom: 2 }}>Sekce</div>
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
        ) : activeTab === "Výrobní příkazy" ? (
          <div style={{ ...UI.card, borderRadius: 14, padding: 16 }}>
            <div style={{ ...erpDetailSectionEyebrow, marginBottom: 2 }}>Sekce</div>
            <div style={{ ...UI.sectionTitle, fontSize: 16, marginBottom: 10 }}>Výrobní příkazy</div>
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
                            className="erp-table-link"
                            disabled={!onOpenProductionOrderDetail}
                            onClick={() => onOpenProductionOrderDetail?.(po.id)}
                            style={{
                              ...linkButtonReset,
                              color: "#15803d",
                              fontWeight: 900,
                            }}
                            title={onOpenProductionOrderDetail ? "Otevřít detail výrobního příkazu" : undefined}
                          >
                            {po.vp_code}
                          </button>
                        </td>
                        <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>
                          {po.source_type ?? "—"}
                        </td>
                        <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>
                          {po.logistic_mode ?? "—"}
                        </td>
                        <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>{po.quantity} ks</td>
                        <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>{po.status ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : activeTab === "Výkazy práce" ? (
          <div style={{ ...UI.card, borderRadius: 14, padding: 16 }}>
            <div style={{ ...erpDetailSectionEyebrow, marginBottom: 2 }}>Sekce</div>
            <div style={{ ...UI.sectionTitle, fontSize: 16, marginBottom: 10 }}>Výkazy práce</div>
            {linkedWorkReports.length === 0 ? (
              <div style={{ fontSize: 14, color: "#64748b", fontWeight: 600 }}>
                K této položce zatím nejsou navázané žádné výkazy práce.
              </div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={UI.table}>
                  <thead>
                    <tr style={{ background: "#f8fafc" }}>
                      {[
                        "Kód",
                        "Začátek",
                        "Konec",
                        "Trvání",
                        "Zaměstnanec",
                        "VP",
                        "Operace",
                        "OK",
                        "NOK",
                        "Zdroj",
                      ].map((h) => (
                        <th key={h} style={{ ...UI.th, fontSize: 13, padding: "10px 10px", whiteSpace: "nowrap" }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {linkedWorkReports.map((wr) => {
                      if (!wr || typeof wr !== "object") return null;
                      const wrCode = asNonEmptyText(wr.code) ?? `#${wr.id}`;
                      const wrPoCode = asNonEmptyText(wr.production_order_code);
                      const linkedPo = wrPoCode
                        ? linkedProductionOrders.find((candidate) => candidate.vp_code === wrPoCode)
                        : undefined;
                      const operationLabel = asNonEmptyText(wr.operation_label);
                      const employee = asNonEmptyText(wr.employee) ?? "—";
                      const sourceLabel = asNonEmptyText(wr.source) ?? "—";
                      return (
                        <tr key={wr.id}>
                          <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap", fontWeight: 800 }}>
                            {onOpenWorkReportDetail ? (
                              <button
                                type="button"
                                className="erp-table-link"
                                onClick={() => onOpenWorkReportDetail(wr.id)}
                                style={{ ...linkButtonReset, fontWeight: 900 }}
                                title="Otevřít detail výkazu práce"
                              >
                                {wrCode}
                              </button>
                            ) : (
                              wrCode
                            )}
                          </td>
                          <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>
                            {formatCompactDateTime(wr.started_at)}
                          </td>
                          <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>
                            {formatCompactDateTime(wr.ended_at)}
                          </td>
                          <td
                            style={{
                              ...UI.td,
                              padding: "10px 10px",
                              whiteSpace: "nowrap",
                              fontVariantNumeric: "tabular-nums",
                            }}
                          >
                            {formatDurationMinutes(wr.duration_min)}
                          </td>
                          <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>{employee}</td>
                          <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap", fontWeight: 800 }}>
                            {wrPoCode && onOpenProductionOrderDetail && linkedPo ? (
                              <button
                                type="button"
                                className="erp-table-link"
                                onClick={() => onOpenProductionOrderDetail(linkedPo.id)}
                                style={{ ...linkButtonReset, color: "#15803d", fontWeight: 900 }}
                                title="Otevřít detail výrobního příkazu"
                              >
                                {wrPoCode}
                              </button>
                            ) : (
                              (wrPoCode ?? "—")
                            )}
                          </td>
                          <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>
                            {wr.operation_no != null || operationLabel
                              ? [wr.operation_no, operationLabel]
                                  .filter((v) => v != null && v !== "")
                                  .join(" · ")
                              : "—"}
                          </td>
                          <td
                            style={{
                              ...UI.td,
                              padding: "10px 10px",
                              whiteSpace: "nowrap",
                              fontVariantNumeric: "tabular-nums",
                            }}
                          >
                            {wr.ok_qty ?? "—"}
                          </td>
                          <td
                            style={{
                              ...UI.td,
                              padding: "10px 10px",
                              whiteSpace: "nowrap",
                              fontVariantNumeric: "tabular-nums",
                            }}
                          >
                            {wr.nok_qty ?? "—"}
                          </td>
                          <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>{sourceLabel}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : activeTab === "Průběh výroby" ? (
          <div style={{ ...UI.card, borderRadius: 14, padding: 16 }}>
            <div style={{ ...erpDetailSectionEyebrow, marginBottom: 2 }}>Sekce</div>
            <div style={{ ...UI.sectionTitle, fontSize: 16, marginBottom: 10 }}>Průběh výroby</div>
            <div style={{ fontSize: 14, color: "#64748b", fontWeight: 600, lineHeight: 1.5 }}>
              Údaj o průběhu zatím není k dispozici z backendu. Po napojení na výrobní data se zde zobrazí stav
              operací.
            </div>
          </div>
        ) : activeTab === "Výdej materiálu" ? (
          <div style={{ ...UI.card, borderRadius: 14, padding: 16 }}>
            <div style={{ ...erpDetailSectionEyebrow, marginBottom: 2 }}>Sekce</div>
            <div style={{ ...UI.sectionTitle, fontSize: 16, marginBottom: 10 }}>Výdej materiálu</div>
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
