export const UI = {
  // Global visual system
  appBackground: "#f1f5f9",

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
    background: "#ffffff",
    border: "1px solid #dbe2ea",
    borderRadius: 12,
    padding: 16,
  },

  sectionTitle: {
    fontSize: 22,
    fontWeight: 900,
    color: "#0f172a",
    marginBottom: 6,
  },

  sectionSubtitle: {
    fontSize: 13,
    color: "#64748b",
    marginTop: 0,
  },

  // Page-level typography (new shell)
  pageTitle: {
    fontSize: 24,
    fontWeight: 1000,
    color: "#0f172a",
    marginBottom: 6,
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
    background: "#ffffff",
    border: "1px solid #dbe2ea",
    borderRadius: 14,
    padding: 18,
    boxSizing: "border-box" as const,
  },
  detailPageHeaderContext: {
    marginTop: 16,
    paddingTop: 16,
    borderTop: "1px solid #e2e8f0",
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
    color: "#64748b",
    fontWeight: 900,
  },
  statValue: {
    fontSize: 14,
    color: "#0f172a",
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
    background: "#fff",
    border: "1px solid #e2e8f0",
    borderRadius: 12,
    padding: "10px 12px",
    display: "flex",
    flexDirection: "column" as const,
    justifyContent: "center",
    gap: 4,
    minHeight: 104,
    minWidth: 0,
    boxSizing: "border-box" as const,
  },
  summaryTileLabel: {
    fontSize: 11,
    color: "#64748b",
    fontWeight: 800,
    lineHeight: 1.25,
  },
  summaryTileValue: {
    fontSize: 22,
    color: "#0f172a",
    fontWeight: 1000,
    lineHeight: 1.15,
    wordBreak: "break-word" as const,
  },
  summaryTileSubValue: {
    fontSize: 11,
    color: "#64748b",
    fontWeight: 800,
    marginBottom: 2,
    lineHeight: 1.2,
  },
  summaryTileValueHotovo: {
    fontSize: 20,
    fontWeight: 1000,
    color: "#16a34a",
    lineHeight: 1.15,
  },
  summaryTileValueNehotovo: {
    fontSize: 20,
    fontWeight: 1000,
    color: "#dc2626",
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
  },
  th: {
    textAlign: "left",
    padding: "10px 12px",
    borderBottom: "1px solid #e5e7eb",
    fontWeight: 700,
    fontSize: 13,
    color: "#334155",
  },
  td: {
    padding: "10px 12px",
    borderBottom: "1px solid #f1f5f9",
  },

  buttons: {
    primary: {
      background: "#2563eb",
      color: "#fff",
      border: "none",
      borderRadius: 10,
      padding: "10px 14px",
      fontWeight: 800,
      cursor: "pointer",
      boxShadow: "0 6px 18px rgba(37,99,235,0.18)",
    },
    secondary: {
      background: "#fff",
      border: "1px solid #cbd5e1",
      color: "#0f172a",
      borderRadius: 10,
      padding: "10px 14px",
      fontWeight: 700,
      cursor: "pointer",
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
    background: "#fff",
    border: "1px solid #cbd5e1",
    borderRadius: 10,
    padding: "10px 14px",
    fontWeight: 600,
    cursor: "pointer",
  },

  inputs: {
    base: {
      width: "100%",
      border: "1px solid #cbd5e1",
      borderRadius: 10,
      padding: "10px 12px",
      fontSize: 14,
      background: "#fff",
      outline: "none",
    },
    label: {
      fontSize: 13,
      fontWeight: 800,
      color: "#334155",
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
    border: "1px solid #dbe2ea",
    background: "#f8fafc",
    color: "#0f172a",
    borderRadius: 999,
    padding: "7px 10px",
    fontSize: 12,
    fontWeight: 700,
    cursor: "pointer",
    whiteSpace: "nowrap" as const,
  },
  ordersFilterChipActive: {
    border: "1px solid #2563eb",
    background: "#dbeafe",
    color: "#1d4ed8",
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
    background: "#ffffff",
    border: "1px solid #dbe2ea",
    borderRadius: 14,
    padding: 0,
    overflow: "hidden" as const,
    width: "100%",
    boxSizing: "border-box" as const,
  },
  overviewCardHeaderBand: {
    padding: "16px 16px 14px",
    borderBottom: "1px solid #e2e8f0",
  },
  overviewCardBody: {
    padding: 16,
  },
  overviewTableWrap: {
    overflowX: "auto" as const,
    width: "100%",
  },
  overviewTableHeadRow: {
    background: "#f8fafc",
  },
  overviewStateLoading: {
    padding: "14px 16px",
    color: "#64748b",
    fontWeight: 700,
    fontSize: 14,
  },
  overviewStateError: {
    padding: "14px 16px",
    color: "#991b1b",
    fontWeight: 700,
    fontSize: 14,
  },
  overviewStateWarn: {
    padding: "0 16px 10px",
    color: "#b45309",
    fontWeight: 600,
    fontSize: 13,
  },
  overviewEmptyInCard: {
    textAlign: "center" as const,
    color: "#64748b",
    fontWeight: 700,
    padding: "28px 16px",
    border: "1px solid #e2e8f0",
    borderRadius: 12,
    background: "#f8fafc",
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

