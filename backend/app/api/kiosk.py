from __future__ import annotations

import re
from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.kiosk import Employee, Kiosk, KioskActivityLog, KioskSession, OperationEvent
from app.models.master_data import Machine
from app.models.planning import PlanningOperation
from app.services.planning_engine import PlanningEngineService

router = APIRouter()


# --- Legacy payloads (kiosk_code) -------------------------------------------------
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


# --- MVP machine-bound payloads -------------------------------------------------
class MachineLoginRequest(BaseModel):
    machine_code: str = Field(..., min_length=1)
    employee_code: str = Field(..., min_length=1, description="Scan or employee code")


class MachineLogoutRequest(BaseModel):
    machine_code: str = Field(..., min_length=1)


class MachineOperationIdRequest(BaseModel):
    machine_code: str = Field(..., min_length=1)
    planning_operation_id: int


class MachinePauseRequest(BaseModel):
    machine_code: str = Field(..., min_length=1)
    planning_operation_id: int
    reason: str | None = None
    note: str | None = None


class MachineDoneRequest(BaseModel):
    machine_code: str = Field(..., min_length=1)
    planning_operation_id: int
    qty_ok: int = 0
    qty_nok: int = 0
    note: str | None = None


class KioskActivityRequest(BaseModel):
    machine_code: str = Field(..., min_length=1)
    activity_type: str = Field(..., min_length=1)
    note: str | None = None


def _get_or_create_kiosk_for_machine(db: Session, machine: Machine) -> Kiosk:
    k = db.scalar(select(Kiosk).where(Kiosk.machine_id == int(machine.id)).where(Kiosk.is_active.is_(True)))
    if k:
        return k
    k = Kiosk(
        kiosk_code=str(machine.machine_code),
        name=f"Kiosk {machine.name}",
        machine_id=int(machine.id),
        is_active=True,
    )
    db.add(k)
    db.commit()
    db.refresh(k)
    return k


def _resolve_machine(db: Session, machine_code: str) -> Machine:
    code = (machine_code or "").strip()
    if not code:
        raise HTTPException(status_code=422, detail="machine_code je povinný.")
    m = db.scalar(select(Machine).where(Machine.machine_code == code))
    if not m:
        raise HTTPException(status_code=404, detail="Stroj nebyl nalezen.")
    return m


def _kiosk_from_machine_code(db: Session, machine_code: str) -> Kiosk:
    machine = _resolve_machine(db, machine_code)
    return _get_or_create_kiosk_for_machine(db, machine)


def _get_active_session(db: Session, kiosk_id: int) -> KioskSession:
    session = db.scalar(
        select(KioskSession)
        .where(KioskSession.kiosk_id == kiosk_id)
        .where(KioskSession.is_active.is_(True))
    )
    if not session:
        raise HTTPException(status_code=400, detail="Žádná aktivní kiosk session — přihlaste operátora.")
    return session


def _serialize_op(op: PlanningOperation) -> dict:
    return {
        "planning_operation_id": op.id,
        "work_order_no": op.work_order_no,
        "queue_position": op.queue_position,
        "gpn": op.gpn,
        "operation_name": op.operation_name,
        "operation_no": op.operation_no,
        "qty": op.qty,
        "planned_start": op.planned_start.isoformat() if op.planned_start else None,
        "planned_end": op.planned_end.isoformat() if op.planned_end else None,
        "status": op.status,
        "qty_ok": op.qty_ok,
        "qty_nok": op.qty_nok,
        "actual_start": op.actual_start.isoformat() if op.actual_start else None,
        "actual_end": op.actual_end.isoformat() if op.actual_end else None,
    }


def _queue_for_machine(db: Session, machine_id: int) -> list[PlanningOperation]:
    return list(
        db.scalars(
            select(PlanningOperation)
            .where(PlanningOperation.machine_id == int(machine_id))
            .where(
                or_(
                    PlanningOperation.status.is_(None),
                    ~PlanningOperation.status.in_(["finished", "cancelled"]),
                )
            )
            .order_by(
                PlanningOperation.queue_position.asc().nulls_last(),
                PlanningOperation.planned_start.asc().nulls_last(),
                PlanningOperation.id.asc(),
            )
        ).all()
    )


