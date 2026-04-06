import React, { useState } from "react";
import { UI } from "../styles/ui";
import { scanLookup, type ScanLookupResponse } from "../services/scanLookupApi";

type Props = {
  onResolve: (result: ScanLookupResponse) => void;
};

export default function GlobalShellScanLookup({ onResolve }: Props) {
  const [value, setValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runLookup() {
    const code = value.trim();
    if (!code) {
      setError("Zadejte kód.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await scanLookup(code);
      onResolve(res);
      setValue("");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Vyhledávání se nezdařilo.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-end",
        gap: 4,
        minWidth: 200,
        maxWidth: 420,
        flex: "0 1 420px",
      }}
    >
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", width: "100%", justifyContent: "flex-end" }}>
        <input
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            if (error) setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void runLookup();
            }
          }}
          disabled={loading}
          placeholder="Scan / GPN / kód…"
          style={{ ...UI.inputs.base, flex: "1 1 160px", minWidth: 140, maxWidth: 280 }}
          aria-label="Globální vyhledání kódu"
        />
        <button type="button" style={UI.buttons.secondary} onClick={() => void runLookup()} disabled={loading}>
          {loading ? "…" : "Otevřít"}
        </button>
      </div>
      {error ? (
        <div style={{ fontSize: 12, fontWeight: 700, color: "#b91c1c", textAlign: "right", maxWidth: "100%" }}>{error}</div>
      ) : null}
    </div>
  );
}
