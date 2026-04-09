"""
Generování machine_calendar ze šablon směn (MachineShiftTemplate).
Runtime pro plánovač zůstává machine_calendar; šablony jen přepisují available_minutes a shift_start_minutes.
"""

from __future__ import annotations

import logging
from datetime import date, timedelta

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.models.master_data import Machine
from app.models.machine_shift_template import MachineShiftTemplate
from app.models.planning import MachineCalendar
from app.services.workplace_scheduling_anchor import get_or_create_scheduling_machine_for_workplace

logger = logging.getLogger(__name__)

DEFAULT_SHIFT_START_MINUTES = 6 * 60


def dedupe_shift_templates_for_workplace(
    db: Session, workplace_id: int, *, active_only: bool = True
) -> list[MachineShiftTemplate]:
    """Šablony pro pracoviště — sloučí řádky na kotvě i na strojích stejného pracoviště (dedup podle weekday)."""
    wid = int(workplace_id)
    mids = [int(x) for x in db.scalars(select(Machine.id).where(Machine.workplace_library_item_id == wid)).all()]
    parts = [MachineShiftTemplate.workplace_library_item_id == wid]
    if mids:
        parts.append(MachineShiftTemplate.machine_id.in_(mids))
    stmt = select(MachineShiftTemplate).where(or_(*parts))
    if active_only:
        stmt = stmt.where(MachineShiftTemplate.is_active.is_(True))
    rows = db.scalars(stmt).all()

    def sort_key(t: MachineShiftTemplate) -> tuple[int, int, int]:
        return (int(t.weekday), 0 if t.workplace_library_item_id == wid else 1, int(t.machine_id))

    rows_sorted = sorted(rows, key=sort_key)
    out: list[MachineShiftTemplate] = []
    seen: set[int] = set()
    for t in rows_sorted:
        wd = int(t.weekday)
        if wd in seen:
            continue
        seen.add(wd)
        out.append(t)
    return out


def _minutes_to_duration(start_m: int, end_m: int) -> int:
    if end_m <= start_m:
        return 0
    return int(end_m - start_m)


def apply_shift_templates_to_calendar_window(
    db: Session,
    *,
    from_date: date,
    to_date: date,
    machine_ids: list[int] | None = None,
    workplace_library_item_ids: list[int] | None = None,
) -> dict[str, int]:
    """
    Pro každý den v [from_date, to_date] a stroj nastaví available_minutes a shift_start_minutes.
    Bez šablony pro daný weekday: Machine.default_shift_minutes + výchozí začátek 06:00.
    Stroje s workplace_library_item_id berou šablony z pracoviště (včetně řádků vázaných na libovolný stroj daného pracoviště).
    """
    if to_date < from_date:
        return {"days_touched": 0, "rows_upserted": 0}

    mids: list[int]
    if workplace_library_item_ids is not None:
        acc: set[int] = set()
        for wid in workplace_library_item_ids:
            get_or_create_scheduling_machine_for_workplace(db, int(wid))
            for mid in db.scalars(select(Machine.id).where(Machine.workplace_library_item_id == int(wid))).all():
                acc.add(int(mid))
        mids = sorted(acc)
    elif machine_ids is not None:
        mids = [int(x) for x in machine_ids]
    else:
        mids = [int(x) for x in db.scalars(select(Machine.id).where(Machine.is_active.is_(True))).all()]

    if not mids:
        return {"days_touched": 0, "rows_upserted": 0}

    machines = {int(m.id): m for m in db.scalars(select(Machine).where(Machine.id.in_(mids))).all()} if mids else {}

    workplace_maps: dict[int, dict[int, MachineShiftTemplate]] = {}
    wids = {int(m.workplace_library_item_id) for m in machines.values() if m.workplace_library_item_id is not None}
    for wid in wids:
        lst = dedupe_shift_templates_for_workplace(db, wid)
        workplace_maps[wid] = {int(t.weekday): t for t in lst}

    orphan_mids = [mid for mid in mids if not machines.get(mid) or machines[mid].workplace_library_item_id is None]
    orphan_by_machine: dict[int, dict[int, MachineShiftTemplate]] = {}
    if orphan_mids:
        tpl_rows = db.scalars(
            select(MachineShiftTemplate).where(
                MachineShiftTemplate.machine_id.in_(orphan_mids),
                MachineShiftTemplate.is_active.is_(True),
            )
        ).all()
        for t in tpl_rows:
            orphan_by_machine.setdefault(int(t.machine_id), {})[int(t.weekday)] = t

    rows_upserted = 0
    d = from_date
    while d <= to_date:
        wd = int(d.weekday())
        for mid in mids:
            machine = machines.get(mid)
            default_avail = int(getattr(machine, "default_shift_minutes", None) or 450) if machine else 450

            wid = getattr(machine, "workplace_library_item_id", None) if machine else None
            if wid is not None:
                tpl = workplace_maps.get(int(wid), {}).get(wd)
            else:
                tpl = orphan_by_machine.get(mid, {}).get(wd)
            if tpl is not None:
                avail = _minutes_to_duration(int(tpl.start_minutes), int(tpl.end_minutes))
                shift_start = int(tpl.start_minutes)
                is_working = avail > 0
            else:
                avail = default_avail
                shift_start = DEFAULT_SHIFT_START_MINUTES
                is_working = avail > 0

            row = db.scalar(
                select(MachineCalendar)
                .where(MachineCalendar.machine_id == mid)
                .where(MachineCalendar.calendar_date == d)
            )
            if row is None:
                row = MachineCalendar(
                    machine_id=mid,
                    calendar_date=d,
                    available_minutes=avail,
                    shift_start_minutes=shift_start,
                    planned_minutes=0,
                    maintenance_minutes=0,
                    reserved_minutes=0,
                    is_working_day=is_working,
                    is_machine_available=True,
                    note=None,
                )
                db.add(row)
            else:
                row.available_minutes = avail
                row.shift_start_minutes = shift_start
                row.is_working_day = is_working
                if not is_working:
                    row.is_machine_available = False
                else:
                    row.is_machine_available = True
            rows_upserted += 1
        d += timedelta(days=1)

    db.flush()
    ndays = (to_date - from_date).days + 1
    logger.info(
        "[machine_calendar_generation] window %s..%s machines=%s rows_upserted=%s",
        from_date.isoformat(),
        to_date.isoformat(),
        len(mids),
        rows_upserted,
    )
    return {"days_touched": ndays * max(1, len(mids)), "rows_upserted": rows_upserted}
