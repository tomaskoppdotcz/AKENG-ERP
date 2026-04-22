import type React from "react";

/**
 * AKENG ERP — kanonické barvy pro přehledy a karty (2026).
 * Používejte `UI.colors.*` nebo přímo tokeny z `ERP_COLORS` pro konzistenci napříč moduly.
 */
export const ERP_COLORS = {
  pageBg: "#F6F8FA",
  card: "#FFFFFF",
  border: "#E5E7EB",
  divider: "#EEF1F4",
  textPrimary: "#0F172A",
  textSecondary: "#64748B",
  primary: "#2563EB",
  primaryHover: "#1D4ED8",
  primaryLight: "#DBEAFE",
  runningFg: "#2563EB",
  runningBg: "#DBEAFE",
  okFg: "#16A34A",
  okBg: "#DCFCE7",
  waitFg: "#F59E0B",
  waitBg: "#FEF3C7",
  problemFg: "#DC2626",
  problemBg: "#FEE2E2",
  neutralFg: "#94A3B8",
  neutralBg: "#F1F5F9",
  /** Hlavičky tabulek / pás filtrů — o chlup světlejší než dřívější #F8FAFC. */
  tableHeadBg: "#F9FAFB",
  tableHeadText: "#475569",
} as const;

export const UI = {
  colors: ERP_COLORS,

  // Global visual system
  appBackground: ERP_COLORS.pageBg,

  /** Celá šířka workspace — bez max-width / centrování (obsah řídí ErpAppShell padding). */
  pageContainer: {
    width: "100%",
    maxWidth: "none",
    margin: 0,
    padding: 0,
    boxSizing: "border-box" as const,
    minWidth: 0,
  },

  // Main layout container (legacy — prefer `pageContainer`)
  mainContainer: {
    width: "100%",
    maxWidth: "none",
    margin: 0,
    padding: 0,
    boxSizing: "border-box" as const,
    minWidth: 0,
  },

  // Backwards-compatible alias — nyní také plná šířka; stránky si přidávají karty / sekce
  container: {
    width: "100%",
    maxWidth: "none",
    margin: 0,
    padding: 0,
    boxSizing: "border-box" as const,
    minWidth: 0,
  },

  /** Mezery mezi hlavními bloky stránky (pod hlavičkou, mezi kartami). */
  pageSection: {
    marginTop: 16,
    width: "100%",
    minWidth: 0,
  },

  card: {
    background: ERP_COLORS.card,
    border: `1px solid ${ERP_COLORS.border}`,
    borderRadius: 12,
    padding: 16,
  },

  sectionTitle: {
    fontSize: 22,
    fontWeight: 900,
    color: ERP_COLORS.textPrimary,
    marginBottom: 6,
  },

  sectionSubtitle: {
    fontSize: 13,
    color: ERP_COLORS.textSecondary,
    marginTop: 0,
    lineHeight: 1.45,
    maxWidth: 720,
  },

  // Page-level typography (new shell)
  pageTitle: {
    fontSize: 24,
    fontWeight: 1000,
    color: ERP_COLORS.textPrimary,
    marginBottom: 6,
    letterSpacing: "-0.02em",
    lineHeight: 1.2,
  },
  pageHeaderRow: {
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    alignItems: "flex-start",
    flexWrap: "wrap" as const,
  },
  pageHeaderActions: {
    display: "flex",
    flexWrap: "wrap" as const,
    gap: 10,
    alignItems: "center",
    justifyContent: "flex-end",
  },

  /** Jednotná karta hlavičky detailu (VP, sklad, portfolio, …) */
  detailPageHeaderCard: {
    width: "100%",
    background: ERP_COLORS.card,
    border: `1px solid ${ERP_COLORS.border}`,
    borderRadius: 14,
    padding: 18,
    boxSizing: "border-box" as const,
  },
  detailPageHeaderContext: {
    marginTop: 16,
    paddingTop: 16,
    borderTop: `1px solid ${ERP_COLORS.divider}`,
  },
  detailPageHeaderContextGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
    gap: 12,
    alignItems: "start",
  },
  detailStatusBadge: {
    display: "inline-flex",
    alignItems: "center",
    padding: "5px 12px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 900,
    letterSpacing: "0.02em",
    width: "fit-content",
  },
  statLabel: {
    fontSize: 13,
    color: ERP_COLORS.textSecondary,
    fontWeight: 900,
  },
  statValue: {
    fontSize: 14,
    color: ERP_COLORS.textPrimary,
    fontWeight: 1000,
  },

  /**
   * Executive KPI / souhrnné dlaždice — jednotný systém (Zakázky, Karta zakázky, Detail položky)
   */
  summaryTilesGridOuter: {
    width: "100%",
    overflowX: "auto" as const,
    marginTop: 14,
    marginBottom: 4,
  },
  /** Řádek dlaždic s wrap (karta zakázky, detail položky) */
  summaryTilesGrid: {
    display: "flex",
    flexWrap: "wrap" as const,
    gap: 12,
    alignItems: "stretch",
    width: "100%",
  },
  /** Šest stejných KPI v jednom řádku na desktopu (přehled Zakázky) */
  summaryTilesGridSix: {
    display: "grid",
    gridTemplateColumns: "repeat(6, minmax(0, 1fr))",
    gap: 12,
    alignItems: "stretch",
    minWidth: 960,
    width: "100%",
    boxSizing: "border-box" as const,
  },
  summaryTile: {
    background: ERP_COLORS.card,
    border: `1px solid ${ERP_COLORS.border}`,
    borderRadius: 12,
    padding: "14px 16px",
    display: "flex",
    flexDirection: "column" as const,
    justifyContent: "center",
    gap: 4,
    minHeight: 112,
    minWidth: 0,
    boxSizing: "border-box" as const,
  },
  /** KPI dlaždice s levým barevným akcentem (vzor přehled VP / Zakázky). */
  overviewKpiTile: {
    background: ERP_COLORS.card,
    border: `1px solid ${ERP_COLORS.border}`,
    borderRadius: 12,
    padding: "14px 16px 14px 18px",
    display: "flex",
    flexDirection: "column" as const,
    justifyContent: "center",
    gap: 2,
    minHeight: 124,
    minWidth: 0,
    boxSizing: "border-box" as const,
    borderLeftWidth: 5,
    borderLeftStyle: "solid" as const,
    boxShadow: "0 2px 10px rgba(15, 23, 42, 0.06)",
    transition: "transform 0.22s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 0.22s cubic-bezier(0.4, 0, 0.2, 1)",
    willChange: "transform, box-shadow",
  },
  /** Hover stav KPI (merge přes base dlaždici). */
  overviewKpiTileHover: {
    transform: "translateY(-3px)",
    boxShadow: "0 12px 32px rgba(15, 23, 42, 0.12)",
  },
  overviewKpiLabel: {
    fontSize: 9,
    color: ERP_COLORS.neutralFg,
    fontWeight: 600,
    letterSpacing: "0.1em",
    textTransform: "uppercase" as const,
    lineHeight: 1.3,
    opacity: 0.88,
  },
  overviewKpiValue: {
    fontSize: 33,
    color: ERP_COLORS.textPrimary,
    fontWeight: 1000,
    lineHeight: 1.06,
    letterSpacing: "-0.03em",
    wordBreak: "break-word" as const,
  },
  overviewKpiHint: {
    fontSize: 11,
    color: ERP_COLORS.textSecondary,
    fontWeight: 600,
    marginTop: 4,
    lineHeight: 1.35,
  },
  summaryTileLabel: {
    fontSize: 11,
    color: ERP_COLORS.textSecondary,
    fontWeight: 800,
    lineHeight: 1.25,
  },
  summaryTileValue: {
    fontSize: 22,
    color: ERP_COLORS.textPrimary,
    fontWeight: 1000,
    lineHeight: 1.15,
    wordBreak: "break-word" as const,
  },
  summaryTileSubValue: {
    fontSize: 11,
    color: ERP_COLORS.textSecondary,
    fontWeight: 800,
    marginBottom: 2,
    lineHeight: 1.2,
  },
  summaryTileValueHotovo: {
    fontSize: 20,
    fontWeight: 1000,
    color: ERP_COLORS.okFg,
    lineHeight: 1.15,
  },
  summaryTileValueNehotovo: {
    fontSize: 20,
    fontWeight: 1000,
    color: ERP_COLORS.problemFg,
    lineHeight: 1.15,
  },

  /** Sub-navigation tabs (order card, item detail, …) */
  subTabsContainer: {
    display: "flex",
    flexWrap: "nowrap" as const,
    alignItems: "center",
    justifyContent: "space-between",
    gap: 4,
    width: "100%",
    overflow: "hidden" as const,
    marginTop: 12,
    marginBottom: 4,
  },
  subTab: {
    margin: 0,
    fontFamily: "inherit",
    flex: "1 1 auto",
    minWidth: 0,
    height: 34,
    padding: "0 8px",
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    lineHeight: 1,
    background: "#f1f5f9",
    color: "#0f172a",
    border: "1px solid #e2e8f0",
    cursor: "pointer",
    whiteSpace: "nowrap" as const,
    textAlign: "center" as const,
    boxSizing: "border-box" as const,
    display: "inline-flex" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  subTabActive: {
    background: "#2563eb",
    color: "#fff",
    border: "none",
  },
  /** Merge for inactive tab hover (inline styles cannot express :hover) */
  subTabHover: {
    background: "#e2e8f0",
  },

  progressBar: {
    track: {
      height: 10,
      background: "#e5e7eb",
      borderRadius: 999,
      overflow: "hidden",
      border: "1px solid #dbe2ea",
    },
    fill: {
      height: "100%",
      background: "#2563eb",
      borderRadius: 999,
    },
  },

  // Backwards-compatible aliases (legacy pages still use UI.headerTitle/UI.headerSubtitle)
  headerTitle: {
    fontSize: 22,
    fontWeight: 800,
    marginBottom: 6,
  },
  headerSubtitle: {
    fontSize: 13,
    color: "#64748b",
  },

  table: {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: 14,
    color: ERP_COLORS.textPrimary,
  },
  th: {
    textAlign: "left",
    padding: "10px 12px",
    borderBottom: `2px solid ${ERP_COLORS.divider}`,
    fontWeight: 800,
    fontSize: 11,
    color: "#0F172A",
    textTransform: "uppercase" as const,
    letterSpacing: "0.06em",
  },
  td: {
    padding: "10px 12px",
    borderBottom: `1px solid ${ERP_COLORS.divider}`,
    transition: "background-color 0.14s ease, color 0.14s ease",
  },

  /** Badge stavu v přehledových tabulkách (VP, …). */
  statusBadgeBase: {
    display: "inline-flex" as const,
    alignItems: "center" as const,
    padding: "6px 13px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 800,
    letterSpacing: "0.03em",
    width: "fit-content" as const,
    lineHeight: 1.25,
    border: "1px solid transparent",
    boxShadow:
      "0 1px 4px rgba(15, 23, 42, 0.1), inset 0 1px 0 rgba(255, 255, 255, 0.75), inset 0 0 0 1px rgba(15, 23, 42, 0.1)",
    transition: "background 0.18s ease, color 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease",
  },
  statusBadgeRunning: {
    color: "#172554",
    background: ERP_COLORS.runningBg,
    borderColor: "rgba(37, 99, 235, 0.55)",
  },
  statusBadgeOk: {
    color: "#14532D",
    background: ERP_COLORS.okBg,
    borderColor: "rgba(22, 163, 74, 0.55)",
  },
  statusBadgeWait: {
    color: "#7C2D12",
    background: ERP_COLORS.waitBg,
    borderColor: "rgba(245, 158, 11, 0.55)",
  },
  statusBadgeProblem: {
    color: "#7F1D1D",
    background: ERP_COLORS.problemBg,
    borderColor: "rgba(220, 38, 38, 0.55)",
  },
  statusBadgeNeutral: {
    color: "#0F172A",
    background: ERP_COLORS.neutralBg,
    borderColor: "rgba(100, 116, 139, 0.4)",
  },

  buttons: {
    primary: {
      background: ERP_COLORS.primary,
      color: "#fff",
      border: "none",
      borderRadius: 10,
      padding: "10px 14px",
      fontWeight: 800,
      cursor: "pointer",
      boxShadow: "0 4px 14px rgba(37,99,235,0.22)",
      transition: "transform 0.16s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 0.16s ease, background 0.16s ease",
    },
    secondary: {
      background: ERP_COLORS.card,
      border: `1px solid ${ERP_COLORS.border}`,
      color: ERP_COLORS.textPrimary,
      borderRadius: 10,
      padding: "10px 14px",
      fontWeight: 700,
      cursor: "pointer",
      transition: "transform 0.16s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 0.16s ease, border-color 0.16s ease, background 0.16s ease",
    },
  },

  // Backwards-compatible aliases (legacy pages still use UI.buttonPrimary/UI.buttonSecondary)
  buttonPrimary: {
    background: "#0f172a",
    color: "#fff",
    border: "none",
    borderRadius: 10,
    padding: "10px 14px",
    fontWeight: 700,
    cursor: "pointer",
  },
  buttonSecondary: {
    background: ERP_COLORS.card,
    border: `1px solid ${ERP_COLORS.border}`,
    borderRadius: 10,
    padding: "10px 14px",
    fontWeight: 600,
    cursor: "pointer",
    color: ERP_COLORS.textPrimary,
  },

  inputs: {
    base: {
      width: "100%",
      border: `1px solid ${ERP_COLORS.border}`,
      borderRadius: 10,
      padding: "10px 12px",
      fontSize: 14,
      background: ERP_COLORS.card,
      outline: "none",
      color: ERP_COLORS.textPrimary,
    },
    /** Fulltext v přehledové kartě — výraznější než běžné pole. */
    overviewSearch: {
      width: "100%",
      border: `2px solid ${ERP_COLORS.primaryLight}`,
      borderRadius: 10,
      padding: "10px 14px",
      fontSize: 14,
      fontWeight: 600,
      background: "#F8FAFC",
      outline: "none",
      color: ERP_COLORS.textPrimary,
      boxShadow: "0 1px 3px rgba(15, 23, 42, 0.05)",
      transition: "border-color 0.18s ease, box-shadow 0.18s ease, background 0.18s ease",
    },
    overviewSearchFocus: {
      borderColor: ERP_COLORS.primary,
      background: ERP_COLORS.card,
      boxShadow: `0 0 0 3px ${ERP_COLORS.primaryLight}, 0 6px 20px rgba(37, 99, 235, 0.14)`,
    },
    label: {
      fontSize: 13,
      fontWeight: 800,
      color: ERP_COLORS.tableHeadText,
      marginBottom: 6,
    },
  },

  /** Filtr bar nad tabulkou Zakázky */
  ordersFilterBar: {
    display: "flex",
    gap: 10,
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap" as const,
    marginBottom: 12,
  },
  ordersFilterSearchWrap: {
    flex: "1 1 360px",
    minWidth: 280,
  },
  ordersFilterChips: {
    display: "flex",
    gap: 8,
    alignItems: "center",
    flexWrap: "wrap" as const,
  },
  ordersFilterChip: {
    border: `1px solid ${ERP_COLORS.divider}`,
    background: "#FFFFFF",
    color: ERP_COLORS.textSecondary,
    borderRadius: 999,
    padding: "7px 12px",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
    whiteSpace: "nowrap" as const,
    transition: "transform 0.16s ease, box-shadow 0.16s ease, border-color 0.16s ease, background 0.16s ease, color 0.16s ease, opacity 0.16s ease",
    boxShadow: "0 1px 2px rgba(15, 23, 42, 0.03)",
  },
  ordersFilterChipActive: {
    border: `2px solid ${ERP_COLORS.primary}`,
    background: ERP_COLORS.primaryLight,
    color: ERP_COLORS.primaryHover,
    boxShadow: "0 3px 14px rgba(37, 99, 235, 0.22)",
    fontWeight: 800,
  },
  /** Rychlý filtr „Po termínu“ — aktivní stav (problém). */
  ordersFilterChipActiveWarn: {
    border: `2px solid ${ERP_COLORS.problemFg}`,
    background: ERP_COLORS.problemBg,
    color: ERP_COLORS.problemFg,
    boxShadow: "0 3px 14px rgba(220, 38, 38, 0.22)",
    fontWeight: 800,
  },
  /** Rychlý filtr „Dokončená“ — aktivní stav (OK). */
  ordersFilterChipActiveOk: {
    border: `2px solid ${ERP_COLORS.okFg}`,
    background: ERP_COLORS.okBg,
    color: ERP_COLORS.okFg,
    boxShadow: "0 3px 14px rgba(22, 163, 74, 0.2)",
    fontWeight: 800,
  },
  ordersFilterChipDisabled: {
    opacity: 0.45,
    cursor: "not-allowed",
    background: ERP_COLORS.neutralBg,
    color: ERP_COLORS.textSecondary,
  },

  /**
   * Globální ERP shell (SAP B1 inspirovaný, hutný) — pouze layout, ne obsah stránek.
   */
  erpShell: {
    sidebarWidth: 220,
    background: "#e8ebef",
    sidebarBg: "#2f3d4c",
    sidebarBorder: "1px solid #1f2937",
    sidebarTextMuted: "rgba(255,255,255,0.55)",
    sidebarText: "rgba(255,255,255,0.92)",
    sidebarGroupHeader: "rgba(255,255,255,0.45)",
    itemHover: "rgba(255,255,255,0.08)",
    itemActive: "rgba(0,112,242,0.35)",
    itemActiveBar: "#0070f2",
    topBarBg: "#ffffff",
    topBarBorder: "1px solid #c8cdd4",
    topBarHeight: 40,
  },

  topNavigation: {
    wrapper: {
      position: "sticky" as const,
      top: 0,
      zIndex: 50,
      background: "#fff",
      borderBottom: "1px solid #dbe2ea",
      padding: 12,
      display: "flex",
      gap: 12,
      alignItems: "center",
      flexWrap: "wrap" as const,
      justifyContent: "flex-start",
    },
    brand: {
      fontWeight: 900,
      fontSize: 18,
      marginRight: 10,
      color: "#0f172a",
      flexShrink: 0,
    },
    items: {
      display: "flex",
      gap: 8,
      alignItems: "center",
      flexWrap: "wrap" as const,
      flex: 1,
      minWidth: 0,
      justifyContent: "center",
    },
    rightSlot: {
      flexShrink: 0,
      marginLeft: "auto",
    },
    item: {
      border: "1px solid #cbd5e1",
      background: "#fff",
      color: "#0f172a",
      borderRadius: 10,
      padding: "10px 12px",
      cursor: "pointer",
      fontWeight: 800,
      fontSize: 13,
      whiteSpace: "nowrap" as const,
    },
    itemActive: {
      border: "1px solid #2563eb",
      background: "#2563eb",
      color: "#fff",
      borderRadius: 10,
      padding: "10px 12px",
      cursor: "pointer",
      fontWeight: 900,
      fontSize: 13,
      whiteSpace: "nowrap" as const,
    },
  },

  stickyNoteCards: {
    background: "#fffbeb",
    border: "1px solid #fde68a",
    shadow: "0 10px 24px rgba(180,83,9,0.08)",
  },

  stickyNoteCard: {
    background: "#fffbeb",
    border: "1px solid #fde68a",
    borderRadius: 14,
    padding: 16,
    boxShadow: "0 10px 24px rgba(180,83,9,0.08)",
  },

  /**
   * Hlavní přehledové stránky (Zakázky, VP, Výkresy, Sklad výrobků) — jedna „karta“ s pásem filtrů a tělem tabulky.
   */
  overviewMainCard: {
    background: ERP_COLORS.card,
    border: `1px solid ${ERP_COLORS.border}`,
    borderRadius: 14,
    padding: 0,
    overflow: "hidden" as const,
    width: "100%",
    boxSizing: "border-box" as const,
    boxShadow: "0 1px 2px rgba(15, 23, 42, 0.04)",
  },
  overviewCardHeaderBand: {
    padding: "16px 18px 14px",
    borderBottom: `1px solid ${ERP_COLORS.divider}`,
    background: ERP_COLORS.tableHeadBg,
  },
  overviewCardBody: {
    padding: "16px 18px",
    background: ERP_COLORS.card,
  },
  overviewTableWrap: {
    overflowX: "auto" as const,
    width: "100%",
  },
  /**
   * Vnitřní padding buněk přehledových tabulek — musí odpovídat `usePersistedTableLayout` (hustota sloupců).
   * Portfolio / VP / Zakázky používají `cellPaddingPx`; stránky bez persisted layout berou „comfortable“.
   */
  overviewTableCellPadding: {
    comfortable: 10,
    compact: 6,
  } as const,
  /** Společný reset pro `button.erp-table-link` v buňkách (hover z `ERP_GLOBAL_POLISH_CSS`). */
  tableLinkButtonReset: {
    background: "none",
    border: "none",
    padding: 0,
    margin: 0,
    cursor: "pointer",
    font: "inherit",
    textUnderlineOffset: "3px",
    fontWeight: 800,
  } satisfies React.CSSProperties,
  overviewTableHeadRow: {
    background: ERP_COLORS.tableHeadBg,
    boxShadow: "inset 0 -1px 0 rgba(15, 23, 42, 0.05)",
  },
  overviewRowHover: {
    background: "#F1F5F9",
  },
  overviewStateLoading: {
    padding: "20px 18px",
    color: ERP_COLORS.textSecondary,
    fontWeight: 700,
    fontSize: 14,
    background: ERP_COLORS.card,
  },
  overviewStateError: {
    padding: "16px 18px",
    color: ERP_COLORS.problemFg,
    fontWeight: 700,
    fontSize: 14,
    background: ERP_COLORS.problemBg,
    borderRadius: 10,
  },
  overviewStateWarn: {
    padding: "0 0 12px",
    color: ERP_COLORS.waitFg,
    fontWeight: 600,
    fontSize: 13,
  },
  overviewEmptyInCard: {
    textAlign: "center" as const,
    color: ERP_COLORS.textSecondary,
    fontWeight: 700,
    padding: "32px 18px",
    border: `1px solid ${ERP_COLORS.border}`,
    borderRadius: 12,
    background: ERP_COLORS.neutralBg,
    fontSize: 14,
  },
  /** Druhý řádek filtrů (fulltext) pod OverviewPrimaryFilterRow — stejné mezery jako chips řádek. */
  overviewSecondaryFilterRow: {
    display: "flex",
    flexWrap: "wrap" as const,
    gap: 10,
    alignItems: "center",
    marginTop: 12,
    marginBottom: 0,
  },
  overviewSloupceButton: {
    minWidth: 108,
    flexShrink: 0,
  },
  /** Tři KPI vedle sebe (sklad výrobků); zúží se na mobilu díky minmax. */
  summaryTilesGridThree: {
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    gap: 12,
    alignItems: "stretch",
    minWidth: 0,
    width: "100%",
    boxSizing: "border-box" as const,
  },
};

