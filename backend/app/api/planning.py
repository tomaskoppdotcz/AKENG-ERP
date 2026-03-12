from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.master_data import Machine
from app.models.planning import MachineCalendar, MachineSchedule, PlanningOperation
from app.services.planning_engine import PlanningEngineService

router = APIRouter()


class BuildScheduleRequest(BaseModel):
    machine_id: int
    from_date: str


class MoveOperationRequest(BaseModel):
    machine_id: int
    planning_operation_id: int
    direction: str


class MoveGanttOperationRequest(BaseModel):
    planning_operation_id: int
    target_machine_id: int
    target_queue_position: int | None = None


def get_machine_ops(db: Session, machine_id: int):
    return db.scalars(
        select(PlanningOperation)
        .where(PlanningOperation.machine_id == machine_id)
        .order_by(
            PlanningOperation.queue_position.asc().nulls_last(),
            PlanningOperation.operation_no.asc(),
            PlanningOperation.id.asc(),
        )
    ).all()


def normalize_machine_queue(db: Session, machine_id: int):
    ops = get_machine_ops(db, machine_id)
    for idx, item in enumerate(ops, start=1):
        item.queue_position = idx
    db.flush()
    return ops


def reorder_ops_with_target(ops: list[PlanningOperation], target_op: PlanningOperation, target_queue_position: int | None):
    remaining = [x for x in ops if x.id != target_op.id]

    if target_queue_position is None:
        insert_index = len(remaining)
    else:
        insert_index = max(0, min(target_queue_position - 1, len(remaining)))

    remaining.insert(insert_index, target_op)

    for idx, item in enumerate(remaining, start=1):
        item.queue_position = idx

    return remaining


@router.get("/operations")
def get_planning_operations(machine_id: int, db: Session = Depends(get_db)):
    ops = get_machine_ops(db, machine_id)

    return [
        {
            "id": op.id,
            "order_item_id": op.order_item_id,
            "work_order_no": op.work_order_no,
            "gpn": op.gpn,
            "operation_name": op.operation_name,
            "operation_no": op.operation_no,
            "qty": op.qty,
            "input_diameter_mm": op.input_diameter_mm,
            "setup_time_min": op.setup_time_min,
            "total_labor_time_min": op.total_labor_time_min,
            "total_operation_time_min": op.total_operation_time_min,
            "expedition_date": op.expedition_date,
            "planned_start": op.planned_start.isoformat() if op.planned_start else None,
            "planned_end": op.planned_end.isoformat() if op.planned_end else None,
            "queue_position": op.queue_position,
            "status": op.status,
            "material_ready": op.material_ready,
        }
        for op in ops
    ]


@router.get("/machine-calendar")
def get_machine_calendar(machine_id: int, db: Session = Depends(get_db)):
    rows = db.scalars(
        select(MachineCalendar)
        .where(MachineCalendar.machine_id == machine_id)
        .order_by(MachineCalendar.calendar_date.asc())
    ).all()

    return [
        {
            "id": row.id,
            "machine_id": row.machine_id,
            "calendar_date": row.calendar_date.isoformat() if row.calendar_date else None,
            "available_minutes": row.available_minutes,
            "planned_minutes": row.planned_minutes,
            "maintenance_minutes": row.maintenance_minutes,
            "reserved_minutes": row.reserved_minutes,
            "is_working_day": row.is_working_day,
            "is_machine_available": row.is_machine_available,
        }
        for row in rows
    ]


@router.get("/machine-schedule")
def get_machine_schedule(machine_id: int, db: Session = Depends(get_db)):
    rows = db.scalars(
        select(MachineSchedule)
        .where(MachineSchedule.machine_id == machine_id)
        .order_by(MachineSchedule.queue_position.asc())
    ).all()

    return [
        {
            "id": row.id,
            "machine_id": row.machine_id,
            "planning_operation_id": row.planning_operation_id,
            "queue_position": row.queue_position,
            "planned_start": row.planned_start.isoformat() if row.planned_start else None,
            "planned_end": row.planned_end.isoformat() if row.planned_end else None,
            "setup_time_min": row.setup_time_min,
            "labor_time_total_min": row.labor_time_total_min,
            "total_time_min": row.total_time_min,
            "status": row.status,
        }
        for row in rows
    ]


