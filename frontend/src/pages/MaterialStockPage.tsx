import React, { useEffect, useMemo, useState } from "react";
import PageContainer from "../components/layout/PageContainer";
import PageHeader from "../components/layout/PageHeader";
import PageSection from "../components/layout/PageSection";
import { erpKpiTileBackground, UI } from "../styles/ui";
import { getMaterialGroups, getMaterialLibraryItems, type MaterialGroup, type MaterialLibraryItem } from "../services/materialLibraryApi";
import { getStorageLocations, type StorageLocation } from "../services/storageLocationApi";
import {
  createMaterialStockItem,
  deleteMaterialStockItem,
  getGlobalMaterialReceiptUnits,
  getGlobalMaterialStockMovements,
  getGlobalMaterialStockReceipts,
  getMaterialRemnantStockItems,
  getMaterialStockItems,
  materialMovementAttachmentFileUrl,
  updateMaterialStockItem,
  type MaterialReceiptUnit,
  type MaterialRemnantStockItem,
  type MaterialStockItem,
  type MaterialStockMovement,
} from "../services/materialStockApi";
import { buildSearchHaystack, matchesSearchQuery } from "../overview/overviewSearch";
import ErpPagination from "../components/overview/ErpPagination";
import { useClientPagination } from "../hooks/useClientPagination";

type MaterialStockRow = MaterialStockItem & {
  material_dimension: string | null;
};
type MaterialStockPageTabId = "cards" | "receipts" | "receipt-units" | "movements" | "remnants";
type ReceiptUnitStatusFilter = "" | "active" | "consumed";
type RemnantStatusFilter = "" | "active" | "consumed" | "scrapped";
type MovementTypeFilter = "" | MaterialStockMovement["movement_type"];

const MATERIAL_STOCK_PAGE_TABS: { id: MaterialStockPageTabId; label: string }[] = [
  { id: "cards", label: "Skladové karty" },
  { id: "receipts", label: "Příjmy materiálu" },
  { id: "receipt-units", label: "Zůstatky tyčí" },
  { id: "movements", label: "Pohyby materiálu" },
  { id: "remnants", label: "Zbytky" },
];

function formatDate(dateIso: string | null | undefined): string {
  if (!dateIso) return "—";
  const d = new Date(dateIso);
  if (Number.isNaN(d.getTime())) return dateIso;
  return d.toLocaleString("cs-CZ");
}

function formatReceiptUnitCode(id: number | null | undefined): string {
  return id == null ? "—" : `RU-${String(id).padStart(6, "0")}`;
}

function formatRemnantCode(id: number | null | undefined): string {
  return id == null ? "—" : `ZB-${String(id).padStart(6, "0")}`;
}

function movementTypeLabel(type: MaterialStockMovement["movement_type"] | string): string {
  if (type === "prijem") return "Příjem";
  if (type === "vydej") return "Výdej";
  if (type === "vydej_zbytek") return "Výdej ze zbytku";
  if (type === "odpis_zbytku") return "Odpis zbytku";
  if (type === "likvidace_zbytku") return "Likvidace zbytku";
  return type || "—";
}

function receiptUnitStatusLabel(status: string | null | undefined): string {
  if (status === "active") return "Aktivní";
  if (status === "consumed") return "Spotřebované";
  return status || "—";
}

function remnantStatusLabel(status: string | null | undefined): string {
  if (status === "active") return "Aktivní";
  if (status === "consumed") return "Spotřebované";
  if (status === "scrapped") return "Zlikvidované";
  return status || "—";
}

function movementTraceCode(row: MaterialStockMovement): string {
  if (
    (row.movement_type === "odpis_zbytku" ||
      row.movement_type === "vydej_zbytek" ||
      row.movement_type === "likvidace_zbytku") &&
    row.remnant_stock_item_id != null
  ) {
    return formatRemnantCode(row.remnant_stock_item_id);
  }
  if (row.receipt_unit_code?.trim()) return row.receipt_unit_code;
  if (row.receipt_unit_id != null) return formatReceiptUnitCode(row.receipt_unit_id);
  if (row.remnant_stock_item_id != null) return formatRemnantCode(row.remnant_stock_item_id);
  return "—";
}

const pageFilterBarStyle: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: 8,
  marginBottom: 12,
};

const pageFilterChipBase: React.CSSProperties = {
  ...UI.subTab,
  flex: "0 0 auto",
  height: 30,
  padding: "0 12px",
  fontSize: 12,
  fontWeight: 800,
};

type Props = {
  /** Klik na řádek — otevře detail v pracovní záložce. */
  onOpenStockInWorkspaceTab: (item: MaterialStockRow) => void;
};

