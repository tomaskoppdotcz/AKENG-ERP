"""
Jeden zdroj pravdy pro plánování: WorkplaceLibraryItem.
Stroj (machines) je pouze technická kotva pro machine_calendar / machine_schedule —
pro každé pracoviště existuje alespoň jeden řádek stroje (reálný nebo syntetický __WP_{id}__).
"""

from __future__ import annotations

import logging

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.master_data import Machine
from app.models.master_libraries import WorkplaceLibraryItem

logger = logging.getLogger(__name__)


def get_or_create_scheduling_machine_for_workplace(db: Session, workplace_id: int) -> Machine | None:
    """
    Vrátí stroj navázaný na pracoviště (první podle id). Pokud neexistuje, vytvoří syntetický
    řádek machines s kódem __WP_{id}__ (kiosk/plánovatelné řádky Gantt řeší knihovna pracovišť).
    """
    wid = int(workplace_id)
    wp = db.get(WorkplaceLibraryItem, wid)
    if wp is None:
        return None

    m = db.scalars(
        select(Machine).where(Machine.workplace_library_item_id == wid).order_by(Machine.id.asc())
    ).first()
    if m is not None:
        return m

    code = f"__WP_{wid}__"
    ex = db.scalar(select(Machine).where(Machine.machine_code == code))
    if ex is not None:
        if ex.workplace_library_item_id is None:
            ex.workplace_library_item_id = wid
            db.flush()
        return ex

    row = Machine(
        machine_code=code,
        name=(wp.name or f"Pracoviště {wid}").strip() or f"Pracoviště {wid}",
        machine_type="WORKPLACE_ANCHOR",
        workplace_library_item_id=wid,
        planning_enabled=False,
        is_plannable=False,
        is_active=True,
        default_shift_minutes=450,
    )
    db.add(row)
    db.flush()
    logger.info("[workplace_anchor] created synthetic machine id=%s code=%s workplace_id=%s", row.id, code, wid)
    return row


def sync_synthetic_anchor_machine_names_for_workplace(db: Session, workplace_id: int) -> None:
    """Po úpravě názvu pracoviště aktualizuje název u syntetických kotev __WP_*."""
    wid = int(workplace_id)
    wp = db.get(WorkplaceLibraryItem, wid)
    if wp is None:
        return
    name = (wp.name or "").strip() or f"Pracoviště {wid}"
    for m in db.scalars(select(Machine).where(Machine.workplace_library_item_id == wid)).all():
        mc = (m.machine_code or "").strip()
        if mc.startswith("__WP_") and mc.endswith("__"):
            m.name = name
    db.flush()
