from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.master_data import Machine
from app.models.material_library import MaterialLibraryItem
from app.models.material_stock import MaterialReservation, MaterialStockItem
from app.models.orders import CustomerOrder, Job, JobItem, ProductionOrder
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


class UpdatePlanningOperationRequest(BaseModel):
    planning_operation_id: int
    status: str | None = None
    material_ready: bool | None = None
    is_locked: bool | None = None


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
            "is_locked": op.is_locked,
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


@router.post("/update-operation")
def update_operation(payload: UpdatePlanningOperationRequest, db: Session = Depends(get_db)):
    op = db.get(PlanningOperation, payload.planning_operation_id)
    if not op:
        raise HTTPException(status_code=404, detail="Planning operation not found")

    if payload.status is not None:
        op.status = payload.status

    if payload.material_ready is not None:
        op.material_ready = payload.material_ready

    if payload.is_locked is not None:
        op.is_locked = payload.is_locked

    db.commit()

    service = PlanningEngineService(db)
    service.rebuild_machine_schedule(op.machine_id, date.today())
    db.commit()

    return {
        "status": "ok",
        "planning_operation_id": op.id,
        "operation": {
            "id": op.id,
            "work_order_no": op.work_order_no,
            "gpn": op.gpn,
            "operation_name": op.operation_name,
            "machine_id": op.machine_id,
            "queue_position": op.queue_position,
            "status": op.status,
            "material_ready": op.material_ready,
            "is_locked": op.is_locked,
            "planned_start": op.planned_start.isoformat() if op.planned_start else None,
            "planned_end": op.planned_end.isoformat() if op.planned_end else None,
        },
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


@router.get("/material/requirements")
def get_material_requirements(db: Session = Depends(get_db)):
    rows = db.execute(
        select(
            MaterialReservation.material_library_item_id,
            func.coalesce(func.sum(MaterialReservation.required_qty), 0.0).label("required_qty"),
            func.coalesce(func.sum(MaterialReservation.reserved_qty), 0.0).label("reserved_qty"),
        )
        .where(MaterialReservation.status.in_(["planned", "reserved"]))
        .group_by(MaterialReservation.material_library_item_id)
        .order_by(MaterialReservation.material_library_item_id.asc())
    ).all()
    if not rows:
        return []

    mat_ids = [int(r.material_library_item_id) for r in rows]
    mats = db.scalars(select(MaterialLibraryItem).where(MaterialLibraryItem.id.in_(mat_ids))).all()
    mat_by_id = {int(m.id): m for m in mats}

    stock_rows = db.execute(
        select(
            MaterialStockItem.material_library_item_id,
            func.coalesce(func.sum(MaterialStockItem.current_qty), 0.0),
        )
        .where(MaterialStockItem.material_library_item_id.in_(mat_ids))
        .group_by(MaterialStockItem.material_library_item_id)
    ).all()
    available_by_material = {int(mid): float(q or 0.0) for mid, q in stock_rows}

    reservation_rows = db.scalars(
        select(MaterialReservation).where(
            MaterialReservation.material_library_item_id.in_(mat_ids),
            MaterialReservation.status.in_(["planned", "reserved"]),
        )
    ).all()
    po_ids = sorted({int(r.production_order_id) for r in reservation_rows})
    pos = db.scalars(select(ProductionOrder).where(ProductionOrder.id.in_(po_ids))).all() if po_ids else []
    po_by_id = {int(po.id): po for po in pos}
    job_item_ids = sorted({int(po.job_item_id) for po in pos if po.job_item_id is not None})
    items = db.scalars(select(JobItem).where(JobItem.id.in_(job_item_ids))).all() if job_item_ids else []
    item_by_id = {int(it.id): it for it in items}
    job_ids = sorted({int(it.job_id) for it in items if it.job_id is not None})
    jobs = db.scalars(select(Job).where(Job.id.in_(job_ids))).all() if job_ids else []
    job_by_id = {int(j.id): j for j in jobs}
    co_ids = sorted({int(j.customer_order_id) for j in jobs if j.customer_order_id is not None})
    orders = db.scalars(select(CustomerOrder).where(CustomerOrder.id.in_(co_ids))).all() if co_ids else []
    co_by_id = {int(o.id): o for o in orders}

    related_by_material: dict[int, list[dict]] = {mid: [] for mid in mat_ids}
    for rr in reservation_rows:
        po = po_by_id.get(int(rr.production_order_id))
        if po is None:
            continue
        it = item_by_id.get(int(po.job_item_id)) if po.job_item_id is not None else None
        job = job_by_id.get(int(it.job_id)) if it is not None and it.job_id is not None else None
        co = co_by_id.get(int(job.customer_order_id)) if job is not None and job.customer_order_id is not None else None
        related_by_material[int(rr.material_library_item_id)].append(
            {
                "production_order_id": int(po.id),
                "vp_code": po.vp_code,
                "job_item_id": int(po.job_item_id) if po.job_item_id is not None else None,
                "customer_order_id": int(co.id) if co is not None else None,
                "zakazka": job.zak_code if job is not None else None,
                "gpn": it.gpn if it is not None else po.gpn,
                "required_qty": float(rr.required_qty or 0.0),
                "reserved_qty": float(rr.reserved_qty or 0.0),
                "status": rr.status,
            }
        )

    out: list[dict] = []
    for row in rows:
        material_id = int(row.material_library_item_id)
        required = float(row.required_qty or 0.0)
        available = float(available_by_material.get(material_id, 0.0))
        out.append(
            {
                "material_library_item_id": material_id,
                "material": {
                    "code": mat_by_id[material_id].code if material_id in mat_by_id else None,
                    "name": mat_by_id[material_id].name if material_id in mat_by_id else None,
                },
                "required": required,
                "available": available,
                "shortage": max(required - available, 0.0),
                "related_orders": related_by_material.get(material_id, []),
            }
        )
    return out
