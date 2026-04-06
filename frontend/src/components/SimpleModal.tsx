import React from "react";
import { UI } from "../styles/ui";

type Props = {
  title: string;
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
};

const backdrop: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(15, 23, 42, 0.45)",
  zIndex: 1000,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 16,
};

const panel: React.CSSProperties = {
  background: "#fff",
  borderRadius: 14,
  border: "1px solid #e2e8f0",
  maxWidth: 440,
  width: "100%",
  maxHeight: "90vh",
  overflow: "auto",
  boxShadow: "0 20px 50px rgba(15,23,42,0.15)",
};

export default function SimpleModal({ title, open, onClose, children, footer }: Props) {
  if (!open) return null;
  return (
    <div
      style={backdrop}
      role="dialog"
      aria-modal="true"
      aria-labelledby="simple-modal-title"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div style={panel} onMouseDown={(e) => e.stopPropagation()}>
        <div style={{ padding: "14px 16px", borderBottom: "1px solid #e2e8f0", display: "flex", justifyContent: "space-between", gap: 12 }}>
          <div id="simple-modal-title" style={{ fontSize: 17, fontWeight: 900, color: "#0f172a" }}>
            {title}
          </div>
          <button type="button" style={{ ...UI.buttons.secondary, padding: "4px 10px" }} onClick={onClose} aria-label="Zavřít">
            ×
          </button>
        </div>
        <div style={{ padding: 16 }}>{children}</div>
        {footer ? <div style={{ padding: "0 16px 16px", display: "flex", gap: 8, justifyContent: "flex-end" }}>{footer}</div> : null}
      </div>
    </div>
  );
}
