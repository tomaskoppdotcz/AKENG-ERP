import React, { useEffect, useMemo, useState } from "react";
import { buildSearchHaystack, matchesSearchQuery } from "../overview/overviewSearch";
import TableRowActionsMenu from "../components/table/TableRowActionsMenu";
import { buildErpUrl } from "../utils/erpDeepLink";
import { akengFetch } from "../services/akengFetch";

const API_BASE =
  (import.meta as any).env?.VITE_API_BASE_URL || "http://127.0.0.1:8000";

type WorkplaceRow = {
  id: number;
  code: string | null;
  name: string;
  is_active: boolean;
};

type TemplateListRow = {
  id: number;
  gpn: string;
  name: string | null;
  revision: string | null;
  material: string | null;
  product_group: string | null;
  is_active: boolean;
  operations_count: number;
};

type TemplateOperation = {
  id?: number;
  operation_no: number;
  operation_name: string;
  workplace_library_item_id?: number | null;
  machine_code: string;
  machine_name?: string | null;
  setup_time_min: number;
  labor_time_per_piece_min: number;
  buffer_after_min: number;
  note?: string | null;
};

type TemplateDetail = {
  id: number;
  gpn: string;
  name: string | null;
  revision: string | null;
  material: string | null;
  product_group: string | null;
  is_active: boolean;
  operations: TemplateOperation[];
};

type NewTemplateOperation = {
  operation_no: number;
  operation_name: string;
  workplace_library_item_id: number;
  setup_time_min: number;
  labor_time_per_piece_min: number;
  buffer_after_min: number;
  note: string;
};

type NewTemplateState = {
  gpn: string;
  name: string;
  revision: string;
  material: string;
  product_group: string;
  operations: NewTemplateOperation[];
};

type EditTemplateOperation = {
  id?: number;
  operation_no: number;
  operation_name: string;
  workplace_library_item_id: number;
  setup_time_min: number;
  labor_time_per_piece_min: number;
  buffer_after_min: number;
  note: string;
};

type EditTemplateState = {
  gpn: string;
  name: string;
  revision: string;
  material: string;
  product_group: string;
  operations: EditTemplateOperation[];
};

const defaultNewTemplate = (defaultWorkplaceId: number): NewTemplateState => ({
  gpn: "",
  name: "",
  revision: "",
  material: "",
  product_group: "",
  operations: [
    {
      operation_no: 10,
      operation_name: "Rezani",
      workplace_library_item_id: defaultWorkplaceId,
      setup_time_min: 5,
      labor_time_per_piece_min: 1,
      buffer_after_min: 20,
      note: "",
    },
  ],
});

function cardStyle(padding = 18): React.CSSProperties {
  return {
    background: "#ffffff",
    border: "1px solid #dbe2ea",
    borderRadius: 16,
    padding,
    boxShadow: "0 1px 2px rgba(15, 23, 42, 0.04)",
  };
}

function sectionTitleStyle(): React.CSSProperties {
  return {
    margin: 0,
    fontSize: 22,
    fontWeight: 800,
    color: "#0f172a",
  };
}

function labelStyle(): React.CSSProperties {
  return {
    fontSize: 12,
    color: "#64748b",
    marginBottom: 6,
    fontWeight: 700,
  };
}

function fieldStyle(): React.CSSProperties {
  return {
    width: "100%",
    padding: "11px 12px",
    borderRadius: 10,
    border: "1px solid #cbd5e1",
    fontSize: 14,
    boxSizing: "border-box",
    background: "#fff",
  };
}

function statCardStyle(): React.CSSProperties {
  return {
    border: "1px solid #e2e8f0",
    borderRadius: 14,
    padding: 14,
    background: "#fff",
    minHeight: 84,
  };
}

function buttonPrimaryStyle(): React.CSSProperties {
  return {
    border: "1px solid #0f172a",
    background: "#0f172a",
    color: "#fff",
    borderRadius: 10,
    padding: "11px 14px",
    cursor: "pointer",
    fontWeight: 700,
  };
}

function buttonSecondaryStyle(): React.CSSProperties {
  return {
    border: "1px solid #0f172a",
    background: "#fff",
    color: "#0f172a",
    borderRadius: 10,
    padding: "10px 12px",
    cursor: "pointer",
    fontWeight: 700,
  };
}

function ProductBadge({ text }: { text: string }) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "4px 8px",
        borderRadius: 999,
        background: "#eff6ff",
        color: "#1d4ed8",
        fontSize: 12,
        fontWeight: 700,
      }}
    >
      {text}
    </span>
  );
}

