import React, { useEffect, useMemo, useState } from "react";
import { UI } from "../styles/ui";
import {
  getMaterialRequirements,
  getMaterialRequirementsByVp,
  type MaterialRequirementRow,
  type VpRequirementRow,
} from "../services/materialRequirementsApi";
import { getProductionOrdersOverview, type ProductionOrderOverviewRow } from "../services/productionOrdersApi";
import { getOrdersOverview, type OrdersOverviewRow } from "../services/ordersApi";
import { formatProductionOrderOverviewOperationalStatus } from "../utils/productionOrderOverviewStatus";

export type DashboardPageProps = {
  onOpenProductionOrder?: (productionOrderId: number, title?: string) => void;
  onOpenCustomerOrder?: (customerOrderId: number, title?: string) => void;
  onOpenMaterialRequirements?: () => void;
  onOpenMaterialPurchase?: () => void;
  onOpenPlanning?: () => void;
};

const URGENT_HORIZON_DAYS = 14;
const ROW_LIMIT = 8;

const linkSmall: React.CSSProperties = {
  background: "none",
  border: "none",
  padding: "2px 0",
  margin: 0,
  color: "#2563eb",
  fontWeight: 800,
  fontSize: 12,
  cursor: "pointer",
  textDecoration: "underline",
  textUnderlineOffset: "2px",
};

