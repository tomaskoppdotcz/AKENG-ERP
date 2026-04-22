import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DetailPageHeader from "../components/DetailPageHeader";
import SimpleModal from "../components/SimpleModal";
import {
  erpDetailIdentLabel,
  erpDetailIdentValue,
  erpDetailRowLabel,
  erpDetailRowValue,
  erpDetailSectionEyebrow,
  erpDetailStateCard,
  UI,
} from "../styles/ui";
import { getCustomers, type CustomerListItem } from "../services/masterLibrariesApi";
import {
  getPortfolioItems,
  portfolioVariantOptionText,
  sortPortfolioVariantsByLogisticMode,
  type PortfolioItem,
} from "../services/portfolioApi";
import {
  createProductionOrdersFromAllocation,
  createJobItem,
  getAllocationPreview,
  stornoCustomerOrder,
  stornoJobItem,
  getJobs,
  getOrderDetail,
  updateCustomerOrder,
  updateJobItem,
  type AllocationPreviewResponse,
  type OrderDetailItem,
  type OrderDetailResponse,
  type RestockConflictStrategy,
} from "../services/ordersApi";
import { buildSearchHaystack, matchesSearchQuery } from "../overview/overviewSearch";
import type { TableColumnDef } from "../overview/tableLayoutMerge";
import { usePersistedTableLayout } from "../hooks/usePersistedTableLayout";
import OverviewSloupceButton from "../components/overview/OverviewSloupceButton";
import TableLayoutModal from "../components/overview/TableLayoutModal";
import { buildErpUrl } from "../utils/erpDeepLink";
import { canPerformAction, hasPermission, readStoredErpRole } from "../auth/rbac";
import InlineBanner from "../components/InlineBanner";
import { interpretError, runWriteAction, type WriteFeedback } from "../utils/writeActionFeedback";

const ORDER_CARD_ITEMS_DEFAULTS: readonly TableColumnDef[] = [
  { key: "line_no", label: "Řádek", defaultWidth: 70 },
  { key: "gpn", label: "GPN", defaultWidth: 120 },
  { key: "name", label: "Název", defaultWidth: 180 },
  { key: "drawing_number", label: "Výkres", defaultWidth: 130, defaultVisible: false },
  { key: "drawing_revision", label: "Revize", defaultWidth: 90, defaultVisible: false },
  { key: "qty", label: "Množství", defaultWidth: 100 },
  { key: "sale_price", label: "Prodejní cena / ks", defaultWidth: 150 },
  { key: "due", label: "Termín", defaultWidth: 110 },
  { key: "vp", label: "Výrobní příkazy", defaultWidth: 180 },
  { key: "reported", label: "Vykázaný čas", defaultWidth: 120 },
  { key: "completion", label: "Hotovo", defaultWidth: 90 },
  { key: "labor", label: "Náklad práce", defaultWidth: 120 },
  { key: "performance", label: "Výkonnost", defaultWidth: 100 },
  { key: "actions", label: "Akce", defaultWidth: 160 },
] as const;

const ORDER_CARD_ITEMS_COL_LABELS: Record<string, string> = Object.fromEntries(
  ORDER_CARD_ITEMS_DEFAULTS.map((c) => [c.key, c.label])
);

type Props = {
  customerOrderId: number;
  onBack: () => void;
  onOpenItemDetail: (jobItemId: number, source: "orders") => void;
  /** Po smazání celé zakázky — např. zavřít kartu a obnovit přehled. */
  onOrderDeleted?: () => void;
  /** Titulek záložky po načtení detailu (číslo zakázky z API). */
  onWorkspaceTabTitle?: (title: string) => void;
  /** Otevření detailu výrobního příkazu (pracovní záložka). */
  onOpenProductionOrderDetail?: (productionOrderId: number, vpCode?: string) => void;
  /** Otevření detailu portfolio položky (pracovní záložka). */
  onOpenPortfolioById?: (portfolioItemId: number) => void;
};

type OrderSubtab =
  | "Přehled"
  | "Dokumenty"
  | "Historie"
  | "Výkazy"
  | "Neshody"
  | "Zmetky"
  | "Reklamace"
  | "Kooperace"
  | "Požadavky materiál"
  | "Poptávky"
  | "Objednávky"
  | "Dodací listy"
  | "Expedice"
  | "Náklady";

const ORDER_SUBTABS: OrderSubtab[] = [
  "Přehled",
  "Dokumenty",
  "Historie",
  "Výkazy",
  "Neshody",
  "Zmetky",
  "Reklamace",
  "Kooperace",
  "Požadavky materiál",
  "Poptávky",
  "Objednávky",
  "Dodací listy",
  "Expedice",
  "Náklady",
];

function formatMoneyKc(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return `${n.toLocaleString("cs-CZ", { maximumFractionDigits: 2 })} Kč/ks`;
}

function formatQty(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "0";
  return n.toLocaleString("cs-CZ", { maximumFractionDigits: 2 });
}

function formatCzk(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return `${new Intl.NumberFormat("cs-CZ", { maximumFractionDigits: 2, minimumFractionDigits: 0 }).format(value)}\u00a0Kč`;
}

function formatLineReportedMin(m: number | null | undefined): string {
  if (m == null || !Number.isFinite(Number(m))) return "—";
  return `${Math.round(Number(m))} min`;
}

function formatLinePct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  return `${Number(v)} %`;
}

function formatLineLabor(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  if (Number(v) === 0) return "0 Kč";
  try {
    return new Intl.NumberFormat("cs-CZ", {
      style: "currency",
      currency: "CZK",
      maximumFractionDigits: 0,
    }).format(Number(v));
  } catch {
    return `${Math.round(Number(v))} Kč`;
  }
}

function formatOrderReportedHours(min: number | null | undefined): string {
  if (min == null || !Number.isFinite(Number(min))) return "—";
  const h = Number(min) / 60;
  return `${h.toLocaleString("cs-CZ", { maximumFractionDigits: 1 })} h`;
}

function orderPhaseLabelCs(phase: string | null | undefined): string {
  const p = String(phase ?? "").trim().toLowerCase();
  if (p === "bezi") return "Běží";
  if (p === "hotovo") return "Hotovo";
  if (p === "planned") return "Plánováno";
  return "—";
}

function isBusinessWorkflowActive(status: string | null | undefined): boolean {
  const s = String(status ?? "").trim().toLowerCase();
  return !s || s === "active";
}

function relevantProductionOrders(item: OrderDetailItem, orderKind: string) {
  const rows = item.production_orders ?? [];
  if (orderKind === "internal") return rows;
  return rows.filter(
    (po) => po.source_type === "stock_allocation" || po.source_type === "order_allocation"
  );
}

function formatVpCodes(item: OrderDetailItem, orderKind: string): string {
  const codes = relevantProductionOrders(item, orderKind)
    .map((po) => po.vp_code?.trim())
    .filter((v): v is string => !!v);
  if (codes.length === 0) return "—";
  if (codes.length <= 2) return codes.join(", ");
  return `${codes[0]}, ${codes[1]} +${codes.length - 2}`;
}

