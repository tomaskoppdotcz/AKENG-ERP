"""
Kiosk shopfloor: jeden záznam v selektoru = jedno provozní pracoviště (workplace_library_item),
ne každý samostatný řádek stroje. Fronta se bere přes list_planning_operations_for_kiosk_machine(rep).
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.master_data import Machine
from app.models.master_libraries import WorkplaceLibraryItem

_WORKPLACE_ANCHOR_TYPE = "WORKPLACE_ANCHOR"


def is_planner_anchor_machine_row(machine: Machine) -> bool:
    """Řádek kotvy plánovače (__WP_* / WORKPLACE_ANCHOR) — není fyzická kiosk stanice."""
    if (machine.machine_type or "") == _WORKPLACE_ANCHOR_TYPE:
        return True
    mc = (machine.machine_code or "").strip()
    return mc.startswith("__WP_") and mc.endswith("__")


def list_physical_planning_machines(db: Session) -> list[Machine]:
    """Aktivní shopfloor stroje s plánováním, bez syntetických kotev."""
    rows = db.scalars(
        select(Machine)
        .where(Machine.is_active.is_(True))
        .where(Machine.planning_enabled.is_(True))
        .order_by(Machine.id.asc())
    ).all()
    return [m for m in rows if not is_planner_anchor_machine_row(m)]


def build_kiosk_resource_rows(db: Session) -> list[dict]:
    """
    Jedna položka na workplace_library_item_id (sdílená kapacita / více typů operací).
    Stroje bez FK zůstávají každý samostatně.
    Reprezentant = nejnižší machine.id ve skupině (stabilní machine_id pro /machine-operations).
    """
    physical = list_physical_planning_machines(db)
    by_wp: dict[int, list[Machine]] = {}
    standalone: list[Machine] = []
    for m in physical:
        wid = m.workplace_library_item_id
        if wid is None:
            standalone.append(m)
            continue
        k = int(wid)
        by_wp.setdefault(k, []).append(m)

    out: list[dict] = []
    for wid in sorted(by_wp.keys()):
        group = sorted(by_wp[wid], key=lambda x: int(x.id))
        rep = group[0]
        wp = db.get(WorkplaceLibraryItem, wid)
        label = (wp.name or "").strip() if wp is not None else ""
        if not label:
            label = (rep.name or "").strip() or rep.machine_code
        out.append(
            {
                "machine_id": int(rep.id),
                "machine_code": rep.machine_code,
                "machine_name": label,
                "workplace_library_item_id": wid,
            }
        )

    for m in sorted(standalone, key=lambda x: ((x.name or "").lower(), int(x.id))):
        out.append(
            {
                "machine_id": int(m.id),
                "machine_code": m.machine_code,
                "machine_name": (m.name or "").strip() or m.machine_code,
                "workplace_library_item_id": None,
            }
        )

    out.sort(key=lambda r: ((r.get("machine_name") or "").lower(), r.get("machine_id") or 0))
    return out
