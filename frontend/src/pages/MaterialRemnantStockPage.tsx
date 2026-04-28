import React, { useEffect, useMemo, useState } from "react";
import PageContainer from "../components/layout/PageContainer";
import PageHeader from "../components/layout/PageHeader";
import PageSection from "../components/layout/PageSection";
import { UI } from "../styles/ui";
import {
  disposeMaterialRemnantStockItem,
  getMaterialRemnantStockItems,
  type MaterialRemnantStockItem,
} from "../services/materialStockApi";

function formatDate(dateIso: string | null): string {
  if (!dateIso) return "-";
  const d = new Date(dateIso);
  if (Number.isNaN(d.getTime())) return dateIso;
  return d.toLocaleString("cs-CZ");
}

function formatQty(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "0";
  return n.toLocaleString("cs-CZ", { maximumFractionDigits: 3 });
}

function formatReceiptUnitCode(id: number | null | undefined): string {
  return id == null ? "-" : `RU-${String(id).padStart(6, "0")}`;
}

function formatRemnantCode(id: number | null | undefined): string {
  return id == null ? "-" : `ZB-${String(id).padStart(6, "0")}`;
}

function sourceReceiptUnitTrace(row: MaterialRemnantStockItem): string {
  const code = row.source_receipt_unit_code?.trim() || formatReceiptUnitCode(row.source_receipt_unit_id);
  return row.received_at ? `${code} · ${formatDate(row.received_at)}` : code;
}

