"""
F1.5: Add targeted SQLite indexes for planner-heavy queries.

Idempotent — uses CREATE INDEX IF NOT EXISTS. Safe to re-run.

Run from repo root:
    cd backend && .venv/bin/python -m scripts.add_planner_indexes
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from sqlalchemy import text  # noqa: E402

from app.core.database import SessionLocal  # noqa: E402

INDEXES: list[tuple[str, str, str]] = [
    ("ix_planning_operations_woo_opno", "planning_operations", "work_order_no, operation_no"),
    ("ix_planning_operations_machine_status", "planning_operations", "machine_id, status"),
    ("ix_planning_operations_expedition_date", "planning_operations", "expedition_date"),
    ("ix_planning_operations_matready_status", "planning_operations", "material_ready, status"),
    ("ix_planning_operations_planned_start", "planning_operations", "planned_start"),
    ("ix_machine_schedule_machine_planned", "machine_schedule", "machine_id, planned_start"),
    ("ix_machine_schedule_op_id", "machine_schedule", "planning_operation_id"),
    (
        "ix_planning_segments_machine_segment_start",
        "planning_schedule_segments",
        "machine_id, segment_start",
    ),
    ("ix_planning_segments_op_id", "planning_schedule_segments", "planning_operation_id"),
    ("ix_machine_calendar_machine_date", "machine_calendar", "machine_id, calendar_date"),
]


def list_existing_indexes(db) -> dict[str, list[str]]:
    rows = db.execute(
        text(
            "SELECT tbl_name, name FROM sqlite_master "
            "WHERE type='index' AND name NOT LIKE 'sqlite_%' "
            "ORDER BY tbl_name, name"
        )
    ).all()
    out: dict[str, list[str]] = {}
    for tbl, name in rows:
        out.setdefault(tbl, []).append(name)
    return out


def main() -> None:
    db = SessionLocal()
    try:
        print("=== STEP 1: existing indexes (before) ===")
        before = list_existing_indexes(db)
        for tbl in sorted(before):
            for name in before[tbl]:
                print(f"  {tbl}: {name}")

        print()
        print("=== STEP 2: create indexes (idempotent) ===")
        for name, table, cols in INDEXES:
            sql = f"CREATE INDEX IF NOT EXISTS {name} ON {table} ({cols})"
            db.execute(text(sql))
            print(f"  ensured: {name} ON {table} ({cols})")

        db.commit()

        print()
        print("=== STEP 3: existing indexes (after) ===")
        after = list_existing_indexes(db)
        for tbl in sorted(after):
            for nm in after[tbl]:
                marker = " (NEW)" if nm not in before.get(tbl, []) else ""
                print(f"  {tbl}: {nm}{marker}")

        print()
        print("=== STEP 4: EXPLAIN QUERY PLAN — verify indexes are used ===")
        plan = db.execute(
            text(
                "EXPLAIN QUERY PLAN "
                "SELECT id FROM planning_operations "
                "WHERE machine_id = 1 AND status = 'ready'"
            )
        ).all()
        print("  pending set (machine=1, status=ready):")
        for r in plan:
            print(f"    {r}")

        plan2 = db.execute(
            text(
                "EXPLAIN QUERY PLAN "
                "SELECT id FROM machine_schedule "
                "WHERE machine_id = 1 AND planned_start >= '2026-05-21'"
            )
        ).all()
        print("  gantt timeline (machine=1, planned_start range):")
        for r in plan2:
            print(f"    {r}")

        plan3 = db.execute(
            text(
                "EXPLAIN QUERY PLAN "
                "SELECT * FROM planning_operations "
                "WHERE work_order_no = 'VP-000001' ORDER BY operation_no"
            )
        ).all()
        print("  predecessor lookup (work_order_no = VP-000001):")
        for r in plan3:
            print(f"    {r}")

        print()
        print("=== DONE: committed ===")
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
