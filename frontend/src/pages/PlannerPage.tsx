import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  getPlannerGantt,
  moveGanttOperation,
  PlannerGanttItem,
  PlannerGanttMachineGroup,
  PlannerGanttResponse,
  rebuildPlanningAll,
  updatePlanningOperation,
} from "../services/plannerApi";
import {
  hasSchedulingLateEarlierOnVp,
  plannerGanttBarColor,
  plannerGanttItemColor,
  plannerGanttStatusLabel,
} from "../utils/plannerGanttStatus";
import { ERP_COLORS, UI } from "../styles/ui";

const FONT = "Arial, Helvetica, sans-serif";
const ROW_HOVER = "#F1F5F9";
import { PlannerGanttDayColumn } from "../components/PlannerGanttDayColumn";
import {
  PlannerGanttOperationBlock,
  plannerGanttHoverDetails,
} from "../components/PlannerGanttOperationBlock";
import {
  expandPlannerGanttItemsForCells,
  ganttCellItemKey,
  groupItemsByVisibleDay,
  maxDayStackCount,
  plannerGlobalMachineOrder,
} from "../components/plannerGanttDayUtils";
import PageContainer from "../components/layout/PageContainer";
import PageHeader from "../components/layout/PageHeader";
import PageSection from "../components/layout/PageSection";
import { canPerformAction, readStoredErpRole } from "../auth/rbac";

