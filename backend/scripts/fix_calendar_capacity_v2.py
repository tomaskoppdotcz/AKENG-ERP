"""
F-cal-2: finish calendar capacity fix.

1. Delete shift templates for non-plannable legacy machines so workplace-level
   template lookup is clean.
2. Delete machine_calendar rows for all 16 plannable machines outside
   [today, today+60].
3. Re-run apply_shift_templates_to_calendar_window for 60 days.
4. Sanity-check that Sat/Sun are inactive and weekday available_minutes = 450.

Run from repo root:
    cd backend && .venv/bin/python -m scripts.fix_calendar_capacity_v2
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
from app.models.planning import MachineCalendar  # noqa: E402
from app.services.machine_calendar_generation import (  # noqa: E402
    apply_shift_templates_to_calendar_window,
)

PLANNABLE_MACHINE_IDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 15, 17, 27]

LEGACY_MACHINE_IDS = [14, 16, 18, 19, 20, 21, 22, 23, 24, 25, 26]

HORIZON_DAYS = 60


def delete_legacy_templates(db: Session) -> int:
    result = db.execute(
        delete(MachineShiftTemplate).where(
            MachineShiftTemplate.machine_id.in_(LEGACY_MACHINE_IDS)
        )
    )
    return int(result.rowcount or 0)


def trim_calendar_outside_horizon(db: Session) -> int:
    today = date.today()
    horizon = today + timedelta(days=HORIZON_DAYS)
    result = db.execute(
        delete(MachineCalendar).where(
            and_(
                MachineCalendar.machine_id.in_(PLANNABLE_MACHINE_IDS),
                or_(
                    MachineCalendar.calendar_date < today,
                    MachineCalendar.calendar_date > horizon,
                ),
            )
        )
    )
    return int(result.rowcount or 0)


def regenerate_calendars(db: Session) -> dict[str, int]:
    today = date.today()
    horizon = today + timedelta(days=HORIZON_DAYS)
    return apply_shift_templates_to_calendar_window(
        db,
        from_date=today,
        to_date=horizon,
        machine_ids=PLANNABLE_MACHINE_IDS,
    )


def sanity_check(db: Session) -> None:
    print()
    print("--- per-machine calendar summary ---")
    for mid in PLANNABLE_MACHINE_IDS:
        rows = db.scalars(
            select(MachineCalendar)
            .where(MachineCalendar.machine_id == mid)
            .order_by(MachineCalendar.calendar_date)
        ).all()
        if not rows:
            print(f"  machine_id={mid}: NO ROWS")
            continue
        working = sum(1 for r in rows if r.is_working_day)
        non_working = len(rows) - working
        avg_avail = sum(r.available_minutes or 0 for r in rows if r.is_working_day) / max(
            working, 1
        )
        sat_sun_active = sum(
            1
            for r in rows
            if r.calendar_date.weekday() in (5, 6) and r.is_working_day
        )
        print(
            f"  machine_id={mid}: rows={len(rows)} "
            f"working_days={working} non_working={non_working} "
            f"avg_avail_min_on_working_days={avg_avail:.0f} "
            f"weekends_marked_active={sat_sun_active}"
        )


def main() -> None:
    db = SessionLocal()
    try:
        print("=== STEP 1: delete legacy templates ===")
        deleted_legacy = delete_legacy_templates(db)
        print(f"  deleted {deleted_legacy} legacy template rows")

        print()
        print("=== STEP 2: trim calendar rows outside 60-day horizon ===")
        trimmed = trim_calendar_outside_horizon(db)
        print(f"  deleted {trimmed} out-of-horizon calendar rows")

        print()
        print("=== STEP 3: regenerate machine_calendar for 60 days ===")
        result = regenerate_calendars(db)
        print(f"  result: {result}")

        db.commit()

        print()
        print("=== STEP 4: sanity check (post-commit) ===")
        sanity_check(db)

        print()
        print("=== DONE: committed ===")
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
