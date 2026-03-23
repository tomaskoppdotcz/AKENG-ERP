import React, { useEffect, useMemo, useState } from "react";
import { UI } from "../styles/ui";
import {
  findPortfolioItemByGpn,
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

type DemoItemDetail = {
  customerOrderId: number;
  jobItemId: number;
  zakazka: string;
  lineNo: number;
  gpn: string;
  popis: string;
  vp: string;
  stav: string;
  progressPct: number;
  operationsDone: number;
  operationsTotal: number;
  mnozstvi: string;
  termin: string;
  material: string;
  cenaZaKs: string;
  stavVyroby: string;
};

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

const DEFAULT_DEMO_ITEM: DemoItemDetail = {
  customerOrderId: 260061,
  jobItemId: 2010,
  zakazka: "ZAK260061",
  lineNo: 10,
  gpn: "102-045-772",
  popis: "Převlečná objímka (duplex) – zinkování",
  vp: "VP260030",
  stav: "Ve výrobě",
  progressPct: 60,
  operationsDone: 3,
  operationsTotal: 5,
  mnozstvi: "120 ks",
  termin: "2026-03-15",
  material: "Ocel 11 353.1 – pozink (Z-12)",
  cenaZaKs: "28 450 Kč/ks",
  stavVyroby: "Rozpracováno",
};

function displayStav(stav: string): string {
  if (stav === "Běží") return "Ve výrobě";
  return stav;
}

/** Parsuje množství z řetězce typu "120 ks" (detail položky). */
function parseItemQuantity(mnozstvi: string): number {
  const m = mnozstvi.trim().match(/^([\d.,]+)/);
  if (!m) return 1;
  const n = Number(m[1].replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : 1;
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
  const onHand = row.stock_current_qty ?? 0;
  return onHand >= totalRequired ? "Dostatek" : "Nedostatek";
}

function getDemoItemDetail(customerOrderId?: number, jobItemId?: number): DemoItemDetail {
  const safeCustomerOrderId = customerOrderId ?? DEFAULT_DEMO_ITEM.customerOrderId;
  const safeJobItemId = jobItemId ?? DEFAULT_DEMO_ITEM.jobItemId;

  // Demo values mapped to the same job_item_id used in OrderCardPage.
  switch (safeJobItemId) {
    case 2010:
      return {
        ...DEFAULT_DEMO_ITEM,
        customerOrderId: safeCustomerOrderId,
        zakazka: `ZAK${safeCustomerOrderId}`,
        lineNo: 10,
        progressPct: 30,
        operationsDone: 0,
        operationsTotal: 5,
        mnozstvi: "120 ks",
        termin: "2026-03-15",
        material: "Ocel 11 353.1 – pozink (Z-12)",
        cenaZaKs: "28 450 Kč/ks",
        stav: "Plán",
        stavVyroby: "Naplánováno",
      };
    case 2020:
      return {
        ...DEFAULT_DEMO_ITEM,
        customerOrderId: safeCustomerOrderId,
        zakazka: `ZAK${safeCustomerOrderId}`,
        jobItemId: 2020,
        lineNo: 20,
        gpn: "107-118-504",
        popis: "Distanční kroužek (ring) – nitridace",
        vp: "—",
        stav: "Běží",
        progressPct: 60,
        operationsDone: 3,
        operationsTotal: 5,
        mnozstvi: "80 ks",
        termin: "2026-03-16",
        material: "Legovaná ocel – nitridace (N-09)",
        cenaZaKs: "19 900 Kč/ks",
        stavVyroby: "Probíhá",
      };
    case 2030:
      return {
        ...DEFAULT_DEMO_ITEM,
        customerOrderId: safeCustomerOrderId,
        zakazka: `ZAK${safeCustomerOrderId}`,
        jobItemId: 2030,
        lineNo: 30,
        gpn: "114-030-919",
        popis: "Těleso spojky (sleeve) – broušení",
        vp: "VP260031",
        stav: "Hotovo",
        progressPct: 80,
        operationsDone: 4,
        operationsTotal: 5,
        mnozstvi: "55 ks",
        termin: "2026-03-18",
        material: "Ocel 16 111 – broušení (B-03)",
        cenaZaKs: "24 650 Kč/ks",
        stavVyroby: "Těsně před dokončením",
      };
    case 2040:
      return {
        ...DEFAULT_DEMO_ITEM,
        customerOrderId: safeCustomerOrderId,
        zakazka: `ZAK${safeCustomerOrderId}`,
        jobItemId: 2040,
        lineNo: 40,
        gpn: "119-207-633",
        popis: "Vratný kroužek (ring) – povrch AlMg",
        vp: "—",
        stav: "Plán",
        progressPct: 20,
        operationsDone: 1,
        operationsTotal: 5,
        mnozstvi: "140 ks",
        termin: "2026-03-20",
        material: "Ocel 15 120 – povrch AlMg (A-17)",
        cenaZaKs: "15 750 Kč/ks",
        stavVyroby: "Rozpracováno",
      };
    case 2050:
      return {
        ...DEFAULT_DEMO_ITEM,
        customerOrderId: safeCustomerOrderId,
        zakazka: `ZAK${safeCustomerOrderId}`,
        jobItemId: 2050,
        lineNo: 50,
        gpn: "121-090-281",
        popis: "Spojovací pouzdro (duplex) – finální kontrola",
        vp: "VP260032",
        stav: "Hotovo",
        progressPct: 100,
        operationsDone: 5,
        operationsTotal: 5,
        mnozstvi: "36 ks",
        termin: "2026-03-21",
        material: "Ocel 11 460 – finální kontrola (K-02)",
        cenaZaKs: "31 200 Kč/ks",
        stavVyroby: "Dokončeno",
      };
    default:
      return {
        ...DEFAULT_DEMO_ITEM,
        customerOrderId: safeCustomerOrderId,
        zakazka: `ZAK${safeCustomerOrderId}`,
        jobItemId: safeJobItemId,
      };
  }
}

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
  const data = useMemo(() => getDemoItemDetail(undefined, jobItemId), [jobItemId]);

  const [matchedPortfolioItem, setMatchedPortfolioItem] = useState<PortfolioItem | null>(null);
  const [portfolioTechnology, setPortfolioTechnology] = useState<PortfolioItemTechnologyResponse | null>(null);
  const [portfolioTechnologyMaterials, setPortfolioTechnologyMaterials] =
    useState<PortfolioItemTechnologyMaterialsResponse | null>(null);
  const [portfolioTechLoading, setPortfolioTechLoading] = useState(false);
  const [portfolioTechError, setPortfolioTechError] = useState<string | null>(null);

  useEffect(() => {
    const gpn = data.gpn.trim();
    let cancelled = false;
    setPortfolioTechError(null);
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
    findPortfolioItemByGpn(gpn)
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
  }, [data.gpn]);

  const itemOrderQuantity = useMemo(() => parseItemQuantity(data.mnozstvi), [data.mnozstvi]);

  const progressLabel = useMemo(
    () => `Hotovo: ${data.operationsDone} / ${data.operationsTotal} operací`,
    [data.operationsDone, data.operationsTotal]
  );

  const stavLabel = displayStav(data.stav);
  const stavBadgeStyle =
    stavLabel === "Hotovo"
      ? { background: "#dcfce7", color: "#15803d", border: "1px solid #86efac" }
      : stavLabel === "Ve výrobě"
        ? { background: "#dbeafe", color: "#1d4ed8", border: "1px solid #93c5fd" }
        : { background: "#f1f5f9", color: "#475569", border: "1px solid #cbd5e1" };

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
              {data.gpn}
            </h1>
            <p style={{ ...UI.headerSubtitle, marginTop: 8, marginBottom: 0, maxWidth: 720 }}>
              {source === "drawings" ? "Detail položky napříč zakázkami" : data.popis}
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
                ...(data.vp && data.vp !== "—"
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
              VP: {data.vp}
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
              ["Zakázka", data.zakazka],
              ["Řádek", String(data.lineNo)],
              ["Množství", data.mnozstvi],
              ["Termín", data.termin],
              ["Materiál", data.material],
              ["Cena / ks", data.cenaZaKs],
            ] as const
          ).map(([label, value]) => (
            <div key={label} style={{ ...UI.summaryTile, flex: "1 1 200px", minWidth: 160, maxWidth: "100%" }}>
              <div style={UI.summaryTileLabel}>{label}</div>
              <div style={UI.summaryTileValue}>{value}</div>
            </div>
          ))}
        </div>

        {/* Sekce 3 — průběh */}
        <div
          style={{
            paddingTop: 4,
            borderTop: "1px solid #e2e8f0",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 16,
              marginBottom: 10,
            }}
          >
            <div style={{ fontSize: 15, fontWeight: 900, color: "#0f172a" }}>Průběh výroby</div>
            <div style={{ fontSize: 28, fontWeight: 900, color: "#16a34a", lineHeight: 1 }}>{data.progressPct} %</div>
          </div>
          <div
            style={{
              width: "100%",
              height: 12,
              background: "#e2e8f0",
              borderRadius: 999,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: `${data.progressPct}%`,
                height: "100%",
                background: "#16a34a",
                borderRadius: 999,
              }}
            />
          </div>
          <div style={{ fontSize: 13, color: "#64748b", fontWeight: 700, marginTop: 8 }}>{progressLabel}</div>
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
                            "Stav",
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
                              <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap", fontWeight: 800 }}>{stav}</td>
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
