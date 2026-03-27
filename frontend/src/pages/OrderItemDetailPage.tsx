import React, { useCallback, useEffect, useMemo, useState } from "react";
import { UI } from "../styles/ui";
import { createMaterialReservation } from "../services/materialStockApi";
import {
  getJobItemDetailContext,
  type OrderDetailItem,
  type OrderDetailResponse,
} from "../services/ordersApi";
import {
  findPortfolioItemByGpn,
  getPortfolioItems,
  getPortfolioItemTechnology,
  getPortfolioTechnologyMaterials,
  type PortfolioItem,
  type PortfolioItemTechnologyMaterialsResponse,
  type PortfolioItemTechnologyResponse,
  type PortfolioTechnologyMaterial,
} from "../services/portfolioApi";

type Props = {
  jobItemId: number;
  source: "orders" | "drawings";
  onBack: () => void;
  /** Otevře detail portfolio položky (např. z GPN shody). */
  onOpenPortfolioItem?: (item: PortfolioItem) => void;
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

export default function OrderItemDetailPage({ jobItemId, source, onBack, onOpenPortfolioItem }: Props) {
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

  return (
    <div style={UI.container}>
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <div>
          <button onClick={onBack} style={UI.buttonSecondary}>
            {source === "orders" ? "Zpět na zakázku" : "Zpět na výkresy"}
          </button>
        </div>

        {/* Sekce 1 — hlavička */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 24,
            flexWrap: "wrap" as const,
          }}
        >
          <div style={{ minWidth: 0, flex: "1 1 280px" }}>
            <h1
              style={{
                margin: 0,
                fontSize: 30,
                fontWeight: 900,
                color: "#0f172a",
                lineHeight: 1.2,
                letterSpacing: "-0.02em",
              }}
            >
              {item.gpn}
            </h1>
            <p style={{ ...UI.headerSubtitle, marginTop: 8, marginBottom: 0, maxWidth: 720 }}>
              {source === "drawings" ? "Detail položky napříč zakázkami" : item.description ?? "—"}
            </p>
          </div>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap" as const,
              gap: 8,
              justifyContent: "flex-end",
              alignItems: "center",
            }}
          >
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                padding: "6px 12px",
                borderRadius: 999,
                fontSize: 12,
                fontWeight: 800,
                ...(vpLabel && vpLabel !== "—"
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
              VP: {vpLabel}
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
          </div>
        </div>

        {/* Sekce 2 — údaje jako executive dlaždice (stejný systém jako Zakázky / karta) */}
        <div style={UI.summaryTilesGrid}>
          {(
            [
              ["Zakázka", order.job?.zakazka ?? "—"],
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
                      <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap", fontWeight: 800 }}>{po.vp_code}</td>
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
        ) : (
          <PlaceholderCard text={`Modul ${activeTab} pro tuto položku je ve vývoji.`} />
        )}
      </div>
    </div>
  );
}
