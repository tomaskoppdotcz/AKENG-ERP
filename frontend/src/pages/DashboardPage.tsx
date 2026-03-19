import React from "react";
import { UI } from "../styles/ui";

type SummaryCard = {
  label: string;
  value: string;
  subValue?: string;
  percentage?: string;
};

type DashboardSection = {
  title: string;
  items: string[];
};

const SUMMARY_CARDS: SummaryCard[] = [
  { label: "Rozpracované zakázky", value: "18" },
  { label: "Dnes po termínu", value: "3" },
  { label: "Čeká na materiál", value: "7" },
  { label: "Ve výrobě", value: "24" },
  { label: "Hotovo dnes", value: "11" },
  {
    label: "Včera odvedeno",
    value: "1240",
    subValue: "1100",
    percentage: "113",
  },
];

const SECTIONS: DashboardSection[] = [
  {
    title: "Upozornění",
    items: [
      "Zakázka ZAK260015 po termínu",
      "Chybí materiál pro 3 položky",
      "Přetížení pracoviště CLX 450 TC",
    ],
  },
  {
    title: "Připomínky",
    items: ["Zavolat dodavateli materiálu", "Připravit technologii pro novou zakázku"],
  },
  {
    title: "Dnes ve výrobě",
    items: ["VP260021 – Soustružení – běží", "VP260022 – Frézování – čeká"],
  },
];

function SummaryCardView({ card }: { card: SummaryCard }) {
  return (
    <div style={{ ...UI.card, padding: 18, borderRadius: 14 }}>
      <div style={{ fontSize: 13, fontWeight: 900, color: "#334155" }}>{card.label}</div>
      {card.label === "Včera odvedeno" ? (
        <>
          <div style={{ marginTop: 10, fontSize: 12, fontWeight: 900, color: "#64748b" }}>
            Odvedeno
          </div>
          <div style={{ marginTop: 6, fontSize: 30, fontWeight: 1000, color: "#0f172a" }}>
            {card.value} <span style={{ fontSize: 14, fontWeight: 900, color: "#64748b" }}>min</span>
          </div>

          <div style={{ marginTop: 10, display: "grid", gap: 6 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 900, color: "#334155" }}>Plán</div>
              <div style={{ fontSize: 12, fontWeight: 1000, color: "#0f172a" }}>
                {card.subValue} <span style={{ fontSize: 12, fontWeight: 900, color: "#64748b" }}>min</span>
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 900, color: "#334155" }}>Plnění</div>
              <div style={{ fontSize: 12, fontWeight: 1000, color: "#0f172a" }}>{card.percentage} %</div>
            </div>
          </div>
        </>
      ) : (
        <>
          <div style={{ marginTop: 10, fontSize: 30, fontWeight: 1000, color: "#0f172a" }}>{card.value}</div>
          <div style={{ marginTop: 6, fontSize: 12, color: "#64748b" }}>Demo hodnoty</div>
        </>
      )}
    </div>
  );
}

function DashboardSectionView({ section }: { section: DashboardSection }) {
  return (
    <div style={{ ...UI.card, padding: 16, borderRadius: 14 }}>
      <div style={{ fontSize: 16, fontWeight: 1000, color: "#0f172a", marginBottom: 10 }}>{section.title}</div>
      <div style={{ display: "grid", gap: 10 }}>
        {section.items.map((item) => (
          <div
            key={item}
            style={{
              background: "#fff",
              border: "1px solid #e5e7eb",
              borderRadius: 12,
              padding: "10px 12px",
              color: "#0f172a",
              fontSize: 13,
              fontWeight: 900,
              lineHeight: 1.25,
            }}
          >
            {item}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <div style={{ paddingTop: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div>
          <div style={UI.sectionTitle}>Nástěnka</div>
          <div style={UI.sectionSubtitle}>Profesionální přehled aktuálního stavu výroby.</div>
        </div>
      </div>

      <div style={{ marginTop: 18, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
        {SUMMARY_CARDS.map((card) => (
          <SummaryCardView key={card.label} card={card} />
        ))}
      </div>

      <div style={{ marginTop: 16 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 12 }}>
          {SECTIONS.map((section) => (
            <DashboardSectionView key={section.title} section={section} />
          ))}
        </div>
      </div>
    </div>
  );
}

