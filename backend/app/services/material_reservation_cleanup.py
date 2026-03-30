"""Deactivate orphaned material reservations (missing PO / job item / job / material)."""

from __future__ import annotations

import logging
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.material_library import MaterialLibraryItem
from app.models.material_stock import MaterialReservation
from app.models.orders import Job, JobItem, ProductionOrder

logger = logging.getLogger(__name__)

_NOTE_SUFFIX = "Inactive: orphan source (cleanup-orphans)"


def cleanup_orphan_material_reservations(db: Session) -> dict[str, Any]:
    """
    Set is_active=False on reservations whose FK targets no longer exist or are inconsistent.
    Does not delete rows. Skips status=issued.
    """
    rows = db.scalars(select(MaterialReservation).where(MaterialReservation.is_active.is_(True))).all()
    rows_checked = len(rows)
    rows_cleaned = 0
    rows_skipped = 0

    po_ids: set[int] = set()
    for res in rows:
        if str(res.status or "").strip().lower() == "issued":
            rows_skipped += 1
            continue

        po = db.get(ProductionOrder, int(res.production_order_id))
        ji = db.get(JobItem, int(res.job_item_id))
        mat = db.get(MaterialLibraryItem, int(res.material_library_item_id))

        orphan = False
        if po is None or ji is None or mat is None:
            orphan = True
        elif int(po.job_item_id or 0) != int(res.job_item_id):
            orphan = True
        elif ji.job_id is None:
            orphan = True
        else:
            job = db.get(Job, int(ji.job_id))
            if job is None:
                orphan = True

        if not orphan:
            rows_skipped += 1
            continue

        po_ids.add(int(res.production_order_id))
        res.is_active = False
        note = (res.note or "").strip()
        res.note = f"{note} | {_NOTE_SUFFIX}" if note else _NOTE_SUFFIX
        rows_cleaned += 1

    logger.info(
        "[material_consumption] material_reservation_cleanup_orphans | rows_checked=%s rows_cleaned=%s rows_skipped=%s",
        rows_checked,
        rows_cleaned,
        rows_skipped,
    )

    if po_ids:
        from app.services.material_readiness import refresh_material_readiness_for_production_order_ids

        refresh_material_readiness_for_production_order_ids(db, po_ids)

    return {
        "rows_checked": rows_checked,
        "rows_cleaned": rows_cleaned,
        "rows_skipped": rows_skipped,
    }
