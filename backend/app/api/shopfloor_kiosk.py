from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.deps import require_action
from app.core.database import get_db
from app.models.master_data import Machine
from app.models.kiosk import OperationEvent
from app.models.planning import PlanningOperation
from app.services.kiosk_planner_queue import list_planning_operations_for_kiosk_machine
from app.services.kiosk_vp_operation_order import assert_vp_previous_operations_finished_for_kiosk_start
from app.services.kiosk_shopfloor_resources import build_kiosk_resource_rows
from app.services.kiosk_tp_stock_effects import apply_kiosk_tp_stock_effect_on_operation_complete
from app.services.planning_engine import PlanningEngineService

router = APIRouter()


class StartOperationRequest(BaseModel):
    planning_operation_id: int
    operator_name: str | None = None


class StopOperationRequest(BaseModel):
    planning_operation_id: int
    operator_name: str | None = None


class FinishOperationRequest(BaseModel):
    planning_operation_id: int
    qty_ok: int = 0
    qty_nok: int = 0
    operator_name: str | None = None


def build_operation_event(
    op: PlanningOperation,
    event_type: str,
    note: str,
    qty_ok: int,
    qty_nok: int,
    operator_name: str | None,
    event_time: datetime,
):
    columns = set(OperationEvent.__table__.columns.keys())
    payload = {}

    if "planning_operation_id" in columns:
        payload["planning_operation_id"] = op.id
    if "machine_id" in columns:
        payload["machine_id"] = op.machine_id
    if "event_type" in columns:
        payload["event_type"] = event_type
    if "event_time" in columns:
        payload["event_time"] = event_time
    if "qty_ok" in columns:
        payload["qty_ok"] = qty_ok
    if "qty_nok" in columns:
        payload["qty_nok"] = qty_nok
    if "note" in columns:
        payload["note"] = note
    if "reason" in columns:
        payload["reason"] = None

    if operator_name:
        if "employee_code" in columns:
            payload["employee_code"] = operator_name
        elif "operator_name" in columns:
            payload["operator_name"] = operator_name
        elif "employee_name" in columns:
            payload["employee_name"] = operator_name
        elif "employee" in columns:
            payload["employee"] = operator_name

    return OperationEvent(**payload)


def try_write_event(
    db: Session,
    op: PlanningOperation,
    event_type: str,
    note: str,
    qty_ok: int,
    qty_nok: int,
    operator_name: str | None,
):
    try:
        event = build_operation_event(
            op=op,
            event_type=event_type,
            note=note,
            qty_ok=qty_ok,
            qty_nok=qty_nok,
            operator_name=operator_name,
            event_time=datetime.now(),
        )
        db.add(event)
        db.commit()
        return True
    except Exception:
        db.rollback()
        return False


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

    assert_vp_previous_operations_finished_for_kiosk_start(db, op)

    from app.services.material_readiness import ensure_planning_operation_material_ready_for_start

    ensure_planning_operation_material_ready_for_start(db, op)

    now = datetime.now()

    if op.actual_start is None:
        op.actual_start = now

    op.status = "bezi"
    db.commit()
    db.refresh(op)

    event_logged = try_write_event(
        db=db,
        op=op,
        event_type="start",
        note="START from kiosk",
        qty_ok=0,
        qty_nok=0,
        operator_name=payload.operator_name,
    )

    return {
        "status": "ok",
        "event_logged": event_logged,
        "operation": {
            "id": op.id,
            "work_order_no": op.work_order_no,
            "operation_name": op.operation_name,
            "status": op.status,
            "actual_start": op.actual_start.isoformat() if op.actual_start else None,
        },
    }


@router.post("/stop")
def stop_operation(
    payload: StopOperationRequest,
    db: Session = Depends(get_db),
    _rbac: None = Depends(require_action("production.execute")),
):
    op = db.get(PlanningOperation, payload.planning_operation_id)
    if not op:
        raise HTTPException(status_code=404, detail="Planning operation not found")

    op.status = "ceka"
    db.commit()
    db.refresh(op)

    event_logged = try_write_event(
        db=db,
        op=op,
        event_type="stop",
        note="STOP from kiosk",
        qty_ok=0,
        qty_nok=0,
        operator_name=payload.operator_name,
    )

    return {
        "status": "ok",
        "event_logged": event_logged,
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

    now = datetime.now()

    if op.actual_start is None:
        op.actual_start = now

    op.actual_end = now
    op.qty_ok = int(payload.qty_ok or 0)
    op.qty_nok = int(payload.qty_nok or 0)
    op.status = "hotovo"
    db.flush()
    stock_effect = apply_kiosk_tp_stock_effect_on_operation_complete(db, op, qty_ok=int(payload.qty_ok or 0))
    db.commit()
    db.refresh(op)

    # Přeskupit následné operace podle actual_end / uvolněné kapacity (vlastní commit uvnitř).
    PlanningEngineService(db).rebuild_global_schedules(date.today())

    event_logged = try_write_event(
        db=db,
        op=op,
        event_type="finish",
        note="FINISH from kiosk",
        qty_ok=op.qty_ok,
        qty_nok=op.qty_nok,
        operator_name=payload.operator_name,
    )

    out = {
        "status": "ok",
        "event_logged": event_logged,
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
    if stock_effect is not None:
        out["tp_stock_effect"] = stock_effect
    return out
