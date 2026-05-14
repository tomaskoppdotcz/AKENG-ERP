import type { CSSProperties } from "react";

/**
 * OPIQA Design System v1 — design tokeny a stylové helpery.
 * Neslouží k přepnutí celé aplikace; importujte podle potřeby na stránkách / komponentách.
 */

export const OPIQA_COLORS = {
  darkBg: "#070B16",
  darkPanel: "#0E1628",
  darkPanelSoft: "#121C31",
  darkBorder: "rgba(255,255,255,0.08)",
  accentBlue: "#2563EB",
  accentPurple: "#7C3AED",
  accentCyan: "#22D3EE",
  success: "#22C55E",
  warning: "#F59E0B",
  danger: "#EF4444",
  lightBg: "#F6F8FC",
  lightPanel: "#FFFFFF",
  textPrimary: "#0F172A",
  textMuted: "#64748B",
} as const;

export const OPIQA_RADIUS = {
  card: 18,
  panel: 22,
  button: 12,
} as const;

export const OPIQA_SHADOW = {
  /** Světlý „SaaS“ stín karet na light pozadí */
  cardSoft: "0 10px 40px rgba(15, 23, 42, 0.08), 0 2px 8px rgba(15, 23, 42, 0.04)",
  /** Hlubší stín pro tmavé panely / cockpit */
  cockpitDark: "0 24px 80px rgba(0, 0, 0, 0.55), inset 0 1px 0 rgba(255,255,255,0.06)",
} as const;

/** Stejný stack jako `ErpAppShell` — žádné externí fonty. */
export const OPIQA_FONT_STACK = "Arial, Helvetica, sans-serif" as const;

export const OPIQA_TYPOGRAPHY = {
  fontFamily: OPIQA_FONT_STACK,
  pageTitle: { fontSize: 24, fontWeight: 1000, letterSpacing: "-0.02em", lineHeight: 1.2 } satisfies CSSProperties,
  sectionLabel: { fontSize: 11, fontWeight: 900, letterSpacing: "0.08em", textTransform: "uppercase" as const },
  body: { fontSize: 14, fontWeight: 600, lineHeight: 1.45 },
  caption: { fontSize: 12, fontWeight: 600, lineHeight: 1.35 },
} as const;

export const OPIQA_BRAND = {
  name: "OPIQA",
  /** Purple → blue gradient (vibe) */
  primaryGradientCss: `linear-gradient(135deg, ${OPIQA_COLORS.accentPurple} 0%, ${OPIQA_COLORS.accentBlue} 52%, ${OPIQA_COLORS.accentCyan} 100%)`,
  darkBackground: OPIQA_COLORS.darkBg,
  lightBackground: OPIQA_COLORS.lightBg,
} as const;

