/** Univerzální klientské fulltextové hledání v přehledech (case-insensitive, substring). */

export function normalizeSearchText(s: string | null | undefined): string {
  return String(s ?? "").trim().toLowerCase();
}

/**
 * Spojí hodnoty polí do jednoho normalizovaného řetězce pro `includes` vyhledávání.
 * Prázdné části se vynechají.
 */
export function buildSearchHaystack(...parts: Array<string | number | null | undefined>): string {
  return normalizeSearchText(parts.map((p) => String(p ?? "").trim()).filter((x) => x.length > 0).join(" "));
}

export function matchesSearchQuery(queryRaw: string, haystackNormalized: string): boolean {
  const q = normalizeSearchText(queryRaw);
  if (!q) return true;
  return haystackNormalized.includes(q);
}
