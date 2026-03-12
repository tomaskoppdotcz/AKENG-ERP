import React, { useEffect, useMemo, useState } from "react";
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { getPlannerGantt, moveGanttOperation, PlannerGanttItem, PlannerGanttMachineGroup, PlannerGanttResponse } from "../services/plannerApi";

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

function startOfDay(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00`);
}

function endOfDay(dateStr: string): Date {
  return new Date(`${dateStr}T23:59:59`);
}

function diffMinutes(a: Date, b: Date): number {
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 60000));
}

function clampDate(date: Date, min: Date, max: Date): Date {
  if (date < min) return min;
  if (date > max) return max;
  return date;
}

function statusColor(status: string): string {
  switch ((status || "").toLowerCase()) {
    case "hotovo":
      return "#10b981";
    case "bezi":
      return "#3b82f6";
    case "blokovano":
      return "#ef4444";
    case "ceka":
      return "#94a3b8";
    case "naplanovano":
    default:
      return "#f59e0b";
  }
}

function statusLabel(status: string): string {
  switch ((status || "").toLowerCase()) {
    case "hotovo":
      return "Hotovo";
    case "bezi":
      return "Bezi";
    case "blokovano":
      return "Blokovano";
    case "ceka":
      return "Ceka";
    case "naplanovano":
      return "Naplanovano";
    default:
      return status || "-";
  }
}

const LEFT_COL_WIDTH = 240;
const DAY_COL_WIDTH = 150;
const ROW_STEP = 56;

type GanttBarProps = {
  item: PlannerGanttItem;
  visibleFrom: Date;
  visibleTo: Date;
  totalMinutes: number;
  isDragging?: boolean;
};

function BarContent({ item, compact = false }: { item: PlannerGanttItem; compact?: boolean }) {
  return (
    <>
      <div
        style={{
          fontWeight: 800,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          fontSize: compact ? 11 : 12,
        }}
      >
        {item.operationName}
      </div>
      <div
        style={{
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          opacity: 0.95,
          fontSize: compact ? 10 : 12,
        }}
      >
        {item.workOrderNo ?? "-"} | {item.gpn ?? "-"} | {statusLabel(item.status)}
      </div>
    </>
  );
}

function DraggableGanttBar({ item, visibleFrom, visibleTo, totalMinutes, isDragging = false }: GanttBarProps) {
  if (!item.plannedStart || !item.plannedEnd) return null;

  const itemStart = new Date(item.plannedStart);
  const itemEnd = new Date(item.plannedEnd);

  const barStart = clampDate(itemStart, visibleFrom, visibleTo);
  const barEnd = clampDate(itemEnd, visibleFrom, visibleTo);

  const offsetMin = diffMinutes(visibleFrom, barStart);
  const durationMin = Math.max(30, diffMinutes(barStart, barEnd));

  const leftPct = (offsetMin / totalMinutes) * 100;
  const widthPct = (durationMin / totalMinutes) * 100;

  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id: `op-${item.operationId}`,
    data: {
      type: "planning-operation",
      item,
    },
  });

  const dragTransform = transform
    ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
    : undefined;

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      title={[
        `VP: ${item.workOrderNo ?? "-"}`,
        `GPN: ${item.gpn ?? "-"}`,
        `Operace: ${item.operationName}`,
        `Stroj: ${item.machineName}`,
        `Fronta: ${item.queuePosition ?? "-"}`,
        `Od: ${item.plannedStart ? new Date(item.plannedStart).toLocaleString("cs-CZ") : "-"}`,
        `Do: ${item.plannedEnd ? new Date(item.plannedEnd).toLocaleString("cs-CZ") : "-"}`,
        `Status: ${statusLabel(item.status)}`,
        `Qty: ${item.qty}`,
      ].join("\n")}
      style={{
        position: "absolute",
        top: 8,
        left: `${leftPct}%`,
        width: `${widthPct}%`,
        minWidth: 120,
        height: 44,
        borderRadius: 12,
        padding: "6px 10px",
        background: statusColor(item.status),
        color: "#fff",
        overflow: "hidden",
        boxShadow: "0 4px 12px rgba(15,23,42,0.12)",
        fontSize: 12,
        cursor: "grab",
        touchAction: "none",
        opacity: isDragging ? 0.35 : 1,
        transform: dragTransform,
        zIndex: transform ? 1000 : 2,
      }}
    >
      <BarContent item={item} />
    </div>
  );
}

function OverlayBar({ item }: { item: PlannerGanttItem }) {
  return (
    <div
      style={{
        minWidth: 220,
        maxWidth: 280,
        height: 52,
        borderRadius: 12,
        padding: "8px 10px",
        background: statusColor(item.status),
        color: "#fff",
        overflow: "hidden",
        boxShadow: "0 12px 32px rgba(15,23,42,0.28)",
        fontSize: 12,
        border: "2px solid rgba(255,255,255,0.45)",
      }}
    >
      <BarContent item={item} compact />
    </div>
  );
}

function DropSlot({
  machineId,
  queuePosition,
  top,
  width,
}: {
  machineId: number;
  queuePosition: number;
  top: number;
  width: number;
}) {
  const { isOver, setNodeRef } = useDroppable({
    id: `slot-${machineId}-${queuePosition}`,
    data: {
      type: "queue-slot",
      machineId,
      queuePosition,
    },
  });

  return (
    <div
      ref={setNodeRef}
      style={{
        position: "absolute",
        left: 0,
        top,
        width,
        height: 14,
        zIndex: 5,
        background: isOver ? "rgba(59,130,246,0.18)" : "transparent",
        borderTop: isOver ? "3px solid #3b82f6" : "3px solid transparent",
        borderRadius: 8,
        transition: "all 120ms ease",
      }}
    />
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
        padding: 18,
        color: isOver ? "#1d4ed8" : "#94a3b8",
        fontSize: 14,
        minHeight: 72,
        width,
        background: isOver ? "rgba(59,130,246,0.08)" : undefined,
        outline: isOver ? "2px dashed #3b82f6" : "none",
        outlineOffset: -4,
      }}
    >
      Sem muzes pretahnout operaci.
    </div>
  );
}

export default function PlannerPage() {
  const today = new Date();
  const defaultFrom = formatDateInput(today);
  const defaultTo = formatDateInput(addDays(today, 14));

  const [fromDate, setFromDate] = useState(defaultFrom);
  const [toDate, setToDate] = useState(defaultTo);
  const [data, setData] = useState<PlannerGanttResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [moving, setMoving] = useState(false);
  const [error, setError] = useState("");
  const [machineFilter, setMachineFilter] = useState("");
  const [activeItem, setActiveItem] = useState<PlannerGanttItem | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 6,
      },
    })
  );

  async function loadData() {
    try {
      setLoading(true);
      setError("");
      const result = await getPlannerGantt(fromDate, toDate);
      setData(result);
    } catch (e: any) {
      setError(e?.message || "Nepodarilo se nacist Planner Gantt.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  const filteredMachines = useMemo(() => {
    if (!data) return [];
    const q = machineFilter.trim().toLowerCase();
    if (!q) return data.machines;
    return data.machines.filter((m) => m.machineName.toLowerCase().includes(q));
  }, [data, machineFilter]);

  const visibleFrom = useMemo(() => startOfDay(fromDate), [fromDate]);
  const visibleTo = useMemo(() => endOfDay(toDate), [toDate]);
  const totalMinutes = useMemo(() => Math.max(1, diffMinutes(visibleFrom, visibleTo)), [visibleFrom, visibleTo]);

  async function handleDragEnd(event: DragEndEvent) {
    setActiveItem(null);

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
    <div style={{ minHeight: "100vh", background: "#f8fafc", padding: 24 }}>
      <div style={{ maxWidth: 1800, margin: "0 auto", display: "grid", gap: 20 }}>
        <div
          style={{
            background: "#fff",
            border: "1px solid #dbe2ea",
            borderRadius: 20,
            padding: 20,
            boxShadow: "0 1px 2px rgba(15,23,42,0.05)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: 28, fontWeight: 900, color: "#0f172a" }}>Planner Gantt</div>
              <div style={{ fontSize: 14, color: "#64748b", marginTop: 6 }}>
                Vizualni prehled planovanych operaci podle stroju.
              </div>
              <div style={{ fontSize: 12, color: "#334155", marginTop: 10, fontWeight: 700 }}>
                Drag & Drop: pretahni operaci mezi stroji nebo na jinou pozici ve stejnem stroji.
              </div>
            </div>

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
                    border: "1px solid #cbd5e1",
                    borderRadius: 12,
                    padding: "10px 12px",
                    fontSize: 14,
                    background: "#fff",
                  }}
                />
              </div>

              <button
                onClick={loadData}
                disabled={loading || moving}
                style={{
                  border: "1px solid #0f172a",
                  background: "#0f172a",
                  color: "#fff",
                  borderRadius: 12,
                  padding: "11px 16px",
                  fontWeight: 800,
                  cursor: "pointer",
                  opacity: loading || moving ? 0.6 : 1,
                }}
              >
                {loading ? "Nacitam..." : moving ? "Presouvam..." : "Nacist Gantt"}
              </button>
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 16 }}>
            {[
              ["Ceka", "#94a3b8"],
              ["Naplanovano", "#f59e0b"],
              ["Bezi", "#3b82f6"],
              ["Hotovo", "#10b981"],
              ["Blokovano", "#ef4444"],
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
        </div>

        <DndContext
          sensors={sensors}
          onDragStart={(event) => {
            const item = (event.active.data.current as any)?.item as PlannerGanttItem | undefined;
            setActiveItem(item || null);
          }}
          onDragCancel={() => setActiveItem(null)}
          onDragEnd={handleDragEnd}
        >
          <div
            style={{
              background: "#fff",
              border: "1px solid #dbe2ea",
              borderRadius: 20,
              overflow: "hidden",
              boxShadow: "0 1px 2px rgba(15,23,42,0.05)",
            }}
          >
            <div style={{ overflow: "auto", maxHeight: "65vh" }}>
              <div
                style={{
                  minWidth: LEFT_COL_WIDTH + ((data?.days.length || 0) * DAY_COL_WIDTH),
                }}
              >
                <div
                  style={{
                    position: "sticky",
                    top: 0,
                    zIndex: 10,
                    display: "flex",
                    background: "#f1f5f9",
                    borderBottom: "1px solid #dbe2ea",
                  }}
                >
                  <div
                    style={{
                      width: LEFT_COL_WIDTH,
                      minWidth: LEFT_COL_WIDTH,
                      padding: 14,
                      fontWeight: 900,
                      borderRight: "1px solid #dbe2ea",
                      background: "#f8fafc",
                    }}
                  >
                    Stroj
                  </div>

                  {data?.days.map((day) => (
                    <div
                      key={day}
                      style={{
                        width: DAY_COL_WIDTH,
                        minWidth: DAY_COL_WIDTH,
                        padding: 14,
                        textAlign: "center",
                        fontWeight: 800,
                        fontSize: 13,
                        color: "#334155",
                        borderRight: "1px solid #dbe2ea",
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
                  <div style={{ padding: 24, color: "#64748b" }}>Zatim nejsou nactena zadna data.</div>
                ) : null}

                {filteredMachines.map((machine) => {
                  const width = (data?.days.length || 0) * DAY_COL_WIDTH;
                  const rowHeight = Math.max(72, machine.items.length * ROW_STEP + 16);

                  return (
                    <div
                      key={machine.machineId}
                      style={{
                        display: "flex",
                        borderBottom: "1px solid #e2e8f0",
                      }}
                    >
                      <div
                        style={{
                          width: LEFT_COL_WIDTH,
                          minWidth: LEFT_COL_WIDTH,
                          padding: 14,
                          borderRight: "1px solid #e2e8f0",
                          background: "#fff",
                          position: "sticky",
                          left: 0,
                          zIndex: 5,
                        }}
                      >
                        <div style={{ fontWeight: 900, color: "#0f172a" }}>{machine.machineName}</div>
                        <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>
                          {machine.items.length} planovanych operaci
                        </div>
                      </div>

                      <div
                        style={{
                          position: "relative",
                          width,
                          minHeight: rowHeight,
                          backgroundImage: "linear-gradient(to right, rgba(148,163,184,0.22) 1px, transparent 1px)",
                          backgroundSize: `${DAY_COL_WIDTH}px 100%`,
                        }}
                      >
                        {machine.items.length === 0 ? (
                          <EmptyMachineDrop machineId={machine.machineId} width={width} />
                        ) : (
                          <>
                            <DropSlot machineId={machine.machineId} queuePosition={1} top={0} width={width} />

                            {machine.items.map((item, index) => (
                              <React.Fragment key={item.operationId}>
                                <div
                                  style={{
                                    position: "absolute",
                                    left: 0,
                                    right: 0,
                                    top: index * ROW_STEP,
                                  }}
                                >
                                  <DraggableGanttBar
                                    item={item}
                                    visibleFrom={visibleFrom}
                                    visibleTo={visibleTo}
                                    totalMinutes={totalMinutes}
                                    isDragging={activeItem?.operationId === item.operationId}
                                  />
                                </div>

                                <DropSlot
                                  machineId={machine.machineId}
                                  queuePosition={index + 2}
                                  top={(index + 1) * ROW_STEP - 6}
                                  width={width}
                                />
                              </React.Fragment>
                            ))}
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}

                {data && filteredMachines.length === 0 ? (
                  <div style={{ padding: 24, color: "#64748b" }}>Filtru neodpovida zadny stroj.</div>
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
            }}
          >
            <div style={{ fontSize: 22, fontWeight: 900, color: "#0f172a", marginBottom: 12 }}>
              Nenaplanovane operace
            </div>

            {!data || data.unscheduledItems.length === 0 ? (
              <div style={{ color: "#64748b", fontSize: 14 }}>Zadne nenaplanovane operace.</div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                  <thead>
                    <tr style={{ background: "#f8fafc" }}>
                      {["VP", "GPN", "Operace", "Stroj", "Qty", "Fronta", "Status"].map((h) => (
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
                      <tr key={item.operationId}>
                        <td style={{ padding: "10px 12px", borderBottom: "1px solid #f1f5f9" }}>{item.workOrderNo ?? "-"}</td>
                        <td style={{ padding: "10px 12px", borderBottom: "1px solid #f1f5f9" }}>{item.gpn ?? "-"}</td>
                        <td style={{ padding: "10px 12px", borderBottom: "1px solid #f1f5f9" }}>{item.operationName}</td>
                        <td style={{ padding: "10px 12px", borderBottom: "1px solid #f1f5f9" }}>{item.machineName}</td>
                        <td style={{ padding: "10px 12px", borderBottom: "1px solid #f1f5f9" }}>{item.qty}</td>
                        <td style={{ padding: "10px 12px", borderBottom: "1px solid #f1f5f9" }}>{item.queuePosition ?? "-"}</td>
                        <td style={{ padding: "10px 12px", borderBottom: "1px solid #f1f5f9" }}>
                          <span
                            style={{
                              display: "inline-block",
                              padding: "4px 8px",
                              borderRadius: 999,
                              color: "#fff",
                              background: statusColor(item.status),
                              fontSize: 12,
                              fontWeight: 800,
                            }}
                          >
                            {statusLabel(item.status)}
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
            {activeItem ? <OverlayBar item={activeItem} /> : null}
          </DragOverlay>
        </DndContext>
      </div>
    </div>
  );
}