# --- GET /kiosk/machine-queue ---------------------------------------------------
@router.get("/machine-queue")
def kiosk_machine_queue(
    machine_code: str | None = None,
    kiosk_code: str | None = None,
    db: Session = Depends(get_db),
):
    """Fronta operací pro stroj. Preferujte `machine_code` (MVP dual-screen)."""
    if machine_code:
        machine = _resolve_machine(db, machine_code)
        kiosk = _get_or_create_kiosk_for_machine(db, machine)
    elif kiosk_code:
        kiosk = db.scalar(select(Kiosk).where(Kiosk.kiosk_code == kiosk_code))
        if not kiosk:
            raise HTTPException(status_code=404, detail="Kiosk not found")
        machine = db.get(Machine, int(kiosk.machine_id))
        if not machine:
            raise HTTPException(status_code=404, detail="Machine not found")
    else:
        raise HTTPException(status_code=422, detail="Zadejte machine_code nebo kiosk_code.")

    session = db.scalar(
        select(KioskSession)
        .where(KioskSession.kiosk_id == kiosk.id)
        .where(KioskSession.is_active.is_(True))
    )
    ops = _queue_for_machine(db, int(machine.id))
    return {
        "kiosk_code": kiosk.kiosk_code,
        "machine": {"id": machine.id, "name": machine.name, "machine_code": machine.machine_code},
        "employee": (
            {"id": session.employee_id, "name": db.get(Employee, session.employee_id).name}
            if session
            else None
        ),
        "queue": [_serialize_op(op) for op in ops],
    }


# --- GET /kiosk/session (sdílený stav pro obě obrazovky) --------------------------
@router.get("/session")
def kiosk_session_state(machine_code: str, db: Session = Depends(get_db)):
    kiosk = _kiosk_from_machine_code(db, machine_code)
    machine = db.get(Machine, int(kiosk.machine_id))
    session = db.scalar(
        select(KioskSession)
        .where(KioskSession.kiosk_id == kiosk.id)
        .where(KioskSession.is_active.is_(True))
    )
    return {
        "kiosk_code": kiosk.kiosk_code,
        "machine": {"id": machine.id, "name": machine.name, "machine_code": machine.machine_code},
        "employee": (
            {"id": session.employee_id, "name": db.get(Employee, session.employee_id).name}
            if session
            else None
        ),
        "session_started_at": session.started_at.isoformat() if session else None,
    }


# --- POST /kiosk/login | /logout --------------------------------------------------
@router.post("/login")
def kiosk_login_machine(payload: MachineLoginRequest, db: Session = Depends(get_db)):
    kiosk = _kiosk_from_machine_code(db, payload.machine_code)
    code = payload.employee_code.strip()
    employee = db.scalar(
        select(Employee).where(
            or_(Employee.employee_code == code, Employee.card_uid == code),
            Employee.is_active.is_(True),
        )
    )
    if not employee:
        raise HTTPException(status_code=404, detail="Operátor nebyl nalezen.")

    for s in db.scalars(
        select(KioskSession).where(KioskSession.kiosk_id == kiosk.id).where(KioskSession.is_active.is_(True))
    ).all():
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
    db.refresh(session)
    machine = db.get(Machine, int(kiosk.machine_id))
    return {
        "status": "ok",
        "kiosk_code": kiosk.kiosk_code,
        "employee": {"id": employee.id, "name": employee.name, "employee_code": employee.employee_code},
        "machine": {"id": machine.id, "name": machine.name, "machine_code": machine.machine_code},
    }


@router.post("/logout")
def kiosk_logout_machine(payload: MachineLogoutRequest, db: Session = Depends(get_db)):
    kiosk = _kiosk_from_machine_code(db, payload.machine_code)
    for s in db.scalars(
        select(KioskSession).where(KioskSession.kiosk_id == kiosk.id).where(KioskSession.is_active.is_(True))
    ).all():
        s.is_active = False
        s.ended_at = datetime.utcnow()
    db.commit()
    return {"status": "ok"}


# --- GET /kiosk/resolve-scan (WOO / work order) -----------------------------------
@router.get("/resolve-scan")
def kiosk_resolve_scan(machine_code: str, code: str, db: Session = Depends(get_db)):
    machine = _resolve_machine(db, machine_code)
    raw = (code or "").strip()
    if not raw:
        raise HTTPException(status_code=422, detail="code je povinný.")

    candidates: list[str] = [raw]
    u = raw.upper().replace(" ", "")
    m = re.match(r"^WOO[-_]?(.*)$", u, re.IGNORECASE)
    if m and m.group(1):
        candidates.append(m.group(1))
        candidates.append(f"WOO-{m.group(1)}")
        candidates.append(f"WOO{m.group(1)}")

    op = None
    for c in candidates:
        op = db.scalar(
            select(PlanningOperation).where(
                PlanningOperation.work_order_no == c,
                PlanningOperation.machine_id == int(machine.id),
            )
        )
        if op:
            break

    if not op:
        raise HTTPException(status_code=404, detail="Operace (WOO) nebyla nalezena.")

    if int(op.machine_id) != int(machine.id):
        raise HTTPException(status_code=400, detail="Operace nepatří tomuto stroji.")

    return {"status": "ok", "operation": _serialize_op(op)}