export default function PortfolioGpnTpPage() {
  const [templates, setTemplates] = useState<TemplateListRow[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(null);
  const [hoverListRowId, setHoverListRowId] = useState<number | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateDetail | null>(null);
  const [workplaces, setWorkplaces] = useState<WorkplaceRow[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [saving, setSaving] = useState(false);
  const [seeding, setSeeding] = useState(false);

  const [search, setSearch] = useState("");
  const [groupFilter, setGroupFilter] = useState("vse");
  const [newTemplate, setNewTemplate] = useState<NewTemplateState>(() => defaultNewTemplate(0));

  const [editMode, setEditMode] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editTemplate, setEditTemplate] = useState<EditTemplateState | null>(null);

  useEffect(() => {
    void loadWorkplaces();
    loadTemplates();
  }, []);

  useEffect(() => {
    const first = workplaces.find((w) => w.is_active)?.id ?? workplaces[0]?.id ?? 0;
    if (first > 0) {
      setNewTemplate((prev) => {
        if (prev.operations.some((o) => o.workplace_library_item_id > 0)) return prev;
        return defaultNewTemplate(first);
      });
    }
  }, [workplaces]);

  useEffect(() => {
    const raw = window.location.hash.replace(/^#/, "");
    const m = raw.match(/gpnTpTemplate=(\d+)/);
    if (m) {
      const id = Number(m[1]);
      if (Number.isFinite(id) && id > 0) {
        setSelectedTemplateId(id);
      }
    }
  }, []);

  useEffect(() => {
    if (selectedTemplateId) {
      loadTemplateDetail(selectedTemplateId);
    } else {
      setSelectedTemplate(null);
      setEditTemplate(null);
      setEditMode(false);
    }
  }, [selectedTemplateId]);

  async function loadWorkplaces() {
    try {
      const res = await akengFetch(`${API_BASE}/libraries/workplaces`);
      const data = await res.json();
      const rows = Array.isArray(data) ? data : [];
      setWorkplaces(
        rows.map((r: any) => ({
          id: Number(r.id),
          code: r.code ?? null,
          name: String(r.name || ""),
          is_active: r.is_active !== false,
        }))
      );
    } catch (e) {
      console.error(e);
      setWorkplaces([]);
    }
  }

  async function loadTemplates() {
    setLoadingList(true);
    try {
      const res = await akengFetch(`${API_BASE}/technology/templates`);
      const data = await res.json();
      const rows = Array.isArray(data) ? data : [];
      setTemplates(rows);

      if (rows.length > 0) {
        setSelectedTemplateId((prev) => prev ?? rows[0].id);
      } else {
        setSelectedTemplateId(null);
      }
    } catch (e) {
      console.error(e);
      setTemplates([]);
    } finally {
      setLoadingList(false);
    }
  }

  async function loadTemplateDetail(templateId: number) {
    setLoadingDetail(true);
    try {
      const res = await akengFetch(`${API_BASE}/technology/templates/${templateId}`);
      const data = await res.json();
      setSelectedTemplate(data);
      setEditTemplate({
        gpn: data.gpn || "",
        name: data.name || "",
        revision: data.revision || "",
        material: data.material || "",
        product_group: data.product_group || "",
        operations: (data.operations || []).map((op: any) => ({
          id: op.id,
          operation_no: op.operation_no,
          operation_name: op.operation_name,
          workplace_library_item_id: Number(op.workplace_library_item_id) || 0,
          setup_time_min: op.setup_time_min,
          labor_time_per_piece_min: op.labor_time_per_piece_min,
          buffer_after_min: op.buffer_after_min,
          note: op.note || "",
        })),
      });
      setEditMode(false);
    } catch (e) {
      console.error(e);
      setSelectedTemplate(null);
      setEditTemplate(null);
    } finally {
      setLoadingDetail(false);
    }
  }

  async function seedSampleTemplates() {
    setSeeding(true);
    try {
      await akengFetch(`${API_BASE}/technology/templates/seed-sample`, {
        method: "POST",
      });
      await loadTemplates();
    } catch (e) {
      console.error(e);
      alert("Nepodarilo se nahrat ukazkove TP sablony.");
    } finally {
      setSeeding(false);
    }
  }

  function updateTemplateField<K extends keyof NewTemplateState>(key: K, value: NewTemplateState[K]) {
    setNewTemplate((prev) => ({ ...prev, [key]: value }));
  }

  function updateOperation(index: number, patch: Partial<NewTemplateOperation>) {
    setNewTemplate((prev) => ({
      ...prev,
      operations: prev.operations.map((op, i) => (i === index ? { ...op, ...patch } : op)),
    }));
  }

  function pickDefaultWorkplaceId(): number {
    const active = workplaces.filter((w) => w.is_active);
    const pool = active.length ? active : workplaces;
    return pool[0]?.id ?? 0;
  }

  function addOperationRow() {
    setNewTemplate((prev) => {
      const nextNo =
        prev.operations.length > 0
          ? Math.max(...prev.operations.map((o) => Number(o.operation_no) || 0)) + 10
          : 10;
      const wid = pickDefaultWorkplaceId();

      return {
        ...prev,
        operations: [
          ...prev.operations,
          {
            operation_no: nextNo,
            operation_name: "",
            workplace_library_item_id: wid,
            setup_time_min: 0,
            labor_time_per_piece_min: 0,
            buffer_after_min: 20,
            note: "",
          },
        ],
      };
    });
  }

  function removeOperationRow(index: number) {
    setNewTemplate((prev) => ({
      ...prev,
      operations: prev.operations.filter((_, i) => i !== index),
    }));
  }

  async function saveTemplate() {
    if (!newTemplate.gpn.trim()) {
      alert("Vypln GPN.");
      return;
    }

    if (newTemplate.operations.length === 0) {
      alert("TP musi obsahovat alespon jednu operaci.");
      return;
    }
    if (newTemplate.operations.some((op) => !op.workplace_library_item_id)) {
      alert("U kazde operace vyberte pracoviste (knihovna).");
      return;
    }

    const payload = {
      gpn: newTemplate.gpn.trim(),
      name: newTemplate.name.trim() || null,
      revision: newTemplate.revision.trim() || null,
      material: newTemplate.material.trim() || null,
      product_group: newTemplate.product_group.trim() || null,
      operations: newTemplate.operations.map((op) => ({
        operation_no: Number(op.operation_no),
        operation_name: op.operation_name.trim(),
        workplace_library_item_id: Number(op.workplace_library_item_id),
        setup_time_min: Number(op.setup_time_min),
        labor_time_per_piece_min: Number(op.labor_time_per_piece_min),
        buffer_after_min: Number(op.buffer_after_min),
        note: op.note.trim() || null,
      })),
    };

    setSaving(true);
    try {
      const res = await akengFetch(`${API_BASE}/technology/templates/full`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const result = await res.json();

      if (!res.ok) {
        throw new Error(result?.detail || "Ulozeni TP selhalo.");
      }

      setNewTemplate(defaultNewTemplate(pickDefaultWorkplaceId()));
      await loadTemplates();

      if (result.template_id) {
        setSelectedTemplateId(result.template_id);
      }
    } catch (e: any) {
      console.error(e);
      alert(e?.message || "Ulozeni TP selhalo.");
    } finally {
      setSaving(false);
    }
  }

  function startEditMode() {
    if (!selectedTemplate) return;
    const fallbackWid = pickDefaultWorkplaceId();
    setEditTemplate({
      gpn: selectedTemplate.gpn || "",
      name: selectedTemplate.name || "",
      revision: selectedTemplate.revision || "",
      material: selectedTemplate.material || "",
      product_group: selectedTemplate.product_group || "",
      operations: (selectedTemplate.operations || []).map((op) => ({
        id: op.id,
        operation_no: op.operation_no,
        operation_name: op.operation_name,
        workplace_library_item_id: Number((op as TemplateOperation).workplace_library_item_id) || fallbackWid,
        setup_time_min: op.setup_time_min,
        labor_time_per_piece_min: op.labor_time_per_piece_min,
        buffer_after_min: op.buffer_after_min,
        note: op.note || "",
      })),
    });
    setEditMode(true);
  }

  function cancelEditMode() {
    if (!selectedTemplate) {
      setEditMode(false);
      setEditTemplate(null);
      return;
    }

    const fallbackWid = pickDefaultWorkplaceId();
    setEditTemplate({
      gpn: selectedTemplate.gpn || "",
      name: selectedTemplate.name || "",
      revision: selectedTemplate.revision || "",
      material: selectedTemplate.material || "",
      product_group: selectedTemplate.product_group || "",
      operations: (selectedTemplate.operations || []).map((op) => ({
        id: op.id,
        operation_no: op.operation_no,
        operation_name: op.operation_name,
        workplace_library_item_id: Number((op as TemplateOperation).workplace_library_item_id) || fallbackWid,
        setup_time_min: op.setup_time_min,
        labor_time_per_piece_min: op.labor_time_per_piece_min,
        buffer_after_min: op.buffer_after_min,
        note: op.note || "",
      })),
    });
    setEditMode(false);
  }

  function updateEditField<K extends keyof EditTemplateState>(key: K, value: EditTemplateState[K]) {
    setEditTemplate((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  function updateEditOperation(index: number, patch: Partial<EditTemplateOperation>) {
    setEditTemplate((prev) =>
      prev
        ? {
            ...prev,
            operations: prev.operations.map((op, i) => (i === index ? { ...op, ...patch } : op)),
          }
        : prev
    );
  }

  function addEditOperationRow() {
    setEditTemplate((prev) => {
      if (!prev) return prev;
      const nextNo =
        prev.operations.length > 0
          ? Math.max(...prev.operations.map((o) => Number(o.operation_no) || 0)) + 10
          : 10;

      return {
        ...prev,
        operations: [
          ...prev.operations,
          {
            operation_no: nextNo,
            operation_name: "",
            workplace_library_item_id: pickDefaultWorkplaceId(),
            setup_time_min: 0,
            labor_time_per_piece_min: 0,
            buffer_after_min: 20,
            note: "",
          },
        ],
      };
    });
  }

  function removeEditOperationRow(index: number) {
    setEditTemplate((prev) =>
      prev
        ? {
            ...prev,
            operations: prev.operations.filter((_, i) => i !== index),
          }
        : prev
    );
  }

  async function saveEditedTemplate() {
    if (!selectedTemplateId || !editTemplate) return;

    if (!editTemplate.gpn.trim()) {
      alert("Vypln GPN.");
      return;
    }

    if (editTemplate.operations.length === 0) {
      alert("TP musi obsahovat alespon jednu operaci.");
      return;
    }
    if (editTemplate.operations.some((op) => !op.workplace_library_item_id)) {
      alert("U kazde operace vyberte pracoviste (knihovna).");
      return;
    }

    const payload = {
      gpn: editTemplate.gpn.trim(),
      name: editTemplate.name.trim() || null,
      revision: editTemplate.revision.trim() || null,
      material: editTemplate.material.trim() || null,
      product_group: editTemplate.product_group.trim() || null,
      operations: editTemplate.operations.map((op) => ({
        operation_no: Number(op.operation_no),
        operation_name: op.operation_name.trim(),
        workplace_library_item_id: Number(op.workplace_library_item_id),
        setup_time_min: Number(op.setup_time_min),
        labor_time_per_piece_min: Number(op.labor_time_per_piece_min),
        buffer_after_min: Number(op.buffer_after_min),
        note: op.note.trim() || null,
      })),
    };

    setEditSaving(true);
    try {
      const res = await akengFetch(`${API_BASE}/technology/templates/${selectedTemplateId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const result = await res.json();

      if (!res.ok) {
        throw new Error(result?.detail || "Ulozeni zmen TP selhalo.");
      }

      await loadTemplates();
      await loadTemplateDetail(selectedTemplateId);
      setEditMode(false);
    } catch (e: any) {
      console.error(e);
      alert(e?.message || "Ulozeni zmen TP selhalo.");
    } finally {
      setEditSaving(false);
    }
  }

  const productGroups = useMemo(() => {
    const unique = Array.from(
      new Set(
        templates
          .map((t) => t.product_group?.trim())
          .filter((x): x is string => Boolean(x))
      )
    );
    return unique.sort((a, b) => a.localeCompare(b));
  }, [templates]);

  const filteredTemplates = useMemo(() => {
    return templates.filter((t) => {
      const hay = buildSearchHaystack(
        t.gpn,
        t.name,
        t.revision,
        t.material,
        t.product_group,
        t.operations_count
      );
      const matchSearch = matchesSearchQuery(search, hay);
      const matchGroup =
        groupFilter === "vse" || (t.product_group || "").toLowerCase() === groupFilter.toLowerCase();

      return matchSearch && matchGroup;
    });
  }, [templates, search, groupFilter]);

  const selectedStats = selectedTemplate
    ? [
        { label: "GPN", value: selectedTemplate.gpn },
        { label: "Nazev", value: selectedTemplate.name || "-" },
        { label: "Revize", value: selectedTemplate.revision || "-" },
        { label: "Material", value: selectedTemplate.material || "-" },
        { label: "Skupina", value: selectedTemplate.product_group || "-" },
      ]
    : [];

  return (
    <div
      className="erp-overview-page"
      style={{
        minHeight: "100vh",
        background: "#f8fafc",
        padding: 18,
        fontFamily: "Arial, sans-serif",
      }}
    >
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ margin: 0, fontSize: 42, lineHeight: 1.1 }}>Portfolio GPN + TP</h1>
        <div style={{ color: "#64748b", marginTop: 8, fontSize: 16 }}>
          Databaze dilu a technologickych postupu pro AKENG
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "430px 1fr",
          gap: 18,
          alignItems: "start",
        }}
      >
        <aside style={{ display: "grid", gap: 18 }}>
          <div style={cardStyle(16)}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 14,
              }}
            >
              <h2 style={{ ...sectionTitleStyle(), fontSize: 28 }}>Portfolio</h2>
              <button onClick={seedSampleTemplates} disabled={seeding} style={buttonSecondaryStyle()}>
                {seeding ? "Nahravam..." : "Ukazkove TP"}
              </button>
            </div>

            <div style={{ display: "grid", gap: 10, marginBottom: 14 }}>
              <div>
                <div style={labelStyle()}>Vyhledavani</div>
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Hledat GPN, název, revizi, TP, materiál…"
                  style={fieldStyle()}
                />
              </div>

              <div>
                <div style={labelStyle()}>Skupina vyrobku</div>
                <select
                  value={groupFilter}
                  onChange={(e) => setGroupFilter(e.target.value)}
                  style={fieldStyle()}
                >
                  <option value="vse">Vsechny skupiny</option>
                  {productGroups.map((group) => (
                    <option key={group} value={group}>
                      {group}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div
              style={{
                overflow: "auto",
                maxHeight: "68vh",
                border: "1px solid #e2e8f0",
                borderRadius: 14,
              }}
            >
              <table width="100%" cellPadding={10} style={{ borderCollapse: "collapse", fontSize: 14 }}>
                <thead style={{ position: "sticky", top: 0, background: "#f8fafc", zIndex: 1 }}>
                  <tr>
                    <th align="left">GPN</th>
                    <th align="left">Nazev</th>
                    <th align="left">Skupina</th>
                    <th align="left">OP</th>
                  </tr>
                </thead>
                <tbody>
                  {loadingList ? (
                    <tr>
                      <td colSpan={4} style={{ padding: 16 }}>
                        Nacitani...
                      </td>
                    </tr>
                  ) : filteredTemplates.length === 0 ? (
                    <tr>
                      <td colSpan={4} style={{ padding: 16 }}>
                        Zadne GPN / TP nenalezeny.
                      </td>
                    </tr>
                  ) : (
                    filteredTemplates.map((row) => {
                      const rowHot = selectedTemplateId === row.id || hoverListRowId === row.id;
                      return (
                      <tr
                        key={row.id}
                        onClick={() => setSelectedTemplateId(row.id)}
                        onMouseEnter={() => setHoverListRowId(row.id)}
                        onMouseLeave={() => setHoverListRowId((id) => (id === row.id ? null : id))}
                        style={{
                          borderTop: "1px solid #eef2f7",
                          cursor: "pointer",
                          background: rowHot ? "#e0f2fe" : "#fff",
                          transition: "background 120ms ease",
                        }}
                      >
                        <td
                          style={{ fontWeight: 800, whiteSpace: "nowrap" }}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSearch(row.gpn);
                          }}
                          title="Kliknutím vyfiltruje seznam podle GPN"
                        >
                          <span style={{ textDecoration: "underline", textUnderlineOffset: 3, cursor: "pointer" }}>
                            {row.gpn}
                          </span>
                        </td>
                        <td>{row.name || "-"}</td>
                        <td>{row.product_group ? <ProductBadge text={row.product_group} /> : "-"}</td>
                        <td>{row.operations_count}</td>
                      </tr>
                    );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </aside>

        <main style={{ display: "grid", gap: 18 }}>
          <div style={cardStyle(18)}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 14,
              }}
            >
              <h2 style={{ ...sectionTitleStyle(), fontSize: 28 }}>Detail GPN + TP</h2>
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                {selectedTemplate?.product_group ? <ProductBadge text={selectedTemplate.product_group} /> : null}
                {selectedTemplateId ? (
                  <button
                    type="button"
                    onClick={() => {
                      const u = new URL(window.location.href);
                      u.hash = `gpnTpTemplate=${selectedTemplateId}`;
                      window.open(u.toString(), "_blank");
                    }}
                    style={buttonSecondaryStyle()}
                  >
                    Otevřít v novém okně
                  </button>
                ) : null}
                {selectedTemplate?.gpn ? (
                  <button
                    type="button"
                    onClick={() =>
                      window.open(buildErpUrl({ view: "portfolioSearch", gpn: selectedTemplate.gpn.trim() }), "_blank")
                    }
                    style={buttonSecondaryStyle()}
                  >
                    Portfolio v ERP (GPN)
                  </button>
                ) : null}
                {selectedTemplate && !editMode && (
                  <button onClick={startEditMode} style={buttonSecondaryStyle()}>
                    Upravit TP
                  </button>
                )}
                {selectedTemplate && editMode && (
                  <>
                    <button onClick={cancelEditMode} style={buttonSecondaryStyle()}>
                      Zrusit
                    </button>
                    <button onClick={saveEditedTemplate} disabled={editSaving} style={buttonPrimaryStyle()}>
                      {editSaving ? "Ukladam..." : "Ulozit zmeny"}
                    </button>
                  </>
                )}
              </div>
            </div>

            {loadingDetail ? (
              <div>Nacitani detailu...</div>
            ) : !selectedTemplate ? (
              <div>Vyber GPN ze seznamu vlevo.</div>
            ) : !editMode ? (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(5, minmax(0, 1fr))",
                  gap: 12,
                }}
              >
                {selectedStats.map((item) => (
                  <div key={item.label} style={statCardStyle()}>
                    <div style={{ color: "#64748b", fontSize: 12, marginBottom: 6, fontWeight: 700 }}>
                      {item.label}
                    </div>
                    <div
                      style={{
                        fontSize: item.label === "GPN" ? 28 : 18,
                        fontWeight: 800,
                        color: "#0f172a",
                        lineHeight: 1.2,
                        wordBreak: "break-word",
                      }}
                    >
                      {item.value}
                    </div>
                  </div>
                ))}
              </div>
            ) : !editTemplate ? (
              <div>Nelze nacist editor TP.</div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: 12 }}>
                <div>
                  <div style={labelStyle()}>GPN</div>
                  <input
                    value={editTemplate.gpn}
                    onChange={(e) => updateEditField("gpn", e.target.value)}
                    style={fieldStyle()}
                  />
                </div>
                <div>
                  <div style={labelStyle()}>Nazev</div>
                  <input
                    value={editTemplate.name}
                    onChange={(e) => updateEditField("name", e.target.value)}
                    style={fieldStyle()}
                  />
                </div>
                <div>
                  <div style={labelStyle()}>Revize</div>
                  <input
                    value={editTemplate.revision}
                    onChange={(e) => updateEditField("revision", e.target.value)}
                    style={fieldStyle()}
                  />
                </div>
                <div>
                  <div style={labelStyle()}>Material</div>
                  <input
                    value={editTemplate.material}
                    onChange={(e) => updateEditField("material", e.target.value)}
                    style={fieldStyle()}
                  />
                </div>
                <div>
                  <div style={labelStyle()}>Skupina</div>
                  <input
                    value={editTemplate.product_group}
                    onChange={(e) => updateEditField("product_group", e.target.value)}
                    style={fieldStyle()}
                  />
                </div>
              </div>
            )}
          </div>

          <div style={cardStyle(18)}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 14,
              }}
            >
              <h2 style={{ ...sectionTitleStyle(), fontSize: 28 }}>
                {editMode ? "Editor TP operaci" : "TP operace"}
              </h2>

              {selectedTemplate && !editMode && (
                <div style={{ color: "#64748b", fontWeight: 700 }}>
                  {selectedTemplate.operations.length} operaci
                </div>
              )}

              {editMode && (
                <button onClick={addEditOperationRow} style={buttonSecondaryStyle()}>
                  + Pridat operaci
                </button>
              )}
            </div>

            {loadingDetail ? (
              <div>Nacitani operaci...</div>
            ) : !selectedTemplate ? (
              <div>Vyber GPN ze seznamu vlevo.</div>
            ) : !editMode ? (
              <div
                style={{
                  overflow: "auto",
                  border: "1px solid #e2e8f0",
                  borderRadius: 14,
                }}
              >
                <table width="100%" cellPadding={10} style={{ borderCollapse: "collapse", fontSize: 14 }}>
                  <thead style={{ background: "#f8fafc" }}>
                    <tr>
                      <th align="left">Operace</th>
                      <th align="left">Nazev</th>
                      <th align="left">Pracoviště</th>
                      <th align="left">Setup</th>
                      <th align="left">Cas / kus</th>
                      <th align="left">Buffer</th>
                      <th align="left">Poznamka</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedTemplate.operations.length === 0 ? (
                      <tr>
                        <td colSpan={7} style={{ padding: 16 }}>
                          TP zatim nema zadne operace.
                        </td>
                      </tr>
                    ) : (
                      selectedTemplate.operations.map((op, idx) => (
                        <tr key={idx} style={{ borderTop: "1px solid #eef2f7" }}>
                          <td style={{ fontWeight: 800, whiteSpace: "nowrap" }}>{op.operation_no}</td>
                          <td style={{ fontWeight: 700 }}>{op.operation_name}</td>
                          <td>
                            <div style={{ fontWeight: 700 }}>
                              {workplaces.find((w) => w.id === (op as TemplateOperation).workplace_library_item_id)
                                ?.name ||
                                op.machine_name ||
                                op.machine_code}
                            </div>
                            <div style={{ color: "#64748b", fontSize: 12 }}>
                              id pracoviště: {(op as TemplateOperation).workplace_library_item_id ?? "—"}
                            </div>
                          </td>
                          <td>{op.setup_time_min} min</td>
                          <td>{op.labor_time_per_piece_min} min</td>
                          <td>{op.buffer_after_min} min</td>
                          <td>{op.note || "-"}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            ) : !editTemplate ? (
              <div>Nelze nacist editor operaci.</div>
            ) : (
              <div style={{ display: "grid", gap: 12 }}>
                {editTemplate.operations.map((op, index) => (
                  <div
                    key={index}
                    style={{
                      border: "1px solid #dbe2ea",
                      borderRadius: 14,
                      padding: 14,
                      background: "#f8fafc",
                    }}
                  >
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "120px 1.2fr 1fr auto",
                        gap: 12,
                        marginBottom: 12,
                        alignItems: "end",
                      }}
                    >
                      <div>
                        <div style={labelStyle()}>Operace</div>
                        <input
                          type="number"
                          value={op.operation_no}
                          onChange={(e) => updateEditOperation(index, { operation_no: Number(e.target.value) })}
                          style={fieldStyle()}
                        />
                      </div>

                      <div>
                        <div style={labelStyle()}>Nazev operace</div>
                        <input
                          value={op.operation_name}
                          onChange={(e) => updateEditOperation(index, { operation_name: e.target.value })}
                          style={fieldStyle()}
                        />
                      </div>

                      <div>
                        <div style={labelStyle()}>Pracoviště</div>
                        <select
                          value={String(op.workplace_library_item_id || "")}
                          onChange={(e) =>
                            updateEditOperation(index, {
                              workplace_library_item_id: Number(e.target.value) || 0,
                            })
                          }
                          style={fieldStyle()}
                        >
                          <option value="">Vyberte pracoviště</option>
                          {(workplaces.filter((w) => w.is_active).length ? workplaces.filter((w) => w.is_active) : workplaces).map(
                            (w) => (
                              <option key={w.id} value={String(w.id)}>
                                {w.name}
                                {w.code ? ` (${w.code})` : ""}
                              </option>
                            )
                          )}
                        </select>
                      </div>

                      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center" }}>
                        <TableRowActionsMenu
                          compact
                          align="end"
                          triggerLabel={`Akce operace ${op.operation_no}`}
                          disabled={editTemplate.operations.length === 1}
                          actions={[
                            {
                              key: "delete",
                              label: "Smazat operaci",
                              danger: true,
                              disabled: editTemplate.operations.length === 1,
                              onClick: () => removeEditOperationRow(index),
                            },
                          ]}
                        />
                      </div>
                    </div>

                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(3, minmax(0, 180px)) 1fr",
                        gap: 12,
                      }}
                    >
                      <div>
                        <div style={labelStyle()}>Setup min</div>
                        <input
                          type="number"
                          step="0.1"
                          value={op.setup_time_min}
                          onChange={(e) => updateEditOperation(index, { setup_time_min: Number(e.target.value) })}
                          style={fieldStyle()}
                        />
                      </div>

                      <div>
                        <div style={labelStyle()}>Cas / kus min</div>
                        <input
                          type="number"
                          step="0.1"
                          value={op.labor_time_per_piece_min}
                          onChange={(e) => updateEditOperation(index, { labor_time_per_piece_min: Number(e.target.value) })}
                          style={fieldStyle()}
                        />
                      </div>

                      <div>
                        <div style={labelStyle()}>Buffer po operaci</div>
                        <input
                          type="number"
                          value={op.buffer_after_min}
                          onChange={(e) => updateEditOperation(index, { buffer_after_min: Number(e.target.value) })}
                          style={fieldStyle()}
                        />
                      </div>

                      <div>
                        <div style={labelStyle()}>Poznamka</div>
                        <input
                          value={op.note}
                          onChange={(e) => updateEditOperation(index, { note: e.target.value })}
                          style={fieldStyle()}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </main>
      </div>

      <div style={{ marginTop: 18 }}>
        <div style={cardStyle(18)}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 16,
            }}
          >
            <h2 style={{ ...sectionTitleStyle(), fontSize: 28 }}>Nova TP sablona</h2>
            <button onClick={addOperationRow} style={buttonSecondaryStyle()}>
              + Pridat operaci
            </button>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: 12, marginBottom: 18 }}>
            <div>
              <div style={labelStyle()}>GPN</div>
              <input
                value={newTemplate.gpn}
                onChange={(e) => updateTemplateField("gpn", e.target.value)}
                placeholder="GPN"
                style={fieldStyle()}
              />
            </div>

            <div>
              <div style={labelStyle()}>Nazev dilu</div>
              <input
                value={newTemplate.name}
                onChange={(e) => updateTemplateField("name", e.target.value)}
                placeholder="Nazev dilu"
                style={fieldStyle()}
              />
            </div>

            <div>
              <div style={labelStyle()}>Revize</div>
              <input
                value={newTemplate.revision}
                onChange={(e) => updateTemplateField("revision", e.target.value)}
                placeholder="Revize"
                style={fieldStyle()}
              />
            </div>

            <div>
              <div style={labelStyle()}>Material</div>
              <input
                value={newTemplate.material}
                onChange={(e) => updateTemplateField("material", e.target.value)}
                placeholder="Material"
                style={fieldStyle()}
              />
            </div>

            <div>
              <div style={labelStyle()}>Skupina vyrobku</div>
              <input
                value={newTemplate.product_group}
                onChange={(e) => updateTemplateField("product_group", e.target.value)}
                placeholder="Skupina vyrobku"
                style={fieldStyle()}
              />
            </div>
          </div>

          <div style={{ display: "grid", gap: 12 }}>
            {newTemplate.operations.map((op, index) => (
              <div
                key={index}
                style={{
                  border: "1px solid #dbe2ea",
                  borderRadius: 14,
                  padding: 14,
                  background: "#f8fafc",
                }}
              >
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "120px 1.2fr 1fr auto",
                    gap: 12,
                    marginBottom: 12,
                    alignItems: "end",
                  }}
                >
                  <div>
                    <div style={labelStyle()}>Operace</div>
                    <input
                      type="number"
                      value={op.operation_no}
                      onChange={(e) => updateOperation(index, { operation_no: Number(e.target.value) })}
                      style={fieldStyle()}
                    />
                  </div>

                  <div>
                    <div style={labelStyle()}>Nazev operace</div>
                    <input
                      value={op.operation_name}
                      onChange={(e) => updateOperation(index, { operation_name: e.target.value })}
                      placeholder="Nazev operace"
                      style={fieldStyle()}
                    />
                  </div>

                  <div>
                    <div style={labelStyle()}>Pracoviště</div>
                    <select
                      value={String(op.workplace_library_item_id || "")}
                      onChange={(e) =>
                        updateOperation(index, {
                          workplace_library_item_id: Number(e.target.value) || 0,
                        })
                      }
                      style={fieldStyle()}
                    >
                      <option value="">Vyberte pracoviště</option>
                      {(workplaces.filter((w) => w.is_active).length ? workplaces.filter((w) => w.is_active) : workplaces).map(
                        (w) => (
                          <option key={w.id} value={String(w.id)}>
                            {w.name}
                            {w.code ? ` (${w.code})` : ""}
                          </option>
                        )
                      )}
                    </select>
                  </div>

                  <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center" }}>
                    <TableRowActionsMenu
                      compact
                      align="end"
                      triggerLabel={`Akce operace ${op.operation_no}`}
                      disabled={newTemplate.operations.length === 1}
                      actions={[
                        {
                          key: "delete",
                          label: "Smazat operaci",
                          danger: true,
                          disabled: newTemplate.operations.length === 1,
                          onClick: () => removeOperationRow(index),
                        },
                      ]}
                    />
                  </div>
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(3, minmax(0, 180px)) 1fr",
                    gap: 12,
                  }}
                >
                  <div>
                    <div style={labelStyle()}>Setup min</div>
                    <input
                      type="number"
                      step="0.1"
                      value={op.setup_time_min}
                      onChange={(e) => updateOperation(index, { setup_time_min: Number(e.target.value) })}
                      style={fieldStyle()}
                    />
                  </div>

                  <div>
                    <div style={labelStyle()}>Cas / kus min</div>
                    <input
                      type="number"
                      step="0.1"
                      value={op.labor_time_per_piece_min}
                      onChange={(e) => updateOperation(index, { labor_time_per_piece_min: Number(e.target.value) })}
                      style={fieldStyle()}
                    />
                  </div>

                  <div>
                    <div style={labelStyle()}>Buffer po operaci</div>
                    <input
                      type="number"
                      value={op.buffer_after_min}
                      onChange={(e) => updateOperation(index, { buffer_after_min: Number(e.target.value) })}
                      style={fieldStyle()}
                    />
                  </div>

                  <div>
                    <div style={labelStyle()}>Poznamka</div>
                    <input
                      value={op.note}
                      onChange={(e) => updateOperation(index, { note: e.target.value })}
                      placeholder="Poznamka"
                      style={fieldStyle()}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div
            style={{
              marginTop: 16,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 16,
            }}
          >
            <div style={{ color: "#475569", lineHeight: 1.6 }}>
              <div><b>Jak to bude fungovat:</b></div>
              <div>1. Technolog pripravi GPN a TP sablonu.</div>
              <div>2. Import objednavky vytvori ZAK + line + VP.</div>
              <div>3. System podle GPN najde TP a vytvori operace.</div>
              <div>4. Planner je naplanuje na stroje podle kapacity.</div>
            </div>

            <button onClick={saveTemplate} disabled={saving} style={buttonPrimaryStyle()}>
              {saving ? "Ukladam..." : "Ulozit TP sablonu"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