export default function MaterialStockPage({ onOpenStockInWorkspaceTab }: Props) {
  const [rows, setRows] = useState<MaterialStockRow[]>([]);
  const [globalReceipts, setGlobalReceipts] = useState<MaterialStockMovement[]>([]);
  const [globalReceiptUnits, setGlobalReceiptUnits] = useState<MaterialReceiptUnit[]>([]);
  const [globalMovements, setGlobalMovements] = useState<MaterialStockMovement[]>([]);
  const [globalRemnants, setGlobalRemnants] = useState<MaterialRemnantStockItem[]>([]);
  const [libraryItems, setLibraryItems] = useState<MaterialLibraryItem[]>([]);
  const [groups, setGroups] = useState<MaterialGroup[]>([]);
  const [locations, setLocations] = useState<StorageLocation[]>([]);
  const [activeTab, setActiveTab] = useState<MaterialStockPageTabId>("cards");
  const [hoverTab, setHoverTab] = useState<MaterialStockPageTabId | null>(null);
  const [query, setQuery] = useState("");
  const [globalQuery, setGlobalQuery] = useState("");
  const [globalReceiptUnitStatusFilter, setGlobalReceiptUnitStatusFilter] = useState<ReceiptUnitStatusFilter>("");
  const [globalMovementTypeFilter, setGlobalMovementTypeFilter] = useState<MovementTypeFilter>("");
  const [globalRemnantStatusFilter, setGlobalRemnantStatusFilter] = useState<RemnantStatusFilter>("");
  const [groupFilter, setGroupFilter] = useState<number | "">("");
  const [formFilter, setFormFilter] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<number | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [materialLibraryItemId, setMaterialLibraryItemId] = useState<number | null>(null);
  const [location, setLocation] = useState("");
  const [currentQty, setCurrentQty] = useState("0");
  const [minQty, setMinQty] = useState("");
  const [unit, setUnit] = useState("mm");
  const [note, setNote] = useState("");
  const [isActive, setIsActive] = useState(true);

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const [stockItems, libItems, groupItems, receiptRows, receiptUnitRows, movementRows, remnantRows] = await Promise.all([
        getMaterialStockItems(),
        getMaterialLibraryItems(),
        getMaterialGroups(),
        getGlobalMaterialStockReceipts(),
        getGlobalMaterialReceiptUnits(),
        getGlobalMaterialStockMovements(),
        getMaterialRemnantStockItems(),
      ]);
      const allLocations = await getStorageLocations();
      const byMaterialId = new Map<number, MaterialLibraryItem>();
      for (const item of libItems) byMaterialId.set(item.id, item);
      const mapped = stockItems.map((s) => ({
        ...s,
        material_dimension: byMaterialId.get(s.material_library_item_id)?.dimension ?? null,
      }));
      setRows(mapped);
      setGlobalReceipts(receiptRows);
      setGlobalReceiptUnits(receiptUnitRows);
      setGlobalMovements(movementRows);
      setGlobalRemnants(remnantRows);
      setLibraryItems(libItems);
      setGroups(groupItems);
      setLocations(allLocations.filter((x) => x.location_type === "material" || x.location_type === "both"));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Nepodařilo se načíst sklad materiálu.");
      setRows([]);
      setGlobalReceipts([]);
      setGlobalReceiptUnits([]);
      setGlobalMovements([]);
      setGlobalRemnants([]);
      setLibraryItems([]);
      setGroups([]);
      setLocations([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData().catch(() => {
      // handled in loadData
    });
  }, []);

  function parseOptionalNumber(value: string): number | null {
    const t = value.trim().replace(",", ".");
    if (!t) return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }

  function resetForm() {
    setEditingId(null);
    setMaterialLibraryItemId(null);
    setLocation("");
    setCurrentQty("0");
    setMinQty("");
    setUnit("mm");
    setNote("");
    setIsActive(true);
    setFormError(null);
    setShowCreateForm(false);
  }

  async function handleCreate() {
    if (materialLibraryItemId == null) {
      setFormError("Vyberte materiál.");
      return;
    }
    const parsedCurrent = parseOptionalNumber(currentQty);
    const parsedMin = parseOptionalNumber(minQty);
    if (parsedCurrent == null) {
      setFormError("Stav musí být platné číslo.");
      return;
    }
    if (minQty.trim() && parsedMin == null) {
      setFormError("Min. zásoba musí být platné číslo.");
      return;
    }

    setSaving(true);
    setFormError(null);
    try {
      const payload = {
        material_library_item_id: materialLibraryItemId,
        location: location.trim() || null,
        current_qty: parsedCurrent,
        min_qty: parsedMin,
        unit: (unit.trim() || "mm"),
        note: note.trim() || null,
        is_active: isActive,
      };
      if (editingId == null) {
        await createMaterialStockItem(payload);
      } else {
        await updateMaterialStockItem(editingId, {
          location: payload.location,
          current_qty: payload.current_qty,
          min_qty: payload.min_qty,
          unit: payload.unit,
          note: payload.note,
          is_active: payload.is_active,
        });
      }
      await loadData();
      resetForm();
    } catch (e: unknown) {
      setFormError(e instanceof Error ? e.message : "Nepodařilo se vytvořit skladovou kartu.");
    } finally {
      setSaving(false);
    }
  }

  function openEdit(row: MaterialStockRow) {
    setEditingId(row.id);
    setMaterialLibraryItemId(row.material_library_item_id);
    setLocation(row.location ?? "");
    setCurrentQty(String(row.current_qty));
    setMinQty(row.min_qty == null ? "" : String(row.min_qty));
    setUnit(row.unit ?? "mm");
    setNote(row.note ?? "");
    setIsActive(row.is_active);
    setFormError(null);
    setShowCreateForm(true);
  }

  async function handleDelete(row: MaterialStockRow) {
    if (!window.confirm("Opravdu chcete smazat tuto skladovou kartu?")) return;
    setError(null);
    try {
      await deleteMaterialStockItem(row.id);
      await loadData();
      if (editingId === row.id) resetForm();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Nepodařilo se smazat skladovou kartu.");
    }
  }

  const filtered = useMemo(() => {
    const locationByCode = new Map(locations.map((l) => [l.code, l.name]));
    return rows.filter((r) => {
      const locationName = r.location ? locationByCode.get(r.location) ?? "" : "";
      const hay = buildSearchHaystack(
        r.material_code,
        r.material_name,
        r.material_form,
        r.material_dimension,
        r.location,
        locationName,
        r.unit,
        r.scan_code,
        r.note
      );
      const matchesText = matchesSearchQuery(query, hay);
      const matchesGroup = groupFilter === "" || r.material_group_id === groupFilter;
      const matchesForm = !formFilter || r.material_form === formFilter;
      return matchesText && matchesGroup && matchesForm;
    });
  }, [rows, query, groupFilter, formFilter, locations]);

  const filteredGlobalReceipts = useMemo(
    () =>
      globalReceipts.filter((row) =>
        matchesSearchQuery(
          globalQuery,
          buildSearchHaystack(
            row.scan_code,
            row.receipt_unit_code,
            row.receipt_unit_id != null ? formatReceiptUnitCode(row.receipt_unit_id) : null,
            row.material_code,
            row.material_name,
            row.material_dimension,
            row.stock_scan_code,
            row.heat_lot,
            row.certificate_no,
            row.delivery_note_no,
            row.supplier_name,
            row.reference,
            ...(row.attachments ?? []).map((a) => a.original_filename),
            row.note
          )
        )
      ),
    [globalReceipts, globalQuery]
  );

  const filteredGlobalReceiptUnits = useMemo(
    () =>
      globalReceiptUnits.filter((row) => {
        const matchesStatus = !globalReceiptUnitStatusFilter || row.status === globalReceiptUnitStatusFilter;
        const matchesText = matchesSearchQuery(
          globalQuery,
          buildSearchHaystack(
            row.receipt_unit_code,
            row.material_code,
            row.material_name,
            row.material_dimension,
            row.stock_scan_code,
            row.heat_lot,
            row.certificate_no,
            row.delivery_note_no,
            row.supplier_name,
            row.status,
            receiptUnitStatusLabel(row.status)
          )
        );
        return matchesStatus && matchesText;
      }),
    [globalReceiptUnits, globalQuery, globalReceiptUnitStatusFilter]
  );

  const filteredGlobalMovements = useMemo(
    () =>
      globalMovements.filter((row) => {
        const matchesType = !globalMovementTypeFilter || row.movement_type === globalMovementTypeFilter;
        const matchesText = matchesSearchQuery(
          globalQuery,
          buildSearchHaystack(
            row.scan_code,
            row.movement_type,
            movementTypeLabel(row.movement_type),
            row.receipt_unit_code,
            row.receipt_unit_id != null ? formatReceiptUnitCode(row.receipt_unit_id) : null,
            row.remnant_stock_item_id != null ? formatRemnantCode(row.remnant_stock_item_id) : null,
            row.material_code,
            row.material_name,
            row.material_dimension,
            row.stock_scan_code,
            row.heat_lot,
            row.certificate_no,
            row.delivery_note_no,
            row.supplier_name,
            row.reference,
            row.note
          )
        );
        return matchesType && matchesText;
      }),
    [globalMovements, globalQuery, globalMovementTypeFilter]
  );

  const filteredGlobalRemnants = useMemo(
    () =>
      globalRemnants.filter((row) => {
        const matchesStatus = !globalRemnantStatusFilter || row.status === globalRemnantStatusFilter;
        const matchesText = matchesSearchQuery(
          globalQuery,
          buildSearchHaystack(
            row.remnant_code,
            formatRemnantCode(row.id),
            row.source_receipt_unit_code,
            formatReceiptUnitCode(row.source_receipt_unit_id),
            row.material_code,
            row.material_name,
            row.material_dimension,
            row.stock_scan_code,
            row.heat_lot,
            row.certificate_no,
            row.delivery_note_no,
            row.supplier_name,
            row.status,
            remnantStatusLabel(row.status),
            row.note
          )
        );
        return matchesStatus && matchesText;
      }),
    [globalRemnants, globalQuery, globalRemnantStatusFilter]
  );

  // Klientská pagination — backend /material-stock/items podporuje server-side limit/offset/total,
  // ale tahle stránka drží plný dataset kvůli universal search + filtrům (skupina/forma).
  const materialStockPaginationResetKey = `${query}|${groupFilter}|${formFilter}`;
  const {
    pagedRows: pagedMaterialStockRows,
    pageSize: materialStockPageSize,
    setPageSize: setMaterialStockPageSize,
    offset: materialStockOffset,
    setOffset: setMaterialStockOffset,
    total: materialStockPagedTotal,
  } = useClientPagination(filtered, { resetKey: materialStockPaginationResetKey });

  const formFilterOptions = useMemo(() => {
    const forms = new Set(rows.map((r) => r.material_form?.trim()).filter((v): v is string => Boolean(v)));
    return Array.from(forms).sort((a, b) => a.localeCompare(b, "cs"));
  }, [rows]);

  const summaryTiles = useMemo(() => {
    const belowMin = rows.filter((r) => r.min_qty != null && r.current_qty < r.min_qty).length;
    return [
      {
        label: "Položek ve skladu",
        value: String(rows.length),
        accent: UI.colors.primary,
        kind: "primary" as const,
        hint: "Všechny skladové karty materiálu.",
      },
      {
        label: "Po filtru",
        value: String(filtered.length),
        accent: UI.colors.neutralFg,
        kind: "neutral" as const,
        hint: "Po aplikaci hledání / skupiny / formy.",
      },
      {
        label: "Pod min. zásobou",
        value: String(belowMin),
        accent: UI.colors.problemFg,
        kind: "danger" as const,
        hint: "Aktuální stav pod minimem (mm).",
      },
    ] as const;
  }, [rows, filtered]);

  function renderFilterChip<T extends string>(
    label: string,
    value: T,
    activeValue: T,
    onClick: (value: T) => void
  ) {
    const active = value === activeValue;
    return (
      <button type="button" key={value || "all"} onClick={() => onClick(value)} style={{ ...pageFilterChipBase, ...(active ? UI.subTabActive : {}) }}>
        {label}
      </button>
    );
  }

  function renderAttachmentLinks(row: MaterialStockMovement) {
    if (!row.attachments || row.attachments.length === 0) return "—";
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {row.attachments.map((a) => (
          <a
            key={a.id}
            href={materialMovementAttachmentFileUrl(a.download_url)}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "#2563eb", fontWeight: 700 }}
          >
            {a.original_filename}
          </a>
        ))}
      </div>
    );
  }

  function renderGlobalFilterBar(placeholder: string) {
    return (
      <div style={pageFilterBarStyle}>
        <div style={{ ...UI.ordersFilterSearchWrap, flex: "1 1 320px", minWidth: 220 }}>
          <input
            className="erp-overview-search"
            value={globalQuery}
            onChange={(e) => setGlobalQuery(e.target.value)}
            placeholder={placeholder}
            style={UI.inputs.overviewSearch}
          />
        </div>
        {activeTab === "receipt-units"
          ? [
              { label: "Vše", value: "" as ReceiptUnitStatusFilter },
              { label: "Aktivní", value: "active" as ReceiptUnitStatusFilter },
              { label: "Spotřebované", value: "consumed" as ReceiptUnitStatusFilter },
            ].map((chip) => renderFilterChip(chip.label, chip.value, globalReceiptUnitStatusFilter, setGlobalReceiptUnitStatusFilter))
          : null}
        {activeTab === "movements"
          ? [
              { label: "Vše", value: "" as MovementTypeFilter },
              { label: "Příjem", value: "prijem" as MovementTypeFilter },
              { label: "Výdej", value: "vydej" as MovementTypeFilter },
              { label: "Výdej ze zbytku", value: "vydej_zbytek" as MovementTypeFilter },
              { label: "Odpis zbytku", value: "odpis_zbytku" as MovementTypeFilter },
              { label: "Likvidace zbytku", value: "likvidace_zbytku" as MovementTypeFilter },
            ].map((chip) => renderFilterChip(chip.label, chip.value, globalMovementTypeFilter, setGlobalMovementTypeFilter))
          : null}
        {activeTab === "remnants"
          ? [
              { label: "Vše", value: "" as RemnantStatusFilter },
              { label: "Aktivní", value: "active" as RemnantStatusFilter },
              { label: "Spotřebované", value: "consumed" as RemnantStatusFilter },
              { label: "Zlikvidované", value: "scrapped" as RemnantStatusFilter },
            ].map((chip) => renderFilterChip(chip.label, chip.value, globalRemnantStatusFilter, setGlobalRemnantStatusFilter))
          : null}
      </div>
    );
  }

  return (
    <PageContainer className="erp-overview-page" style={{ paddingTop: 10 }}>
      <PageHeader
        title="Sklad materiálu"
        subtitle="Přehled stavu materiálu"
        actions={
          activeTab === "cards" ? (
          <button
            type="button"
            style={UI.buttons.primary}
            onClick={() => {
              if (showCreateForm) {
                resetForm();
              } else {
                setShowCreateForm(true);
              }
            }}
          >
            Nová skladová karta
          </button>
          ) : null
        }
      />

      <div style={UI.summaryTilesGridOuter}>
        <div style={UI.summaryTilesGridThree}>
          {summaryTiles.map((t) => (
            <div
              key={t.label}
              className="erp-kpi-tile"
              style={{
                ...UI.overviewKpiTile,
                borderLeftColor: t.accent,
                background: erpKpiTileBackground(t.kind),
                boxShadow: `${UI.overviewKpiTile.boxShadow as string}, inset 0 1px 0 rgba(255, 255, 255, 0.9)`,
              }}
            >
              <div style={UI.overviewKpiLabel}>{t.label}</div>
              <div style={{ ...UI.overviewKpiValue, fontSize: 31, lineHeight: 1.05 }}>{t.value}</div>
              <div style={UI.overviewKpiHint}>{t.hint}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={UI.subTabsContainer}>
        {MATERIAL_STOCK_PAGE_TABS.map((tab) => {
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                setActiveTab(tab.id);
                setGlobalQuery("");
              }}
              onMouseEnter={() => setHoverTab(tab.id)}
              onMouseLeave={() => setHoverTab((h) => (h === tab.id ? null : h))}
              style={{
                ...UI.subTab,
                ...(active ? UI.subTabActive : {}),
                ...(!active && hoverTab === tab.id ? UI.subTabHover : {}),
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <PageSection gapTop={16}>
        {activeTab === "cards" ? (
        <div style={UI.overviewMainCard}>
          <div style={UI.overviewCardHeaderBand}>
            <div style={UI.overviewSecondaryFilterRow}>
              <div style={{ ...UI.ordersFilterSearchWrap, flex: "1 1 320px", minWidth: 220 }}>
                <input
                  className="erp-overview-search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Hledat kód, název, lokaci, scan…"
                  style={UI.inputs.overviewSearch}
                />
              </div>
              <select
                value={groupFilter === "" ? "" : String(groupFilter)}
                onChange={(e) => setGroupFilter(e.target.value ? Number(e.target.value) : "")}
                style={{ ...UI.inputs.base, width: 220 }}
              >
                <option value="">Skupina: vše</option>
                {groups.map((g) => (
                  <option key={g.id} value={String(g.id)}>
                    {g.name}
                  </option>
                ))}
              </select>
              <select
                value={formFilter}
                onChange={(e) => setFormFilter(e.target.value)}
                style={{ ...UI.inputs.base, width: 220 }}
                title="Forma"
              >
                <option value="">Forma: vše</option>
                {formFilterOptions.map((form) => (
                  <option key={form} value={form}>
                    {form}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div style={UI.overviewCardBody}>
          {loading ? <div style={{ ...UI.overviewStateLoading, padding: "0 0 12px" }}>Načítám sklad materiálu…</div> : null}
          {error ? <div style={{ ...UI.overviewStateError, padding: "0 0 12px" }}>{error}</div> : null}

          {showCreateForm ? (
            <div style={{ ...UI.card, padding: 12, marginBottom: 12, background: "#f8fafc", border: "1px solid #e2e8f0" }}>
              {formError ? <div style={{ color: "#b91c1c", fontWeight: 700, marginBottom: 10 }}>{formError}</div> : null}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
                <div>
                  <div style={UI.inputs.label}>Materiál</div>
                  <select
                    value={materialLibraryItemId == null ? "" : String(materialLibraryItemId)}
                    onChange={(e) => setMaterialLibraryItemId(e.target.value ? Number(e.target.value) : null)}
                    style={UI.inputs.base}
                    disabled={editingId != null}
                  >
                    <option value="">Vyberte materiál</option>
                    {libraryItems.map((m) => (
                      <option key={m.id} value={String(m.id)}>
                        {m.code} | {m.name} | {m.dimension}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <div style={UI.inputs.label}>Lokace</div>
                  <select value={location} onChange={(e) => setLocation(e.target.value)} style={UI.inputs.base}>
                    <option value="">Bez umístění</option>
                    {locations.map((loc) => (
                      <option key={loc.id} value={loc.code}>
                        {loc.code} — {loc.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <div style={UI.inputs.label}>Aktuální stav (mm)</div>
                  <input value={currentQty} onChange={(e) => setCurrentQty(e.target.value)} style={UI.inputs.base} />
                </div>
                <div>
                  <div style={UI.inputs.label}>Min. zásoba (mm)</div>
                  <input value={minQty} onChange={(e) => setMinQty(e.target.value)} style={UI.inputs.base} />
                </div>
                <div>
                  <div style={UI.inputs.label}>Jednotka</div>
                  <input value={unit} onChange={(e) => setUnit(e.target.value)} style={UI.inputs.base} />
                </div>
                <div>
                  <div style={UI.inputs.label}>Poznámka</div>
                  <input value={note} onChange={(e) => setNote(e.target.value)} style={UI.inputs.base} />
                </div>
                <div style={{ display: "flex", alignItems: "center", paddingTop: 20 }}>
                  <label style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 700 }}>
                    <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
                    Aktivní
                  </label>
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <button type="button" style={UI.buttons.secondary} onClick={resetForm} disabled={saving}>
                  Zrušit
                </button>
                <button
                  type="button"
                  style={{ ...UI.buttons.primary, ...(saving ? { opacity: 0.7, cursor: "wait" } : {}) }}
                  onClick={handleCreate}
                  disabled={saving}
                >
                  {saving ? "Ukládám..." : editingId == null ? "Uložit skladovou kartu" : "Uložit změny"}
                </button>
              </div>
            </div>
          ) : null}

          {!loading && !error ? (
            <div className="erp-table-wrap" style={{ overflowX: "auto" }}>
              <table style={UI.table}>
                <thead>
                  <tr style={{ background: "#f8fafc" }}>
                    {[
                      "Materiál",
                      "Skupina",
                      "Forma",
                      "Kód",
                      "Scan kód",
                      "Rozměr",
                      "Lokace",
                      "Stav (mm)",
                      "Min. zásoba (mm)",
                      "Akce",
                    ].map((h) => (
                      <th key={h} style={{ ...UI.th, fontSize: 13, padding: "10px 10px", whiteSpace: "nowrap" }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pagedMaterialStockRows.map((row) => (
                      <tr
                        key={row.id}
                        onClick={() => onOpenStockInWorkspaceTab(row)}
                        onMouseEnter={() => setHoverId(row.id)}
                        onMouseLeave={() => setHoverId((id) => (id === row.id ? null : id))}
                        style={{ cursor: "pointer", background: hoverId === row.id ? "#eff6ff" : "#fff" }}
                      >
                        <td style={{ ...UI.td, padding: "10px 10px", fontWeight: 800 }}>{row.material_name}</td>
                        <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>{row.material_group_name || "—"}</td>
                        <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>{row.material_form || "—"}</td>
                        <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>{row.material_code || "—"}</td>
                        <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>
                          {row.scan_code?.trim() ? row.scan_code : "—"}
                        </td>
                        <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>{row.material_dimension || "—"}</td>
                        <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>
                          {row.location
                            ? (() => {
                                const loc = locations.find((x) => x.code === row.location);
                                return loc ? `${loc.code} — ${loc.name}` : row.location;
                              })()
                            : "—"}
                        </td>
                        <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>
                          {row.current_qty} mm
                        </td>
                        <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>
                          {row.min_qty == null ? "—" : `${row.min_qty} mm`}
                        </td>
                        <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap", display: "flex", gap: 6 }}>
                          <button
                            type="button"
                            style={UI.buttons.secondary}
                            onClick={(e) => {
                              e.stopPropagation();
                              openEdit(row);
                            }}
                          >
                            Upravit
                          </button>
                          <button
                            type="button"
                            style={UI.buttons.secondary}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDelete(row);
                            }}
                          >
                            Smazat
                          </button>
                        </td>
                      </tr>
                  ))}
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={10} style={{ ...UI.td, textAlign: "center", color: "#64748b", padding: "14px 10px" }}>
                        Žádné výsledky.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          ) : null}
          {rows.length > 0 ? (
            <ErpPagination
              pageSize={materialStockPageSize}
              onPageSizeChange={setMaterialStockPageSize}
              offset={materialStockOffset}
              onOffsetChange={setMaterialStockOffset}
              total={materialStockPagedTotal}
              currentCount={pagedMaterialStockRows.length}
            />
          ) : null}
          </div>
        </div>
        ) : null}

        {activeTab === "receipts" ? (
          <div style={UI.overviewMainCard}>
            <div style={UI.overviewCardHeaderBand}>
              <div style={{ ...UI.sectionTitle, fontSize: 16, marginBottom: 10 }}>Příjmy materiálu</div>
              {renderGlobalFilterBar("Hledat příjem, materiál, skladovou kartu, tavbu, atest, dodavatele…")}
            </div>
            <div style={UI.overviewCardBody}>
              {loading ? <div style={{ ...UI.overviewStateLoading, padding: "0 0 12px" }}>Načítám příjmy…</div> : null}
              {error ? <div style={{ ...UI.overviewStateError, padding: "0 0 12px" }}>{error}</div> : null}
              {!loading && !error ? (
                <div className="erp-table-wrap" style={{ overflowX: "auto" }}>
                  <table style={UI.table}>
                    <thead>
                      <tr style={{ background: "#f8fafc" }}>
                        {["Materiál", "Rozměr", "Scan kód", "Datum", "ID příjmu / tyče", "Množství", "Tavba / šarže", "Atest", "DL", "Dodavatel", "Reference", "Přílohy", "Poznámka"].map((h) => (
                          <th key={h} style={{ ...UI.th, fontSize: 12, padding: "10px 8px", whiteSpace: "nowrap" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredGlobalReceipts.map((row) => (
                        <tr key={row.id}>
                          <td style={{ ...UI.td, padding: "10px 8px", fontWeight: 800 }}>{row.material_code || row.material_name || "—"}</td>
                          <td style={{ ...UI.td, padding: "10px 8px", whiteSpace: "nowrap" }}>{row.material_dimension || "—"}</td>
                          <td style={{ ...UI.td, padding: "10px 8px", whiteSpace: "nowrap" }}>{row.stock_scan_code || "—"}</td>
                          <td style={{ ...UI.td, padding: "10px 8px", whiteSpace: "nowrap" }}>{formatDate(row.movement_date)}</td>
                          <td style={{ ...UI.td, padding: "10px 8px", whiteSpace: "nowrap", fontWeight: 900 }}>{row.receipt_unit_code?.trim() || (row.receipt_unit_id != null ? formatReceiptUnitCode(row.receipt_unit_id) : "—")}</td>
                          <td style={{ ...UI.td, padding: "10px 8px", whiteSpace: "nowrap" }}>{row.qty} mm</td>
                          <td style={{ ...UI.td, padding: "10px 8px", maxWidth: 140 }}>{row.heat_lot || "—"}</td>
                          <td style={{ ...UI.td, padding: "10px 8px", maxWidth: 100 }}>{row.certificate_no || "—"}</td>
                          <td style={{ ...UI.td, padding: "10px 8px", maxWidth: 100 }}>{row.delivery_note_no || "—"}</td>
                          <td style={{ ...UI.td, padding: "10px 8px", maxWidth: 140 }}>{row.supplier_name || "—"}</td>
                          <td style={{ ...UI.td, padding: "10px 8px", maxWidth: 120 }}>{row.reference || "—"}</td>
                          <td style={{ ...UI.td, padding: "10px 8px", fontSize: 12 }}>{renderAttachmentLinks(row)}</td>
                          <td style={{ ...UI.td, padding: "10px 8px", maxWidth: 160 }}>{row.note || "—"}</td>
                        </tr>
                      ))}
                      {filteredGlobalReceipts.length === 0 ? (
                        <tr><td colSpan={13} style={{ ...UI.td, textAlign: "center", color: "#64748b", padding: "14px 10px" }}>Žádné příjmy neodpovídají filtru.</td></tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {activeTab === "receipt-units" ? (
          <div style={UI.overviewMainCard}>
            <div style={UI.overviewCardHeaderBand}>
              <div style={{ ...UI.sectionTitle, fontSize: 16, marginBottom: 10 }}>Zůstatky tyčí</div>
              {renderGlobalFilterBar("Hledat tyč, materiál, skladovou kartu, tavbu, atest, dodavatele, stav…")}
            </div>
            <div style={UI.overviewCardBody}>
              {loading ? <div style={{ ...UI.overviewStateLoading, padding: "0 0 12px" }}>Načítám zůstatky tyčí…</div> : null}
              {error ? <div style={{ ...UI.overviewStateError, padding: "0 0 12px" }}>{error}</div> : null}
              {!loading && !error ? (
                <div className="erp-table-wrap" style={{ overflowX: "auto" }}>
                  <table style={UI.table}>
                    <thead>
                      <tr style={{ background: "#f8fafc" }}>
                        {["Materiál", "Rozměr", "Scan kód", "ID tyče", "Tavba / šarže", "Atest", "Původní příjem", "Zbývá", "Stav", "Datum příjmu", "DL", "Dodavatel"].map((h) => (
                          <th key={h} style={{ ...UI.th, fontSize: 12, padding: "10px 8px", whiteSpace: "nowrap" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredGlobalReceiptUnits.map((row) => (
                        <tr key={row.id}>
                          <td style={{ ...UI.td, padding: "10px 8px", fontWeight: 800 }}>{row.material_code || row.material_name || "—"}</td>
                          <td style={{ ...UI.td, padding: "10px 8px", whiteSpace: "nowrap" }}>{row.material_dimension || "—"}</td>
                          <td style={{ ...UI.td, padding: "10px 8px", whiteSpace: "nowrap" }}>{row.stock_scan_code || "—"}</td>
                          <td style={{ ...UI.td, padding: "10px 8px", whiteSpace: "nowrap", fontWeight: 900 }}>{row.receipt_unit_code || formatReceiptUnitCode(row.id)}</td>
                          <td style={{ ...UI.td, padding: "10px 8px", maxWidth: 140 }}>{row.heat_lot || "—"}</td>
                          <td style={{ ...UI.td, padding: "10px 8px", maxWidth: 100 }}>{row.certificate_no || "—"}</td>
                          <td style={{ ...UI.td, padding: "10px 8px", whiteSpace: "nowrap" }}>{row.received_qty} {row.uom || "mm"}</td>
                          <td style={{ ...UI.td, padding: "10px 8px", whiteSpace: "nowrap", fontWeight: 900 }}>{row.remaining_qty} {row.uom || "mm"}</td>
                          <td style={{ ...UI.td, padding: "10px 8px", whiteSpace: "nowrap" }}>{receiptUnitStatusLabel(row.status)}</td>
                          <td style={{ ...UI.td, padding: "10px 8px", whiteSpace: "nowrap" }}>{formatDate(row.received_at)}</td>
                          <td style={{ ...UI.td, padding: "10px 8px", maxWidth: 100 }}>{row.delivery_note_no || "—"}</td>
                          <td style={{ ...UI.td, padding: "10px 8px", maxWidth: 140 }}>{row.supplier_name || "—"}</td>
                        </tr>
                      ))}
                      {filteredGlobalReceiptUnits.length === 0 ? (
                        <tr><td colSpan={12} style={{ ...UI.td, textAlign: "center", color: "#64748b", padding: "14px 10px" }}>Žádné zůstatky tyčí neodpovídají filtru.</td></tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {activeTab === "movements" ? (
          <div style={UI.overviewMainCard}>
            <div style={UI.overviewCardHeaderBand}>
              <div style={{ ...UI.sectionTitle, fontSize: 16, marginBottom: 10 }}>Pohyby materiálu</div>
              {renderGlobalFilterBar("Hledat pohyb, typ, materiál, skladovou kartu, tavbu, atest, referenci…")}
            </div>
            <div style={UI.overviewCardBody}>
              {loading ? <div style={{ ...UI.overviewStateLoading, padding: "0 0 12px" }}>Načítám pohyby…</div> : null}
              {error ? <div style={{ ...UI.overviewStateError, padding: "0 0 12px" }}>{error}</div> : null}
              {!loading && !error ? (
                <div className="erp-table-wrap" style={{ overflowX: "auto" }}>
                  <table style={UI.table}>
                    <thead>
                      <tr style={{ background: "#f8fafc" }}>
                        {["Materiál", "Rozměr", "Scan kód", "ID pohybu", "Typ", "ID tyče / zbytku", "Množství", "Datum", "Tavba / šarže", "Dodavatel", "DL", "Atest", "Reference", "Přílohy", "Poznámka"].map((h) => (
                          <th key={h} style={{ ...UI.th, fontSize: 12, padding: "10px 8px", whiteSpace: "nowrap" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredGlobalMovements.map((row) => (
                        <tr key={row.id}>
                          <td style={{ ...UI.td, padding: "10px 8px", fontWeight: 800 }}>{row.material_code || row.material_name || "—"}</td>
                          <td style={{ ...UI.td, padding: "10px 8px", whiteSpace: "nowrap" }}>{row.material_dimension || "—"}</td>
                          <td style={{ ...UI.td, padding: "10px 8px", whiteSpace: "nowrap" }}>{row.stock_scan_code || "—"}</td>
                          <td style={{ ...UI.td, padding: "10px 8px", whiteSpace: "nowrap", fontWeight: 900 }}>{row.scan_code || "—"}</td>
                          <td style={{ ...UI.td, padding: "10px 8px", whiteSpace: "nowrap", fontWeight: 800 }}>{movementTypeLabel(row.movement_type)}</td>
                          <td style={{ ...UI.td, padding: "10px 8px", whiteSpace: "nowrap", fontWeight: 900 }}>{movementTraceCode(row)}</td>
                          <td style={{ ...UI.td, padding: "10px 8px", whiteSpace: "nowrap" }}>{row.qty} mm</td>
                          <td style={{ ...UI.td, padding: "10px 8px", whiteSpace: "nowrap" }}>{formatDate(row.movement_date)}</td>
                          <td style={{ ...UI.td, padding: "10px 8px", maxWidth: 140 }}>{row.heat_lot || "—"}</td>
                          <td style={{ ...UI.td, padding: "10px 8px", maxWidth: 120 }}>{row.supplier_name || "—"}</td>
                          <td style={{ ...UI.td, padding: "10px 8px", maxWidth: 100 }}>{row.delivery_note_no || "—"}</td>
                          <td style={{ ...UI.td, padding: "10px 8px", maxWidth: 100 }}>{row.certificate_no || "—"}</td>
                          <td style={{ ...UI.td, padding: "10px 8px", maxWidth: 120 }}>{row.reference || "—"}</td>
                          <td style={{ ...UI.td, padding: "10px 8px", fontSize: 12 }}>{renderAttachmentLinks(row)}</td>
                          <td style={{ ...UI.td, padding: "10px 8px", maxWidth: 160 }}>{row.note || "—"}</td>
                        </tr>
                      ))}
                      {filteredGlobalMovements.length === 0 ? (
                        <tr><td colSpan={15} style={{ ...UI.td, textAlign: "center", color: "#64748b", padding: "14px 10px" }}>Žádné pohyby neodpovídají filtru.</td></tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {activeTab === "remnants" ? (
          <div style={UI.overviewMainCard}>
            <div style={UI.overviewCardHeaderBand}>
              <div style={{ ...UI.sectionTitle, fontSize: 16, marginBottom: 10 }}>Zbytky</div>
              {renderGlobalFilterBar("Hledat zbytek, materiál, skladovou kartu, zdrojovou tyč, tavbu, atest, stav…")}
            </div>
            <div style={UI.overviewCardBody}>
              {loading ? <div style={{ ...UI.overviewStateLoading, padding: "0 0 12px" }}>Načítám zbytky…</div> : null}
              {error ? <div style={{ ...UI.overviewStateError, padding: "0 0 12px" }}>{error}</div> : null}
              {!loading && !error ? (
                <div className="erp-table-wrap" style={{ overflowX: "auto" }}>
                  <table style={UI.table}>
                    <thead>
                      <tr style={{ background: "#f8fafc" }}>
                        {["Materiál", "Rozměr", "Scan kód", "ID zbytku", "Tavba / šarže", "Atest", "Množství", "Stav", "Datum vytvoření", "Zdrojová tyč", "DL", "Dodavatel", "Poznámka"].map((h) => (
                          <th key={h} style={{ ...UI.th, fontSize: 12, padding: "10px 8px", whiteSpace: "nowrap" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredGlobalRemnants.map((row) => (
                        <tr key={row.id}>
                          <td style={{ ...UI.td, padding: "10px 8px", fontWeight: 800 }}>{row.material_code || row.material_name || "—"}</td>
                          <td style={{ ...UI.td, padding: "10px 8px", whiteSpace: "nowrap" }}>{row.material_dimension || "—"}</td>
                          <td style={{ ...UI.td, padding: "10px 8px", whiteSpace: "nowrap" }}>{row.stock_scan_code || "—"}</td>
                          <td style={{ ...UI.td, padding: "10px 8px", whiteSpace: "nowrap", fontWeight: 900 }}>{row.remnant_code?.trim() || formatRemnantCode(row.id)}</td>
                          <td style={{ ...UI.td, padding: "10px 8px", maxWidth: 140 }}>{row.heat_lot || "—"}</td>
                          <td style={{ ...UI.td, padding: "10px 8px", maxWidth: 100 }}>{row.certificate_no || "—"}</td>
                          <td style={{ ...UI.td, padding: "10px 8px", whiteSpace: "nowrap", fontWeight: 900 }}>{row.qty} {row.uom || "mm"}</td>
                          <td style={{ ...UI.td, padding: "10px 8px", whiteSpace: "nowrap" }}>{remnantStatusLabel(row.status)}</td>
                          <td style={{ ...UI.td, padding: "10px 8px", whiteSpace: "nowrap" }}>{formatDate(row.created_at)}</td>
                          <td style={{ ...UI.td, padding: "10px 8px", whiteSpace: "nowrap", fontWeight: 900 }}>{row.source_receipt_unit_code?.trim() || formatReceiptUnitCode(row.source_receipt_unit_id)}</td>
                          <td style={{ ...UI.td, padding: "10px 8px", maxWidth: 100 }}>{row.delivery_note_no || "—"}</td>
                          <td style={{ ...UI.td, padding: "10px 8px", maxWidth: 140 }}>{row.supplier_name || "—"}</td>
                          <td style={{ ...UI.td, padding: "10px 8px", maxWidth: 160 }}>{row.note || "—"}</td>
                        </tr>
                      ))}
                      {filteredGlobalRemnants.length === 0 ? (
                        <tr><td colSpan={13} style={{ ...UI.td, textAlign: "center", color: "#64748b", padding: "14px 10px" }}>Žádné zbytky neodpovídají filtru.</td></tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </PageSection>
    </PageContainer>
  );
}
