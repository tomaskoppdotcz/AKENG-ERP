import React, { useEffect, useMemo, useState } from "react";
import { UI } from "../styles/ui";
import { getMaterialLibraryItems, type MaterialLibraryItem } from "../services/materialLibraryApi";
import {
  createPortfolioTechnologyMaterial,
  createPortfolioTechnologyTemplate,
  createPortfolioTechnologyOperation,
  deletePortfolioTechnologyMaterial,
  deletePortfolioTechnologyOperation,
  getPortfolioTechnologyMaterials,
  getOperationLibraryItems,
  getPortfolioItemTechnology,
  getWorkplaceLibraryItems,
  reorderPortfolioTechnologyOperations,
  updatePortfolioTechnologyMaterial,
  updatePortfolioTechnologyOperation,
  type OperationLibraryItem,
  type PortfolioItem,
  type PortfolioTechnologyMaterial,
  type PortfolioTechnologyOperation,
  type WorkplaceLibraryItem,
} from "../services/portfolioApi";

type Props = {
  item?: PortfolioItem | null;
  onBack: () => void;
  /** Volitelný text tlačítka zpět (např. návrat z detailu zakázky). */
  backLabel?: string;
};

type PortfolioDetailSubtab = "Přehled" | "Technologický postup" | "Dokumenty" | "Historie";

const SUBTABS: PortfolioDetailSubtab[] = ["Přehled", "Technologický postup", "Dokumenty", "Historie"];

const FALLBACK = {
  id: 0,
  gpn: "—",
  name: "Neznámá portfolio položka",
  customer_id: 0,
  group_id: null as number | null,
  active_template_id: null as number | null,
  drawing_no: "DRW-PORT-001",
  revision: "A",
  material: "Ocel 11 353.1",
  logistic_mode: "vyroba_zakaznik",
};

