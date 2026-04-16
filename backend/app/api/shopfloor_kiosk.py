from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import require_action
from app.core.database import get_db
from app.models.master_data import Machine
from app.models.planning import PlanningOperation
from app.services.employee_credential import find_employee_by_operator_label
from app.services.kiosk_planner_queue import list_planning_operations_for_kiosk_machine
from app.services.kiosk_shopfloor_resources import build_kiosk_resource_rows
from app.services.kiosk_work_report_service import (
    SOURCE_SHOPFLOOR_KIOSK,
    resolve_shopfloor_actor,
    work_report_complete,
    work_report_pause,
    work_report_resume,
    work_report_start,
)

router = APIRouter()


class StartOperationRequest(BaseModel):
    planning_operation_id: int
    operator_name: str | None = None


class PauseOperationRequest(BaseModel):
    planning_operation_id: int
    operator_name: str | None = None
    pause_reason: str = Field(..., min_length=1)
    note: str | None = None


class ResumeOperationRequest(BaseModel):
    planning_operation_id: int
    operator_name: str | None = None


class FinishOperationRequest(BaseModel):
    planning_operation_id: int
    qty_ok: int = 0
    qty_nok: int = 0
    operator_name: str | None = None
    note: str | None = None


def _machine_for_shopfloor_op(db: Session, op: PlanningOperation) -> Machine:
    mid = op.machine_id
    if not mid:
        raise HTTPException(
            status_code=400,
            detail="Operace nemá přiřazený stroj — nelze zapsat výkaz (přiřaďte stroj v plánovači).",
        )
    m = db.get(Machine, int(mid))
    if not m:
        raise HTTPException(status_code=404, detail="Stroj operace nenalezen.")
    return m


def _resolve_shopfloor_operator(db: Session, operator_name: str | None) -> tuple[int | None, str | None]:
    emp = find_employee_by_operator_label(db, operator_name)
    if emp:
        return int(emp.id), emp.name
    raw = (operator_name or "").strip() or None
    return None, raw


@router.get("/machines")
def get_kiosk_machines(db: Session = Depends(get_db)):
    """
    Jedna položka na provozní pracoviště (workplace_library_item): více strojů se stejným
    workplace_library_item_id se sloučí (Kontrola, Expedice, Ruční+praní, …).
    """
    return {"machines": build_kiosk_resource_rows(db)}


@router.get("/machine-operations")
def get_machine_operations(machine_id: int, db: Session = Depends(get_db)):
    machine = db.get(Machine, machine_id)
    if not machine:
        raise HTTPException(status_code=404, detail="Machine not found")
    ops = list_planning_operations_for_kiosk_machine(db, machine)

    return {
        "operations": [
            {
                "id": op.id,
                "work_order_no": op.work_order_no,
                "gpn": op.gpn,
                "operation_name": op.operation_name,
                "operation_no": op.operation_no,
                "qty": op.qty,
                "queue_position": op.queue_position,
                "status": op.status,
                "planned_start": op.planned_start.isoformat() if op.planned_start else None,
                "planned_end": op.planned_end.isoformat() if op.planned_end else None,
                "qty_ok": op.qty_ok,
                "qty_nok": op.qty_nok,
                "actual_start": op.actual_start.isoformat() if op.actual_start else None,
                "actual_end": op.actual_end.isoformat() if op.actual_end else None,
            }
            for op in ops
        ]
    }


@router.post("/start")
def start_operation(
    payload: StartOperationRequest,
    db: Session = Depends(get_db),
    _rbac: None = Depends(require_action("production.execute")),
):
    op = db.get(PlanningOperation, payload.planning_operation_id)
    if not op:
        raise HTTPException(status_code=404, detail="Planning operation not found")

    emp_id, disp = _resolve_shopfloor_operator(db, payload.operator_name)
    actor = resolve_shopfloor_actor(payload.operator_name, emp_id)
    machine = _machine_for_shopfloor_op(db, op)
    r = work_report_start(
        db,
        op,
        machine=machine,
        employee_id=emp_id,
        operator_display=disp,
        source=SOURCE_SHOPFLOOR_KIOSK,
        actor=actor,
        kiosk_session_id=None,
    )
    db.refresh(op)
    return {
        **r,
        "operation": {
            "id": op.id,
            "work_order_no": op.work_order_no,
            "operation_name": op.operation_name,
            "status": op.status,
            "actual_start": op.actual_start.isoformat() if op.actual_start else None,
        },
    }


