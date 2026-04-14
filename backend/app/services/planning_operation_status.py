"""
Canonical strings for planning_operations.status and production_orders.status (operational VP).

Single vocabulary for planner, kiosk, work reports, and API consumers:
- Planning row: waiting_release, ready, planned, naplanovano, ceka, bezi, hotovo, blokovano, scheduling_late, cancelled
- VP aggregate (production_orders.status): planned, bezi, hotovo

Legacy values (finished, done, in_progress, …) are normalized at startup and should not be written by new code.
"""

from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.engine import Engine

# --- Planning operation (planning_operations.status) ---

LEGACY_PLANNING_STATUS_TO_CANONICAL: dict[str, str] = {
    "finished": "hotovo",
    "done": "hotovo",
    "complete": "hotovo",
    "completed": "hotovo",
    "running": "bezi",
    "in_progress": "bezi",
    "started": "bezi",
}

CANONICAL_PLANNING_OPERATION_STATUSES: frozenset[str] = frozenset(
    {
        "waiting_release",
        "ready",
        "planned",
        "naplanovano",
        "ceka",
        "bezi",
        "hotovo",
        "blokovano",
        "scheduling_late",
        "cancelled",
    }
)


def normalize_planning_operation_status(raw: str | None) -> str:
    s = (raw or "").strip().lower()
    if not s:
        return "planned"
    return LEGACY_PLANNING_STATUS_TO_CANONICAL.get(s, s)


def planning_operation_status_is_terminal(raw: str | None) -> bool:
    return normalize_planning_operation_status(raw) in ("hotovo", "cancelled")


def planning_operation_status_is_protected_for_queue_normalize(raw: str | None) -> bool:
    """Do not rewrite queue head / siblings (vp_operation_generator.normalize_planning_queue_statuses_for_vp_code)."""
    s = normalize_planning_operation_status(raw)
    return s in ("hotovo", "cancelled", "bezi", "scheduling_late", "blokovano")


# --- Production order aggregate (production_orders.status) ---

LEGACY_PRODUCTION_ORDER_STATUS_TO_CANONICAL: dict[str, str] = {
    "done": "hotovo",
    "in_progress": "bezi",
    "finished": "hotovo",
    "complete": "hotovo",
    "completed": "hotovo",
}


def normalize_production_order_status(raw: str | None) -> str:
    s = (raw or "").strip().lower()
    if not s:
        return "planned"
    return LEGACY_PRODUCTION_ORDER_STATUS_TO_CANONICAL.get(s, s)


def backfill_canonical_statuses(engine: Engine) -> None:
    """Normalize legacy DB values in-place (idempotent)."""
    stmts = [
        text(
            """
            UPDATE planning_operations SET status = CASE lower(trim(status))
                WHEN 'finished' THEN 'hotovo'
                WHEN 'done' THEN 'hotovo'
                WHEN 'complete' THEN 'hotovo'
                WHEN 'completed' THEN 'hotovo'
                WHEN 'running' THEN 'bezi'
                WHEN 'in_progress' THEN 'bezi'
                WHEN 'started' THEN 'bezi'
                ELSE status END
            WHERE lower(trim(status)) IN (
                'finished', 'done', 'complete', 'completed',
                'running', 'in_progress', 'started'
            )
            """
        ),
        text(
            """
            UPDATE production_orders SET status = CASE lower(trim(status))
                WHEN 'done' THEN 'hotovo'
                WHEN 'in_progress' THEN 'bezi'
                WHEN 'finished' THEN 'hotovo'
                WHEN 'complete' THEN 'hotovo'
                WHEN 'completed' THEN 'hotovo'
                ELSE status END
            WHERE lower(trim(status)) IN (
                'done', 'in_progress', 'finished', 'complete', 'completed'
            )
            """
        ),
    ]
    with engine.begin() as conn:
        for stmt in stmts:
            conn.execute(stmt)
