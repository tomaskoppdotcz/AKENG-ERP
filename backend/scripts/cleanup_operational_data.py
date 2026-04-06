#!/usr/bin/env python3
"""
Safe cleanup of operational / test transaction data (preserves master data).

Default: dry run (preview counts only).
Use --apply to execute deletes.

Does NOT delete: portfolio, technology templates, material library, machines,
workplaces, employees, master libraries, machine_calendar,
material_stock_items / product_stock_items rows.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.core.database import SessionLocal  # noqa: E402
from app.services.cleanup_operational_data import (  # noqa: E402
    preview_counts,
    run_cleanup_operational_data,
)


def main() -> None:
    parser = argparse.ArgumentParser(description="AKENG ERP — operational data cleanup (preserve master data).")
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Execute deletion. Without this flag, only prints preview counts.",
    )
    parser.add_argument("--json", action="store_true", help="Print result as JSON.")
    args = parser.parse_args()

    db = SessionLocal()
    try:
        if not args.apply:
            prev = preview_counts(db)
            if args.json:
                print(json.dumps({"dry_run": True, "preview": prev}, indent=2, ensure_ascii=False))
            else:
                print("=== DRY RUN (no deletes) — row counts that would be affected ===\n")
                for k, v in sorted(prev.items()):
                    print(f"  {k}: {v}")
                print("\nRun with --apply to delete operational data.")
            return

        out = run_cleanup_operational_data(db, apply=True)
        if args.json:
            print(json.dumps(out, indent=2, ensure_ascii=False))
        else:
            print("=== CLEANUP APPLIED ===\n")
            deleted = out.get("deleted") or {}
            for k, v in sorted(deleted.items()):
                print(f"  {k}: {v}")
            print("\nDone. Master data (portfolio, materials, machines, …) preserved.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
