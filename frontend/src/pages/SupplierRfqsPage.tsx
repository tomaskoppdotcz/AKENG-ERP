import React, { useCallback, useEffect, useMemo, useState } from "react";
import { FormField, FormGrid, FormSection, HighlightBox, formControlStyle, formTextareaStyle } from "../components/FormLayout";
import { UI } from "../styles/ui";
import TableRowActionsMenu from "../components/table/TableRowActionsMenu";
import {
  SUPPLIER_RFQ_CATEGORIES,
  SUPPLIER_RFQ_STATUSES,
  createSupplierRfq,
  createSupplierRfqItem,
  deleteSupplierRfqItem,
  getSupplierRfq,
  getSupplierRfqLinkOptions,
  getSupplierRfqOperationOptions,
  listSupplierRfqs,
  listApprovedSuppliersForRfqs,
  updateSupplierRfq,
  updateSupplierRfqItem,
  type ApprovedSupplierOption,
  type SupplierRfq,
  type SupplierRfqCategory,
  type SupplierRfqDetail,
  type SupplierRfqItem,
  type SupplierRfqItemPayload,
  type SupplierRfqLinkOptions,
  type SupplierRfqOperationOption,
  type SupplierRfqPayload,
  type SupplierRfqStatus,
} from "../services/supplierRfqsApi";
import { createSupplierPurchaseOrderFromRfq } from "../services/supplierPurchaseOrdersApi";

const categoryLabel: Record<SupplierRfqCategory, string> = {
  cooperation: "Kooperace",
  tools: "Nástroje",
  oils: "Oleje",
  material: "Materiál",
  services: "Služby",
  other: "Ostatní",
};

const statusLabel: Record<SupplierRfqStatus, string> = {
  draft: "Rozpracováno",
  sent: "Odesláno",
  quoted: "Nabídnuto",
  ordered: "Objednáno",
  cancelled: "Zrušeno",
};

const statusColors: Record<SupplierRfqStatus, { fg: string; bg: string; border: string }> = {
  draft: { fg: "#475569", bg: "#F1F5F9", border: "#CBD5E1" },
  sent: { fg: "#2563EB", bg: "#DBEAFE", border: "#93C5FD" },
  quoted: { fg: "#B45309", bg: "#FEF3C7", border: "#FCD34D" },
  ordered: { fg: "#15803D", bg: "#DCFCE7", border: "#86EFAC" },
  cancelled: { fg: "#B91C1C", bg: "#FEE2E2", border: "#FCA5A5" },
};

const emptyHeader: SupplierRfqPayload = {
  supplier_id: null,
  supplier_name: "",
  category: "cooperation",
  status: "draft",
  title: "",
  description: "",
  customer_order_id: null,
  job_item_id: null,
  production_order_id: null,
  planning_operation_id: null,
  production_order_operation_id: null,
  requested_date: "",
  due_date: "",
  note: "",
};

const emptyItem: SupplierRfqItemPayload = {
  item_name: "",
  description: "",
  qty: 1,
  unit: "ks",
  target_price: null,
  offered_price: null,
  currency: "CZK",
  supplier_lead_time_days: null,
  note: "",
};

const emptyLinkOptions: SupplierRfqLinkOptions = {
  customer_orders: [],
  job_items: [],
  production_orders: [],
};

const PAGE_SIZE_OPTIONS = [25, 50, 100] as const;

function normalizeSearchText(value: string | null | undefined): string {
  return (value ?? "")
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function joinSearchParts(...parts: Array<string | number | null | undefined>): string {
  return normalizeSearchText(parts.filter((p) => p != null && p !== "").join(" "));
}

function toNullableNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const n = Number(trimmed.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "nezadáno";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("cs-CZ");
}

function formatMoney(value: number | null | undefined, currency = "CZK"): string {
  if (value == null || Number.isNaN(value)) return "nezadáno";
  return value.toLocaleString("cs-CZ", { style: "currency", currency, maximumFractionDigits: 2 });
}

function formatLink(row: Pick<SupplierRfq, "relation_label" | "customer_order_id" | "job_item_id" | "production_order_id">): string {
  if (row.relation_label) return row.relation_label;
  const parts = [
    row.customer_order_id ? `Zakázka #${row.customer_order_id}` : "",
    row.job_item_id ? `Položka #${row.job_item_id}` : "",
    row.production_order_id ? `VP #${row.production_order_id}` : "",
  ].filter(Boolean);
  return parts.length ? parts.join(" / ") : "bez vazby";
}

function operationValue(value: SupplierRfqPayload): string {
  if (value.planning_operation_id) return `planning:${value.planning_operation_id}`;
  if (value.production_order_operation_id) return `production:${value.production_order_operation_id}`;
  return "";
}

function statusChip(status: SupplierRfqStatus) {
  const c = statusColors[status];
  return (
    <span
      style={{
        ...UI.statusBadgeBase,
        color: c.fg,
        background: c.bg,
        borderColor: c.border,
        boxShadow: "none",
      }}
    >
      {statusLabel[status] ?? status}
    </span>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "block" }}>
      <div style={UI.inputs.label}>{label}</div>
      {children}
    </label>
  );
}

