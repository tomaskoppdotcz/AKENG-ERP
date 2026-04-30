/** Modulové klíče musí odpovídat `renderModuleBody` / workspace `moduleKey`. */

export type ErpNavLeaf = {
  label: string;
  moduleKey: string;
  /** Titulek pracovní záložky (jinak se použije `label`). */
  tabTitle?: string;
};

export type ErpNavGroup = {
  id: string;
  label: string;
  items: ErpNavLeaf[];
};

/** Sidebar struktura AKENG ERP v1. Legacy `moduleKey` hodnoty zůstávají v `App.tsx` pro routing. */
export const ERP_NAV_GROUPS: ErpNavGroup[] = [
  {
    id: "dashboard",
    label: "Nástěnka",
    items: [{ label: "Přehled", moduleKey: "Nástěnka" }],
  },
  {
    id: "orders",
    label: "Zakázky",
    items: [
      { label: "Přehled zakázek", moduleKey: "Zakázky", tabTitle: "Přehled zakázek" },
      { label: "Položky zakázek", moduleKey: "Výkresy", tabTitle: "Položky zakázek" },
    ],
  },
  {
    id: "planning",
    label: "Plánování",
    items: [
      { label: "Planner Gantt", moduleKey: "Plánování", tabTitle: "Planner Gantt" },
      { label: "Neplánované operace", moduleKey: "Plán neplánované", tabTitle: "Neplánované operace" },
      { label: "Směny pracovišť", moduleKey: "Plán směny pracovišť", tabTitle: "Směny pracovišť" },
    ],
  },
  {
    id: "production",
    label: "Výroba",
    items: [
      { label: "Výrobní příkazy", moduleKey: "Výroba", tabTitle: "Výrobní příkazy" },
      { label: "Výkazy práce", moduleKey: "Výroba výkazy", tabTitle: "Výkazy práce" },
      { label: "Kiosk", moduleKey: "Kiosk" },
    ],
  },
  {
    id: "technology",
    label: "Technologie",
    items: [{ label: "Portfolio výrobků", moduleKey: "Portfolio", tabTitle: "Portfolio výrobků" }],
  },
  {
    id: "warehouse",
    label: "Sklad",
    items: [
      { label: "Sklad materiálu", moduleKey: "Sklad materiálu" },
      { label: "Sklad zbytků", moduleKey: "Sklad zbytků" },
      { label: "Sklad výrobků", moduleKey: "Sklad výrobků" },
    ],
  },
  {
    id: "purchase",
    label: "Nákup",
    items: [
      { label: "Požadavky materiálu", moduleKey: "Požadavky materiálu" },
      { label: "Poptávky", moduleKey: "Poptávky" },
      { label: "Objednávky", moduleKey: "Objednávky" },
    ],
  },
  {
    id: "master_data",
    label: "Kmenová data",
    items: [
      { label: "Pracoviště", moduleKey: "Pracoviště", tabTitle: "Pracoviště" },
      { label: "Zaměstnanci", moduleKey: "Zaměstnanci", tabTitle: "Zaměstnanci" },
      { label: "Knihovna operací", moduleKey: "Knihovna operací", tabTitle: "Knihovna operací" },
      { label: "Stroje", moduleKey: "Stroje", tabTitle: "Stroje" },
      { label: "Sklady", moduleKey: "Sklad lokace", tabTitle: "Sklady" },
      { label: "Materiály", moduleKey: "Materiály", tabTitle: "Materiály" },
      { label: "Skupiny", moduleKey: "Skupiny materiálů", tabTitle: "Skupiny materiálů" },
    ],
  },
  {
    id: "settings",
    label: "Nastavení",
    items: [
      { label: "Uživatelé", moduleKey: "SYS uživatelé", tabTitle: "Nastavení — uživatelé" },
      { label: "Role", moduleKey: "SYS role", tabTitle: "Nastavení — role" },
      { label: "Číselné řady", moduleKey: "SYS číselné řady", tabTitle: "Nastavení — číselné řady" },
      { label: "Tiskové sestavy", moduleKey: "SYS tiskové sestavy", tabTitle: "Nastavení — tiskové sestavy" },
      { label: "Texty", moduleKey: "SYS texty", tabTitle: "Nastavení — texty" },
      { label: "Barcode", moduleKey: "SYS barcode", tabTitle: "Nastavení — barcode" },
      { label: "Import / export", moduleKey: "SYS import export", tabTitle: "Import / export" },
      { label: "Pořadí navigace", moduleKey: "SYS pořadí navigace", tabTitle: "Pořadí navigace" },
    ],
  },
];

export function groupContainsActiveModule(group: ErpNavGroup, activeModule: string): boolean {
  return group.items.some((i) => i.moduleKey === activeModule);
}
