"""Production order material readiness from active TP material reservations + free stock."""

from __future__ import annotations

from collections import defaultdict

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.material_stock import MaterialReservation
from app.models.orders import ProductionOrder
from app.models.planning import PlanningOperation
from app.services.business_workflow import workflow_record_active
from app.services.material_reservation_sync import MATERIAL_RESERVATION_ACTIVE_STATUSES


def evaluate_production_order_material_ready(db: Session, po: ProductionOrder) -> bool:
    if not workflow_record_active(po):
        return False
    rows = db.scalars(
        select(MaterialReservation).where(
            MaterialReservation.production_order_id == int(po.id),
            MaterialReservation.status.in_(tuple(MATERIAL_RESERVATION_ACTIVE_STATUSES)),
            MaterialReservation.is_active.is_(True),
        )
    ).all()
    if not rows:
        return True

    from app.api.orders import _available_material_qty

    gaps: dict[int, float] = defaultdict(float)
    for r in rows:
        mid = int(r.material_library_item_id)
        req = float(r.required_qty or 0.0)
        res = float(r.reserved_qty or 0.0)
        gaps[mid] += max(0.0, req - res)
    for mid, gap in gaps.items():
        if gap <= 1e-9:
            continue
        free = float(_available_material_qty(db, mid))
        if free + 1e-9 < gap:
            return False
    return True


def sync_planning_operations_material_ready(db: Session, po: ProductionOrder) -> None:
    vp = (po.vp_code or "").strip()
    if not vp:
        return
    ready = bool(getattr(po, "is_material_ready", True))
    for op in db.scalars(select(PlanningOperation).where(PlanningOperation.work_order_no == vp)).all():
        op.material_ready = ready


def refresh_production_order_material_readiness(db: Session, po: ProductionOrder | None) -> bool:
    if po is None:
        return False
    val = evaluate_production_order_material_ready(db, po)
    po.is_material_ready = val
    sync_planning_operations_material_ready(db, po)
    return val


def refresh_material_readiness_for_production_order_ids(db: Session, ids: set[int] | list[int]) -> int:
    id_list = sorted({int(x) for x in ids})
    if not id_list:
        return 0
    n = 0
    for pid in id_list:
        po = db.get(ProductionOrder, int(pid))
        if po is not None:
            refresh_production_order_material_readiness(db, po)
            n += 1
    return n


def refresh_material_readiness_for_material_library_item(db: Session, material_library_item_id: int) -> int:
    po_ids = db.scalars(
        select(MaterialReservation.production_order_id).where(
            MaterialReservation.material_library_item_id == int(material_library_item_id),
            MaterialReservation.status.in_(tuple(MATERIAL_RESERVATION_ACTIVE_STATUSES)),
            MaterialReservation.is_active.is_(True),
        ).distinct()
    ).all()
    return refresh_material_readiness_for_production_order_ids(db, {int(x) for x in po_ids if x is not None})


def ensure_planning_operation_material_ready_for_start(db: Session, op: PlanningOperation) -> None:
    woo = (op.work_order_no or "").strip()
    if not woo:
        return
    po = db.scalar(select(ProductionOrder).where(ProductionOrder.vp_code == woo))
    if po is None:
        return
    if not workflow_record_active(po):
        return
    if not bool(getattr(po, "is_material_ready", True)):
        raise HTTPException(
            status_code=409,
            detail="Nelze zahájit operaci: materiál pro tento výrobní příkaz není připraven (nedostatečný stav skladu nebo rezervace).",
        )
