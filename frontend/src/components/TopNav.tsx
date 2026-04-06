import React from "react";
import { UI } from "../styles/ui";

const DEFAULT_NAV_ITEMS = [
  "Nástěnka",
  "Zakázky",
  "Výkresy",
  "Portfolio",
  "Sklad výrobků",
  "Sklad materiálu",
  "Výroba",
  "Plánování",
  "Kvalita",
  "Nastavení",
] as const;

type Props = {
  activeModule: string;
  onNavigate: (module: string) => void;
  navItems?: string[];
  rightSlot?: React.ReactNode;
};

export default function TopNav({ activeModule, onNavigate, navItems, rightSlot }: Props) {
  const items = navItems && navItems.length > 0 ? navItems : (DEFAULT_NAV_ITEMS as unknown as string[]);

  return (
    <div style={UI.topNavigation.wrapper}>
      <div style={UI.topNavigation.brand}>AKENG ERP</div>
      <div style={UI.topNavigation.items}>
        {items.map((label) => {
          const active = label === activeModule;
          return (
            <button
              key={label}
              type="button"
              onClick={() => onNavigate(label)}
              style={active ? UI.topNavigation.itemActive : UI.topNavigation.item}
            >
              {label}
            </button>
          );
        })}
      </div>
      {rightSlot ? <div style={UI.topNavigation.rightSlot}>{rightSlot}</div> : null}
    </div>
  );
}

