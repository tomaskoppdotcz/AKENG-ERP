from __future__ import annotations

from datetime import date, datetime

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.planning import MachineSchedule, PlanningOperation, PlanningScheduleSegment

COOPERATION_STATUSES = frozenset({"none", "pending_send", "sent", "received", "cancelled"})


def is_cooperation_operation_name(name: str | None) -> bool:
    return "kooperace" in (name or "").strip().lower()


def operation_is_cooperation(
    *,
    operation_name: str | None,
    outsourcing: bool | None = None,
    manual: bool | None = None,
) -> bool:
    return bool(manual) or bool(outsourcing) or is_cooperation_operation_name(operation_name)


def normalize_cooperation_status(raw: str | None, *, is_cooperation: bool) -> str:
    value = (raw or "").strip().lower()
    if value in COOPERATION_STATUSES:
        return value
    return "pending_send" if is_cooperation else "none"


def cooperation_blocks_successors(op: PlanningOperation) -> bool:
    if not bool(getattr(op, "is_cooperation", False)):
        return False
    return normalize_cooperation_status(
        getattr(op, "cooperation_status", None),
        is_cooperation=True,
    ) != "received"


def cooperation_operation_exclusion_reason(op: PlanningOperation) -> str | None:
    if not bool(getattr(op, "is_cooperation", False)):
        return None
    status = normalize_cooperation_status(getattr(op, "cooperation_status", None), is_cooperation=True)
    if status == "received":
        return "external_cooperation_received"
    if status == "sent":
        return "external_cooperation_sent"
    if status == "cancelled":
        return "external_cooperation_cancelled"
    return "external_cooperation_pending_send"


def cooperation_status_label_cs(status: str | None) -> str:
    value = normalize_cooperation_status(status, is_cooperation=True)
    return {
        "pending_send": "Čeká na odeslání",
        "sent": "Odesláno do kooperace",
        "received": "Přijato z kooperace",
        "cancelled": "Zrušeno",
        "none": "Bez kooperace",
    }.get(value, value)


def get_cooperation_operation_or_404(db: Session, planning_operation_id: int) -> PlanningOperation:
    op = db.get(PlanningOperation, int(planning_operation_id))
    if op is None:
        raise HTTPException(status_code=404, detail="Plánovací operace nebyla nalezena.")
    op.is_cooperation = True
    if not getattr(op, "cooperation_status", None):
        op.cooperation_status = "pending_send"
    return op


def remove_internal_schedule_for_operation(db: Session, op: PlanningOperation) -> None:
    db.query(MachineSchedule).filter(MachineSchedule.planning_operation_id == int(op.id)).delete(synchronize_session=False)
    db.query(PlanningScheduleSegment).filter(
        PlanningScheduleSegment.planning_operation_id == int(op.id)
    ).delete(synchronize_session=False)
    op.planned_start = None
    op.planned_end = None
    op.queue_position = None
    op.latest_start = None


def mark_cooperation_pending_send(
    db: Session,
    planning_operation_id: int,
    *,
    note: str | None = None,
    commit: bool = True,
    rebuild: bool = True,
) -> PlanningOperation:
    op = get_cooperation_operation_or_404(db, planning_operation_id)
    op.cooperation_status = "pending_send"
    op.cooperation_note = note if note is not None else op.cooperation_note
    if op.status in (None, "", "planned", "ready", "waiting_release", "naplanovano", "ceka"):
        op.status = "waiting_release"
    remove_internal_schedule_for_operation(db, op)
    if commit:
        db.commit()
    if rebuild:
        from app.services.planning_engine import PlanningEngineService

        PlanningEngineService(db).rebuild_all(date.today())
        db.refresh(op)
    return op


def send_cooperation_operation(
    db: Session,
    planning_operation_id: int,
    *,
    supplier_purchase_order_id: int | None = None,
    note: str | None = None,
    commit: bool = True,
    rebuild: bool = True,
) -> PlanningOperation:
    op = get_cooperation_operation_or_404(db, planning_operation_id)
    op.cooperation_status = "sent"
    op.cooperation_sent_at = datetime.utcnow()
    if supplier_purchase_order_id is not None:
        op.cooperation_supplier_purchase_order_id = int(supplier_purchase_order_id)
    op.cooperation_note = note if note is not None else op.cooperation_note
    if op.status in (None, "", "planned", "ready", "waiting_release", "naplanovano", "ceka"):
        op.status = "waiting_release"
    remove_internal_schedule_for_operation(db, op)
    if commit:
        db.commit()
    if rebuild:
        from app.services.planning_engine import PlanningEngineService

        PlanningEngineService(db).rebuild_all(date.today())
        db.refresh(op)
    return op


def receive_cooperation_operation(
    db: Session,
    planning_operation_id: int,
    *,
    supplier_purchase_order_id: int | None = None,
    note: str | None = None,
    commit: bool = True,
    rebuild: bool = True,
) -> PlanningOperation:
    op = get_cooperation_operation_or_404(db, planning_operation_id)
    op.cooperation_status = "received"
    op.cooperation_received_at = datetime.utcnow()
    if supplier_purchase_order_id is not None:
        op.cooperation_supplier_purchase_order_id = int(supplier_purchase_order_id)
    op.cooperation_note = note if note is not None else op.cooperation_note
    op.status = "hotovo"
    op.actual_end = op.actual_end or op.cooperation_received_at
    remove_internal_schedule_for_operation(db, op)
    if commit:
        db.commit()
    if rebuild:
        from app.services.planning_engine import PlanningEngineService

        PlanningEngineService(db).rebuild_all(date.today())
        db.refresh(op)
    return op


def cancel_cooperation_operation(
    db: Session,
    planning_operation_id: int,
    *,
    note: str | None = None,
    commit: bool = True,
    rebuild: bool = True,
) -> PlanningOperation:
    op = get_cooperation_operation_or_404(db, planning_operation_id)
    op.cooperation_status = "cancelled"
    op.cooperation_note = note if note is not None else op.cooperation_note
    op.status = "blokovano"
    remove_internal_schedule_for_operation(db, op)
    if commit:
        db.commit()
    if rebuild:
        from app.services.planning_engine import PlanningEngineService

        PlanningEngineService(db).rebuild_all(date.today())
        db.refresh(op)
    return op


def linked_supplier_po_id_for_operation(db: Session, planning_operation_id: int) -> int | None:
    from app.models.supplier_purchase_order import SupplierPurchaseOrder

    row = db.scalar(
        select(SupplierPurchaseOrder.id)
        .where(SupplierPurchaseOrder.planning_operation_id == int(planning_operation_id))
        .order_by(SupplierPurchaseOrder.id.desc())
    )
    return int(row) if row is not None else None
