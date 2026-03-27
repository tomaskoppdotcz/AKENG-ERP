#!/usr/bin/env python3
"""Safe cleanup of demo operational data (SQLite).

Default mode is DRY RUN (no deletes).
Use --apply for real deletion.
"""

from __future__ import annotations

import argparse
import sqlite3
from pathlib import Path


DB_PATH = Path(__file__).resolve().parents[1] / "akeng_erp_v1.db"

# Required cleanup targets (safe FK order)
DELETE_TABLES = [
    "portfolio_technology_template_materials",
    "portfolio_technology_template_operations",
    "portfolio_technology_templates",
    "portfolio_items",
    "portfolio_groups",
    "material_stock_reservations",
    "material_stock_movements",
    "material_stock_items",
]

# Report-only operational tables from order/job flow (never deleted here)
ORDER_JOB_REPORT_ONLY_TABLES = [
    "customer_orders",
    "jobs",
    "job_items",
    "production_orders",
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Clean demo operational/business data from AKENG ERP SQLite database.",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Execute real DELETE statements. Without this flag, script runs as dry run.",
    )
    return parser.parse_args()


def get_existing_tables(conn: sqlite3.Connection) -> set[str]:
    rows = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
    ).fetchall()
    return {str(row[0]) for row in rows}


def count_rows(conn: sqlite3.Connection, table: str) -> int:
    row = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()
    return int(row[0]) if row else 0


def print_counts(conn: sqlite3.Connection, title: str, tables: list[str], existing: set[str]) -> None:
    print(f"\n{title}")
    for table in tables:
        if table in existing:
            print(f"  - {table}: {count_rows(conn, table)}")
        else:
            print(f"  - {table}: [table not found]")


def delete_operational_data(conn: sqlite3.Connection, existing: set[str]) -> int:
    deleted_total = 0
    for table in DELETE_TABLES:
        if table not in existing:
            continue
        cur = conn.execute(f"DELETE FROM {table}")
        # SQLite rowcount can be -1 in some scenarios; normalize to >= 0
        deleted = max(int(cur.rowcount or 0), 0)
        deleted_total += deleted
        print(f"  deleted {deleted} rows from {table}")
    return deleted_total


def main() -> None:
    args = parse_args()
    mode = "APPLY" if args.apply else "DRY RUN"

    print("=== AKENG ERP demo operational cleanup ===")
    print(f"Database: {DB_PATH}")
    print(f"Mode: {mode}")

    if not DB_PATH.exists():
        raise SystemExit(f"Database not found: {DB_PATH}")

    conn = sqlite3.connect(DB_PATH)
    try:
        conn.execute("PRAGMA foreign_keys = ON")
        existing = get_existing_tables(conn)

        print_counts(conn, "BEFORE cleanup (target operational tables):", DELETE_TABLES, existing)
        print_counts(
            conn,
            "BEFORE cleanup (order/job tables, report-only):",
            ORDER_JOB_REPORT_ONLY_TABLES,
            existing,
        )

        if args.apply:
            print("\nApplying deletes:")
            conn.execute("BEGIN")
            try:
                deleted_total = delete_operational_data(conn, existing)
                conn.commit()
            except Exception:
                conn.rollback()
                raise
            print(f"\nDelete complete. Total deleted rows: {deleted_total}")
        else:
            print("\nDry run only. No data was deleted.")

        print_counts(conn, "AFTER cleanup (target operational tables):", DELETE_TABLES, existing)
        print_counts(
            conn,
            "AFTER cleanup (order/job tables, report-only):",
            ORDER_JOB_REPORT_ONLY_TABLES,
            existing,
        )

        print("\nRun instructions:")
        print("  Dry run:")
        print("    python backend/scripts/cleanup_demo_operational_data.py")
        print("  Apply:")
        print("    python backend/scripts/cleanup_demo_operational_data.py --apply")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
