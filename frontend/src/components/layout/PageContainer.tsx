import React from "react";
import { UI } from "../../styles/ui";

export type PageContainerProps = {
  children: React.ReactNode;
  /** Doplnění / přepsání (např. paddingTop) */
  style?: React.CSSProperties;
};

/** Plná šířka pracovní oblasti — žádný max-width, žádné centrování. */
export default function PageContainer({ children, style }: PageContainerProps) {
  return (
    <div style={{ ...UI.pageContainer, ...style }}>
      {children}
    </div>
  );
}