function HeaderForm({
  value,
  onChange,
  suppliers,
  linkOptions,
  operationOptions,
  disabled,
}: {
  value: SupplierRfqPayload;
  onChange: (next: SupplierRfqPayload) => void;
  suppliers: ApprovedSupplierOption[];
  linkOptions: SupplierRfqLinkOptions;
  operationOptions: SupplierRfqOperationOption[];
  disabled?: boolean;
}) {
  const patch = (next: Partial<SupplierRfqPayload>) => onChange({ ...value, ...next });
  const operationRecommended = value.category === "cooperation";
  const selectedSupplierExists = value.supplier_id != null && suppliers.some((s) => s.id === value.supplier_id);
  const filteredJobItems = linkOptions.job_items.filter(
    (i) => (value.customer_order_id != null && i.customer_order_id === value.customer_order_id) || i.id === value.job_item_id
  );
  const filteredProductionOrders = linkOptions.production_orders.filter(
    (po) => (value.job_item_id != null && po.job_item_id === value.job_item_id) || po.id === value.production_order_id
  );
  const operationSelect = (
    <select
      style={{
        ...formControlStyle,
        borderColor: operationRecommended ? "#F59E0B" : (formControlStyle as React.CSSProperties).borderColor,
        background: operationRecommended ? "#FFFBEB" : (formControlStyle as React.CSSProperties).background,
      }}
      value={operationValue(value)}
      disabled={disabled || !value.production_order_id}
      onChange={(e) => {
        const op = operationOptions.find((o) => {
          const key = o.planning_operation_id ? `planning:${o.planning_operation_id}` : `production:${o.production_order_operation_id}`;
          return key === e.target.value;
        });
        patch({
          planning_operation_id: op?.planning_operation_id ?? null,
          production_order_operation_id: op?.production_order_operation_id ?? null,
        });
      }}
    >
      <option value="">{value.production_order_id ? "Vyberte operaci" : "Nejprve vyberte VP"}</option>
      {operationOptions.map((op) => {
        const key = op.planning_operation_id ? `planning:${op.planning_operation_id}` : `production:${op.production_order_operation_id}`;
        return (
          <option key={`${op.source}:${key}`} value={key}>
            {op.label}
          </option>
        );
      })}
    </select>
  );
  return (
    <div style={{ display: "grid", gap: 18 }}>
      <FormSection title="Základní údaje">
        <FormGrid minColumnWidth={190} gap={18}>
      <FormField label="Název">
        <input
          style={formControlStyle}
          value={value.title}
          disabled={disabled}
          onChange={(e) => patch({ title: e.target.value })}
          placeholder="Např. Kooperace broušení"
        />
      </FormField>
      <FormField label="Kategorie">
        <select
          style={formControlStyle}
          value={value.category}
          disabled={disabled}
          onChange={(e) => patch({ category: e.target.value as SupplierRfqCategory })}
        >
          {SUPPLIER_RFQ_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {categoryLabel[c]}
            </option>
          ))}
        </select>
      </FormField>
      <FormField label="Stav">
        <select
          style={formControlStyle}
          value={value.status}
          disabled={disabled}
          onChange={(e) => patch({ status: e.target.value as SupplierRfqStatus })}
        >
          {SUPPLIER_RFQ_STATUSES.map((s) => (
            <option key={s} value={s}>
              {statusLabel[s]}
            </option>
          ))}
        </select>
      </FormField>
      <FormField label="Dodavatel">
        <select
          style={formControlStyle}
          value={value.supplier_id ?? ""}
          disabled={disabled}
          onChange={(e) => {
            const supplierId = toNullableNumber(e.target.value);
            const supplier = suppliers.find((s) => s.id === supplierId) ?? null;
            patch({ supplier_id: supplierId, supplier_name: supplier?.name ?? "" });
          }}
        >
          <option value="">{value.supplier_name ? `Původní: ${value.supplier_name}` : "Vyberte schváleného dodavatele"}</option>
          {value.supplier_id != null && !selectedSupplierExists ? (
            <option value={value.supplier_id}>{value.supplier_name || `Původní dodavatel #${value.supplier_id}`}</option>
          ) : null}
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} ({s.supplier_code})
            </option>
          ))}
        </select>
      </FormField>
      <FormField label="Požadováno dne">
        <input
          type="date"
          style={formControlStyle}
          value={value.requested_date ?? ""}
          disabled={disabled}
          onChange={(e) => patch({ requested_date: e.target.value })}
        />
      </FormField>
      <FormField label="Termín odpovědi">
        <input
          type="date"
          style={formControlStyle}
          value={value.due_date ?? ""}
          disabled={disabled}
          onChange={(e) => patch({ due_date: e.target.value })}
        />
      </FormField>
        </FormGrid>
      </FormSection>

      <FormSection title="Vazby">
        <FormGrid minColumnWidth={190} gap={18}>
      <FormField label="Zakázka">
        <select
          style={formControlStyle}
          value={value.customer_order_id ?? ""}
          disabled={disabled}
          onChange={(e) =>
            patch({
              customer_order_id: toNullableNumber(e.target.value),
              job_item_id: null,
              production_order_id: null,
              planning_operation_id: null,
              production_order_operation_id: null,
            })
          }
        >
          <option value="">Bez vazby</option>
          {linkOptions.customer_orders.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}{o.customer_name ? ` · ${o.customer_name}` : ""}
            </option>
          ))}
        </select>
      </FormField>
      <FormField label="Položka zakázky">
        <select
          style={formControlStyle}
          value={value.job_item_id ?? ""}
          disabled={disabled || !value.customer_order_id}
          onChange={(e) => {
            const jobItemId = toNullableNumber(e.target.value);
            const item = linkOptions.job_items.find((i) => i.id === jobItemId) ?? null;
            patch({
              job_item_id: jobItemId,
              customer_order_id: item?.customer_order_id ?? value.customer_order_id ?? null,
              production_order_id: null,
              planning_operation_id: null,
              production_order_operation_id: null,
            });
          }}
        >
          <option value="">{value.customer_order_id ? "Bez vazby" : "Nejprve vyberte zakázku"}</option>
          {filteredJobItems.map((i) => (
            <option key={i.id} value={i.id}>
              {i.label}
            </option>
          ))}
        </select>
      </FormField>
      <FormField label="VP">
        <select
          style={formControlStyle}
          value={value.production_order_id ?? ""}
          disabled={disabled || !value.job_item_id}
          onChange={(e) => {
            const productionOrderId = toNullableNumber(e.target.value);
            const po = linkOptions.production_orders.find((p) => p.id === productionOrderId) ?? null;
            patch({
              production_order_id: productionOrderId,
              job_item_id: po?.job_item_id ?? value.job_item_id ?? null,
              customer_order_id: po?.customer_order_id ?? value.customer_order_id ?? null,
              planning_operation_id: null,
              production_order_operation_id: null,
            });
          }}
        >
          <option value="">{value.job_item_id ? "Bez vazby" : "Nejprve vyberte položku"}</option>
          {filteredProductionOrders.map((po) => (
            <option key={po.id} value={po.id}>
              {po.label}
            </option>
          ))}
        </select>
      </FormField>
      {operationRecommended ? (
        <HighlightBox title="Kooperace">
          <FormGrid minColumnWidth={220} gap={18}>
            <FormField label="Operace" hint="U kooperace doporučeno vybrat konkrétní operaci." fullWidth>
              {operationSelect}
            </FormField>
          </FormGrid>
        </HighlightBox>
      ) : (
        <FormField label="Operace">{operationSelect}</FormField>
      )}
        </FormGrid>
      </FormSection>

      <FormSection title="Poznámky">
        <FormGrid minColumnWidth={220} gap={18}>
        <FormField label="Popis" fullWidth>
          <textarea
            style={formTextareaStyle}
            value={value.description ?? ""}
            disabled={disabled}
            onChange={(e) => patch({ description: e.target.value })}
          />
        </FormField>
        <FormField label="Poznámka" fullWidth>
          <textarea
            style={formTextareaStyle}
            value={value.note ?? ""}
            disabled={disabled}
            onChange={(e) => patch({ note: e.target.value })}
          />
        </FormField>
        </FormGrid>
      </FormSection>
    </div>
  );
}