function logisticLabel(mode: string) {
  if (mode === "sklad") return "Sklad";
  if (mode === "sklad_zakaznik") return "Sklad zákazník";
  return "Výroba zákazník";
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
  const [note, setNote] = useState("");
  const [templateId, setTemplateId] = useState<number | null>(item?.active_template_id ?? null);
  const [operations, setOperations] = useState<PortfolioTechnologyOperation[]>([]);
  const [techLoading, setTechLoading] = useState(false);
  const [techError, setTechError] = useState<string | null>(null);
  const [creatingTemplate, setCreatingTemplate] = useState(false);
  const [reorderBusy, setReorderBusy] = useState(false);
  const [operationLibraryItems, setOperationLibraryItems] = useState<OperationLibraryItem[]>([]);
  const [workplaceLibraryItems, setWorkplaceLibraryItems] = useState<WorkplaceLibraryItem[]>([]);
  const [librariesLoading, setLibrariesLoading] = useState(false);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [materials, setMaterials] = useState<PortfolioTechnologyMaterial[]>([]);
  const [materialsLoading, setMaterialsLoading] = useState(false);
  const [materialsError, setMaterialsError] = useState<string | null>(null);
  const [showAddMaterialForm, setShowAddMaterialForm] = useState(false);
  const [isMaterialEditMode, setIsMaterialEditMode] = useState(false);
  const [editingMaterialId, setEditingMaterialId] = useState<number | null>(null);
  const [materialLibraryItems, setMaterialLibraryItems] = useState<MaterialLibraryItem[]>([]);
  const [materialLibraryLoading, setMaterialLibraryLoading] = useState(false);
  const [materialLibraryError, setMaterialLibraryError] = useState<string | null>(null);
  const [materialLibraryId, setMaterialLibraryId] = useState<number | null>(null);
  const [consumptionPerPiece, setConsumptionPerPiece] = useState("");
  const [consumptionUnit, setConsumptionUnit] = useState("");
  const [scrapAllowance, setScrapAllowance] = useState("");
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
    () => ({
      id: item?.id ?? FALLBACK.id,
      gpn: item?.gpn ?? FALLBACK.gpn,
      name: item?.name ?? FALLBACK.name,
      customer_id: item?.customer_id ?? FALLBACK.customer_id,
      group_id: item?.group_id ?? FALLBACK.group_id,
      active_template_id: item?.active_template_id ?? FALLBACK.active_template_id,
      drawing_no: FALLBACK.drawing_no,
      revision: FALLBACK.revision,
      material: FALLBACK.material,
      logistic_mode: FALLBACK.logistic_mode,
    }),
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
    if (!showAddOperationForm) return;
    let cancelled = false;
    setLibrariesLoading(true);
    setLibraryError(null);
    Promise.all([getOperationLibraryItems(), getWorkplaceLibraryItems()])
      .then(([ops, wps]) => {
        if (!cancelled) {
          setOperationLibraryItems(ops);
          setWorkplaceLibraryItems(wps);
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
    setNote("");
    setShowAddOperationForm(false);
  }

  function resetMaterialForm() {
    setIsMaterialEditMode(false);
    setEditingMaterialId(null);
    setMaterialLibraryId(null);
    setConsumptionPerPiece("");
    setConsumptionUnit("");
    setScrapAllowance("");
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
      outsourcing,
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
    setMaterialLibraryId(row.material_library_item_id);
    setConsumptionPerPiece(row.consumption_per_piece == null ? "" : String(row.consumption_per_piece));
    setConsumptionUnit(row.consumption_unit ?? "");
    setScrapAllowance(row.scrap_allowance == null ? "" : String(row.scrap_allowance));
    setMaterialNote(row.note ?? "");
    setShowAddMaterialForm(true);
  }

  async function saveMaterial() {
    if (!templateId) return;
    if (materialLibraryId == null) {
      setMaterialsError("Vyberte materiál z knihovny.");
      return;
    }
    const payload = {
      material_library_item_id: materialLibraryId,
      consumption_per_piece: toNumberOrNull(consumptionPerPiece),
      consumption_unit: consumptionUnit.trim() || null,
      scrap_allowance: toNumberOrNull(scrapAllowance),
      note: materialNote.trim() || null,
    };
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
    <div style={UI.container}>
      <div style={{ paddingTop: 10, display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button type="button" style={UI.buttons.secondary} onClick={onBack}>
            {backLabel ?? "Zpět na portfolio"}
          </button>
        </div>

        <div style={UI.pageHeaderRow}>
          <div>
            <h1 style={{ margin: 0, fontSize: 30, fontWeight: 900, color: "#0f172a", lineHeight: 1.2 }}>{detail.gpn}</h1>
            <p style={{ ...UI.headerSubtitle, marginTop: 8, marginBottom: 0 }}>{detail.name}</p>
          </div>
          <div style={{ ...UI.summaryTilesGrid, width: "auto", gap: 8 }}>
            <div style={{ ...UI.summaryTile, minHeight: 88, minWidth: 180 }}>
              <div style={UI.summaryTileLabel}>Zákazník</div>
              <div style={UI.summaryTileValue}>{detail.customer_id || "—"}</div>
            </div>
            <div style={{ ...UI.summaryTile, minHeight: 88, minWidth: 180 }}>
              <div style={UI.summaryTileLabel}>Skupina</div>
              <div style={UI.summaryTileValue}>{detail.group_id ?? "—"}</div>
            </div>
            <div style={{ ...UI.summaryTile, minHeight: 88, minWidth: 180 }}>
              <div style={UI.summaryTileLabel}>Technologie</div>
              <div style={{ ...UI.summaryTileValue, color: detail.active_template_id ? "#15803d" : "#dc2626" }}>
                {detail.active_template_id ? "ANO" : "NE"}
              </div>
            </div>
          </div>
        </div>

        <div style={UI.summaryTilesGrid}>
          <div style={{ ...UI.summaryTile, flex: "1 1 220px", minWidth: 180 }}>
            <div style={UI.summaryTileLabel}>Výkres</div>
            <div style={UI.summaryTileValue}>{detail.drawing_no}</div>
          </div>
          <div style={{ ...UI.summaryTile, flex: "1 1 220px", minWidth: 180 }}>
            <div style={UI.summaryTileLabel}>Revize</div>
            <div style={UI.summaryTileValue}>{detail.revision}</div>
          </div>
          <div style={{ ...UI.summaryTile, flex: "1 1 220px", minWidth: 180 }}>
            <div style={UI.summaryTileLabel}>Materiál</div>
            <div style={UI.summaryTileValue}>{detail.material}</div>
          </div>
          <div style={{ ...UI.summaryTile, flex: "1 1 220px", minWidth: 180 }}>
            <div style={UI.summaryTileLabel}>Logistický režim</div>
            <div style={UI.summaryTileValue}>{logisticLabel(detail.logistic_mode)}</div>
          </div>
        </div>

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
          <div style={{ ...UI.card, borderRadius: 14, padding: 16 }}>
            <div style={{ ...UI.sectionTitle, fontSize: 16, marginBottom: 12 }}>Souhrn portfolio položky</div>
            <div style={{ display: "grid", gap: 8 }}>
              <div><strong>GPN:</strong> {detail.gpn}</div>
              <div><strong>Název:</strong> {detail.name}</div>
              <div><strong>Zákazník:</strong> {detail.customer_id || "—"}</div>
              <div><strong>Skupina:</strong> {detail.group_id ?? "—"}</div>
              <div><strong>Technologie:</strong> {detail.active_template_id ? "ANO" : "NE"}</div>
            </div>
          </div>
        ) : activeTab === "Technologický postup" ? (
          <>
          <div style={{ ...UI.card, borderRadius: 14, padding: 16 }}>
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
              <div style={{ ...UI.card, padding: 12, marginBottom: 12 }}>
                {librariesLoading ? (
                  <div style={{ ...UI.sectionSubtitle, marginBottom: 10 }}>Načítám knihovny…</div>
                ) : null}
                {libraryError ? (
                  <div style={{ color: "#b91c1c", fontWeight: 700, marginBottom: 10 }}>{libraryError}</div>
                ) : null}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
                  <div>
                    <div style={UI.inputs.label}>Operace</div>
                    <select
                      value={operationSelectValue}
                      onChange={(e) => onOperationSelectChange(e.target.value)}
                      style={UI.inputs.base}
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
                  </div>
                  <div>
                    <div style={UI.inputs.label}>Pracoviště</div>
                    <select
                      value={workplaceSelectValue}
                      onChange={(e) => onWorkplaceSelectChange(e.target.value)}
                      style={UI.inputs.base}
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
                  </div>
                  <div>
                    <div style={UI.inputs.label}>Setup</div>
                    <input value={setupMin} onChange={(e) => setSetupMin(e.target.value)} style={UI.inputs.base} />
                  </div>
                  <div>
                    <div style={UI.inputs.label}>Čas / ks</div>
                    <input value={runMinPerPiece} onChange={(e) => setRunMinPerPiece(e.target.value)} style={UI.inputs.base} />
                  </div>
                  <div style={{ display: "flex", gap: 16, alignItems: "center", paddingTop: 20 }}>
                    <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <input type="checkbox" checked={controlRequired} onChange={(e) => setControlRequired(e.target.checked)} />
                      Kontrola
                    </label>
                    <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <input type="checkbox" checked={outsourcing} onChange={(e) => setOutsourcing(e.target.checked)} />
                      Kooperace
                    </label>
                  </div>
                  <div style={{ gridColumn: "1 / -1" }}>
                    <div style={UI.inputs.label}>Poznámka</div>
                    <input value={note} onChange={(e) => setNote(e.target.value)} style={UI.inputs.base} />
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
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
                    {operations.map((op, index) => (
                      <tr key={op.id}>
                        <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap", fontWeight: 800 }}>{op.operation_no}</td>
                        <td style={{ ...UI.td, padding: "10px 10px" }}>{op.operation_name}</td>
                        <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>{op.machine_code || "—"}</td>
                        <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>{op.setup_time_min}</td>
                        <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>{op.labor_time_per_piece_min}</td>
                        <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>{op.control_required ? "ANO" : "NE"}</td>
                        <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>{op.outsourcing ? "ANO" : "NE"}</td>
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
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <div style={{ ...UI.card, borderRadius: 14, padding: 16, marginTop: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 10 }}>
              <div style={{ ...UI.sectionTitle, fontSize: 16, marginBottom: 0 }}>Materiál pro technologický postup</div>
              {!showAddMaterialForm ? (
                <button
                  type="button"
                  style={{ ...UI.buttons.primary, ...(templateId ? {} : { opacity: 0.6, cursor: "not-allowed" }) }}
                  onClick={() => {
                    if (!templateId) return;
                    setShowAddMaterialForm(true);
                  }}
                >
                  Přidat materiál
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

                  <div>
                    <div style={{ fontSize: 12, color: "#64748b", marginBottom: 4 }}>Spotřeba / ks</div>
                    <input value={consumptionPerPiece} onChange={(e) => setConsumptionPerPiece(e.target.value)} style={UI.inputs.base} />
                  </div>
                  <div>
                    <div style={{ fontSize: 12, color: "#64748b", marginBottom: 4 }}>Jednotka spotřeby</div>
                    <input value={consumptionUnit} onChange={(e) => setConsumptionUnit(e.target.value)} style={UI.inputs.base} />
                  </div>
                  <div>
                    <div style={{ fontSize: 12, color: "#64748b", marginBottom: 4 }}>Prořez / odpad</div>
                    <input value={scrapAllowance} onChange={(e) => setScrapAllowance(e.target.value)} style={UI.inputs.base} />
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
                      {isMaterialEditMode ? "Uložit změny" : "Uložit materiál"}
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
                <div style={UI.sectionSubtitle}>Zatím nejsou definovány žádné materiály.</div>
                <button
                  type="button"
                  style={UI.buttons.primary}
                  onClick={() => setShowAddMaterialForm(true)}
                >
                  Přidat první materiál
                </button>
              </div>
            ) : (
              <div style={{ overflowX: "auto", marginTop: 24 }}>
                <table style={UI.table}>
                  <thead>
                    <tr style={{ background: "#f8fafc" }}>
                      {["Materiál", "Kód", "Rozměr", "Lokace", "Skladem", "Stav skladu", "Spotřeba / ks", "Jednotka", "Prořez / odpad", "Poznámka", "Akce"].map((h) => (
                        <th key={h} style={{ ...UI.th, fontSize: 13, padding: "10px 10px", whiteSpace: "nowrap" }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {materials.map((row) => (
                      <tr key={row.id}>
                        <td style={{ ...UI.td, padding: "10px 10px" }}>{row.material_name}</td>
                        <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>{row.material_code || "—"}</td>
                        <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>
                          {materialById.get(row.material_library_item_id)?.dimension || "—"}
                        </td>
                        <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>{row.stock_location || "—"}</td>
                        <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>{row.stock_current_qty ?? "—"}</td>
                        <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>{stockStatusLabel(row.stock_status)}</td>
                        <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>{row.consumption_per_piece ?? "—"}</td>
                        <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>{row.consumption_unit || "—"}</td>
                        <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>{row.scrap_allowance ?? "—"}</td>
                        <td style={{ ...UI.td, padding: "10px 10px" }}>{row.note || "—"}</td>
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
          <div style={{ ...UI.card, borderRadius: 14, padding: 16 }}>
            <div style={{ ...UI.sectionTitle, fontSize: 16, marginBottom: 0 }}>
              Modul Dokumenty pro tuto portfolio položku je ve vývoji.
            </div>
          </div>
        ) : (
          <div style={{ ...UI.card, borderRadius: 14, padding: 16 }}>
            <div style={{ ...UI.sectionTitle, fontSize: 16, marginBottom: 0 }}>
              Modul Historie pro tuto portfolio položku je ve vývoji.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