export default function MaterialRemnantStockPage() {
  const [rows, setRows] = useState<MaterialRemnantStockItem[]>([]);
  const [statusFilter, setStatusFilter] = useState<"active" | "all" | "consumed" | "scrapped">("active");
  const [loading, setLoading] = useState(false);
  const [disposingRemnantId, setDisposingRemnantId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      setRows(await getMaterialRemnantStockItems(statusFilter === "all" ? undefined : { status: statusFilter }));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Nepodařilo se načíst sklad zbytků.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, [statusFilter]);

  async function handleDisposeRemnant(row: MaterialRemnantStockItem) {
    const qty = Number(row.qty || 0);
    if (row.status !== "active" || qty <= 0) return;
    const code = row.remnant_code?.trim() || formatRemnantCode(row.id);
    const unit = row.uom?.trim() || "mm";
    const ok = window.confirm(
      `Opravdu chcete zlikvidovat zbytek ${code}?\n\nZbytek ${formatQty(qty)} ${unit}, tavba ${row.heat_lot || "-"}, atest ${row.certificate_no || "-"} bude vyřazen ze skladu zbytků. Akce zůstane v auditní stopě.`
    );
    if (!ok) return;

    setDisposingRemnantId(row.id);
    setError(null);
    setSuccessMessage(null);
    try {
      const res = await disposeMaterialRemnantStockItem(row.id);
      await loadData();
      setSuccessMessage(res.message || `Zbytek ${code} byl zlikvidován.`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Nepodařilo se zlikvidovat zbytek.");
    } finally {
      setDisposingRemnantId(null);
    }
  }

  const activeCount = useMemo(() => rows.filter((r) => r.status === "active").length, [rows]);
  const activeQty = useMemo(
    () => rows.filter((r) => r.status === "active").reduce((sum, r) => sum + Number(r.qty || 0), 0),
    [rows]
  );

  return (
    <PageContainer className="erp-overview-page" style={{ paddingTop: 10 }}>
      <PageHeader
        title="Sklad zbytků"
        subtitle="Oddělená evidence zbytků přesunutých z hlavního skladu materiálu"
        actions={
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as "active" | "all" | "consumed" | "scrapped")}
              style={{ ...UI.inputs.base, width: 150 }}
              disabled={loading}
            >
              <option value="active">Aktivní</option>
              <option value="all">Vše</option>
              <option value="consumed">Spotřebované</option>
              <option value="scrapped">Zlikvidované</option>
            </select>
            <button type="button" style={UI.buttons.secondary} onClick={() => void loadData()} disabled={loading}>
              Obnovit
            </button>
          </div>
        }
      />

      <div style={UI.summaryTilesGridOuter}>
        <div style={UI.summaryTilesGridThree}>
          <div style={{ ...UI.overviewKpiTile, borderLeftColor: "#047857" }}>
            <div style={UI.overviewKpiLabel}>Aktivní zbytky</div>
            <div style={{ ...UI.overviewKpiValue, fontSize: 31 }}>{activeCount}</div>
            <div style={UI.overviewKpiHint}>Položky připravené pro budoucí použití.</div>
          </div>
          <div style={{ ...UI.overviewKpiTile, borderLeftColor: UI.colors.neutralFg }}>
            <div style={UI.overviewKpiLabel}>Aktivní množství</div>
            <div style={{ ...UI.overviewKpiValue, fontSize: 31 }}>{formatQty(activeQty)} mm</div>
            <div style={UI.overviewKpiHint}>Zbytky se zatím nepoužívají v alokaci.</div>
          </div>
          <div style={{ ...UI.overviewKpiTile, borderLeftColor: UI.colors.primary }}>
            <div style={UI.overviewKpiLabel}>Celkem řádků</div>
            <div style={{ ...UI.overviewKpiValue, fontSize: 31 }}>{rows.length}</div>
            <div style={UI.overviewKpiHint}>Auditní stopa přesunů z hlavního skladu.</div>
          </div>
        </div>
      </div>

      <PageSection gapTop={16}>
        <div style={UI.overviewMainCard}>
          <div style={UI.overviewCardHeaderBand}>
            <div style={UI.sectionTitle}>Položky skladu zbytků</div>
            <div style={UI.sectionSubtitle}>
              Remnant položky jsou jen evidované. Výdejový algoritmus je zatím ignoruje.
            </div>
          </div>

          {loading ? <div style={{ padding: 16, color: "#64748b" }}>Načítám sklad zbytků...</div> : null}
          {error ? <div style={{ padding: 16, color: "#b91c1c", fontWeight: 800 }}>{error}</div> : null}
          {successMessage ? <div style={{ padding: "0 16px 12px", color: "#047857", fontWeight: 800 }}>{successMessage}</div> : null}

          {!loading ? (
            <div style={{ overflowX: "auto" }}>
              <table style={UI.table}>
                <thead>
                  <tr style={{ background: "#f8fafc" }}>
                    {[
                      "ID zbytku",
                      "Kód materiálu",
                      "Materiál",
                      "Rozměr",
                      "Množství",
                      "Jednotka",
                      "Tavba",
                      "Atest",
                      "Zdrojová tyč",
                      "Původní příjem",
                      "Stav",
                      "Akce",
                    ].map((h) => (
                      <th key={h} style={{ ...UI.th, fontSize: 12, padding: "10px 8px", whiteSpace: "nowrap" }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const canDispose = row.status === "active" && Number(row.qty || 0) > 0;
                    const isDisposing = disposingRemnantId === row.id;
                    return (
                      <tr key={row.id}>
                        <td style={{ ...UI.td, padding: "10px 8px", whiteSpace: "nowrap", fontWeight: 900 }}>
                          {row.remnant_code?.trim() || formatRemnantCode(row.id)}
                        </td>
                        <td style={{ ...UI.td, padding: "10px 8px", fontWeight: 900 }}>{row.material_code || "-"}</td>
                        <td style={{ ...UI.td, padding: "10px 8px", maxWidth: 220 }}>{row.material_name || "-"}</td>
                        <td style={{ ...UI.td, padding: "10px 8px", whiteSpace: "nowrap" }}>
                          {row.material_dimension || "-"}
                        </td>
                        <td style={{ ...UI.td, padding: "10px 8px", whiteSpace: "nowrap", fontWeight: 900 }}>
                          {formatQty(row.qty)}
                        </td>
                        <td style={{ ...UI.td, padding: "10px 8px" }}>{row.uom || "mm"}</td>
                        <td style={{ ...UI.td, padding: "10px 8px" }}>{row.heat_lot || "-"}</td>
                        <td style={{ ...UI.td, padding: "10px 8px" }}>{row.certificate_no || "-"}</td>
                        <td style={{ ...UI.td, padding: "10px 8px", whiteSpace: "nowrap", fontWeight: 900 }}>
                          {row.source_receipt_unit_code?.trim() || formatReceiptUnitCode(row.source_receipt_unit_id)}
                        </td>
                        <td style={{ ...UI.td, padding: "10px 8px", whiteSpace: "nowrap" }}>
                          {sourceReceiptUnitTrace(row)}
                        </td>
                        <td style={{ ...UI.td, padding: "10px 8px", whiteSpace: "nowrap" }}>{row.status || "-"}</td>
                        <td style={{ ...UI.td, padding: "10px 8px", whiteSpace: "nowrap" }}>
                          <button
                            type="button"
                            style={{ ...UI.buttons.secondary, ...(!canDispose || isDisposing ? { opacity: 0.6, cursor: "not-allowed" } : {}) }}
                            disabled={!canDispose || isDisposing}
                            onClick={() => handleDisposeRemnant(row)}
                          >
                            {isDisposing ? "Likviduji..." : "Zlikvidovat"}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={12} style={{ ...UI.td, textAlign: "center", color: "#64748b", padding: "14px 10px" }}>
                        Ve skladu zbytků zatím nejsou žádné položky.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      </PageSection>
    </PageContainer>
  );
}
