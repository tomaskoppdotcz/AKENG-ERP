import React, { useEffect, useMemo, useState } from "react";
import PageContainer from "../components/layout/PageContainer";
import PageHeader from "../components/layout/PageHeader";
import PageSection from "../components/layout/PageSection";
import { UI } from "../styles/ui";
import {
  getJobItems,
  getJobs,
  getProductionOrders,
  type ErpWorkflowListFilter,
  type OrdersOverviewOrderTypeFilter,
  type ProductionOrderRow,
} from "../services/ordersApi";
import OverviewPrimaryFilterRow from "../components/overview/OverviewPrimaryFilterRow";
import { OVERVIEW_ORDER_TYPE_OPTIONS, OVERVIEW_WORKFLOW_OPTIONS } from "../overview/overviewFilterConfig";
import { buildErpUrl } from "../utils/erpDeepLink";

type DrawingItem = {
  zakazka: string;
  job_item_id: number;
  job_id: number;
  customer_order_id: number | null;
  portfolio_item_id: number | null;
  line_no: number | null;
  gpn: string;
  popis: string;
  material: string;
  mnozstvi: string;
  termin: string;
  vp: string;
  vpLinks: Array<{ id: number; vp_code: string }>;
  stav: string;
  order_type: string;
  faze_vyroby: string;
  postup: string;
};

function rowWorkflowActive(itemWf: string | null | undefined, orderWf: string | null | undefined): boolean {
  const ok = (s: string | null | undefined) => {
    const v = String(s ?? "").trim().toLowerCase();
    return !v || v === "active";
  };
  return ok(itemWf) && ok(orderWf);
}

type Props = {
  onBackToDashboard?: () => void;
  onOpenItemDetail?: (jobItemId: number, source: "drawings") => void;
  onOpenItemInWorkspaceTab?: (jobItemId: number, source: "drawings") => void;
  onOpenPortfolioSearch?: (gpn: string) => void;
  onOpenPortfolioItemId?: (portfolioItemId: number) => void;
  onOpenPortfolioInWorkspaceTab?: (portfolioItemId: number) => void;
  onOpenProductionOrderDetail?: (productionOrderId: number) => void;
  onOpenProductionOrderInWorkspaceTab?: (productionOrderId: number, vpCode?: string) => void;
  onOpenCustomerOrderCard?: (customerOrderId: number) => void;
  onOpenCustomerOrderInWorkspaceTab?: (customerOrderId: number, zakazkaLabel?: string) => void;
  onPreviewPortfolioById?: (portfolioItemId: number) => void;
  onPreviewProductionOrderById?: (productionOrderId: number) => void;
};

