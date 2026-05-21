"""
One-time seed: copy shift templates from machine_id=8 to plannable machines
without templates (5, 6, 27), then generate machine_calendar for 30 days for
all 16 plannable machines.

Run from repo root:
    cd backend && python -m scripts.seed_planner_calendars
"""

from __future__ import annotations

import sys
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from sqlalchemy.orm import Session  # noqa: E402

from app.core.database import SessionLocal  # noqa: E402
from app.models.machine_shift_template import MachineShiftTemplate  # noqa: E402
from app.models.master_data import Machine  # noqa: E402
from app.models.planning import MachineCalendar  # noqa: E402
from app.services.machine_calendar_generation import (  # noqa: E402
    apply_shift_templates_to_calendar_window,
)

PLANNABLE_MACHINE_IDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 15, 17, 27]
MACHINES_TO_SEED_TEMPLATES = [5, 6, 27]
SOURCE_TEMPLATE_MACHINE_ID = 8
HORIZON_DAYS = 30


def copy_templates(db: Session) -> dict[int, int]:
    """Copy 7 weekday rows from machine_id=8 to each target machine that has no templates."""
    source_rows = (
        db.query(MachineShiftTemplate)
        .filter(MachineShiftTemplate.machine_id == SOURCE_TEMPLATE_MACHINE_ID)
        .order_by(MachineShiftTemplate.weekday)
        .all()
    )

    if len(source_rows) != 7:
        raise RuntimeError(
            f"Expected 7 source template rows for machine_id={SOURCE_TEMPLATE_MACHINE_ID}, "
            f"found {len(source_rows)}"
        )

    created_per_machine: dict[int, int] = {}
    for target_mid in MACHINES_TO_SEED_TEMPLATES:
        existing = (
            db.query(MachineShiftTemplate)
            .filter(MachineShiftTemplate.machine_id == target_mid)
            .count()
        )
        if existing > 0:
            created_per_machine[target_mid] = 0
            continue

        target_machine = db.get(Machine, target_mid)
        if target_machine is None:
            raise RuntimeError(f"Machine id={target_mid} not found")
        target_wli = target_machine.workplace_library_item_id

        for src in source_rows:
            db.add(
                MachineShiftTemplate(
                    machine_id=target_mid,
                    workplace_library_item_id=target_wli,
                    weekday=src.weekday,
                    start_minutes=src.start_minutes,
                    end_minutes=src.end_minutes,
                    label=src.label,
                    is_active=src.is_active,
                )
            )
        created_per_machine[target_mid] = 7

    db.flush()
    return created_per_machine


def generate_calendars(db: Session) -> dict[str, int]:
    today = date.today()
    horizon = today + timedelta(days=HORIZON_DAYS)
    return apply_shift_templates_to_calendar_window(
        db,
        from_date=today,
        to_date=horizon,
        machine_ids=PLANNABLE_MACHINE_IDS,
    )


def main() -> None:
    db = SessionLocal()
    try:
        print("=== STEP 1: copy shift templates ===")
        copied = copy_templates(db)
        for mid, n in copied.items():
            print(f"  machine_id={mid}: created {n} template rows")

        print()
        print("=== STEP 2: generate machine_calendar for 30 days ===")
        cal_result = generate_calendars(db)
        print(f"  result: {cal_result}")

        db.commit()
        print()
        print("=== DONE: committed ===")

        total_templates = db.query(MachineShiftTemplate).count()
        total_calendars = db.query(MachineCalendar).count()
        distinct_machines_with_calendar = (
            db.query(MachineCalendar.machine_id).distinct().count()
        )
        print(f"machine_shift_templates total rows: {total_templates}")
        print(f"machine_calendar total rows: {total_calendars}")
        print(f"distinct machine_id in machine_calendar: {distinct_machines_with_calendar}")
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
