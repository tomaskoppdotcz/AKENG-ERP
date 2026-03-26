import React, { useState } from "react";
import { UI } from "../styles/ui";
import { scanLookup, type ScanLookupResponse } from "../services/scanLookupApi";

type Props = {
  onNavigateToTarget: (result: ScanLookupResponse) => void;
};

export default function ScanLookupPage({ onNavigateToTarget }: Props) {
  const [value, setValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ScanLookupResponse | null>(null);

  async function handleLookup() {
    const code = value.trim();
    if (!code) {
      setError("Zadejte scan kód.");
      setResult(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await scanLookup(code);
      setResult(res);
    } catch (e: unknown) {
      setResult(null);
      setError(e instanceof Error ? e.message : "Nepodařilo se vyhledat scan kód.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ paddingTop: 10 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <div style={UI.pageTitle}>Scan lookup</div>
          <div style={UI.sectionSubtitle}>Vyhledání cíle podle scan kódu</div>
        </div>
        <div style={{ ...UI.card, borderRadius: 14 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              style={{ ...UI.inputs.base, flex: "1 1 360px" }}
              placeholder="Např. WO-000001, WOO-000001, ORI-000001…"
            />
            <button type="button" style={UI.buttons.primary} onClick={handleLookup} disabled={loading}>
              {loading ? "Vyhledávám..." : "Najít"}
            </button>
          </div>
          {error ? <div style={{ marginTop: 10, color: "#991b1b", fontWeight: 700 }}>{error}</div> : null}
        </div>
        {result ? (
          <div style={{ ...UI.card, borderRadius: 14 }}>
            <div style={{ fontWeight: 900, color: "#0f172a", marginBottom: 8 }}>Výsledek</div>
            <div style={{ fontSize: 14, color: "#334155", marginBottom: 6 }}>
              <b>Kód:</b> {result.scan_code}
            </div>
            <div style={{ fontSize: 14, color: "#334155", marginBottom: 6 }}>
              <b>Typ:</b> {result.entity_type}
            </div>
            <div style={{ fontSize: 14, color: "#334155", marginBottom: 12 }}>
              <b>Label:</b> {result.label}
            </div>
            <button type="button" style={UI.buttons.secondary} onClick={() => onNavigateToTarget(result)}>
              Otevřít cíl
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