/** Odstín KPI dlaždice: primární modrá / neutrální / úspěch / výstraha / problém. */
export type ErpKpiAccentKind = "primary" | "neutral" | "success" | "warning" | "danger" | "info";

/**
 * Pozadí KPI dlaždice ve stylu ProductionOrdersPage: bílá → světle šedá s jemným barevným nádechem
 * v levém horním rohu. Používejte s `UI.overviewKpiTile` a `borderLeftColor`.
 */
export function erpKpiTileBackground(kind: ErpKpiAccentKind): string {
  const grayDepth = "linear-gradient(180deg, #ffffff 0%, #f3f4f6 52%, #e8ecf1 100%)";
  const wash: Record<ErpKpiAccentKind, string> = {
    primary: "rgba(37, 99, 235, 0.07)",
    info: "rgba(37, 99, 235, 0.07)",
    neutral: "rgba(148, 163, 184, 0.14)",
    success: "rgba(22, 163, 74, 0.08)",
    warning: "rgba(245, 158, 11, 0.09)",
    danger: "rgba(220, 38, 38, 0.06)",
  };
  return `linear-gradient(135deg, ${wash[kind]} 0%, transparent 44%), ${grayDepth}`;
}

/**
 * Sdílené "premium" vizuální tokeny pro detailové stránky (ProductionOrderDetailPage styl).
 * Použití:
 *   - `erpDetailStateCard` jako wrapper dominantního „Aktuální stav / Poloha" bloku
 *   - `erpDetailStateAccent` jako `border`
 *   - `erpDetailKpiPanel` jako wrapper řádku provozních metrik
 *   - `erpDetailSectionEyebrow` jako malý ALL CAPS nadtitulek sekce
 *   - `erpDetailRowLabel` / `erpDetailRowValue` pro stav (poloha, operace…)
 *   - `erpDetailKpiLabel` / `erpDetailKpiValue` pro KPI hodnoty
 */
