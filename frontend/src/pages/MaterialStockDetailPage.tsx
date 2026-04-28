import React, { useCallback, useEffect, useMemo, useState } from "react";
import DetailPageHeader from "../components/DetailPageHeader";
import { buildSearchHaystack, matchesSearchQuery } from "../overview/overviewSearch";
import {
  erpDetailIdentGrid,
  erpDetailIdentLabel,
  erpDetailIdentValue,
  erpDetailKpiLabel,
  erpDetailKpiPanel,
  erpDetailKpiRow,
  erpDetailKpiValue,
  erpDetailRowLabel,
  erpDetailRowValue,
  erpDetailSectionEyebrow,
  erpDetailStateCard,
  UI,
} from "../styles/ui";
import {
  createMaterialStockMovement,
  deleteMaterialStockMovement,
  disposeMaterialRemnantStockItem,
  getMaterialReceiptUnits,
  getMaterialRemnantStockItems,
  getMaterialStockItems,
  getMaterialStockMovements,
  materialMovementAttachmentFileUrl,
  scrapMaterialReceiptUnit,
  updateMaterialStockMovement,
  uploadMaterialMovementAttachments,
  type MaterialRemnantStockItem,
  type MaterialReceiptUnit,
  type MaterialStockItem,
  type MaterialStockMovement,
} from "../services/materialStockApi";

type DetailItem = MaterialStockItem & { material_dimension?: string | null };
type DetailTabId = "overview" | "receipts" | "receipt-units" | "movements" | "remnants";
type ReceiptUnitStatusFilter = "" | "active" | "consumed";
type RemnantStatusFilter = "" | "active" | "consumed" | "scrapped";
type MovementTypeFilter = "" | MaterialStockMovement["movement_type"];

const DETAIL_TABS: { id: DetailTabId; label: string }[] = [
  { id: "overview", label: "Přehled" },
  { id: "receipts", label: "Příjmy materiálu" },
  { id: "receipt-units", label: "Zůstatky tyčí" },
  { id: "movements", label: "Pohyby materiálu" },
  { id: "remnants", label: "Zbytky" },
];

type Props = {
  item: DetailItem;
  onBack: () => void;
};

