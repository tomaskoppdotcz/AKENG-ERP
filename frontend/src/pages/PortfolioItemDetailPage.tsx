import React, { useEffect, useMemo, useState } from "react";
import DetailPageHeader from "../components/DetailPageHeader";
import { FormField, FormGrid, FormSection, HighlightBox, formControlStyle, formTextareaStyle } from "../components/FormLayout";
import PageContainer from "../components/layout/PageContainer";
import {
  erpDetailIdentLabel,
  erpDetailIdentValue,
  erpDetailRowLabel,
  erpDetailRowValue,
  erpDetailSectionEyebrow,
  erpDetailStateCard,
  UI,
} from "../styles/ui";
import { getMaterialLibraryItems, type MaterialLibraryItem } from "../services/materialLibraryApi";
import {
  getCustomers,
  getOperationLibraryItems,
  getWorkplaceLibraryItems,
  type CustomerListItem,
  type OperationLibraryItem,
  type WorkplaceLibraryItem,
} from "../services/masterLibrariesApi";
import {
  createPortfolioTechnologyMaterial,
  createPortfolioTechnologyTemplate,
  createPortfolioTechnologyOperation,
  deletePortfolioTechnologyMaterial,
  deletePortfolioTechnologyOperation,
  getPortfolioTechnologyMaterials,
  getPortfolioItems,
  getPortfolioItemTechnology,
  reorderPortfolioTechnologyOperations,
  updatePortfolioTechnologyMaterial,
  updatePortfolioTechnologyOperation,
  type PortfolioItem,
  type PortfolioTechnologyMaterial,
  type PortfolioTechnologyOperation,
} from "../services/portfolioApi";
import { buildErpUrl } from "../utils/erpDeepLink";

type Props = {
  item?: PortfolioItem | null;
  onBack: () => void;
  /** Volitelný text tlačítka zpět (např. návrat z detailu zakázky). */
  backLabel?: string;
};

type PortfolioDetailSubtab = "Přehled" | "Technologický postup" | "Dokumenty" | "Historie";

const SUBTABS: PortfolioDetailSubtab[] = ["Přehled", "Technologický postup", "Dokumenty", "Historie"];

function logisticLabel(mode: string) {
  if (mode === "sklad") return "Sklad";
  if (mode === "sklad_zakaznik") return "Sklad zákazník";
  return "Výroba zákazník";
}

function formatSalePriceCzk(value: number | null | undefined): string {
  if (value == null) return "—";
  return `${new Intl.NumberFormat("cs-CZ", { maximumFractionDigits: 2, minimumFractionDigits: 0 }).format(value)}\u00a0Kč`;
}

