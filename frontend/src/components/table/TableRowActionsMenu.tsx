import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { UI } from "../../styles/ui";

const MENU_Z = 4200;

export type TableRowActionItem = {
  key: string;
  label: string;
  icon?: React.ReactNode;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
};

export type TableRowActionsMenuProps = {
  /** Prázdné / vynecháno → žádné položky (trigger bude disabled). */
  actions?: TableRowActionItem[] | null;
  /** Zarování plovoucího menu vůči spoušti — `end` = pravá hrana menu s pravou hranou tlačítka (Notion/Linear). */
  align?: "start" | "end";
  disabled?: boolean;
  compact?: boolean;
  /** Volá se po `onClick` položky menu. */
  onAction?: (key: string) => void;
  /** Otevření / zavření menu (např. zvýraznění řádku tabulky). */
  onOpenChange?: (open: boolean) => void;
  /** `aria-label` spouštěče (doporučeno u tabulek). */
  triggerLabel?: string;
};

export default function TableRowActionsMenu({
  actions: actionsProp,
  align = "end",
  disabled = false,
  compact = false,
  onAction,
  onOpenChange,
  triggerLabel = "Akce řádku",
}: TableRowActionsMenuProps) {
  const actions = Array.isArray(actionsProp) ? actionsProp : [];
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; minW: number }>({ top: 0, left: 0, minW: 0 });
  const menuId = useId();

  useEffect(() => {
    setMounted(true);
  }, []);

  const setClosed = useCallback(() => {
    setOpen(false);
    onOpenChange?.(false);
  }, [onOpenChange]);

  const setOpened = useCallback(() => {
    setOpen(true);
    onOpenChange?.(true);
  }, [onOpenChange]);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const minW = Math.max(160, rect.width);
    let left = align === "end" ? rect.right - minW : rect.left;
    const top = rect.bottom + 4;
    const pad = 8;
    const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
    if (left < pad) left = pad;
    if (left + minW > vw - pad) left = vw - pad - minW;
    setPos({ top, left, minW });
  }, [open, align]);

  useEffect(() => {
    if (!open || typeof document === "undefined") return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (rootRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setClosed();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setClosed();
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDoc, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDoc, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open, setClosed]);

  useEffect(() => {
    if (!open || !menuRef.current) return;
    const el = menuRef.current.querySelector<HTMLButtonElement>('button[type="button"]:not([disabled])');
    el?.focus();
  }, [open]);

  const padY = compact ? 4 : 6;
  const padX = compact ? 10 : 12;
  const triggerPad = compact ? "3px 6px" : "5px 8px";
  const triggerSize = compact ? 26 : 30;

  const menu = open ? (
    <div
      ref={menuRef}
      id={menuId}
      role="menu"
      aria-orientation="vertical"
      style={{
        position: "fixed",
        top: pos.top,
        left: pos.left,
        minWidth: pos.minW,
        zIndex: MENU_Z,
        background: UI.colors.card,
        border: `1px solid ${UI.colors.border}`,
        borderRadius: 10,
        boxShadow: "0 10px 28px rgba(15, 23, 42, 0.12), 0 2px 8px rgba(15, 23, 42, 0.06)",
        padding: `${padY}px 0`,
        maxHeight: "min(70vh, 320px)",
        overflowY: "auto",
      }}
    >
      {actions.map((a) => {
        const fg = a.danger ? UI.colors.problemFg : UI.colors.textPrimary;
        const bgHover = a.danger ? "rgba(254, 226, 226, 0.65)" : UI.colors.neutralBg;
        return (
          <button
            key={a.key}
            type="button"
            role="menuitem"
            disabled={a.disabled}
            onClick={() => {
              if (a.disabled) return;
              try {
                a.onClick?.();
              } catch {
                /* necháme menu zavřít i při chybě v handleru */
              }
              onAction?.(a.key);
              setClosed();
              triggerRef.current?.focus();
            }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              width: "100%",
              textAlign: "left",
              border: "none",
              background: "transparent",
              cursor: a.disabled ? "not-allowed" : "pointer",
              color: a.disabled ? UI.colors.textSecondary : fg,
              fontSize: compact ? 12 : 13,
              fontWeight: 650,
              padding: `${compact ? 6 : 7}px ${padX}px`,
              opacity: a.disabled ? 0.55 : 1,
              transition: "background 100ms ease, color 100ms ease",
            }}
            onMouseEnter={(e) => {
              if (!a.disabled) (e.currentTarget.style.background = bgHover);
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
            }}
          >
            {a.icon ? <span style={{ display: "flex", flexShrink: 0, opacity: 0.85 }}>{a.icon}</span> : null}
            <span style={{ flex: 1, minWidth: 0 }}>{a.label}</span>
          </button>
        );
      })}
    </div>
  ) : null;

  return (
    <div
      ref={rootRef}
      className="erp-table-row-actions"
      style={{ display: "inline-flex", justifyContent: align === "end" ? "flex-end" : "flex-start", width: "100%" }}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        ref={triggerRef}
        type="button"
        className="erp-row-actions-trigger"
        disabled={disabled || actions.length === 0}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={triggerLabel}
        onClick={(e) => {
          e.stopPropagation();
          if (disabled || actions.length === 0) return;
          if (open) {
            setClosed();
          } else {
            setOpened();
          }
        }}
        style={{
          width: triggerSize,
          height: triggerSize,
          padding: triggerPad,
          borderRadius: 8,
          border: `1px solid ${UI.colors.border}`,
          background: UI.colors.card,
          color: UI.colors.textSecondary,
          cursor: disabled || actions.length === 0 ? "not-allowed" : "pointer",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          lineHeight: 1,
          fontSize: compact ? 15 : 16,
          fontWeight: 900,
          letterSpacing: 0.5,
          transition: "background 120ms ease, border-color 120ms ease, color 120ms ease, box-shadow 120ms ease",
          boxSizing: "border-box",
          flexShrink: 0,
        }}
        onMouseEnter={(e) => {
          if (!disabled && actions.length > 0) {
            e.currentTarget.style.background = UI.colors.neutralBg;
            e.currentTarget.style.borderColor = UI.colors.divider;
            e.currentTarget.style.color = UI.colors.textPrimary;
          }
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = UI.colors.card;
          e.currentTarget.style.borderColor = UI.colors.border;
          e.currentTarget.style.color = UI.colors.textSecondary;
        }}
      >
        <span aria-hidden style={{ transform: "translateY(-0.5px)" }}>
          ⋮
        </span>
      </button>
      {mounted && typeof document !== "undefined" && document.body && menu
        ? createPortal(menu, document.body)
        : null}
    </div>
  );
}
