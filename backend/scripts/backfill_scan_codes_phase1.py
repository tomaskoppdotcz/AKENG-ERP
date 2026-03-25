#!/usr/bin/env python3
"""
Doplnění scan_code podle DB id (fáze 1).

Výchozí režim: dry run (jen výpis). Zápis: python backfill_scan_codes_phase1.py --apply

Databáze: backend/akeng_erp_v1.db (relativně ke kořenu backend/).
"""

from __future__ import annotations

import argparse
import sqlite3
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DB = BACKEND_ROOT / "akeng_erp_v1.db"

TABLES: tuple[tuple[str, str], ...] = (
    ("portfolio_items", "PF"),
    ("material_library_items", "MAT"),
    ("material_stock_items", "STK"),
)


def scan_code_for(prefix: str, row_id: int) -> str:
    return f"{prefix}-{row_id:06d}"


def count_need_backfill(conn: sqlite3.Connection, table: str) -> int:
    cur = conn.execute(
        f"SELECT COUNT(*) FROM {table} WHERE scan_code IS NULL OR TRIM(scan_code) = ''"  # noqa: S608
    )
    return int(cur.fetchone()[0])


def fetch_ids_to_fix(conn: sqlite3.Connection, table: str) -> list[int]:
    cur = conn.execute(
        f"SELECT id FROM {table} WHERE scan_code IS NULL OR TRIM(scan_code) = '' ORDER BY id"  # noqa: S608
    )
    return [int(r[0]) for r in cur.fetchall()]


def main() -> int:
    parser = argparse.ArgumentParser(description="Backfill scan_code (dry run unless --apply)")
    parser.add_argument(
        "--db",
        type=Path,
        default=DEFAULT_DB,
        help=f"Cesta k SQLite DB (výchozí: {DEFAULT_DB})",
    )
    parser.add_argument("--apply", action="store_true", help="Zapsat změny do databáze")
    args = parser.parse_args()

    db_path: Path = args.db
    if not db_path.is_file():
        print(f"Chyba: soubor databáze neexistuje: {db_path}", file=sys.stderr)
        return 1

    conn = sqlite3.connect(str(db_path))
    try:
        for table, prefix in TABLES:
            cur = conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
                (table,),
            )
            if cur.fetchone() is None:
                print(f"[{table}] tabulka neexistuje — přeskočeno")
                continue
            cols = {r[1] for r in conn.execute(f"PRAGMA table_info({table})")}  # noqa: S608
            if "scan_code" not in cols:
                print(f"[{table}] sloupec scan_code chybí — spusťte backend (startup migrace) nebo přidejte sloupec")
                continue

            total_rows = int(conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0])  # noqa: S608
            before = count_need_backfill(conn, table)
            ids = fetch_ids_to_fix(conn, table)
            print(f"[{table}] řádků celkem: {total_rows}, bez scan_code (před): {before}")
            if not ids:
                continue

            if args.apply:
                for row_id in ids:
                    code = scan_code_for(prefix, row_id)
                    conn.execute(
                        f"UPDATE {table} SET scan_code = ? WHERE id = ?",  # noqa: S608
                        (code, row_id),
                    )
                conn.commit()
                after = count_need_backfill(conn, table)
                total_after = int(conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0])  # noqa: S608
                print(f"[{table}] po zápisu — řádků celkem: {total_after}, bez scan_code: {after}")
            else:
                sample = ids[:5]
                for row_id in sample:
                    print(f"  dry-run: id={row_id} -> {scan_code_for(prefix, row_id)}")
                if len(ids) > 5:
                    print(f"  … a dalších {len(ids) - 5} řádků")
    finally:
        conn.close()

    print()
    if args.apply:
        print("Hotovo (zápis proveden).")
    else:
        print("Dry run — žádné změny v DB.")
        print("Pro zápis spusťte:")
        print(f"  python3 {Path(__file__).resolve()} --apply")
        print("Nebo s vlastní DB:")
        print(f"  python3 {Path(__file__).resolve()} --db /cesta/k/db.sqlite --apply")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