export const OPIQA_COMPONENTS = {
  kpiCardLight: {
    background: OPIQA_COLORS.lightPanel,
    border: `1px solid rgba(15, 23, 42, 0.08)`,
    borderRadius: OPIQA_RADIUS.card,
    boxShadow: OPIQA_SHADOW.cardSoft,
    color: OPIQA_COLORS.textPrimary,
  } satisfies CSSProperties,

  kpiCardDark: {
    background: `linear-gradient(160deg, ${OPIQA_COLORS.darkPanel} 0%, ${OPIQA_COLORS.darkPanelSoft} 100%)`,
    border: `1px solid ${OPIQA_COLORS.darkBorder}`,
    borderRadius: OPIQA_RADIUS.card,
    boxShadow: OPIQA_SHADOW.cockpitDark,
    color: "rgba(255,255,255,0.92)",
  } satisfies CSSProperties,

  cockpitPanel: {
    background: OPIQA_COLORS.darkPanel,
    border: `1px solid ${OPIQA_COLORS.darkBorder}`,
    borderRadius: OPIQA_RADIUS.panel,
    boxShadow: OPIQA_SHADOW.cockpitDark,
  } satisfies CSSProperties,

  actionButton: {
    borderRadius: OPIQA_RADIUS.button,
    padding: "10px 16px",
    fontWeight: 800,
    fontSize: 13,
    border: "none",
    cursor: "pointer",
    color: "#fff",
    background: OPIQA_COLORS.accentBlue,
  } satisfies CSSProperties,

  dangerAction: {
    borderRadius: OPIQA_RADIUS.button,
    padding: "10px 16px",
    fontWeight: 800,
    fontSize: 13,
    border: `1px solid rgba(239, 68, 68, 0.45)`,
    cursor: "pointer",
    color: "#fff",
    background: `linear-gradient(180deg, ${OPIQA_COLORS.danger} 0%, #b91c1c 100%)`,
  } satisfies CSSProperties,

  statusBadge: {
    display: "inline-flex",
    alignItems: "center",
    padding: "4px 10px",
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 900,
    letterSpacing: "0.04em",
    textTransform: "uppercase" as const,
    border: `1px solid ${OPIQA_COLORS.darkBorder}`,
    background: "rgba(255,255,255,0.06)",
    color: "rgba(255,255,255,0.88)",
  } satisfies CSSProperties,

  navItemDark: {
    borderRadius: 10,
    padding: "8px 12px",
    color: "rgba(255,255,255,0.88)",
    background: "transparent",
    border: "none",
    cursor: "pointer",
    fontWeight: 700,
    fontSize: 13,
  } satisfies CSSProperties,

  tableRowHover: {
    background: "rgba(37, 99, 235, 0.06)",
  } satisfies CSSProperties,

  tableRowSelected: {
    background: "rgba(124, 58, 237, 0.12)",
    boxShadow: `inset 3px 0 0 0 ${OPIQA_COLORS.accentPurple}`,
  } satisfies CSSProperties,
} as const;

/** Seskupený export pro budoucí kroky redesignu. */
export const OPIQA = {
  brand: OPIQA_BRAND,
  colors: OPIQA_COLORS,
  radius: OPIQA_RADIUS,
  shadow: OPIQA_SHADOW,
  typography: OPIQA_TYPOGRAPHY,
  components: OPIQA_COMPONENTS,
} as const;

export function opiqaGradient(angleDeg = 135): CSSProperties {
  return {
    backgroundImage: `linear-gradient(${angleDeg}deg, ${OPIQA_COLORS.accentPurple} 0%, ${OPIQA_COLORS.accentBlue} 55%, ${OPIQA_COLORS.accentCyan} 100%)`,
  };
}

export function opiqaGlassPanel(opts?: { variant?: "light" | "dark" }): CSSProperties {
  const v = opts?.variant ?? "light";
  if (v === "dark") {
    return {
      background: "rgba(14, 22, 40, 0.55)",
      backdropFilter: "blur(14px)",
      WebkitBackdropFilter: "blur(14px)",
      border: `1px solid ${OPIQA_COLORS.darkBorder}`,
      borderRadius: OPIQA_RADIUS.panel,
      boxShadow: OPIQA_SHADOW.cockpitDark,
    };
  }
  return {
    background: "rgba(255,255,255,0.72)",
    backdropFilter: "blur(12px)",
    WebkitBackdropFilter: "blur(12px)",
    border: "1px solid rgba(15, 23, 42, 0.08)",
    borderRadius: OPIQA_RADIUS.panel,
    boxShadow: OPIQA_SHADOW.cardSoft,
  };
}

export function opiqaDarkKpiCard(extra?: CSSProperties): CSSProperties {
  return { ...OPIQA_COMPONENTS.kpiCardDark, fontFamily: OPIQA_FONT_STACK, ...extra };
}

export function opiqaLightKpiCard(extra?: CSSProperties): CSSProperties {
  return { ...OPIQA_COMPONENTS.kpiCardLight, fontFamily: OPIQA_FONT_STACK, ...extra };
}
