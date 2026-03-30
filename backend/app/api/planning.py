import logging
from datetime import date

from fastapi import APIRouter, Body, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.master_data import Customer, Machine
from app.models.material_library import MaterialLibraryItem
from app.models.material_purchase import MaterialPurchaseOrder, MaterialPurchaseOrderLine
from app.models.material_stock import MaterialReservation, MaterialStockItem
from app.models.orders import CustomerOrder, Job, JobItem, ProductionOrder
from app.models.planning import MachineCalendar, MachineSchedule, PlanningOperation
from app.services.material_reservation_cleanup import cleanup_orphan_material_reservations
from app.services.material_reservation_rebuild import run_material_reservation_rebuild
from app.services.business_workflow import workflow_active_sql
from app.services.material_reservation_sync import (
    MATERIAL_RESERVATION_ACTIVE_STATUSES,
    rebuild_all_tp_material_reservations,
    rebuild_tp_material_reservations_for_job_item,
    rebuild_tp_material_reservations_for_technology_template,
)
from app.services.material_requirements_query import (
    build_standard_material_requirements,
    build_vp_material_requirements,
)
from app.services.planning_engine import PlanningEngineService

router = APIRouter()
logger = logging.getLogger(__name__)


class MaterialReservationRebuildRequest(BaseModel):
    production_order_id: int | None = None
    job_item_id: int | None = None
    material_code: str | None = None


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


@router.post("/material-reservations/rebuild")
def rebuild_material_reservations(
    payload: MaterialReservationRebuildRequest | None = Body(None),
    db: Session = Depends(get_db),
):
    body = payload or MaterialReservationRebuildRequest()
    summary = run_material_reservation_rebuild(
        db,
        production_order_id=body.production_order_id,
        job_item_id=body.job_item_id,
        material_code=body.material_code,
    )
    db.commit()
    return {"status": "ok", **summary}


@router.post("/material-reservations/cleanup-orphans")
def cleanup_material_reservation_orphans(db: Session = Depends(get_db)):
    summary = cleanup_orphan_material_reservations(db)
    db.commit()
    return {"status": "ok", **summary}


@router.post("/material-reservations/rebuild-all")
def material_reservations_rebuild_all(db: Session = Depends(get_db)):
    summary = rebuild_all_tp_material_reservations(db)
    db.commit()
    return {"status": "ok", **summary}


@router.post("/material-reservations/rebuild-for-job-item/{job_item_id}")
def material_reservations_rebuild_for_job_item_endpoint(job_item_id: int, db: Session = Depends(get_db)):
    summary = rebuild_tp_material_reservations_for_job_item(db, job_item_id)
    db.commit()
    return {"status": "ok", **summary}


@router.post("/material-reservations/rebuild-for-template/{template_id}")
def material_reservations_rebuild_for_template_endpoint(template_id: int, db: Session = Depends(get_db)):
    summary = rebuild_tp_material_reservations_for_technology_template(db, template_id)
    db.commit()
    return {"status": "ok", **summary}


@router.get("/material/requirements")
def get_material_requirements(db: Session = Depends(get_db)):
    return build_standard_material_requirements(db)


@router.get("/material/requirements-by-vp")
def get_material_requirements_by_vp(db: Session = Depends(get_db)):
    return build_vp_material_requirements(db)


class MaterialPurchaseLinePayload(BaseModel):
    material_library_item_id: int
    qty_ordered: float
    traceability_note: str | None = None


class MaterialPurchaseOrderPayload(BaseModel):
    supplier_customer_id: int
    lines: list[MaterialPurchaseLinePayload]
    header_note: str | None = None


@router.post("/material/purchase-orders")
def create_material_purchase_order(body: MaterialPurchaseOrderPayload, db: Session = Depends(get_db)):
    if not body.lines:
        raise HTTPException(status_code=422, detail="Alespoň jedna řádka objednávky.")
    cust = db.get(Customer, int(body.supplier_customer_id))
    if cust is None:
        raise HTTPException(status_code=404, detail="Dodavatel (zákazník v adresáři) nebyl nalezen.")
    po = MaterialPurchaseOrder(
        supplier_customer_id=int(cust.id),
        supplier_name_snapshot=(cust.name or "").strip() or cust.code,
        status="confirmed",
        header_note=(body.header_note.strip() if body.header_note else None) or None,
    )
    db.add(po)
    db.flush()
    for ln in body.lines:
        if ln.qty_ordered <= 0:
            raise HTTPException(status_code=422, detail="Množství musí být kladné.")
        db.add(
            MaterialPurchaseOrderLine(
                purchase_order_id=int(po.id),
                material_library_item_id=int(ln.material_library_item_id),
                qty_ordered=float(ln.qty_ordered),
                unit=None,
                traceability_note=(ln.traceability_note.strip() if ln.traceability_note else None) or None,
            )
        )
    db.commit()
    db.refresh(po)
    return {
        "status": "ok",
        "material_purchase_order_id": int(po.id),
        "lines_count": len(body.lines),
        "supplier_name": po.supplier_name_snapshot,
    }