export default function PortfolioItemDetailPage({ item, onBack, backLabel }: Props) {
  const [activeTab, setActiveTab] = useState<PortfolioDetailSubtab>("Technologický postup");
  const [hoverTab, setHoverTab] = useState<PortfolioDetailSubtab | null>(null);
  const [showAddOperationForm, setShowAddOperationForm] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [editingOperationId, setEditingOperationId] = useState<number | null>(null);
  const [operationLibraryId, setOperationLibraryId] = useState<number | null>(null);
  const [workplaceLibraryId, setWorkplaceLibraryId] = useState<number | null>(null);
  const [legacyOperationLabel, setLegacyOperationLabel] = useState<string | null>(null);
  const [legacyWorkplaceLabel, setLegacyWorkplaceLabel] = useState<string | null>(null);
  const [editStartedWithOperationFk, setEditStartedWithOperationFk] = useState(false);
  const [editStartedWithWorkplaceFk, setEditStartedWithWorkplaceFk] = useState(false);
  const [setupMin, setSetupMin] = useState("0");
  const [runMinPerPiece, setRunMinPerPiece] = useState("0");
  const [controlRequired, setControlRequired] = useState(false);
  const [outsourcing, setOutsourcing] = useState(false);
  const [isCooperation, setIsCooperation] = useState(false);
  const [cooperationCategory, setCooperationCategory] = useState("");
  const [preferredSupplierId, setPreferredSupplierId] = useState<number | null>(null);
  const [cooperationNote, setCooperationNote] = useState("");
  const [note, setNote] = useState("");
  const [templateId, setTemplateId] = useState<number | null>(item?.active_template_id ?? null);
  const [operations, setOperations] = useState<PortfolioTechnologyOperation[]>([]);
  const [techLoading, setTechLoading] = useState(false);
  const [techError, setTechError] = useState<string | null>(null);
  const [creatingTemplate, setCreatingTemplate] = useState(false);
  const [reorderBusy, setReorderBusy] = useState(false);
  const [operationLibraryItems, setOperationLibraryItems] = useState<OperationLibraryItem[]>([]);
  const [workplaceLibraryItems, setWorkplaceLibraryItems] = useState<WorkplaceLibraryItem[]>([]);
  const [supplierItems, setSupplierItems] = useState<CustomerListItem[]>([]);
  const [librariesLoading, setLibrariesLoading] = useState(false);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [materials, setMaterials] = useState<PortfolioTechnologyMaterial[]>([]);
  const [materialsLoading, setMaterialsLoading] = useState(false);
  const [materialsError, setMaterialsError] = useState<string | null>(null);
  const [showAddMaterialForm, setShowAddMaterialForm] = useState(false);
  const [isMaterialEditMode, setIsMaterialEditMode] = useState(false);
  const [editingMaterialId, setEditingMaterialId] = useState<number | null>(null);
  const [tpInputType, setTpInputType] = useState<"material" | "product_stock">("material");
  const [portfolioInputItemId, setPortfolioInputItemId] = useState<number | null>(null);
  const [portfolioInputs, setPortfolioInputs] = useState<PortfolioItem[]>([]);
  const [materialLibraryItems, setMaterialLibraryItems] = useState<MaterialLibraryItem[]>([]);
  const [materialLibraryLoading, setMaterialLibraryLoading] = useState(false);
  const [materialLibraryError, setMaterialLibraryError] = useState<string | null>(null);
  const [materialLibraryId, setMaterialLibraryId] = useState<number | null>(null);
  const [consumptionPerPiece, setConsumptionPerPiece] = useState("");
  const [consumptionUnit, setConsumptionUnit] = useState("");
  const [scrapAllowance, setScrapAllowance] = useState("");
  const [naUpnutiMm, setNaUpnutiMm] = useState("");
  const [vyrabetMaxPoKs, setVyrabetMaxPoKs] = useState("");
  const [povolitDeleniPolotovaru, setPovolitDeleniPolotovaru] = useState(true);
  const [materialNote, setMaterialNote] = useState("");

  const materialById = useMemo(() => {
    const map = new Map<number, MaterialLibraryItem>();
    for (const row of materialLibraryItems) map.set(row.id, row);
    return map;
  }, [materialLibraryItems]);

  const activeMaterialLibrary = useMemo(
    () => materialLibraryItems.filter((m) => m.is_active),
    [materialLibraryItems]
  );

  const activeOperationLibrary = useMemo(
    () => operationLibraryItems.filter((o) => o.is_active),
    [operationLibraryItems]
  );
  const activeWorkplaceLibrary = useMemo(
    () => workplaceLibraryItems.filter((w) => w.is_active),
    [workplaceLibraryItems]
  );
  const activeSuppliers = useMemo(
    () => supplierItems.filter((s) => s.is_active),
    [supplierItems]
  );

  const operationSelectValue = useMemo(() => {
    if (operationLibraryId != null) return String(operationLibraryId);
    if (legacyOperationLabel) return "__legacy_op__";
    return "";
  }, [operationLibraryId, legacyOperationLabel]);

  const workplaceSelectValue = useMemo(() => {
    if (workplaceLibraryId != null) return String(workplaceLibraryId);
    if (legacyWorkplaceLabel) return "__legacy_wp__";
    return "";
  }, [workplaceLibraryId, legacyWorkplaceLabel]);

  const detail = useMemo(
    () =>
      item
        ? {
            id: item.id,
            gpn: item.gpn,
            scan_code: item.scan_code ?? null,
            name: item.name,
            customer_id: item.customer_id,
            customer_name: item.customer_name ?? null,
            group_id: item.group_id,
            group_name: item.group_name ?? null,
            active_template_id: item.active_template_id,
            drawing_no: item.drawing_no ?? null,
            revision: item.revision ?? null,
            material_default: item.material_default ?? null,
            logistic_mode: item.logistic_mode ?? null,
            sale_price_per_piece: item.sale_price_per_piece ?? null,
          }
        : null,
    [item]
  );

  async function loadTechnology() {
    if (!item?.id) {
      setTemplateId(null);
      setOperations([]);
      return;
    }
    setTechLoading(true);
    setTechError(null);
    try {
      const data = await getPortfolioItemTechnology(item.id);
      setTemplateId(data.template_id);
      setOperations(data.operations);
    } catch (e: unknown) {
      setTechError(e instanceof Error ? e.message : "Nepodarilo se nacist technologicky postup.");
      setTemplateId(null);
      setOperations([]);
    } finally {
      setTechLoading(false);
    }
  }

  async function loadTechnologyMaterials() {
    if (!item?.id) {
      setMaterials([]);
      return;
    }
    setMaterialsLoading(true);
    setMaterialsError(null);
    try {
      const data = await getPortfolioTechnologyMaterials(item.id);
      setMaterials(data.materials);
    } catch (e: unknown) {
      setMaterialsError(e instanceof Error ? e.message : "Nepodarilo se nacist materialy.");
      setMaterials([]);
    } finally {
      setMaterialsLoading(false);
    }
  }

  useEffect(() => {
    loadTechnology();
    loadTechnologyMaterials();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id]);

  useEffect(() => {
    if (activeTab !== "Technologický postup") return;
    loadTechnologyMaterials();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  useEffect(() => {
    if (activeTab !== "Technologický postup") return;
    let cancelled = false;
    getMaterialLibraryItems()
      .then((rows) => {
        if (!cancelled) setMaterialLibraryItems(rows);
      })
      .catch(() => {
        if (!cancelled) setMaterialLibraryItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, [activeTab]);

  useEffect(() => {
    if (activeTab !== "Technologický postup") return;
    let cancelled = false;
    getPortfolioItems()
      .then((rows) => {
        if (cancelled) return;
        setPortfolioInputs(rows.filter((p) => p.logistic_mode === "sklad_zakaznik"));
      })
      .catch(() => {
        if (!cancelled) setPortfolioInputs([]);
      });
    return () => {
      cancelled = true;
    };
  }, [activeTab]);

  useEffect(() => {
    if (!showAddOperationForm) return;
    let cancelled = false;
    setLibrariesLoading(true);
    setLibraryError(null);
    Promise.all([getOperationLibraryItems(), getWorkplaceLibraryItems(), getCustomers()])
      .then(([ops, wps, suppliers]) => {
        if (!cancelled) {
          setOperationLibraryItems(ops);
          setWorkplaceLibraryItems(wps);
          setSupplierItems(suppliers);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setLibraryError(e instanceof Error ? e.message : "Nepodarilo se nacist knihovny.");
        }
      })
      .finally(() => {
        if (!cancelled) setLibrariesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [showAddOperationForm]);

  useEffect(() => {
    if (!showAddMaterialForm) return;
    let cancelled = false;
    setMaterialLibraryLoading(true);
    setMaterialLibraryError(null);
    getMaterialLibraryItems()
      .then((rows) => {
        if (!cancelled) setMaterialLibraryItems(rows);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setMaterialLibraryError(e instanceof Error ? e.message : "Nepodarilo se nacist knihovnu materialu.");
        }
      })
      .finally(() => {
        if (!cancelled) setMaterialLibraryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [showAddMaterialForm]);

  function resetForm() {
    setIsEditMode(false);
    setEditingOperationId(null);
    setOperationLibraryId(null);
    setWorkplaceLibraryId(null);
    setLegacyOperationLabel(null);
    setLegacyWorkplaceLabel(null);
    setEditStartedWithOperationFk(false);
    setEditStartedWithWorkplaceFk(false);
    setSetupMin("0");
    setRunMinPerPiece("0");
    setControlRequired(false);
    setOutsourcing(false);
    setIsCooperation(false);
    setCooperationCategory("");
    setPreferredSupplierId(null);
    setCooperationNote("");
    setNote("");
    setShowAddOperationForm(false);
  }

  function resetMaterialForm() {
    setIsMaterialEditMode(false);
    setEditingMaterialId(null);
    setTpInputType("material");
    setMaterialLibraryId(null);
    setPortfolioInputItemId(null);
    setConsumptionPerPiece("");
    setConsumptionUnit("");
    setScrapAllowance("");
    setNaUpnutiMm("");
    setVyrabetMaxPoKs("");
    setPovolitDeleniPolotovaru(true);
    setMaterialNote("");
    setShowAddMaterialForm(false);
  }

  function onOperationSelectChange(value: string) {
    if (value === "" || value === "__legacy_op__") {
      if (value === "") {
        setOperationLibraryId(null);
        setLegacyOperationLabel(null);
      }
      return;
    }
    setOperationLibraryId(Number(value));
    setLegacyOperationLabel(null);
  }

  function onWorkplaceSelectChange(value: string) {
    if (value === "" || value === "__legacy_wp__") {
      if (value === "") {
        setWorkplaceLibraryId(null);
        setLegacyWorkplaceLabel(null);
      }
      return;
    }
    setWorkplaceLibraryId(Number(value));
    setLegacyWorkplaceLabel(null);
  }

  async function saveOperation() {
    if (!templateId) return;

    const baseFields = {
      setup_time_min: Number(setupMin) || 0,
      labor_time_per_piece_min: Number(runMinPerPiece) || 0,
      control_required: controlRequired,
      outsourcing: isCooperation || outsourcing,
      is_cooperation: isCooperation,
      default_cooperation_status: isCooperation ? "pending_send" : null,
      cooperation_category: isCooperation ? cooperationCategory.trim() || null : null,
      preferred_supplier_id: isCooperation ? preferredSupplierId : null,
      cooperation_note: isCooperation ? cooperationNote.trim() || null : null,
      note: note.trim() || null,
    };

    try {
      if (isEditMode && editingOperationId != null) {
        const body: Record<string, unknown> = { ...baseFields };
        if (operationLibraryId != null) {
          body.operation_library_item_id = operationLibraryId;
        } else if (editStartedWithOperationFk) {
          body.operation_library_item_id = null;
        }
        if (workplaceLibraryId != null) {
          body.workplace_library_item_id = workplaceLibraryId;
        } else if (editStartedWithWorkplaceFk) {
          body.workplace_library_item_id = null;
        }
        await updatePortfolioTechnologyOperation(editingOperationId, body);
      } else {
        if (operationLibraryId == null) {
          setTechError("Vyberte operaci z knihovny.");
          return;
        }
        await createPortfolioTechnologyOperation(templateId, {
          operation_library_item_id: operationLibraryId,
          workplace_library_item_id: workplaceLibraryId,
          ...baseFields,
        });
      }
      setTechError(null);
      await loadTechnology();
      resetForm();
    } catch (e: unknown) {
      setTechError(e instanceof Error ? e.message : "Nepodařilo se uložit operaci.");
    }
  }

  function startEdit(op: PortfolioTechnologyOperation) {
    setIsEditMode(true);
    setEditingOperationId(op.id);
    setEditStartedWithOperationFk(op.operation_library_item_id != null);
    setEditStartedWithWorkplaceFk(op.workplace_library_item_id != null);
    setOperationLibraryId(op.operation_library_item_id ?? null);
    setWorkplaceLibraryId(op.workplace_library_item_id ?? null);
    setLegacyOperationLabel(
      op.operation_library_item_id == null && op.operation_name ? op.operation_name : null
    );
    const wpLegacy =
      op.workplace_library_item_id == null && op.machine_code && op.machine_code.trim()
        ? op.machine_code
        : null;
    setLegacyWorkplaceLabel(wpLegacy);
    setSetupMin(String(op.setup_time_min));
    setRunMinPerPiece(String(op.labor_time_per_piece_min));
    setControlRequired(op.control_required);
    setOutsourcing(op.outsourcing);
    setIsCooperation(!!op.is_cooperation || !!op.outsourcing);
    setCooperationCategory(op.cooperation_category ?? "");
    setPreferredSupplierId(op.preferred_supplier_id ?? null);
    setCooperationNote(op.cooperation_note ?? "");
    setNote(op.note ?? "");
    setShowAddOperationForm(true);
  }

  async function deleteOperation(opId: number) {
    try {
      await deletePortfolioTechnologyOperation(opId);
      await loadTechnology();
      if (editingOperationId === opId) resetForm();
    } catch (e: unknown) {
      setTechError(e instanceof Error ? e.message : "Nepodarilo se smazat operaci.");
    }
  }

  async function moveOperation(fromIndex: number, toIndex: number) {
    if (!templateId || reorderBusy) return;
    if (fromIndex < 0 || toIndex < 0 || fromIndex >= operations.length || toIndex >= operations.length) return;
    const next = [...operations];
    const tmp = next[fromIndex];
    next[fromIndex] = next[toIndex];
    next[toIndex] = tmp;
    const orderedIds = next.map((o) => o.id);
    setTechError(null);
    setReorderBusy(true);
    try {
      await reorderPortfolioTechnologyOperations(templateId, orderedIds);
      await loadTechnology();
    } catch (e: unknown) {
      setTechError(e instanceof Error ? e.message : "Nepodarilo se zmenit poradi operaci.");
    } finally {
      setReorderBusy(false);
    }
  }

  async function handleCreateTechnologyTemplate() {
    if (!item?.id || creatingTemplate) return;
    setCreatingTemplate(true);
    setTechError(null);
    try {
      await createPortfolioTechnologyTemplate(item.id);
      await loadTechnology();
    } catch (e: unknown) {
      setTechError(e instanceof Error ? e.message : "Nepodarilo se vytvorit technologicky postup.");
    } finally {
      setCreatingTemplate(false);
    }
  }

  function toNumberOrNull(value: string): number | null {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const num = Number(trimmed.replace(",", "."));
    return Number.isFinite(num) ? num : null;
  }

  function toIntOrNull(value: string): number | null {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const num = parseInt(trimmed, 10);
    return Number.isFinite(num) ? num : null;
  }

  function formatMaterialOptionLabel(m: MaterialLibraryItem): string {
    const parts = [m.code?.trim(), m.name?.trim(), m.form?.trim(), m.dimension?.trim()].filter(Boolean);
    return parts.join(" | ");
  }

  function stockStatusLabel(status: "neni_skladova_karta" | "pod_minimem" | "skladem"): string {
    if (status === "neni_skladova_karta") return "Není skladová karta";
    if (status === "pod_minimem") return "Pod minimem";
    return "Skladem";
  }

  function startEditMaterial(row: PortfolioTechnologyMaterial) {
    setIsMaterialEditMode(true);
    setEditingMaterialId(row.id);
    const t = row.input_type === "product_stock" ? "product_stock" : "material";
    setTpInputType(t);
    setMaterialLibraryId(row.material_library_item_id ?? null);
    setPortfolioInputItemId(row.portfolio_item_id ?? null);
    setConsumptionPerPiece(row.consumption_per_piece == null ? "" : String(row.consumption_per_piece));
    setConsumptionUnit(row.consumption_unit ?? "");
    setScrapAllowance(row.scrap_allowance == null ? "" : String(row.scrap_allowance));
    setNaUpnutiMm(row.na_upnuti_mm == null ? "" : String(row.na_upnuti_mm));
    setVyrabetMaxPoKs(row.vyrabet_max_po_ks == null ? "" : String(row.vyrabet_max_po_ks));
    setPovolitDeleniPolotovaru(row.povolit_deleni_polotovaru !== false);
    setMaterialNote(row.note ?? "");
    setShowAddMaterialForm(true);
  }

  async function saveMaterial() {
    if (!templateId) return;
    const payload = {
      input_type: tpInputType,
      material_library_item_id: tpInputType === "material" ? materialLibraryId : null,
      portfolio_item_id: tpInputType === "product_stock" ? portfolioInputItemId : null,
      consumption_per_piece: toNumberOrNull(consumptionPerPiece),
      consumption_unit: consumptionUnit.trim() || null,
      scrap_allowance: tpInputType === "material" ? toNumberOrNull(scrapAllowance) : null,
      na_upnuti_mm: toNumberOrNull(naUpnutiMm),
      vyrabet_max_po_ks: toIntOrNull(vyrabetMaxPoKs),
      povolit_deleni_polotovaru: povolitDeleniPolotovaru,
      note: materialNote.trim() || null,
    };
    if (tpInputType === "material" && materialLibraryId == null) {
      setMaterialsError("Vyberte materiál z knihovny.");
      return;
    }
    if (tpInputType === "product_stock" && portfolioInputItemId == null) {
      setMaterialsError("Vyberte portfolio položku.");
      return;
    }
    try {
      if (isMaterialEditMode && editingMaterialId != null) {
        await updatePortfolioTechnologyMaterial(editingMaterialId, payload);
      } else {
        await createPortfolioTechnologyMaterial(templateId, payload);
      }
      setMaterialsError(null);
      await loadTechnologyMaterials();
      resetMaterialForm();
    } catch (e: unknown) {
      setMaterialsError(e instanceof Error ? e.message : "Nepodarilo se ulozit material.");
    }
  }

  async function deleteMaterial(id: number) {
    try {
      await deletePortfolioTechnologyMaterial(id);
      await loadTechnologyMaterials();
      if (editingMaterialId === id) resetMaterialForm();
    } catch (e: unknown) {
      setMaterialsError(e instanceof Error ? e.message : "Nepodarilo se smazat material.");
    }
  }

  return (
    <PageContainer className="erp-overview-page" style={{ paddingTop: 10 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14, width: "100%", minWidth: 0 }}>
        {!detail ? (
          <>
            <div
              style={{
                ...UI.card,
                borderRadius: 14,
                padding: 20,
                border: "1px solid #e2e8f0",
                background: "#f8fafc",
                color: "#64748b",
                fontWeight: 700,
              }}
            >
              Portfolio položka nebyla nalezena nebo nebyla načtena z backendu.
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", flexWrap: "wrap", gap: 8 }}>
              <button
                type="button"
                style={UI.buttons.secondary}
                onClick={() => window.open(buildErpUrl({ view: "portfolio", portfolioItemId: item.id }), "_blank")}
              >
                Otevřít v novém okně
              </button>
              <button type="button" style={UI.buttons.secondary} onClick={onBack}>
                {backLabel ?? "Zpět na portfolio"}
              </button>
            </div>
          </>
        ) : null}
        {!detail ? null : (
          <>

        <DetailPageHeader
          title={
            <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 28,
                  fontWeight: 1000,
                  color: UI.colors.primary,
                  letterSpacing: 0.3,
                  lineHeight: 1.05,
                }}
              >
                {detail.gpn}
              </div>
              <div style={{ fontSize: 15, fontWeight: 700, color: UI.colors.textPrimary }}>
                {detail.name}
              </div>
            </div>
          }
          headerAside={
            <span
              className="erp-status-badge"
              style={{
                ...UI.statusBadgeBase,
                ...(detail.active_template_id ? UI.statusBadgeOk : UI.statusBadgeProblem),
              }}
            >
              {detail.active_template_id ? "Technologie připravena" : "Bez technologie"}
            </span>
          }
          actions={
            <>
              <button
                type="button"
                style={UI.buttons.secondary}
                onClick={() => window.open(buildErpUrl({ view: "portfolio", portfolioItemId: item.id }), "_blank")}
              >
                Otevřít v novém okně
              </button>
              <button type="button" style={UI.buttons.secondary} onClick={onBack}>
                {backLabel ?? "Zpět na portfolio"}
              </button>
            </>
          }
          context={
            <div style={erpDetailStateCard}>
              <div style={erpDetailSectionEyebrow}>Kontext</div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
                  gap: 14,
                }}
              >
                <div>
                  <div style={erpDetailRowLabel}>Zákazník</div>
                  <div style={erpDetailRowValue}>
                    {detail.customer_name?.trim() ? detail.customer_name : "—"}
                  </div>
                </div>
                <div>
                  <div style={erpDetailRowLabel}>Skupina</div>
                  <div style={erpDetailRowValue}>
                    {detail.group_name?.trim() ? detail.group_name : "—"}
                  </div>
                </div>
                <div>
                  <div style={erpDetailRowLabel}>Logistický režim</div>
                  <div style={erpDetailRowValue}>
                    {logisticLabel(detail.logistic_mode ?? "vyroba_zakaznik")}
                  </div>
                </div>
                <div>
                  <div style={erpDetailRowLabel}>Scan kód</div>
                  <div style={erpDetailRowValue}>
                    {detail.scan_code?.trim() ? detail.scan_code : "—"}
                  </div>
                </div>
              </div>
            </div>
          }
          summaryTiles={
            <div
              style={{
                padding: "12px 14px",
                borderRadius: 12,
                background: UI.colors.card,
                border: `1px solid ${UI.colors.border}`,
              }}
            >
              <div style={{ ...erpDetailSectionEyebrow, color: UI.colors.neutralFg, marginBottom: 8 }}>
                Identita dílu
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
                  gap: 14,
                }}
              >
                <div>
                  <div style={erpDetailIdentLabel}>GPN</div>
                  <div style={erpDetailIdentValue}>{detail.gpn}</div>
                </div>
                <div>
                  <div style={erpDetailIdentLabel}>Výkres</div>
                  <div style={erpDetailIdentValue}>
                    {detail.drawing_no?.trim() ? detail.drawing_no : "—"}
                  </div>
                </div>
                <div>
                  <div style={erpDetailIdentLabel}>Revize</div>
                  <div style={erpDetailIdentValue}>
                    {detail.revision?.trim() ? detail.revision : "—"}
                  </div>
                </div>
                <div>
                  <div style={erpDetailIdentLabel}>Název</div>
                  <div style={erpDetailIdentValue}>{detail.name?.trim() ? detail.name : "—"}</div>
                </div>
                <div>
                  <div style={erpDetailIdentLabel}>Materiál</div>
                  <div style={erpDetailIdentValue}>
                    {detail.material_default?.trim() ? detail.material_default : "—"}
                  </div>
                </div>
                <div>
                  <div style={erpDetailIdentLabel}>Cena</div>
                  <div
                    style={{
                      ...erpDetailIdentValue,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {formatSalePriceCzk(detail.sale_price_per_piece)}
                  </div>
                </div>
                <div>
                  <div style={erpDetailIdentLabel}>Technologie</div>
                  <div style={{ marginTop: 2 }}>
                    <span
                      className="erp-status-badge"
                      style={{
                        ...UI.statusBadgeBase,
                        ...(detail.active_template_id ? UI.statusBadgeOk : UI.statusBadgeProblem),
                      }}
                    >
                      {detail.active_template_id ? "ANO" : "NE"}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          }
        />

        <div style={{ width: "100%", overflowX: "auto", overflowY: "hidden", marginBottom: 4 }}>
          <div
            style={{
              ...UI.subTabsContainer,
              overflow: "visible",
              width: "max-content",
              minWidth: "100%",
              justifyContent: "flex-start",
              marginTop: 0,
              marginBottom: 0,
            }}
          >
            {SUBTABS.map((tab) => {
              const active = tab === activeTab;
              return (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveTab(tab)}
                  onMouseEnter={() => setHoverTab(tab)}
                  onMouseLeave={() => setHoverTab((h) => (h === tab ? null : h))}
                  style={{ ...UI.subTab, ...(active ? UI.subTabActive : {}), ...(!active && hoverTab === tab ? UI.subTabHover : {}) }}
                >
                  {tab}
                </button>
              );
            })}
          </div>
        </div>

        {activeTab === "Přehled" ? (
          <div style={{ ...UI.card, borderRadius: 14, padding: 16, width: "100%", boxSizing: "border-box" }}>
            <div style={{ ...UI.sectionTitle, fontSize: 16, marginBottom: 12 }}>Souhrn portfolio položky</div>
            <div style={{ display: "grid", gap: 8 }}>
              <div><strong>GPN:</strong> {detail.gpn}</div>
              <div>
                <strong>Scan kód:</strong> {detail.scan_code?.trim() ? detail.scan_code : "—"}
              </div>
              <div><strong>Název:</strong> {detail.name}</div>
              <div>
                <strong>Zákazník:</strong> {detail.customer_name?.trim() ? detail.customer_name : "—"}
              </div>
              <div>
                <strong>Skupina:</strong> {detail.group_name?.trim() ? detail.group_name : "—"}
              </div>
              <div><strong>Technologie:</strong> {detail.active_template_id ? "ANO" : "NE"}</div>
              <div>
                <strong>Prodejní cena / ks (bez DPH):</strong> {formatSalePriceCzk(detail.sale_price_per_piece)}
              </div>
            </div>
          </div>
        ) : activeTab === "Technologický postup" ? (
          <>
          <div style={{ ...UI.card, borderRadius: 14, padding: 16, width: "100%", boxSizing: "border-box" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 10 }}>
              <div style={{ ...UI.sectionTitle, fontSize: 16, marginBottom: 0 }}>Technologický postup</div>
              <button
                type="button"
                style={{ ...UI.buttons.primary, ...(templateId ? {} : { opacity: 0.6, cursor: "not-allowed" }) }}
                onClick={() => {
                  if (!templateId) return;
                  setShowAddOperationForm((v) => !v);
                }}
              >
                Přidat operaci
              </button>
            </div>
            {techLoading ? <div style={UI.sectionSubtitle}>Načítám technologický postup...</div> : null}
            {techError ? <div style={{ color: "#b91c1c", fontWeight: 700, marginBottom: 8 }}>{techError}</div> : null}

            {showAddOperationForm ? (
              <div style={{ ...UI.card, padding: 16, marginBottom: 12, display: "grid", gap: 18 }}>
                {librariesLoading ? (
                  <div style={{ ...UI.sectionSubtitle, marginBottom: 10 }}>Načítám knihovny…</div>
                ) : null}
                {libraryError ? (
                  <div style={{ color: "#b91c1c", fontWeight: 700, marginBottom: 10 }}>{libraryError}</div>
                ) : null}
                <FormSection title="Základní údaje">
                  <FormGrid minColumnWidth={190} gap={18}>
                  <FormField label="Operace">
                    <select
                      value={operationSelectValue}
                      onChange={(e) => onOperationSelectChange(e.target.value)}
                      style={formControlStyle}
                      disabled={librariesLoading}
                    >
                      <option value="">Vyberte operaci</option>
                      {legacyOperationLabel ? (
                        <option value="__legacy_op__">{legacyOperationLabel} (uloženo)</option>
                      ) : null}
                      {activeOperationLibrary.map((o) => (
                        <option key={o.id} value={String(o.id)}>
                          {o.name}
                        </option>
                      ))}
                    </select>
                  </FormField>
                  <FormField label={`Pracoviště${isCooperation ? " (volitelné)" : ""}`}>
                    <select
                      value={workplaceSelectValue}
                      onChange={(e) => onWorkplaceSelectChange(e.target.value)}
                      style={formControlStyle}
                      disabled={librariesLoading}
                    >
                      <option value="">Vyberte pracoviště</option>
                      {legacyWorkplaceLabel ? (
                        <option value="__legacy_wp__">{legacyWorkplaceLabel} (uloženo)</option>
                      ) : null}
                      {activeWorkplaceLibrary.map((w) => (
                        <option key={w.id} value={String(w.id)}>
                          {w.name}
                        </option>
                      ))}
                    </select>
                  </FormField>
                  <FormField label="Setup">
                    <input value={setupMin} onChange={(e) => setSetupMin(e.target.value)} style={formControlStyle} />
                  </FormField>
                  <FormField label="Čas / ks">
                    <input value={runMinPerPiece} onChange={(e) => setRunMinPerPiece(e.target.value)} style={formControlStyle} />
                  </FormField>
                  <FormField label="Kontrola">
                    <input
                      aria-label="Kontrola"
                      type="checkbox"
                      checked={controlRequired}
                      onChange={(e) => setControlRequired(e.target.checked)}
                      style={{ width: 18, height: 18, marginTop: 9 }}
                    />
                  </FormField>
                  <FormField label="Kooperace / externí operace">
                    <input
                      aria-label="Kooperace / externí operace"
                      type="checkbox"
                      checked={isCooperation}
                      onChange={(e) => {
                        setIsCooperation(e.target.checked);
                        setOutsourcing(e.target.checked);
                      }}
                      style={{ width: 18, height: 18, marginTop: 9 }}
                    />
                  </FormField>
                  </FormGrid>
                </FormSection>
                  {isCooperation ? (
                  <HighlightBox title="Kooperace">
                    <FormGrid minColumnWidth={220} gap={18}>
                      <FormField label="Typ kooperace">
                        <input
                          value={cooperationCategory}
                          onChange={(e) => setCooperationCategory(e.target.value)}
                          style={formControlStyle}
                          placeholder="např. kalení, povrchová úprava"
                        />
                      </FormField>
                      <FormField label="Preferovaný dodavatel">
                        <select
                          value={preferredSupplierId == null ? "" : String(preferredSupplierId)}
                          onChange={(e) => setPreferredSupplierId(e.target.value ? Number(e.target.value) : null)}
                          style={formControlStyle}
                          disabled={librariesLoading}
                        >
                          <option value="">Bez preferovaného dodavatele</option>
                          {activeSuppliers.map((s) => (
                            <option key={s.id} value={String(s.id)}>
                              {s.name}
                            </option>
                          ))}
                        </select>
                      </FormField>
                      <FormField label="Poznámka ke kooperaci" fullWidth>
                        <textarea
                          value={cooperationNote}
                          onChange={(e) => setCooperationNote(e.target.value)}
                          style={formTextareaStyle}
                          placeholder="Instrukce pro externí operaci"
                        />
                      </FormField>
                    </FormGrid>
                  </HighlightBox>
                  ) : null}
                <FormSection title="Poznámky">
                  <FormField label="Poznámka operace" fullWidth>
                    <textarea value={note} onChange={(e) => setNote(e.target.value)} style={formTextareaStyle} />
                  </FormField>
                </FormSection>
                <div style={{ display: "flex", gap: 8, justifyContent: "flex-start" }}>
                  <button type="button" style={UI.buttons.primary} onClick={saveOperation}>
                    {isEditMode ? "Uložit změny" : "Uložit operaci"}
                  </button>
                  <button type="button" style={UI.buttons.secondary} onClick={resetForm}>
                    Zrušit
                  </button>
                </div>
              </div>
            ) : null}

            {!templateId ? (
              <>
                <div style={UI.sectionSubtitle}>Zatím není definován žádný technologický postup.</div>
                <div style={{ marginTop: 12 }}>
                  <button
                    type="button"
                    style={{ ...UI.buttons.primary, ...(creatingTemplate ? { opacity: 0.7, cursor: "wait" } : {}) }}
                    onClick={handleCreateTechnologyTemplate}
                    disabled={creatingTemplate}
                  >
                    {creatingTemplate ? "Vytvářím..." : "Přidat technologický postup"}
                  </button>
                </div>
              </>
            ) : operations.length === 0 ? (
              <div style={UI.sectionSubtitle}>Zatím nejsou definovány žádné operace.</div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={UI.table}>
                  <thead>
                    <tr style={{ background: "#f8fafc" }}>
                      {[
                        "Pořadí",
                        "Operace",
                        "Pracoviště",
                        "Setup (min)",
                        "Čas / ks (min)",
                        "Kontrola",
                        "Kooperace",
                        "Poznámka",
                        "Akce",
                      ].map((h) => (
                        <th key={h} style={{ ...UI.th, fontSize: 13, padding: "10px 10px", whiteSpace: "nowrap" }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {operations.map((op, index) => {
                      const opIsCooperation = !!op.is_cooperation || !!op.outsourcing;
                      return (
                      <tr key={op.id} style={opIsCooperation ? { background: "#FFF7ED" } : undefined}>
                        <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap", fontWeight: 800 }}>{op.operation_no}</td>
                        <td style={{ ...UI.td, padding: "10px 10px" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                            <span>{op.operation_name}</span>
                            {opIsCooperation ? (
                              <span
                                style={{
                                  ...UI.statusBadgeBase,
                                  color: "#9A3412",
                                  background: "#FFEDD5",
                                  borderColor: "#FDBA74",
                                  boxShadow: "none",
                                }}
                              >
                                Kooperace
                              </span>
                            ) : null}
                          </div>
                          {opIsCooperation && op.cooperation_category ? (
                            <div style={{ marginTop: 4, fontSize: 12, fontWeight: 700, color: "#9A3412" }}>
                              {op.cooperation_category}
                            </div>
                          ) : null}
                        </td>
                        <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>{op.machine_code || "—"}</td>
                        <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>{op.setup_time_min}</td>
                        <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>{op.labor_time_per_piece_min}</td>
                        <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>{op.control_required ? "ANO" : "NE"}</td>
                        <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>{opIsCooperation ? "ANO" : "NE"}</td>
                        <td style={{ ...UI.td, padding: "10px 10px" }}>{op.note || "—"}</td>
                        <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap", display: "flex", gap: 6, flexWrap: "wrap" }}>
                          <button
                            type="button"
                            style={{
                              ...UI.buttons.secondary,
                              ...(index === 0 || reorderBusy ? { opacity: 0.5, cursor: "not-allowed" } : {}),
                            }}
                            disabled={index === 0 || reorderBusy}
                            onClick={() => moveOperation(index, index - 1)}
                          >
                            Nahoru
                          </button>
                          <button
                            type="button"
                            style={{
                              ...UI.buttons.secondary,
                              ...(index === operations.length - 1 || reorderBusy ? { opacity: 0.5, cursor: "not-allowed" } : {}),
                            }}
                            disabled={index === operations.length - 1 || reorderBusy}
                            onClick={() => moveOperation(index, index + 1)}
                          >
                            Dolů
                          </button>
                          <button
                            type="button"
                            style={UI.buttons.secondary}
                            onClick={() => startEdit(op)}
                          >
                            Upravit
                          </button>
                          <button
                            type="button"
                            style={UI.buttons.secondary}
                            onClick={() => deleteOperation(op.id)}
                          >
                            Smazat
                          </button>
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <div
            style={{
              ...UI.card,
              borderRadius: 14,
              padding: 16,
              marginTop: 12,
              width: "100%",
              boxSizing: "border-box",
            }}
          >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 10 }}>
              <div style={{ ...UI.sectionTitle, fontSize: 16, marginBottom: 0 }}>Vstupy pro technologický postup</div>
              {!showAddMaterialForm ? (
                <button
                  type="button"
                  style={{ ...UI.buttons.primary, ...(templateId ? {} : { opacity: 0.6, cursor: "not-allowed" }) }}
                  onClick={() => {
                    if (!templateId) return;
                    setShowAddMaterialForm(true);
                  }}
                >
                  Přidat vstup
                </button>
              ) : null}
            </div>

            {materialsLoading ? <div style={UI.sectionSubtitle}>Načítám materiály...</div> : null}
            {materialsError ? <div style={{ color: "#b91c1c", fontWeight: 700, marginBottom: 8 }}>{materialsError}</div> : null}

            {showAddMaterialForm ? (
              <div
                style={{
                  border: "1px solid #e2e8f0",
                  background: "#f8fafc",
                  borderRadius: 12,
                  padding: 24,
                  marginBottom: 14,
                }}
              >
                {materialLibraryLoading ? <div style={{ ...UI.sectionSubtitle, marginBottom: 10 }}>Načítám knihovnu materiálů…</div> : null}
                {materialLibraryError ? (
                  <div style={{ color: "#b91c1c", fontWeight: 700, marginBottom: 10 }}>{materialLibraryError}</div>
                ) : null}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", rowGap: 16, columnGap: 12 }}>
                  <div style={{ gridColumn: "1 / -1" }}>
                    <div style={{ fontSize: 12, color: "#64748b", marginBottom: 4 }}>Typ vstupu</div>
                    <select
                      value={tpInputType}
                      onChange={(e) => setTpInputType(e.target.value as "material" | "product_stock")}
                      style={{ ...UI.inputs.base, width: "100%", minHeight: 42 }}
                    >
                      <option value="material">Materiál</option>
                      <option value="product_stock">Výrobek ze skladu</option>
                    </select>
                  </div>

                  {tpInputType === "material" ? (
                    <div style={{ gridColumn: "1 / -1" }}>
                      <div style={{ fontSize: 12, color: "#64748b", marginBottom: 4 }}>Materiál</div>
                      <select
                        value={materialLibraryId == null ? "" : String(materialLibraryId)}
                        onChange={(e) => setMaterialLibraryId(e.target.value ? Number(e.target.value) : null)}
                        style={{ ...UI.inputs.base, width: "100%", minHeight: 42 }}
                        disabled={materialLibraryLoading}
                      >
                        <option value="">Vyberte materiál</option>
                        {activeMaterialLibrary.map((m) => (
                          <option key={m.id} value={String(m.id)}>
                            {formatMaterialOptionLabel(m)}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : (
                    <div style={{ gridColumn: "1 / -1" }}>
                      <div style={{ fontSize: 12, color: "#64748b", marginBottom: 4 }}>Portfolio položka</div>
                      <select
                        value={portfolioInputItemId == null ? "" : String(portfolioInputItemId)}
                        onChange={(e) => setPortfolioInputItemId(e.target.value ? Number(e.target.value) : null)}
                        style={{ ...UI.inputs.base, width: "100%", minHeight: 42 }}
                      >
                        <option value="">Vyberte položku</option>
                        {portfolioInputs.map((p) => (
                          <option key={p.id} value={String(p.id)}>
                            {p.gpn} — {p.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  <div>
                    <div style={{ fontSize: 12, color: "#64748b", marginBottom: 4 }}>Spotřeba / ks</div>
                    <input value={consumptionPerPiece} onChange={(e) => setConsumptionPerPiece(e.target.value)} style={UI.inputs.base} />
                  </div>
                  <div>
                    <div style={{ fontSize: 12, color: "#64748b", marginBottom: 4 }}>Jednotka spotřeby</div>
                    <input value={consumptionUnit} onChange={(e) => setConsumptionUnit(e.target.value)} style={UI.inputs.base} />
                  </div>
                  {tpInputType === "material" ? (
                    <div>
                      <div style={{ fontSize: 12, color: "#64748b", marginBottom: 4 }}>Prořez / odpad</div>
                      <input value={scrapAllowance} onChange={(e) => setScrapAllowance(e.target.value)} style={UI.inputs.base} />
                    </div>
                  ) : null}

                  <div>
                    <div style={{ fontSize: 12, color: "#64748b", marginBottom: 4 }}>Na upnutí (mm)</div>
                    <input value={naUpnutiMm} onChange={(e) => setNaUpnutiMm(e.target.value)} style={UI.inputs.base} />
                  </div>
                  <div>
                    <div style={{ fontSize: 12, color: "#64748b", marginBottom: 4 }}>Vyrábět max po (ks)</div>
                    <input value={vyrabetMaxPoKs} onChange={(e) => setVyrabetMaxPoKs(e.target.value)} style={UI.inputs.base} />
                  </div>
                  <div style={{ gridColumn: "1 / -1", display: "flex", alignItems: "center", gap: 10, paddingTop: 4 }}>
                    <input
                      type="checkbox"
                      id="akeng-tp-povolit-deleni"
                      checked={povolitDeleniPolotovaru}
                      onChange={(e) => setPovolitDeleniPolotovaru(e.target.checked)}
                      style={{ width: 18, height: 18, cursor: "pointer" }}
                    />
                    <label htmlFor="akeng-tp-povolit-deleni" style={{ fontSize: 14, fontWeight: 600, color: "#334155", cursor: "pointer" }}>
                      Povolit dělení polotovaru
                    </label>
                  </div>

                  <div style={{ gridColumn: "1 / -1" }}>
                    <div style={{ fontSize: 12, color: "#64748b", marginBottom: 4 }}>Poznámka</div>
                    <input value={materialNote} onChange={(e) => setMaterialNote(e.target.value)} style={UI.inputs.base} />
                  </div>

                  <div style={{ gridColumn: "1 / -1", display: "flex", gap: 8, justifyContent: "flex-end" }}>
                    <button type="button" style={{ ...UI.buttons.secondary, minHeight: 40 }} onClick={resetMaterialForm}>
                      Zrušit
                    </button>
                    <button type="button" style={{ ...UI.buttons.primary, minHeight: 40 }} onClick={saveMaterial}>
                      {isMaterialEditMode ? "Uložit změny" : "Uložit vstup"}
                    </button>
                  </div>
                </div>
              </div>
            ) : null}

            {!templateId ? (
              <div style={UI.sectionSubtitle}>Nejprve vytvořte technologický postup.</div>
            ) : materials.length === 0 && !showAddMaterialForm ? (
              <div
                style={{
                  border: "1px solid #e2e8f0",
                  borderRadius: 12,
                  background: "#f8fafc",
                  padding: 16,
                  display: "flex",
                  flexDirection: "column",
                  gap: 12,
                  alignItems: "flex-start",
                }}
              >
                <div style={UI.sectionSubtitle}>Zatím nejsou definovány žádné vstupy.</div>
                <button
                  type="button"
                  style={UI.buttons.primary}
                  onClick={() => setShowAddMaterialForm(true)}
                >
                  Přidat první vstup
                </button>
              </div>
            ) : (
              <div style={{ overflowX: "auto", marginTop: 24 }}>
                <table style={UI.table}>
                  <thead>
                    <tr style={{ background: "#f8fafc" }}>
                      {[
                        "Typ vstupu",
                        "Položka",
                        "Kód / GPN",
                        "Spotřeba / ks",
                        "Jednotka",
                        "Prořez / odpad",
                        "Na upnutí (mm)",
                        "Vyrábět max po (ks)",
                        "Dělení polotovaru",
                        "Lokace",
                        "Skladem",
                        "Stav skladu",
                        "Akce",
                      ].map((h) => (
                        <th key={h} style={{ ...UI.th, fontSize: 13, padding: "10px 10px", whiteSpace: "nowrap" }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {materials.map((row) => (
                      <tr key={row.id}>
                        <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap", fontWeight: 800 }}>
                          {row.input_type === "product_stock" ? "Výrobek ze skladu" : "Materiál"}
                        </td>
                        <td style={{ ...UI.td, padding: "10px 10px" }}>
                          {row.input_type === "product_stock" ? (row.portfolio_item_name || "—") : row.material_name}
                        </td>
                        <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>
                          {row.input_type === "product_stock" ? (row.portfolio_item_gpn || "—") : (row.material_code || "—")}
                        </td>
                        <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>{row.consumption_per_piece ?? "—"}</td>
                        <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>{row.consumption_unit || "—"}</td>
                        <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>{row.scrap_allowance ?? "—"}</td>
                        <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>{row.na_upnuti_mm ?? "—"}</td>
                        <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>{row.vyrabet_max_po_ks ?? "—"}</td>
                        <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>
                          {row.povolit_deleni_polotovaru === false ? "Ne" : "Ano"}
                        </td>
                        <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>{row.stock_location || "—"}</td>
                        <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>{row.stock_current_qty ?? "—"}</td>
                        <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>{stockStatusLabel(row.stock_status)}</td>
                        <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap", display: "flex", gap: 6, flexWrap: "wrap" }}>
                          <button type="button" style={UI.buttons.secondary} onClick={() => startEditMaterial(row)}>
                            Upravit
                          </button>
                          <button type="button" style={UI.buttons.secondary} onClick={() => deleteMaterial(row.id)}>
                            Smazat
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          </>
        ) : activeTab === "Dokumenty" ? (
          <div style={{ ...UI.card, borderRadius: 14, padding: 16, width: "100%", boxSizing: "border-box" }}>
            <div style={{ ...UI.sectionTitle, fontSize: 16, marginBottom: 0 }}>
              Modul Dokumenty pro tuto portfolio položku je ve vývoji.
            </div>
          </div>
        ) : (
          <div style={{ ...UI.card, borderRadius: 14, padding: 16, width: "100%", boxSizing: "border-box" }}>
            <div style={{ ...UI.sectionTitle, fontSize: 16, marginBottom: 0 }}>
              Modul Historie pro tuto portfolio položku je ve vývoji.
            </div>
          </div>
        )}
          </>
        )}
      </div>
    </PageContainer>
  );
}

