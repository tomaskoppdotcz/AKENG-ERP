/** Jednotné formátování metrik na hlavních přehledových stránkách ERP. */

export function formatOverviewDash(v: string | null | undefined): string {
  const t = String(v ?? "").trim();
  return t.length > 0 ? t : "—";
}

export function formatOverviewReportedMinutes(m: number | null | undefined): string {
  if (m == null || !Number.isFinite(Number(m))) return "—";
  return `${Math.round(Number(m))} min`;
}

/** Hodiny z celkového počtu minut (např. souhrnný vykázaný čas u zakázky). */
export function formatOverviewHoursFromMinutes(min: number | null | undefined): string {
  if (min == null || !Number.isFinite(Number(min))) return "—";
  const h = Number(min) / 60;
  return `${h.toLocaleString("cs-CZ", { maximumFractionDigits: 1 })} h`;
}

export function formatOverviewDecimalHours(h: number | null | undefined): string {
  if (h == null || !Number.isFinite(Number(h))) return "—";
  return `${Number(h).toLocaleString("cs-CZ", { maximumFractionDigits: 1 })} h`;
}

export function formatOverviewPercentInteger(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  return `${Math.round(Number(n))} %`;
}

/** Hodnota % tak, jak ji vrací backend (VP / výkonnost bez zaokrouhlení na celé). */
export function formatOverviewPercentAsShown(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  return `${Number(n)} %`;
}

export function formatOverviewMoneyKc0(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  if (Number(n) === 0) return "0 Kč";
  try {
    return new Intl.NumberFormat("cs-CZ", {
      style: "currency",
      currency: "CZK",
      maximumFractionDigits: 0,
    }).format(Number(n));
  } catch {
    return `${Math.round(Number(n))} Kč`;
  }
}

/**
 * Částka v Kč (cs-CZ, měna); null/NaN se berou jako 0 — shodně s dřívější prodejní cenou v přehledu zakázek.
 * Celé koruny u nákladů řešte `formatOverviewMoneyKc0`.
 */
export function formatOverviewCurrency(n: number | null | undefined): string {
  const v = n == null || Number.isNaN(Number(n)) ? 0 : Number(n);
  try {
    return new Intl.NumberFormat("cs-CZ", {
      style: "currency",
      currency: "CZK",
      maximumFractionDigits: 2,
      minimumFractionDigits: 0,
    }).format(v);
  } catch {
    return `${v.toLocaleString("cs-CZ", { maximumFractionDigits: 2, minimumFractionDigits: 0 })} Kč`;
  }
}

/** Alias pro zpětnou kompatibilitu importů. */
export const formatOverviewProdejniCena = formatOverviewCurrency;

/** Alias: vykázaný čas v minutách (sdílené názvy po refaktoru). */
export const formatOverviewMinutes = formatOverviewReportedMinutes;
export const formatReportedMinutes = formatOverviewReportedMinutes;

/** Alias: % hodnota z API bez zaokrouhlení na celé. */
export const formatPercentCell = formatOverviewPercentAsShown;

/** Alias: náklad práce / celé Kč. */
export const formatLaborCostCzk = formatOverviewMoneyKc0;

export function formatOverviewQtyWithUnit(qty: number, unit: string | null | undefined): string {
  const u = (unit ?? "").trim() || "ks";
  return `${qty} ${u}`;
}
