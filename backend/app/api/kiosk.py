from datetime import datetime, timedelta, date

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.kiosk import Employee, Kiosk, KioskSession, OperationEvent
from app.models.master_data import Machine
from app.models.planning import PlanningOperation
from app.services.planning_engine import PlanningEngineService

router = APIRouter()


class KioskLoginCardRequest(BaseModel):
    kiosk_code: str
    card_uid: str


class KioskStartOperationRequest(BaseModel):
    kiosk_code: str
    planning_operation_id: int


class KioskPauseOperationRequest(BaseModel):
    kiosk_code: str
    planning_operation_id: int
    reason: str | None = None
    note: str | None = None


class KioskFinishOperationRequest(BaseModel):
    kiosk_code: str
    planning_operation_id: int
    qty_ok: int = 0
    qty_nok: int = 0
    note: str | None = None


def _get_active_session(db: Session, kiosk_id: int) -> KioskSession:
    session = db.scalar(
        select(KioskSession)
        .where(KioskSession.kiosk_id == kiosk_id)
        .where(KioskSession.is_active == True)
    )
    if not session:
        raise HTTPException(status_code=400, detail="No active kiosk session")
    return session


@router.post("/login-card")
def kiosk_login_card(payload: KioskLoginCardRequest, db: Session = Depends(get_db)):
    kiosk = db.scalar(
        select(Kiosk).where(Kiosk.kiosk_code == payload.kiosk_code).where(Kiosk.is_active == True)
    )
    if not kiosk:
        raise HTTPException(status_code=404, detail="Kiosk not found")

    employee = db.scalar(
        select(Employee).where(Employee.card_uid == payload.card_uid).where(Employee.is_active == True)
    )
    if not employee:
        raise HTTPException(status_code=404, detail="Employee card not found")

    active_sessions = db.scalars(
        select(KioskSession)
        .where(KioskSession.kiosk_id == kiosk.id)
        .where(KioskSession.is_active == True)
    ).all()

    for s in active_sessions:
        s.is_active = False
        s.ended_at = datetime.utcnow()

    session = KioskSession(
        kiosk_id=kiosk.id,
        machine_id=kiosk.machine_id,
        employee_id=employee.id,
        started_at=datetime.utcnow(),
        is_active=True,
    )
    db.add(session)
    db.commit()

    machine = db.get(Machine, kiosk.machine_id)

    return {
        "status": "ok",
        "employee": {"id": employee.id, "name": employee.name},
        "machine": {"id": machine.id, "name": machine.name},
    }


@router.get("/machine-queue")
def kiosk_machine_queue(kiosk_code: str, db: Session = Depends(get_db)):
    kiosk = db.scalar(select(Kiosk).where(Kiosk.kiosk_code == kiosk_code))
    if not kiosk:
        raise HTTPException(status_code=404, detail="Kiosk not found")

    session = db.scalar(
        select(KioskSession)
        .where(KioskSession.kiosk_id == kiosk.id)
        .where(KioskSession.is_active == True)
    )

    machine = db.get(Machine, kiosk.machine_id)

    ops = db.scalars(
        select(PlanningOperation)
        .where(PlanningOperation.machine_id == kiosk.machine_id)
        .where(PlanningOperation.queue_position.is_not(None))
        .order_by(PlanningOperation.queue_position)
    ).all()

    return {
        "machine": {"id": machine.id, "name": machine.name},
        "employee": (
            {"id": session.employee_id, "name": db.get(Employee, session.employee_id).name}
            if session else None
        ),
        "queue": [
            {
                "planning_operation_id": op.id,
                "queue_position": op.queue_position,
                "gpn": op.gpn,
                "operation_name": op.operation_name,
                "qty": op.qty,
                "planned_start": op.planned_start,
                "planned_end": op.planned_end,
                "status": op.status,
            }
            for op in ops
        ],
    }