@router.post("/build-schedule")
def build_schedule(payload: BuildScheduleRequest, db: Session = Depends(get_db)):
    service = PlanningEngineService(db)
    service.rebuild_machine_schedule(payload.machine_id, date.fromisoformat(payload.from_date))
    return {"status": "ok", "machine_id": payload.machine_id}


@router.post("/rebuild-all")
def rebuild_all(db: Session = Depends(get_db)):
    service = PlanningEngineService(db)
    result = service.rebuild_all(date.today())
    return {
        "status": "ok",
        "machines": result,
    }


@router.post("/move")
def move_operation(payload: MoveOperationRequest, db: Session = Depends(get_db)):
    ops = db.scalars(
        select(PlanningOperation)
        .where(PlanningOperation.machine_id == payload.machine_id)
        .where(PlanningOperation.queue_position.is_not(None))
        .order_by(PlanningOperation.queue_position.asc())
    ).all()

    target = next((o for o in ops if o.id == payload.planning_operation_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="Planning operation not found in machine queue")

    idx = ops.index(target)

    if payload.direction == "up" and idx > 0:
        other = ops[idx - 1]
        target.queue_position, other.queue_position = other.queue_position, target.queue_position
    elif payload.direction == "down" and idx < len(ops) - 1:
        other = ops[idx + 1]
        target.queue_position, other.queue_position = other.queue_position, target.queue_position

    db.commit()

    service = PlanningEngineService(db)
    service.rebuild_machine_schedule(payload.machine_id, date.today())

    return {"status": "ok", "planning_operation_id": payload.planning_operation_id}


@router.post("/move-gantt")
def move_gantt_operation(payload: MoveGanttOperationRequest, db: Session = Depends(get_db)):
    op = db.get(PlanningOperation, payload.planning_operation_id)
    if not op:
        raise HTTPException(status_code=404, detail="Planning operation not found")

    target_machine = db.get(Machine, payload.target_machine_id)
    if not target_machine:
        raise HTTPException(status_code=404, detail="Target machine not found")

    source_machine_id = op.machine_id
    target_machine_id = payload.target_machine_id
    target_queue_position = payload.target_queue_position

    if target_queue_position is not None and target_queue_position < 1:
        target_queue_position = 1

    service = PlanningEngineService(db)

    if source_machine_id == target_machine_id:
        current_ops = get_machine_ops(db, source_machine_id)
        reorder_ops_with_target(current_ops, op, target_queue_position)
        db.commit()

        service.rebuild_machine_schedule(source_machine_id, date.today())
        db.commit()

        return {
            "status": "ok",
            "planning_operation_id": op.id,
            "source_machine_id": source_machine_id,
            "target_machine_id": target_machine_id,
            "target_queue_position": target_queue_position,
            "moved": True,
            "reordered_same_machine": True,
        }

    op.machine_id = target_machine_id
    db.flush()

    normalize_machine_queue(db, source_machine_id)

    target_ops = get_machine_ops(db, target_machine_id)
    reorder_ops_with_target(target_ops, op, target_queue_position)

    db.commit()

    service.rebuild_machine_schedule(source_machine_id, date.today())
    service.rebuild_machine_schedule(target_machine_id, date.today())
    db.commit()

    return {
        "status": "ok",
        "planning_operation_id": op.id,
        "source_machine_id": source_machine_id,
        "target_machine_id": target_machine_id,
        "target_queue_position": target_queue_position,
        "moved": True,
        "reordered_same_machine": False,
    }


@router.post("/build-demo-schedules")
def build_demo_schedules(db: Session = Depends(get_db)):
    service = PlanningEngineService(db)
    machine_codes = ["PILA", "CTX_BETA_800", "CMX_600_V", "MEZIOPERACNI_KONTROLA", "VYSTUPNI_KONTROLA", "BALENI"]
    total = 0

    for code in machine_codes:
        machine = db.scalar(select(Machine).where(Machine.machine_code == code))
        if machine:
            rows = service.rebuild_machine_schedule(machine.id, date.today())
            total += len(rows or [])

    return {"status": "ok", "scheduled_rows": total, "machines": machine_codes}
