import React from "react";
import { UI } from "../../styles/ui";

export type PageHeaderProps = {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Tlačítka vpravo (obalí se `UI.pageHeaderActions`) */
  actions?: React.ReactNode;
  style?: React.CSSProperties;
};

/**
 * Levá část: titul + podtitul. Pravá část: akce.
 * Odpovídá hornímu řádku modulu Zakázky.
 */
export default function PageHeader({ title, subtitle, actions, style }: PageHeaderProps) {
  return (
    <div style={{ ...UI.pageHeaderRow, ...style }}>
      <div style={{ minWidth: 0, flex: "1 1 220px" }}>
        {typeof title === "string" ? <div style={UI.pageTitle}>{title}</div> : title}
        {subtitle != null ? (
          typeof subtitle === "string" ? (
            <div style={UI.sectionSubtitle}>{subtitle}</div>
          ) : (
            subtitle
          )
        ) : null}
      </div>
      {actions != null ? <div style={UI.pageHeaderActions}>{actions}</div> : null}
    </div>
  );
}