@router.post("/pause")
def pause_operation(
    payload: PauseOperationRequest,
    db: Session = Depends(get_db),
    _rbac: None = Depends(require_action("production.execute")),
):
    op = db.get(PlanningOperation, payload.planning_operation_id)
    if not op:
        raise HTTPException(status_code=404, detail="Planning operation not found")
    emp_id, disp = _resolve_shopfloor_operator(db, payload.operator_name)
    actor = resolve_shopfloor_actor(payload.operator_name, emp_id)
    machine = _machine_for_shopfloor_op(db, op)
    r = work_report_pause(
        db,
        op,
        machine=machine,
        employee_id=emp_id,
        operator_display=disp,
        pause_reason=payload.pause_reason,
        note=payload.note,
        source=SOURCE_SHOPFLOOR_KIOSK,
        actor=actor,
    )
    db.refresh(op)
    return {
        **r,
        "operation": {
            "id": op.id,
            "work_order_no": op.work_order_no,
            "operation_name": op.operation_name,
            "status": op.status,
        },
    }


@router.post("/resume")
def resume_operation(
    payload: ResumeOperationRequest,
    db: Session = Depends(get_db),
    _rbac: None = Depends(require_action("production.execute")),
):
    op = db.get(PlanningOperation, payload.planning_operation_id)
    if not op:
        raise HTTPException(status_code=404, detail="Planning operation not found")
    emp_id, disp = _resolve_shopfloor_operator(db, payload.operator_name)
    actor = resolve_shopfloor_actor(payload.operator_name, emp_id)
    machine = _machine_for_shopfloor_op(db, op)
    r = work_report_resume(
        db,
        op,
        machine=machine,
        employee_id=emp_id,
        operator_display=disp,
        source=SOURCE_SHOPFLOOR_KIOSK,
        actor=actor,
    )
    db.refresh(op)
    return {
        **r,
        "operation": {
            "id": op.id,
            "work_order_no": op.work_order_no,
            "operation_name": op.operation_name,
            "status": op.status,
        },
    }


@router.post("/finish")
def finish_operation(
    payload: FinishOperationRequest,
    db: Session = Depends(get_db),
    _rbac: None = Depends(require_action("production.execute")),
):
    op = db.get(PlanningOperation, payload.planning_operation_id)
    if not op:
        raise HTTPException(status_code=404, detail="Planning operation not found")
    emp_id, disp = _resolve_shopfloor_operator(db, payload.operator_name)
    actor = resolve_shopfloor_actor(payload.operator_name, emp_id)
    machine = _machine_for_shopfloor_op(db, op)
    r = work_report_complete(
        db,
        op,
        machine=machine,
        employee_id=emp_id,
        operator_display=disp,
        qty_ok=int(payload.qty_ok or 0),
        qty_nok=int(payload.qty_nok or 0),
        note=payload.note,
        source=SOURCE_SHOPFLOOR_KIOSK,
        actor=actor,
    )
    db.refresh(op)
    out = {
        **r,
        "operation": {
            "id": op.id,
            "work_order_no": op.work_order_no,
            "operation_name": op.operation_name,
            "status": op.status,
            "actual_start": op.actual_start.isoformat() if op.actual_start else None,
            "actual_end": op.actual_end.isoformat() if op.actual_end else None,
            "qty_ok": op.qty_ok,
            "qty_nok": op.qty_nok,
        },
    }
    if "tp_stock_effect" in r:
        out["tp_stock_effect"] = r["tp_stock_effect"]
    return out
