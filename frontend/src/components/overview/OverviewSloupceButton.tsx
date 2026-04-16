import React from "react";
import { UI } from "../../styles/ui";

type Props = {
  onClick: () => void;
  disabled?: boolean;
  className?: string;
};

export default function OverviewSloupceButton({ onClick, disabled, className }: Props) {
  return (
    <button
      type="button"
      className={className}
      style={{ ...UI.buttons.secondary, ...UI.overviewSloupceButton }}
      onClick={onClick}
      disabled={disabled}
    >
      Sloupce
    </button>
  );
}
