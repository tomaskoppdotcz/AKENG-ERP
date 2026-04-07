import React, { useCallback, useEffect, useState } from "react";
import { ERP_NAV_GROUPS, type ErpNavGroup } from "../navigation/erpNavConfig";
import { applyNavOrder, type NavSidebarOrderMap } from "../navigation/applyNavOrder";
import { getNavSidebarOrder, putNavSidebarOrder } from "../services/navSidebarOrderApi";
import { UI } from "../styles/ui";

type Props = {
  onOrderSaved?: () => void;
};

/** Sloučí uložené pořadí s výchozím configem (doplní chybějící klíče na konec). */
function buildFullDraftMap(groups: ErpNavGroup[], saved: NavSidebarOrderMap): NavSidebarOrderMap {
  const out: NavSidebarOrderMap = {};
  for (const g of groups) {
    const defaultKeys = g.items.map((i) => i.moduleKey);
    const valid = new Set(defaultKeys);
    const fromSaved = saved[g.id] ?? [];
    const ordered: string[] = [];
    const seen = new Set<string>();
    for (const k of fromSaved) {
      if (valid.has(k) && !seen.has(k)) {
        ordered.push(k);
        seen.add(k);
      }
    }
    for (const k of defaultKeys) {
      if (!seen.has(k)) {
        ordered.push(k);
        seen.add(k);
      }
    }
    out[g.id] = ordered;
  }
  return out;
}

export default function NavSidebarOrderPage({ onOrderSaved }: Props) {
  const [draft, setDraft] = useState<NavSidebarOrderMap | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const saved = await getNavSidebarOrder();
      setDraft(buildFullDraftMap(ERP_NAV_GROUPS, saved));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Chyba načtení");
      setDraft(buildFullDraftMap(ERP_NAV_GROUPS, {}));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  function move(groupId: string, index: number, dir: -1 | 1) {
    setDraft((prev) => {
      if (!prev) return prev;
      const keys = [...(prev[groupId] ?? [])];
      const j = index + dir;
      if (j < 0 || j >= keys.length) return prev;
      [keys[index], keys[j]] = [keys[j], keys[index]];
      return { ...prev, [groupId]: keys };
    });
    setMessage(null);
  }

  async function save() {
    if (!draft) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await putNavSidebarOrder(draft);
      setMessage("Uloženo. Obnovte případně jiné záložky, aby se projevilo pořadí v postranní liště.");
      onOrderSaved?.();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Uložení selhalo");
    } finally {
      setSaving(false);
    }
  }

  const previewGroups = draft
    ? applyNavOrder(ERP_NAV_GROUPS, draft)
    : ERP_NAV_GROUPS;

  return (
    <div style={{ paddingTop: 18, maxWidth: 900 }}>
      <div style={UI.sectionTitle}>Pořadí navigace</div>
      <div style={UI.sectionSubtitle}>
        Globální pořadí podpoložek v postranní liště (všichni uživatelé). Výchozí pořadí je v kódu{" "}
        <code style={{ fontSize: 12 }}>ERP_NAV_GROUPS</code>.
      </div>

      {loading ? <div style={{ marginTop: 12, color: "#64748b", fontWeight: 600 }}>Načítám…</div> : null}

      {!loading && draft ? (
        <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 20 }}>
          {ERP_NAV_GROUPS.map((group) => {
            const keys = draft[group.id] ?? [];
            const labelByKey = new Map(group.items.map((i) => [i.moduleKey, i.label]));
            return (
              <div
                key={group.id}
                style={{
                  ...UI.card,
                  padding: 14,
                  borderRadius: 12,
                }}
              >
                <div style={{ fontWeight: 900, marginBottom: 10, color: "#0f172a" }}>{group.label}</div>
                <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                  {keys.map((moduleKey, idx) => (
                    <li
                      key={moduleKey}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "6px 0",
                        borderBottom: "1px solid #f1f5f9",
                      }}
                    >
                      <span style={{ flex: 1, fontWeight: 600 }}>{labelByKey.get(moduleKey) ?? moduleKey}</span>
                      <span style={{ fontSize: 11, color: "#94a3b8", fontFamily: "monospace" }}>{moduleKey}</span>
                      <button
                        type="button"
                        style={{ ...UI.buttons.secondary, padding: "4px 8px", fontSize: 12 }}
                        disabled={idx === 0}
                        onClick={() => move(group.id, idx, -1)}
                        aria-label="Posunout nahoru"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        style={{ ...UI.buttons.secondary, padding: "4px 8px", fontSize: 12 }}
                        disabled={idx >= keys.length - 1}
                        onClick={() => move(group.id, idx, 1)}
                        aria-label="Posunout dolů"
                      >
                        ↓
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      ) : null}

      {!loading && draft ? (
        <div style={{ marginTop: 16, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <button type="button" style={UI.buttons.primary} onClick={() => void save()} disabled={saving}>
            {saving ? "Ukládám…" : "Uložit pořadí"}
          </button>
          <button type="button" style={UI.buttons.secondary} onClick={() => void reload()} disabled={saving}>
            Znovu načíst ze serveru
          </button>
        </div>
      ) : null}

      {message ? <div style={{ marginTop: 12, color: "#15803d", fontWeight: 700 }}>{message}</div> : null}
      {error ? <div style={{ marginTop: 12, color: "#b91c1c", fontWeight: 700 }}>{error}</div> : null}

      {!loading && draft ? (
        <div style={{ marginTop: 24, opacity: 0.85 }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: "#64748b", marginBottom: 6 }}>Náhled (stejné jako po uložení)</div>
          <div style={{ fontSize: 12, color: "#475569" }}>
            {previewGroups.map((g) => (
              <div key={g.id} style={{ marginBottom: 8 }}>
                <strong>{g.label}:</strong> {g.items.map((i) => i.label).join(" → ")}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