export const erpDetailStateAccent = ERP_COLORS.primaryLight;
export const erpDetailStateBg =
  "linear-gradient(145deg, rgba(37, 99, 235, 0.09) 0%, rgba(241, 245, 249, 0.92) 52%, #ffffff 100%)";
export const erpDetailKpiPanelBg = ERP_COLORS.neutralBg;

export const erpDetailSectionEyebrow: React.CSSProperties = {
  textTransform: "uppercase",
  letterSpacing: 0.8,
  fontSize: 11,
  fontWeight: 800,
  color: ERP_COLORS.primary,
  marginBottom: 8,
};

export const erpDetailRowLabel: React.CSSProperties = {
  textTransform: "uppercase",
  letterSpacing: 0.6,
  fontSize: 11,
  fontWeight: 700,
  color: ERP_COLORS.neutralFg,
  marginBottom: 4,
};

export const erpDetailRowValue: React.CSSProperties = {
  fontSize: 17,
  fontWeight: 800,
  color: ERP_COLORS.textPrimary,
  lineHeight: 1.25,
};

export const erpDetailKpiLabel: React.CSSProperties = {
  textTransform: "uppercase",
  letterSpacing: 0.6,
  fontSize: 10,
  fontWeight: 700,
  color: ERP_COLORS.neutralFg,
};

