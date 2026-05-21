"""
F-cal: Fix machine calendar capacity.

Resets all plannable machines to a single-shift Mon–Fri schedule (450 min/day),
weekends inactive, and regenerates machine_calendar for the next 60 days.
Also deletes calendar rows for machine_id=8 outside the new horizon.

Run from repo root:
    cd backend && .venv/bin/python -m scripts.fix_calendar_capacity
"""

from __future__ import annotations

import sys
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from sqlalchemy import and_, delete, func, or_, select  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

from app.core.database import SessionLocal  # noqa: E402
from app.models.machine_shift_template import MachineShiftTemplate  # noqa: E402
from app.models.master_data import Machine  # noqa: E402
from app.models.planning import MachineCalendar  # noqa: E402
from app.services.machine_calendar_generation import (  # noqa: E402
    apply_shift_templates_to_calendar_window,
)

PLANNABLE_MACHINE_IDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 15, 17, 27]

SHIFT_START_MIN = 360
SHIFT_END_MIN = 810
HORIZON_DAYS = 60


def reset_shift_templates(db: Session) -> dict[int, int]:
    inserted_per_machine: dict[int, int] = {}
    for mid in PLANNABLE_MACHINE_IDS:
        machine = db.get(Machine, mid)
        if machine is None:
            raise RuntimeError(f"Machine id={mid} not found in DB")

        wli = machine.workplace_library_item_id

        db.execute(
            delete(MachineShiftTemplate).where(MachineShiftTemplate.machine_id == mid)
        )

        for wd in range(5):
            db.add(
                MachineShiftTemplate(
                    machine_id=mid,
                    workplace_library_item_id=wli,
                    weekday=wd,
                    start_minutes=SHIFT_START_MIN,
                    end_minutes=SHIFT_END_MIN,
                    label=None,
                    is_active=True,
                )
            )
        for wd in (5, 6):
            db.add(
                MachineShiftTemplate(
                    machine_id=mid,
                    workplace_library_item_id=wli,
                    weekday=wd,
                    start_minutes=SHIFT_START_MIN,
                    end_minutes=SHIFT_START_MIN,
                    label=None,
                    is_active=False,
                )
            )
        inserted_per_machine[mid] = 7

    db.flush()
    return inserted_per_machine


def regenerate_calendars(db: Session) -> dict[str, int]:
    today = date.today()
    horizon = today + timedelta(days=HORIZON_DAYS)
    return apply_shift_templates_to_calendar_window(
        db,
        from_date=today,
        to_date=horizon,
        machine_ids=PLANNABLE_MACHINE_IDS,
    )


def trim_stale_calendar_rows(db: Session) -> int:
    today = date.today()
    horizon = today + timedelta(days=HORIZON_DAYS)
    result = db.execute(
        delete(MachineCalendar).where(
            and_(
                MachineCalendar.machine_id == 8,
                or_(
                    MachineCalendar.calendar_date < today,
                    MachineCalendar.calendar_date > horizon,
                ),
            )
        )
    )
    return int(result.rowcount or 0)


def main() -> None:
    db = SessionLocal()
    try:
        print("=== STEP 1: reset shift templates for 16 plannable machines ===")
        inserted = reset_shift_templates(db)
        total_inserted = sum(inserted.values())
        print(f"  inserted {total_inserted} template rows across {len(inserted)} machines")

        print()
        print("=== STEP 2: regenerate machine_calendar for 60 days ===")
        cal_result = regenerate_calendars(db)
        print(f"  result: {cal_result}")

        print()
        print("=== STEP 3: trim stale calendar rows for machine_id=8 outside horizon ===")
        deleted = trim_stale_calendar_rows(db)
        print(f"  deleted {deleted} stale calendar rows")

        db.commit()
        print()
        print("=== DONE: committed ===")

        total_templates = db.scalar(select(func.count()).select_from(MachineShiftTemplate))
        total_calendars = db.scalar(select(func.count()).select_from(MachineCalendar))
        distinct_machines = db.scalar(
            select(func.count(func.distinct(MachineCalendar.machine_id)))
        )
        print(f"machine_shift_templates total: {total_templates}")
        print(f"machine_calendar total: {total_calendars}")
        print(f"distinct machine_id in machine_calendar: {distinct_machines}")
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
