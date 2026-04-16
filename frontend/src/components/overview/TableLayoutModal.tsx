import React, { useMemo } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { UI } from "../../styles/ui";
import type { SortConfig, TableColumnState } from "../../overview/tableLayoutMerge";

function SortableRow({
  col,
  onToggle,
  onWidth,
}: {
  col: TableColumnState;
  onToggle: (key: string) => void;
  onWidth: (key: string, width: number | null) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: col.key });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.85 : 1,
    display: "grid",
    gridTemplateColumns: "28px 1fr 110px 100px",
    gap: 10,
    alignItems: "center",
    padding: "8px 10px",
    borderBottom: "1px solid #e2e8f0",
    background: isDragging ? "#f1f5f9" : "#fff",
  };

  return (
    <div ref={setNodeRef} style={style}>
      <button
        type="button"
        {...attributes}
        {...listeners}
        title="Přetáhnout"
        style={{
          cursor: "grab",
          border: "1px solid #cbd5e1",
          borderRadius: 8,
          background: "#f8fafc",
          padding: "4px 0",
          fontSize: 14,
          lineHeight: 1,
          color: "#475569",
        }}
      >
        ⠿
      </button>
      <label style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 700, color: "#0f172a", fontSize: 13 }}>
        <input type="checkbox" checked={col.visible} onChange={() => onToggle(col.key)} />
        {col.label}
      </label>
      <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600 }}>{col.key}</div>
      <input
        type="number"
        min={40}
        max={900}
        step={5}
        value={col.width ?? ""}
        placeholder="auto"
        onChange={(e) => {
          const v = e.target.value;
          if (v === "") {
            onWidth(col.key, null);
            return;
          }
          const n = Number(v);
          if (!Number.isFinite(n)) return;
          onWidth(col.key, n);
        }}
        style={{ ...UI.inputs.base, padding: "6px 8px", fontSize: 12 }}
      />
    </div>
  );
}

type Props = {
  open: boolean;
  title?: string;
  columns: TableColumnState[];
  onColumnsChange: (next: TableColumnState[]) => void;
  sort: SortConfig | null;
  onSortChange: (s: SortConfig | null) => void;
  sortableKeys: string[];
  columnLabels: Record<string, string>;
  density: "comfortable" | "compact";
  onDensityChange: (d: "comfortable" | "compact") => void;
  onCancel: () => void;
  onSave: () => void;
  onResetLocal: () => void;
  onResetAndSave: () => void;
  saving: boolean;
  errorMessage: string | null;
};

export default function TableLayoutModal({
  open,
  title = "Sloupce tabulky",
  columns,
  onColumnsChange,
  sort,
  onSortChange,
  sortableKeys,
  columnLabels,
  density,
  onDensityChange,
  onCancel,
  onSave,
  onResetLocal,
  onResetAndSave,
  saving,
  errorMessage,
}: Props) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const ordered = useMemo(() => [...columns].sort((a, b) => a.order - b.order), [columns]);
  const ids = useMemo(() => ordered.map((c) => c.key), [ordered]);

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIndex = ordered.findIndex((c) => c.key === active.id);
    const newIndex = ordered.findIndex((c) => c.key === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const moved = arrayMove(ordered, oldIndex, newIndex).map((c, i) => ({ ...c, order: i }));
    onColumnsChange(moved);
  }

  function toggle(key: string) {
    onColumnsChange(columns.map((c) => (c.key === key ? { ...c, visible: !c.visible } : c)));
  }

  function setWidth(key: string, width: number | null) {
    onColumnsChange(columns.map((c) => (c.key === key ? { ...c, width } : c)));
  }

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="table-layout-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 5000,
        background: "rgba(15,23,42,0.45)",
        display: "grid",
        placeItems: "center",
        padding: 16,
      }}
    >
      <div
        style={{
          width: "min(560px, 100%)",
          maxHeight: "min(88vh, 720px)",
          background: "#fff",
          borderRadius: 14,
          boxShadow: "0 25px 50px rgba(0,0,0,0.2)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <div style={{ padding: "14px 18px", borderBottom: "1px solid #e2e8f0" }}>
          <div id="table-layout-modal-title" style={{ fontSize: 17, fontWeight: 1000, color: "#0f172a" }}>
            {title}
          </div>
          <div style={{ fontSize: 12, color: "#64748b", marginTop: 4, fontWeight: 600 }}>
            Přetažením změníte pořadí. Šířka v pixelech (40–900), prázdné = automaticky.
          </div>
        </div>

        <div style={{ padding: "12px 18px", borderBottom: "1px solid #e2e8f0", display: "grid", gap: 10 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <div style={{ ...UI.inputs.label, marginBottom: 4 }}>Řadit podle</div>
              <select
                value={sort?.columnKey ?? ""}
                onChange={(e) => {
                  const v = e.target.value;
                  if (!v) {
                    onSortChange(null);
                    return;
                  }
                  onSortChange({ columnKey: v, direction: sort?.direction ?? "asc" });
                }}
                style={UI.inputs.base}
              >
                <option value="">— Výchozí pořadí z API —</option>
                {sortableKeys.map((k) => (
                  <option key={k} value={k}>
                    {columnLabels[k] ?? k}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <div style={{ ...UI.inputs.label, marginBottom: 4 }}>Směr řazení</div>
              <select
                value={sort?.direction ?? "asc"}
                onChange={(e) => {
                  const dir = e.target.value === "desc" ? "desc" : "asc";
                  if (!sort?.columnKey) return;
                  onSortChange({ columnKey: sort.columnKey, direction: dir });
                }}
                disabled={!sort?.columnKey}
                style={UI.inputs.base}
              >
                <option value="asc">Vzestupně</option>
                <option value="desc">Sestupně</option>
              </select>
            </div>
          </div>
          <div>
            <div style={{ ...UI.inputs.label, marginBottom: 4 }}>Hustota řádků</div>
            <select value={density} onChange={(e) => onDensityChange(e.target.value === "compact" ? "compact" : "comfortable")} style={UI.inputs.base}>
              <option value="comfortable">Standardní</option>
              <option value="compact">Kompaktní</option>
            </select>
          </div>
        </div>

        <div style={{ flex: 1, overflow: "auto", minHeight: 0 }}>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={ids} strategy={verticalListSortingStrategy}>
              {ordered.map((col) => (
                <SortableRow key={col.key} col={col} onToggle={toggle} onWidth={setWidth} />
              ))}
            </SortableContext>
          </DndContext>
        </div>

        {errorMessage ? (
          <div style={{ padding: "8px 18px", color: "#b91c1c", fontWeight: 700, fontSize: 13 }}>{errorMessage}</div>
        ) : null}

        <div
          style={{
            padding: "12px 18px",
            borderTop: "1px solid #e2e8f0",
            display: "flex",
            flexWrap: "wrap",
            gap: 8,
            justifyContent: "flex-end",
          }}
        >
          <button type="button" style={UI.buttons.secondary} onClick={onResetLocal} disabled={saving}>
            Obnovit výchozí (bez uložení)
          </button>
          <button type="button" style={UI.buttons.secondary} onClick={onResetAndSave} disabled={saving}>
            Výchozí a uložit
          </button>
          <button type="button" style={UI.buttons.secondary} onClick={onCancel} disabled={saving}>
            Zrušit
          </button>
          <button type="button" style={UI.buttons.primary} onClick={onSave} disabled={saving}>
            {saving ? "Ukládám…" : "Uložit zobrazení"}
          </button>
        </div>
      </div>
    </div>
  );
}
