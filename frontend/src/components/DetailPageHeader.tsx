import React from "react";
import { UI } from "../styles/ui";

export type DetailPageHeaderProps = {
  /** Např. varování nad kartou (storno, globální chyba). */
  preHeader?: React.ReactNode;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Badges / kompaktní stav vpravo nad akcemi. */
  headerAside?: React.ReactNode;
  actions?: React.ReactNode;
  /** Kontextová sekce pod titulkem (oddělená linkou), např. poloha ve výrobě. */
  context?: React.ReactNode;
  /** Obvykle `UI.summaryTilesGrid` s dlaždicemi. Obalí se do horizontálního scrollu. */
  summaryTiles?: React.ReactNode;
};

export default function DetailPageHeader({
  preHeader,
  title,
  subtitle,
  headerAside,
  actions,
  context,
  summaryTiles,
}: DetailPageHeaderProps) {
  const hasTopRight = headerAside != null || actions != null;
  return (
    <>
      {preHeader}
      <div style={UI.detailPageHeaderCard}>
        <div style={UI.pageHeaderRow}>
          <div style={{ minWidth: 0, flex: "1 1 220px" }}>
            {typeof title === "string" ? <div style={UI.pageTitle}>{title}</div> : title}
            {subtitle != null ? <div style={UI.sectionSubtitle}>{subtitle}</div> : null}
          </div>
          {hasTopRight ? (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-end",
                gap: 10,
                flex: "0 1 auto",
                minWidth: 0,
              }}
            >
              {headerAside ? (
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 8,
                    justifyContent: "flex-end",
                    alignItems: "center",
                  }}
                >
                  {headerAside}
                </div>
              ) : null}
              {actions ? <div style={UI.pageHeaderActions}>{actions}</div> : null}
            </div>
          ) : null}
        </div>
        {context ? <div style={UI.detailPageHeaderContext}>{context}</div> : null}
        {summaryTiles ? <div style={UI.summaryTilesGridOuter}>{summaryTiles}</div> : null}
      </div>
    </>
  );
}
