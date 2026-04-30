import { createElement } from "react";
import type { ReactNode as Node } from "react";
import {
  erpDetailKpiLabel,
  erpDetailKpiPanel,
  erpDetailKpiRow,
  erpDetailKpiValue,
  erpDetailSectionEyebrow,
  UI,
} from "../styles/ui";

export type FinancialKpi = {
  label?: string | null;
  value?: string | number | null;
};

type Props = {
  title?: string;
  kpis?: Array<FinancialKpi | null | undefined>;
  warnings?: Array<string | null | undefined>;
  footer?: Node;
};

export default function FinancialKpiPanel({ title, kpis, warnings = [], footer }: Props) {
  const kpiNodes = (kpis ?? []).map((kpi, index) => {
    const label = kpi?.label ?? `KPI ${index + 1}`;
    const value = kpi?.value ?? 0;

    return createElement(
      "div",
      { key: `${label}-${index}`, style: { minWidth: 0 } },
      createElement("div", { style: erpDetailKpiLabel }, label),
      createElement("div", { style: { ...erpDetailKpiValue, fontVariantNumeric: "tabular-nums" } }, value)
    );
  });

  const warningNodes = warnings
    .filter((warning): warning is string => Boolean(warning))
    .map((warning) =>
      createElement(
        "div",
        { key: warning, style: { color: "#92400e", fontSize: 12, fontWeight: 700 } },
        warning
      )
    );

  return createElement(
    "div",
    { style: erpDetailKpiPanel },
    createElement("div", { style: { ...erpDetailSectionEyebrow, color: UI.colors.neutralFg } }, title ?? ""),
    createElement("div", { style: erpDetailKpiRow }, kpiNodes),
    ...warningNodes,
    footer
      ? createElement(
          "div",
          {
            style: {
              marginTop: 2,
              paddingTop: 10,
              borderTop: `1px solid ${UI.colors.divider}`,
            },
          },
          footer
        )
      : null
  );
}
