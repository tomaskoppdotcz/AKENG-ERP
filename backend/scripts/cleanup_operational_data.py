#!/usr/bin/env python3
"""
Safe cleanup of operational / test transaction data (preserves master data).

Default: execute cleanup deletes.
Use --dry-run for preview counts only.
--apply is kept as a backward-compatible alias (no-op).

Does NOT delete: portfolio, technology templates, material library, machines,
workplaces, employees, master libraries, machine_calendar,
material_stock_items / product_stock_items rows.

Material ledger (default --material-stock preserve): keeps all material movements and
recomputes signed balances. Use --material-stock reset for a full wipe of movements
and zeroed on-hand qty (test DB).
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
        "--dry-run",
        action="store_true",
        help="Preview affected row counts only (no deletes).",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Backward-compatible alias; cleanup is applied by default.",
    )
    parser.add_argument("--json", action="store_true", help="Print result as JSON.")
    parser.add_argument(
        "--material-stock",
        choices=("preserve", "reset"),
        default="preserve",
        dest="material_stock_mode",
        help="preserve: keep material movements, recompute signed qty (default). "
        "reset: delete all material movements + zero balances.",
    )
    args = parser.parse_args()

    db = SessionLocal()
    try:
        if args.dry_run:
            prev = preview_counts(db)
            if args.json:
                print(
                    json.dumps(
                        {
                            "dry_run": True,
                            "material_stock_mode": args.material_stock_mode,
                            "preview": prev,
                        },
                        indent=2,
                        ensure_ascii=False,
                    )
                )
            else:
                print("=== DRY RUN (no deletes) — row counts that would be affected ===\n")
                print(f"  material_stock_mode: {args.material_stock_mode}\n")
                for k, v in sorted(prev.items()):
                    print(f"  {k}: {v}")
                print("\nRun without --dry-run to delete operational data.")
            return

        out = run_cleanup_operational_data(db, apply=True, material_stock_mode=args.material_stock_mode)
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
