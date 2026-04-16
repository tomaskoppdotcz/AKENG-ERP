from __future__ import annotations

import re
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.kiosk import Employee, Kiosk, KioskActivityLog, KioskSession
from app.models.master_data import Machine
from app.models.planning import PlanningOperation
from app.services.kiosk_planner_queue import (
    list_planning_operations_for_kiosk_machine,
    operation_on_same_planner_row_as_machine,
)
from app.services.cz_card_reader_normalize import normalize_czech_keyboard_reader_numeric
from app.services.employee_credential import find_employee_by_credential
from app.services.employee_pin import constant_time_fail, verify_pin
from app.services.kiosk_work_report_service import (
    SOURCE_PC_KIOSK,
    work_report_complete,
    work_report_pause,
    work_report_resume,
    work_report_start,
)

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
    pause_reason: str | None = None
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
    employee_code: str = Field(
        ...,
        min_length=1,
        description="Kód zaměstnance, UID čipu, legacy card_uid nebo scan_code (stejné službě jako lookup).",
    )


class MachineLoginPinRequest(BaseModel):
    machine_code: str = Field(..., min_length=1)
    employee_hint: str = Field(
        ...,
        min_length=1,
        description="Token stejný jako u /kiosk/login (kód / čip / sken) — identifikuje zaměstnance před ověřením PIN.",
    )
    pin_code: str = Field(..., min_length=4, max_length=20)


class MachineLogoutRequest(BaseModel):
    machine_code: str = Field(..., min_length=1)


class MachineOperationIdRequest(BaseModel):
    machine_code: str = Field(..., min_length=1)
    planning_operation_id: int


class MachinePauseRequest(BaseModel):
    machine_code: str = Field(..., min_length=1)
    planning_operation_id: int
    pause_reason: str | None = None
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


SESSION_REQUIRED_DETAIL = (
    "Není přihlášen operátor. Přihlaste se na administrativní obrazovce kiosk (stejný stroj)."
)


def _get_active_session(db: Session, kiosk_id: int) -> KioskSession:
    session = db.scalar(
        select(KioskSession)
        .where(KioskSession.kiosk_id == kiosk_id)
        .where(KioskSession.is_active.is_(True))
    )
    if not session:
        raise HTTPException(status_code=403, detail=SESSION_REQUIRED_DETAIL)
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
        "material_ready": bool(op.material_ready),
        "qty_ok": op.qty_ok,
        "qty_nok": op.qty_nok,
        "actual_start": op.actual_start.isoformat() if op.actual_start else None,
        "actual_end": op.actual_end.isoformat() if op.actual_end else None,
    }


def _require_op_on_kiosk_planner_row(db: Session, kiosk: Kiosk, op: PlanningOperation) -> None:
    km = db.get(Machine, int(kiosk.machine_id))
    if not km or not operation_on_same_planner_row_as_machine(db, op, km):
        raise HTTPException(
            status_code=400,
            detail="Operace nepatří na stejný řádek Planneru jako tento kiosk (pracoviště / stroj).",
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
    ops = list_planning_operations_for_kiosk_machine(db, machine)
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
        "login_state": "active" if session else "none",
        "has_active_session": bool(session),
    }


# --- POST /kiosk/login | /logout --------------------------------------------------
def _kiosk_start_session(db: Session, kiosk: Kiosk, employee: Employee) -> KioskSession:
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
    return session


@router.post("/login")
def kiosk_login_machine(payload: MachineLoginRequest, db: Session = Depends(get_db)):
    kiosk = _kiosk_from_machine_code(db, payload.machine_code)
    employee = find_employee_by_credential(
        db, payload.employee_code, require_active=True, require_kiosk=True
    )
    if not employee:
        raise HTTPException(status_code=404, detail="Operátor nebyl nalezen.")

    session = _kiosk_start_session(db, kiosk, employee)
    machine = db.get(Machine, int(kiosk.machine_id))
    return {
        "status": "ok",
        "kiosk_code": kiosk.kiosk_code,
        "employee": {"id": employee.id, "name": employee.name, "employee_code": employee.employee_code},
        "machine": {"id": machine.id, "name": machine.name, "machine_code": machine.machine_code},
    }


