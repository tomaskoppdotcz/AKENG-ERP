import React, { useMemo, useState } from "react";
import { UI } from "../styles/ui";

type Props = {
  customerOrderId?: number;
  jobItemId?: number;
  onBack?: () => void;
};

type ItemSubtab =
  | "Technologický postup"
  | "Dokumenty"
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
  "Technologický postup",
  "Dokumenty",
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

export default function OrderItemDetailPage({ customerOrderId, jobItemId, onBack }: Props) {
  const [activeTab, setActiveTab] = useState<ItemSubtab>("Technologický postup");
  const [hoverTab, setHoverTab] = useState<ItemSubtab | null>(null);
  const data = useMemo(() => getDemoItemDetail(customerOrderId, jobItemId), [customerOrderId, jobItemId]);

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
          <button onClick={() => onBack?.()} style={UI.buttonSecondary}>
            Zpět na zakázku
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
            <p style={{ ...UI.headerSubtitle, marginTop: 8, marginBottom: 0, maxWidth: 720 }}>{data.popis}</p>
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

        {/* Sekce 2 — kompaktní řádek údajů */}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap" as const,
            gap: 24,
            alignItems: "flex-start",
            paddingTop: 4,
            borderTop: "1px solid #e2e8f0",
          }}
        >
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
            <div key={label} style={{ minWidth: 100, maxWidth: 280 }}>
              <div style={{ ...UI.statLabel, fontSize: 11, fontWeight: 800, marginBottom: 4 }}>{label}</div>
              <div style={{ ...UI.statValue, fontSize: 14, lineHeight: 1.3 }}>{value}</div>
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

        <div style={UI.subTabsContainer}>
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

        {activeTab === "Technologický postup" ? (
          <PlaceholderCard text="Zatím nejsou definovány žádné operace." />
        ) : (
          <PlaceholderCard text={`Modul ${activeTab} pro tuto položku je ve vývoji.`} />
        )}
      </div>
    </div>
  );
}
