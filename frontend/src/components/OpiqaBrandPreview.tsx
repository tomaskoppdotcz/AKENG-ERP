import React from "react";
import {
  OPIQA,
  OPIQA_COLORS,
  OPIQA_COMPONENTS,
  opiqaDarkKpiCard,
  opiqaGlassPanel,
  opiqaGradient,
  opiqaLightKpiCard,
} from "../styles/opiqaui";

/**
 * Izolovaný náhled OPIQA tokenů (pilot). Neovlivňuje business logiku ani globální shell.
 */
export default function OpiqaBrandPreview() {
  return (
    <section
      style={{
        marginTop: 16,
        padding: 16,
        borderRadius: OPIQA.radius.panel,
        ...opiqaGlassPanel({ variant: "light" }),
        fontFamily: OPIQA.typography.fontFamily,
      }}
    >
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div>
          <div
            style={{
              fontSize: 11,
              fontWeight: 900,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: OPIQA_COLORS.textMuted,
            }}
          >
            OPIQA Design System · v1 pilot
          </div>
          <div
            style={{
              marginTop: 6,
              fontSize: 20,
              fontWeight: 1000,
              letterSpacing: "-0.02em",
              backgroundImage: OPIQA.brand.primaryGradientCss,
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              color: "transparent",
            }}
          >
            {OPIQA.brand.name}
          </div>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <span style={{ ...OPIQA_COMPONENTS.statusBadge, fontFamily: OPIQA.typography.fontFamily }}>Tokeny</span>
          <button type="button" style={{ ...OPIQA_COMPONENTS.actionButton, ...opiqaGradient(125) }}>
            Akce
          </button>
          <button type="button" style={{ ...OPIQA_COMPONENTS.dangerAction }}>Nebezpečná</button>
        </div>
      </div>

      <div
        style={{
          marginTop: 14,
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: 12,
        }}
      >
        <div style={{ ...opiqaLightKpiCard({ padding: 14 }) }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: OPIQA_COLORS.textMuted }}>KPI (light)</div>
          <div style={{ marginTop: 8, fontSize: 22, fontWeight: 1000 }}>42</div>
          <div style={{ marginTop: 4, fontSize: 12, color: OPIQA_COLORS.textMuted }}>Manufacturing SaaS</div>
        </div>
        <div style={{ ...opiqaDarkKpiCard({ padding: 14 }) }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(255,255,255,0.55)" }}>KPI (dark)</div>
          <div style={{ marginTop: 8, fontSize: 22, fontWeight: 1000 }}>18</div>
          <div style={{ marginTop: 4, fontSize: 12, color: "rgba(255,255,255,0.55)" }}>Cockpit panel</div>
        </div>
        <div style={{ ...OPIQA_COMPONENTS.cockpitPanel, padding: 14, fontFamily: OPIQA.typography.fontFamily }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(255,255,255,0.55)" }}>Sklo (dark)</div>
          <div
            style={{
              marginTop: 10,
              padding: 12,
              borderRadius: OPIQA.radius.card,
              ...opiqaGlassPanel({ variant: "dark" }),
              color: "rgba(255,255,255,0.9)",
              fontSize: 13,
            }}
          >
            Gradient: purple → blue → cyan
          </div>
        </div>
      </div>

      <div style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        {(
          [
            ["success", OPIQA_COLORS.success],
            ["warning", OPIQA_COLORS.warning],
            ["danger", OPIQA_COLORS.danger],
            ["cyan", OPIQA_COLORS.accentCyan],
          ] as const
        ).map(([label, hex]) => (
          <span
            key={label}
            style={{
              fontSize: 11,
              fontWeight: 800,
              padding: "4px 8px",
              borderRadius: 8,
              background: `${hex}22`,
              color: hex,
              border: `1px solid ${hex}44`,
            }}
          >
            {label}
          </span>
        ))}
      </div>
    </section>
  );
}