function formatDateInput(date: Date): string {
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, "0");
  const d = `${date.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function addDays(date: Date, days: number): Date {
  const x = new Date(date);
  x.setDate(x.getDate() + days);
  return x;
}

/** Pořadí řádků Planneru — shoda podle názvu nebo kódu pracoviště (ne abecedně). */
const PLANNER_WORKPLACE_SPECS: readonly { code: string; patterns: RegExp[] }[] = [
  { code: "PILA", patterns: [/^pila$/i, /\bpila\b/i, /píla/i] },
  { code: "ST40", patterns: [/st\s*40/i, /^st40$/i] },
  { code: "SAB LT-52", patterns: [/sab\s*lt[- ]?52/i] },
  { code: "CLX450 TC", patterns: [/clx\s*450\s*tc/i] },
  { code: "CMX 600 V", patterns: [/cmx\s*600\s*v/i] },
  { code: "CTX BETA 800", patterns: [/ctx\s*beta\s*800/i] },
  { code: "NEF 400 I", patterns: [/nef\s*400\s*i\b/i, /\(leva\)/i, /\bleva\b/i] },
  { code: "NEF 400 II", patterns: [/nef\s*400\s*ii/i, /\(prav/i, /\bii\b/i] },
  { code: "SU50", patterns: [/su\s*50/i, /^su50$/i] },
  { code: "RUCNI", patterns: [/ručn/i, /rucni/i] },
  { code: "LASER", patterns: [/\blaser\b/i] },
  { code: "KONTROLA", patterns: [/kontrola/i] },
  { code: "EXPEDICE", patterns: [/expedic/i] },
  { code: "SKLAD", patterns: [/\bsklad\b/i] },
  { code: "HAAS VF3", patterns: [/haas\s*vf\s*3/i] },
  { code: "SAB LT-42", patterns: [/sab\s*lt[- ]?42/i] },
];

function normalizeWs(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

function ganttRowRank(m: { machineName: string; workplaceCode?: string | null }): number {
  const name = normalizeWs(m.machineName || "");
  const code = (m.workplaceCode || "").trim().toUpperCase().replace(/\s+/g, " ");
  for (let i = 0; i < PLANNER_WORKPLACE_SPECS.length; i++) {
    const spec = PLANNER_WORKPLACE_SPECS[i];
    const specCode = spec.code.toUpperCase().replace(/\s+/g, " ");
    if (code && code === specCode) return i;
    if (spec.patterns.some((re) => re.test(m.machineName || ""))) return i;
  }
  if (name.includes("nef 400") && name.includes("ii")) return 7;
  if (name.includes("nef 400") && (name.includes("(leva") || name.includes("levá"))) return 6;
  return 1000;
}

function orderMachinesForGantt(machines: PlannerGanttMachineGroup[]) {
  return [...machines].sort((a, b) => {
    const ra = ganttRowRank(a);
    const rb = ganttRowRank(b);
    if (ra !== rb) return ra - rb;
    return (a.machineName || "").localeCompare(b.machineName || "", "cs");
  });
}

const LEFT_COL_WIDTH = 168;
const MIN_DAY_COL_WIDTH = 56;
/** Minimální výška jednoho bloku v buňce dne (3 řádky textu) */
const LANE_HEIGHT = 44;
const HEADER_HEIGHT = 34;
const STACK_CELL_GAP_PX = 3;
const STACK_CELL_PAD_PX = 3;
const DROP_SPACER_H_PX = 5;

function stackedRowMinHeightPx(maxStack: number, minBlockH: number): number {
  if (maxStack <= 0) return LANE_HEIGHT + 14;
  const flexChildren = 2 * maxStack + 1;
  return (
    STACK_CELL_PAD_PX * 2 +
    (maxStack + 1) * DROP_SPACER_H_PX +
    maxStack * minBlockH +
    (flexChildren - 1) * STACK_CELL_GAP_PX
  );
}

function OverlayBar({ item }: { item: PlannerGanttItem }) {
  const bar = plannerGanttItemColor(item);
  return (
    <div
      title={plannerGanttHoverDetails(item)}
      style={{
        minWidth: 200,
        maxWidth: 320,
        minHeight: LANE_HEIGHT + 8,
        borderRadius: 10,
        padding: "6px 10px",
        background: `linear-gradient(180deg, ${bar} 0%, ${bar} 88%, rgba(15,23,42,0.18) 100%)`,
        color: "#fff",
        overflow: "hidden",
        boxSizing: "border-box",
        border: "1px solid rgba(255,255,255,0.35)",
        boxShadow: "0 4px 14px rgba(15, 23, 42, 0.12)",
        fontFamily: FONT,
      }}
    >
      <PlannerGanttOperationBlock item={item} />
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "110px 1fr",
        gap: 10,
        padding: "10px 0",
        borderBottom: `1px solid ${ERP_COLORS.divider}`,
        fontSize: 14,
        fontFamily: FONT,
      }}
    >
      <div style={{ color: ERP_COLORS.textSecondary, fontWeight: 700 }}>{label}</div>
      <div style={{ color: ERP_COLORS.textPrimary, fontWeight: 600, wordBreak: "break-word" }}>{value}</div>
    </div>
  );
}

function OperationDetailPanel({
  item,
  allItems,
  onClose,
  onSaved,
  onOpenProductionOrder,
  onOpenMaterialRequirements,
  canPlanningWrite,
}: {
  item: PlannerGanttItem | null;
  /** Pro upřesnění popisu waiting_release po scheduling_late na VP. */
  allItems?: PlannerGanttItem[];
  onClose: () => void;
  onSaved: () => Promise<void>;
  onOpenProductionOrder?: (productionOrderId: number, title?: string) => void;
  onOpenMaterialRequirements?: () => void;
  canPlanningWrite: boolean;
}) {
  const [status, setStatus] = useState("");
  const [materialReady, setMaterialReady] = useState(false);
  const [isLocked, setIsLocked] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!item) return;
    setStatus(item.status || "planned");
    setMaterialReady(!!item.materialReady);
    setIsLocked(!!item.isLocked);
    setMessage("");
  }, [item]);

  if (!item) return null;

  async function handleSave() {
    if (!canPlanningWrite) return;
    try {
      setSaving(true);
      setMessage("");
      await updatePlanningOperation({
        planningOperationId: item.operationId,
        status,
        materialReady,
        isLocked,
      });
      await onSaved();
      setMessage("Ulozeno.");
    } catch (e: any) {
      setMessage(e?.message || "Nepodarilo se ulozit zmenu.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        right: 0,
        width: 380,
        height: "100vh",
        background: ERP_COLORS.card,
        borderLeft: `1px solid ${ERP_COLORS.border}`,
        boxShadow: "-8px 0 28px rgba(15, 23, 42, 0.08)",
        fontFamily: FONT,
        zIndex: 1200,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          padding: 18,
          borderBottom: `1px solid ${ERP_COLORS.divider}`,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
          background: ERP_COLORS.tableHeadBg,
        }}
      >
        <div>
          <div style={{ fontSize: 18, fontWeight: 900, color: ERP_COLORS.textPrimary }}>Detail operace</div>
          <div style={{ fontSize: 12, color: ERP_COLORS.textSecondary, marginTop: 4 }}>
            {item.operationName} | {item.machineName}
          </div>
        </div>

        <button
          onClick={onClose}
          type="button"
          style={{
            border: `1px solid ${ERP_COLORS.border}`,
            background: ERP_COLORS.card,
            color: ERP_COLORS.textPrimary,
            borderRadius: 10,
            padding: "8px 12px",
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          Zavrit
        </button>
      </div>

      <div style={{ padding: 18, overflowY: "auto", flex: 1 }}>
        <div
          style={{
            display: "inline-block",
            padding: "6px 10px",
            borderRadius: 999,
            color: "#fff",
            background: plannerGanttBarColor(status),
            fontSize: 12,
            fontWeight: 800,
            marginBottom: 16,
          }}
        >
          {plannerGanttStatusLabel(status, item ? { item: { ...item, status }, allItems } : undefined)}
        </div>

        <DetailRow label="VP" value={item.workOrderNo ?? "-"} />
        <DetailRow label="GPN" value={item.gpn ?? "-"} />
        <DetailRow label="WP kód" value={item.workplaceCode ?? "—"} />
        <DetailRow label="Další WP" value={item.nextWorkplaceCode ?? "—"} />
        <DetailRow label="Operace" value={item.operationName} />
        <DetailRow label="Stroj" value={item.machineName} />
        <DetailRow label="Fronta" value={item.queuePosition ?? "-"} />
        <DetailRow label="Qty" value={item.qty} />
        <DetailRow label="Setup" value={`${item.setupTimeMin} min`} />
        <DetailRow label="Labor" value={`${item.laborTimeTotalMin} min`} />
        <DetailRow label="Total" value={`${item.totalOperationTimeMin} min`} />
        <DetailRow label="Expedice" value={item.expeditionDate ?? "-"} />
        <DetailRow
          label="Planned start"
          value={item.plannedStart ? new Date(item.plannedStart).toLocaleString("cs-CZ") : "-"}
        />
        <DetailRow
          label="Planned end"
          value={item.plannedEnd ? new Date(item.plannedEnd).toLocaleString("cs-CZ") : "-"}
        />

        {item.scheduleSegments && item.scheduleSegments.length > 0 ? (
          <div style={{ marginTop: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: ERP_COLORS.textSecondary, marginBottom: 8 }}>
              Plánované segmenty
            </div>
            <div
              style={{
                border: `1px solid ${ERP_COLORS.border}`,
                borderRadius: 10,
                overflow: "hidden",
                fontSize: 13,
              }}
            >
              {item.scheduleSegments.map((s) => {
                const d0 = s.plannedStart ? new Date(s.plannedStart) : null;
                const d1 = s.plannedEnd ? new Date(s.plannedEnd) : null;
                const dateStr =
                  d0 != null && !Number.isNaN(d0.getTime())
                    ? d0.toLocaleDateString("cs-CZ", { day: "numeric", month: "numeric", year: "numeric" })
                    : "—";
                const fromTo =
                  d0 != null && d1 != null && !Number.isNaN(d0.getTime()) && !Number.isNaN(d1.getTime())
                    ? `${d0.toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" })}–${d1.toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" })}`
                    : "—";
                return (
                  <div
                    key={s.segmentIndex}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr",
                      gap: 4,
                      padding: "10px 12px",
                      borderBottom: `1px solid ${ERP_COLORS.divider}`,
                      background: ERP_COLORS.neutralBg,
                    }}
                  >
                    <div style={{ fontWeight: 800, color: ERP_COLORS.textPrimary }}>
                      Segment {s.segmentIndex + 1}
                      {item.scheduleSegments!.length > 1 ? ` / ${item.scheduleSegments!.length}` : ""}
                    </div>
                    <div style={{ color: ERP_COLORS.textSecondary }}>
                      <span style={{ fontWeight: 700 }}>{dateStr}</span>
                      {" · "}
                      {fromTo}
                    </div>
                    <div style={{ color: ERP_COLORS.textSecondary }}>
                      {item.machineName}
                      {s.machineId !== item.machineId ? ` (stroj #${s.machineId})` : ""}
                    </div>
                    <div style={{ color: ERP_COLORS.textSecondary, fontWeight: 600 }}>{s.durationMin} min</div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

        <DetailRow
          label="Materiál"
          value={
            <span style={{ color: item.materialReady ? ERP_COLORS.okFg : ERP_COLORS.waitFg, fontWeight: 800 }}>
              {item.materialReady ? "Připraven" : "Čeká na materiál"}
            </span>
          }
        />

        <div style={{ marginTop: 14, display: "flex", flexWrap: "wrap", gap: 8 }}>
          {onOpenProductionOrder && item.productionOrderId != null ? (
            <button
              type="button"
              onClick={() => onOpenProductionOrder(item.productionOrderId!, item.workOrderNo ?? undefined)}
              style={{
                border: `1px solid ${ERP_COLORS.primary}`,
                background: ERP_COLORS.primaryLight,
                color: ERP_COLORS.primaryHover,
                borderRadius: 10,
                padding: "8px 12px",
                fontWeight: 800,
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              Otevřít výrobní příkaz
            </button>
          ) : null}
          {onOpenMaterialRequirements ? (
            <button
              type="button"
              onClick={() => onOpenMaterialRequirements()}
              style={{
                border: `1px solid ${ERP_COLORS.waitFg}`,
                background: ERP_COLORS.waitBg,
                color: ERP_COLORS.textPrimary,
                borderRadius: 10,
                padding: "8px 12px",
                fontWeight: 800,
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              Požadavky materiálu
            </button>
          ) : null}
        </div>

        <div style={{ marginTop: 18, display: "grid", gap: 14 }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 800, color: ERP_COLORS.textSecondary, marginBottom: 6 }}>Status</div>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              disabled={!canPlanningWrite}
              style={{
                width: "100%",
                border: `1px solid ${ERP_COLORS.border}`,
                borderRadius: 10,
                padding: "10px 12px",
                fontSize: 14,
                background: ERP_COLORS.card,
                color: ERP_COLORS.textPrimary,
              }}
            >
              <option value="ceka">Ceka</option>
              <option value="planned">Planned</option>
              <option value="naplanovano">Naplanovano</option>
              <option value="bezi">Bezi</option>
              <option value="hotovo">Hotovo</option>
              <option value="blokovano">Blokovano</option>
              <option value="ready">Ready</option>
              <option value="waiting_release">Čeká na uvolnění</option>
              <option value="scheduling_late">Po termínu (plánovač)</option>
            </select>
          </div>

          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              fontSize: 14,
              fontWeight: 700,
              color: ERP_COLORS.textPrimary,
            }}
          >
            <input
              type="checkbox"
              checked={materialReady}
              disabled={!canPlanningWrite}
              onChange={(e) => setMaterialReady(e.target.checked)}
            />
            Materiál ready (ruční přepis; primárně řídí backend z VP)
          </label>

          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              fontSize: 14,
              fontWeight: 700,
              color: ERP_COLORS.textPrimary,
            }}
          >
            <input
              type="checkbox"
              checked={isLocked}
              disabled={!canPlanningWrite}
              onChange={(e) => setIsLocked(e.target.checked)}
            />
            Lock operace
          </label>

          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !canPlanningWrite}
            style={{
              ...UI.buttons.primary,
              opacity: saving ? 0.6 : 1,
            }}
          >
            {saving ? "Ukladam..." : "Ulozit zmeny"}
          </button>

          {message ? (
            <div
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: message === "Ulozeno." ? ERP_COLORS.okFg : ERP_COLORS.problemFg,
              }}
            >
              {message}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export type PlannerPageProps = {
  onOpenProductionOrder?: (productionOrderId: number, title?: string) => void;
  onOpenMaterialRequirements?: () => void;
};

