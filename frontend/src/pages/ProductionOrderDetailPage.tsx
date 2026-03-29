import React, { useEffect, useState } from "react";
import { UI } from "../styles/ui";
import {
  getProductionOrderDetail,
  reportProductionOrderOperation,
  startProductionOrderOperation,
  type ProductionOrderDetail,
} from "../services/productionOrdersApi";
import { buildErpUrl } from "../utils/erpDeepLink";

const API_URL =
  (import.meta as any).env?.VITE_API_BASE_URL || "http://127.0.0.1:8000";

const linkButtonReset: React.CSSProperties = {
  background: "none",
  border: "none",
  padding: 0,
  margin: 0,
  cursor: "pointer",
  font: "inherit",
  color: "#2563eb",
  textDecoration: "underline",
  textUnderlineOffset: "3px",
  fontSize: "inherit",
  fontWeight: 800,
};

type Props = {
  productionOrderId: number;
  onBack: () => void;
  onWorkspaceTabTitle?: (title: string) => void;
  onOpenPortfolioItemId?: (portfolioItemId: number) => void;
  onOpenCustomerOrderCard?: (customerOrderId: number) => void;
  onPreviewPortfolioById?: (portfolioItemId: number) => void;
};

function labelLogisticMode(v: string | null | undefined): string {
  if (!v) return "—";
  if (v === "sklad") return "Sklad";
  if (v === "sklad_zakaznik") return "Sklad -> zákazník";
  if (v === "vyroba_zakaznik") return "Výroba -> zákazník";
  return v;
}

function labelSourceType(v: string | null | undefined): string {
  if (!v) return "—";
  if (v === "stock_allocation") return "Ze skladu";
  if (v === "order_allocation") return "Výroba pro zakázku";
  if (v === "restock_allocation") return "Doplnění skladu";
  return v;
}

function labelOrderType(v: string | null | undefined): string {
  return v === "internal" ? "Interní zakázka" : "Zakázka";
}