# --- Operation control (machine_code) -------------------------------------------
def _run_start(kiosk: Kiosk, planning_operation_id: int, db: Session) -> dict:
    session = _get_active_session(db, kiosk.id)
    op = db.get(PlanningOperation, int(planning_operation_id))
    if not op:
        raise HTTPException(status_code=404, detail="Planning operation not found")
    if int(op.machine_id) != int(kiosk.machine_id):
        raise HTTPException(status_code=400, detail="Operation does not belong to this machine")

    db.add(
        OperationEvent(
            planning_operation_id=op.id,
            machine_id=kiosk.machine_id,
            employee_id=session.employee_id,
            event_type="start",
            event_time=datetime.utcnow(),
        )
    )
    op.status = "running"
    if op.actual_start is None:
        op.actual_start = datetime.utcnow()
    db.commit()
    db.refresh(op)
    return {"status": "ok", "planning_operation_id": op.id, "operation_status": op.status, "operation": _serialize_op(op)}


def _run_pause(kiosk: Kiosk, planning_operation_id: int, db: Session, reason: str | None, note: str | None) -> dict:
    session = _get_active_session(db, kiosk.id)
    op = db.get(PlanningOperation, int(planning_operation_id))
    if not op:
        raise HTTPException(status_code=404, detail="Planning operation not found")
    if int(op.machine_id) != int(kiosk.machine_id):
        raise HTTPException(status_code=400, detail="Operation does not belong to this machine")
    db.add(
        OperationEvent(
            planning_operation_id=op.id,
            machine_id=kiosk.machine_id,
            employee_id=session.employee_id,
            event_type="pause",
            event_time=datetime.utcnow(),
            reason=reason,
            note=note,
        )
    )
    op.status = "paused"
    db.commit()
    db.refresh(op)
    return {"status": "ok", "planning_operation_id": op.id, "operation_status": op.status}


def _run_resume(kiosk: Kiosk, planning_operation_id: int, db: Session) -> dict:
    session = _get_active_session(db, kiosk.id)
    op = db.get(PlanningOperation, int(planning_operation_id))
    if not op:
        raise HTTPException(status_code=404, detail="Planning operation not found")
    if int(op.machine_id) != int(kiosk.machine_id):
        raise HTTPException(status_code=400, detail="Operation does not belong to this machine")
    db.add(
        OperationEvent(
            planning_operation_id=op.id,
            machine_id=kiosk.machine_id,
            employee_id=session.employee_id,
            event_type="resume",
            event_time=datetime.utcnow(),
        )
    )
    op.status = "running"
    db.commit()
    db.refresh(op)
    return {"status": "ok", "planning_operation_id": op.id, "operation_status": op.status}


def _run_done(kiosk: Kiosk, planning_operation_id: int, qty_ok: int, qty_nok: int, note: str | None, db: Session) -> dict:
    session = _get_active_session(db, kiosk.id)
    op = db.get(PlanningOperation, int(planning_operation_id))
    if not op:
        raise HTTPException(status_code=404, detail="Planning operation not found")
    if int(op.machine_id) != int(kiosk.machine_id):
        raise HTTPException(status_code=400, detail="Operation does not belong to this machine")

    db.add(
        OperationEvent(
            planning_operation_id=op.id,
            machine_id=kiosk.machine_id,
            employee_id=session.employee_id,
            event_type="done",
            event_time=datetime.utcnow(),
            qty_ok=qty_ok,
            qty_nok=qty_nok,
            note=note,
        )
    )
    now = datetime.utcnow()
    op.status = "finished"
    if hasattr(op, "actual_end"):
        op.actual_end = now
    if hasattr(op, "qty_ok"):
        op.qty_ok = qty_ok
    if hasattr(op, "qty_nok"):
        op.qty_nok = qty_nok

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
    db.refresh(op)
    return {
        "status": "ok",
        "finished_operation_id": op.id,
        "qty_ok": qty_ok,
        "qty_nok": qty_nok,
        "next_operation_released": next_operation_released,
        "next_operation_id": next_op.id if next_op else None,
        "operation": _serialize_op(op),
    }


