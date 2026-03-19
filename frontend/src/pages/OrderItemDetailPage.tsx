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

function SummaryTile({
  title,
  value,
  accent,
}: {
  title: string;
  value: string;
  accent?: string;
}) {
  return (
    <div style={UI.summaryTile}>
      <div style={UI.summaryTileLabel}>{title}</div>
      <div style={{ ...UI.summaryTileValue, color: accent || UI.summaryTileValue.color }}>
        {value}
      </div>
    </div>
  );
}

export default function OrderItemDetailPage({ customerOrderId, jobItemId, onBack }: Props) {
  const [activeTab, setActiveTab] = useState<ItemSubtab>("Technologický postup");
  const data = useMemo(() => getDemoItemDetail(customerOrderId, jobItemId), [customerOrderId, jobItemId]);

  const progressLabel = useMemo(
    () => `Hotovo: ${data.operationsDone} / ${data.operationsTotal} operací`,
    [data.operationsDone, data.operationsTotal]
  );

  return (
    <div style={UI.container}>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <div>
            <h1 style={UI.headerTitle}>{data.gpn}</h1>
            <p style={UI.headerSubtitle}>{data.popis}</p>
          </div>

          <button onClick={() => onBack?.()} style={UI.buttonSecondary}>
            Zpět na zakázku
          </button>
        </div>

        <div style={UI.card}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: 16,
              alignItems: "start",
            }}
          >
            <div style={UI.summaryTile}>
              <div style={UI.summaryTileLabel}>Zakázka</div>
              <div style={UI.summaryTileValue}>{data.zakazka}</div>
            </div>

            <div style={UI.summaryTile}>
              <div style={UI.summaryTileLabel}>Řádek</div>
              <div style={UI.summaryTileValue}>{data.lineNo}</div>
            </div>

            <div style={UI.summaryTile}>
              <div style={UI.summaryTileLabel}>GPN</div>
              <div style={UI.summaryTileValue}>{data.gpn}</div>
            </div>

            <div style={UI.summaryTile}>
              <div style={UI.summaryTileLabel}>VP</div>
              <div style={UI.summaryTileValue}>{data.vp}</div>
            </div>

            <div style={UI.summaryTile}>
              <div style={UI.summaryTileLabel}>Stav</div>
              <div style={UI.summaryTileValue}>{data.stav}</div>
            </div>
          </div>

          <div style={{ marginTop: 18 }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                gap: 12,
                marginBottom: 14,
              }}
            >
              <SummaryTile title="Množství" value={data.mnozstvi} />
              <SummaryTile title="Termín" value={data.termin} />
              <SummaryTile title="Materiál" value={data.material} />
              <SummaryTile title="Cena / ks" value={data.cenaZaKs} />
              <SummaryTile title="Stav výroby" value={data.stavVyroby} />
            </div>

            <div style={{ ...UI.card, padding: 16, background: "#f8fafc" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                <div>
                  <div style={{ fontSize: 13, color: "#64748b", fontWeight: 700 }}>Průběh výroby</div>
                  <div style={{ fontSize: 16, fontWeight: 800, color: "#0f172a", marginTop: 4 }}>
                    {progressLabel}
                  </div>
                </div>
                <div style={{ fontSize: 24, fontWeight: 900, color: "#16a34a" }}>{data.progressPct} %</div>
              </div>

              <div
                style={{
                  marginTop: 12,
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
            </div>
          </div>
        </div>

        <div style={UI.subNavigation}>
          {SUBTABS.map((tab) => {
            const active = tab === activeTab;
            return (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                style={{
                  ...UI.subNavigationTab,
                  ...(active ? UI.subNavigationTabActive : {}),
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
