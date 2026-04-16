import React from "react";
import { UI } from "../../styles/ui";

type Props = {
  onClick: () => void;
  disabled?: boolean;
};

export default function OverviewSloupceButton({ onClick, disabled }: Props) {
  return (
    <button
      type="button"
      style={{ ...UI.buttons.secondary, ...UI.overviewSloupceButton }}
      onClick={onClick}
      disabled={disabled}
    >
      Sloupce
    </button>
  );
}
