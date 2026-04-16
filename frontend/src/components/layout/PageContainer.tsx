import React from "react";
import { UI } from "../../styles/ui";

export type PageContainerProps = {
  children: React.ReactNode;
  /** Doplnění / přepsání (např. paddingTop) */
  style?: React.CSSProperties;
  className?: string;
};

/** Plná šířka pracovní oblasti — žádný max-width, žádné centrování. */
export default function PageContainer({ children, style, className }: PageContainerProps) {
  return (
    <div className={className} style={{ ...UI.pageContainer, ...style }}>
      {children}
    </div>
  );
}
