"""
Delete operational / transactional ERP data while preserving master data
(portfolio, technology templates, material library, machines, employees, etc.).

Uses FK-safe delete order. Intended for test DB reset and dev cleanup.

Preserves machine_calendar (treated as planning/master calendar setup).

Material stock cleanup modes (``material_stock_mode``):

- ``preserve`` (default, operational clean): keeps all ``material_stock_movements``
  rows; recomputes ``material_stock_items.current_qty`` from movements using the
  same signed semantics as the stock API (prijem +qty, vydej -qty, korekce +qty).
- ``reset`` (full test clean): deletes all material movement rows (and attachments),
  then recomputes balances (all zero). Use when you want an empty material ledger.
"""

from __future__ import annotations

from typing import Any, Literal

from sqlalchemy import text
from sqlalchemy.orm import Session

MaterialStockCleanupMode = Literal["preserve", "reset"]

# Tables that use SQLite AUTOINCREMENT and should reset sequence after full wipe
_SQLITE_SEQUENCE_TABLES = (
    "customer_orders",
    "jobs",
    "job_items",
    "production_orders",
    "production_order_operations",
    "production_order_operation_logs",
    "planning_operations",
    "machine_schedule",
    "operation_events",
    "operation_logs",
    "kiosk_sessions",
    "kiosk_activity_logs",
    "work_report_pauses",
    "work_report_audit_logs",
    "work_reports",
    "job_item_coverages",
    "product_issues",
    "product_stock_receipts",
    "product_stock_movements",
    "material_reservations",
    "material_stock_reservations",
    "restock_wip_reservations",
    "material_stock_movement_attachments",
    "material_stock_movements",
    "material_receipt_units",
)


def _count(db: Session, sql: str) -> int:
    r = db.execute(text(sql)).scalar()
    return int(r or 0)


def preview_counts(db: Session) -> dict[str, int]:
    """Row counts for tables touched by cleanup (for dry-run summary)."""
    keys: list[tuple[str, str]] = [
        ("operation_events", "SELECT COUNT(*) FROM operation_events"),
        ("operation_logs", "SELECT COUNT(*) FROM operation_logs"),
        ("machine_schedule", "SELECT COUNT(*) FROM machine_schedule"),
        ("kiosk_activity_logs", "SELECT COUNT(*) FROM kiosk_activity_logs"),
        ("work_report_pauses", "SELECT COUNT(*) FROM work_report_pauses"),
        ("work_report_audit_logs", "SELECT COUNT(*) FROM work_report_audit_logs"),
        ("work_reports", "SELECT COUNT(*) FROM work_reports"),
        ("kiosk_sessions", "SELECT COUNT(*) FROM kiosk_sessions"),
        ("planning_operations", "SELECT COUNT(*) FROM planning_operations"),
        ("production_order_operation_logs", "SELECT COUNT(*) FROM production_order_operation_logs"),
        ("production_order_operations", "SELECT COUNT(*) FROM production_order_operations"),
        ("material_reservations", "SELECT COUNT(*) FROM material_reservations"),
        ("material_stock_reservations", "SELECT COUNT(*) FROM material_stock_reservations"),
        ("restock_wip_reservations", "SELECT COUNT(*) FROM restock_wip_reservations"),
        (
            "material_stock_movements_linked",
            "SELECT COUNT(*) FROM material_stock_movements "
            "WHERE production_order_id IS NOT NULL OR job_item_id IS NOT NULL",
        ),
        ("material_stock_movements_total", "SELECT COUNT(*) FROM material_stock_movements"),
        (
            "material_stock_movement_attachments",
            "SELECT COUNT(*) FROM material_stock_movement_attachments",
        ),
        ("job_item_coverages", "SELECT COUNT(*) FROM job_item_coverages"),
        ("product_issues", "SELECT COUNT(*) FROM product_issues"),
        ("product_stock_movements", "SELECT COUNT(*) FROM product_stock_movements"),
        ("product_stock_receipts", "SELECT COUNT(*) FROM product_stock_receipts"),
        ("production_orders", "SELECT COUNT(*) FROM production_orders"),
        ("job_items", "SELECT COUNT(*) FROM job_items"),
        ("jobs", "SELECT COUNT(*) FROM jobs"),
        ("customer_orders", "SELECT COUNT(*) FROM customer_orders"),
    ]
    out: dict[str, int] = {}
    for name, sql in keys:
        try:
            out[name] = _count(db, sql)
        except Exception:
            out[name] = -1
    return out


_RECOMPUTE_MATERIAL_STOCK_QTY_SQL = """
UPDATE material_stock_items SET current_qty = COALESCE((
    SELECT SUM(
        CASE TRIM(LOWER(COALESCE(m.movement_type, '')))
            WHEN 'prijem' THEN m.qty
            WHEN 'vydej' THEN -m.qty
            ELSE m.qty
        END
    )
    FROM material_stock_movements m
    WHERE m.stock_item_id = material_stock_items.id
), 0)
"""