export default function ProductionOrderDetailPage({
  productionOrderId,
  onBack,
  onWorkspaceTabTitle,
  onOpenPortfolioItemId,
  onOpenCustomerOrderCard,
  onPreviewPortfolioById,
}: Props) {
  const [data, setData] = useState<ProductionOrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [opActionError, setOpActionError] = useState<string | null>(null);
  const [busyOp, setBusyOp] = useState<number | null>(null);
  const [okByOp, setOkByOp] = useState<Record<number, string>>({});
  const [nokByOp, setNokByOp] = useState<Record<number, string>>({});
  const [minutesByOp, setMinutesByOp] = useState<Record<number, string>>({});
  const [noteByOp, setNoteByOp] = useState<Record<number, string>>({});

  async function loadDetail() {
    setLoading(true);
    setError(null);
    const r = await getProductionOrderDetail(productionOrderId);
    setData(r);
  }

  useEffect(() => {
    let cancelled = false;
    loadDetail()
      .then(() => {
        if (cancelled) return;
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Nepodařilo se načíst detail VP.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [productionOrderId]);

  useEffect(() => {
    if (!onWorkspaceTabTitle || !data) return;
    const code = data.vp_code?.trim();
    onWorkspaceTabTitle(code || `VP · #${productionOrderId}`);
  }, [data, productionOrderId, onWorkspaceTabTitle]);

  async function handleStartOperation(operationNo: number) {
    setOpActionError(null);
    setBusyOp(operationNo);
    try {
      await startProductionOrderOperation(productionOrderId, operationNo);
      await loadDetail();
    } catch (e: unknown) {
      setOpActionError(e instanceof Error ? e.message : "Nepodařilo se zahájit operaci.");
    } finally {
      setBusyOp(null);
    }
  }

  async function handleReportOperation(operationNo: number) {
    setOpActionError(null);
    setBusyOp(operationNo);
    const ok_qty = Math.max(0, Number(okByOp[operationNo] ?? 0) || 0);
    const nok_qty = Math.max(0, Number(nokByOp[operationNo] ?? 0) || 0);
    const reported_minutes = Math.max(0, Number(minutesByOp[operationNo] ?? 0) || 0);
    const note = (noteByOp[operationNo] ?? "").trim() || null;
    try {
      await reportProductionOrderOperation(productionOrderId, operationNo, {
        ok_qty,
        nok_qty,
        reported_minutes,
        note,
      });
      await loadDetail();
    } catch (e: unknown) {
      setOpActionError(e instanceof Error ? e.message : "Nepodařilo se odvést operaci.");
    } finally {
      setBusyOp(null);
    }
  }

  if (loading) {
    return (
      <div style={UI.container}>
        <div style={{ ...UI.card, borderRadius: 14 }}>
          <div style={UI.sectionSubtitle}>Načítám detail výrobního příkazu…</div>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div style={UI.container}>
        <button onClick={onBack} style={UI.buttonSecondary}>
          Zpět na výrobní příkazy
        </button>
        <div style={{ ...UI.card, borderRadius: 14, marginTop: 12, color: "#991b1b", border: "1px solid #fecaca", background: "#fef2f2" }}>
          {error ?? "Detail výrobního příkazu není dostupný."}
        </div>
      </div>
    );
  }

  const summary: Array<[string, string]> = [
    ["VP", data.vp_code],
    [labelOrderType(data.order_type), data.zakazka ?? "—"],
    ["Řádek", data.line_no != null ? String(data.line_no) : "—"],
    ["GPN", data.gpn ?? "—"],
    ["Název", data.description ?? "—"],
    ["Portfolio varianta", data.portfolio_item_name ? `${data.portfolio_item_name} (ID ${data.portfolio_item_id})` : "—"],
    ["Logistický režim", labelLogisticMode(data.logistic_mode)],
    ["Typ zdroje", labelSourceType(data.source_type)],
    ["Stav", data.status ?? "—"],
    ["Množství", `${data.quantity} ks`],
  ];
  const zakazkaTileLabel = labelOrderType(data.order_type);

  return (
    <div style={UI.container}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <div>
            <div style={UI.pageTitle}>Detail výrobního příkazu</div>
            <div style={UI.sectionSubtitle}>Karta VP a navázaný technologický postup</div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => window.open(`${API_URL}/production-orders/${productionOrderId}/print`, "_blank")}
              style={UI.buttonPrimary}
            >
              Tisk VP
            </button>
            <button
              type="button"
              style={UI.buttons.secondary}
              onClick={() =>
                window.open(buildErpUrl({ view: "productionOrder", productionOrderId }), "_blank")
              }
            >
              Otevřít v novém okně
            </button>
            {data.portfolio_item_id != null && onPreviewPortfolioById ? (
              <button type="button" style={UI.buttons.secondary} onClick={() => onPreviewPortfolioById(data.portfolio_item_id!)}>
                Náhled portfolia
              </button>
            ) : null}
            <button onClick={onBack} style={UI.buttonSecondary}>
              Zpět na výrobní příkazy
            </button>
          </div>
        </div>

        <div style={UI.summaryTilesGrid}>
          {summary.map(([k, v]) => (
            <div key={k} style={{ ...UI.summaryTile, flex: "1 1 220px" }}>
              <div style={UI.summaryTileLabel}>{k}</div>
              <div style={{ ...UI.summaryTileValue, fontSize: 18 }}>
                {k === "GPN" &&
                data.portfolio_item_id != null &&
                onOpenPortfolioItemId &&
                v !== "—" ? (
                  <button type="button" style={linkButtonReset} onClick={() => onOpenPortfolioItemId(data.portfolio_item_id!)}>
                    {v}
                  </button>
                ) : k === zakazkaTileLabel &&
                  data.customer_order_id != null &&
                  onOpenCustomerOrderCard &&
                  v !== "—" ? (
                  <button
                    type="button"
                    style={linkButtonReset}
                    onClick={() => onOpenCustomerOrderCard(data.customer_order_id!)}
                  >
                    {v}
                  </button>
                ) : (
                  v
                )}
              </div>
            </div>
          ))}
        </div>

        <div style={{ ...UI.card, borderRadius: 14 }}>
          <div style={{ fontSize: 16, fontWeight: 900, color: "#0f172a", marginBottom: 10 }}>Technologický postup VP</div>
          {opActionError ? (
            <div style={{ marginBottom: 10, color: "#991b1b", fontWeight: 700 }}>{opActionError}</div>
          ) : null}
          {data.operations.length === 0 ? (
            <div style={{ color: "#64748b", fontWeight: 600 }}>Pro tuto portfolio variantu není k dispozici technologický postup.</div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={UI.table}>
                <thead>
                  <tr style={{ background: "#f8fafc" }}>
                    {["Pořadí", "Operace", "Pracoviště", "Setup (min)", "Čas / ks (min)", "Stav", "Odvedeno", "Akce", "Poznámka"].map((h) => (
                      <th key={h} style={{ ...UI.th, whiteSpace: "nowrap" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.operations.map((op) => (
                    <tr key={op.id}>
                      <td style={UI.td}>{op.operation_no}</td>
                      <td style={UI.td}>{op.operation_name}</td>
                      <td style={UI.td}>{op.workplace_name ?? "—"}</td>
                      <td style={UI.td}>{op.setup_time_min}</td>
                      <td style={UI.td}>{op.run_min_per_piece}</td>
                      <td style={UI.td}>
                        {op.operation_status === "done" ? "done" : op.operation_status === "in_progress" ? "in_progress" : "planned"}
                      </td>
                      <td style={UI.td}>
                        OK {op.reported_ok_qty_total ?? 0} / NOK {op.reported_nok_qty_total ?? 0} / {op.reported_minutes_total ?? 0} min
                      </td>
                      <td style={{ ...UI.td, minWidth: 330 }}>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                          <button
                            type="button"
                            style={UI.buttons.secondary}
                            disabled={busyOp === op.operation_no}
                            onClick={() => handleStartOperation(op.operation_no)}
                          >
                            Zahájit
                          </button>
                          <input
                            style={{ ...UI.inputs.base, width: 70, padding: "6px 8px" }}
                            placeholder="OK"
                            value={okByOp[op.operation_no] ?? ""}
                            onChange={(e) => setOkByOp((s) => ({ ...s, [op.operation_no]: e.target.value }))}
                          />
                          <input
                            style={{ ...UI.inputs.base, width: 70, padding: "6px 8px" }}
                            placeholder="NOK"
                            value={nokByOp[op.operation_no] ?? ""}
                            onChange={(e) => setNokByOp((s) => ({ ...s, [op.operation_no]: e.target.value }))}
                          />
                          <input
                            style={{ ...UI.inputs.base, width: 90, padding: "6px 8px" }}
                            placeholder="Min"
                            value={minutesByOp[op.operation_no] ?? ""}
                            onChange={(e) => setMinutesByOp((s) => ({ ...s, [op.operation_no]: e.target.value }))}
                          />
                          <button
                            type="button"
                            style={UI.buttons.primary}
                            disabled={busyOp === op.operation_no}
                            onClick={() => handleReportOperation(op.operation_no)}
                          >
                            Odvést
                          </button>
                        </div>
                      </td>
                      <td style={UI.td}>{op.note ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div style={{ ...UI.card, borderRadius: 14 }}>
          <div style={{ fontSize: 16, fontWeight: 900, color: "#0f172a", marginBottom: 10 }}>Vstupy VP</div>
          {data.inputs.length === 0 ? (
            <div style={{ color: "#64748b", fontWeight: 600 }}>Pro tuto portfolio variantu nejsou definované vstupy.</div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={UI.table}>
                <thead>
                  <tr style={{ background: "#f8fafc" }}>
                    {["Typ", "Materiál / Produkt", "Kód / GPN", "Spotřeba / ks", "Prořez", "Poznámka"].map((h) => (
                      <th key={h} style={{ ...UI.th, whiteSpace: "nowrap" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.inputs.map((inp) => (
                    <tr key={inp.id}>
                      <td style={UI.td}>{inp.input_type === "product_stock" ? "Produkt ze skladu" : "Materiál"}</td>
                      <td style={UI.td}>{inp.material_name ?? inp.portfolio_item_name ?? "—"}</td>
                      <td style={UI.td}>{inp.material_code ?? inp.portfolio_item_gpn ?? "—"}</td>
                      <td style={UI.td}>
                        {inp.consumption_per_piece}
                        {inp.consumption_unit ? ` ${inp.consumption_unit}` : ""}
                      </td>
                      <td style={UI.td}>{inp.scrap_allowance}</td>
                      <td style={UI.td}>{inp.note ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
