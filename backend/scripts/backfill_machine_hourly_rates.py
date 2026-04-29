#!/usr/bin/env python3
"""Backfill machines.hourly_rate from workplace_library_items.hourly_rate."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from sqlalchemy import select

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.api.master_data import ensure_machines_hourly_rate_schema  # noqa: E402
from app.core.database import SessionLocal, engine  # noqa: E402
from app.models.master_data import Machine  # noqa: E402
from app.models.master_libraries import WorkplaceLibraryItem  # noqa: E402


def _rate_changed(machine_rate: float | None, workplace_rate: float | None) -> bool:
    return machine_rate != workplace_rate


def backfill_machine_hourly_rates(*, dry_run: bool) -> dict[str, object]:
    ensure_machines_hourly_rate_schema(engine)
    db = SessionLocal()
    try:
        rows = db.execute(
            select(Machine, WorkplaceLibraryItem)
            .join(WorkplaceLibraryItem, Machine.workplace_library_item_id == WorkplaceLibraryItem.id)
            .order_by(Machine.machine_code.asc())
        ).all()

        changed: list[dict[str, object]] = []
        for machine, workplace in rows:
            if not _rate_changed(machine.hourly_rate, workplace.hourly_rate):
                continue
            changed.append(
                {
                    "machine_code": machine.machine_code,
                    "workplace_id": workplace.id,
                    "workplace_code": workplace.code,
                    "old_hourly_rate": machine.hourly_rate,
                    "new_hourly_rate": workplace.hourly_rate,
                }
            )
            if not dry_run:
                machine.hourly_rate = workplace.hourly_rate

        if dry_run:
            db.rollback()
        else:
            db.commit()

        return {
            "dry_run": dry_run,
            "checked": len(rows),
            "updated": len(changed),
            "changes": changed,
        }
    finally:
        db.close()


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Copy workplace_library_items.hourly_rate into linked machines.hourly_rate."
    )
    parser.add_argument("--dry-run", action="store_true", help="Preview changes without updating rows.")
    parser.add_argument("--json", action="store_true", help="Print full result as JSON.")
    args = parser.parse_args()

    result = backfill_machine_hourly_rates(dry_run=args.dry_run)
    if args.json:
        print(json.dumps(result, indent=2, ensure_ascii=False))
        return

    mode = "DRY RUN" if args.dry_run else "APPLIED"
    print(f"=== MACHINE HOURLY RATE BACKFILL {mode} ===\n")
    print(f"Checked linked machines: {result['checked']}")
    print(f"Machines {'to update' if args.dry_run else 'updated'}: {result['updated']}")
    for change in result["changes"]:
        print(
            "  {machine_code}: {old_hourly_rate} -> {new_hourly_rate} "
            "(workplace {workplace_code}, id={workplace_id})".format(**change)
        )


if __name__ == "__main__":
    main()
