import React, { useMemo } from "react";
import { UI } from "../styles/ui";

type Props = {
  customerOrderId: number;
  onBack: () => void;
  onOpenItemDetail: (item: DemoOrderItem) => void;
};

type DemoOrderItem = {
  job_item_id: number;
  line_no: number;
  gpn: string;
  description: string;
  material: string;
  qty: string;
  pricePerPiece: string;
  due_date: string;
  vp_code?: string | null;
  stav: string;
};

type DemoOrderDetail = {
  zakazka: string;
  zakaznik: string;
  objednavka: string;
  datum: string;
  items: DemoOrderItem[];
};

// Demo data only (UI skeleton)
const DEMO_ORDER_ITEMS: DemoOrderItem[] = [
  {
    job_item_id: 2010,
    line_no: 10,
    gpn: "102-045-772",
    description: "Převlečná objímka (duplex) – zinkování",
    material: "Ocel 11 353.1 – pozink (Z-12)",
    qty: "120 ks",
    pricePerPiece: "28 450 Kč/ks",
    due_date: "2026-03-15",
    vp_code: "VP260030",
    stav: "Hotovo",
  },
  {
    job_item_id: 2020,
    line_no: 20,
    gpn: "107-118-504",
    description: "Distanční kroužek (ring) – nitridace",
    material: "Legovaná ocel – nitridace (N-09)",
    qty: "80 ks",
    pricePerPiece: "19 900 Kč/ks",
    due_date: "2026-03-16",
    vp_code: null,
    stav: "Čeká",
  },
  {
    job_item_id: 2030,
    line_no: 30,
    gpn: "114-030-919",
    description: "Těleso spojky (sleeve) – broušení",
    material: "Ocel 16 111 – broušení (B-03)",
    qty: "55 ks",
    pricePerPiece: "24 650 Kč/ks",
    due_date: "2026-03-18",
    vp_code: "VP260031",
    stav: "Připraveno",
  },
  {
    job_item_id: 2040,
    line_no: 40,
    gpn: "119-207-633",
    description: "Vratný kroužek (ring) – povrch AlMg",
    material: "Ocel 15 120 – povrch AlMg (A-17)",
    qty: "140 ks",
    pricePerPiece: "15 750 Kč/ks",
    due_date: "2026-03-20",
    vp_code: null,
    stav: "Čeká",
  },
  {
    job_item_id: 2050,
    line_no: 50,
    gpn: "121-090-281",
    description: "Spojovací pouzdro (duplex) – finální kontrola",
    material: "Ocel 11 460 – finální kontrola (K-02)",
    qty: "36 ks",
    pricePerPiece: "31 200 Kč/ks",
    due_date: "2026-03-21",
    vp_code: "VP260032",
    stav: "Hotovo",
  },
];

const DEMO_ORDER_META: Record<number, Pick<DemoOrderDetail, "zakaznik" | "objednavka" | "datum">> = {
  260061: {
    zakaznik: "KovoTech CZ s.r.o.",
    objednavka: "OBJ-2026-061",
    datum: "2026-03-10",
  },
  260060: {
    zakaznik: "Strojírny BETA a.s.",
    objednavka: "OBJ-2026-060",
    datum: "2026-03-09",
  },
  260059: {
    zakaznik: "Výroba ALFA s.r.o.",
    objednavka: "OBJ-2026-059",
    datum: "2026-03-07",
  },
  260058: {
    zakaznik: "Průmyslové díly GAMMA, a.s.",
    objednavka: "OBJ-2026-058",
    datum: "2026-03-06",
  },
  260057: {
    zakaznik: "TECHNIKA Delta s.r.o.",
    objednavka: "OBJ-2026-057",
    datum: "2026-03-04",
  },
};

function getDemoOrder(customerOrderId: number): DemoOrderDetail {
  const meta = DEMO_ORDER_META[customerOrderId] ?? {
    zakaznik: "Demo zákazník, s.r.o.",
    objednavka: `OBJ-2026-${customerOrderId}`,
    datum: "2026-03-01",
  };

  return {
    zakazka: `ZAK${customerOrderId}`,
    zakaznik: meta.zakaznik,
    objednavka: meta.objednavka,
    datum: meta.datum,
    items: DEMO_ORDER_ITEMS,
  };
}

