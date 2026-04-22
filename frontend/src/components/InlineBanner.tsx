import React, { useEffect } from "react";
import { ERP_COLORS } from "../styles/ui";

/**
 * AKENG ERP — inline banner pro write akce (Phase 1).
 *
 * Směr návrhu: kontrolovaná komponenta — rodič rozhoduje o vykreslení; dítě
 * pouze volá `onClose`. Žádný `open` / `visible`, žádný provider, žádný toast.
 * Volitelné `autoDismissAfterMs` (výchozí chování = bez auto-dismiss).
 */

export type InlineBannerKind = "success" | "info" | "warning" | "error";

export interface InlineBannerProps {
  kind: InlineBannerKind;
  message: string;
  /** Zavření banneru (dismiss). Když chybí, tlačítko Zavřít se nevykreslí. */
  onClose?: () => void;
  /** Po uplynutí intervalu zavolá `onClose` (jen pokud je `onClose` definováno). Výchozí = vypnuto. */
  autoDismissAfterMs?: number;
  style?: React.CSSProperties;
}

const ICON: Record<InlineBannerKind, string> = {
  success: "✓",
  info: "ℹ",
  warning: "⚠",
  error: "!",
};

const PALETTE: Record<
  InlineBannerKind,
  { fg: string; bg: string; border: string; iconBg: string }
> = {
  success: {
    fg: ERP_COLORS.okFg,
    bg: ERP_COLORS.okBg,
    border: "#86EFAC",
    iconBg: "rgba(22, 163, 74, 0.12)",
  },
  info: {
    fg: ERP_COLORS.primary,
    bg: ERP_COLORS.primaryLight,
    border: "#93C5FD",
    iconBg: "rgba(37, 99, 235, 0.1)",
  },
  warning: {
    fg: ERP_COLORS.waitFg,
    bg: ERP_COLORS.waitBg,
    border: "#FCD34D",
    iconBg: "rgba(245, 158, 11, 0.15)",
  },
  error: {
    fg: ERP_COLORS.problemFg,
    bg: ERP_COLORS.problemBg,
    border: "#FECACA",
    iconBg: "rgba(220, 38, 38, 0.1)",
  },
};

export default function InlineBanner({
  kind,
  message,
  onClose,
  autoDismissAfterMs,
  style,
}: InlineBannerProps) {
  const palette = PALETTE[kind];
  const isAlert = kind === "warning" || kind === "error";

  useEffect(() => {
    if (!onClose || autoDismissAfterMs == null || autoDismissAfterMs <= 0) return;
    const id = window.setTimeout(onClose, autoDismissAfterMs);
    return () => window.clearTimeout(id);
  }, [onClose, autoDismissAfterMs, message, kind]);

  return (
    <div
      role={isAlert ? "alert" : "status"}
      aria-live={isAlert ? "assertive" : "polite"}
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        padding: "10px 12px",
        borderRadius: 10,
        background: palette.bg,
        border: `1px solid ${palette.border}`,
        color: palette.fg,
        fontWeight: 700,
        fontSize: 13,
        lineHeight: 1.4,
        boxSizing: "border-box",
        ...style,
      }}
    >
      <span
        aria-hidden
        style={{
          flexShrink: 0,
          width: 22,
          height: 22,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 6,
          background: palette.iconBg,
          color: palette.fg,
          fontSize: 12,
          fontWeight: 900,
          lineHeight: 1,
          marginTop: 1,
        }}
      >
        {ICON[kind]}
      </span>
      <span style={{ flex: 1, minWidth: 0, wordBreak: "break-word", paddingTop: 1 }}>
        {message}
      </span>
      {onClose ? (
        <button
          type="button"
          onClick={onClose}
          aria-label="Zavřít hlášku"
          style={{
            marginTop: -1,
            padding: "4px 10px",
            fontSize: 11,
            fontWeight: 800,
            color: palette.fg,
            background: ERP_COLORS.card,
            border: `1px solid ${palette.border}`,
            borderRadius: 6,
            cursor: "pointer",
            flexShrink: 0,
            alignSelf: "flex-start",
          }}
        >
          Zavřít
        </button>
      ) : null}
    </div>
  );
}