function formatDate(dateIso: string): string {
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

function sourceReceiptUnitTrace(row: MaterialRemnantStockItem): string {
  const code = row.source_receipt_unit_code?.trim() || formatReceiptUnitCode(row.source_receipt_unit_id);
  return row.received_at ? `${code} · ${formatDate(row.received_at)}` : code;
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

const detailFilterBarStyle: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: 8,
  marginBottom: 12,
};

const detailFilterChipBase: React.CSSProperties = {
  ...UI.subTab,
  flex: "0 0 auto",
  height: 30,
  padding: "0 12px",
  fontSize: 12,
  fontWeight: 800,
};

function nowLocalDateTimeValue() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function MaterialStockDetailPage({ item, onBack }: Props) {
  const movementTypeLabel = (type: MaterialStockMovement["movement_type"]) => {
    if (type === "storno_vydeje") return "storno_vydeje";
    if (type === "vydej_zbytek") return "vydej_zbytek";
    if (type === "likvidace_zbytku") return "likvidace_zbytku";
    return type;
  };
  const [stockItem, setStockItem] = useState<DetailItem>(item);
  const [rows, setRows] = useState<MaterialStockMovement[]>([]);
  const [receiptUnits, setReceiptUnits] = useState<MaterialReceiptUnit[]>([]);
  const [remnantRows, setRemnantRows] = useState<MaterialRemnantStockItem[]>([]);
  const [activeTab, setActiveTab] = useState<DetailTabId>("overview");
  const [hoverTab, setHoverTab] = useState<DetailTabId | null>(null);
  const [receiptSearch, setReceiptSearch] = useState("");
  const [receiptUnitSearch, setReceiptUnitSearch] = useState("");
  const [receiptUnitStatusFilter, setReceiptUnitStatusFilter] = useState<ReceiptUnitStatusFilter>("");
  const [movementSearch, setMovementSearch] = useState("");
  const [movementTypeFilter, setMovementTypeFilter] = useState<MovementTypeFilter>("");
  const [remnantSearch, setRemnantSearch] = useState("");
  const [remnantStatusFilter, setRemnantStatusFilter] = useState<RemnantStatusFilter>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingMovementId, setEditingMovementId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [scrappingReceiptUnitId, setScrappingReceiptUnitId] = useState<number | null>(null);
  const [disposingRemnantId, setDisposingRemnantId] = useState<number | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const [movementType, setMovementType] = useState<"prijem" | "vydej" | "korekce" | "storno_vydeje">("prijem");
  const [qty, setQty] = useState("");
  const [movementDate, setMovementDate] = useState(nowLocalDateTimeValue());
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [heatLot, setHeatLot] = useState("");
  const [supplierName, setSupplierName] = useState("");
  const [deliveryNoteNo, setDeliveryNoteNo] = useState("");
  const [certificateNo, setCertificateNo] = useState("");
  const [attachmentFiles, setAttachmentFiles] = useState<File[]>([]);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [movements, receiptUnitRows, remnants, items] = await Promise.all([
        getMaterialStockMovements(item.id),
        getMaterialReceiptUnits(item.id),
        getMaterialRemnantStockItems({
          sourceStockItemId: item.id,
          materialLibraryItemId: item.material_library_item_id,
        }),
        getMaterialStockItems(),
      ]);
      setRows(movements);
      setReceiptUnits(receiptUnitRows);
      setRemnantRows(
        remnants.filter(
          (r) =>
            r.source_stock_item_id === item.id ||
            r.material_library_item_id === item.material_library_item_id
        )
      );
      const refreshed = items.find((x) => x.id === item.id);
      if (refreshed) setStockItem((prev) => ({ ...prev, ...refreshed }));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Nepodařilo se načíst detail skladu.");
      setRows([]);
      setReceiptUnits([]);
      setRemnantRows([]);
    } finally {
      setLoading(false);
    }
  }, [item.id, item.material_library_item_id]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  function resetMovementExtras() {
    setHeatLot("");
    setSupplierName("");
    setDeliveryNoteNo("");
    setCertificateNo("");
    setAttachmentFiles([]);
  }

  async function handleSaveMovement() {
    const parsedQty = Number(qty.replace(",", "."));
    if (!Number.isFinite(parsedQty) || parsedQty <= 0) {
      setError("Množství musí být číslo větší než 0.");
      return;
    }
    if (!movementDate.trim()) {
      setError("Datum je povinné.");
      return;
    }
    if (movementType === "prijem" && !heatLot.trim()) {
      setError("U příjmu je povinné pole Tavba / šarže.");
      return;
    }

    setSaving(true);
    setError(null);
    setSuccessMessage(null);
    try {
      const payload = {
        movement_type: movementType,
        qty: parsedQty,
        movement_date: new Date(movementDate).toISOString(),
        reference: reference.trim() || null,
        note: note.trim() || null,
        heat_lot: movementType === "prijem" ? heatLot.trim() : heatLot.trim() || null,
        supplier_name: supplierName.trim() || null,
        delivery_note_no: deliveryNoteNo.trim() || null,
        certificate_no: certificateNo.trim() || null,
      };
      let movementId: number;
      if (editingMovementId == null) {
        const created = await createMaterialStockMovement(item.id, payload);
        movementId = created.id;
        if (movementType === "prijem" && attachmentFiles.length > 0) {
          await uploadMaterialMovementAttachments(movementId, attachmentFiles);
        }
      } else {
        await updateMaterialStockMovement(editingMovementId, payload);
        movementId = editingMovementId;
        if (movementType === "prijem" && attachmentFiles.length > 0) {
          await uploadMaterialMovementAttachments(movementId, attachmentFiles);
        }
      }
      setQty("");
      setMovementDate(nowLocalDateTimeValue());
      setReference("");
      setNote("");
      resetMovementExtras();
      setEditingMovementId(null);
      setShowForm(false);
      await loadData();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Nepodařilo se uložit pohyb.");
    } finally {
      setSaving(false);
    }
  }

  function openEditMovement(row: MaterialStockMovement) {
    if (row.movement_type === "odpis_zbytku") {
      setError("Pohyb odpisu zbytku je auditní záznam a nelze ho upravovat ručně.");
      return;
    }
    if (row.movement_type === "vydej_zbytek") {
      setError("Pohyb výdeje zbytku je řízený výdejem rezervace a nelze ho ručně upravit.");
      return;
    }
    if (row.movement_type === "likvidace_zbytku") {
      setError("Pohyb likvidace zbytku je auditní záznam a nelze ho ručně upravit.");
      return;
    }
    const d = new Date(row.movement_date);
    const pad = (n: number) => String(n).padStart(2, "0");
    const localValue = Number.isNaN(d.getTime())
      ? nowLocalDateTimeValue()
      : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    setEditingMovementId(row.id);
    setMovementType(row.movement_type);
    setQty(String(row.qty));
    setMovementDate(localValue);
    setReference(row.reference ?? "");
    setNote(row.note ?? "");
    setHeatLot(row.heat_lot ?? "");
    setSupplierName(row.supplier_name ?? "");
    setDeliveryNoteNo(row.delivery_note_no ?? "");
    setCertificateNo(row.certificate_no ?? "");
    setAttachmentFiles([]);
    setShowForm(true);
    setError(null);
  }

  async function handleDeleteMovement(row: MaterialStockMovement) {
    if (row.movement_type === "odpis_zbytku") {
      setError("Pohyb odpisu zbytku je auditní záznam přesunu do skladu zbytků a nelze ho smazat.");
      return;
    }
    if (row.movement_type === "likvidace_zbytku") {
      setError("Pohyb likvidace zbytku je auditní záznam a nelze ho smazat.");
      return;
    }
    if (!window.confirm("Opravdu chcete smazat tento pohyb?")) return;
    setError(null);
    setSuccessMessage(null);
    try {
      await deleteMaterialStockMovement(row.id);
      await loadData();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Nepodařilo se smazat pohyb.");
    }
  }

  async function handleScrapReceiptUnit(ru: MaterialReceiptUnit) {
    const remainingQty = Number(ru.remaining_qty || 0);
    if (remainingQty <= 0) return;
    const ruUnit = ru.uom?.trim() || unit;
    const trace = [ru.heat_lot, ru.certificate_no].filter((x) => x && x.trim()).join(" / ");
    const traceText = trace ? ` z tavby / atestu ${trace}` : "";
    const ok = window.confirm(
      `Opravdu chcete odepsat zbytek?\n\nZbytek ${remainingQty} ${ruUnit}${traceText} bude odebrán z hlavního skladu materiálu a přesunut do skladu zbytků.`
    );
    if (!ok) return;

    setScrappingReceiptUnitId(ru.id);
    setError(null);
    setSuccessMessage(null);
    try {
      const res = await scrapMaterialReceiptUnit(ru.id);
      await loadData();
      setSuccessMessage(res.message || `Zbytek ${remainingQty} ${ruUnit} byl odepsán z hlavního skladu a přesunut do skladu zbytků.`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Nepodařilo se odepsat zbytek.");
    } finally {
      setScrappingReceiptUnitId(null);
    }
  }

  async function handleDisposeRemnant(row: MaterialRemnantStockItem) {
    const remnantQty = Number(row.qty || 0);
    if (row.status !== "active" || remnantQty <= 0) return;
    const code = row.remnant_code?.trim() || formatRemnantCode(row.id);
    const remnantUnit = row.uom?.trim() || unit;
    const ok = window.confirm(
      `Opravdu chcete zlikvidovat zbytek ${code}?\n\nZbytek ${remnantQty} ${remnantUnit}, tavba ${row.heat_lot || "—"}, atest ${row.certificate_no || "—"} bude vyřazen ze skladu zbytků. Akce zůstane v auditní stopě.`
    );
    if (!ok) return;

    setDisposingRemnantId(row.id);
    setError(null);
    setSuccessMessage(null);
    try {
      const res = await disposeMaterialRemnantStockItem(row.id);
      await loadData();
      setSuccessMessage(res.message || `Zbytek ${code} byl zlikvidován.`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Nepodařilo se zlikvidovat zbytek.");
    } finally {
      setDisposingRemnantId(null);
    }
  }

  const showTraceFields = movementType === "prijem";
  const unit = stockItem.unit?.trim() || "mm";
  const belowMin =
    stockItem.min_qty != null && Number.isFinite(stockItem.min_qty) && stockItem.current_qty < stockItem.min_qty;
  const statusLabel = stockItem.is_active ? "Aktivní" : "Neaktivní";
  const statusStyle: React.CSSProperties = {
    ...UI.statusBadgeBase,
    ...(stockItem.is_active ? UI.statusBadgeOk : UI.statusBadgeProblem),
  };
  const lastMovement = rows[0]?.movement_date ?? null;
  const lastReceipt = rows.find((r) => r.movement_type === "prijem")?.movement_date ?? null;
  const receiptRows = rows.filter((r) => r.movement_type === "prijem");
  const filteredReceiptRows = useMemo(
    () =>
      receiptRows.filter((row) =>
        matchesSearchQuery(
          receiptSearch,
          buildSearchHaystack(
            row.receipt_unit_code,
            row.receipt_unit_id != null ? formatReceiptUnitCode(row.receipt_unit_id) : null,
            row.scan_code,
            stockItem.material_code,
            stockItem.material_name,
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
    [receiptRows, receiptSearch, stockItem.material_code, stockItem.material_name]
  );
  const filteredReceiptUnits = useMemo(
    () =>
      receiptUnits.filter((ru) => {
        const matchesStatus = !receiptUnitStatusFilter || ru.status === receiptUnitStatusFilter;
        const matchesText = matchesSearchQuery(
          receiptUnitSearch,
          buildSearchHaystack(
            ru.receipt_unit_code,
            ru.heat_lot,
            ru.certificate_no,
            ru.delivery_note_no,
            ru.supplier_name,
            ru.status,
            receiptUnitStatusLabel(ru.status)
          )
        );
        return matchesStatus && matchesText;
      }),
    [receiptUnits, receiptUnitSearch, receiptUnitStatusFilter]
  );
  const filteredMovementRows = useMemo(
    () =>
      rows.filter((row) => {
        const matchesType = !movementTypeFilter || row.movement_type === movementTypeFilter;
        const matchesText = matchesSearchQuery(
          movementSearch,
          buildSearchHaystack(
            row.scan_code,
            row.movement_type,
            movementTypeLabel(row.movement_type),
            row.receipt_unit_code,
            row.receipt_unit_id != null ? formatReceiptUnitCode(row.receipt_unit_id) : null,
            row.remnant_stock_item_id != null ? formatRemnantCode(row.remnant_stock_item_id) : null,
            row.remnant_stock_item_id,
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
    [rows, movementSearch, movementTypeFilter]
  );
  const filteredRemnantRows = useMemo(
    () =>
      remnantRows.filter((row) => {
        const matchesStatus = !remnantStatusFilter || row.status === remnantStatusFilter;
        const matchesText = matchesSearchQuery(
          remnantSearch,
          buildSearchHaystack(
            row.remnant_code,
            formatRemnantCode(row.id),
            row.source_receipt_unit_code,
            formatReceiptUnitCode(row.source_receipt_unit_id),
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
    [remnantRows, remnantSearch, remnantStatusFilter]
  );

  function renderFilterChip<T extends string>(
    label: string,
    value: T,
    activeValue: T,
    onClick: (value: T) => void
  ) {
    const active = value === activeValue;
    return (
      <button
        key={value || "all"}
        type="button"
        onClick={() => onClick(value)}
        style={{ ...detailFilterChipBase, ...(active ? UI.subTabActive : {}) }}
      >
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

  return (
    <div className="erp-overview-page" style={UI.container}>
      <div style={{ paddingTop: 10, display: "flex", flexDirection: "column", gap: 22 }}>
        <DetailPageHeader
          title={
            <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 26,
                  fontWeight: 1000,
                  color: UI.colors.primary,
                  letterSpacing: 0.3,
                  lineHeight: 1.05,
                }}
              >
                {stockItem.material_code || stockItem.material_name}
              </div>
              <div style={{ fontSize: 15, fontWeight: 700, color: UI.colors.textPrimary }}>
                {stockItem.material_name}
                {stockItem.material_dimension ? (
                  <span style={{ fontWeight: 600, color: UI.colors.textSecondary }}>
                    {" | "}
                    {stockItem.material_dimension}
                  </span>
                ) : null}
              </div>
            </div>
          }
          headerAside={
            <span className="erp-status-badge" style={statusStyle}>
              {statusLabel}
            </span>
          }
          actions={
            <button type="button" style={UI.buttons.secondary} onClick={onBack}>
              Zpět na sklad materiálu
            </button>
          }
        />

        <div style={UI.subTabsContainer}>
          {DETAIL_TABS.map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
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

        {activeTab === "overview" ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={erpDetailStateCard}>
              <div style={erpDetailSectionEyebrow}>Aktuální stav skladu</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 14 }}>
                <div>
                  <div style={erpDetailRowLabel}>Aktuální stav</div>
                  <div style={{ ...erpDetailRowValue, color: belowMin ? UI.colors.problemFg : UI.colors.textPrimary }}>
                    {stockItem.current_qty} {unit}
                    {belowMin ? (
                      <span
                        style={{
                          marginLeft: 8,
                          fontSize: 11,
                          fontWeight: 800,
                          color: UI.colors.problemFg,
                          textTransform: "uppercase",
                          letterSpacing: 0.5,
                        }}
                      >
                        pod min.
                      </span>
                    ) : null}
                  </div>
                </div>
                <div>
                  <div style={erpDetailRowLabel}>Min. zásoba</div>
                  <div style={erpDetailRowValue}>{stockItem.min_qty == null ? "—" : `${stockItem.min_qty} ${unit}`}</div>
                </div>
                <div>
                  <div style={erpDetailRowLabel}>Lokace</div>
                  <div style={erpDetailRowValue}>{stockItem.location?.trim() ? stockItem.location : "—"}</div>
                </div>
                <div>
                  <div style={erpDetailRowLabel}>Scan kód</div>
                  <div style={erpDetailRowValue}>{stockItem.scan_code?.trim() ? stockItem.scan_code : "—"}</div>
                </div>
              </div>
            </div>

            <div style={erpDetailKpiPanel}>
              <div style={erpDetailSectionEyebrow}>Pohyby materiálu</div>
              <div style={erpDetailKpiRow}>
                <div>
                  <div style={erpDetailKpiLabel}>Počet pohybů</div>
                  <div style={erpDetailKpiValue}>{rows.length}</div>
                </div>
                <div>
                  <div style={erpDetailKpiLabel}>Poslední pohyb</div>
                  <div style={erpDetailKpiValue}>{lastMovement ? formatDate(lastMovement) : "—"}</div>
                </div>
                <div>
                  <div style={erpDetailKpiLabel}>Poslední příjem</div>
                  <div style={erpDetailKpiValue}>{lastReceipt ? formatDate(lastReceipt) : "—"}</div>
                </div>
                <div>
                  <div style={erpDetailKpiLabel}>Jednotka</div>
                  <div style={erpDetailKpiValue}>{unit}</div>
                </div>
              </div>
            </div>

            <div style={{ padding: "12px 14px", borderRadius: 12, background: UI.colors.card, border: `1px solid ${UI.colors.border}` }}>
              <div style={{ ...erpDetailSectionEyebrow, color: UI.colors.neutralFg, marginBottom: 8 }}>Identifikace</div>
              <div style={erpDetailIdentGrid}>
                <div>
                  <div style={erpDetailIdentLabel}>Kód materiálu</div>
                  <div style={erpDetailIdentValue}>{stockItem.material_code || "—"}</div>
                </div>
                <div>
                  <div style={erpDetailIdentLabel}>Název</div>
                  <div style={erpDetailIdentValue}>{stockItem.material_name}</div>
                </div>
                <div>
                  <div style={erpDetailIdentLabel}>Rozměr</div>
                  <div style={erpDetailIdentValue}>{stockItem.material_dimension || "—"}</div>
                </div>
                <div>
                  <div style={erpDetailIdentLabel}>Poznámka</div>
                  <div style={erpDetailIdentValue}>{stockItem.note?.trim() ? stockItem.note : "—"}</div>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {activeTab === "receipts" ? (
          <div style={{ ...UI.card, borderRadius: 14, padding: 16 }}>
            <div style={{ ...UI.sectionTitle, fontSize: 16, marginBottom: 10 }}>Příjmy materiálu</div>
            <div style={detailFilterBarStyle}>
              <div style={{ ...UI.ordersFilterSearchWrap, flex: "1 1 320px", minWidth: 220 }}>
                <input
                  className="erp-overview-search"
                  value={receiptSearch}
                  onChange={(e) => setReceiptSearch(e.target.value)}
                  placeholder="Hledat příjem, tavbu, atest, dodavatele, přílohu…"
                  style={UI.inputs.overviewSearch}
                />
              </div>
            </div>
            {loading ? <div style={UI.sectionSubtitle}>Načítám příjmy...</div> : null}
            {!loading ? (
              <div style={{ overflowX: "auto" }}>
                <table style={UI.table}>
                  <thead>
                    <tr style={{ background: "#f8fafc" }}>
                      {["Datum", "ID příjmu / tyče", "Množství", "Tavba / šarže", "Atest", "DL", "Dodavatel", "Reference", "Přílohy", "Poznámka"].map((h) => (
                        <th key={h} style={{ ...UI.th, fontSize: 12, padding: "10px 8px", whiteSpace: "nowrap" }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredReceiptRows.map((row) => (
                      <tr key={row.id}>
                        <td style={{ ...UI.td, padding: "10px 8px", whiteSpace: "nowrap" }}>{formatDate(row.movement_date)}</td>
                        <td style={{ ...UI.td, padding: "10px 8px", whiteSpace: "nowrap", fontWeight: 900 }}>
                          {row.receipt_unit_code?.trim() || (row.receipt_unit_id != null ? formatReceiptUnitCode(row.receipt_unit_id) : "—")}
                        </td>
                        <td style={{ ...UI.td, padding: "10px 8px", whiteSpace: "nowrap" }}>{row.qty} {unit}</td>
                        <td style={{ ...UI.td, padding: "10px 8px", maxWidth: 140 }}>{row.heat_lot || "—"}</td>
                        <td style={{ ...UI.td, padding: "10px 8px", maxWidth: 100 }}>{row.certificate_no || "—"}</td>
                        <td style={{ ...UI.td, padding: "10px 8px", maxWidth: 100 }}>{row.delivery_note_no || "—"}</td>
                        <td style={{ ...UI.td, padding: "10px 8px", maxWidth: 140 }}>{row.supplier_name || "—"}</td>
                        <td style={{ ...UI.td, padding: "10px 8px", maxWidth: 120 }}>{row.reference || "—"}</td>
                        <td style={{ ...UI.td, padding: "10px 8px", fontSize: 12 }}>{renderAttachmentLinks(row)}</td>
                        <td style={{ ...UI.td, padding: "10px 8px", maxWidth: 160 }}>{row.note || "—"}</td>
                      </tr>
                    ))}
                    {filteredReceiptRows.length === 0 ? (
                      <tr>
                        <td colSpan={10} style={{ ...UI.td, textAlign: "center", color: "#64748b", padding: "14px 10px" }}>
                          Žádné příjmy neodpovídají filtru.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        ) : null}

        {activeTab === "receipt-units" ? (
        <div style={{ ...UI.card, borderRadius: 14, padding: 16 }}>
          <div style={{ ...UI.sectionTitle, fontSize: 16, marginBottom: 10 }}>Příjmy / zůstatky tyčí</div>
          <div style={detailFilterBarStyle}>
            <div style={{ ...UI.ordersFilterSearchWrap, flex: "1 1 320px", minWidth: 220 }}>
              <input
                className="erp-overview-search"
                value={receiptUnitSearch}
                onChange={(e) => setReceiptUnitSearch(e.target.value)}
                placeholder="Hledat ID tyče, tavbu, atest, DL, dodavatele, stav…"
                style={UI.inputs.overviewSearch}
              />
            </div>
            {[
              { label: "Vše", value: "" as ReceiptUnitStatusFilter },
              { label: "Aktivní", value: "active" as ReceiptUnitStatusFilter },
              { label: "Spotřebované", value: "consumed" as ReceiptUnitStatusFilter },
            ].map((chip) => renderFilterChip(chip.label, chip.value, receiptUnitStatusFilter, setReceiptUnitStatusFilter))}
          </div>
          {loading ? <div style={UI.sectionSubtitle}>Načítám příjmy...</div> : null}
          {successMessage ? <div style={{ color: "#047857", fontWeight: 800, marginBottom: 8 }}>{successMessage}</div> : null}
          {!loading ? (
            <div style={{ overflowX: "auto" }}>
              <table style={UI.table}>
                <thead>
                  <tr style={{ background: "#f8fafc" }}>
                    {[
                      "ID tyče",
                      "Tavba / šarže",
                      "Atest",
                      "Původní příjem",
                      "Zbývá",
                      "Stav",
                      "Datum příjmu",
                      "DL",
                      "Dodavatel",
                      "Akce",
                    ].map((h) => (
                      <th key={h} style={{ ...UI.th, fontSize: 12, padding: "10px 8px", whiteSpace: "nowrap" }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredReceiptUnits.map((ru) => {
                    const ruUnit = ru.uom?.trim() || unit;
                    const canScrap = Number(ru.remaining_qty || 0) > 0;
                    const isScrapping = scrappingReceiptUnitId === ru.id;
                    return (
                      <tr key={ru.id}>
                        <td style={{ ...UI.td, padding: "10px 8px", whiteSpace: "nowrap", fontWeight: 900 }}>
                          {ru.receipt_unit_code || formatReceiptUnitCode(ru.id)}
                        </td>
                        <td style={{ ...UI.td, padding: "10px 8px", maxWidth: 140 }}>{ru.heat_lot || "—"}</td>
                        <td style={{ ...UI.td, padding: "10px 8px", maxWidth: 100 }}>{ru.certificate_no || "—"}</td>
                        <td style={{ ...UI.td, padding: "10px 8px", whiteSpace: "nowrap" }}>
                          {ru.received_qty} {ruUnit}
                        </td>
                        <td style={{ ...UI.td, padding: "10px 8px", whiteSpace: "nowrap", fontWeight: 900 }}>
                          {ru.remaining_qty} {ruUnit}
                        </td>
                        <td style={{ ...UI.td, padding: "10px 8px", whiteSpace: "nowrap" }}>{receiptUnitStatusLabel(ru.status)}</td>
                        <td style={{ ...UI.td, padding: "10px 8px", whiteSpace: "nowrap" }}>
                          {formatDate(ru.received_at)}
                        </td>
                        <td style={{ ...UI.td, padding: "10px 8px", maxWidth: 100 }}>{ru.delivery_note_no || "—"}</td>
                        <td style={{ ...UI.td, padding: "10px 8px", maxWidth: 140 }}>{ru.supplier_name || "—"}</td>
                        <td style={{ ...UI.td, padding: "10px 8px", whiteSpace: "nowrap" }}>
                          <button
                            type="button"
                            style={{ ...UI.buttons.secondary, ...(!canScrap || isScrapping ? { opacity: 0.6, cursor: "not-allowed" } : {}) }}
                            disabled={!canScrap || isScrapping}
                            onClick={() => handleScrapReceiptUnit(ru)}
                          >
                            {isScrapping ? "Odepisuji..." : "Odepsat zbytek"}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {filteredReceiptUnits.length === 0 ? (
                    <tr>
                      <td colSpan={10} style={{ ...UI.td, textAlign: "center", color: "#64748b", padding: "14px 10px" }}>
                        Žádné příjmové jednotky neodpovídají filtru.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
        ) : null}

        {activeTab === "movements" ? (
        <div style={{ ...UI.card, borderRadius: 14, padding: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 10 }}>
            <div style={{ ...UI.sectionTitle, fontSize: 16, marginBottom: 0 }}>Pohyby materiálu</div>
            {!showForm ? (
              <button
                type="button"
                style={UI.buttons.primary}
                onClick={() => {
                  setEditingMovementId(null);
                  setMovementType("prijem");
                  setQty("");
                  setMovementDate(nowLocalDateTimeValue());
                  setReference("");
                  setNote("");
                  resetMovementExtras();
                  setShowForm(true);
                }}
              >
                Přidat pohyb
              </button>
            ) : null}
          </div>
          <div style={detailFilterBarStyle}>
            <div style={{ ...UI.ordersFilterSearchWrap, flex: "1 1 320px", minWidth: 220 }}>
              <input
                className="erp-overview-search"
                value={movementSearch}
                onChange={(e) => setMovementSearch(e.target.value)}
                placeholder="Hledat pohyb, typ, tyč/zbytek, tavbu, atest, referenci…"
                style={UI.inputs.overviewSearch}
              />
            </div>
            {[
              { label: "Vše", value: "" as MovementTypeFilter },
              { label: "Příjem", value: "prijem" as MovementTypeFilter },
              { label: "Výdej", value: "vydej" as MovementTypeFilter },
              { label: "Výdej ze zbytku", value: "vydej_zbytek" as MovementTypeFilter },
              { label: "Odpis zbytku", value: "odpis_zbytku" as MovementTypeFilter },
              { label: "Likvidace zbytku", value: "likvidace_zbytku" as MovementTypeFilter },
            ].map((chip) => renderFilterChip(chip.label, chip.value, movementTypeFilter, setMovementTypeFilter))}
          </div>

          {showForm ? (
            <div style={{ border: "1px solid #e2e8f0", borderRadius: 12, background: "#f8fafc", padding: 16, marginBottom: 14 }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
                <div>
                  <div style={UI.inputs.label}>Typ</div>
                  <select
                    value={movementType}
                    onChange={(e) =>
                      setMovementType(e.target.value as "prijem" | "vydej" | "korekce" | "storno_vydeje")
                    }
                    style={UI.inputs.base}
                  >
                    <option value="prijem">prijem</option>
                    <option value="vydej">vydej</option>
                    <option value="korekce">korekce</option>
                    <option value="storno_vydeje">storno_vydeje</option>
                  </select>
                </div>
                <div>
                  <div style={UI.inputs.label}>Množství (mm)</div>
                  <input value={qty} onChange={(e) => setQty(e.target.value)} style={UI.inputs.base} />
                </div>
                <div>
                  <div style={UI.inputs.label}>Datum</div>
                  <input
                    type="datetime-local"
                    value={movementDate}
                    onChange={(e) => setMovementDate(e.target.value)}
                    style={UI.inputs.base}
                  />
                </div>
                <div>
                  <div style={UI.inputs.label}>Reference</div>
                  <input value={reference} onChange={(e) => setReference(e.target.value)} style={UI.inputs.base} />
                </div>
                <div>
                  <div style={UI.inputs.label}>Poznámka</div>
                  <input value={note} onChange={(e) => setNote(e.target.value)} style={UI.inputs.base} />
                </div>
              </div>

              {showTraceFields ? (
                <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
                  <div>
                    <div style={UI.inputs.label}>Tavba / šarže {movementType === "prijem" ? "(povinné)" : ""}</div>
                    <input value={heatLot} onChange={(e) => setHeatLot(e.target.value)} style={UI.inputs.base} />
                  </div>
                  <div>
                    <div style={UI.inputs.label}>Dodavatel</div>
                    <input value={supplierName} onChange={(e) => setSupplierName(e.target.value)} style={UI.inputs.base} />
                  </div>
                  <div>
                    <div style={UI.inputs.label}>Číslo dodacího listu</div>
                    <input value={deliveryNoteNo} onChange={(e) => setDeliveryNoteNo(e.target.value)} style={UI.inputs.base} />
                  </div>
                  <div>
                    <div style={UI.inputs.label}>Číslo atestu</div>
                    <input value={certificateNo} onChange={(e) => setCertificateNo(e.target.value)} style={UI.inputs.base} />
                  </div>
                  <div style={{ gridColumn: "1 / -1" }}>
                    <div style={UI.inputs.label}>Přílohy (PDF, JPG, PNG) — pouze u příjmu</div>
                    <input
                      type="file"
                      accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
                      multiple
                      onChange={(e) => setAttachmentFiles(e.target.files ? Array.from(e.target.files) : [])}
                      style={{ fontSize: 13 }}
                    />
                    {attachmentFiles.length > 0 ? (
                      <div style={{ fontSize: 12, color: "#64748b", marginTop: 6 }}>
                        Vybráno: {attachmentFiles.map((f) => f.name).join(", ")}
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : (
                <div style={{ marginTop: 14 }}>
                  <div style={UI.inputs.label}>Tavba / šarže (volitelné)</div>
                  <input value={heatLot} onChange={(e) => setHeatLot(e.target.value)} style={{ ...UI.inputs.base, maxWidth: 400 }} />
                </div>
              )}

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
                <button
                  type="button"
                  style={UI.buttons.secondary}
                  onClick={() => {
                    setShowForm(false);
                    setEditingMovementId(null);
                  }}
                  disabled={saving}
                >
                  Zrušit
                </button>
                <button
                  type="button"
                  style={{ ...UI.buttons.primary, ...(saving ? { opacity: 0.7, cursor: "wait" } : {}) }}
                  onClick={handleSaveMovement}
                  disabled={saving}
                >
                  {saving ? "Ukládám..." : editingMovementId == null ? "Uložit pohyb" : "Uložit změny pohybu"}
                </button>
              </div>
            </div>
          ) : null}

          {loading ? <div style={UI.sectionSubtitle}>Načítám pohyby...</div> : null}
          {error ? <div style={{ color: "#b91c1c", fontWeight: 700, marginBottom: 8 }}>{error}</div> : null}

          {!loading ? (
            <div style={{ overflowX: "auto" }}>
              <table style={UI.table}>
                <thead>
                  <tr style={{ background: "#f8fafc" }}>
                    {[
                      "ID pohybu",
                      "Typ",
                      "ID tyče / zbytku",
                      "Množství",
                      "Datum",
                      "Tavba / šarže",
                      "Dodavatel",
                      "DL",
                      "Atest",
                      "Reference",
                      "Přílohy",
                      "Poznámka",
                      "Akce",
                    ].map((h) => (
                      <th key={h} style={{ ...UI.th, fontSize: 12, padding: "10px 8px", whiteSpace: "nowrap" }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredMovementRows.map((row) => (
                    <tr key={row.id}>
                      <td style={{ ...UI.td, padding: "10px 8px", whiteSpace: "nowrap", fontWeight: 900 }}>
                        {row.scan_code || "—"}
                      </td>
                      <td style={{ ...UI.td, padding: "10px 8px", whiteSpace: "nowrap", fontWeight: 800 }}>
                        {movementTypeLabel(row.movement_type)}
                      </td>
                      <td style={{ ...UI.td, padding: "10px 8px", whiteSpace: "nowrap", fontWeight: 900 }}>
                        {movementTraceCode(row)}
                      </td>
                      <td style={{ ...UI.td, padding: "10px 8px", whiteSpace: "nowrap" }}>{row.qty} mm</td>
                      <td style={{ ...UI.td, padding: "10px 8px", whiteSpace: "nowrap" }}>{formatDate(row.movement_date)}</td>
                      <td style={{ ...UI.td, padding: "10px 8px", maxWidth: 140 }}>{row.heat_lot || "—"}</td>
                      <td style={{ ...UI.td, padding: "10px 8px", maxWidth: 120 }}>{row.supplier_name || "—"}</td>
                      <td style={{ ...UI.td, padding: "10px 8px", maxWidth: 100 }}>{row.delivery_note_no || "—"}</td>
                      <td style={{ ...UI.td, padding: "10px 8px", maxWidth: 100 }}>{row.certificate_no || "—"}</td>
                      <td style={{ ...UI.td, padding: "10px 8px", maxWidth: 120 }}>{row.reference || "—"}</td>
                      <td style={{ ...UI.td, padding: "10px 8px", fontSize: 12 }}>{renderAttachmentLinks(row)}</td>
                      <td style={{ ...UI.td, padding: "10px 8px", maxWidth: 160 }}>{row.note || "—"}</td>
                      <td style={{ ...UI.td, padding: "10px 8px", whiteSpace: "nowrap", display: "flex", gap: 6 }}>
                        <button
                          type="button"
                          style={{
                            ...UI.buttons.secondary,
                            ...(row.movement_type === "odpis_zbytku" || row.movement_type === "vydej_zbytek" || row.movement_type === "likvidace_zbytku"
                              ? { opacity: 0.6, cursor: "not-allowed" }
                              : {}),
                          }}
                          disabled={row.movement_type === "odpis_zbytku" || row.movement_type === "vydej_zbytek" || row.movement_type === "likvidace_zbytku"}
                          onClick={() => openEditMovement(row)}
                        >
                          Upravit
                        </button>
                        <button
                          type="button"
                          style={{
                            ...UI.buttons.secondary,
                            ...(row.movement_type === "odpis_zbytku" || row.movement_type === "likvidace_zbytku" ? { opacity: 0.6, cursor: "not-allowed" } : {}),
                          }}
                          disabled={row.movement_type === "odpis_zbytku" || row.movement_type === "likvidace_zbytku"}
                          onClick={() => handleDeleteMovement(row)}
                        >
                          Smazat
                        </button>
                      </td>
                    </tr>
                  ))}
                  {filteredMovementRows.length === 0 ? (
                    <tr>
                      <td colSpan={13} style={{ ...UI.td, textAlign: "center", color: "#64748b", padding: "14px 10px" }}>
                        Žádné pohyby neodpovídají filtru.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
        ) : null}

        {activeTab === "remnants" ? (
          <div style={{ ...UI.card, borderRadius: 14, padding: 16 }}>
            <div style={{ ...UI.sectionTitle, fontSize: 16, marginBottom: 10 }}>Zbytky</div>
            <div style={detailFilterBarStyle}>
              <div style={{ ...UI.ordersFilterSearchWrap, flex: "1 1 320px", minWidth: 220 }}>
                <input
                  className="erp-overview-search"
                  value={remnantSearch}
                  onChange={(e) => setRemnantSearch(e.target.value)}
                  placeholder="Hledat zbytek, zdrojovou tyč, tavbu, atest, stav, poznámku…"
                  style={UI.inputs.overviewSearch}
                />
              </div>
              {[
                { label: "Vše", value: "" as RemnantStatusFilter },
                { label: "Aktivní", value: "active" as RemnantStatusFilter },
                { label: "Spotřebované", value: "consumed" as RemnantStatusFilter },
                { label: "Zlikvidované", value: "scrapped" as RemnantStatusFilter },
              ].map((chip) => renderFilterChip(chip.label, chip.value, remnantStatusFilter, setRemnantStatusFilter))}
            </div>
            {loading ? <div style={UI.sectionSubtitle}>Načítám zbytky...</div> : null}
            {successMessage ? <div style={{ color: "#047857", fontWeight: 800, marginBottom: 8 }}>{successMessage}</div> : null}
            {error ? <div style={{ color: "#b91c1c", fontWeight: 700, marginBottom: 8 }}>{error}</div> : null}
            {!loading ? (
              <div style={{ overflowX: "auto" }}>
                <table style={UI.table}>
                  <thead>
                    <tr style={{ background: "#f8fafc" }}>
                      {["ID zbytku", "Tavba / šarže", "Atest", "Množství", "Stav", "Datum vytvoření", "Zdrojová tyč", "Zdrojový příjem", "DL", "Dodavatel", "Akce"].map((h) => (
                        <th key={h} style={{ ...UI.th, fontSize: 12, padding: "10px 8px", whiteSpace: "nowrap" }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRemnantRows.map((row) => {
                      const canDispose = row.status === "active" && Number(row.qty || 0) > 0;
                      const isDisposing = disposingRemnantId === row.id;
                      return (
                        <tr key={row.id}>
                          <td style={{ ...UI.td, padding: "10px 8px", whiteSpace: "nowrap", fontWeight: 900 }}>
                            {row.remnant_code?.trim() || formatRemnantCode(row.id)}
                          </td>
                          <td style={{ ...UI.td, padding: "10px 8px", maxWidth: 140 }}>{row.heat_lot || "—"}</td>
                          <td style={{ ...UI.td, padding: "10px 8px", maxWidth: 100 }}>{row.certificate_no || "—"}</td>
                          <td style={{ ...UI.td, padding: "10px 8px", whiteSpace: "nowrap", fontWeight: 900 }}>
                            {row.qty} {row.uom || unit}
                          </td>
                          <td style={{ ...UI.td, padding: "10px 8px", whiteSpace: "nowrap" }}>{remnantStatusLabel(row.status)}</td>
                          <td style={{ ...UI.td, padding: "10px 8px", whiteSpace: "nowrap" }}>
                            {row.created_at ? formatDate(row.created_at) : "—"}
                          </td>
                          <td style={{ ...UI.td, padding: "10px 8px", whiteSpace: "nowrap", fontWeight: 900 }}>
                            {row.source_receipt_unit_code?.trim() || formatReceiptUnitCode(row.source_receipt_unit_id)}
                          </td>
                          <td style={{ ...UI.td, padding: "10px 8px", whiteSpace: "nowrap" }}>
                            {sourceReceiptUnitTrace(row)}
                          </td>
                          <td style={{ ...UI.td, padding: "10px 8px", maxWidth: 100 }}>{row.delivery_note_no || "—"}</td>
                          <td style={{ ...UI.td, padding: "10px 8px", maxWidth: 140 }}>{row.supplier_name || "—"}</td>
                          <td style={{ ...UI.td, padding: "10px 8px", whiteSpace: "nowrap" }}>
                            <button
                              type="button"
                              style={{ ...UI.buttons.secondary, ...(!canDispose || isDisposing ? { opacity: 0.6, cursor: "not-allowed" } : {}) }}
                              disabled={!canDispose || isDisposing}
                              onClick={() => handleDisposeRemnant(row)}
                            >
                              {isDisposing ? "Likviduji..." : "Zlikvidovat"}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                    {filteredRemnantRows.length === 0 ? (
                      <tr>
                        <td colSpan={11} style={{ ...UI.td, textAlign: "center", color: "#64748b", padding: "14px 10px" }}>
                          Žádné zbytky neodpovídají filtru.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
