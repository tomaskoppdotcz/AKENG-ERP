export const UI = {
  // Global visual system
  appBackground: "#f1f5f9",

  // Main layout container (new skeleton)
  mainContainer: {
    maxWidth: 1400,
    margin: "0 auto",
    padding: 20,
  },

  // Backwards-compatible alias (legacy pages still use UI.container)
  container: {
    maxWidth: 1400,
    margin: "0 auto",
    padding: "20px",
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

  // Executive-style summary tiles (OrderCard header)
  summaryTile: {
    background: "#fff",
    border: "1px solid #dbe2ea",
    borderRadius: 14,
    padding: 14,
    display: "flex",
    flexDirection: "column" as const,
    gap: 8,
    minHeight: 86,
  },
  summaryTileLabel: {
    fontSize: 12,
    color: "#64748b",
    fontWeight: 900,
  },
  summaryTileValue: {
    fontSize: 20,
    color: "#0f172a",
    fontWeight: 1000,
    lineHeight: 1.15,
    wordBreak: "break-word" as const,
  },
  summaryTileSubValue: {
    fontSize: 12,
    color: "#334155",
    fontWeight: 900,
    marginBottom: 4,
  },
  summaryTileValueHotovo: {
    fontSize: 18,
    fontWeight: 1000,
    color: "#16a34a",
    lineHeight: 1.15,
  },
  summaryTileValueNehotovo: {
    fontSize: 18,
    fontWeight: 1000,
    color: "#dc2626",
    lineHeight: 1.15,
  },

  /** Souhrnný řádek nad akcemi (přehled Zakázky) — stejná rodina jako summaryTile */
  ordersSummaryBar: {
    display: "flex",
    flexWrap: "wrap" as const,
    gap: 12,
    alignItems: "stretch",
    marginTop: 14,
    marginBottom: 4,
  },
  ordersSummaryTile: {
    background: "#fff",
    border: "1px solid #dbe2ea",
    borderRadius: 14,
    padding: "12px 14px",
    display: "flex",
    flexDirection: "column" as const,
    gap: 6,
    minHeight: 76,
    flex: "1 1 160px",
    minWidth: 148,
    maxWidth: 240,
    boxSizing: "border-box" as const,
  },
  ordersSummaryTileLabel: {
    fontSize: 12,
    color: "#64748b",
    fontWeight: 900,
    lineHeight: 1.2,
  },
  ordersSummaryTileValue: {
    fontSize: 20,
    color: "#0f172a",
    fontWeight: 1000,
    lineHeight: 1.15,
    wordBreak: "break-word" as const,
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
    },
    brand: {
      fontWeight: 900,
      fontSize: 18,
      marginRight: 10,
      color: "#0f172a",
    },
    items: {
      display: "flex",
      gap: 8,
      alignItems: "center",
      flexWrap: "wrap" as const,
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
};