@router.post("/operation/start")
def kiosk_operation_start_machine(payload: MachineOperationIdRequest, db: Session = Depends(get_db)):
    kiosk = _kiosk_from_machine_code(db, payload.machine_code)
    return _run_start(kiosk, payload.planning_operation_id, db)


@router.post("/operation/pause")
def kiosk_operation_pause_machine(payload: MachinePauseRequest, db: Session = Depends(get_db)):
    kiosk = _kiosk_from_machine_code(db, payload.machine_code)
    return _run_pause(kiosk, payload.planning_operation_id, db, payload.reason, payload.note)


@router.post("/operation/resume")
def kiosk_operation_resume_machine(payload: MachineOperationIdRequest, db: Session = Depends(get_db)):
    kiosk = _kiosk_from_machine_code(db, payload.machine_code)
    return _run_resume(kiosk, payload.planning_operation_id, db)


@router.post("/operation/done")
def kiosk_operation_done_machine(payload: MachineDoneRequest, db: Session = Depends(get_db)):
    kiosk = _kiosk_from_machine_code(db, payload.machine_code)
    return _run_done(kiosk, payload.planning_operation_id, payload.qty_ok, payload.qty_nok, payload.note, db)


# --- Overhead / attendance --------------------------------------------------------
@router.post("/activity")
def kiosk_activity(payload: KioskActivityRequest, db: Session = Depends(get_db)):
    kiosk = _kiosk_from_machine_code(db, payload.machine_code)
    session = db.scalar(
        select(KioskSession)
        .where(KioskSession.kiosk_id == kiosk.id)
        .where(KioskSession.is_active.is_(True))
    )
    emp_id = int(session.employee_id) if session else None
    row = KioskActivityLog(
        machine_id=int(kiosk.machine_id),
        employee_id=emp_id,
        kiosk_session_id=int(session.id) if session else None,
        activity_type=payload.activity_type.strip(),
        note=payload.note,
        created_at=datetime.utcnow(),
    )
    db.add(row)
    db.commit()
    return {"status": "ok", "activity_type": row.activity_type}


# --- Legacy: login-card -----------------------------------------------------------
@router.post("/login-card")
def kiosk_login_card(payload: KioskLoginCardRequest, db: Session = Depends(get_db)):
    kiosk = db.scalar(select(Kiosk).where(Kiosk.kiosk_code == payload.kiosk_code).where(Kiosk.is_active.is_(True)))
    if not kiosk:
        raise HTTPException(status_code=404, detail="Kiosk not found")

    employee = db.scalar(select(Employee).where(Employee.card_uid == payload.card_uid).where(Employee.is_active.is_(True)))
    if not employee:
        raise HTTPException(status_code=404, detail="Employee card not found")

    for s in db.scalars(
        select(KioskSession).where(KioskSession.kiosk_id == kiosk.id).where(KioskSession.is_active.is_(True))
    ).all():
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


@router.post("/start-operation")
def kiosk_start_operation(payload: KioskStartOperationRequest, db: Session = Depends(get_db)):
    kiosk = db.scalar(select(Kiosk).where(Kiosk.kiosk_code == payload.kiosk_code))
    if not kiosk:
        raise HTTPException(status_code=404, detail="Kiosk not found")
    return _run_start(kiosk, payload.planning_operation_id, db)


@router.post("/pause-operation")
def kiosk_pause_operation(payload: KioskPauseOperationRequest, db: Session = Depends(get_db)):
    kiosk = db.scalar(select(Kiosk).where(Kiosk.kiosk_code == payload.kiosk_code))
    if not kiosk:
        raise HTTPException(status_code=404, detail="Kiosk not found")
    return _run_pause(kiosk, payload.planning_operation_id, db, payload.reason, payload.note)


@router.post("/finish-operation")
def kiosk_finish_operation(payload: KioskFinishOperationRequest, db: Session = Depends(get_db)):
    kiosk = db.scalar(select(Kiosk).where(Kiosk.kiosk_code == payload.kiosk_code))
    if not kiosk:
        raise HTTPException(status_code=404, detail="Kiosk not found")
    return _run_done(kiosk, payload.planning_operation_id, payload.qty_ok, payload.qty_nok, payload.note, db)
