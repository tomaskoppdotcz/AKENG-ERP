import React from "react";

export type PageSectionProps = {
  children: React.ReactNode;
  /** Vlastní horní odsazení (výchozí 16 px) */
  gapTop?: number;
  /** Bez horního marginu */
  flushTop?: boolean;
  style?: React.CSSProperties;
};

/** Seskupení obsahu s jednotnou šířkou a svislou mezerou. */
export default function PageSection({ children, gapTop, flushTop, style }: PageSectionProps) {
  const marginTop = flushTop ? 0 : gapTop ?? 16;
  return (
    <div style={{ width: "100%", minWidth: 0, marginTop, ...style }}>
      {children}
    </div>
  );
}