export default function OrderCardPage({ customerOrderId, onBack, onOpenItemDetail }: Props) {
  const data = useMemo(() => getDemoOrder(customerOrderId), [customerOrderId]);

  const hotovoPolozky = data.items.filter((i) => i.stav === "Hotovo").length;
  const nehotovoPolozky = data.items.length - hotovoPolozky;

  return (
    <div style={{ paddingTop: 10 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
          <div>
            <div style={UI.pageTitle}>Karta zakázky</div>
            <div style={UI.sectionSubtitle}>Detail zakázky a její položky</div>
          </div>

          <button type="button" onClick={onBack} style={UI.buttons.secondary}>
            Zpět na přehled
          </button>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "stretch" }}>
          <div style={{ ...UI.summaryTile, minWidth: 220, flex: "1 1 220px" }}>
            <div style={UI.summaryTileLabel}>Zakázka</div>
            <div style={UI.summaryTileValue}>{data.zakazka}</div>
          </div>

          <div style={{ ...UI.summaryTile, minWidth: 220, flex: "1 1 220px" }}>
            <div style={UI.summaryTileLabel}>Zákazník</div>
            <div style={UI.summaryTileValue}>{data.zakaznik}</div>
          </div>

          <div style={{ ...UI.summaryTile, minWidth: 220, flex: "1 1 220px" }}>
            <div style={UI.summaryTileLabel}>Objednávka</div>
            <div style={UI.summaryTileValue}>{data.objednavka}</div>
          </div>

          <div style={{ ...UI.summaryTile, minWidth: 190, flex: "1 1 190px" }}>
            <div style={UI.summaryTileLabel}>Datum</div>
            <div style={UI.summaryTileValue}>{data.datum}</div>
          </div>

          <div
            style={{
              ...UI.summaryTile,
              minWidth: 240,
              flex: "1 1 240px",
              borderColor: "#e5e7eb",
              background: "#f8fafc",
              justifyContent: "space-between",
            }}
          >
            <div style={UI.summaryTileLabel}>Stav položek</div>
            <div style={{ display: "grid", gap: 10 }}>
              <div>
                <div style={UI.summaryTileSubValue}>Hotovo položek</div>
                <div style={UI.summaryTileValueHotovo}>{hotovoPolozky}</div>
              </div>
              <div>
                <div style={UI.summaryTileSubValue}>Nehotovo položek</div>
                <div style={UI.summaryTileValueNehotovo}>{nehotovoPolozky}</div>
              </div>
            </div>
          </div>
        </div>

        <div style={{ ...UI.card, borderRadius: 14, padding: 16 }}>
          <div style={{ fontSize: 16, fontWeight: 1000, color: "#0f172a", marginBottom: 10 }}>Položky zakázky</div>

          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "#f8fafc" }}>
                  {[
                    "Řádek",
                    "GPN",
                    "Popis",
                    "Materiál",
                    "Množství",
                    "Cena za kus",
                    "Termín",
                    "VP",
                    "Stav",
                    "Akce",
                  ].map((h) => (
                    <th
                      key={h}
                      style={{
                        ...UI.th,
                        fontSize: 13,
                        padding: "10px 10px",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.items.map((item) => (
                  <tr key={item.job_item_id}>
                    <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap", borderBottom: "1px solid #f1f5f9" }}>{item.line_no}</td>
                    <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap", borderBottom: "1px solid #f1f5f9", fontWeight: 800 }}>{item.gpn}</td>
                    <td style={{ ...UI.td, padding: "10px 10px", borderBottom: "1px solid #f1f5f9" }}>{item.description}</td>
                    <td style={{ ...UI.td, padding: "10px 10px", borderBottom: "1px solid #f1f5f9" }}>{item.material}</td>
                    <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap", borderBottom: "1px solid #f1f5f9" }}>{item.qty}</td>
                    <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap", borderBottom: "1px solid #f1f5f9", fontWeight: 900, color: "#0f172a" }}>{item.pricePerPiece}</td>
                    <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap", borderBottom: "1px solid #f1f5f9" }}>{item.due_date}</td>
                    <td
                      style={{
                        ...UI.td,
                        padding: "10px 10px",
                        whiteSpace: "nowrap",
                        borderBottom: "1px solid #f1f5f9",
                        fontWeight: 700,
                        color: item.vp_code ? "#15803d" : "#64748b",
                      }}
                    >
                      {item.vp_code ?? "-"}
                    </td>
                    <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap", borderBottom: "1px solid #f1f5f9", fontWeight: 900, color: "#0f172a" }}>{item.stav}</td>
                    <td
                      style={{
                        ...UI.td,
                        padding: "10px 10px",
                        whiteSpace: "nowrap",
                        borderBottom: "1px solid #f1f5f9",
                        display: "flex",
                        gap: 6,
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => onOpenItemDetail(item)}
                        style={{
                          border: "1px solid #0f172a",
                          background: "#0f172a",
                          color: "#fff",
                          borderRadius: 8,
                          padding: "5px 8px",
                          fontSize: 12,
                          fontWeight: 700,
                          cursor: "pointer",
                        }}
                      >
                        Otevřít
                      </button>

                      {!item.vp_code ? (
                        <button
                          type="button"
                          onClick={() => {}}
                          style={{
                            border: "1px solid #15803d",
                            background: "#15803d",
                            color: "#fff",
                            borderRadius: 8,
                            padding: "5px 8px",
                            fontSize: 12,
                            fontWeight: 700,
                            cursor: "pointer",
                          }}
                        >
                          Vytvořit VP
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