@router.post("/start-operation")
def kiosk_start_operation(payload: KioskStartOperationRequest, db: Session = Depends(get_db)):
    kiosk = db.scalar(select(Kiosk).where(Kiosk.kiosk_code == payload.kiosk_code))
    if not kiosk:
        raise HTTPException(status_code=404, detail="Kiosk not found")

    session = _get_active_session(db, kiosk.id)

    op = db.get(PlanningOperation, payload.planning_operation_id)
    if not op:
        raise HTTPException(status_code=404, detail="Planning operation not found")

    if op.machine_id != kiosk.machine_id:
        raise HTTPException(status_code=400, detail="Operation does not belong to kiosk machine")

    event = OperationEvent(
        planning_operation_id=op.id,
        machine_id=kiosk.machine_id,
        employee_id=session.employee_id,
        event_type="start",
        event_time=datetime.utcnow(),
    )
    db.add(event)

    op.status = "running"
    if hasattr(op, "actual_start") and not getattr(op, "actual_start", None):
        op.actual_start = datetime.utcnow()

    db.commit()

    return {
        "status": "ok",
        "planning_operation_id": op.id,
        "operation_status": op.status,
    }


@router.post("/pause-operation")
def kiosk_pause_operation(payload: KioskPauseOperationRequest, db: Session = Depends(get_db)):
    kiosk = db.scalar(select(Kiosk).where(Kiosk.kiosk_code == payload.kiosk_code))
    if not kiosk:
        raise HTTPException(status_code=404, detail="Kiosk not found")

    session = _get_active_session(db, kiosk.id)

    op = db.get(PlanningOperation, payload.planning_operation_id)
    if not op:
        raise HTTPException(status_code=404, detail="Planning operation not found")

    event = OperationEvent(
        planning_operation_id=op.id,
        machine_id=kiosk.machine_id,
        employee_id=session.employee_id,
        event_type="pause",
        event_time=datetime.utcnow(),
        reason=payload.reason,
        note=payload.note,
    )
    db.add(event)
    op.status = "paused"
    db.commit()

    return {"status": "ok", "planning_operation_id": op.id, "operation_status": op.status}


@router.post("/finish-operation")
def kiosk_finish_operation(payload: KioskFinishOperationRequest, db: Session = Depends(get_db)):
    kiosk = db.scalar(select(Kiosk).where(Kiosk.kiosk_code == payload.kiosk_code))
    if not kiosk:
        raise HTTPException(status_code=404, detail="Kiosk not found")

    session = _get_active_session(db, kiosk.id)

    op = db.get(PlanningOperation, payload.planning_operation_id)
    if not op:
        raise HTTPException(status_code=404, detail="Planning operation not found")

    event = OperationEvent(
        planning_operation_id=op.id,
        machine_id=kiosk.machine_id,
        employee_id=session.employee_id,
        event_type="done",
        event_time=datetime.utcnow(),
        qty_ok=payload.qty_ok,
        qty_nok=payload.qty_nok,
        note=payload.note,
    )
    db.add(event)

    now = datetime.utcnow()
    op.status = "finished"

    if hasattr(op, "actual_end"):
        op.actual_end = now
    if hasattr(op, "qty_ok"):
        op.qty_ok = payload.qty_ok
    if hasattr(op, "qty_nok"):
        op.qty_nok = payload.qty_nok

    next_op = db.scalar(
        select(PlanningOperation)
        .where(PlanningOperation.order_item_id == op.order_item_id)
        .where(PlanningOperation.operation_no > op.operation_no)
        .order_by(PlanningOperation.operation_no.asc())
    )

    next_operation_released = False

    if next_op:
        buffer_after_min = getattr(op, "buffer_after_min", 20) or 20
        release_time = now + timedelta(minutes=buffer_after_min)

        if hasattr(next_op, "released_at"):
            next_op.released_at = release_time

        next_op.status = "ready"
        next_operation_released = True

        planner = PlanningEngineService(db)
        planner.rebuild_machine_schedule(next_op.machine_id, date.today())

    db.commit()

    return {
        "status": "ok",
        "finished_operation_id": op.id,
        "qty_ok": payload.qty_ok,
        "qty_nok": payload.qty_nok,
        "next_operation_released": next_operation_released,
        "next_operation_id": next_op.id if next_op else None,
    }