export default function OrderCardPage({
  customerOrderId,
  onBack,
  onOpenItemDetail,
  onOrderDeleted,
  onWorkspaceTabTitle,
  onOpenProductionOrderDetail,
  onOpenPortfolioById,
}: Props) {
  const [data, setData] = useState<OrderDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionFeedback, setActionFeedback] = useState<WriteFeedback | null>(null);
  /** Po write akcích zespodu stránky posune výřez tak, aby byl inline banner vidět (main má `overflow: auto`). */
  const writeFeedbackAnchorRef = useRef<HTMLDivElement>(null);

  const [hoveredItemId, setHoveredItemId] = useState<number | null>(null);
  const [activeOrderSubtab, setActiveOrderSubtab] = useState<OrderSubtab>("Přehled");
  const [hoverOrderSubtab, setHoverOrderSubtab] = useState<OrderSubtab | null>(null);
  const [query, setQuery] = useState("");
  const [activeFilters, setActiveFilters] = useState<Array<"Po termínu" | "Dokončená" | "Dodací list" | "Fakturováno">>([]);
  const tb = usePersistedTableLayout("order_card_items", ORDER_CARD_ITEMS_DEFAULTS);
  const showDrawingNumber = tb.columns.find((c) => c.key === "drawing_number")?.visible === true;
  const showDrawingRevision = tb.columns.find((c) => c.key === "drawing_revision")?.visible === true;
  const [showAddItemForm, setShowAddItemForm] = useState(false);
  const [savingItem, setSavingItem] = useState(false);
  const [itemError, setItemError] = useState<string | null>(null);
  const [creatingVp, setCreatingVp] = useState(false);
  const [vpPreviewLoading, setVpPreviewLoading] = useState(false);
  const [vpError, setVpError] = useState<string | null>(null);
  const [restockModalOpen, setRestockModalOpen] = useState(false);
  const [restockPreviewSnapshot, setRestockPreviewSnapshot] = useState<AllocationPreviewResponse | null>(null);
  const [restockChoices, setRestockChoices] = useState<Record<number, RestockConflictStrategy>>({});
  const [portfolioItems, setPortfolioItems] = useState<PortfolioItem[]>([]);
  const [customers, setCustomers] = useState<CustomerListItem[]>([]);
  const [jobId, setJobId] = useState<number | null>(null);
  const [formGpn, setFormGpn] = useState("");
  const [formName, setFormName] = useState("");
  const [formQty, setFormQty] = useState("1");
  const [formDueDate, setFormDueDate] = useState("");
  const [gpnLookupDone, setGpnLookupDone] = useState(false);
  /** Pouze při více shodách GPN — vazba až po výběru uživatele. */
  const [userPickedPortfolioId, setUserPickedPortfolioId] = useState<number | null>(null);

  const [showEditHeader, setShowEditHeader] = useState(false);
  const [savingHeader, setSavingHeader] = useState(false);
  const [headerError, setHeaderError] = useState<string | null>(null);
  const [headerCustomerId, setHeaderCustomerId] = useState("");
  const [headerPoNo, setHeaderPoNo] = useState("");
  const [headerOrderDate, setHeaderOrderDate] = useState("");
  const [headerShipDate, setHeaderShipDate] = useState("");
  const [headerNote, setHeaderNote] = useState("");

  const [editingItemId, setEditingItemId] = useState<number | null>(null);
  const [editFormGpn, setEditFormGpn] = useState("");
  const [editFormName, setEditFormName] = useState("");
  const [editFormQty, setEditFormQty] = useState("1");
  const [editFormDue, setEditFormDue] = useState("");
  const [editGpnLookupDone, setEditGpnLookupDone] = useState(false);
  const [editUserPickedPortfolioId, setEditUserPickedPortfolioId] = useState<number | null>(null);
  const [savingEditItem, setSavingEditItem] = useState(false);
  const [editItemError, setEditItemError] = useState<string | null>(null);
  const editInitialGpnRef = useRef("");

  const erpRole = useMemo(() => readStoredErpRole(), []);
  const canOrdersWrite = canPerformAction(erpRole, "orders.write") && hasPermission("edit_orders");
  const canOrdersStorno = canPerformAction(erpRole, "orders.storno") && hasPermission("edit_orders");
  const canCreateProductionOrders = hasPermission("create_production_orders");

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent === true;
    if (!silent) {
      setLoading(true);
      setError(null);
    }
    try {
      const res = await getOrderDetail(customerOrderId);
      setData(res);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Nepodařilo se načíst zakázku.";
      if (silent) {
        setActionFeedback(interpretError(e, msg));
      } else {
        setError(msg);
        setData(null);
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, [customerOrderId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!actionFeedback) return;
    writeFeedbackAnchorRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [actionFeedback]);

  useEffect(() => {
    if (!onWorkspaceTabTitle || !data?.job) return;
    const z = data.job.zakazka?.trim();
    const co = data.customer_order?.id ?? data.job.customer_order_id ?? customerOrderId;
    onWorkspaceTabTitle(z ? `Zakázka ${z}` : `Zakázka ${co}`);
  }, [data, customerOrderId, onWorkspaceTabTitle]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getPortfolioItems(), getJobs(), getCustomers()])
      .then(([pRows, jobs, custRows]) => {
        if (cancelled) return;
        setPortfolioItems(pRows);
        setCustomers(custRows);
        const j = jobs.find((x) => x.customer_order_id === customerOrderId);
        setJobId(j?.id ?? null);
      })
      .catch(() => {
        if (!cancelled) {
          setPortfolioItems([]);
          setCustomers([]);
          setJobId(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [customerOrderId]);

  const portfolioGpnMatches = useMemo(() => {
    const g = formGpn.trim().toLowerCase();
    if (!g) return [];
    return sortPortfolioVariantsByLogisticMode(
      portfolioItems.filter((p) => p.gpn.trim().toLowerCase() === g)
    );
  }, [formGpn, portfolioItems]);

  useEffect(() => {
    if (!formGpn.trim()) {
      setGpnLookupDone(false);
      setUserPickedPortfolioId(null);
      setFormName("");
      return;
    }
    setGpnLookupDone(true);
  }, [formGpn]);

  useEffect(() => {
    if (!formGpn.trim()) return;
    if (portfolioGpnMatches.length === 1) {
      setUserPickedPortfolioId(null);
      setFormName(portfolioGpnMatches[0].name ?? "");
    } else if (portfolioGpnMatches.length > 1) {
      setUserPickedPortfolioId((prev) =>
        prev != null && portfolioGpnMatches.some((m) => m.id === prev) ? prev : null
      );
    } else {
      setUserPickedPortfolioId(null);
    }
  }, [formGpn, portfolioGpnMatches]);

  const editPortfolioGpnMatches = useMemo(() => {
    const g = editFormGpn.trim().toLowerCase();
    if (!g) return [];
    return sortPortfolioVariantsByLogisticMode(
      portfolioItems.filter((p) => p.gpn.trim().toLowerCase() === g)
    );
  }, [editFormGpn, portfolioItems]);

  useEffect(() => {
    if (editingItemId == null) return;
    if (!editFormGpn.trim()) {
      setEditGpnLookupDone(false);
      setEditUserPickedPortfolioId(null);
      setEditFormName("");
      return;
    }
    setEditGpnLookupDone(true);
  }, [editingItemId, editFormGpn]);

  useEffect(() => {
    if (editingItemId == null) return;
    if (!editFormGpn.trim()) return;
    const gpnNorm = editFormGpn.trim().toLowerCase();
    if (editPortfolioGpnMatches.length === 1) {
      setEditUserPickedPortfolioId(null);
      if (gpnNorm !== editInitialGpnRef.current) {
        setEditFormName(editPortfolioGpnMatches[0].name ?? "");
      }
    } else if (editPortfolioGpnMatches.length > 1) {
      setEditUserPickedPortfolioId((prev) =>
        prev != null && editPortfolioGpnMatches.some((m) => m.id === prev) ? prev : null
      );
    } else {
      setEditUserPickedPortfolioId(null);
    }
  }, [editingItemId, editFormGpn, editPortfolioGpnMatches]);

  function openHeaderEdit(d: OrderDetailResponse) {
    const co = d.customer_order;
    if (!co) return;
    setHeaderError(null);
    const cid = co.customer_id != null && Number(co.customer_id) > 0 ? String(co.customer_id) : "";
    setHeaderCustomerId(cid);
    setHeaderPoNo(co.objednavka ?? "");
    setHeaderOrderDate(co.datum ?? "");
    setHeaderShipDate(co.requested_ship_date ?? "");
    setHeaderNote(co.note ?? "");
    setShowEditHeader(true);
  }

  async function handleSaveHeader() {
    const customerId = Number(headerCustomerId);
    const poNo = headerPoNo.trim();
    if (!Number.isFinite(customerId) || customerId <= 0) {
      setHeaderError("Vyberte zákazníka.");
      return;
    }
    if (!poNo) {
      setHeaderError("Vyplňte číslo objednávky zákazníka.");
      return;
    }
    if (!headerOrderDate.trim()) {
      setHeaderError("Vyplňte datum objednávky.");
      return;
    }
    setSavingHeader(true);
    setHeaderError(null);
    try {
      await updateCustomerOrder(customerOrderId, {
        customer_id: customerId,
        customer_po_no: poNo,
        order_date: headerOrderDate,
        requested_ship_date: headerShipDate.trim() || null,
        note: headerNote.trim() || null,
      });
      setShowEditHeader(false);
      await load();
    } catch (e: unknown) {
      setHeaderError(e instanceof Error ? e.message : "Uložení se nezdařilo.");
    } finally {
      setSavingHeader(false);
    }
  }

  async function handleStornoOrder() {
    if (!window.confirm("Stornovat celou zakázku? Záznamy zůstanou v historii, aktivní rezervace materiálu se uvolní.")) return;
    setActionFeedback(null);
    const fb = await runWriteAction(
      () => stornoCustomerOrder(customerOrderId),
      {
        successMessage: "Zakázka byla stornována.",
        errorMessage: "Storno zakázky se nezdařilo.",
      },
    );
    if (fb.kind === "success") {
      setActionFeedback(fb);
      // Krátká pauza, aby uživatel viděl zelený banner před návratem na přehled.
      await new Promise((r) => setTimeout(r, 750));
      (onOrderDeleted ?? onBack)();
      return;
    }
    // info (např. „již stornováno"), warning, error → ukázat banner inline
    setActionFeedback(fb);
    if (fb.kind === "info") {
      // Idempotentní stav — data refreshneme, ať uživatel vidí aktuální stav.
      await load({ silent: true });
    }
  }

  async function handleCreateVp() {
    setVpPreviewLoading(true);
    setVpError(null);
    try {
      const preview = await getAllocationPreview(customerOrderId);
      if (preview.any_needs_user_choice) {
        const defaults: Record<number, RestockConflictStrategy> = {};
        for (const l of preview.lines) {
          if (!l.needs_user_choice) continue;
          const rec = l.recommended_fulfillment_strategy;
          defaults[l.job_item_id] = (rec ?? "stock_and_new_production") as RestockConflictStrategy;
        }
        setRestockPreviewSnapshot(preview);
        setRestockChoices(defaults);
        setRestockModalOpen(true);
        return;
      }
      setVpPreviewLoading(false);
      setCreatingVp(true);
      await createProductionOrdersFromAllocation(customerOrderId, []);
      await load();
    } catch (e: unknown) {
      setVpError(e instanceof Error ? e.message : "Nepodařilo se vytvořit výrobní příkazy.");
    } finally {
      setVpPreviewLoading(false);
      setCreatingVp(false);
    }
  }

  async function handleConfirmRestockModal() {
    const snap = restockPreviewSnapshot;
    if (snap == null) return;
    const conflicts = snap.lines.filter((l) => l.needs_user_choice);
    const missing = conflicts.filter((l) => restockChoices[l.job_item_id] == null);
    if (missing.length > 0) {
      setVpError("U každého konfliktního řádku zvolte jednu z možností.");
      return;
    }
    setVpError(null);
    setCreatingVp(true);
    try {
      const resolutions = conflicts.map((l) => ({
        job_item_id: l.job_item_id,
        strategy: restockChoices[l.job_item_id]!,
      }));
      await createProductionOrdersFromAllocation(customerOrderId, resolutions);
      setRestockModalOpen(false);
      setRestockPreviewSnapshot(null);
      setRestockChoices({});
      await load();
    } catch (e: unknown) {
      setVpError(e instanceof Error ? e.message : "Nepodařilo se vytvořit výrobní příkazy.");
    } finally {
      setCreatingVp(false);
    }
  }

  function openItemEdit(item: OrderDetailItem) {
    setEditItemError(null);
    setEditingItemId(item.job_item_id);
    editInitialGpnRef.current = item.gpn.trim().toLowerCase();
    setEditFormGpn(item.gpn);
    setEditFormName(item.description ?? "");
    setEditFormQty(String(item.qty));
    setEditFormDue(item.due_date ?? "");
    const matches = portfolioItems.filter((p) => p.gpn.trim().toLowerCase() === item.gpn.trim().toLowerCase());
    if (matches.length > 1) {
      setEditUserPickedPortfolioId(item.portfolio_item_id ?? null);
    } else {
      setEditUserPickedPortfolioId(null);
    }
    setEditGpnLookupDone(!!item.gpn.trim());
  }

  function cancelItemEdit() {
    setEditingItemId(null);
    setEditItemError(null);
    setEditUserPickedPortfolioId(null);
    setEditGpnLookupDone(false);
  }

  async function handleSaveEditItem() {
    if (editingItemId == null) return;
    const gpn = editFormGpn.trim();
    const name = editFormName.trim();
    const quantity = Number(editFormQty.replace(",", "."));
    if (!gpn) return setEditItemError("Vyplňte GPN / Výkres.");
    if (!name) return setEditItemError("Vyplňte název.");
    if (!Number.isFinite(quantity) || quantity <= 0) return setEditItemError("Množství musí být číslo větší než 0.");
    let portfolio_item_id: number | null = null;
    if (editPortfolioGpnMatches.length === 1) {
      portfolio_item_id = editPortfolioGpnMatches[0].id;
    } else if (editPortfolioGpnMatches.length > 1) {
      if (editUserPickedPortfolioId == null) {
        return setEditItemError("Více položek portfolia má stejné GPN — vyberte správnou variantu.");
      }
      portfolio_item_id = editUserPickedPortfolioId;
    }
    setSavingEditItem(true);
    setEditItemError(null);
    try {
      await updateJobItem(editingItemId, {
        gpn,
        name,
        quantity: Math.round(quantity),
        due_date: editFormDue.trim() || null,
        portfolio_item_id,
      });
      cancelItemEdit();
      await load();
    } catch (e: unknown) {
      setEditItemError(e instanceof Error ? e.message : "Uložení se nezdařilo.");
    } finally {
      setSavingEditItem(false);
    }
  }

  async function handleStornoItem(jobItemId: number) {
    if (!window.confirm("Zrušit tuto položku zakázky? (storno — historie zůstane)")) return;
    setActionFeedback(null);
    const fb = await runWriteAction(
      () => stornoJobItem(jobItemId),
      {
        successMessage: "Položka zakázky byla zrušena.",
        errorMessage: "Zrušení položky zakázky se nezdařilo.",
      },
    );
    setActionFeedback(fb);
    if (fb.kind === "success" || fb.kind === "info") {
      if (editingItemId === jobItemId) cancelItemEdit();
      await load({ silent: true });
    }
  }

  async function handleCreateItem() {
    if (jobId == null) {
      setItemError("Zakázka (job) nebyla nalezena.");
      return;
    }
    const gpn = formGpn.trim();
    const name = formName.trim();
    const quantity = Number(formQty.replace(",", "."));
    if (!gpn) return setItemError("Vyplňte GPN / Výkres.");
    if (!name) return setItemError("Vyplňte název.");
    if (!Number.isFinite(quantity) || quantity <= 0) return setItemError("Množství musí být číslo větší než 0.");
    let portfolio_item_id: number | null = null;
    if (portfolioGpnMatches.length === 1) {
      portfolio_item_id = portfolioGpnMatches[0].id;
    } else if (portfolioGpnMatches.length > 1) {
      if (userPickedPortfolioId == null) {
        return setItemError("Více položek portfolia má stejné GPN — vyberte správnou variantu.");
      }
      portfolio_item_id = userPickedPortfolioId;
    }
    setSavingItem(true);
    setItemError(null);
    try {
      await createJobItem({
        job_id: jobId,
        gpn,
        name,
        quantity: Math.round(quantity),
        due_date: formDueDate.trim() || null,
        portfolio_item_id,
      });
      setShowAddItemForm(false);
      setFormGpn("");
      setFormName("");
      setFormQty("1");
      setFormDueDate("");
      setUserPickedPortfolioId(null);
      setGpnLookupDone(false);
      await load();
    } catch (e: unknown) {
      setItemError(e instanceof Error ? e.message : "Nepodařilo se vytvořit položku.");
    } finally {
      setSavingItem(false);
    }
  }

  const items = data?.items ?? [];
  const orderKind = data?.customer_order?.order_type ?? "customer";

  const filteredItems = useMemo(() => {
    const zakazka = data?.job?.zakazka ?? "";
    return items.filter((item) => {
      const vpCodes = relevantProductionOrders(item, orderKind).map((po) => po.vp_code).filter(Boolean).join(" ");
      const haystack = buildSearchHaystack(
        zakazka,
        item.gpn,
        item.description,
        item.vp_code,
        vpCodes,
        item.drawing_number,
        item.drawing_revision,
        item.portfolio_item_name
      );
      const matchesQuery = matchesSearchQuery(query, haystack);

      const matchesFilters = activeFilters.every((f) => {
        if (f === "Po termínu") {
          if (!item.due_date) return false;
          return item.due_date < new Date().toISOString().slice(0, 10);
        }
        if (f === "Dokončená") return false;
        if (f === "Dodací list") return true;
        if (f === "Fakturováno") return true;
        return true;
      });

      return matchesQuery && matchesFilters;
    });
  }, [items, query, activeFilters, orderKind, data?.job?.zakazka]);

  const polozekCelkem = items.length;

  if (loading) {
    return (
      <div className="erp-overview-page" style={{ ...UI.container, paddingTop: 10 }}>
        <div style={{ ...UI.card, padding: 24, borderRadius: 14 }}>
          <div style={UI.sectionSubtitle}>Načítám kartu zakázky…</div>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="erp-overview-page" style={{ ...UI.container, paddingTop: 10 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <DetailPageHeader
            title="Karta zakázky"
            actions={
              <button type="button" onClick={onBack} style={UI.buttons.secondary}>
                Zpět na přehled
              </button>
            }
          />
          <div
            style={{
              ...UI.card,
              padding: 24,
              borderRadius: 14,
              border: "1px solid #fecaca",
              background: "#fef2f2",
              color: "#991b1b",
              fontWeight: 700,
            }}
          >
            {error ?? "Zakázku se nepodařilo načíst."}
          </div>
        </div>
      </div>
    );
  }

  const zakazkaLabel = data.job?.zakazka ?? "—";
  const zakaznikLabel = data.customer_order?.zakaznik ?? "—";
  const objednavkaLabel = data.customer_order?.objednavka ?? "—";
  const datumLabel = data.customer_order?.datum ?? "—";
  const kusyCelkem = data.summary?.kusy_celkem ?? 0;
  const totalSalesPrice = data.summary?.total_sales_price ?? 0;
  const orderOp = data.summary;
  const orderWorkflowActive = isBusinessWorkflowActive(data.customer_order?.workflow_status);

  const conflictLines = (restockPreviewSnapshot?.lines ?? []).filter((l) => l.needs_user_choice);

  const dangerButton: React.CSSProperties = {
    ...UI.buttons.secondary,
    color: UI.colors.problemFg,
    borderColor: "#FCA5A5",
    background: "#FEF2F2",
  };

  const inlineFormCard: React.CSSProperties = {
    ...UI.card,
    padding: 14,
    borderRadius: 12,
    background: UI.colors.neutralBg,
    border: `1px solid ${UI.colors.border}`,
    marginBottom: 14,
  };

  const tableSectionCard: React.CSSProperties = {
    ...UI.card,
    borderRadius: 14,
    padding: 18,
  };

  const sectionHeader: React.CSSProperties = {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 14,
    flexWrap: "wrap",
  };

  const sectionHeaderTitle: React.CSSProperties = {
    fontSize: 16,
    fontWeight: 900,
    color: UI.colors.textPrimary,
    letterSpacing: 0.1,
  };

  const sectionHeaderSub: React.CSSProperties = {
    fontSize: 12,
    fontWeight: 700,
    color: UI.colors.textSecondary,
  };

  const tableHeadCell: React.CSSProperties = {
    ...UI.th,
    whiteSpace: "nowrap",
    padding: "10px 12px",
  };

  const tableBodyCell: React.CSSProperties = {
    ...UI.td,
    padding: "10px 12px",
    verticalAlign: "middle" as const,
  };

  const rowStripeBg = "#FAFBFD";

  const itemsAggregate = {
    count: items.length,
    totalQty: kusyCelkem,
    totalCzk: items.reduce((acc, it) => {
      const qty = Number(it.qty) || 0;
      const price = Number(it.sale_price_per_piece ?? 0) || 0;
      return acc + qty * price;
    }, 0),
  };

  return (
    <>
    <div className="erp-overview-page" style={{ ...UI.container, paddingTop: 10 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <DetailPageHeader
          preHeader={
            !orderWorkflowActive ? (
              <div
                style={{
                  padding: "12px 16px",
                  borderRadius: 10,
                  border: "1px solid #fecaca",
                  background: "#fef2f2",
                  color: "#991b1b",
                  fontWeight: 700,
                }}
              >
                Tato zakázka je stornována — úpravy a nové VP nejsou povoleny; údaje jsou jen pro historii.
              </div>
            ) : null
          }
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
                {zakazkaLabel}
              </div>
              <div style={{ fontSize: 15, fontWeight: 700, color: UI.colors.textPrimary }}>
                {zakaznikLabel}
              </div>
              <div style={{ fontSize: 12, fontWeight: 600, color: UI.colors.textSecondary, marginTop: 2 }}>
                Karta zakázky — detail a položky
              </div>
            </div>
          }
          headerAside={
            <span
              className="erp-status-badge"
              style={{
                ...UI.statusBadgeBase,
                ...(orderWorkflowActive ? UI.statusBadgeOk : UI.statusBadgeProblem),
              }}
            >
              {orderWorkflowActive ? "Aktivní" : "Stornováno"}
            </span>
          }
          actions={
            <>
              <button
                type="button"
                style={UI.buttons.primary}
                onClick={handleCreateVp}
                disabled={
                  vpPreviewLoading ||
                  creatingVp ||
                  !orderWorkflowActive ||
                  !canOrdersWrite ||
                  !canCreateProductionOrders
                }
                title={!canCreateProductionOrders ? "Chybí oprávnění create_production_orders" : undefined}
              >
                {vpPreviewLoading ? "Kontroluji sklad a výrobu…" : creatingVp ? "Vytvářím VP…" : "Vytvořit VP"}
              </button>
              <button
                type="button"
                style={UI.buttons.secondary}
                onClick={() => window.open(buildErpUrl({ view: "orderCard", customerOrderId }), "_blank")}
              >
                Otevřít v novém okně
              </button>
              <button type="button" onClick={onBack} style={UI.buttons.secondary}>
                Zpět na přehled
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
                  <div style={erpDetailRowLabel}>Zakázka</div>
                  <div style={erpDetailRowValue}>{zakazkaLabel}</div>
                </div>
                <div>
                  <div style={erpDetailRowLabel}>Zákazník</div>
                  <div style={erpDetailRowValue}>{zakaznikLabel}</div>
                </div>
                <div>
                  <div style={erpDetailRowLabel}>Objednávka</div>
                  <div style={erpDetailRowValue}>{objednavkaLabel}</div>
                </div>
                <div>
                  <div style={erpDetailRowLabel}>Datum</div>
                  <div style={erpDetailRowValue}>{datumLabel}</div>
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
                Souhrn zakázky
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
                  gap: 14,
                }}
              >
                <div>
                  <div style={erpDetailIdentLabel}>Položek celkem</div>
                  <div style={{ ...erpDetailIdentValue, fontVariantNumeric: "tabular-nums" }}>
                    {polozekCelkem}
                  </div>
                </div>
                <div>
                  <div style={erpDetailIdentLabel}>Kusů celkem</div>
                  <div style={{ ...erpDetailIdentValue, fontVariantNumeric: "tabular-nums" }}>
                    {kusyCelkem}
                  </div>
                </div>
                <div>
                  <div style={erpDetailIdentLabel}>Prodejní cena</div>
                  <div style={{ ...erpDetailIdentValue, fontVariantNumeric: "tabular-nums" }}>
                    {formatCzk(totalSalesPrice)}
                  </div>
                </div>
                <div>
                  <div style={erpDetailIdentLabel}>Fáze</div>
                  <div style={erpDetailIdentValue}>{orderPhaseLabelCs(orderOp?.current_phase)}</div>
                </div>
                <div>
                  <div style={erpDetailIdentLabel}>Hotovo</div>
                  <div style={{ ...erpDetailIdentValue, fontVariantNumeric: "tabular-nums" }}>
                    {formatLinePct(orderOp?.completion_percent)}
                  </div>
                </div>
              </div>
            </div>
          }
        />
        {actionFeedback ? (
          <div ref={writeFeedbackAnchorRef} style={{ scrollMarginTop: 8 }}>
            <InlineBanner
              kind={actionFeedback.kind}
              message={actionFeedback.message}
              onClose={() => setActionFeedback(null)}
            />
          </div>
        ) : null}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 12,
            padding: "10px 16px",
            borderRadius: 12,
            background: UI.colors.neutralBg,
            border: `1px solid ${UI.colors.border}`,
          }}
        >
          <div
            style={{
              ...erpDetailSectionEyebrow,
              color: UI.colors.neutralFg,
              marginRight: 4,
              flexShrink: 0,
            }}
          >
            Akce zakázky
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <button
              type="button"
              style={UI.buttons.secondary}
              onClick={() => openHeaderEdit(data)}
              disabled={!orderWorkflowActive || !canOrdersWrite}
            >
              Upravit zakázku
            </button>
            <button type="button" style={UI.buttons.secondary} onClick={() => {}}>
              Import položek
            </button>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
            <div
              aria-hidden
              style={{
                width: 1,
                height: 22,
                background: UI.colors.divider,
              }}
            />
            <button
              type="button"
              style={dangerButton}
              onClick={handleStornoOrder}
              disabled={!orderWorkflowActive || !canOrdersStorno}
            >
              Stornovat zakázku
            </button>
          </div>
        </div>

        {vpError ? (
          <div
            style={{
              ...UI.card,
              borderRadius: 12,
              padding: 12,
              border: "1px solid #fecaca",
              background: "#fef2f2",
              color: "#991b1b",
              fontWeight: 700,
            }}
          >
            {vpError}
          </div>
        ) : null}

        {showEditHeader ? (
          <div style={inlineFormCard}>
            <div style={{ ...erpDetailSectionEyebrow, marginBottom: 2 }}>Úprava</div>
            <div style={{ ...sectionHeaderTitle, marginBottom: 12 }}>Hlavička zakázky</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
              <div>
                <div style={UI.inputs.label}>Zákazník</div>
                <select
                  value={headerCustomerId}
                  onChange={(e) => setHeaderCustomerId(e.target.value)}
                  style={UI.inputs.base}
                >
                  <option value="">Vyberte zákazníka</option>
                  {customers.map((c) => (
                    <option key={c.id} value={String(c.id)}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <div style={UI.inputs.label}>Číslo objednávky zákazníka</div>
                <input value={headerPoNo} onChange={(e) => setHeaderPoNo(e.target.value)} style={UI.inputs.base} />
              </div>
              <div>
                <div style={UI.inputs.label}>Datum objednávky</div>
                <input type="date" value={headerOrderDate} onChange={(e) => setHeaderOrderDate(e.target.value)} style={UI.inputs.base} />
              </div>
              <div>
                <div style={UI.inputs.label}>Termín expedice</div>
                <input type="date" value={headerShipDate} onChange={(e) => setHeaderShipDate(e.target.value)} style={UI.inputs.base} />
              </div>
              <div style={{ gridColumn: "1 / -1" }}>
                <div style={UI.inputs.label}>Poznámka</div>
                <input value={headerNote} onChange={(e) => setHeaderNote(e.target.value)} style={UI.inputs.base} />
              </div>
            </div>
            {headerError ? <div style={{ color: "#b91c1c", fontWeight: 700, marginTop: 8 }}>{headerError}</div> : null}
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button
                type="button"
                style={UI.buttons.primary}
                onClick={handleSaveHeader}
                disabled={savingHeader || !canOrdersWrite}
              >
                {savingHeader ? "Ukládám…" : "Uložit hlavičku"}
              </button>
              <button type="button" style={UI.buttons.secondary} onClick={() => setShowEditHeader(false)} disabled={savingHeader}>
                Zrušit
              </button>
            </div>
          </div>
        ) : null}

        <div
          style={{
            width: "100%",
            overflowX: "auto" as const,
            overflowY: "hidden" as const,
            marginBottom: 4,
          }}
        >
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
            {ORDER_SUBTABS.map((tab) => {
              const active = tab === activeOrderSubtab;
              return (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveOrderSubtab(tab)}
                  onMouseEnter={() => setHoverOrderSubtab(tab)}
                  onMouseLeave={() => setHoverOrderSubtab((h) => (h === tab ? null : h))}
                  style={{
                    ...UI.subTab,
                    ...(active ? UI.subTabActive : {}),
                    ...(!active && hoverOrderSubtab === tab ? UI.subTabHover : {}),
                  }}
                >
                  {tab}
                </button>
              );
            })}
          </div>
        </div>

        {activeOrderSubtab === "Přehled" ? (
          <div style={tableSectionCard}>
            <div style={sectionHeader}>
              <div>
                <div style={{ ...erpDetailSectionEyebrow, marginBottom: 2 }}>Položky</div>
                <div style={sectionHeaderTitle}>Položky zakázky</div>
                {itemsAggregate.count > 0 ? (
                  <div style={{ ...sectionHeaderSub, marginTop: 4 }}>
                    {itemsAggregate.count}{" "}
                    {itemsAggregate.count === 1 ? "položka" : itemsAggregate.count < 5 ? "položky" : "položek"} ·{" "}
                    {formatQty(itemsAggregate.totalQty)} ks · {formatCzk(itemsAggregate.totalCzk)}
                  </div>
                ) : null}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                <button
                  type="button"
                  style={UI.buttons.primary}
                  disabled={!orderWorkflowActive || !canOrdersWrite}
                  onClick={() => {
                    setShowAddItemForm((v) => {
                      if (v) return false;
                      setFormGpn("");
                      setFormName("");
                      setFormQty("1");
                      setFormDueDate("");
                      setUserPickedPortfolioId(null);
                      setItemError(null);
                      setGpnLookupDone(false);
                      return true;
                    });
                  }}
                >
                  {showAddItemForm ? "Zavřít formulář" : "Přidat položku"}
                </button>
              </div>
            </div>

            {editingItemId != null ? (
              <div style={inlineFormCard}>
                <div style={{ ...erpDetailSectionEyebrow, marginBottom: 2 }}>Úprava</div>
                <div style={{ ...sectionHeaderTitle, marginBottom: 12 }}>Položka zakázky</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
                  <div>
                    <div style={UI.inputs.label}>GPN / Výkres</div>
                    <input value={editFormGpn} onChange={(e) => setEditFormGpn(e.target.value)} style={UI.inputs.base} />
                    {editGpnLookupDone ? (
                      <div style={{ fontSize: 12, marginTop: 4, fontWeight: 700 }}>
                        {editPortfolioGpnMatches.length === 0 ? (
                          <span style={{ color: "#b45309" }}>Nenalezeno v portfoliu.</span>
                        ) : editPortfolioGpnMatches.length === 1 ? (
                          <span style={{ color: "#15803d" }}>Nalezeno v portfoliu (jednoznačně).</span>
                        ) : (
                          <span style={{ color: "#b45309" }}>
                            Více položek portfolia se stejným GPN — vyberte variantu níže.
                          </span>
                        )}
                      </div>
                    ) : null}
                  </div>
                  {editPortfolioGpnMatches.length > 1 ? (
                    <div style={{ gridColumn: "1 / -1" }}>
                      <div style={UI.inputs.label}>Portfolio varianta</div>
                      <select
                        value={editUserPickedPortfolioId ?? ""}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (v === "") {
                            setEditUserPickedPortfolioId(null);
                            return;
                          }
                          const id = Number(v);
                          if (!Number.isFinite(id)) return;
                          setEditUserPickedPortfolioId(id);
                          const row = editPortfolioGpnMatches.find((x) => x.id === id);
                          if (row) setEditFormName(row.name ?? "");
                        }}
                        style={UI.inputs.base}
                      >
                        <option value="">— Vyberte variantu —</option>
                        {editPortfolioGpnMatches.map((p) => (
                          <option key={p.id} value={p.id}>
                            {portfolioVariantOptionText(p)}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : null}
                  <div>
                    <div style={UI.inputs.label}>Název</div>
                    <input value={editFormName} onChange={(e) => setEditFormName(e.target.value)} style={UI.inputs.base} />
                  </div>
                  <div>
                    <div style={UI.inputs.label}>Množství</div>
                    <input value={editFormQty} onChange={(e) => setEditFormQty(e.target.value)} style={UI.inputs.base} />
                  </div>
                  <div>
                    <div style={UI.inputs.label}>Termín</div>
                    <input type="date" value={editFormDue} onChange={(e) => setEditFormDue(e.target.value)} style={UI.inputs.base} />
                  </div>
                </div>
                {editItemError ? <div style={{ color: "#b91c1c", fontWeight: 700, marginTop: 8 }}>{editItemError}</div> : null}
                <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                  <button
                    type="button"
                    style={UI.buttons.primary}
                    onClick={handleSaveEditItem}
                    disabled={savingEditItem || !canOrdersWrite}
                  >
                    {savingEditItem ? "Ukládám…" : "Uložit změny"}
                  </button>
                  <button type="button" style={UI.buttons.secondary} onClick={cancelItemEdit} disabled={savingEditItem}>
                    Zrušit
                  </button>
                </div>
              </div>
            ) : null}

            {showAddItemForm ? (
              <div style={inlineFormCard}>
                <div style={{ ...erpDetailSectionEyebrow, marginBottom: 2 }}>Nová položka</div>
                <div style={{ ...sectionHeaderTitle, marginBottom: 12 }}>Přidat do zakázky</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
                  <div>
                    <div style={UI.inputs.label}>GPN / Výkres</div>
                    <input value={formGpn} onChange={(e) => setFormGpn(e.target.value)} style={UI.inputs.base} />
                    {gpnLookupDone ? (
                      <div style={{ fontSize: 12, marginTop: 4, fontWeight: 700 }}>
                        {portfolioGpnMatches.length === 0 ? (
                          <span style={{ color: "#b45309" }}>Nenalezeno v portfoliu.</span>
                        ) : portfolioGpnMatches.length === 1 ? (
                          <span style={{ color: "#15803d" }}>Nalezeno v portfoliu (jednoznačně).</span>
                        ) : (
                          <span style={{ color: "#b45309" }}>
                            Více položek portfolia se stejným GPN — vyberte variantu níže.
                          </span>
                        )}
                      </div>
                    ) : null}
                  </div>
                  {portfolioGpnMatches.length > 1 ? (
                    <div style={{ gridColumn: "1 / -1" }}>
                      <div style={UI.inputs.label}>Portfolio varianta</div>
                      <select
                        value={userPickedPortfolioId ?? ""}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (v === "") {
                            setUserPickedPortfolioId(null);
                            return;
                          }
                          const id = Number(v);
                          if (!Number.isFinite(id)) return;
                          setUserPickedPortfolioId(id);
                          const item = portfolioGpnMatches.find((x) => x.id === id);
                          if (item) setFormName(item.name ?? "");
                        }}
                        style={UI.inputs.base}
                      >
                        <option value="">— Vyberte variantu —</option>
                        {portfolioGpnMatches.map((p) => (
                          <option key={p.id} value={p.id}>
                            {portfolioVariantOptionText(p)}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : null}
                  <div>
                    <div style={UI.inputs.label}>Název</div>
                    <input value={formName} onChange={(e) => setFormName(e.target.value)} style={UI.inputs.base} />
                  </div>
                  <div>
                    <div style={UI.inputs.label}>Množství</div>
                    <input value={formQty} onChange={(e) => setFormQty(e.target.value)} style={UI.inputs.base} />
                  </div>
                  <div>
                    <div style={UI.inputs.label}>Termín</div>
                    <input type="date" value={formDueDate} onChange={(e) => setFormDueDate(e.target.value)} style={UI.inputs.base} />
                  </div>
                </div>
                {itemError ? <div style={{ color: "#b91c1c", fontWeight: 700, marginTop: 8 }}>{itemError}</div> : null}
                <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                  <button
                    type="button"
                    style={UI.buttons.primary}
                    onClick={handleCreateItem}
                    disabled={savingItem || !canOrdersWrite}
                  >
                    {savingItem ? "Ukládám..." : "Uložit položku"}
                  </button>
                  <button type="button" style={UI.buttons.secondary} onClick={() => setShowAddItemForm(false)} disabled={savingItem}>
                    Zrušit
                  </button>
                </div>
              </div>
            ) : null}

            {items.length === 0 ? (
              <div style={UI.overviewEmptyInCard}>
                K této objednávce nejsou evidovány žádné položky.
              </div>
            ) : (
              <>
                <div style={{ ...UI.ordersFilterBar, marginBottom: 12 }}>
                  <div style={UI.ordersFilterSearchWrap}>
                    <input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Hledat zakázku, GPN, popis, výkres, revizi, VP…"
                      style={UI.inputs.base}
                    />
                  </div>
                  <div style={UI.ordersFilterChips}>
                    {(["Po termínu", "Dokončená", "Dodací list", "Fakturováno"] as const).map((filter) => {
                      const active = activeFilters.includes(filter);
                      return (
                        <button
                          key={filter}
                          type="button"
                          onClick={() =>
                            setActiveFilters((prev) =>
                              prev.includes(filter) ? prev.filter((f) => f !== filter) : [...prev, filter]
                            )
                          }
                          style={{
                            ...UI.ordersFilterChip,
                            ...(active ? UI.ordersFilterChipActive : {}),
                          }}
                        >
                          {filter}
                        </button>
                      );
                    })}
                    <OverviewSloupceButton onClick={() => tb.openPanel()} disabled={tb.loading} />
                  </div>
                </div>

                <div style={UI.overviewTableWrap}>
                  <table style={UI.table}>
                    <thead>
                      <tr style={UI.overviewTableHeadRow}>
                        {(
                          [
                            { key: "line_no", label: "Řádek", align: "right" as const, show: true },
                            { key: "gpn", label: "GPN", align: "left" as const, show: true },
                            { key: "name", label: "Název", align: "left" as const, show: true },
                            { key: "drawing_number", label: "Výkres", align: "left" as const, show: showDrawingNumber },
                            { key: "drawing_revision", label: "Revize", align: "left" as const, show: showDrawingRevision },
                            { key: "qty", label: "Množství", align: "right" as const, show: true },
                            { key: "sale_price", label: "Prodejní cena / ks", align: "right" as const, show: true },
                            { key: "due", label: "Termín", align: "left" as const, show: true },
                            { key: "vp", label: "Výrobní příkazy", align: "left" as const, show: true },
                            { key: "reported", label: "Vykázaný čas", align: "right" as const, show: true },
                            { key: "completion", label: "Hotovo", align: "right" as const, show: true },
                            { key: "labor", label: "Náklad práce", align: "right" as const, show: true },
                            { key: "performance", label: "Výkonnost", align: "right" as const, show: true },
                            { key: "actions", label: "Akce", align: "left" as const, show: true },
                          ] as const
                        )
                          .filter((h) => h.show)
                          .map((h) => (
                            <th
                              key={h.key}
                              style={{
                                ...tableHeadCell,
                                textAlign: h.align,
                              }}
                            >
                              {h.label}
                            </th>
                          ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredItems.map((item, idx) => {
                        const rowBg = idx % 2 === 1 ? rowStripeBg : UI.colors.card;
                        const isHover = hoveredItemId === item.job_item_id;
                        const numCell: React.CSSProperties = {
                          ...tableBodyCell,
                          whiteSpace: "nowrap",
                          textAlign: "right",
                          fontVariantNumeric: "tabular-nums",
                        };
                        const txtCell: React.CSSProperties = {
                          ...tableBodyCell,
                          whiteSpace: "nowrap",
                        };
                        const vpList = relevantProductionOrders(item, orderKind);
                        const hasVp = vpList.length > 0;
                        const portfolioId = item.effective_portfolio_item_id ?? item.portfolio_item_id ?? null;
                        return (
                          <tr
                            key={item.job_item_id}
                            onClick={() => onOpenItemDetail(item.job_item_id, "orders")}
                            onMouseEnter={() => setHoveredItemId(item.job_item_id)}
                            onMouseLeave={() => setHoveredItemId((id) => (id === item.job_item_id ? null : id))}
                            style={{
                              cursor: "pointer",
                              background: isHover ? "#EFF6FF" : rowBg,
                              boxShadow: isHover
                                ? `inset 3px 0 0 0 ${UI.colors.primary}`
                                : "none",
                              transition: "background 120ms ease, box-shadow 120ms ease",
                            }}
                          >
                            <td style={{ ...numCell, fontWeight: 800, color: UI.colors.textPrimary }}>
                              {item.line_no}
                            </td>
                            <td
                              style={{ ...txtCell, fontWeight: 800, color: UI.colors.textPrimary }}
                              onClick={(e) => {
                                if (portfolioId != null && onOpenPortfolioById) {
                                  e.stopPropagation();
                                }
                              }}
                            >
                              {portfolioId != null && onOpenPortfolioById ? (
                                <button
                                  type="button"
                                  className="erp-table-link"
                                  onClick={() => onOpenPortfolioById(portfolioId)}
                                  title="Otevřít portfolio položky"
                                  style={{
                                    background: "none",
                                    border: "none",
                                    padding: 0,
                                    margin: 0,
                                    cursor: "pointer",
                                    font: "inherit",
                                    color: UI.colors.primary,
                                    fontWeight: 800,
                                    textDecoration: "underline",
                                    textUnderlineOffset: 3,
                                  }}
                                >
                                  {item.gpn}
                                </button>
                              ) : (
                                item.gpn
                              )}
                            </td>
                            <td style={{ ...tableBodyCell, whiteSpace: "normal" }}>
                              {item.description ?? "—"}
                            </td>
                            {showDrawingNumber ? (
                              <td style={txtCell}>
                                {item.drawing_number?.trim() ? item.drawing_number : "—"}
                              </td>
                            ) : null}
                            {showDrawingRevision ? (
                              <td style={txtCell}>
                                {item.drawing_revision?.trim() ? item.drawing_revision : "—"}
                              </td>
                            ) : null}
                            <td style={numCell}>{item.qty} ks</td>
                            <td style={numCell}>{formatCzk(item.sale_price_per_piece)}</td>
                            <td style={txtCell}>{item.due_date ?? "—"}</td>
                            <td style={txtCell} onClick={(e) => e.stopPropagation()}>
                              {hasVp ? (
                                <span
                                  style={{
                                    display: "inline-flex",
                                    flexWrap: "wrap",
                                    gap: 6,
                                    alignItems: "center",
                                  }}
                                >
                                  {vpList.map((po, i) => {
                                    const code = po.vp_code?.trim() || `VP#${po.id}`;
                                    const canOpen = !!onOpenProductionOrderDetail;
                                    return (
                                      <span
                                        key={po.id}
                                        style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
                                      >
                                        {i > 0 ? (
                                          <span style={{ color: UI.colors.textSecondary }}>·</span>
                                        ) : null}
                                        <button
                                          type="button"
                                          className={canOpen ? "erp-table-link" : undefined}
                                          disabled={!canOpen}
                                          onClick={() => onOpenProductionOrderDetail?.(po.id, po.vp_code ?? undefined)}
                                          title={canOpen ? "Otevřít detail výrobního příkazu" : undefined}
                                          style={{
                                            background: "none",
                                            border: "none",
                                            padding: 0,
                                            margin: 0,
                                            cursor: canOpen ? "pointer" : "default",
                                            font: "inherit",
                                            color: "#15803D",
                                            fontWeight: 800,
                                            textDecoration: canOpen ? "underline" : "none",
                                            textUnderlineOffset: 3,
                                          }}
                                        >
                                          {code}
                                        </button>
                                      </span>
                                    );
                                  })}
                                </span>
                              ) : (
                                <span style={{ color: UI.colors.textSecondary, fontWeight: 700 }}>—</span>
                              )}
                            </td>
                            <td style={numCell}>{formatLineReportedMin(item.reported_time_min)}</td>
                            <td style={numCell}>{formatLinePct(item.completion_percent)}</td>
                            <td style={numCell}>{formatLineLabor(item.direct_labor_cost)}</td>
                            <td style={numCell}>{formatLinePct(item.performance_percent)}</td>
                            <td
                              style={txtCell}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                                <button
                                  type="button"
                                  style={UI.buttons.secondary}
                                  disabled={
                                    !orderWorkflowActive ||
                                    !isBusinessWorkflowActive(item.workflow_status) ||
                                    !canOrdersWrite
                                  }
                                  onClick={() => openItemEdit(item)}
                                >
                                  Upravit
                                </button>
                                <button
                                  type="button"
                                  style={dangerButton}
                                  disabled={
                                    !orderWorkflowActive ||
                                    !isBusinessWorkflowActive(item.workflow_status) ||
                                    !canOrdersStorno
                                  }
                                  onClick={() => handleStornoItem(item.job_item_id)}
                                >
                                  Zrušit
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                      {filteredItems.length === 0 ? (
                        <tr>
                          <td
                            colSpan={12 + (showDrawingNumber ? 1 : 0) + (showDrawingRevision ? 1 : 0)}
                            style={{
                              ...tableBodyCell,
                              textAlign: "center",
                              color: UI.colors.textSecondary,
                              padding: "14px 10px",
                            }}
                          >
                            Žádné výsledky.
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>

                {orderKind !== "internal" ? (
                  <div
                    style={{
                      marginTop: 16,
                      padding: "12px 14px",
                      borderRadius: 12,
                      border: `1px solid ${UI.colors.border}`,
                      background: UI.colors.neutralBg,
                      fontSize: 13,
                      color: UI.colors.textSecondary,
                      lineHeight: 1.55,
                    }}
                  >
                    <strong style={{ color: UI.colors.textPrimary }}>Výrobní příkazy</strong> se zakládají podle{" "}
                    <strong>logistické varianty portfolia</strong> u řádku (výběr při zadání GPN / úpravě položky):{" "}
                    <em>Sklad</em> = jen interní doplnění skladu, <em>Výroba zákazník</em> = přímá výroba pro zákazníka,{" "}
                    <em>Sklad zákazník</em> = čerpání skladu, případně rezervace běžícího doplnění (modal) a doplnění.
                  </div>
                ) : null}
              </>
            )}
          </div>
        ) : (
          <div style={{ ...UI.card, borderRadius: 14, padding: 16 }}>
            <div style={{ ...UI.sectionTitle, fontSize: 16, marginBottom: 0 }}>
              {`Modul ${activeOrderSubtab} pro tuto zakázku je ve vývoji.`}
            </div>
          </div>
        )}
      </div>
    </div>

    <SimpleModal
      title="Konflikt: doplnění skladu vs. zakázka"
      open={restockModalOpen}
      onClose={() => {
        if (!creatingVp) {
          setRestockModalOpen(false);
          setRestockPreviewSnapshot(null);
          setRestockChoices({});
          setVpError(null);
        }
      }}
      footer={
        <>
          <button
            type="button"
            style={UI.buttons.secondary}
            onClick={() => {
              if (!creatingVp) {
                setRestockModalOpen(false);
                setRestockPreviewSnapshot(null);
                setRestockChoices({});
                setVpError(null);
              }
            }}
            disabled={creatingVp}
          >
            Zrušit
          </button>
          <button type="button" style={UI.buttons.primary} onClick={() => void handleConfirmRestockModal()} disabled={creatingVp}>
            {creatingVp ? "Vytvářím VP…" : "Potvrdit a vytvořit VP"}
          </button>
        </>
      }
    >
      <p style={{ margin: "0 0 12px", fontSize: 14, color: "#334155", lineHeight: 1.5 }}>
        U uvedených položek běží současně <strong>doplnění skladu</strong> (stejné GPN) a zákazník potřebuje víc, než je
        právě na polici. Minimální zásoba je <strong>cíl pro zákazníka</strong> — nesmí blokovat okamžitý výdej ze skladu.
        Zvolte, zda část požadavku pokrýt z budoucího výstupu rozpracovaného skladového VP, nebo nechat WIP čistě na
        doplnění skladu a zbytek řešit přímou výrobou pro zákazníka.
      </p>
      {vpError && restockModalOpen ? (
        <div
          style={{
            marginBottom: 12,
            padding: "10px 12px",
            borderRadius: 10,
            background: "#fef2f2",
            color: "#991b1b",
            fontSize: 13,
            fontWeight: 700,
          }}
        >
          {vpError}
        </div>
      ) : null}
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {conflictLines.map((line) => {
          const wip = line.restock_wip;
          const vpLabel = wip.vp_codes.length ? wip.vp_codes.join(", ") : "—";
          const choice = restockChoices[line.job_item_id];
          const options = [...(line.restock_resolution_options ?? [])].sort((a, b) => {
            if (a.is_recommended && !b.is_recommended) return -1;
            if (!a.is_recommended && b.is_recommended) return 1;
            return 0;
          });
          const fallbackStrategy = (line.recommended_fulfillment_strategy ?? "stock_and_new_production") as RestockConflictStrategy;
          const effectiveStrategy = (choice ?? fallbackStrategy) as RestockConflictStrategy;
          const selectedOpt = options.find((o) => o.strategy === effectiveStrategy) ?? options[0];
          const hasBasics =
            line.finished_stock_qty != null &&
            line.minimum_stock_target_qty != null &&
            (line.wip_restock_qty != null || wip.quantity_open != null);
          return (
            <div
              key={line.job_item_id}
              style={{
                border: "1px solid #e2e8f0",
                borderRadius: 12,
                padding: 12,
                background: "#f8fafc",
              }}
            >
              <div style={{ fontWeight: 900, color: "#0f172a", marginBottom: 8 }}>GPN: {line.gpn || "—"}</div>
              <div style={{ fontSize: 13, color: "#475569", marginBottom: 10, lineHeight: 1.5 }}>
                <div>
                  Požadavek zákazníka: <strong>{formatQty(line.required_qty)} ks</strong>
                </div>
                {hasBasics ? (
                  <>
                    <div>
                      Sklad hotových kusů: <strong>{formatQty(line.finished_stock_qty!)} ks</strong>
                    </div>
                    <div>
                      Minimální zásoba (cíl): <strong>{formatQty(line.minimum_stock_target_qty!)} ks</strong>
                    </div>
                    <div>
                      Ve výrobě na doplnění skladu:{" "}
                      <strong>{formatQty(line.wip_restock_qty ?? wip.quantity_open)} ks</strong> (VP: {vpLabel})
                    </div>
                  </>
                ) : (
                  <div>
                    Ve výrobě na doplnění skladu: <strong>{formatQty(wip.quantity_open)} ks</strong> (VP: {vpLabel})
                  </div>
                )}
                {selectedOpt ? (
                  <>
                    <div
                      style={{
                        marginTop: 12,
                        padding: "10px 12px",
                        borderRadius: 10,
                        background: "#fff",
                        border: "1px solid #cbd5e1",
                        fontSize: 13,
                        color: "#0f172a",
                        lineHeight: 1.55,
                      }}
                    >
                      <div style={{ fontWeight: 900, marginBottom: 8 }}>Rozložení při zvolené variantě</div>
                      <div style={{ fontWeight: 700, marginBottom: 8 }}>{selectedOpt.summary_cs}</div>
                      <div>Ze skladu ihned: <strong>{formatQty(selectedOpt.stock_issue_qty)} ks</strong></div>
                      <div>Z WIP po dokončení: <strong>{formatQty(selectedOpt.wip_reservation_qty)} ks</strong></div>
                      <div>Z nové výroby: <strong>{formatQty(selectedOpt.new_customer_production_qty)} ks</strong></div>
                      <div>Stav skladu po výdeji: <strong>{formatQty(selectedOpt.stock_after_customer_issue_qty)} ks</strong></div>
                      <div>
                        Budoucí stav skladu po dokončení WIP (nerezervovaná část jde na sklad):{" "}
                        <strong>{formatQty(selectedOpt.future_stock_after_wip_qty)} ks</strong>
                      </div>
                      <div>
                        Potřebné doplnění minima (interní zakázka):{" "}
                        <strong>{formatQty(selectedOpt.min_stock_replenishment_gap)} ks</strong>
                      </div>
                    </div>
                    {selectedOpt.min_stock_replenishment_gap <= 0 ? (
                      <div
                        style={{
                          marginTop: 10,
                          padding: "10px 12px",
                          borderRadius: 10,
                          background: "#ecfdf5",
                          border: "1px solid #6ee7b7",
                          color: "#065f46",
                          fontWeight: 700,
                        }}
                      >
                        Další interní doplnění skladu není potřeba — po této variantě už cílové minimum pokryje rozpracovaná
                        výroba (WIP) a stav skladu.
                      </div>
                    ) : null}
                  </>
                ) : null}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10, fontSize: 14 }}>
                {options.length > 0 ? (
                  options.map((opt) => (
                    <label
                      key={opt.strategy}
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: 8,
                        cursor: creatingVp ? "not-allowed" : "pointer",
                      }}
                    >
                      <input
                        type="radio"
                        name={`restock-strategy-${line.job_item_id}`}
                        checked={effectiveStrategy === opt.strategy}
                        onChange={() =>
                          setRestockChoices((prev) => ({ ...prev, [line.job_item_id]: opt.strategy }))
                        }
                        disabled={creatingVp}
                      />
                      <span>
                        <strong>{opt.label_cs}</strong>
                        {opt.is_recommended ? (
                          <span style={{ marginLeft: 6, fontSize: 12, color: "#059669", fontWeight: 800 }}>(doporučeno)</span>
                        ) : null}
                        <div style={{ fontSize: 12, color: "#64748b", marginTop: 4, fontWeight: 600 }}>{opt.summary_cs}</div>
                      </span>
                    </label>
                  ))
                ) : (
                  <>
                    <label style={{ display: "flex", alignItems: "flex-start", gap: 8, cursor: "pointer" }}>
                      <input
                        type="radio"
                        name={`restock-strategy-${line.job_item_id}`}
                        checked={effectiveStrategy === "stock_and_new_production" || effectiveStrategy === "prefer_stock"}
                        onChange={() =>
                          setRestockChoices((prev) => ({ ...prev, [line.job_item_id]: "stock_and_new_production" }))
                        }
                        disabled={creatingVp}
                      />
                      <span>
                        <strong>Ze skladu + zbytek nová výroba</strong>
                      </span>
                    </label>
                    <label style={{ display: "flex", alignItems: "flex-start", gap: 8, cursor: creatingVp ? "not-allowed" : "pointer" }}>
                      <input
                        type="radio"
                        name={`restock-strategy-${line.job_item_id}`}
                        checked={effectiveStrategy === "stock_and_wip" || effectiveStrategy === "prefer_customer"}
                        onChange={() => setRestockChoices((prev) => ({ ...prev, [line.job_item_id]: "stock_and_wip" }))}
                        disabled={creatingVp}
                      />
                      <span>
                        <strong>Sklad + WIP</strong>
                      </span>
                    </label>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </SimpleModal>
    <TableLayoutModal
      open={tb.panelOpen}
      title="Sloupce — položky zakázky"
      columns={tb.columns}
      onColumnsChange={tb.setColumns}
      sort={tb.sort}
      onSortChange={tb.setSort}
      sortableKeys={tb.sortableKeys}
      columnLabels={ORDER_CARD_ITEMS_COL_LABELS}
      density={tb.density}
      onDensityChange={tb.setDensity}
      onCancel={tb.closePanelCancel}
      onSave={() => void tb.savePanel()}
      onResetLocal={tb.resetLocalToDefaults}
      onResetAndSave={() => void tb.resetAndSave()}
      saving={tb.saving}
      errorMessage={tb.saveError}
    />
    </>
  );
}