export const erpDetailKpiValue: React.CSSProperties = {
  fontSize: 22,
  fontWeight: 900,
  color: ERP_COLORS.textPrimary,
  lineHeight: 1.1,
  marginTop: 4,
};

export const erpDetailStateCard: React.CSSProperties = {
  padding: "16px 18px",
  borderRadius: 14,
  background: erpDetailStateBg,
  border: `1px solid ${erpDetailStateAccent}`,
  boxShadow: "0 6px 18px rgba(15, 23, 42, 0.06)",
  display: "flex",
  flexDirection: "column",
  gap: 10,
};

export const erpDetailKpiPanel: React.CSSProperties = {
  padding: "14px 16px",
  borderRadius: 12,
  background: erpDetailKpiPanelBg,
  border: `1px solid ${ERP_COLORS.border}`,
  display: "flex",
  flexDirection: "column",
  gap: 10,
};

export const erpDetailKpiRow: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
  gap: 14,
};

export const erpDetailIdentGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
  gap: 10,
};

export const erpDetailIdentLabel: React.CSSProperties = {
  textTransform: "uppercase",
  letterSpacing: 0.5,
  fontSize: 10.5,
  fontWeight: 700,
  color: ERP_COLORS.neutralFg,
  marginBottom: 2,
};

export const erpDetailIdentValue: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 700,
  color: ERP_COLORS.textPrimary,
  lineHeight: 1.25,
};

