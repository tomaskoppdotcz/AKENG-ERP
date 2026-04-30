import React from "react";
import { UI } from "../styles/ui";

export const formControlStyle: React.CSSProperties = {
  ...UI.inputs.base,
  minHeight: 42,
  boxSizing: "border-box",
};

export const formTextareaStyle: React.CSSProperties = {
  ...formControlStyle,
  minHeight: 76,
  resize: "vertical",
};

export function FormSection({
  title,
  subtitle,
  children,
  style,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <section
      style={{
        border: `1px solid ${UI.colors.divider}`,
        borderRadius: 14,
        padding: 16,
        background: "#FFFFFF",
        display: "grid",
        gap: 16,
        minWidth: 0,
        ...style,
      }}
    >
      <div>
        <div style={{ fontSize: 15, fontWeight: 1000, color: UI.colors.textPrimary }}>{title}</div>
        {subtitle ? <div style={{ ...UI.sectionSubtitle, marginTop: 4 }}>{subtitle}</div> : null}
      </div>
      {children}
    </section>
  );
}

export function FormGrid({
  children,
  minColumnWidth = 180,
  gap = 18,
  style,
}: {
  children: React.ReactNode;
  minColumnWidth?: number;
  gap?: number;
  style?: React.CSSProperties;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(auto-fit, minmax(${minColumnWidth}px, 1fr))`,
        gap,
        alignItems: "start",
        minWidth: 0,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function FormField({
  label,
  children,
  hint,
  fullWidth,
  style,
}: {
  label: string;
  children: React.ReactNode;
  hint?: React.ReactNode;
  fullWidth?: boolean;
  style?: React.CSSProperties;
}) {
  return (
    <label
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 6,
        minWidth: 0,
        gridColumn: fullWidth ? "1 / -1" : undefined,
        ...style,
      }}
    >
      <span style={{ ...UI.inputs.label, marginBottom: 0 }}>{label}</span>
      {children}
      {hint ? <span style={{ color: UI.colors.textSecondary, fontSize: 12, fontWeight: 700, lineHeight: 1.35 }}>{hint}</span> : null}
    </label>
  );
}

export function HighlightBox({
  title,
  children,
  tone = "warning",
}: {
  title: string;
  children: React.ReactNode;
  tone?: "warning" | "info";
}) {
  const colors =
    tone === "warning"
      ? { border: "#F59E0B", background: "#FFFBEB", text: "#92400E", badge: "#FEF3C7" }
      : { border: UI.colors.primary, background: "#EFF6FF", text: UI.colors.primaryHover, badge: UI.colors.primaryLight };

  return (
    <div
      style={{
        gridColumn: "1 / -1",
        border: `1px solid ${colors.border}`,
        borderLeftWidth: 5,
        borderRadius: 14,
        background: colors.background,
        padding: 16,
        display: "grid",
        gap: 14,
        minWidth: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, color: colors.text, fontWeight: 1000 }}>
        <span
          aria-hidden="true"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 24,
            height: 24,
            borderRadius: 999,
            background: colors.badge,
            border: `1px solid ${colors.border}`,
            fontSize: 13,
          }}
        >
          i
        </span>
        {title}
      </div>
      {children}
    </div>
  );
}
