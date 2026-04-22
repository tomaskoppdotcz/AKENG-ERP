import React, { useCallback, useEffect, useMemo, useState } from "react";
import PageContainer from "../components/layout/PageContainer";
import PageHeader from "../components/layout/PageHeader";
import ErpPagination, { ERP_DEFAULT_PAGE_SIZE, ERP_PAGE_SIZE_OPTIONS } from "../components/overview/ErpPagination";
import { buildSearchHaystack, matchesSearchQuery } from "../overview/overviewSearch";
import {
  formatOverviewHoursFromMinutes,
  formatOverviewReportedMinutes,
} from "../overview/overviewMetricsFormat";
import { UI } from "../styles/ui";
import { akengFetch } from "../services/akengFetch";
import {
  getEmployeesMaster,
  getWorkplaceLibraryItems,
  type EmployeeMasterRow,
  type WorkplaceLibraryItem,
} from "../services/masterLibrariesApi";
import { getProductionOrdersOverview, type ProductionOrderOverviewRow } from "../services/productionOrdersApi";
import { listWorkReportsPaginated, type WorkReportDto } from "../services/workReportsApi";

const API_BASE = (import.meta as any).env?.VITE_API_BASE_URL || "http://127.0.0.1:8000";

type MachineMasterRow = {
  id: number;
  machine_code?: string | null;
  name?: string | null;
  machine_type?: string | null;
};

type Props = {
  onOpenProductionOrderInWorkspaceTab?: (productionOrderId: number, titleHint?: string) => void;
  onOpenWorkReportDetail?: (workReportId: number, titleHint?: string) => void;
  onOpenNewWorkReport?: () => void;
};

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

function filterVps(orders: ProductionOrderOverviewRow[], q: string): ProductionOrderOverviewRow[] {
  const s = q.trim();
  if (!s) return orders;
  return orders.filter((v) => {
    const hay = buildSearchHaystack(
      v.vp_code,
      v.gpn,
      v.description,
      v.zakazka,
      v.customer_order_no,
      v.drawing_number,
      v.drawing_revision,
      v.logistic_mode
    );
    return matchesSearchQuery(s, hay);
  });
}

