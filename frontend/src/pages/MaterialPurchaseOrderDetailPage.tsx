import React, { useCallback, useEffect, useState } from "react";
import DetailPageHeader from "../components/DetailPageHeader";
import { UI } from "../styles/ui";
import {
  MATERIAL_PURCHASE_STATUSES,
  getMaterialPurchaseOrder,
  patchMaterialPurchaseOrderStatus,
  type MaterialPurchaseOrderDetail,
} from "../services/materialPurchaseApi";

const statusLabel: Record<string, string> = {
  draft: "Koncept",
  ordered: "Objednáno",
  confirmed: "Potvrzeno",
  received: "Přijato",
  cancelled: "Zrušeno",
};

function formatQty(n: number): string {
  if (n == null || Number.isNaN(n)) return "0";
  return n.toLocaleString("cs-CZ", { maximumFractionDigits: 3 });
}

function formatDate(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 19).replace("T", " ");
  return d.toLocaleString("cs-CZ", { dateStyle: "medium", timeStyle: "short" });
}

type Props = {
  materialPurchaseOrderId: number;
  onBack: () => void;
  onWorkspaceTabTitle?: (title: string) => void;
};

export default function MaterialPurchaseOrderDetailPage({
  materialPurchaseOrderId,
  onBack,
  onWorkspaceTabTitle,
}: Props) {
  const [data, setData] = useState<MaterialPurchaseOrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusDraft, setStatusDraft] = useState<string>("draft");
  const [statusBusy, setStatusBusy] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await getMaterialPurchaseOrder(materialPurchaseOrderId);
      setData(r);
      setStatusDraft(r.status);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Načtení se nepodařilo.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [materialPurchaseOrderId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!data) return;
    onWorkspaceTabTitle?.(`${data.order_number} · ${data.supplier_name}`);
  }, [data, onWorkspaceTabTitle]);

  async function saveStatus() {
    if (!data) return;
    const next = statusDraft.trim().toLowerCase();
    if (next === data.status) return;
    setStatusBusy(true);
    setStatusError(null);
    try {
      await patchMaterialPurchaseOrderStatus(materialPurchaseOrderId, next);
      await load();
    } catch (e: unknown) {
      setStatusError(e instanceof Error ? e.message : "Změna stavu se nepodařila.");
    } finally {
      setStatusBusy(false);
    }
  }

  if (loading) {
    return (
      <div style={{ paddingTop: 10 }}>
        <div style={{ ...UI.card, padding: 24, borderRadius: 14 }}>
          <div style={UI.sectionSubtitle}>Načítám objednávku…</div>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div style={{ paddingTop: 10 }}>
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
          <button type="button" style={UI.buttons.secondary} onClick={onBack}>
            Zavřít záložku
          </button>
        </div>
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
          {error ?? "Objednávku se nepodařilo zobrazit."}
        </div>
      </div>
    );
  }

  return (
    <div style={{ ...UI.container, paddingTop: 10 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <DetailPageHeader
          title={data.order_number}
          subtitle={`${data.supplier_name} · vytvořeno ${formatDate(data.created_at)}`}
          actions={
            <button type="button" style={UI.buttons.secondary} onClick={onBack}>
              Zavřít záložku
            </button>
          }
          context={
            <div>
              <div style={UI.detailPageHeaderContextGrid}>
                <div>
                  <div style={UI.statLabel}>Dodavatel</div>
                  <div style={{ ...UI.statValue, marginTop: 4 }}>{data.supplier_name}</div>
                </div>
                <div>
                  <div style={UI.statLabel}>Vytvořeno</div>
                  <div style={{ ...UI.statValue, marginTop: 4 }}>{formatDate(data.created_at)}</div>
                </div>
                <div>
                  <div style={UI.statLabel}>Stav objednávky</div>
                  <div style={{ ...UI.statValue, marginTop: 4 }}>{statusLabel[data.status] ?? data.status}</div>
                </div>
              </div>
              <div style={{ marginTop: 16, display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
                <span style={{ fontSize: 12, fontWeight: 800, color: "#374151" }}>Změna stavu</span>
                <select
                  value={statusDraft}
                  onChange={(e) => setStatusDraft(e.target.value)}
                  style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid #d1d5db", minWidth: 200 }}
                >
                  {MATERIAL_PURCHASE_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {statusLabel[s] ?? s}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  style={UI.buttons.primary}
                  onClick={() => void saveStatus()}
                  disabled={statusBusy || statusDraft === data.status}
                >
                  {statusBusy ? "Ukládám…" : "Uložit stav"}
                </button>
              </div>
              {statusError ? (
                <div style={{ marginTop: 10, color: "#b91c1c", fontWeight: 700, fontSize: 13 }}>{statusError}</div>
              ) : null}
            </div>
          }
        />

      {data.header_note && (
        <div style={{ ...UI.card, padding: 16, borderRadius: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: "#6b7280", textTransform: "uppercase" }}>
            Poznámka / stopa z požadavků
          </div>
          <div style={{ marginTop: 8, whiteSpace: "pre-wrap", lineHeight: 1.45 }}>{data.header_note}</div>
        </div>
      )}

      <div style={{ ...UI.card, padding: 0, overflow: "auto", borderRadius: 14 }}>
        <div style={{ padding: "14px 16px", borderBottom: "1px solid #e5e7eb", fontWeight: 800 }}>Řádky</div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid #e5e7eb", background: "#f9fafb" }}>
              <th style={{ padding: "10px 14px", fontWeight: 800 }}>Kód</th>
              <th style={{ padding: "10px 14px", fontWeight: 800 }}>Materiál</th>
              <th style={{ padding: "10px 14px", fontWeight: 800 }}>Množství</th>
              <th style={{ padding: "10px 14px", fontWeight: 800 }}>Jed.</th>
              <th style={{ padding: "10px 14px", fontWeight: 800 }}>Stopa / zdroj</th>
            </tr>
          </thead>
          <tbody>
            {data.lines.map((ln) => (
              <tr key={ln.id} style={{ borderBottom: "1px solid #f3f4f6", verticalAlign: "top" }}>
                <td style={{ padding: "10px 14px", fontWeight: 700 }}>{ln.material.code ?? "—"}</td>
                <td style={{ padding: "10px 14px" }}>
                  <div style={{ fontWeight: 700 }}>{ln.material.name ?? "—"}</div>
                  {ln.material.dimension ? (
                    <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>{ln.material.dimension}</div>
                  ) : null}
                </td>
                <td style={{ padding: "10px 14px" }}>{formatQty(ln.qty_ordered)}</td>
                <td style={{ padding: "10px 14px" }}>{ln.unit ?? ln.material.unit ?? "—"}</td>
                <td style={{ padding: "10px 14px", maxWidth: 360, whiteSpace: "pre-wrap", lineHeight: 1.4 }}>
                  {ln.traceability_note?.trim() ? ln.traceability_note : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      </div>
    </div>
  );
}