/** Mapování barvy akcentu (levého pruhu) na kind pozadí — praktické pro rychlé použití v dlaždicích. */
export function erpKpiAccentKindFromColor(accent: string): ErpKpiAccentKind {
  const a = accent.toLowerCase();
  if (a === ERP_COLORS.primary.toLowerCase() || a === "#2563eb" || a === "#1d4ed8") return "primary";
  if (a === ERP_COLORS.okFg.toLowerCase() || a === "#16a34a") return "success";
  if (a === ERP_COLORS.waitFg.toLowerCase() || a === "#f59e0b") return "warning";
  if (a === ERP_COLORS.problemFg.toLowerCase() || a === "#dc2626") return "danger";
  return "neutral";
}

/**
 * Sdílená „premium“ polish CSS (hover lift, tabulkové hovery, status badges, odkazy, KPI).
 * Injektujeme jednou v ErpAppShell; stránky se přihlásí class="erp-overview-page".
 */
export const ERP_GLOBAL_POLISH_CSS = `
.erp-overview-page .erp-kpi-tile,
.erp-overview-page .po-kpi-tile {
  transition: transform 0.22s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 0.22s cubic-bezier(0.4, 0, 0.2, 1);
  will-change: transform, box-shadow;
}
.erp-overview-page .erp-kpi-tile:hover,
.erp-overview-page .po-kpi-tile:hover {
  transform: translateY(-3px);
  box-shadow: 0 12px 32px rgba(15, 23, 42, 0.12), inset 0 1px 0 rgba(255, 255, 255, 0.92);
}
.erp-overview-page button.erp-row-lift:not(:disabled):hover,
.erp-overview-page button.po-lift:not(:disabled):hover {
  transform: translateY(-1px);
  box-shadow: 0 6px 18px rgba(15, 23, 42, 0.1);
}
.erp-overview-page .erp-table-wrap table tbody tr,
.erp-overview-page .po-table-wrap table tbody tr {
  transition: background-color 0.16s ease, box-shadow 0.16s ease;
}
.erp-overview-page .erp-table-wrap table tbody tr:hover,
.erp-overview-page .po-table-wrap table tbody tr:hover {
  background-color: #F1F5F9 !important;
  box-shadow: inset 4px 0 0 #1D4ED8, 0 1px 0 rgba(15, 23, 42, 0.04);
}
.erp-overview-page .erp-overview-search::placeholder,
.erp-overview-page .po-overview-search::placeholder {
  color: #475569;
  opacity: 1;
}
.erp-overview-page .erp-overview-search::-webkit-input-placeholder,
.erp-overview-page .po-overview-search::-webkit-input-placeholder {
  color: #475569;
}
.erp-overview-page .erp-overview-search::-moz-placeholder,
.erp-overview-page .po-overview-search::-moz-placeholder {
  color: #475569;
  opacity: 1;
}
.erp-overview-page .erp-status-badge,
.erp-overview-page .po-status-badge {
  transition: transform 0.18s ease, box-shadow 0.18s ease;
  cursor: default;
}
.erp-overview-page .erp-status-badge:hover,
.erp-overview-page .po-status-badge:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 14px rgba(15, 23, 42, 0.12);
}
.erp-overview-page button.erp-table-link,
.erp-overview-page button.po-table-link {
  color: #1D4ED8;
  text-decoration: none;
  text-underline-offset: 3px;
  transition: color 0.15s ease, text-decoration 0.15s ease;
}
.erp-overview-page button.erp-table-link:hover,
.erp-overview-page button.po-table-link:hover {
  color: #1E3A8A;
  text-decoration: underline;
}
`.trim();