function VpSearchField({
  label,
  valueId,
  onChangeId,
  query,
  onQueryChange,
  orders,
}: {
  label: string;
  valueId: number | null;
  onChangeId: (id: number | null) => void;
  query: string;
  onQueryChange: (q: string) => void;
  orders: ProductionOrderOverviewRow[];
}) {
  const selected = valueId ? orders.find((o) => o.id === valueId) : null;
  const filtered = useMemo(() => filterVps(orders, query).slice(0, 14), [orders, query]);
  return (
    <div>
      <div style={{ fontSize: 12, color: UI.colors.neutralFg, fontWeight: 700 }}>{label}</div>
      {selected ? (
        <div
          style={{
            marginTop: 4,
            padding: "10px 12px",
            background: UI.colors.neutralBg,
            borderRadius: 8,
            fontSize: 13,
            display: "flex",
            justifyContent: "space-between",
            gap: 8,
            alignItems: "flex-start",
          }}
        >
          <div>
            <strong>{selected.vp_code}</strong>
            {selected.gpn ? ` · ${selected.gpn}` : ""}
            <div style={{ fontSize: 12, color: UI.colors.textSecondary, marginTop: 4 }}>
              {(selected.description || "").slice(0, 120) || "—"}
            </div>
          </div>
          <button type="button" style={{ ...UI.buttons.secondary, flexShrink: 0 }} onClick={() => onChangeId(null)}>
            Změnit
          </button>
        </div>
      ) : (
        <>
          <input
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Hledat VP…"
            style={{ ...UI.inputs.base, marginTop: 4 }}
          />
          <div
            style={{
              maxHeight: 220,
              overflow: "auto",
              border: `1px solid ${UI.colors.border}`,
              borderRadius: 8,
              marginTop: 4,
              background: UI.colors.card,
            }}
          >
            {filtered.length === 0 ? (
              <div style={{ padding: 12, color: UI.colors.textSecondary, fontSize: 13 }}>Žádná shoda.</div>
            ) : (
              filtered.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => {
                    onChangeId(v.id);
                    onQueryChange("");
                  }}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    padding: "10px 12px",
                    border: "none",
                    borderBottom: `1px solid ${UI.colors.divider}`,
                    background: UI.colors.card,
                    cursor: "pointer",
                  }}
                >
                  <div style={{ fontWeight: 800 }}>{v.vp_code}</div>
                  <div style={{ fontSize: 12, color: UI.colors.textSecondary }}>
                    {v.gpn || "—"} · {(v.description || "").slice(0, 70) || "—"}
                  </div>
                </button>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}

function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "grid", gap: 4, minWidth: 0 }}>
      <span
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: UI.colors.neutralFg,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
        }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("cs-CZ", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDuration(min: number | null | undefined): string {
  if (min == null || !Number.isFinite(Number(min))) return "—";
  const m = Number(min);
  if (Math.abs(m) < 60) return formatOverviewReportedMinutes(m);
  return formatOverviewHoursFromMinutes(m);
}

function sourceLabel(source: string): string {
  const s = (source || "").toLowerCase();
  if (s === "manual") return "Ruční";
  if (s === "pc_kiosk") return "PC kiosk";
  if (s === "shopfloor_kiosk") return "Shopfloor";
  return source || "—";
}

function statusBadgeStyle(open: boolean): React.CSSProperties {
  if (open) {
    return { ...UI.statusBadgeBase, ...UI.statusBadgeRunning };
  }
  return { ...UI.statusBadgeBase, ...UI.statusBadgeOk };
}

/** Hodnoty `planning_operations.status` — stránkovaný endpoint filtruje podle nich (viz backend). */
const PLANNING_STATUS_FILTER_OPTIONS: readonly { value: string; label: string }[] = [
  { value: "", label: "Vše" },
  { value: "bezi", label: "Běží" },
  { value: "hotovo", label: "Hotovo" },
  { value: "ceka", label: "Čeká" },
  { value: "naplanovano", label: "Naplánováno" },
  { value: "planned", label: "Planned" },
  { value: "ready", label: "Připraveno" },
  { value: "waiting_release", label: "Čeká na uvolnění" },
  { value: "blokovano", label: "Blokováno" },
  { value: "scheduling_late", label: "Po termínu" },
  { value: "cancelled", label: "Zrušeno" },
];

export default function WorkReportsPage({
  onOpenProductionOrderInWorkspaceTab,
  onOpenWorkReportDetail,
  onOpenNewWorkReport,
}: Props) {
  const cellPad = UI.overviewTableCellPadding.comfortable;

  const [items, setItems] = useState<WorkReportDto[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [vps, setVps] = useState<ProductionOrderOverviewRow[]>([]);
  const [employees, setEmployees] = useState<EmployeeMasterRow[]>([]);
  const [machines, setMachines] = useState<MachineMasterRow[]>([]);
  const [workplaces, setWorkplaces] = useState<WorkplaceLibraryItem[]>([]);
  const [mastersLoading, setMastersLoading] = useState(true);

  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");
  const [filterEmployeeId, setFilterEmployeeId] = useState<number | null>(null);
  const [filterMachineId, setFilterMachineId] = useState<number | null>(null);
  const [filterVpId, setFilterVpId] = useState<number | null>(null);
  const [filterVpQuery, setFilterVpQuery] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [searchDraft, setSearchDraft] = useState("");
  const debouncedSearch = useDebouncedValue(searchDraft, 350);

  const [pageSize, setPageSize] = useState(ERP_DEFAULT_PAGE_SIZE);
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    let c = false;
    (async () => {
      setMastersLoading(true);
      try {
        const [vpRows, empRows, machRes, wpRows] = await Promise.all([
          getProductionOrdersOverview("all"),
          getEmployeesMaster("active"),
          akengFetch(`${API_BASE}/master-data/machines`),
          getWorkplaceLibraryItems().catch(() => [] as WorkplaceLibraryItem[]),
        ]);
        let machRows: MachineMasterRow[] = [];
        if (machRes.ok) {
          try {
            const raw = await machRes.json();
            if (Array.isArray(raw)) machRows = raw as MachineMasterRow[];
          } catch {
            /* ignore */
          }
        }
        if (!c) {
          setVps(vpRows);
          setEmployees(empRows);
          setMachines(machRows);
          setWorkplaces(wpRows);
        }
      } catch {
        if (!c) setError("Nepodařilo se načíst číselníky.");
      } finally {
        if (!c) setMastersLoading(false);
      }
    })();
    return () => {
      c = true;
    };
  }, []);

  useEffect(() => {
    setOffset(0);
  }, [filterDateFrom, filterDateTo, filterEmployeeId, filterMachineId, filterVpId, filterStatus, pageSize]);

  useEffect(() => {
    setOffset(0);
  }, [searchDraft]);

  const page = Math.floor(offset / pageSize) + 1;

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await listWorkReportsPaginated({
        page,
        page_size: pageSize,
        date_from: filterDateFrom || undefined,
        date_to: filterDateTo || undefined,
        employee_id: filterEmployeeId ?? undefined,
        machine_id: filterMachineId ?? undefined,
        production_order_id: filterVpId ?? undefined,
        status: filterStatus.trim() || undefined,
        search: debouncedSearch.trim() || undefined,
      });
      setItems(res.items);
      setTotalCount(res.total_count);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Nelze načíst výkazy.");
      setItems([]);
      setTotalCount(0);
    } finally {
      setLoading(false);
    }
  }, [
    page,
    pageSize,
    filterDateFrom,
    filterDateTo,
    filterEmployeeId,
    filterMachineId,
    filterVpId,
    filterStatus,
    debouncedSearch,
  ]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const consumeRefreshFlag = () => {
      try {
        const raw = sessionStorage.getItem("akeng_work_reports_refresh_once");
        if (raw !== "1") return;
        sessionStorage.removeItem("akeng_work_reports_refresh_once");
        void load();
      } catch {
        /* ignore */
      }
    };
    consumeRefreshFlag();
    window.addEventListener("focus", consumeRefreshFlag);
    return () => {
      window.removeEventListener("focus", consumeRefreshFlag);
    };
  }, [load]);

  const vpById = useMemo(() => new Map(vps.map((v) => [v.id, v])), [vps]);
  const employeeById = useMemo(() => new Map(employees.map((e) => [e.id, e])), [employees]);
  const workplaceById = useMemo(() => new Map(workplaces.map((w) => [w.id, w])), [workplaces]);

  const resetFilters = () => {
    setFilterDateFrom("");
    setFilterDateTo("");
    setFilterEmployeeId(null);
    setFilterMachineId(null);
    setFilterVpId(null);
    setFilterVpQuery("");
    setFilterStatus("");
    setSearchDraft("");
    setOffset(0);
  };

  return (
    <PageContainer
      className="erp-overview-page"
      style={{ paddingTop: 10, background: UI.colors.pageBg, minHeight: "100%" }}
    >
      <PageHeader
        title="Výkazy práce"
        subtitle="Provozní log vykázaných operací — stránkovaný přehled s filtry a vyhledáváním."
        actions={
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
            {onOpenNewWorkReport ? (
              <button type="button" style={UI.buttons.primary} onClick={() => onOpenNewWorkReport()}>
                Nový výkaz
              </button>
            ) : null}
            <button type="button" style={UI.buttons.secondary} onClick={() => void load()} disabled={loading}>
              Obnovit
            </button>
          </div>
        }
      />

      {mastersLoading ? (
        <div style={{ marginTop: 8, fontSize: 13, color: UI.colors.textSecondary }}>Načítám číselníky…</div>
      ) : null}

      {error ? (
        <div
          style={{
            ...UI.card,
            marginTop: 12,
            borderColor: "#fecaca",
            background: "#fef2f2",
            color: "#b91c1c",
          }}
        >
          {error}
        </div>
      ) : null}

      <div style={{ ...UI.overviewMainCard, marginTop: 16 }}>
        <div style={UI.overviewCardHeaderBand}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
              gap: 10,
              alignItems: "end",
            }}
          >
            <FilterField label="Datum od">
              <input
                type="date"
                value={filterDateFrom}
                onChange={(e) => setFilterDateFrom(e.target.value)}
                style={UI.inputs.base}
              />
            </FilterField>
            <FilterField label="Datum do">
              <input
                type="date"
                value={filterDateTo}
                onChange={(e) => setFilterDateTo(e.target.value)}
                style={UI.inputs.base}
              />
            </FilterField>
            <FilterField label="Zaměstnanec">
              <select
                value={filterEmployeeId ?? ""}
                onChange={(e) => setFilterEmployeeId(e.target.value ? Number(e.target.value) : null)}
                style={UI.inputs.base}
              >
                <option value="">Všichni</option>
                {employees
                  .filter((e) => e.is_active)
                  .sort((a, b) => a.full_name.localeCompare(b.full_name, "cs"))
                  .map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.full_name} ({e.employee_code})
                    </option>
                  ))}
              </select>
            </FilterField>
            <FilterField label="Stroj / pracoviště">
              <select
                value={filterMachineId ?? ""}
                onChange={(e) => setFilterMachineId(e.target.value ? Number(e.target.value) : null)}
                style={UI.inputs.base}
                title="Backend filtruje podle stroje (machine_id)."
              >
                <option value="">Vše</option>
                {machines
                  .slice()
                  .sort((a, b) => String(a.name || a.machine_code || "").localeCompare(String(b.name || b.machine_code || ""), "cs"))
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name || m.machine_code || `Stroj #${m.id}`}
                    </option>
                  ))}
              </select>
            </FilterField>
            <FilterField label="Stav operace">
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                style={UI.inputs.base}
                title="Filtr podle stavu plánovací operace (planning_operations.status). Sloupec „Stav výkazu“ v tabulce značí otevřený/uzavřený samotný výkaz."
              >
                {PLANNING_STATUS_FILTER_OPTIONS.map((o) => (
                  <option key={o.value || "__all__"} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </FilterField>
          </div>

          <div style={{ marginTop: 10 }}>
            <VpSearchField
              label="VP"
              valueId={filterVpId}
              onChangeId={setFilterVpId}
              query={filterVpQuery}
              onQueryChange={setFilterVpQuery}
              orders={vps}
            />
          </div>

          <div style={{ ...UI.overviewSecondaryFilterRow, gap: 10 }}>
            <div style={{ ...UI.ordersFilterSearchWrap, flex: "1 1 360px", minWidth: 240 }}>
              <input
                className="erp-overview-search"
                value={searchDraft}
                onChange={(e) => setSearchDraft(e.target.value)}
                placeholder="Hledat (odesláno na server)…"
                aria-label="Fulltextové hledání výkazů"
                style={UI.inputs.overviewSearch}
              />
            </div>
            <button type="button" style={UI.buttons.secondary} onClick={resetFilters}>
              Vymazat filtry
            </button>
          </div>
        </div>

        <div style={UI.overviewCardBody}>
          {loading ? <div style={UI.overviewStateLoading}>Načítám výkazy…</div> : null}
          {!loading && items.length === 0 ? (
            <div style={UI.overviewEmptyInCard}>
              {totalCount === 0 ? "Pro aktuální filtry nejsou žádné výkazy." : "Žádná data na této stránce."}
            </div>
          ) : null}
          {!loading && items.length > 0 ? (
            <div className="erp-table-wrap" style={UI.overviewTableWrap}>
              <table style={UI.table}>
                <thead>
                  <tr style={UI.overviewTableHeadRow}>
                    <th style={{ ...UI.th, padding: `${cellPad}px` }}>Kód</th>
                    <th style={{ ...UI.th, padding: `${cellPad}px` }}>Start</th>
                    <th style={{ ...UI.th, padding: `${cellPad}px` }}>Konec</th>
                    <th style={{ ...UI.th, padding: `${cellPad}px` }}>Trvání</th>
                    <th style={{ ...UI.th, padding: `${cellPad}px` }}>Zaměstnanec</th>
                    <th style={{ ...UI.th, padding: `${cellPad}px` }}>VP</th>
                    <th style={{ ...UI.th, padding: `${cellPad}px` }}>Operace</th>
                    <th style={{ ...UI.th, padding: `${cellPad}px` }}>Pracoviště</th>
                    <th style={{ ...UI.th, padding: `${cellPad}px`, textAlign: "right" }}>OK</th>
                    <th style={{ ...UI.th, padding: `${cellPad}px`, textAlign: "right" }}>NOK</th>
                    <th style={{ ...UI.th, padding: `${cellPad}px` }}>Stav výkazu</th>
                    <th style={{ ...UI.th, padding: `${cellPad}px` }}>Zdroj</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((r) => {
                    const vp = r.production_order_id != null ? vpById.get(r.production_order_id) : undefined;
                    const emp = r.employee_id != null ? employeeById.get(r.employee_id) : undefined;
                    const wp =
                      r.workplace_library_item_id != null ? workplaceById.get(r.workplace_library_item_id) : undefined;
                    const open = r.ended_at == null;
                    const vpCode = vp?.vp_code ?? (r.production_order_id ? `#${r.production_order_id}` : "—");
                    return (
                      <tr
                        key={r.id}
                        onClick={() =>
                          onOpenWorkReportDetail?.(
                            r.id,
                            [r.code?.trim() && `Výkaz ${r.code.trim()}`, vp?.vp_code?.trim() && `VP ${vp.vp_code.trim()}`]
                              .filter(Boolean)
                              .join(" · ") || undefined
                          )
                        }
                        style={{
                          background: UI.colors.card,
                          color: UI.colors.textPrimary,
                          cursor: onOpenWorkReportDetail ? "pointer" : "default",
                        }}
                      >
                        <td
                          style={{
                            ...UI.td,
                            padding: `${cellPad}px`,
                            whiteSpace: "nowrap",
                            fontWeight: 800,
                            fontVariantNumeric: "tabular-nums",
                          }}
                        >
                          {(r.code ?? "").trim() || "—"}
                        </td>
                        <td style={{ ...UI.td, padding: `${cellPad}px`, whiteSpace: "nowrap" }}>
                          {formatDateTime(r.started_at)}
                        </td>
                        <td style={{ ...UI.td, padding: `${cellPad}px`, whiteSpace: "nowrap" }}>
                          {formatDateTime(r.ended_at)}
                        </td>
                        <td
                          style={{
                            ...UI.td,
                            padding: `${cellPad}px`,
                            whiteSpace: "nowrap",
                            fontVariantNumeric: "tabular-nums",
                          }}
                        >
                          {formatDuration(r.duration_min)}
                        </td>
                        <td style={{ ...UI.td, padding: `${cellPad}px` }}>
                          {emp?.full_name || r.operator_display || "—"}
                          {emp?.employee_code ? (
                            <span style={{ color: UI.colors.textSecondary, marginLeft: 6, fontSize: 12 }}>
                              {emp.employee_code}
                            </span>
                          ) : null}
                        </td>
                        <td style={{ ...UI.td, padding: `${cellPad}px` }} onClick={(e) => e.stopPropagation()}>
                          {r.production_order_id != null && onOpenProductionOrderInWorkspaceTab ? (
                            <button
                              type="button"
                              className="erp-table-link"
                              style={{ ...UI.tableLinkButtonReset, fontWeight: 900, textDecoration: "none" }}
                              onClick={() =>
                                onOpenProductionOrderInWorkspaceTab(r.production_order_id!, vp?.vp_code ?? undefined)
                              }
                            >
                              {vpCode}
                            </button>
                          ) : (
                            <span style={{ fontWeight: 800 }}>{vpCode}</span>
                          )}
                        </td>
                        <td style={{ ...UI.td, padding: `${cellPad}px` }}>
                          #{r.operation_no} {r.operation_name}
                        </td>
                        <td style={{ ...UI.td, padding: `${cellPad}px` }}>{wp?.name || "—"}</td>
                        <td
                          style={{
                            ...UI.td,
                            padding: `${cellPad}px`,
                            textAlign: "right",
                            fontVariantNumeric: "tabular-nums",
                          }}
                        >
                          {(r.qty_ok ?? 0).toLocaleString("cs-CZ")}
                        </td>
                        <td
                          style={{
                            ...UI.td,
                            padding: `${cellPad}px`,
                            textAlign: "right",
                            fontVariantNumeric: "tabular-nums",
                          }}
                        >
                          {(r.qty_nok ?? 0).toLocaleString("cs-CZ")}
                        </td>
                        <td style={{ ...UI.td, padding: `${cellPad}px` }}>
                          <span className="erp-status-badge" style={statusBadgeStyle(open)}>
                            {open ? "Otevřený" : "Uzavřený"}
                          </span>
                        </td>
                        <td style={{ ...UI.td, padding: `${cellPad}px` }}>{sourceLabel(r.source)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}

          <ErpPagination
            pageSize={pageSize}
            onPageSizeChange={(n) => {
              setPageSize(n);
              setOffset(0);
            }}
            pageSizeOptions={ERP_PAGE_SIZE_OPTIONS}
            offset={offset}
            onOffsetChange={setOffset}
            total={totalCount}
            currentCount={items.length}
            disabled={loading}
          />
        </div>
      </div>
    </PageContainer>
  );
}
