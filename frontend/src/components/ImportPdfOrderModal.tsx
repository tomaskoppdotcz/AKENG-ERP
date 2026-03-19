import React, { useState } from "react";
import { ImportPreviewLine, ImportPreviewResponse, previewImportPdf } from "../services/orderImportApi";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  onImported?: (customerOrderId?: number) => void;
};

export default function ImportPdfOrderModal({ isOpen, onClose, onImported }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreviewResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  if (!isOpen) return null;

  async function handlePreview() {
    if (!file) {
      setError("Vyber PDF soubor.");
      return;
    }
    try {
      setLoading(true);
      setError("");
      setMessage("");
      const result = await previewImportPdf(file);
      setPreview(result);
      setMessage("Import hotov."); // backend already persisted order
      if (onImported) {
        // We don't have explicit customer_order_id in this backend; let caller refresh.
        onImported(undefined);
      }
    } catch (e: any) {
      setError(e?.message || "Nepodarilo se nacist PDF.");
    } finally {
      setLoading(false);
    }
  }

  async function handleConfirm() {
    // No-op for now: import is already done during preview.
    setMessage("Import jiz byl proveden pri nacteni PDF.");
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15,23,42,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 2000,
      }}
    >
      <div
        style={{
          width: "90%",
          maxWidth: 900,
          maxHeight: "90vh",
          background: "#fff",
          borderRadius: 16,
          padding: 20,
          boxShadow: "0 20px 50px rgba(15,23,42,0.25)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 12,
          }}
        >
          <div>
            <div style={{ fontSize: 18, fontWeight: 900 }}>Import PDF objednavky</div>
            <div style={{ fontSize: 13, color: "#64748b", marginTop: 4 }}>
              Nejdrive udelej preview, pak potvrzeni importu.
            </div>
          </div>

          <button
            onClick={onClose}
            style={{
              border: "1px solid #cbd5e1",
              background: "#fff",
              color: "#0f172a",
              borderRadius: 10,
              padding: "8px 12px",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Zavrit
          </button>
        </div>

        <div style={{ display: "grid", gap: 12, marginBottom: 16 }}>
          <input
            type="file"
            accept="application/pdf"
            onChange={(e) => {
              const f = e.target.files?.[0] || null;
              setFile(f);
              setPreview(null);
              setError("");
              setMessage("");
            }}
          />

          <div style={{ display: "flex", gap: 10 }}>
            <button
              onClick={() => void handlePreview()}
              disabled={loading || !file}
              style={{
                border: "1px solid #0f172a",
                background: "#0f172a",
                color: "#fff",
                borderRadius: 10,
                padding: "9px 14px",
                fontWeight: 800,
                cursor: "pointer",
                opacity: loading || !file ? 0.6 : 1,
              }}
            >
              Preview
            </button>

            <button
              onClick={() => void handleConfirm()}
              disabled={loading || !preview?.preview_id}
              style={{
                border: "1px solid #15803d",
                background: "#15803d",
                color: "#fff",
                borderRadius: 10,
                padding: "9px 14px",
                fontWeight: 800,
                cursor: "pointer",
                opacity: loading || !preview?.preview_id ? 0.6 : 1,
              }}
            >
              Potvrdit import
            </button>
          </div>

          {error && (
            <div
              style={{
                padding: "8px 10px",
                borderRadius: 10,
                background: "#fef2f2",
                color: "#b91c1c",
                border: "1px solid #fecaca",
                fontSize: 13,
                fontWeight: 700,
              }}
            >
              {error}
            </div>
          )}

          {message && !error && (
            <div
              style={{
                padding: "8px 10px",
                borderRadius: 10,
                background: "#f0fdf4",
                color: "#15803d",
                border: "1px solid #bbf7d0",
                fontSize: 13,
                fontWeight: 700,
              }}
            >
              {message}
            </div>
          )}
        </div>

        <div
          style={{
            flex: 1,
            overflow: "auto",
            borderTop: "1px solid #e2e8f0",
            paddingTop: 10,
          }}
        >
          {!preview ? (
            <div style={{ fontSize: 13, color: "#64748b" }}>
              Zatim zadny preview. Nahraj PDF a klikni na Preview.
            </div>
          ) : preview.lines && preview.lines.length > 0 ? (
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: 12,
              }}
            >
              <thead>
                <tr style={{ background: "#f8fafc" }}>
                  {[
                    "Line",
                    "GPN",
                    "Popis",
                    "Termin",
                    "Qty",
                    "Cena/ks",
                    "Cena celkem",
                    "Portfolio",
                  ].map((h) => (
                    <th
                      key={h}
                      style={{
                        textAlign: "left",
                        padding: "6px 8px",
                        borderBottom: "1px solid #e2e8f0",
                        color: "#334155",
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.lines.map((line: ImportPreviewLine) => (
                  <tr key={line.line_no}>
                    <td style={{ padding: "6px 8px", borderBottom: "1px solid #f1f5f9" }}>
                      {line.line_no}
                    </td>
                    <td style={{ padding: "6px 8px", borderBottom: "1px solid #f1f5f9" }}>
                      {line.gpn}
                    </td>
                    <td style={{ padding: "6px 8px", borderBottom: "1px solid #f1f5f9" }}>
                      {line.description}
                    </td>
                    <td style={{ padding: "6px 8px", borderBottom: "1px solid #f1f5f9" }}>
                      {line.due_date}
                    </td>
                    <td style={{ padding: "6px 8px", borderBottom: "1px solid #f1f5f9" }}>
                      {line.qty}
                    </td>
                    <td style={{ padding: "6px 8px", borderBottom: "1px solid #f1f5f9" }}>
                      {line.sales_price_per_unit ?? "-"}
                    </td>
                    <td style={{ padding: "6px 8px", borderBottom: "1px solid #f1f5f9" }}>
                      {line.sales_price_total ?? "-"}
                    </td>
                    <td style={{ padding: "6px 8px", borderBottom: "1px solid #f1f5f9" }}>
                      {line.portfolio_match_type
                        ? `${line.portfolio_match_type} (${line.portfolio_template_gpn || ""})`
                        : "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div style={{ fontSize: 13, color: "#64748b" }}>
              Preview je prazdny nebo neobsahuje radky.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