export default function PlannerPage({
  onOpenProductionOrder,
  onOpenMaterialRequirements,
}: PlannerPageProps) {
  const today = new Date();
  const defaultFrom = formatDateInput(today);
  const defaultTo = formatDateInput(addDays(today, 6));

  const [fromDate, setFromDate] = useState(defaultFrom);
  const [toDate, setToDate] = useState(defaultTo);
  const [data, setData] = useState<PlannerGanttResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const [moving, setMoving] = useState(false);
  const [error, setError] = useState("");
  const [machineFilter, setMachineFilter] = useState("");
  const [hoverLaneKey, setHoverLaneKey] = useState<string | null>(null);
  const [activeDragItem, setActiveDragItem] = useState<PlannerGanttItem | null>(null);
  const [selectedItem, setSelectedItem] = useState<PlannerGanttItem | null>(null);
  const chartScrollRef = useRef<HTMLDivElement>(null);
  const [dayColWidth, setDayColWidth] = useState(96);
  /** Zneplatní výsledek staršího fetch (Strict Mode, změna rozsahu, rychlé obnovení). */
  const ganttFetchSeq = useRef(0);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 6,
      },
    })
  );

  const erpRole = useMemo(() => readStoredErpRole(), []);
  const canPlanningWrite = canPerformAction(erpRole, "planning.write");

  const loadData = useCallback(async () => {
    const seq = ++ganttFetchSeq.current;
    try {
      setLoading(true);
      setError("");
      const result = await getPlannerGantt(fromDate, toDate);
      if (seq !== ganttFetchSeq.current) return;
      setError("");
      setData(result);

      setSelectedItem((prev) => {
        if (!prev) return null;
        const allItems = [
          ...result.machines.flatMap((m) => m.items),
          ...result.unscheduledItems,
        ];
        return allItems.find((x) => x.operationId === prev.operationId) || null;
      });
    } catch (e: any) {
      if (seq !== ganttFetchSeq.current) return;
      setError(e?.message || "Nepodarilo se nacist Planner Gantt.");
    } finally {
      if (seq === ganttFetchSeq.current) {
        setLoading(false);
      }
    }
  }, [fromDate, toDate]);

  async function rebuildPlan() {
    if (!canPlanningWrite) {
      // F2.2-fix-4: tell user why button does nothing
      setError("Nemáte oprávnění pro přepočet plánu.");
      return;
    }
    try {
      setRebuilding(true);
      setError("");
      await rebuildPlanningAll();
      // F2.2-fix-4: force gantt reload that bypasses ganttFetchSeq race guard
      const mySeq = ++ganttFetchSeq.current;
      const result = await getPlannerGantt(fromDate, toDate);
      if (mySeq === ganttFetchSeq.current) {
        setData(result);
      }
    } catch (e: any) {
      setError(e?.message || "Nepodařilo se přepočítat plán.");
    } finally {
      setRebuilding(false);
    }
  }

  useEffect(() => {
    void loadData();
    return () => {
      ganttFetchSeq.current += 1;
    };
  }, [loadData]);

  useLayoutEffect(() => {
    const el = chartScrollRef.current;
    if (!el) return;
    const n = data?.days?.length || 7;
    const measure = () => {
      const inner = Math.max(0, el.clientWidth - LEFT_COL_WIDTH - 6);
      setDayColWidth(Math.max(MIN_DAY_COL_WIDTH, Math.floor(inner / Math.max(1, n))));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [data?.days?.length]);

  const orderedGanttMachines = useMemo(() => {
    if (!data) return [];
    const q = machineFilter.trim().toLowerCase();
    const base = q
      ? data.machines.filter(
          (m) =>
            m.machineName.toLowerCase().includes(q) ||
            (m.workplaceCode || "").toLowerCase().includes(q)
        )
      : data.machines;
    return orderMachinesForGantt(base);
  }, [data, machineFilter]);

  const allPlannerItems = useMemo(() => {
    if (!data) return [];
    return [...data.machines.flatMap((m) => m.items), ...data.unscheduledItems];
  }, [data]);

  const plannerCockpitKpis = useMemo(() => {
    if (!data) return null;
    const scheduled = data.machines.flatMap((m) => m.items);
    const uniqScheduled = new Map<number, PlannerGanttItem>();
    for (const it of scheduled) uniqScheduled.set(it.operationId, it);
    const scheduledUnique = [...uniqScheduled.values()];

    const rows = Math.max(1, orderedGanttMachines.length);
    const daysCount = Math.max(1, data.days.length);
    const totalPlannedMin = scheduledUnique.reduce((acc, x) => acc + (Number(x.totalOperationTimeMin) || 0), 0);
    const roughCapMin = rows * daysCount * 8 * 60;
    const utilizationPct = Math.min(100, Math.round((totalPlannedMin / roughCapMin) * 100));

    const uniqAll = new Map<number, PlannerGanttItem>();
    for (const it of allPlannerItems) uniqAll.set(it.operationId, it);
    const distinctAll = [...uniqAll.values()];
    const statusLo = (s: string) => (s || "").toLowerCase();

    let blockedOps = 0;
    const delayedWoos = new Set<string>();
    const riskWoos = new Set<string>();
    let coopWaitingReturn = 0;

    for (const x of distinctAll) {
      const st = statusLo(x.status);
      if (st === "blokovano" || st === "blocked" || x.blockedByCooperation) blockedOps += 1;
      if (st === "scheduling_late") {
        const woo = (x.workOrderNo || "").trim();
        if (woo) delayedWoos.add(woo);
      }
      const woo = (x.workOrderNo || "").trim();
      if (woo) {
        if (st === "scheduling_late" || x.blockedByCooperation) riskWoos.add(woo);
        if (st === "waiting_release" && hasSchedulingLateEarlierOnVp(x, allPlannerItems)) riskWoos.add(woo);
      }
      if (x.isCooperation && String(x.cooperationStatus ?? "").trim().toLowerCase() === "sent") {
        coopWaitingReturn += 1;
      }
    }

    return {
      utilizationPct,
      riskVpCount: riskWoos.size,
      blockedOps,
      delayedOrders: delayedWoos.size,
      coopWaitingReturn,
    };
  }, [data, orderedGanttMachines, allPlannerItems]);

  async function handleDragEnd(event: DragEndEvent) {
    setActiveDragItem(null);
    if (!canPlanningWrite) {
      // F2.2-fix-3: tell user why DnD didn't do anything
      setError("Nemáte oprávnění pro úpravy plánu.");
      return;
    }

    const overData = event.over?.data.current as
      | { type?: string; machineId?: number; queuePosition?: number; day?: string } // F2.2: day added
      | undefined;

    const activeData = event.active.data.current as { item?: PlannerGanttItem } | undefined;
    const item = activeData?.item;

    if (!item || !overData) {
      // F2.2-fix-3: silent drop outside valid target
      setError("Operace nebyla přesunuta — pusťte ji na konkrétní místo v Ganttu.");
      return;
    }
    if (overData.type !== "queue-slot") {
      // F2.2-fix-3: drop on non-droppable element
      setError("Operaci nelze umístit sem — vyberte slot v denním sloupci.");
      return;
    }

    const targetMachineId = Number(overData.machineId);
    const targetQueuePosition = Number(overData.queuePosition);
    const targetDay = overData.day; // F2.2: ISO date 'YYYY-MM-DD' or undefined

    if (!Number.isFinite(targetMachineId) || !Number.isFinite(targetQueuePosition)) {
      // F2.2-fix-3: drop target has invalid IDs (defensive)
      setError("Neplatný cíl přesunu.");
      return;
    }

    try {
      setMoving(true);
      setError("");
      await moveGanttOperation(item.operationId, targetMachineId, targetQueuePosition, targetDay);

      // F2.2-fix-3: auto-expand date range if targetDay is outside current window
      const expandedFromDate = targetDay && targetDay < fromDate ? targetDay : fromDate;
      const expandedToDate = targetDay && targetDay > toDate ? targetDay : toDate;
      const rangeChanged = expandedFromDate !== fromDate || expandedToDate !== toDate;

      if (rangeChanged) {
        // Date range expanded — useEffect on [fromDate, toDate] will fire loadData
        setFromDate(expandedFromDate);
        setToDate(expandedToDate);
      } else {
        // F2.2-fix-5: force gantt reload that bypasses ganttFetchSeq race guard
        // (same pattern as rebuildPlan in F2.2-fix-4)
        const mySeq = ++ganttFetchSeq.current;
        const result = await getPlannerGantt(fromDate, toDate);
        if (mySeq === ganttFetchSeq.current) {
          setData(result);
        }
      }
    } catch (e: any) {
      setError(e?.message || "Nepodarilo se presunout operaci.");
    } finally {
      setMoving(false);
    }
  }

  const plannerFilterInput: React.CSSProperties = {
    ...UI.inputs.base,
    padding: "8px 10px",
    fontSize: 13,
  };

  const ganttCardShell: React.CSSProperties = {
    background: ERP_COLORS.card,
    border: `1px solid ${ERP_COLORS.border}`,
    borderRadius: 14,
    boxShadow: "0 1px 2px rgba(15, 23, 42, 0.04)",
  };

  const laneRowKey = (m: PlannerGanttMachineGroup) => String(m.workplaceId ?? m.machineId);

  return (
    <>
      <PageContainer
        style={{
          paddingTop: 8,
          paddingRight: selectedItem ? 404 : 0,
          minWidth: 0,
          background: ERP_COLORS.pageBg,
          color: ERP_COLORS.textPrimary,
          fontFamily: FONT,
        }}
      >
        <PageHeader
          style={{
            paddingBottom: 12,
            borderBottom: `1px solid ${ERP_COLORS.border}`,
            marginBottom: 4,
          }}
          title={
            <div>
              <div style={{ ...UI.statLabel, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                Plánování
              </div>
              <div style={{ ...UI.pageTitle, marginTop: 4 }}>Planner Gantt</div>
            </div>
          }
          subtitle={
            <>
              <div style={{ ...UI.sectionSubtitle, marginTop: 4 }}>
                Výchozí rozsah 7 dní. Řádky pracovišť z knihovny (Planner); kiosk sdílí stejnou frontu podle pracoviště. Blok: op / WP → VP / GPN → další WP.
              </div>
              <div style={{ fontSize: 11, color: ERP_COLORS.textSecondary, marginTop: 6, fontWeight: 800 }}>
                DnD mezi řádky / frontu · detail = klik · tooltip = najetí myší.
              </div>
            </>
          }
          actions={
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end" }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 800, color: ERP_COLORS.textSecondary, marginBottom: 4 }}>Od</div>
                <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} style={plannerFilterInput} />
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 800, color: ERP_COLORS.textSecondary, marginBottom: 4 }}>Do</div>
                <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} style={plannerFilterInput} />
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 800, color: ERP_COLORS.textSecondary, marginBottom: 4 }}>Filtr stroj</div>
                <input
                  type="text"
                  value={machineFilter}
                  onChange={(e) => setMachineFilter(e.target.value)}
                  placeholder="napr. BETA, TC, PILA..."
                  style={{ ...plannerFilterInput, width: 200, minWidth: 0 }}
                />
              </div>
              <button
                type="button"
                onClick={() => void loadData()}
                disabled={loading || moving || rebuilding}
                style={{
                  ...UI.buttons.primary,
                  padding: "9px 14px",
                  opacity: loading || moving || rebuilding ? 0.55 : 1,
                }}
              >
                {loading ? "Nacitam..." : moving ? "Presouvam..." : "Obnovit data"}
              </button>
              {canPlanningWrite ? (
                <button
                  type="button"
                  onClick={() => void rebuildPlan()}
                  disabled={rebuilding || loading || moving}
                  title="Globální přepočet rozvrhu (POST /planning/rebuild-all)"
                  style={{
                    borderRadius: 10,
                    padding: "9px 14px",
                    fontWeight: 800,
                    fontSize: 13,
                    cursor: "pointer",
                    border: `1px solid ${ERP_COLORS.waitFg}`,
                    background: ERP_COLORS.waitBg,
                    color: ERP_COLORS.textPrimary,
                    opacity: rebuilding || loading || moving ? 0.55 : 1,
                  }}
                >
                  {rebuilding ? "Přepočítávám…" : "Přepočítat plán"}
                </button>
              ) : null}
            </div>
          }
        />

        {plannerCockpitKpis ? (
          <PageSection gapTop={10}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
                gap: 10,
              }}
            >
              {(
                [
                  ["Vytížení (orientační)", `${plannerCockpitKpis.utilizationPct}%`, "Řádky × dny × 8h vs. součet plánu"],
                  ["Rizikové VP", String(plannerCockpitKpis.riskVpCount), "Termín / blok kooperací / čekání"],
                  ["Blokované operace", String(plannerCockpitKpis.blockedOps), "Blokováno nebo blok kooperací"],
                  ["Zpožděné zakázky", String(plannerCockpitKpis.delayedOrders), "Unikátní VP se scheduling_late"],
                  ["Kooperace → návrat", String(plannerCockpitKpis.coopWaitingReturn), "Odesláno (sent), čeká na příjem"],
                ] as const
              ).map(([label, value, hint]) => (
                <div key={label} style={{ ...UI.summaryTile, minHeight: 0, padding: "12px 14px" }}>
                  <div style={UI.summaryTileLabel}>{label}</div>
                  <div style={{ ...UI.summaryTileValue, marginTop: 6, fontSize: 22, letterSpacing: "-0.02em" }}>{value}</div>
                  <div style={{ ...UI.summaryTileSubValue, marginTop: 4, lineHeight: 1.35 }}>{hint}</div>
                </div>
              ))}
            </div>
          </PageSection>
        ) : null}

        <PageSection gapTop={10}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", width: "100%" }}>
            {(
              [
                ["Čeká (ready)", plannerGanttBarColor("ready")],
                ["Čeká na uvolnění", plannerGanttBarColor("waiting_release")],
                ["Po termínu", plannerGanttBarColor("scheduling_late")],
                ["Naplánováno", plannerGanttBarColor("planned")],
                ["Běží", plannerGanttBarColor("bezi")],
                ["Hotovo", plannerGanttBarColor("hotovo")],
                ["Blokováno", plannerGanttBarColor("blokovano")],
                ["Kooperace", ERP_COLORS.waitFg],
              ] as const
            ).map(([label, color]) => (
              <div
                key={label}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  padding: "4px 10px",
                  borderRadius: 999,
                  fontSize: 11,
                  fontWeight: 900,
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                  border: `1px solid ${ERP_COLORS.border}`,
                  background: color,
                  color: "#fff",
                }}
              >
                {label}
              </div>
            ))}
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                padding: "4px 10px",
                borderRadius: 999,
                fontSize: 11,
                fontWeight: 800,
                border: `1px solid ${ERP_COLORS.waitFg}`,
                background: ERP_COLORS.waitBg,
                color: ERP_COLORS.textPrimary,
              }}
            >
              Čeká na materiál = zlatý obrys bloku
            </div>
          </div>

          {error ? (
            <div
              style={{
                marginTop: 12,
                padding: "10px 12px",
                borderRadius: 10,
                background: ERP_COLORS.problemBg,
                color: ERP_COLORS.problemFg,
                border: `1px solid rgba(220, 38, 38, 0.35)`,
                fontSize: 13,
                fontWeight: 800,
              }}
            >
              {error}
            </div>
          ) : null}
        </PageSection>

        <PageSection gapTop={10}>
          <DndContext
            sensors={sensors}
            onDragStart={(event) => {
              const item = (event.active.data.current as any)?.item as PlannerGanttItem | undefined;
              setActiveDragItem(item || null);
            }}
            onDragCancel={() => setActiveDragItem(null)}
            onDragEnd={handleDragEnd}
          >
            <div
              style={{
                ...ganttCardShell,
                overflow: "hidden",
                width: "100%",
                boxSizing: "border-box",
              }}
            >
              <div
                ref={chartScrollRef}
                style={{
                  overflow: "auto",
                  maxHeight: "calc(100vh - 280px)",
                  scrollbarGutter: "stable",
                }}
              >
                <div
                  style={{
                    minWidth: LEFT_COL_WIDTH + (data?.days.length || 7) * dayColWidth,
                  }}
                >
                  <div
                    style={{
                      position: "sticky",
                      top: 0,
                      zIndex: 20,
                      display: "flex",
                      background: ERP_COLORS.tableHeadBg,
                      borderBottom: `1px solid ${ERP_COLORS.divider}`,
                      minHeight: HEADER_HEIGHT,
                    }}
                  >
                    <div
                      style={{
                        width: LEFT_COL_WIDTH,
                        minWidth: LEFT_COL_WIDTH,
                        padding: "6px 8px",
                        fontWeight: 900,
                        fontSize: 10,
                        letterSpacing: "0.06em",
                        textTransform: "uppercase",
                        borderRight: `1px solid ${ERP_COLORS.divider}`,
                        background: ERP_COLORS.tableHeadBg,
                        position: "sticky",
                        left: 0,
                        zIndex: 30,
                        display: "flex",
                        alignItems: "center",
                        boxSizing: "border-box",
                        color: ERP_COLORS.tableHeadText,
                      }}
                    >
                      Pracoviště
                    </div>

                    {data?.days.map((day) => (
                      <div
                        key={day}
                        style={{
                          width: dayColWidth,
                          minWidth: dayColWidth,
                          padding: "6px 2px",
                          textAlign: "center",
                          fontWeight: 800,
                          fontSize: 10,
                          letterSpacing: "0.04em",
                          color: ERP_COLORS.textSecondary,
                          borderRight: `1px solid ${ERP_COLORS.divider}`,
                          boxSizing: "border-box",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          background: `repeating-linear-gradient(90deg, transparent, transparent 23px, ${ERP_COLORS.divider} 23px, ${ERP_COLORS.divider} 24px), ${ERP_COLORS.card}`,
                        }}
                      >
                        {new Date(`${day}T00:00:00`).toLocaleDateString("cs-CZ", {
                          weekday: "short",
                          day: "2-digit",
                          month: "2-digit",
                        })}
                      </div>
                    ))}
                  </div>

                  {!data && !loading ? (
                    <div style={{ padding: 14, color: ERP_COLORS.textSecondary, fontSize: 13 }}>Zatím nejsou načtena data.</div>
                  ) : null}

                  {orderedGanttMachines.map((machine) => {
                    const days = data?.days ?? [];
                    const width = days.length * dayColWidth;
                    const expandedForCells = expandPlannerGanttItemsForCells(machine.items);
                    const byDay = groupItemsByVisibleDay(expandedForCells, days);
                    const maxStack = maxDayStackCount(byDay, days);
                    const minBlockH = LANE_HEIGHT - 2;
                    const rowBodyHeight = stackedRowMinHeightPx(maxStack, minBlockH);
                    const globalOrder = plannerGlobalMachineOrder(machine.items);
                    const lk = laneRowKey(machine);
                    const laneHover = hoverLaneKey === lk;
                    // F2.2-fix: per-day columns for empty machines too — each day is its own drop zone with target_day

                    return (
                      <div
                        key={machine.workplaceId ?? machine.machineId}
                        onMouseEnter={() => setHoverLaneKey(lk)}
                        onMouseLeave={() => setHoverLaneKey(null)}
                        style={{
                          display: "flex",
                          borderBottom: `1px solid ${ERP_COLORS.divider}`,
                          background: laneHover ? ERP_COLORS.primaryLight : ERP_COLORS.card,
                          transition: "background 120ms ease",
                        }}
                      >
                        <div
                          style={{
                            width: LEFT_COL_WIDTH,
                            minWidth: LEFT_COL_WIDTH,
                            padding: "6px 8px",
                            borderRight: `1px solid ${ERP_COLORS.divider}`,
                            background: ERP_COLORS.tableHeadBg,
                            position: "sticky",
                            left: 0,
                            zIndex: 15,
                            boxSizing: "border-box",
                            alignSelf: "stretch",
                          }}
                        >
                          <div style={{ fontWeight: 800, color: ERP_COLORS.textPrimary, fontSize: 12, lineHeight: 1.25 }}>
                            {machine.machineName}
                          </div>
                          <div style={{ fontSize: 10, color: ERP_COLORS.textSecondary, marginTop: 2, fontWeight: 600 }}>
                            {(machine.workplaceCode || "").toUpperCase() || "—"} · {machine.items.length} op.
                            {expandedForCells.length !== machine.items.length
                              ? ` · ${expandedForCells.length} bloků`
                              : ""}
                          </div>
                        </div>

                        <div
                          style={{
                            display: "flex",
                            flexDirection: "row",
                            alignItems: "stretch",
                            width,
                            minHeight: rowBodyHeight,
                            boxSizing: "border-box",
                          }}
                        >
                          {days.map((day) => (
                            <PlannerGanttDayColumn
                              key={`${machine.machineId}-${day}`}
                              day={day}
                              machineId={machine.machineId}
                              dayColWidth={dayColWidth}
                              rowMinHeight={rowBodyHeight}
                              items={byDay.get(day) ?? []}
                              globalOrder={globalOrder}
                              activeDragItemKey={
                                activeDragItem ? ganttCellItemKey(activeDragItem) : null
                              }
                              selectedOperationId={selectedItem?.operationId ?? null}
                              onSelect={(cellItem) => {
                                const canonical = allPlannerItems.find(
                                  (x) => x.operationId === cellItem.operationId
                                );
                                setSelectedItem(canonical ?? cellItem);
                              }}
                              stackGapPx={STACK_CELL_GAP_PX}
                              cellPadPx={STACK_CELL_PAD_PX}
                              minBlockHeight={minBlockH}
                            />
                          ))}
                        </div>
                      </div>
                    );
                  })}

                  {data && orderedGanttMachines.length === 0 ? (
                    <div style={{ padding: 14, color: ERP_COLORS.textSecondary, fontSize: 13 }}>
                      {machineFilter.trim()
                        ? "Filtru neodpovídá žádné pracoviště."
                        : "Žádné operace v plánovacím horizontu (žádné plánovatelné řádky nebo prázdný plán)."}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>

            <div
              style={{
                marginTop: 12,
                ...ganttCardShell,
                padding: 14,
                width: "100%",
                boxSizing: "border-box",
              }}
            >
              <div style={{ fontSize: 16, fontWeight: 900, color: ERP_COLORS.textPrimary, marginBottom: 10 }}>
                Nenaplanovane operace
              </div>

              {!data || (data.unscheduledItems?.length ?? 0) === 0 ? (
                <div style={{ color: ERP_COLORS.textSecondary, fontSize: 13 }}>Zadne nenaplanovane operace.</div>
              ) : (
                <div style={{ overflowX: "auto", width: "100%" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: "100%" }}>
                    <thead>
                      <tr style={{ background: ERP_COLORS.tableHeadBg }}>
                        {["VP", "GPN", "Operace", "Stroj", "Materiál", "Qty", "Fronta", "Status"].map((h) => (
                          <th
                            key={h}
                            style={{
                              textAlign: "left",
                              padding: "8px 10px",
                              borderBottom: `1px solid ${ERP_COLORS.divider}`,
                              color: ERP_COLORS.tableHeadText,
                              fontWeight: 800,
                              fontSize: 11,
                              textTransform: "uppercase",
                              letterSpacing: "0.06em",
                            }}
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {data.unscheduledItems.map((item) => (
                        <tr
                          key={item.operationId}
                          onClick={() => setSelectedItem(item)}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.background = ROW_HOVER;
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background = item.materialReady
                              ? "transparent"
                              : "rgba(245, 158, 11, 0.06)";
                          }}
                          style={{
                            cursor: "pointer",
                            background: item.materialReady ? "transparent" : "rgba(245, 158, 11, 0.06)",
                            boxShadow: item.materialReady ? undefined : `inset 3px 0 0 ${ERP_COLORS.waitFg}`,
                          }}
                        >
                          <td style={{ padding: "8px 10px", borderBottom: `1px solid ${ERP_COLORS.divider}`, color: ERP_COLORS.textPrimary }}>
                            {item.workOrderNo ?? "-"}
                          </td>
                          <td style={{ padding: "8px 10px", borderBottom: `1px solid ${ERP_COLORS.divider}`, color: ERP_COLORS.textPrimary }}>
                            {item.gpn ?? "-"}
                          </td>
                          <td style={{ padding: "8px 10px", borderBottom: `1px solid ${ERP_COLORS.divider}`, color: ERP_COLORS.textPrimary }}>
                            {item.operationName}
                          </td>
                          <td style={{ padding: "8px 10px", borderBottom: `1px solid ${ERP_COLORS.divider}`, color: ERP_COLORS.textPrimary }}>
                            {item.machineName}
                          </td>
                          <td style={{ padding: "8px 10px", borderBottom: `1px solid ${ERP_COLORS.divider}`, fontWeight: 800 }}>
                            <span style={{ color: item.materialReady ? ERP_COLORS.okFg : ERP_COLORS.waitFg }}>
                              {item.materialReady ? "Připraven" : "Čeká"}
                            </span>
                          </td>
                          <td style={{ padding: "8px 10px", borderBottom: `1px solid ${ERP_COLORS.divider}`, color: ERP_COLORS.textPrimary }}>
                            {item.qty}
                          </td>
                          <td style={{ padding: "8px 10px", borderBottom: `1px solid ${ERP_COLORS.divider}`, color: ERP_COLORS.textPrimary }}>
                            {item.queuePosition ?? "-"}
                          </td>
                          <td style={{ padding: "8px 10px", borderBottom: `1px solid ${ERP_COLORS.divider}` }}>
                            <span
                              style={{
                                display: "inline-block",
                                padding: "4px 8px",
                                borderRadius: 999,
                                color: "#fff",
                                background: plannerGanttItemColor(item),
                                fontSize: 11,
                                fontWeight: 800,
                              }}
                            >
                              {plannerGanttStatusLabel(item.status, {
                                item,
                                allItems: allPlannerItems,
                              })}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <DragOverlay>
              {activeDragItem ? <OverlayBar item={activeDragItem} /> : null}
            </DragOverlay>
          </DndContext>
        </PageSection>
      </PageContainer>

      <OperationDetailPanel
        item={selectedItem}
        allItems={allPlannerItems}
        onClose={() => setSelectedItem(null)}
        onSaved={loadData}
        onOpenProductionOrder={onOpenProductionOrder}
        onOpenMaterialRequirements={onOpenMaterialRequirements}
        canPlanningWrite={canPlanningWrite}
      />
    </>
  );
}