function ItemForm({
  value,
  onChange,
  disabled,
}: {
  value: SupplierRfqItemPayload;
  onChange: (next: SupplierRfqItemPayload) => void;
  disabled?: boolean;
}) {
  const patch = (next: Partial<SupplierRfqItemPayload>) => onChange({ ...value, ...next });
  return (
    <FormSection title="Položka">
      <FormGrid minColumnWidth={150} gap={18}>
      <FormField label="Položka" fullWidth>
        <input
          style={formControlStyle}
          value={value.item_name}
          disabled={disabled}
          onChange={(e) => patch({ item_name: e.target.value })}
          placeholder="Název položky"
        />
      </FormField>
      <FormField label="Množství">
        <input
          style={formControlStyle}
          value={String(value.qty ?? "")}
          disabled={disabled}
          onChange={(e) => patch({ qty: Number(e.target.value.replace(",", ".")) || 0 })}
        />
      </FormField>
      <FormField label="Jednotka">
        <input
          style={formControlStyle}
          value={value.unit}
          disabled={disabled}
          onChange={(e) => patch({ unit: e.target.value })}
        />
      </FormField>
      <FormField label="Cílová cena">
        <input
          style={formControlStyle}
          value={value.target_price ?? ""}
          disabled={disabled}
          onChange={(e) => patch({ target_price: toNullableNumber(e.target.value) })}
        />
      </FormField>
      <FormField label="Nabídnutá cena">
        <input
          style={formControlStyle}
          value={value.offered_price ?? ""}
          disabled={disabled}
          onChange={(e) => patch({ offered_price: toNullableNumber(e.target.value) })}
        />
      </FormField>
      <FormField label="Měna">
        <input
          style={formControlStyle}
          value={value.currency ?? "CZK"}
          disabled={disabled}
          onChange={(e) => patch({ currency: e.target.value.toUpperCase().slice(0, 3) })}
        />
      </FormField>
      <FormField label="Dodací lhůta (dny)">
        <input
          style={formControlStyle}
          value={value.supplier_lead_time_days ?? ""}
          disabled={disabled}
          onChange={(e) => patch({ supplier_lead_time_days: toNullableNumber(e.target.value) })}
        />
      </FormField>
      <FormField label="Popis položky" fullWidth>
          <input
            style={formControlStyle}
            value={value.description ?? ""}
            disabled={disabled}
            onChange={(e) => patch({ description: e.target.value })}
          />
      </FormField>
      <FormField label="Poznámka k položce" fullWidth>
          <textarea
            style={formTextareaStyle}
            value={value.note ?? ""}
            disabled={disabled}
            onChange={(e) => patch({ note: e.target.value })}
          />
      </FormField>
      </FormGrid>
    </FormSection>
  );
}

