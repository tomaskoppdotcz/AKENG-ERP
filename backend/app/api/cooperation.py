from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.deps import require_action
from app.core.database import get_db
from app.models.planning import PlanningOperation
from app.services.cooperation_operations import (
    cancel_cooperation_operation,
    mark_cooperation_pending_send,
    receive_cooperation_operation,
    send_cooperation_operation,
)

router = APIRouter()


class CooperationOperationPayload(BaseModel):
    supplier_purchase_order_id: int | None = None
    note: str | None = None


def _dt(value):
    return value.isoformat() if value else None


def _operation_response(op: PlanningOperation) -> dict:
    return {
        "status": "ok",
        "operation": {
            "id": int(op.id),
            "work_order_no": op.work_order_no,
            "operation_no": int(op.operation_no or 0),
            "operation_name": op.operation_name,
            "status": op.status,
            "is_cooperation": bool(op.is_cooperation),
            "cooperation_status": op.cooperation_status,
            "cooperation_supplier_purchase_order_id": op.cooperation_supplier_purchase_order_id,
            "cooperation_sent_at": _dt(op.cooperation_sent_at),
            "cooperation_received_at": _dt(op.cooperation_received_at),
            "cooperation_category": getattr(op, "cooperation_category", None),
            "preferred_supplier_id": getattr(op, "preferred_supplier_id", None),
            "cooperation_note": op.cooperation_note,
        },
    }


@router.post("/operations/{planning_operation_id}/mark-pending-send")
def mark_pending_send(
    planning_operation_id: int,
    payload: CooperationOperationPayload | None = None,
    db: Session = Depends(get_db),
    _rbac: None = Depends(require_action("production.execute")),
):
    body = payload or CooperationOperationPayload()
    op = mark_cooperation_pending_send(db, planning_operation_id, note=body.note)
    return _operation_response(op)


@router.post("/operations/{planning_operation_id}/send")
def send(
    planning_operation_id: int,
    payload: CooperationOperationPayload | None = None,
    db: Session = Depends(get_db),
    _rbac: None = Depends(require_action("production.execute")),
):
    body = payload or CooperationOperationPayload()
    op = send_cooperation_operation(
        db,
        planning_operation_id,
        supplier_purchase_order_id=body.supplier_purchase_order_id,
        note=body.note,
    )
    return _operation_response(op)


@router.post("/operations/{planning_operation_id}/receive")
def receive(
    planning_operation_id: int,
    payload: CooperationOperationPayload | None = None,
    db: Session = Depends(get_db),
    _rbac: None = Depends(require_action("production.execute")),
):
    body = payload or CooperationOperationPayload()
    op = receive_cooperation_operation(
        db,
        planning_operation_id,
        supplier_purchase_order_id=body.supplier_purchase_order_id,
        note=body.note,
    )
    return _operation_response(op)


@router.post("/operations/{planning_operation_id}/cancel")
def cancel(
    planning_operation_id: int,
    payload: CooperationOperationPayload | None = None,
    db: Session = Depends(get_db),
    _rbac: None = Depends(require_action("production.execute")),
):
    body = payload or CooperationOperationPayload()
    op = cancel_cooperation_operation(db, planning_operation_id, note=body.note)
    return _operation_response(op)
