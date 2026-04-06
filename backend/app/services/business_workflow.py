"""Lifecycle workflow for orders / job lines / VPs (storno, not hard delete in normal flow)."""

from __future__ import annotations

from sqlalchemy import func, or_

WORKFLOW_STATUS_ACTIVE = "active"
WORKFLOW_STATUS_DONE = "done"
WORKFLOW_STATUS_CANCELLED = "cancelled"
WORKFLOW_STATUS_SUPERSEDED = "superseded"
WORKFLOW_STATUS_ISSUED = "issued"


def workflow_record_active(entity) -> bool:
    v = getattr(entity, "workflow_status", None)
    if v is None:
        return True
    s = str(v).strip().lower()
    return s == "" or s == WORKFLOW_STATUS_ACTIVE


def workflow_active_sql(column):
    """SQL: legacy NULL/empty = active; only explicit cancelled is excluded."""
    return or_(
        column.is_(None),
        column == "",
        func.lower(func.trim(column)) == WORKFLOW_STATUS_ACTIVE,
    )