function headerFromDetail(rfq: SupplierRfqDetail): SupplierRfqPayload {
  return {
    supplier_id: rfq.supplier_id,
    supplier_name: rfq.supplier_name ?? "",
    category: rfq.category,
    status: rfq.status,
    title: rfq.title,
    description: rfq.description ?? "",
    customer_order_id: rfq.customer_order_id,
    job_item_id: rfq.job_item_id,
    production_order_id: rfq.production_order_id,
    planning_operation_id: rfq.planning_operation_id,
    production_order_operation_id: rfq.production_order_operation_id,
    requested_date: rfq.requested_date ?? "",
    due_date: rfq.due_date ?? "",
    note: rfq.note ?? "",
  };
}

function itemPayloadFromItem(item: SupplierRfqItem): SupplierRfqItemPayload {
  return {
    item_name: item.item_name,
    description: item.description ?? "",
    qty: item.qty,
    unit: item.unit,
    target_price: item.target_price,
    offered_price: item.offered_price,
    currency: item.currency || "CZK",
    supplier_lead_time_days: item.supplier_lead_time_days,
    note: item.note ?? "",
  };
}

export default function SupplierRfqsPage() {
  const [rows, setRows] = useState<SupplierRfq[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<SupplierRfqDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newHeader, setNewHeader] = useState<SupplierRfqPayload>(emptyHeader);
  const [newItem, setNewItem] = useState<SupplierRfqItemPayload>(emptyItem);
  const [editHeader, setEditHeader] = useState<SupplierRfqPayload>(emptyHeader);
  const [itemForm, setItemForm] = useState<SupplierRfqItemPayload>(emptyItem);
  const [editingItemId, setEditingItemId] = useState<number | null>(null);
  const [hoverRfqRowId, setHoverRfqRowId] = useState<number | null>(null);
  const [rfqListMenuOpenId, setRfqListMenuOpenId] = useState<number | null>(null);
  const [suppliers, setSuppliers] = useState<ApprovedSupplierOption[]>([]);
  const [linkOptions, setLinkOptions] = useState<SupplierRfqLinkOptions>(emptyLinkOptions);
  const [newOperationOptions, setNewOperationOptions] = useState<SupplierRfqOperationOption[]>([]);
  const [editOperationOptions, setEditOperationOptions] = useState<SupplierRfqOperationOption[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | SupplierRfqStatus>("all");
  const [categoryFilter, setCategoryFilter] = useState<"all" | SupplierRfqCategory>("all");
  const [supplierFilter, setSupplierFilter] = useState("all");
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZE_OPTIONS)[number]>(25);
  const [page, setPage] = useState(1);
  const [itemSearchById, setItemSearchById] = useState<Record<number, string>>({});

  const loadRows = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const items = await listSupplierRfqs();
      setRows(items);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Načtení se nepodařilo.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDetail = useCallback(async (id: number) => {
    setDetailLoading(true);
    setError(null);
    try {
      const next = await getSupplierRfq(id);
      setDetail(next);
      setEditHeader(headerFromDetail(next));
      setSelectedId(id);
      setItemSearchById((prev) => ({
        ...prev,
        [next.id]: joinSearchParts(...next.items.map((item) => item.item_name)),
      }));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Detail se nepodařilo načíst.");
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  useEffect(() => {
    let cancelled = false;
    async function loadSelectors() {
      try {
        const [supplierRows, links] = await Promise.all([listApprovedSuppliersForRfqs(), getSupplierRfqLinkOptions()]);
        if (!cancelled) {
          setSuppliers(supplierRows);
          setLinkOptions(links);
        }
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Číselníky pro poptávky se nepodařilo načíst.");
      }
    }
    void loadSelectors();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadOps() {
      if (!newHeader.production_order_id) {
        setNewOperationOptions([]);
        return;
      }
      const ops = await getSupplierRfqOperationOptions(newHeader.production_order_id);
      if (!cancelled) setNewOperationOptions(ops);
    }
    void loadOps().catch((e: unknown) => {
      if (!cancelled) setError(e instanceof Error ? e.message : "Operace VP se nepodařilo načíst.");
    });
    return () => {
      cancelled = true;
    };
  }, [newHeader.production_order_id]);

  useEffect(() => {
    let cancelled = false;
    async function loadOps() {
      if (!editHeader.production_order_id) {
        setEditOperationOptions([]);
        return;
      }
      const ops = await getSupplierRfqOperationOptions(editHeader.production_order_id);
      if (!cancelled) setEditOperationOptions(ops);
    }
    void loadOps().catch((e: unknown) => {
      if (!cancelled) setError(e instanceof Error ? e.message : "Operace VP se nepodařilo načíst.");
    });
    return () => {
      cancelled = true;
    };
  }, [editHeader.production_order_id]);

  const selectedRow = useMemo(() => rows.find((r) => r.id === selectedId) ?? null, [rows, selectedId]);
  const normalizedSearch = useMemo(() => normalizeSearchText(search), [search]);

  useEffect(() => {
    setPage(1);
  }, [search, statusFilter, categoryFilter, supplierFilter, pageSize]);

  useEffect(() => {
    if (!normalizedSearch) return;
    const missingRows = rows.filter((row) => row.items_count > 0 && itemSearchById[row.id] == null);
    if (missingRows.length === 0) return;

    let cancelled = false;
    async function loadItemSearchText() {
      const entries = await Promise.all(
        missingRows.map(async (row) => {
          try {
            const next = await getSupplierRfq(row.id);
            return [row.id, joinSearchParts(...next.items.map((item) => item.item_name))] as const;
          } catch {
            return [row.id, ""] as const;
          }
        })
      );
      if (!cancelled) {
        setItemSearchById((prev) => {
          const copy = { ...prev };
          for (const [id, text] of entries) copy[id] = text;
          return copy;
        });
      }
    }

    void loadItemSearchText();
    return () => {
      cancelled = true;
    };
  }, [itemSearchById, normalizedSearch, rows]);

  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      if (statusFilter !== "all" && row.status !== statusFilter) return false;
      if (categoryFilter !== "all" && row.category !== categoryFilter) return false;
      if (supplierFilter !== "all" && String(row.supplier_id ?? "") !== supplierFilter) return false;
      if (!normalizedSearch) return true;

      const haystack = joinSearchParts(
        row.rfq_no,
        row.title,
        row.supplier_name,
        row.category,
        categoryLabel[row.category],
        row.status,
        statusLabel[row.status],
        formatLink(row),
        itemSearchById[row.id]
      );
      return haystack.includes(normalizedSearch);
    });
  }, [categoryFilter, itemSearchById, normalizedSearch, rows, statusFilter, supplierFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const paginatedRows = useMemo(() => {
    const startIndex = (page - 1) * pageSize;
    return filteredRows.slice(startIndex, startIndex + pageSize);
  }, [filteredRows, page, pageSize]);
  const rangeStart = filteredRows.length === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = Math.min(page * pageSize, filteredRows.length);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  function closeDetail() {
    setSelectedId(null);
    setDetail(null);
    setEditingItemId(null);
    setItemForm(emptyItem);
  }

  function handleRowSelect(row: SupplierRfq) {
    if (row.id === selectedId) {
      closeDetail();
      return;
    }
    void loadDetail(row.id);
  }

  async function refreshAfterDetailSave(next: SupplierRfqDetail, message: string) {
    setDetail(next);
    setEditHeader(headerFromDetail(next));
    setSelectedId(next.id);
    setItemSearchById((prev) => ({
      ...prev,
      [next.id]: joinSearchParts(...next.items.map((item) => item.item_name)),
    }));
    setSuccess(message);
    await loadRows();
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const created = await createSupplierRfq(newHeader);
      const hasItem = newItem.item_name.trim().length > 0;
      const withItem = hasItem ? await createSupplierRfqItem(created.id, newItem) : created;
      setNewHeader(emptyHeader);
      setNewItem(emptyItem);
      setShowCreate(false);
      await refreshAfterDetailSave(withItem, hasItem ? "Poptávka a první položka vytvořeny." : "Poptávka vytvořena.");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Vytvoření se nepodařilo.");
    } finally {
      setSaving(false);
    }
  }

  async function handleHeaderSave(e: React.FormEvent) {
    e.preventDefault();
    if (!detail) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const next = await updateSupplierRfq(detail.id, editHeader);
      await refreshAfterDetailSave(next, "Poptávka uložena.");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Uložení se nepodařilo.");
    } finally {
      setSaving(false);
    }
  }

  async function handleStatus(status: SupplierRfqStatus) {
    if (!detail) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const next = await updateSupplierRfq(detail.id, { ...editHeader, status });
      await refreshAfterDetailSave(next, "Stav poptávky změněn.");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Změna stavu se nepodařila.");
    } finally {
      setSaving(false);
    }
  }

  async function handleCreatePurchaseOrder() {
    if (!detail) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const created = await createSupplierPurchaseOrderFromRfq(detail.id);
      setSuccess(`Objednávka ${created.po_no} byla vytvořena.`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Objednávku se nepodařilo vytvořit.");
    } finally {
      setSaving(false);
    }
  }

  async function handleItemSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!detail) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const next =
        editingItemId == null
          ? await createSupplierRfqItem(detail.id, itemForm)
          : await updateSupplierRfqItem(detail.id, editingItemId, itemForm);
      setItemForm(emptyItem);
      setEditingItemId(null);
      await refreshAfterDetailSave(next, editingItemId == null ? "Položka přidána." : "Položka uložena.");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Položku se nepodařilo uložit.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteItem(itemId: number) {
    if (!detail) return;
    const ok = window.confirm("Smazat položku poptávky?");
    if (!ok) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const next = await deleteSupplierRfqItem(detail.id, itemId);
      await refreshAfterDetailSave(next, "Položka smazána.");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Smazání položky se nepodařilo.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="erp-overview-page" style={UI.container}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div>
          <div style={UI.sectionTitle}>Poptávky</div>
          <div style={UI.sectionSubtitle}>Odchozí poptávky dodavatelům pro kooperace, nástroje, oleje, materiál a služby.</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" style={UI.buttons.secondary} onClick={() => void loadRows()} disabled={loading || saving}>
            Obnovit
          </button>
          <button type="button" style={UI.buttons.primary} onClick={() => setShowCreate((v) => !v)} disabled={saving}>
            Nová poptávka
          </button>
        </div>
      </div>

      {error ? <div style={{ ...UI.overviewStateError, marginTop: 16 }}>{error}</div> : null}
      {success ? (
        <div style={{ marginTop: 16, padding: 12, borderRadius: 10, color: "#166534", background: "#DCFCE7", fontWeight: 800 }}>
          {success}
        </div>
      ) : null}

      {showCreate ? (
        <form onSubmit={handleCreate} style={{ ...UI.card, marginTop: 18, borderRadius: 14 }}>
          <div style={{ ...UI.sectionTitle, fontSize: 18 }}>Nová poptávka</div>
          <HeaderForm
            value={newHeader}
            onChange={setNewHeader}
            suppliers={suppliers}
            linkOptions={linkOptions}
            operationOptions={newOperationOptions}
            disabled={saving}
          />
          <div style={{ marginTop: 18, paddingTop: 16, borderTop: "1px solid #E2E8F0" }}>
            <div style={{ fontWeight: 900, marginBottom: 10 }}>První položka (volitelné)</div>
            <ItemForm value={newItem} onChange={setNewItem} disabled={saving} />
          </div>
          <div style={{ display: "flex", justifyContent: "flex-start", gap: 8, marginTop: 16 }}>
            <button type="submit" style={UI.buttons.primary} disabled={saving || !newHeader.title.trim() || !newHeader.supplier_id}>
              Vytvořit poptávku
            </button>
            <button type="button" style={UI.buttons.secondary} onClick={() => setShowCreate(false)} disabled={saving}>
              Zrušit
            </button>
          </div>
        </form>
      ) : null}

      <div style={{ display: "grid", gridTemplateColumns: detail || selectedRow ? "minmax(0, 1.15fr) minmax(420px, 0.85fr)" : "1fr", gap: 18, marginTop: 18 }}>
        <div style={{ ...UI.overviewMainCard }}>
          <div style={UI.overviewCardHeaderBand}>
            <div style={{ display: "grid", gridTemplateColumns: "minmax(240px, 2fr) repeat(3, minmax(150px, 1fr))", gap: 12 }}>
              <Field label="Hledat">
                <input
                  className="erp-overview-search"
                  style={UI.inputs.overviewSearch}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="RFQ, název, dodavatel, kategorie, stav, vazba, položka..."
                />
              </Field>
              <Field label="Stav">
                <select style={UI.inputs.base} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as "all" | SupplierRfqStatus)}>
                  <option value="all">Všechny stavy</option>
                  {SUPPLIER_RFQ_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {statusLabel[s]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Kategorie">
                <select style={UI.inputs.base} value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value as "all" | SupplierRfqCategory)}>
                  <option value="all">Všechny kategorie</option>
                  {SUPPLIER_RFQ_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {categoryLabel[c]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Dodavatel">
                <select style={UI.inputs.base} value={supplierFilter} onChange={(e) => setSupplierFilter(e.target.value)}>
                  <option value="all">Všichni dodavatelé</option>
                  {suppliers.map((supplier) => (
                    <option key={supplier.id} value={supplier.id}>
                      {supplier.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          </div>
          {loading ? (
            <div style={UI.overviewStateLoading}>Načítám poptávky...</div>
          ) : rows.length === 0 ? (
            <div style={UI.overviewEmptyInCard}>Zatím nejsou založené žádné odchozí poptávky dodavatelům.</div>
          ) : filteredRows.length === 0 ? (
            <div style={UI.overviewEmptyInCard}>Žádné poptávky neodpovídají hledání nebo filtrům.</div>
          ) : (
            <div className="erp-table-wrap" style={UI.overviewTableWrap}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={UI.overviewTableHeadRow}>
                    <th style={UI.th}>RFQ číslo</th>
                    <th style={UI.th}>Název</th>
                    <th style={UI.th}>Kategorie</th>
                    <th style={UI.th}>Dodavatel</th>
                    <th style={UI.th}>Stav</th>
                    <th style={UI.th}>Zakázka / Položka / VP / Operace</th>
                    <th style={UI.th}>Termín odpovědi</th>
                    <th style={UI.th}>Celková nabídková cena</th>
                    <th style={UI.th}>Akce</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedRows.map((row) => {
                    const selected = row.id === selectedId;
                    const rowHot = selected || hoverRfqRowId === row.id || rfqListMenuOpenId === row.id;
                    return (
                    <tr
                      key={row.id}
                      style={{
                        background: rowHot ? "#EFF6FF" : undefined,
                        boxShadow: selected || rfqListMenuOpenId === row.id ? "inset 4px 0 0 #1D4ED8" : undefined,
                        cursor: "pointer",
                      }}
                      onClick={() => handleRowSelect(row)}
                      onMouseEnter={() => setHoverRfqRowId(row.id)}
                      onMouseLeave={() => setHoverRfqRowId((id) => (id === row.id ? null : id))}
                    >
                      <td style={{ ...UI.td, fontWeight: 900, color: "#1D4ED8", whiteSpace: "nowrap" }}>{row.rfq_no}</td>
                      <td style={{ ...UI.td, fontWeight: 800 }}>{row.title}</td>
                      <td style={UI.td}>{categoryLabel[row.category] ?? row.category}</td>
                      <td style={UI.td}>{row.supplier_name || "nezadáno"}</td>
                      <td style={UI.td}>{statusChip(row.status)}</td>
                      <td style={UI.td}>{formatLink(row)}</td>
                      <td style={{ ...UI.td, whiteSpace: "nowrap" }}>{formatDate(row.due_date)}</td>
                      <td style={{ ...UI.td, whiteSpace: "nowrap", fontWeight: 800 }}>{formatMoney(row.total_offered_price)}</td>
                      <td style={{ ...UI.td, textAlign: "right", whiteSpace: "nowrap" }} onClick={(e) => e.stopPropagation()}>
                        <TableRowActionsMenu
                          compact
                          align="end"
                          triggerLabel={`Akce — ${row.rfq_no}`}
                          onOpenChange={(open) => {
                            setRfqListMenuOpenId(open ? row.id : null);
                            if (open && row.id !== selectedId) void loadDetail(row.id);
                          }}
                          actions={[
                            {
                              key: "detail",
                              label: selected ? "Zavřít detail" : "Otevřít detail",
                              onClick: () => handleRowSelect(row),
                            },
                          ]}
                        />
                      </td>
                    </tr>
                  );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {!loading && rows.length > 0 ? (
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 12,
                flexWrap: "wrap",
                padding: "12px 18px",
                borderTop: "1px solid #E2E8F0",
                background: "#FFFFFF",
              }}
            >
              <label style={{ display: "flex", alignItems: "center", gap: 8, color: "#475569", fontSize: 13, fontWeight: 800 }}>
                Na stránku
                <select
                  style={{ ...UI.inputs.base, width: 92, padding: "7px 10px" }}
                  value={pageSize}
                  onChange={(e) => setPageSize(Number(e.target.value) as (typeof PAGE_SIZE_OPTIONS)[number])}
                >
                  {PAGE_SIZE_OPTIONS.map((size) => (
                    <option key={size} value={size}>
                      {size}
                    </option>
                  ))}
                </select>
              </label>
              <div style={{ color: "#475569", fontSize: 13, fontWeight: 800 }}>
                {rangeStart}–{rangeEnd} z {filteredRows.length}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button type="button" style={UI.buttons.secondary} disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                  Předchozí
                </button>
                <button type="button" style={UI.buttons.secondary} disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
                  Další
                </button>
              </div>
            </div>
          ) : null}
        </div>

        {detail || selectedRow ? (
          <div style={{ ...UI.card, borderRadius: 14, alignSelf: "start" }}>
            {detailLoading ? (
              <div style={UI.sectionSubtitle}>Načítám detail...</div>
            ) : detail ? (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
                  <div>
                    <div style={{ fontSize: 18, fontWeight: 900 }}>{detail.rfq_no}</div>
                    <div style={UI.sectionSubtitle}>{detail.title}</div>
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
                    {statusChip(detail.status)}
                    <button type="button" style={{ ...UI.buttons.secondary, padding: "7px 10px" }} onClick={closeDetail} disabled={saving}>
                      Zavřít detail
                    </button>
                  </div>
                </div>

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
                  <button
                    type="button"
                    style={UI.buttons.primary}
                    disabled={saving}
                    onClick={() => void handleCreatePurchaseOrder()}
                  >
                    Vytvořit objednávku
                  </button>
                  {SUPPLIER_RFQ_STATUSES.map((s) => (
                    <button
                      key={s}
                      type="button"
                      style={{
                        ...UI.buttons.secondary,
                        padding: "7px 10px",
                        borderColor: detail.status === s ? "#2563EB" : "#E2E8F0",
                        color: detail.status === s ? "#1D4ED8" : "#0F172A",
                      }}
                      disabled={saving}
                      onClick={() => void handleStatus(s)}
                    >
                      {statusLabel[s]}
                    </button>
                  ))}
                </div>

                <form onSubmit={handleHeaderSave} style={{ marginTop: 18 }}>
                  <HeaderForm
                    value={editHeader}
                    onChange={setEditHeader}
                    suppliers={suppliers}
                    linkOptions={linkOptions}
                    operationOptions={editOperationOptions}
                    disabled={saving}
                  />
                  <div style={{ display: "flex", justifyContent: "flex-start", marginTop: 12 }}>
                    <button type="submit" style={UI.buttons.primary} disabled={saving || !editHeader.title.trim()}>
                      Uložit hlavičku
                    </button>
                  </div>
                </form>

                <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid #E2E8F0" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
                    <div style={{ fontSize: 16, fontWeight: 900 }}>Položky</div>
                    <div style={{ fontWeight: 900 }}>{formatMoney(detail.total_offered_price)}</div>
                  </div>
                  <div style={{ overflowX: "auto", marginTop: 10 }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                      <thead>
                        <tr style={UI.overviewTableHeadRow}>
                          <th style={UI.th}>Položka</th>
                          <th style={UI.th}>Množství</th>
                          <th style={UI.th}>Cíl</th>
                          <th style={UI.th}>Nabídka</th>
                          <th style={UI.th}>Akce</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.items.length === 0 ? (
                          <tr>
                            <td style={UI.td} colSpan={5}>
                              Zatím bez položek.
                            </td>
                          </tr>
                        ) : (
                          detail.items.map((item) => (
                            <tr key={item.id}>
                              <td style={{ ...UI.td, fontWeight: 800 }}>
                                {item.item_name}
                                {item.note ? <div style={{ color: "#64748B", fontWeight: 600 }}>{item.note}</div> : null}
                              </td>
                              <td style={UI.td}>
                                {item.qty.toLocaleString("cs-CZ")} {item.unit}
                              </td>
                              <td style={UI.td}>{formatMoney(item.target_price, item.currency)}</td>
                              <td style={UI.td}>{formatMoney(item.offered_price, item.currency)}</td>
                              <td style={{ ...UI.td, textAlign: "right", whiteSpace: "nowrap" }}>
                                <TableRowActionsMenu
                                  compact
                                  align="end"
                                  triggerLabel={`Akce položky — ${item.item_name}`}
                                  actions={[
                                    {
                                      key: "edit",
                                      label: "Upravit",
                                      onClick: () => {
                                        setEditingItemId(item.id);
                                        setItemForm(itemPayloadFromItem(item));
                                      },
                                    },
                                    {
                                      key: "delete",
                                      label: "Smazat",
                                      danger: true,
                                      onClick: () => void handleDeleteItem(item.id),
                                    },
                                  ]}
                                />
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>

                  <form onSubmit={handleItemSubmit} style={{ marginTop: 16 }}>
                    <div style={{ fontWeight: 900, marginBottom: 10 }}>
                      {editingItemId == null ? "Přidat položku" : "Upravit položku"}
                    </div>
                    <ItemForm value={itemForm} onChange={setItemForm} disabled={saving} />
                    <div style={{ display: "flex", justifyContent: "flex-start", gap: 8, marginTop: 12 }}>
                      <button type="submit" style={UI.buttons.primary} disabled={saving || !itemForm.item_name.trim()}>
                        {editingItemId == null ? "Přidat položku" : "Uložit položku"}
                      </button>
                      {editingItemId != null ? (
                        <button
                          type="button"
                          style={UI.buttons.secondary}
                          disabled={saving}
                          onClick={() => {
                            setEditingItemId(null);
                            setItemForm(emptyItem);
                          }}
                        >
                          Zrušit úpravu
                        </button>
                      ) : null}
                    </div>
                  </form>
                </div>
              </>
            ) : (
              <div style={UI.sectionSubtitle}>Vyberte poptávku v seznamu.</div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