function parseDueMs(termin: string | null | undefined): number | null {
  if (!termin || !String(termin).trim()) return null;
  const s = String(termin).trim();
  const iso = Date.parse(s);
  if (!Number.isNaN(iso)) return iso;
  const m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (m) {
    const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
    const t = d.getTime();
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

function startOfTodayMs(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function formatCsDate(termin: string | null | undefined): string {
  const ms = parseDueMs(termin);
  if (ms === null) return "—";
  try {
    return new Date(ms).toLocaleDateString("cs-CZ");
  } catch {
    return termin ?? "—";
  }
}

function vpHasPendingIssue(vp: VpRequirementRow): boolean {
  if (vp.coverage !== "covered") return false;
  for (const m of vp.materials) {
    const lines = m.reservation_lines;
    if (lines && lines.length > 0) {
      if (lines.some((l) => String(l.status || "").toLowerCase() !== "issued")) return true;
    } else if (String(m.status || "").toLowerCase() !== "issued") {
      return true;
    }
  }
  return false;
}

function InsightCard({
  title,
  count,
  subtitle,
  accent,
  children,
  footerAction,
  footerSlot,
}: {
  title: string;
  count: number | string;
  subtitle?: string;
  accent: string;
  children: React.ReactNode;
  footerAction?: { label: string; onClick: () => void };
  footerSlot?: React.ReactNode;
}) {
  return (
    <div style={{ ...UI.card, padding: 16, borderRadius: 14, borderTop: `4px solid ${accent}`, minHeight: 200 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
        <div style={{ fontSize: 15, fontWeight: 1000, color: "#0f172a" }}>{title}</div>
        <div style={{ fontSize: 28, fontWeight: 1000, color: accent }}>{count}</div>
      </div>
      {subtitle ? (
        <div style={{ fontSize: 12, color: "#64748b", marginTop: 6, fontWeight: 600, lineHeight: 1.35 }}>{subtitle}</div>
      ) : null}
      <div style={{ marginTop: 12 }}>{children}</div>
      {footerSlot ? <div style={{ marginTop: 12 }}>{footerSlot}</div> : null}
      {!footerSlot && footerAction ? (
        <button
          type="button"
          onClick={footerAction.onClick}
          style={{
            marginTop: 14,
            width: "100%",
            padding: "10px 12px",
            borderRadius: 10,
            border: `1px solid ${accent}`,
            background: "#fff",
            color: "#0f172a",
            fontWeight: 800,
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          {footerAction.label}
        </button>
      ) : null}
    </div>
  );
}

function StateBadge({ label, tone }: { label: string; tone: "warn" | "ok" | "muted" | "danger" | "info" }) {
  const bg =
    tone === "warn"
      ? "#fff7ed"
      : tone === "ok"
        ? "#ecfdf5"
        : tone === "danger"
          ? "#fef2f2"
          : tone === "info"
            ? "#eff6ff"
            : "#f1f5f9";
  const fg =
    tone === "warn"
      ? "#c2410c"
      : tone === "ok"
        ? "#15803d"
        : tone === "danger"
          ? "#b91c1c"
          : tone === "info"
            ? "#1d4ed8"
            : "#475569";
  const border =
    tone === "warn"
      ? "#fdba74"
      : tone === "ok"
        ? "#86efac"
        : tone === "danger"
          ? "#fecaca"
          : tone === "info"
            ? "#93c5fd"
            : "#e2e8f0";
  return (
    <span
      style={{
        display: "inline-block",
        fontSize: 10,
        fontWeight: 900,
        letterSpacing: "0.02em",
        textTransform: "uppercase",
        padding: "2px 7px",
        borderRadius: 6,
        background: bg,
        color: fg,
        border: `1px solid ${border}`,
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );
}

function formatPoStatusLine(po: ProductionOrderOverviewRow | null | undefined): string | null {
  if (!po) return null;
  return formatProductionOrderOverviewOperationalStatus(po);
}

function materialReleasedLabel(released: boolean | null | undefined): string | null {
  if (released === true) return "Materiál vydán na výrobu";
  if (released === false) return "Čeká na vydání materiálu";
  return null;
}

function DashVpRow({
  vp,
  badge,
  tone,
  orderMeta,
  onOpenProductionOrder,
  onOpenCustomerOrder,
  onOpenMaterialRequirements,
}: {
  vp: VpRequirementRow;
  badge: React.ReactNode;
  tone: "warn" | "ok" | "muted" | "danger" | "info";
  orderMeta?: ProductionOrderOverviewRow | null;
  onOpenProductionOrder?: (id: number, title?: string) => void;
  onOpenCustomerOrder?: (id: number, title?: string) => void;
  onOpenMaterialRequirements?: () => void;
}) {
  const code = vp.vp_code ?? `VP #${vp.production_order_id}`;
  const stLine = formatPoStatusLine(orderMeta);
  const matLine = materialReleasedLabel(
    orderMeta?.is_material_released_to_production ??
      orderMeta?.is_material_ready ??
      vp.is_material_released_to_production ??
      vp.is_material_ready
  );
  const sub = [vp.gpn, vp.zakazka, vp.due_date ? `termín ${formatCsDate(vp.due_date)}` : null]
    .filter(Boolean)
    .join(" · ");
  const bg =
    tone === "warn" ? "#fff7ed" : tone === "ok" ? "#f0fdf4" : tone === "danger" ? "#fef2f2" : "#fff";
  const border =
    tone === "warn" ? "#fdba74" : tone === "ok" ? "#86efac" : tone === "danger" ? "#fecaca" : "#e5e7eb";

  return (
    <div style={{ borderRadius: 12, border: `1px solid ${border}`, overflow: "hidden", background: bg }}>
      <button
        type="button"
        disabled={!onOpenProductionOrder}
        onClick={() => onOpenProductionOrder?.(vp.production_order_id, code)}
        style={{
          display: "block",
          width: "100%",
          textAlign: "left",
          background: "transparent",
          border: "none",
          padding: "10px 12px",
          cursor: onOpenProductionOrder ? "pointer" : "default",
          color: "#0f172a",
          fontSize: 13,
          fontWeight: 800,
          lineHeight: 1.25,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
          <div style={{ flex: 1, minWidth: 0 }}>{code}</div>
          <div style={{ flexShrink: 0 }}>{badge}</div>
        </div>
        {sub ? <div style={{ fontSize: 12, fontWeight: 600, color: "#64748b", marginTop: 4 }}>{sub}</div> : null}
        {stLine || matLine ? (
          <div style={{ fontSize: 11, fontWeight: 700, color: "#475569", marginTop: 6, lineHeight: 1.35 }}>
            {stLine ? <span>Stav: {stLine}</span> : null}
            {stLine && matLine ? <span> · </span> : null}
            {matLine ? <span>{matLine}</span> : null}
          </div>
        ) : null}
      </button>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 12,
          padding: "6px 12px 8px",
          borderTop: `1px solid ${border}`,
          background: "rgba(255,255,255,0.65)",
        }}
      >
        {vp.customer_order_id != null && onOpenCustomerOrder ? (
          <button
            type="button"
            style={linkSmall}
            onClick={() => onOpenCustomerOrder(vp.customer_order_id!, vp.zakazka ?? undefined)}
          >
            Zakázka
          </button>
        ) : null}
        {onOpenMaterialRequirements ? (
          <button type="button" style={linkSmall} onClick={onOpenMaterialRequirements}>
            Požadavky materiálu
          </button>
        ) : null}
      </div>
    </div>
  );
}

export default function DashboardPage({
  onOpenProductionOrder,
  onOpenCustomerOrder,
  onOpenMaterialRequirements,
  onOpenMaterialPurchase,
  onOpenPlanning,
}: DashboardPageProps) {
  const [activeOrders, setActiveOrders] = useState<ProductionOrderOverviewRow[] | null>(null);
  const [requirements, setRequirements] = useState<MaterialRequirementRow[] | null>(null);
  const [vpByVp, setVpByVp] = useState<VpRequirementRow[] | null>(null);
  const [customerOrders, setCustomerOrders] = useState<OrdersOverviewRow[] | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadErr(null);
    void Promise.all([
      getProductionOrdersOverview("active"),
      getMaterialRequirements(),
      getMaterialRequirementsByVp(),
      getOrdersOverview("customer", "active"),
    ])
      .then(([active, req, byVp, co]) => {
        if (!cancelled) {
          setActiveOrders(active);
          setRequirements(req);
          setVpByVp(byVp);
          setCustomerOrders(co);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setLoadErr(e instanceof Error ? e.message : "Nepodařilo se načíst nástěnku.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const uncoveredVp = useMemo(() => {
    if (!vpByVp) return [];
    return vpByVp.filter((v) => v.coverage === "uncovered");
  }, [vpByVp]);

  const readyToIssueVp = useMemo(() => {
    if (!vpByVp) return [];
    return vpByVp.filter((v) => vpHasPendingIssue(v));
  }, [vpByVp]);

  const shortageMaterials = useMemo(() => {
    if (!requirements) return [];
    return requirements
      .filter((row) => Number(row.shortage) > 1e-6)
      .sort((a, b) => Number(b.shortage) - Number(a.shortage));
  }, [requirements]);

  const shortageCount = shortageMaterials.length;

  const internalRestockVp = useMemo(() => {
    if (!activeOrders) return [];
    return activeOrders.filter((p) => {
      const st = String(p.source_type || "").toLowerCase();
      const ot = String(p.order_type || "").toLowerCase();
      return st === "restock_allocation" || ot === "internal";
    });
  }, [activeOrders]);

  const urgentZakazky = useMemo(() => {
    if (!customerOrders) return [];
    const horizonEnd = startOfTodayMs() + URGENT_HORIZON_DAYS * 86400000;
    const scored = customerOrders
      .map((o) => ({ o, ms: parseDueMs(o.termin) }))
      .filter((x) => x.ms !== null && x.ms <= horizonEnd)
      .sort((a, b) => (a.ms! as number) - (b.ms! as number));
    return scored.slice(0, ROW_LIMIT).map((x) => x.o);
  }, [customerOrders]);

  const urgentCount = useMemo(() => {
    if (!customerOrders) return 0;
    const horizonEnd = startOfTodayMs() + URGENT_HORIZON_DAYS * 86400000;
    return customerOrders.filter((o) => {
      const ms = parseDueMs(o.termin);
      return ms !== null && ms <= horizonEnd;
    }).length;
  }, [customerOrders]);

  const poById = useMemo(() => {
    const m = new Map<number, ProductionOrderOverviewRow>();
    if (!activeOrders) return m;
    for (const p of activeOrders) m.set(p.id, p);
    return m;
  }, [activeOrders]);

  const shortageFooter = (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      {onOpenMaterialRequirements ? (
        <button
          type="button"
          onClick={onOpenMaterialRequirements}
          style={{
            flex: "1 1 140px",
            padding: "10px 12px",
            borderRadius: 10,
            border: "1px solid #dc2626",
            background: "#fff",
            color: "#0f172a",
            fontWeight: 800,
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          Požadavky materiálu
        </button>
      ) : null}
      {onOpenMaterialPurchase ? (
        <button
          type="button"
          onClick={onOpenMaterialPurchase}
          style={{
            flex: "1 1 140px",
            padding: "10px 12px",
            borderRadius: 10,
            border: "1px solid #94a3b8",
            background: "#f8fafc",
            color: "#0f172a",
            fontWeight: 800,
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          Nákup materiálu
        </button>
      ) : null}
    </div>
  );

  return (
    <div style={{ paddingTop: 10, maxWidth: 1920, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div>
          <div style={UI.sectionTitle}>Nástěnka</div>
          <div style={UI.sectionSubtitle}>
            Denní provoz — nepokryté / výdej / nákup / interní doplnění (data z existujících API). Pokryto = lze vydat,
            po vydání se VP plánuje automaticky.
          </div>
        </div>
      </div>

      {loadErr ? (
        <div
          style={{
            marginTop: 14,
            padding: "12px 14px",
            borderRadius: 12,
            background: "#fef2f2",
            color: "#b91c1c",
            border: "1px solid #fecaca",
            fontSize: 14,
            fontWeight: 700,
          }}
        >
          {loadErr}
        </div>
      ) : null}

      <div
        style={{
          marginTop: 18,
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 300px), 1fr))",
          gap: 14,
        }}
      >
        <InsightCard
          title="Čeká na materiál"
          count={vpByVp ? uncoveredVp.length : "…"}
          subtitle="Nepokrytý požadavek — blokováno chybějícím materiálem (nelze vydat)."
          accent="#ea580c"
          footerAction={onOpenMaterialRequirements ? { label: "Požadavky materiálu", onClick: onOpenMaterialRequirements } : undefined}
        >
          <div style={{ display: "grid", gap: 8 }}>
            {!vpByVp ? (
              <div style={{ color: "#64748b", fontSize: 13 }}>Načítám…</div>
            ) : uncoveredVp.length === 0 ? (
              <div style={{ color: "#64748b", fontSize: 13 }}>Žádný VP nečeká na materiál.</div>
            ) : (
              uncoveredVp.slice(0, ROW_LIMIT).map((vp) => (
                <DashVpRow
                  key={vp.production_order_id}
                  vp={vp}
                  tone="warn"
                  orderMeta={poById.get(vp.production_order_id)}
                  badge={<StateBadge label="Blokováno" tone="danger" />}
                  onOpenProductionOrder={onOpenProductionOrder}
                  onOpenCustomerOrder={onOpenCustomerOrder}
                  onOpenMaterialRequirements={onOpenMaterialRequirements}
                />
              ))
            )}
          </div>
        </InsightCard>

        <InsightCard
          title="Připraveno k výdeji"
          count={vpByVp ? readyToIssueVp.length : "…"}
          subtitle="Pokryto, ještě nevydáno — po výdeji se plánování doplní automaticky."
          accent="#15803d"
          footerAction={onOpenMaterialRequirements ? { label: "Požadavky → Vydat", onClick: onOpenMaterialRequirements } : undefined}
        >
          <div style={{ display: "grid", gap: 8 }}>
            {!vpByVp ? (
              <div style={{ color: "#64748b", fontSize: 13 }}>Načítám…</div>
            ) : readyToIssueVp.length === 0 ? (
              <div style={{ color: "#64748b", fontSize: 13 }}>Žádný VP nečeká na výdej.</div>
            ) : (
              readyToIssueVp.slice(0, ROW_LIMIT).map((vp) => (
                <DashVpRow
                  key={vp.production_order_id}
                  vp={vp}
                  tone="ok"
                  orderMeta={poById.get(vp.production_order_id)}
                  badge={<StateBadge label="K výdeji" tone="ok" />}
                  onOpenProductionOrder={onOpenProductionOrder}
                  onOpenCustomerOrder={onOpenCustomerOrder}
                  onOpenMaterialRequirements={onOpenMaterialRequirements}
                />
              ))
            )}
          </div>
        </InsightCard>

        <InsightCard
          title="Materiál k objednání"
          count={requirements ? shortageCount : "…"}
          subtitle="Agregovaná nepokrytá poptávka podle materiálu (stejná data jako požadavky)."
          accent="#dc2626"
          footerSlot={shortageFooter}
        >
          <div style={{ display: "grid", gap: 8 }}>
            {!requirements ? (
              <div style={{ color: "#64748b", fontSize: 13 }}>Načítám…</div>
            ) : shortageMaterials.length === 0 ? (
              <div style={{ color: "#64748b", fontSize: 13 }}>Žádný evidovaný deficit.</div>
            ) : (
              shortageMaterials.slice(0, ROW_LIMIT).map((r) => {
                const rel = r.related_orders?.[0];
                const poId = rel?.production_order_id;
                const subParts = [
                  `Nedostatek ${Number(r.shortage).toLocaleString("cs-CZ", { maximumFractionDigits: 3 })}`,
                  rel?.zakazka ? `${rel.zakazka}` : null,
                  rel?.vp_code ? `VP ${rel.vp_code}` : null,
                ].filter(Boolean);
                return (
                  <div
                    key={r.material_library_item_id}
                    style={{
                      borderRadius: 12,
                      border: "1px solid #fecaca",
                      overflow: "hidden",
                      background: "#fff",
                    }}
                  >
                    <button
                      type="button"
                      onClick={onOpenMaterialRequirements}
                      disabled={!onOpenMaterialRequirements}
                      style={{
                        display: "block",
                        width: "100%",
                        textAlign: "left",
                        background: "#fef2f2",
                        border: "none",
                        padding: "10px 12px",
                        cursor: onOpenMaterialRequirements ? "pointer" : "default",
                        color: "#0f172a",
                        fontSize: 13,
                        fontWeight: 800,
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                        <span style={{ flex: 1, minWidth: 0 }}>
                          {r.material.code ?? "?"} — {r.material.name ?? ""}
                        </span>
                        <StateBadge label="K nákupu" tone="danger" />
                      </div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: "#64748b", marginTop: 4 }}>
                        {subParts.join(" · ")}
                      </div>
                    </button>
                    <div
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: 12,
                        padding: "6px 12px 8px",
                        borderTop: "1px solid #fecaca",
                        background: "#fff",
                      }}
                    >
                      {onOpenMaterialRequirements ? (
                        <button type="button" style={linkSmall} onClick={onOpenMaterialRequirements}>
                          Požadavky
                        </button>
                      ) : null}
                      {poId != null && onOpenProductionOrder ? (
                        <button
                          type="button"
                          style={linkSmall}
                          onClick={() => onOpenProductionOrder(poId, rel?.vp_code ?? undefined)}
                        >
                          VP
                        </button>
                      ) : null}
                      {onOpenMaterialPurchase ? (
                        <button type="button" style={linkSmall} onClick={onOpenMaterialPurchase}>
                          Nákup
                        </button>
                      ) : null}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </InsightCard>

        <InsightCard
          title="Interní doplnění skladu"
          count={activeOrders ? internalRestockVp.length : "…"}
          subtitle="Aktivní VP typu interní zakázka nebo zdroj „doplnění skladu“ (restock)."
          accent="#0369a1"
          footerAction={onOpenPlanning ? { label: "Plánování", onClick: onOpenPlanning } : undefined}
        >
          <div style={{ display: "grid", gap: 8 }}>
            {!activeOrders ? (
              <div style={{ color: "#64748b", fontSize: 13 }}>Načítám…</div>
            ) : internalRestockVp.length === 0 ? (
              <div style={{ color: "#64748b", fontSize: 13 }}>Žádný takový VP v aktivních příkazech.</div>
            ) : (
              internalRestockVp.slice(0, ROW_LIMIT).map((p) => {
                const st = String(p.source_type || "").toLowerCase();
                const label =
                  st === "restock_allocation" ? "Doplnění skladu" : String(p.order_type || "").toLowerCase() === "internal" ? "Interní" : "Interní / sklad";
                return (
                  <DashVpRow
                    key={p.id}
                    vp={{
                      production_order_id: p.id,
                      vp_code: p.vp_code,
                      zakazka: p.zakazka,
                      customer_order_id: p.customer_order_id,
                      order_type: p.order_type,
                      gpn: p.gpn,
                      due_date: p.due_date,
                      job_item_id: p.job_item_id,
                      is_material_covered: Boolean(p.is_material_covered),
                      is_material_released_to_production: Boolean(p.is_material_released_to_production),
                      is_material_ready: Boolean(p.is_material_released_to_production ?? p.is_material_ready),
                      coverage: "covered",
                      materials: [],
                    }}
                    tone="info"
                    orderMeta={p}
                    badge={<StateBadge label={label} tone="info" />}
                    onOpenProductionOrder={onOpenProductionOrder}
                    onOpenCustomerOrder={onOpenCustomerOrder}
                    onOpenMaterialRequirements={onOpenMaterialRequirements}
                  />
                );
              })
            )}
          </div>
        </InsightCard>

        <InsightCard
          title="Urgentní zakázky podle termínu"
          count={customerOrders ? urgentCount : "…"}
          subtitle={`Aktivní zakázky s termínem do ${URGENT_HORIZON_DAYS} dnů (včetně po termínu).`}
          accent="#7c3aed"
        >
          <div style={{ display: "grid", gap: 8 }}>
            {!customerOrders ? (
              <div style={{ color: "#64748b", fontSize: 13 }}>Načítám…</div>
            ) : urgentZakazky.length === 0 ? (
              <div style={{ color: "#64748b", fontSize: 13 }}>Žádná zakázka v horizontu.</div>
            ) : (
              urgentZakazky.map((o) => {
                const ms = parseDueMs(o.termin);
                const overdue = ms !== null && ms < startOfTodayMs();
                const coId = o.customer_order_id;
                return (
                  <div
                    key={coId != null ? `co-${coId}` : `job-${o.job_id}-${o.zakazka}`}
                    style={{
                      borderRadius: 12,
                      border: `1px solid ${overdue ? "#fecaca" : "#e5e7eb"}`,
                      overflow: "hidden",
                      background: overdue ? "#fff7ed" : "#fff",
                    }}
                  >
                    <button
                      type="button"
                      disabled={coId == null || !onOpenCustomerOrder}
                      onClick={() => coId != null && onOpenCustomerOrder?.(coId, o.zakazka)}
                      style={{
                        display: "block",
                        width: "100%",
                        textAlign: "left",
                        background: "transparent",
                        border: "none",
                        padding: "10px 12px",
                        cursor: coId != null && onOpenCustomerOrder ? "pointer" : "default",
                        fontSize: 13,
                        fontWeight: 800,
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                        <span>{o.zakazka}</span>
                        <StateBadge label={overdue ? "Po termínu" : "Blízko"} tone={overdue ? "danger" : "warn"} />
                      </div>
                      <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>
                        {[`Termín ${formatCsDate(o.termin)}`, o.zakaznik, o.workflow_status?.trim() || null]
                          .filter(Boolean)
                          .join(" · ")}
                      </div>
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </InsightCard>
      </div>
    </div>
  );
}