@router.post("/login-pin")
def kiosk_login_with_pin(payload: MachineLoginPinRequest, db: Session = Depends(get_db)):
    kiosk = _kiosk_from_machine_code(db, payload.machine_code)
    employee = find_employee_by_credential(
        db, payload.employee_hint, require_active=True, require_kiosk=True
    )
    ok = employee is not None and verify_pin(payload.pin_code.strip(), employee.pin_hash)
    if not ok:
        constant_time_fail()
        raise HTTPException(status_code=404, detail="Neplatné přihlášení (PIN).")

    _kiosk_start_session(db, kiosk, employee)
    machine = db.get(Machine, int(kiosk.machine_id))
    return {
        "status": "ok",
        "kiosk_code": kiosk.kiosk_code,
        "employee": {"id": employee.id, "name": employee.name, "employee_code": employee.employee_code},
        "machine": {"id": machine.id, "name": machine.name, "machine_code": machine.machine_code},
    }


@router.get("/employee/resolve")
def kiosk_employee_resolve(machine_code: str, credential: str, db: Session = Depends(get_db)):
    """Ověří stroj a vrátí zaměstnance bez založení session (příprava UI)."""
    _kiosk_from_machine_code(db, machine_code)
    cred = (credential or "").strip()
    if not cred:
        raise HTTPException(status_code=422, detail="credential je povinný.")
    employee = find_employee_by_credential(db, cred, require_active=True, require_kiosk=True)
    if not employee:
        raise HTTPException(status_code=404, detail="Operátor nebyl nalezen.")
    return {
        "employee": {
            "id": employee.id,
            "name": employee.name,
            "employee_code": employee.employee_code,
            "has_pin": bool(employee.pin_hash),
        }
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
    raw = normalize_czech_keyboard_reader_numeric((code or "").strip())
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
        for row in db.scalars(select(PlanningOperation).where(PlanningOperation.work_order_no == c)).all():
            if operation_on_same_planner_row_as_machine(db, row, machine):
                op = row
                break
        if op:
            break

    if not op:
        raise HTTPException(status_code=404, detail="Operace (WOO) nebyla nalezena.")

    return {"status": "ok", "operation": _serialize_op(op)}


# --- Operation control (machine_code) -------------------------------------------
def _run_start(kiosk: Kiosk, planning_operation_id: int, db: Session) -> dict:
    session = _get_active_session(db, kiosk.id)
    machine = db.get(Machine, int(kiosk.machine_id))
    if not machine:
        raise HTTPException(status_code=404, detail="Stroj pro kiosk nenalezen.")
    op = db.get(PlanningOperation, int(planning_operation_id))
    if not op:
        raise HTTPException(status_code=404, detail="Planning operation not found")
    _require_op_on_kiosk_planner_row(db, kiosk, op)
    emp = db.get(Employee, int(session.employee_id))
    actor = f"employee:{session.employee_id}"
    r = work_report_start(
        db,
        op,
        machine=machine,
        employee_id=int(session.employee_id),
        operator_display=emp.name if emp else None,
        source=SOURCE_PC_KIOSK,
        actor=actor,
        kiosk_session_id=int(session.id),
    )
    db.refresh(op)
    return {**r, "planning_operation_id": op.id, "operation": _serialize_op(op)}


def _run_pause(
    kiosk: Kiosk,
    planning_operation_id: int,
    db: Session,
    pause_reason: str | None,
    reason: str | None,
    note: str | None,
) -> dict:
    session = _get_active_session(db, kiosk.id)
    emp = db.get(Employee, int(session.employee_id))
    machine = db.get(Machine, int(kiosk.machine_id))
    if not machine:
        raise HTTPException(status_code=404, detail="Stroj pro kiosk nenalezen.")
    op = db.get(PlanningOperation, int(planning_operation_id))
    if not op:
        raise HTTPException(status_code=404, detail="Planning operation not found")
    _require_op_on_kiosk_planner_row(db, kiosk, op)
    merged_reason = (pause_reason or reason or "").strip()
    r = work_report_pause(
        db,
        op,
        machine=machine,
        employee_id=int(session.employee_id),
        operator_display=emp.name if emp else None,
        pause_reason=merged_reason,
        note=note,
        source=SOURCE_PC_KIOSK,
        actor=f"employee:{session.employee_id}",
    )
    db.refresh(op)
    return {
        **r,
        "planning_operation_id": op.id,
        "pause_reason": merged_reason,
    }


def _run_resume(kiosk: Kiosk, planning_operation_id: int, db: Session) -> dict:
    session = _get_active_session(db, kiosk.id)
    emp = db.get(Employee, int(session.employee_id))
    machine = db.get(Machine, int(kiosk.machine_id))
    if not machine:
        raise HTTPException(status_code=404, detail="Stroj pro kiosk nenalezen.")
    op = db.get(PlanningOperation, int(planning_operation_id))
    if not op:
        raise HTTPException(status_code=404, detail="Planning operation not found")
    _require_op_on_kiosk_planner_row(db, kiosk, op)
    r = work_report_resume(
        db,
        op,
        machine=machine,
        employee_id=int(session.employee_id),
        operator_display=emp.name if emp else None,
        source=SOURCE_PC_KIOSK,
        actor=f"employee:{session.employee_id}",
    )
    db.refresh(op)
    return {**r, "planning_operation_id": op.id, "operation": _serialize_op(op)}


def _run_done(kiosk: Kiosk, planning_operation_id: int, qty_ok: int, qty_nok: int, note: str | None, db: Session) -> dict:
    session = _get_active_session(db, kiosk.id)
    emp = db.get(Employee, int(session.employee_id))
    machine = db.get(Machine, int(kiosk.machine_id))
    if not machine:
        raise HTTPException(status_code=404, detail="Stroj pro kiosk nenalezen.")
    op = db.get(PlanningOperation, int(planning_operation_id))
    if not op:
        raise HTTPException(status_code=404, detail="Planning operation not found")
    _require_op_on_kiosk_planner_row(db, kiosk, op)
    r = work_report_complete(
        db,
        op,
        machine=machine,
        employee_id=int(session.employee_id),
        operator_display=emp.name if emp else None,
        qty_ok=int(qty_ok or 0),
        qty_nok=int(qty_nok or 0),
        note=note,
        source=SOURCE_PC_KIOSK,
        actor=f"employee:{session.employee_id}",
    )
    db.refresh(op)
    out = {
        **r,
        "finished_operation_id": op.id,
        "operation": _serialize_op(op),
    }
    return out


@router.post("/operation/start")
def kiosk_operation_start_machine(payload: MachineOperationIdRequest, db: Session = Depends(get_db)):
    kiosk = _kiosk_from_machine_code(db, payload.machine_code)
    return _run_start(kiosk, payload.planning_operation_id, db)


@router.post("/operation/pause")
def kiosk_operation_pause_machine(payload: MachinePauseRequest, db: Session = Depends(get_db)):
    kiosk = _kiosk_from_machine_code(db, payload.machine_code)
    return _run_pause(
        kiosk,
        payload.planning_operation_id,
        db,
        payload.pause_reason,
        payload.reason,
        payload.note,
    )


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

    employee = find_employee_by_credential(
        db, payload.card_uid, require_active=True, require_kiosk=True
    )
    if not employee:
        raise HTTPException(status_code=404, detail="Employee card not found")

    _kiosk_start_session(db, kiosk, employee)

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
    return _run_pause(
        kiosk,
        payload.planning_operation_id,
        db,
        payload.pause_reason,
        payload.reason,
        payload.note,
    )


@router.post("/finish-operation")
def kiosk_finish_operation(payload: KioskFinishOperationRequest, db: Session = Depends(get_db)):
    kiosk = db.scalar(select(Kiosk).where(Kiosk.kiosk_code == payload.kiosk_code))
    if not kiosk:
        raise HTTPException(status_code=404, detail="Kiosk not found")
    return _run_done(kiosk, payload.planning_operation_id, payload.qty_ok, payload.qty_nok, payload.note, db)