const linkBtn: React.CSSProperties = {
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

const SUBTABS = [
  "Přehled",
  "Dokumenty",
  "Historie",
  "Výkazy",
  "Neshody",
  "Zmetky",
  "Reklamace",
  "Technologie",
  "Expedice",
  "Náklady",
] as const;
type DrawingsSubtab = (typeof SUBTABS)[number];

const FILTERS = ["Po termínu", "Dokončená", "Dodací list", "Fakturováno"] as const;
type DrawingFilter = (typeof FILTERS)[number];

function formatVpCodes(codes: string[]): string {
  const cleaned = codes.map((c) => c.trim()).filter((c) => c.length > 0);
  if (cleaned.length === 0) return "—";
  if (cleaned.length <= 2) return cleaned.join(", ");
  return `${cleaned[0]}, ${cleaned[1]} +${cleaned.length - 2}`;
}

/** VP typy navázané na řádek zakázky (včetně interního doplnění skladu). */
const VP_SOURCE_FOR_DRAWINGS_ROW = new Set(["stock_allocation", "order_allocation", "restock_allocation"]);

export default function DrawingsPage({
  onBackToDashboard,
  onOpenItemDetail,
  onOpenItemInWorkspaceTab,
  onOpenPortfolioSearch,
  onOpenPortfolioItemId,
  onOpenPortfolioInWorkspaceTab,
  onOpenProductionOrderDetail,
  onOpenProductionOrderInWorkspaceTab,
  onOpenCustomerOrderCard,
  onOpenCustomerOrderInWorkspaceTab,
  onPreviewPortfolioById,
  onPreviewProductionOrderById,
}: Props) {
  const [activeSubtab, setActiveSubtab] = useState<DrawingsSubtab>("Přehled");
  const [hoverSubtab, setHoverSubtab] = useState<DrawingsSubtab | null>(null);
  const [activeFilters, setActiveFilters] = useState<DrawingFilter[]>([]);
  const [hoveredRow, setHoveredRow] = useState<number | null>(null);
  const [rows, setRows] = useState<DrawingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [workflowListFilter, setWorkflowListFilter] = useState<ErpWorkflowListFilter>("active");
  const [overviewOrderType, setOverviewOrderType] = useState<OrdersOverviewOrderTypeFilter>("all");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([getJobItems(workflowListFilter), getJobs(), getProductionOrders(workflowListFilter)])
      .then(([jobItems, jobs, productionOrders]) => {
        if (cancelled) return;
        const jobById = new Map(jobs.map((j) => [j.id, j]));
        const vpByItemId = new Map<number, ProductionOrderRow[]>();
        for (const vp of productionOrders) {
          const st = String(vp.source_type ?? "").trim();
          if (!VP_SOURCE_FOR_DRAWINGS_ROW.has(st)) {
            continue;
          }
          const arr = vpByItemId.get(vp.job_item_id) ?? [];
          arr.push(vp);
          vpByItemId.set(vp.job_item_id, arr);
        }
        const mapped: DrawingItem[] = jobItems.map((row) => {
          const job = jobById.get(row.job_id);
          const rawLineNo = row.line_no;
          const normalizedLineNo =
            typeof rawLineNo === "number" && Number.isFinite(rawLineNo) ? rawLineNo : null;
          const vpRowsAll = vpByItemId.get(row.id) ?? [];
          const poWfActive = (ws: string | null | undefined) => {
            const t = String(ws ?? "").trim().toLowerCase();
            return !t || t === "active";
          };
          const vpRows =
            workflowListFilter === "all"
              ? vpRowsAll
              : vpRowsAll.filter((v) =>
                  workflowListFilter === "active" ? poWfActive(v.workflow_status) : !poWfActive(v.workflow_status)
                );
          const cancelledRow = !rowWorkflowActive(row.workflow_status, row.order_workflow_status);
          const otRaw = String(row.order_type ?? "customer").trim().toLowerCase();
          return {
            zakazka: job?.zak_code ?? "—",
            job_item_id: row.id,
            job_id: row.job_id,
            customer_order_id: job?.customer_order_id ?? null,
            portfolio_item_id: row.portfolio_item_id ?? null,
            line_no: normalizedLineNo,
            gpn: row.gpn,
            popis: row.description?.trim() ? row.description : "—",
            material: "—",
            mnozstvi: `${row.qty} ks`,
            termin: row.due_date ?? "—",
            vp: formatVpCodes(vpRows.map((v) => v.vp_code)),
            vpLinks: vpRows.map((v) => ({ id: v.id, vp_code: v.vp_code })),
            stav: cancelledRow ? "Storno" : "—",
            order_type: otRaw === "internal" ? "internal" : "customer",
            faze_vyroby: (row.production_phase_label ?? "—").trim() || "—",
            postup: (row.production_progress_label ?? "—").trim() || "—",
          };
        });
        setRows(mapped);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Nepodařilo se načíst výkresy.");
        setRows([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [workflowListFilter]);

  const rowsByOrderType = useMemo(() => {
    if (overviewOrderType === "all") return rows;
    return rows.filter((r) =>
      overviewOrderType === "internal" ? r.order_type === "internal" : r.order_type === "customer"
    );
  }, [rows, overviewOrderType]);

  const filteredRows = useMemo(() => {
    return rowsByOrderType.filter((row) => {
      const done = row.stav === "Hotovo";
      const late = row.termin !== "—" && row.termin < new Date().toISOString().slice(0, 10);
      const hasDelivery = row.line_no != null && row.line_no % 2 === 0;
      const invoiced = done && row.vp !== "—";

      const matchesFilters = activeFilters.every((f) => {
        if (f === "Po termínu") return late;
        if (f === "Dokončená") return done;
        if (f === "Dodací list") return hasDelivery;
        if (f === "Fakturováno") return invoiced;
        return true;
      });

      return matchesFilters;
    });
  }, [rowsByOrderType, activeFilters]);

  const kpi = useMemo(() => {
    const celkemPolozek = rows.length;
    const celkemKusu = rows.reduce((sum, row) => {
      const qty = Number.parseInt(row.mnozstvi.replace(" ks", "").trim(), 10) || 0;
      return sum + qty;
    }, 0);
    const aktivniPolozky = rows.filter((row) => row.stav !== "Hotovo" && row.stav !== "Storno").length;
    const poTerminu = rows.filter((row) => row.termin !== "—" && row.termin < new Date().toISOString().slice(0, 10)).length;
    const kExpedici = rows.filter((row) => row.stav === "Hotovo").length;

    return [
      { label: "Celkem položek", value: String(celkemPolozek) },
      { label: "Celkem kusů", value: `${celkemKusu} ks` },
      { label: "Aktivní položky", value: String(aktivniPolozky) },
      { label: "Po termínu", value: String(poTerminu) },
      { label: "K expedici", value: String(kExpedici) },
    ] as const;
  }, [rows]);

  return (
    <PageContainer style={{ paddingTop: 10 }}>
      <PageHeader
        title="Výkresy"
        subtitle="Položky zákaznických i interních zakázek (GPN / řádky); VP včetně doplnění skladu (restock)."
        actions={
          <button type="button" style={UI.buttons.secondary} onClick={() => onBackToDashboard?.()}>
            Zpět na nástěnku
          </button>
        }
      />

      <div style={UI.summaryTilesGridOuter}>
        <div style={UI.summaryTilesGridSix}>
          {kpi.map((k) => (
            <div key={k.label} style={UI.summaryTile}>
              <div style={UI.summaryTileLabel}>{k.label}</div>
              <div style={UI.summaryTileValue}>{k.value}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ width: "100%", overflowX: "auto" }}>
        <div
          style={{
            ...UI.subTabsContainer,
            overflow: "visible",
            width: "max-content",
            minWidth: "100%",
            justifyContent: "flex-start",
          }}
        >
          {SUBTABS.map((tab) => {
            const active = tab === activeSubtab;
            return (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveSubtab(tab)}
                onMouseEnter={() => setHoverSubtab(tab)}
                onMouseLeave={() => setHoverSubtab((h) => (h === tab ? null : h))}
                style={{
                  ...UI.subTab,
                  ...(active ? UI.subTabActive : {}),
                  ...(!active && hoverSubtab === tab ? UI.subTabHover : {}),
                }}
              >
                {tab}
              </button>
            );
          })}
        </div>
      </div>

      {activeSubtab === "Přehled" ? (
        <PageSection gapTop={16}>
          <div
            style={{
              ...UI.card,
              padding: 0,
              borderRadius: 14,
              width: "100%",
              boxSizing: "border-box",
              overflow: "hidden",
            }}
          >
            <div style={{ padding: 16, paddingBottom: 14, borderBottom: "1px solid #e2e8f0" }}>
              <OverviewPrimaryFilterRow
                loading={loading}
                typPrehleduOptions={OVERVIEW_ORDER_TYPE_OPTIONS}
                typPrehleduActiveId={overviewOrderType}
                onTypPrehledu={(id) => setOverviewOrderType(id as OrdersOverviewOrderTypeFilter)}
                stavZakazkyOptions={OVERVIEW_WORKFLOW_OPTIONS}
                stavZakazkyActiveId={workflowListFilter}
                onStavZakazky={(id) => setWorkflowListFilter(id as ErpWorkflowListFilter)}
                rowStyle={{ marginBottom: 0 }}
                trailing={
                  <>
                    {FILTERS.map((filter) => {
                      const active = activeFilters.includes(filter);
                      return (
                        <button
                          key={filter}
                          type="button"
                          onClick={() =>
                            setActiveFilters((prev) =>
                              prev.includes(filter) ? prev.filter((f) => f !== filter) : [...prev, filter]
                            )
                          }
                          style={{ ...UI.ordersFilterChip, ...(active ? UI.ordersFilterChipActive : {}) }}
                        >
                          {filter}
                        </button>
                      );
                    })}
                  </>
                }
              />
            </div>

            <div style={{ padding: 16 }}>
            {loading ? <div style={UI.sectionSubtitle}>Načítám výkresy…</div> : null}
            {error ? <div style={{ color: "#b91c1c", fontWeight: 700, marginBottom: 10 }}>{error}</div> : null}
            {!loading && !error && rows.length === 0 ? (
              <div
                style={{
                  textAlign: "center",
                  color: "#64748b",
                  fontWeight: 700,
                  padding: "24px 12px",
                  border: "1px solid #e2e8f0",
                  borderRadius: 12,
                  background: "#f8fafc",
                }}
              >
                Žádné položky v tomto režimu. Zkuste „Vše“ nebo „Stornované“, případně vytvořte zakázku a řádky v modulu Zakázky.
              </div>
            ) : null}

            {!loading && !error && rows.length > 0 ? (
            <div style={{ overflowX: "auto" }}>
              <table style={UI.table}>
                <thead>
                  <tr style={{ background: "#f8fafc" }}>
                    {[
                      "Zakázka",
                      "Řádek",
                      "GPN",
                      "Popis",
                      "Materiál",
                      "Množství",
                      "Termín",
                      "Fáze výroby",
                      "Postup",
                      "VP",
                      "Stav",
                      "Nové okno",
                    ].map((h) => (
                      <th key={h} style={{ ...UI.th, fontSize: 13, padding: "10px 10px", whiteSpace: "nowrap" }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((row) => (
                    <tr
                      key={`${row.zakazka}-${row.job_item_id}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => {
                        if (onOpenItemInWorkspaceTab) onOpenItemInWorkspaceTab(row.job_item_id, "drawings");
                        else onOpenItemDetail?.(row.job_item_id, "drawings");
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          if (onOpenItemInWorkspaceTab) onOpenItemInWorkspaceTab(row.job_item_id, "drawings");
                          else onOpenItemDetail?.(row.job_item_id, "drawings");
                        }
                      }}
                      onMouseEnter={() => setHoveredRow(row.job_item_id)}
                      onMouseLeave={() => setHoveredRow((id) => (id === row.job_item_id ? null : id))}
                      style={{
                        cursor: "pointer",
                        background: hoveredRow === row.job_item_id ? "#eff6ff" : "#fff",
                      }}
                    >
                      <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }} onClick={(e) => e.stopPropagation()}>
                        {row.customer_order_id != null && (onOpenCustomerOrderInWorkspaceTab || onOpenCustomerOrderCard) ? (
                          <button
                            type="button"
                            style={{ ...linkBtn, fontWeight: 900, color: "#0f172a" }}
                            onClick={() => {
                              const id = row.customer_order_id!;
                              if (onOpenCustomerOrderInWorkspaceTab) onOpenCustomerOrderInWorkspaceTab(id, row.zakazka);
                              else onOpenCustomerOrderCard?.(id);
                            }}
                          >
                            {row.zakazka}
                          </button>
                        ) : (
                          <span style={{ fontWeight: 900 }}>{row.zakazka}</span>
                        )}
                      </td>
                      <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>
                        {row.line_no ?? "—"}
                      </td>
                      <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }} onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          style={{ ...linkBtn, fontWeight: 800 }}
                          onClick={() => {
                            if (row.portfolio_item_id != null && onOpenPortfolioInWorkspaceTab) {
                              onOpenPortfolioInWorkspaceTab(row.portfolio_item_id);
                              return;
                            }
                            if (row.portfolio_item_id != null && onOpenPortfolioItemId) {
                              onOpenPortfolioItemId(row.portfolio_item_id);
                              return;
                            }
                            onOpenPortfolioSearch?.(row.gpn);
                          }}
                        >
                          {row.gpn}
                        </button>
                        {row.portfolio_item_id != null && onPreviewPortfolioById ? (
                          <button
                            type="button"
                            style={{ ...UI.buttons.secondary, marginLeft: 8, padding: "2px 8px", fontSize: 11 }}
                            onClick={() => onPreviewPortfolioById(row.portfolio_item_id!)}
                          >
                            Náhled
                          </button>
                        ) : null}
                      </td>
                      <td style={{ ...UI.td, padding: "10px 10px" }}>{row.popis}</td>
                      <td style={{ ...UI.td, padding: "10px 10px" }}>{row.material}</td>
                      <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>{row.mnozstvi}</td>
                      <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>{row.termin}</td>
                      <td style={{ ...UI.td, padding: "10px 10px", maxWidth: 220, fontSize: 12, fontWeight: 600, color: "#334155" }}>
                        {row.faze_vyroby}
                      </td>
                      <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap", fontWeight: 700, color: "#475569" }}>
                        {row.postup}
                      </td>
                      <td
                        style={{ ...UI.td, padding: "10px 10px", color: row.vp !== "—" ? "#15803d" : "#64748b", fontWeight: 700 }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {row.vpLinks.length > 0 ? (
                          <span style={{ display: "inline-flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                            {row.vpLinks.map((vp, i) => (
                              <span key={vp.id} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                                {i > 0 ? <span style={{ color: "#94a3b8" }}>·</span> : null}
                                <button
                                  type="button"
                                  style={{ ...linkBtn, color: "#15803d", fontWeight: 800 }}
                                  disabled={!onOpenProductionOrderDetail && !onOpenProductionOrderInWorkspaceTab}
                                  onClick={() => {
                                    if (onOpenProductionOrderInWorkspaceTab) {
                                      onOpenProductionOrderInWorkspaceTab(vp.id, vp.vp_code);
                                    } else {
                                      onOpenProductionOrderDetail?.(vp.id);
                                    }
                                  }}
                                >
                                  {vp.vp_code}
                                </button>
                                {onPreviewProductionOrderById ? (
                                  <button
                                    type="button"
                                    style={{ ...UI.buttons.secondary, padding: "2px 6px", fontSize: 11 }}
                                    onClick={() => onPreviewProductionOrderById(vp.id)}
                                  >
                                    Náhled
                                  </button>
                                ) : null}
                              </span>
                            ))}
                          </span>
                        ) : (
                          row.vp
                        )}
                      </td>
                      <td
                        style={{
                          ...UI.td,
                          padding: "10px 10px",
                          whiteSpace: "nowrap",
                          fontWeight: 900,
                          color: row.stav === "Storno" ? "#991b1b" : undefined,
                        }}
                      >
                        {row.stav}
                      </td>
                      <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }} onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          style={{ ...UI.buttons.secondary, padding: "4px 8px", fontSize: 12 }}
                          onClick={() =>
                            window.open(buildErpUrl({ view: "orderItem", jobItemId: row.job_item_id, source: "drawings" }), "_blank")
                          }
                        >
                          Nové okno
                        </button>
                      </td>
                    </tr>
                  ))}
                  {filteredRows.length === 0 ? (
                    <tr>
                      <td colSpan={12} style={{ ...UI.td, textAlign: "center", color: "#64748b", padding: "14px 10px" }}>
                        Žádné výsledky.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            ) : null}
            </div>
          </div>
        </PageSection>
      ) : (
        <PageSection gapTop={16}>
          <div
            style={{
              ...UI.card,
              padding: 16,
              borderRadius: 14,
              width: "100%",
              boxSizing: "border-box",
            }}
          >
            <div style={{ ...UI.sectionTitle, fontSize: 16, marginBottom: 0, fontWeight: 900 }}>
              {`Modul ${activeSubtab} pro výkresy je ve vývoji.`}
            </div>
          </div>
        </PageSection>
      )}
    </PageContainer>
  );
}
