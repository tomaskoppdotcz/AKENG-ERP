import React, { useCallback, useEffect, useState } from "react";
import { UI } from "../styles/ui";
import {
  listMaterialPurchaseOrders,
  type MaterialPurchaseOrderListRow,
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
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleString("cs-CZ", { dateStyle: "short", timeStyle: "short" });
}

type Props = {
  onOpenPurchaseOrderInWorkspaceTab: (materialPurchaseOrderId: number, titleHint?: string) => void;
};

export default function MaterialPurchaseOrdersPage({ onOpenPurchaseOrderInWorkspaceTab }: Props) {
  const [rows, setRows] = useState<MaterialPurchaseOrderListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const items = await listMaterialPurchaseOrders();
      setRows(items);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Načtení se nepodařilo.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div style={UI.container}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div>
          <div style={UI.sectionTitle}>Nákup materiálu</div>
          <div style={UI.sectionSubtitle}>Objednávky vytvořené z požadavků materiálu (NMPO).</div>
        </div>
        <button type="button" style={UI.buttons.secondary} onClick={() => void load()} disabled={loading}>
          Obnovit
        </button>
      </div>

      {error && (
        <div
          style={{
            marginTop: 16,
            padding: 14,
            borderRadius: 12,
            border: "1px solid #fecaca",
            background: "#fef2f2",
            color: "#991b1b",
            fontWeight: 700,
          }}
        >
          {error}
        </div>
      )}

      <div style={{ ...UI.card, marginTop: 18, padding: 0, overflow: "auto", borderRadius: 14 }}>
        {loading ? (
          <div style={{ padding: 24 }}>
            <div style={UI.sectionSubtitle}>Načítám…</div>
          </div>
        ) : rows.length === 0 ? (
          <div style={{ padding: 24 }}>
            <div style={UI.sectionSubtitle}>Zatím žádné nákupní objednávky materiálu.</div>
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid #e5e7eb", background: "#f9fafb" }}>
                <th style={{ padding: "10px 14px", fontWeight: 800 }}>Číslo</th>
                <th style={{ padding: "10px 14px", fontWeight: 800 }}>Dodavatel</th>
                <th style={{ padding: "10px 14px", fontWeight: 800 }}>Datum</th>
                <th style={{ padding: "10px 14px", fontWeight: 800 }}>Stav</th>
                <th style={{ padding: "10px 14px", fontWeight: 800 }}>Řádky</th>
                <th style={{ padding: "10px 14px", fontWeight: 800 }}>Σ množství</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.id}
                  style={{ borderBottom: "1px solid #f3f4f6", cursor: "pointer" }}
                  onClick={() =>
                    onOpenPurchaseOrderInWorkspaceTab(r.id, `${r.order_number} · ${r.supplier_name}`)
                  }
                >
                  <td style={{ padding: "10px 14px", fontWeight: 800, color: "#1d4ed8" }}>{r.order_number}</td>
                  <td style={{ padding: "10px 14px" }}>{r.supplier_name}</td>
                  <td style={{ padding: "10px 14px", whiteSpace: "nowrap" }}>{formatDate(r.created_at)}</td>
                  <td style={{ padding: "10px 14px" }}>{statusLabel[r.status] ?? r.status}</td>
                  <td style={{ padding: "10px 14px" }}>{r.lines_count}</td>
                  <td style={{ padding: "10px 14px" }}>{formatQty(r.total_qty_ordered)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
