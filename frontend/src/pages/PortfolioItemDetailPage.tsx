import React, { useEffect, useMemo, useState } from "react";
import { UI } from "../styles/ui";
import {
  createPortfolioTechnologyOperation,
  deletePortfolioTechnologyOperation,
  getPortfolioItemTechnology,
  updatePortfolioTechnologyOperation,
  type PortfolioItem,
  type PortfolioTechnologyOperation,
} from "../services/portfolioApi";

type Props = {
  item?: PortfolioItem | null;
  onBack: () => void;
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

export default function PortfolioItemDetailPage({ item, onBack }: Props) {
  const [activeTab, setActiveTab] = useState<PortfolioDetailSubtab>("Technologický postup");
  const [hoverTab, setHoverTab] = useState<PortfolioDetailSubtab | null>(null);
  const [showAddOperationForm, setShowAddOperationForm] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [editingOperationId, setEditingOperationId] = useState<number | null>(null);
  const [operationName, setOperationName] = useState("");
  const [workplace, setWorkplace] = useState("");
  const [setupMin, setSetupMin] = useState("0");
  const [runMinPerPiece, setRunMinPerPiece] = useState("0");
  const [controlRequired, setControlRequired] = useState(false);
  const [outsourcing, setOutsourcing] = useState(false);
  const [note, setNote] = useState("");
  const [templateId, setTemplateId] = useState<number | null>(item?.active_template_id ?? null);
  const [operations, setOperations] = useState<PortfolioTechnologyOperation[]>([]);
  const [techLoading, setTechLoading] = useState(false);
  const [techError, setTechError] = useState<string | null>(null);

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

  useEffect(() => {
    loadTechnology();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id]);

  function resetForm() {
    setIsEditMode(false);
    setEditingOperationId(null);
    setOperationName("");
    setWorkplace("");
    setSetupMin("0");
    setRunMinPerPiece("0");
    setControlRequired(false);
    setOutsourcing(false);
    setNote("");
    setShowAddOperationForm(false);
  }

  async function saveOperation() {
    if (!operationName.trim()) return;
    if (!templateId) return;

    const payload = {
      operation_name: operationName.trim(),
      machine_code: workplace.trim() || null,
      setup_time_min: Number(setupMin) || 0,
      labor_time_per_piece_min: Number(runMinPerPiece) || 0,
      control_required: controlRequired,
      outsourcing,
      note: note.trim() || null,
    };

    try {
      if (isEditMode && editingOperationId != null) {
        await updatePortfolioTechnologyOperation(editingOperationId, payload);
      } else {
        await createPortfolioTechnologyOperation(templateId, payload);
      }
      await loadTechnology();
      resetForm();
    } catch (e: unknown) {
      setTechError(e instanceof Error ? e.message : "Nepodarilo se ulozit operaci.");
    }
  }

  function startEdit(op: PortfolioTechnologyOperation) {
    setIsEditMode(true);
    setEditingOperationId(op.id);
    setOperationName(op.operation_name);
    setWorkplace(op.machine_code ?? "");
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

  return (
    <div style={UI.container}>
      <div style={{ paddingTop: 10, display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button type="button" style={UI.buttons.secondary} onClick={onBack}>
            Zpět na portfolio
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
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
                  <div>
                    <div style={UI.inputs.label}>Operace</div>
                    <input value={operationName} onChange={(e) => setOperationName(e.target.value)} style={UI.inputs.base} />
                  </div>
                  <div>
                    <div style={UI.inputs.label}>Pracoviště</div>
                    <input value={workplace} onChange={(e) => setWorkplace(e.target.value)} style={UI.inputs.base} />
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
              <div style={UI.sectionSubtitle}>Zatím není definován žádný technologický postup.</div>
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
                    {operations.map((op) => (
                      <tr key={op.id}>
                        <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap", fontWeight: 800 }}>{op.operation_no}</td>
                        <td style={{ ...UI.td, padding: "10px 10px" }}>{op.operation_name}</td>
                        <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>{op.machine_code || "—"}</td>
                        <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>{op.setup_time_min}</td>
                        <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>{op.labor_time_per_piece_min}</td>
                        <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>{op.control_required ? "ANO" : "NE"}</td>
                        <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap" }}>{op.outsourcing ? "ANO" : "NE"}</td>
                        <td style={{ ...UI.td, padding: "10px 10px" }}>{op.note || "—"}</td>
                        <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap", display: "flex", gap: 6 }}>
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

