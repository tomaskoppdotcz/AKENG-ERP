import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DetailPageHeader from "../components/DetailPageHeader";
import SimpleModal from "../components/SimpleModal";
import { UI } from "../styles/ui";
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
import { buildErpUrl } from "../utils/erpDeepLink";
import { canPerformAction, readStoredErpRole } from "../auth/rbac";

type Props = {
  customerOrderId: number;
  onBack: () => void;
  onOpenItemDetail: (jobItemId: number, source: "orders") => void;
  /** Po smazání celé zakázky — např. zavřít kartu a obnovit přehled. */
  onOrderDeleted?: () => void;
  /** Titulek záložky po načtení detailu (číslo zakázky z API). */
  onWorkspaceTabTitle?: (title: string) => void;
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
}: Props) {
  const [data, setData] = useState<OrderDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [hoveredItemId, setHoveredItemId] = useState<number | null>(null);
  const [activeOrderSubtab, setActiveOrderSubtab] = useState<OrderSubtab>("Přehled");
  const [hoverOrderSubtab, setHoverOrderSubtab] = useState<OrderSubtab | null>(null);
  const [query, setQuery] = useState("");
  const [activeFilters, setActiveFilters] = useState<Array<"Po termínu" | "Dokončená" | "Dodací list" | "Fakturováno">>([]);
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
  const canOrdersWrite = canPerformAction(erpRole, "orders.write");
  const canOrdersStorno = canPerformAction(erpRole, "orders.storno");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getOrderDetail(customerOrderId);
      setData(res);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Nepodařilo se načíst zakázku.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [customerOrderId]);

  useEffect(() => {
    load();
  }, [load]);

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
    try {
      await stornoCustomerOrder(customerOrderId);
      onOrderDeleted?.();
      onBack();
    } catch (e: unknown) {
      window.alert(e instanceof Error ? e.message : "Storno se nezdařilo.");
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
          defaults[l.job_item_id] = "prefer_stock";
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
    try {
      await stornoJobItem(jobItemId);
      if (editingItemId === jobItemId) cancelItemEdit();
      await load();
    } catch (e: unknown) {
      window.alert(e instanceof Error ? e.message : "Zrušení položky se nezdařilo.");
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
    const q = query.trim().toLowerCase();
    return items.filter((item) => {
      const vpCodes = relevantProductionOrders(item, orderKind).map((po) => po.vp_code).filter(Boolean).join(" ");
      const haystack = [item.gpn, item.description ?? "", item.vp_code ?? "", vpCodes].join(" ").toLowerCase();
      const matchesQuery = !q || haystack.includes(q);

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
  }, [items, query, activeFilters, orderKind]);

  const polozekCelkem = items.length;

  if (loading) {
    return (
      <div style={{ ...UI.container, paddingTop: 10 }}>
        <div style={{ ...UI.card, padding: 24, borderRadius: 14 }}>
          <div style={UI.sectionSubtitle}>Načítám kartu zakázky…</div>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div style={{ ...UI.container, paddingTop: 10 }}>
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
  const orderWorkflowActive = isBusinessWorkflowActive(data.customer_order?.workflow_status);

  const conflictLines = (restockPreviewSnapshot?.lines ?? []).filter((l) => l.needs_user_choice);

  return (
    <>
    <div style={{ ...UI.container, paddingTop: 10 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
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
          title="Karta zakázky"
          subtitle="Detail zakázky a její položky"
          actions={
            <>
              <button type="button" onClick={onBack} style={UI.buttons.secondary}>
                Zpět na přehled
              </button>
              <button
                type="button"
                style={UI.buttons.secondary}
                onClick={() => window.open(buildErpUrl({ view: "orderCard", customerOrderId }), "_blank")}
              >
                Otevřít v novém okně
              </button>
              <button
                type="button"
                style={UI.buttons.secondary}
                onClick={() => openHeaderEdit(data)}
                disabled={!orderWorkflowActive || !canOrdersWrite}
              >
                Upravit zakázku
              </button>
              <button
                type="button"
                style={UI.buttons.secondary}
                onClick={handleStornoOrder}
                disabled={!orderWorkflowActive || !canOrdersStorno}
              >
                Stornovat zakázku
              </button>
              <button
                type="button"
                style={UI.buttons.secondary}
                onClick={handleCreateVp}
                disabled={vpPreviewLoading || creatingVp || !orderWorkflowActive || !canOrdersWrite}
              >
                {vpPreviewLoading ? "Kontroluji sklad a výrobu…" : creatingVp ? "Vytvářím VP…" : "Vytvořit VP"}
              </button>
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
                Přidat položku
              </button>
              <button type="button" style={UI.buttons.secondary} onClick={() => {}}>
                Import položek
              </button>
            </>
          }
          summaryTiles={
            <div style={UI.summaryTilesGrid}>
              <div style={{ ...UI.summaryTile, minWidth: 220, flex: "1 1 220px" }}>
                <div style={UI.summaryTileLabel}>Zakázka</div>
                <div style={UI.summaryTileValue}>{zakazkaLabel}</div>
              </div>

              <div style={{ ...UI.summaryTile, minWidth: 220, flex: "1 1 220px" }}>
                <div style={UI.summaryTileLabel}>Zákazník</div>
                <div style={UI.summaryTileValue}>{zakaznikLabel}</div>
              </div>

              <div style={{ ...UI.summaryTile, minWidth: 220, flex: "1 1 220px" }}>
                <div style={UI.summaryTileLabel}>Objednávka</div>
                <div style={UI.summaryTileValue}>{objednavkaLabel}</div>
              </div>

              <div style={{ ...UI.summaryTile, minWidth: 190, flex: "1 1 190px" }}>
                <div style={UI.summaryTileLabel}>Datum</div>
                <div style={UI.summaryTileValue}>{datumLabel}</div>
              </div>

              <div style={{ ...UI.summaryTile, minWidth: 200, flex: "1 1 200px" }}>
                <div style={UI.summaryTileLabel}>Prodejní cena</div>
                <div style={UI.summaryTileValue}>{formatCzk(totalSalesPrice)}</div>
              </div>

              <div
                style={{
                  ...UI.summaryTile,
                  minWidth: 240,
                  flex: "1 1 240px",
                  borderColor: "#e5e7eb",
                  background: "#f8fafc",
                  justifyContent: "space-between",
                }}
              >
                <div style={UI.summaryTileLabel}>Položky</div>
                <div style={{ display: "grid", gap: 10 }}>
                  <div>
                    <div style={UI.summaryTileSubValue}>Položek celkem</div>
                    <div style={UI.summaryTileValue}>{polozekCelkem}</div>
                  </div>
                  <div>
                    <div style={UI.summaryTileSubValue}>Kusů celkem</div>
                    <div style={UI.summaryTileValue}>{kusyCelkem}</div>
                  </div>
                </div>
              </div>
            </div>
          }
        />
        {vpError ? (
          <div style={{ ...UI.card, borderRadius: 12, padding: 12, border: "1px solid #fecaca", background: "#fef2f2", color: "#991b1b", fontWeight: 700 }}>
            {vpError}
          </div>
        ) : null}

        {showEditHeader ? (
          <div style={{ ...UI.card, padding: 12, borderRadius: 14, background: "#f8fafc", border: "1px solid #e2e8f0" }}>
            <div style={{ ...UI.sectionTitle, fontSize: 16, marginBottom: 10 }}>Upravit hlavičku zakázky</div>
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
          <div style={{ ...UI.card, borderRadius: 14, padding: 16 }}>
            <div style={{ fontSize: 16, fontWeight: 1000, color: "#0f172a", marginBottom: 10 }}>Položky zakázky</div>

            {editingItemId != null ? (
              <div style={{ ...UI.card, padding: 12, marginBottom: 12, background: "#fefce8", border: "1px solid #fde047" }}>
                <div style={{ ...UI.sectionTitle, fontSize: 16, marginBottom: 10 }}>Upravit položku</div>
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
              <div style={{ ...UI.card, padding: 12, marginBottom: 12, background: "#f8fafc", border: "1px solid #e2e8f0" }}>
                <div style={{ ...UI.sectionTitle, fontSize: 16, marginBottom: 10 }}>Přidat položku</div>
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
              <div
                style={{
                  textAlign: "center",
                  color: "#64748b",
                  fontWeight: 700,
                  padding: "24px 12px",
                  background: "#f8fafc",
                  borderRadius: 12,
                  border: "1px solid #e2e8f0",
                }}
              >
                K této objednávce nejsou evidovány žádné položky.
              </div>
            ) : (
              <>
                <div style={UI.ordersFilterBar}>
                  <div style={UI.ordersFilterSearchWrap}>
                    <input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Hledat GPN, popis nebo VP..."
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
                  </div>
                </div>

                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead>
                      <tr style={{ background: "#f8fafc" }}>
                        {["GPN", "Název", "Množství", "Prodejní cena / ks", "Termín", "Výrobní příkazy", "Portfolio", "Akce"].map((h) => (
                          <th
                            key={h}
                            style={{
                              ...UI.th,
                              fontSize: 13,
                              padding: "10px 10px",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredItems.map((item) => (
                        <tr
                          key={item.job_item_id}
                          onClick={() => onOpenItemDetail(item.job_item_id, "orders")}
                          onMouseEnter={() => setHoveredItemId(item.job_item_id)}
                          onMouseLeave={() => setHoveredItemId((id) => (id === item.job_item_id ? null : id))}
                          style={{
                            cursor: "pointer",
                            background: hoveredItemId === item.job_item_id ? "#eff6ff" : "#fff",
                          }}
                        >
                          <td
                            style={{
                              ...UI.td,
                              padding: "10px 10px",
                              whiteSpace: "nowrap",
                              borderBottom: "1px solid #f1f5f9",
                              fontWeight: 800,
                            }}
                          >
                            {item.gpn}
                          </td>
                          <td style={{ ...UI.td, padding: "10px 10px", borderBottom: "1px solid #f1f5f9" }}>
                            {item.description ?? "—"}
                          </td>
                          <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap", borderBottom: "1px solid #f1f5f9" }}>
                            {item.qty} ks
                          </td>
                          <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap", borderBottom: "1px solid #f1f5f9" }}>
                            {formatCzk(item.sale_price_per_piece)}
                          </td>
                          <td style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap", borderBottom: "1px solid #f1f5f9" }}>
                            {item.due_date ?? "—"}
                          </td>
                          <td
                            style={{
                              ...UI.td,
                              padding: "10px 10px",
                              borderBottom: "1px solid #f1f5f9",
                              fontWeight: 700,
                              color: relevantProductionOrders(item, orderKind).length > 0 ? "#15803d" : "#64748b",
                            }}
                          >
                            {formatVpCodes(item, orderKind)}
                          </td>
                          <td
                            style={{
                              ...UI.td,
                              padding: "10px 10px",
                              whiteSpace: "nowrap",
                              borderBottom: "1px solid #f1f5f9",
                              fontWeight: 900,
                              color: "#0f172a",
                            }}
                          >
                            {item.portfolio_item_id != null ? "Navázáno na portfolio" : "Bez vazby na portfolio"}
                          </td>
                          <td
                            style={{ ...UI.td, padding: "10px 10px", whiteSpace: "nowrap", borderBottom: "1px solid #f1f5f9" }}
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
                                style={UI.buttons.secondary}
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
                      ))}
                      {filteredItems.length === 0 ? (
                        <tr>
                          <td colSpan={8} style={{ ...UI.td, textAlign: "center", color: "#64748b", padding: "14px 10px" }}>
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
                      border: "1px solid #e2e8f0",
                      background: "#f8fafc",
                      fontSize: 13,
                      color: "#475569",
                      lineHeight: 1.5,
                    }}
                  >
                    <strong style={{ color: "#0f172a" }}>Výrobní příkazy</strong> se zakládají podle{" "}
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
        U uvedených položek už běží výroba na <strong>doplnění skladu</strong> (stejné GPN). Můžete buď nechat rozpracovanou
        výrobu čistě na sklad, nebo <strong>rezervovat</strong> její budoucí výstup pro zákazníka — bez změny zdrojového skladového
        VP; systém založí zákaznický tok ze skladu (Expedice) a paralelní interní doplnění skladu.
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
          const plan = line.reserve_wip_plan;
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
                <div>
                  Ve výrobě na doplnění skladu: <strong>{formatQty(wip.quantity_open)} ks</strong> (VP: {vpLabel})
                </div>
                {plan ? (
                  <div
                    style={{
                      marginTop: 8,
                      padding: "10px 12px",
                      borderRadius: 10,
                      background: "#f8fafc",
                      border: "1px solid #e2e8f0",
                      fontSize: 12,
                      color: "#334155",
                      lineHeight: 1.5,
                    }}
                  >
                    <div style={{ fontWeight: 800, marginBottom: 6 }}>Při volbě „Rezervovat WIP pro zákazníka“</div>
                    <div>Rezervace budoucího výstupu: <strong>{formatQty(plan.reserved_qty)} ks</strong></div>
                    <div>Zákaznický VP (sklad → zákazník, Expedice): <strong>{formatQty(plan.customer_sklad_zakaznik_qty)} ks</strong></div>
                    <div>Nové interní doplnění skladu: <strong>{formatQty(plan.replenishment_internal_qty)} ks</strong></div>
                    {plan.customer_vyroba_extra_qty > 0 ? (
                      <div>
                        Další výroba přímo pro zákazníka (nad rámec WIP):{" "}
                        <strong>{formatQty(plan.customer_vyroba_extra_qty)} ks</strong>
                      </div>
                    ) : null}
                    <div style={{ marginTop: 6 }}>Původní skladový VP zůstane beze změny (dokončí se Příjem na sklad).</div>
                  </div>
                ) : null}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 14 }}>
                <label style={{ display: "flex", alignItems: "flex-start", gap: 8, cursor: creatingVp ? "not-allowed" : "pointer" }}>
                  <input
                    type="radio"
                    name={`restock-strategy-${line.job_item_id}`}
                    checked={choice === "prefer_customer"}
                    onChange={() =>
                      setRestockChoices((prev) => ({ ...prev, [line.job_item_id]: "prefer_customer" }))
                    }
                    disabled={creatingVp}
                  />
                  <span>
                    <strong>Rezervovat rozpracované kusy pro zakázku</strong> — založí se rezervace budoucího výstupu z běžícího
                    skladového VP, zákaznický VP sklad_zakaznik (čeká na příjem na sklad) a paralelní interní doplnění skladu.
                    Skladový výrobní VP se nemění.
                  </span>
                </label>
                <label style={{ display: "flex", alignItems: "flex-start", gap: 8, cursor: "pointer" }}>
                  <input
                    type="radio"
                    name={`restock-strategy-${line.job_item_id}`}
                    checked={choice === "prefer_stock"}
                    onChange={() => setRestockChoices((prev) => ({ ...prev, [line.job_item_id]: "prefer_stock" }))}
                    disabled={creatingVp}
                  />
                  <span>
                    <strong>Přednost skladu</strong> — nechat rozpracovanou výrobu na doplnění skladu; pro zakázku založit
                    samostatnou výrobu.
                  </span>
                </label>
              </div>
            </div>
          );
        })}
      </div>
    </SimpleModal>
    </>
  );
}