def recompute_material_stock_current_qty_from_movements(db: Session) -> int:
    """
    Set each ``material_stock_items.current_qty`` to the signed sum of its movements,
    matching ``_movement_delta`` in ``app.api.material_stock``.
    """
    r = db.execute(text(_RECOMPUTE_MATERIAL_STOCK_QTY_SQL))
    return max(0, int(r.rowcount or 0))


def run_cleanup_operational_data(
    db: Session,
    *,
    apply: bool,
    material_stock_mode: MaterialStockCleanupMode = "preserve",
) -> dict[str, Any]:
    """
    If apply=False, returns preview_counts and the chosen ``material_stock_mode``.
    If apply=True, deletes operational rows and returns deleted rowcounts per step.
    """
    if not apply:
        return {
            "dry_run": True,
            "preview": preview_counts(db),
            "material_stock_mode": material_stock_mode,
        }

    deleted: dict[str, int] = {}

    try:
        _execute_cleanup_deletes(db, deleted, material_stock_mode=material_stock_mode)
        db.commit()
    except Exception:
        db.rollback()
        raise
    return {
        "dry_run": False,
        "deleted": deleted,
        "material_stock_mode": material_stock_mode,
    }


def _execute_cleanup_deletes(
    db: Session,
    deleted: dict[str, int],
    *,
    material_stock_mode: MaterialStockCleanupMode,
) -> None:

    def d(label: str, sql: str) -> None:
        r = db.execute(text(sql))
        n = r.rowcount
        deleted[label] = max(0, int(n) if n is not None and n >= 0 else 0)

    # Work reports (before kiosk_sessions / planning_operations — FK references)
    d("work_report_pauses", "DELETE FROM work_report_pauses")
    d("work_report_audit_logs", "DELETE FROM work_report_audit_logs")
    d("work_reports", "DELETE FROM work_reports")

    # Planning / kiosk / schedule (no FK to orders)
    d("operation_events", "DELETE FROM operation_events")
    d("operation_logs", "DELETE FROM operation_logs")
    d("machine_schedule", "DELETE FROM machine_schedule")
    d("kiosk_activity_logs", "DELETE FROM kiosk_activity_logs")
    d("kiosk_sessions", "DELETE FROM kiosk_sessions")
    d("planning_operations", "DELETE FROM planning_operations")

    # Production order detail
    d("production_order_operation_logs", "DELETE FROM production_order_operation_logs")
    d("production_order_operations", "DELETE FROM production_order_operations")

    # Reservations (TP / sklad materiálu)
    d("material_reservations", "DELETE FROM material_reservations")
    d("material_stock_reservations", "DELETE FROM material_stock_reservations")
    d("restock_wip_reservations", "DELETE FROM restock_wip_reservations")

    # Material ledger: preserve (default) vs full reset — never leave unsigned SUM drift.
    if material_stock_mode == "reset":
        d("material_stock_movement_attachments", "DELETE FROM material_stock_movement_attachments")
        d("material_stock_movements", "DELETE FROM material_stock_movements")
        d("material_receipt_units", "DELETE FROM material_receipt_units")
    deleted["material_stock_items_qty_recomputed"] = recompute_material_stock_current_qty_from_movements(db)

    # Coverage / issues before order hierarchy
    d("job_item_coverages", "DELETE FROM job_item_coverages")
    d("product_issues", "DELETE FROM product_issues")

    # Product stock: clear transactional history; keep product_stock_items (locations, min, portfolio link)
    d("product_stock_movements", "DELETE FROM product_stock_movements")
    d("product_stock_receipts", "DELETE FROM product_stock_receipts")
    r_ps = db.execute(text("UPDATE product_stock_items SET current_qty = 0"))
    deleted["product_stock_items_qty_zeroed"] = max(0, int(r_ps.rowcount or 0))

    # Orders hierarchy
    d("production_orders", "DELETE FROM production_orders")
    d("job_items", "DELETE FROM job_items")
    d("jobs", "DELETE FROM jobs")
    d("customer_orders", "DELETE FROM customer_orders")

    # Reset SQLite AUTOINCREMENT so next ids start clean (optional but helps dev expectations)
    for tbl in _SQLITE_SEQUENCE_TABLES:
        try:
            db.execute(text("DELETE FROM sqlite_sequence WHERE name = :n"), {"n": tbl})
        except Exception:
            pass

    # Optional legacy technology tables (if present in DB)
    for tbl in ("routing_operations", "routings", "order_items"):
        try:
            r = db.execute(text(f"DELETE FROM {tbl}"))
            deleted[f"legacy_{tbl}"] = max(0, int(r.rowcount or 0))
        except Exception:
            pass
