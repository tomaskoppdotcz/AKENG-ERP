import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  PointerSensor,
  useDroppable,
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
  plannerGanttBarColor,
  plannerGanttItemColor,
  plannerGanttStatusLabel,
} from "../utils/plannerGanttStatus";
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
  return (
    <div
      title={plannerGanttHoverDetails(item)}
      style={{
        minWidth: 200,
        maxWidth: 320,
        minHeight: LANE_HEIGHT + 8,
        borderRadius: 6,
        padding: "6px 10px",
        background: plannerGanttItemColor(item),
        color: "#fff",
        overflow: "hidden",
        boxSizing: "border-box",
        boxShadow: item.materialReady
          ? "0 8px 24px rgba(15,23,42,0.28)"
          : "0 8px 24px rgba(15,23,42,0.28), inset 0 0 0 1px rgba(251,191,36,0.95)",
        border: "1px solid rgba(255,255,255,0.35)",
      }}
    >
      <PlannerGanttOperationBlock item={item} />
    </div>
  );
}

function EmptyMachineDrop({
  machineId,
  width,
}: {
  machineId: number;
  width: number;
}) {
  const { isOver, setNodeRef } = useDroppable({
    id: `slot-${machineId}-1`,
    data: {
      type: "queue-slot",
      machineId,
      queuePosition: 1,
    },
  });

  return (
    <div
      ref={setNodeRef}
      style={{
        padding: "6px 8px",
        color: isOver ? "#1d4ed8" : "#94a3b8",
        fontSize: 11,
        minHeight: LANE_HEIGHT + 8,
        width,
        background: isOver ? "rgba(59,130,246,0.08)" : undefined,
        outline: isOver ? "1px dashed #3b82f6" : "none",
        outlineOffset: -2,
      }}
    >
      Přetáhnout sem…
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
        borderBottom: "1px solid #f1f5f9",
        fontSize: 14,
      }}
    >
      <div style={{ color: "#64748b", fontWeight: 700 }}>{label}</div>
      <div style={{ color: "#0f172a", fontWeight: 600, wordBreak: "break-word" }}>{value}</div>
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
        background: "#fff",
        borderLeft: "1px solid #dbe2ea",
        boxShadow: "-8px 0 24px rgba(15,23,42,0.10)",
        zIndex: 1200,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          padding: 20,
          borderBottom: "1px solid #e2e8f0",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
        }}
      >
        <div>
          <div style={{ fontSize: 20, fontWeight: 900, color: "#0f172a" }}>Detail operace</div>
          <div style={{ fontSize: 13, color: "#64748b", marginTop: 4 }}>
            {item.operationName} | {item.machineName}
          </div>
        </div>

        <button
          onClick={onClose}
          style={{
            border: "1px solid #cbd5e1",
            background: "#fff",
            color: "#0f172a",
            borderRadius: 10,
            padding: "8px 12px",
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          Zavrit
        </button>
      </div>

      <div style={{ padding: 20, overflowY: "auto" }}>
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
            <div style={{ fontSize: 13, fontWeight: 800, color: "#334155", marginBottom: 8 }}>
              Plánované segmenty
            </div>
            <div
              style={{
                border: "1px solid #e2e8f0",
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
                      borderBottom: "1px solid #f1f5f9",
                      background: "#fafafa",
                    }}
                  >
                    <div style={{ fontWeight: 800, color: "#0f172a" }}>
                      Segment {s.segmentIndex + 1}
                      {item.scheduleSegments!.length > 1 ? ` / ${item.scheduleSegments!.length}` : ""}
                    </div>
                    <div style={{ color: "#475569" }}>
                      <span style={{ fontWeight: 700 }}>{dateStr}</span>
                      {" · "}
                      {fromTo}
                    </div>
                    <div style={{ color: "#64748b" }}>
                      {item.machineName}
                      {s.machineId !== item.machineId ? ` (stroj #${s.machineId})` : ""}
                    </div>
                    <div style={{ color: "#64748b", fontWeight: 600 }}>{s.durationMin} min</div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

        <DetailRow
          label="Materiál"
          value={
            <span style={{ color: item.materialReady ? "#15803d" : "#c2410c", fontWeight: 800 }}>
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
                border: "1px solid #2563eb",
                background: "#eff6ff",
                color: "#1e40af",
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
                border: "1px solid #c2410c",
                background: "#fff7ed",
                color: "#9a3412",
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
            <div style={{ fontSize: 13, fontWeight: 800, color: "#334155", marginBottom: 6 }}>Status</div>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              disabled={!canPlanningWrite}
              style={{
                width: "100%",
                border: "1px solid #cbd5e1",
                borderRadius: 10,
                padding: "10px 12px",
                fontSize: 14,
                background: "#fff",
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
              color: "#0f172a",
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
              color: "#0f172a",
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
            onClick={handleSave}
            disabled={saving || !canPlanningWrite}
            style={{
              border: "1px solid #0f172a",
              background: "#0f172a",
              color: "#fff",
              borderRadius: 10,
              padding: "11px 14px",
              fontWeight: 800,
              cursor: "pointer",
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
                color: message === "Ulozeno." ? "#15803d" : "#b91c1c",
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
  const [activeDragItem, setActiveDragItem] = useState<PlannerGanttItem | null>(null);
  const [selectedItem, setSelectedItem] = useState<PlannerGanttItem | null>(null);
  const chartScrollRef = useRef<HTMLDivElement>(null);
  const [dayColWidth, setDayColWidth] = useState(96);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 6,
      },
    })
  );

  const erpRole = useMemo(() => readStoredErpRole(), []);
  const canPlanningWrite = canPerformAction(erpRole, "planning.write");

  async function loadData() {
    try {
      setLoading(true);
      setError("");
      const result = await getPlannerGantt(fromDate, toDate);
      setData(result);

      if (selectedItem) {
        const allItems = [
          ...result.machines.flatMap((m) => m.items),
          ...result.unscheduledItems,
        ];
        const updatedSelected = allItems.find((x) => x.operationId === selectedItem.operationId) || null;
        setSelectedItem(updatedSelected);
      }
    } catch (e: any) {
      setError(e?.message || "Nepodarilo se nacist Planner Gantt.");
    } finally {
      setLoading(false);
    }
  }

  async function rebuildPlan() {
    if (!canPlanningWrite) return;
    try {
      setRebuilding(true);
      setError("");
      await rebuildPlanningAll();
      await loadData();
    } catch (e: any) {
      setError(e?.message || "Nepodařilo se přepočítat plán.");
    } finally {
      setRebuilding(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, [fromDate, toDate]);

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

  async function handleDragEnd(event: DragEndEvent) {
    setActiveDragItem(null);
    if (!canPlanningWrite) return;

    const overData = event.over?.data.current as
      | { type?: string; machineId?: number; queuePosition?: number }
      | undefined;

    const activeData = event.active.data.current as { item?: PlannerGanttItem } | undefined;
    const item = activeData?.item;

    if (!item || !overData) return;
    if (overData.type !== "queue-slot") return;

    const targetMachineId = Number(overData.machineId);
    const targetQueuePosition = Number(overData.queuePosition);

    if (!Number.isFinite(targetMachineId) || !Number.isFinite(targetQueuePosition)) return;

    try {
      setMoving(true);
      setError("");
      await moveGanttOperation(item.operationId, targetMachineId, targetQueuePosition);
      await loadData();
    } catch (e: any) {
      setError(e?.message || "Nepodarilo se presunout operaci.");
    } finally {
      setMoving(false);
    }
  }

  return (
    <>
      <PageContainer style={{ paddingTop: 10, paddingRight: selectedItem ? 404 : 0, minWidth: 0 }}>
        <PageHeader
          title="Planner Gantt"
          subtitle={
            <>
              <div style={{ fontSize: 13, color: "#64748b", marginTop: 0 }}>
                Výchozí rozsah 7 dní. Řádky pracovišť z knihovny (Planner); kiosk sdílí stejnou frontu podle pracoviště. Blok: op / WP → VP / GPN → další WP.
              </div>
              <div style={{ fontSize: 11, color: "#334155", marginTop: 6, fontWeight: 700 }}>
                DnD mezi řádky / frontu · detail = klik · tooltip = najetí myší.
              </div>
            </>
          }
          actions={
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "end" }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#334155", marginBottom: 6 }}>Od</div>
                <input
                  type="date"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  style={{
                    border: "1px solid #cbd5e1",
                    borderRadius: 12,
                    padding: "10px 12px",
                    fontSize: 14,
                    background: "#fff",
                  }}
                />
              </div>

              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#334155", marginBottom: 6 }}>Do</div>
                <input
                  type="date"
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                  style={{
                    border: "1px solid #cbd5e1",
                    borderRadius: 12,
                    padding: "10px 12px",
                    fontSize: 14,
                    background: "#fff",
                  }}
                />
              </div>

              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#334155", marginBottom: 6 }}>Filtr stroj</div>
                <input
                  type="text"
                  value={machineFilter}
                  onChange={(e) => setMachineFilter(e.target.value)}
                  placeholder="napr. BETA, TC, PILA..."
                  style={{
                    width: 220,
                    minWidth: 0,
                    border: "1px solid #cbd5e1",
                    borderRadius: 12,
                    padding: "10px 12px",
                    fontSize: 14,
                    background: "#fff",
                  }}
                />
              </div>

              <button
                type="button"
                onClick={() => void loadData()}
                disabled={loading || moving || rebuilding}
                style={{
                  border: "1px solid #0f172a",
                  background: "#0f172a",
                  color: "#fff",
                  borderRadius: 12,
                  padding: "11px 16px",
                  fontWeight: 800,
                  cursor: "pointer",
                  opacity: loading || moving || rebuilding ? 0.6 : 1,
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
                    border: "1px solid #b45309",
                    background: "#fffbeb",
                    color: "#92400e",
                    borderRadius: 12,
                    padding: "11px 16px",
                    fontWeight: 800,
                    cursor: "pointer",
                    opacity: rebuilding || loading || moving ? 0.6 : 1,
                  }}
                >
                  {rebuilding ? "Přepočítávám…" : "Přepočítat plán"}
                </button>
              ) : null}
            </div>
          }
        />

        <PageSection gapTop={12}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", width: "100%" }}>
            {[
              ["Čeká (ready)", "#94a3b8"],
              ["Čeká na uvolnění", "#6d28d9"],
              ["Po termínu", "#be123c"],
              ["Naplánováno", "#f59e0b"],
              ["Běží", "#3b82f6"],
              ["Hotovo", "#10b981"],
              ["Blokováno", "#ef4444"],
            ].map(([label, color]) => (
              <div
                key={label}
                style={{
                  padding: "6px 10px",
                  borderRadius: 999,
                  fontSize: 12,
                  fontWeight: 700,
                  color: "#fff",
                  background: color,
                }}
              >
                {label}
              </div>
            ))}
            <div
              style={{
                padding: "6px 10px",
                borderRadius: 999,
                fontSize: 12,
                fontWeight: 700,
                color: "#0f172a",
                background: "#ffedd5",
                border: "1px solid #fb923c",
              }}
            >
              Čeká na materiál = zlatý obrys bloku
            </div>
          </div>

          {error ? (
            <div
              style={{
                marginTop: 16,
                padding: "12px 14px",
                borderRadius: 12,
                background: "#fef2f2",
                color: "#b91c1c",
                border: "1px solid #fecaca",
                fontSize: 14,
                fontWeight: 700,
              }}
            >
              {error}
            </div>
          ) : null}
        </PageSection>

        <PageSection>
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
                background: "#fff",
                border: "1px solid #dbe2ea",
                borderRadius: 20,
                overflow: "hidden",
                boxShadow: "0 1px 2px rgba(15,23,42,0.05)",
                width: "100%",
                boxSizing: "border-box",
              }}
            >
              <div
                ref={chartScrollRef}
                style={{
                  overflow: "auto",
                  maxHeight: "calc(100vh - 200px)",
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
                      background: "#e8eef4",
                      borderBottom: "1px solid #cbd5e1",
                      minHeight: HEADER_HEIGHT,
                    }}
                  >
                    <div
                      style={{
                        width: LEFT_COL_WIDTH,
                        minWidth: LEFT_COL_WIDTH,
                        padding: "6px 8px",
                        fontWeight: 900,
                        fontSize: 11,
                        borderRight: "1px solid #cbd5e1",
                        background: "#f1f5f9",
                        position: "sticky",
                        left: 0,
                        zIndex: 30,
                        display: "flex",
                        alignItems: "center",
                        boxSizing: "border-box",
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
                          fontSize: 11,
                          color: "#334155",
                          borderRight: "1px solid #dbe2ea",
                          boxSizing: "border-box",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
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
                    <div style={{ padding: 16, color: "#64748b", fontSize: 13 }}>Zatím nejsou načtena data.</div>
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

                    return (
                      <div
                        key={machine.workplaceId ?? machine.machineId}
                        style={{
                          display: "flex",
                          borderBottom: "1px solid #e2e8f0",
                        }}
                      >
                        <div
                          style={{
                            width: LEFT_COL_WIDTH,
                            minWidth: LEFT_COL_WIDTH,
                            padding: "6px 8px",
                            borderRight: "1px solid #e2e8f0",
                            background: "#fff",
                            position: "sticky",
                            left: 0,
                            zIndex: 15,
                            boxSizing: "border-box",
                            alignSelf: "stretch",
                          }}
                        >
                          <div style={{ fontWeight: 800, color: "#0f172a", fontSize: 12, lineHeight: 1.25 }}>
                            {machine.machineName}
                          </div>
                          <div style={{ fontSize: 10, color: "#64748b", marginTop: 2, fontWeight: 600 }}>
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
                          {machine.items.length === 0 ? (
                            <EmptyMachineDrop machineId={machine.machineId} width={width} />
                          ) : (
                            days.map((day) => (
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
                            ))
                          )}
                        </div>
                      </div>
                    );
                  })}

                  {data && orderedGanttMachines.length === 0 ? (
                    <div style={{ padding: 16, color: "#64748b", fontSize: 13 }}>Filtru neodpovídá žádné pracoviště.</div>
                  ) : null}
                </div>
              </div>
            </div>

            <div
              style={{
                background: "#fff",
                border: "1px solid #dbe2ea",
                borderRadius: 20,
                padding: 20,
                boxShadow: "0 1px 2px rgba(15,23,42,0.05)",
                width: "100%",
                boxSizing: "border-box",
              }}
            >
              <div style={{ fontSize: 22, fontWeight: 900, color: "#0f172a", marginBottom: 12 }}>
                Nenaplanovane operace
              </div>

              {!data || data.unscheduledItems.length === 0 ? (
                <div style={{ color: "#64748b", fontSize: 14 }}>Zadne nenaplanovane operace.</div>
              ) : (
                <div style={{ overflowX: "auto", width: "100%" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14, minWidth: "100%" }}>
                    <thead>
                      <tr style={{ background: "#f8fafc" }}>
                        {["VP", "GPN", "Operace", "Stroj", "Materiál", "Qty", "Fronta", "Status"].map((h) => (
                          <th
                            key={h}
                            style={{
                              textAlign: "left",
                              padding: "10px 12px",
                              borderBottom: "1px solid #e2e8f0",
                              color: "#334155",
                              fontWeight: 800,
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
                          style={{
                            cursor: "pointer",
                            background: item.materialReady ? undefined : "#fff7ed",
                            boxShadow: item.materialReady ? undefined : "inset 3px 0 0 #ea580c",
                          }}
                        >
                          <td style={{ padding: "10px 12px", borderBottom: "1px solid #f1f5f9" }}>{item.workOrderNo ?? "-"}</td>
                          <td style={{ padding: "10px 12px", borderBottom: "1px solid #f1f5f9" }}>{item.gpn ?? "-"}</td>
                          <td style={{ padding: "10px 12px", borderBottom: "1px solid #f1f5f9" }}>{item.operationName}</td>
                          <td style={{ padding: "10px 12px", borderBottom: "1px solid #f1f5f9" }}>{item.machineName}</td>
                          <td style={{ padding: "10px 12px", borderBottom: "1px solid #f1f5f9", fontWeight: 800 }}>
                            <span style={{ color: item.materialReady ? "#15803d" : "#c2410c" }}>
                              {item.materialReady ? "Připraven" : "Čeká"}
                            </span>
                          </td>
                          <td style={{ padding: "10px 12px", borderBottom: "1px solid #f1f5f9" }}>{item.qty}</td>
                          <td style={{ padding: "10px 12px", borderBottom: "1px solid #f1f5f9" }}>{item.queuePosition ?? "-"}</td>
                          <td style={{ padding: "10px 12px", borderBottom: "1px solid #f1f5f9" }}>
                            <span
                              style={{
                                display: "inline-block",
                                padding: "4px 8px",
                                borderRadius: 999,
                                color: "#fff",
                                background: plannerGanttItemColor(item),
                                fontSize: 12,
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
