import logging
from collections import defaultdict
from datetime import date

from fastapi import APIRouter, Body, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.master_data import Machine
from app.models.material_library import MaterialLibraryItem
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
    mr = MaterialReservation
    # One row per reservation id (defensive against join fan-out); then sum per material.
    # Exclude dangling customer orders when job references a deleted CO.
    base_sq = (
        select(
            mr.id.label("rid"),
            mr.material_library_item_id.label("mid"),
            mr.production_order_id.label("poid"),
            mr.job_item_id.label("jiid"),
            func.max(mr.required_qty).label("rq"),
            func.max(mr.reserved_qty).label("rs"),
        )
        .select_from(mr)
        .join(ProductionOrder, ProductionOrder.id == mr.production_order_id)
        .join(
            JobItem,
            and_(
                JobItem.id == mr.job_item_id,
                JobItem.id == ProductionOrder.job_item_id,
            ),
        )
        .join(Job, Job.id == JobItem.job_id)
        .join(MaterialLibraryItem, MaterialLibraryItem.id == mr.material_library_item_id)
        .outerjoin(CustomerOrder, CustomerOrder.id == Job.customer_order_id)
        .where(
            mr.status.in_(tuple(MATERIAL_RESERVATION_ACTIVE_STATUSES)),
            mr.is_active.is_(True),
            workflow_active_sql(ProductionOrder.workflow_status),
            workflow_active_sql(JobItem.workflow_status),
            or_(
                Job.customer_order_id.is_(None),
                and_(CustomerOrder.id.isnot(None), workflow_active_sql(CustomerOrder.workflow_status)),
            ),
        )
        .group_by(mr.id, mr.material_library_item_id, mr.production_order_id, mr.job_item_id)
    ).subquery()

    agg_rows = db.execute(
        select(
            base_sq.c.mid.label("material_library_item_id"),
            func.coalesce(func.sum(base_sq.c.rq), 0.0).label("required_qty"),
            func.coalesce(func.sum(base_sq.c.rs), 0.0).label("reserved_qty"),
        )
        .group_by(base_sq.c.mid)
        .order_by(base_sq.c.mid.asc())
    ).all()
    if not agg_rows:
        return []

    mat_ids = [int(r.material_library_item_id) for r in agg_rows]
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

    detail_rows_raw = db.execute(
        select(mr, ProductionOrder, JobItem, Job)
        .select_from(mr)
        .join(ProductionOrder, ProductionOrder.id == mr.production_order_id)
        .join(
            JobItem,
            and_(
                JobItem.id == mr.job_item_id,
                JobItem.id == ProductionOrder.job_item_id,
            ),
        )
        .join(Job, Job.id == JobItem.job_id)
        .join(MaterialLibraryItem, MaterialLibraryItem.id == mr.material_library_item_id)
        .outerjoin(CustomerOrder, CustomerOrder.id == Job.customer_order_id)
        .where(
            mr.material_library_item_id.in_(mat_ids),
            mr.status.in_(tuple(MATERIAL_RESERVATION_ACTIVE_STATUSES)),
            mr.is_active.is_(True),
            workflow_active_sql(ProductionOrder.workflow_status),
            workflow_active_sql(JobItem.workflow_status),
            or_(
                Job.customer_order_id.is_(None),
                and_(CustomerOrder.id.isnot(None), workflow_active_sql(CustomerOrder.workflow_status)),
            ),
        )
        .order_by(mr.material_library_item_id.asc(), ProductionOrder.id.asc(), mr.id.asc())
    ).all()

    seen_rid: set[int] = set()
    detail_rows: list = []
    for row in detail_rows_raw:
        rr = row[0]
        if int(rr.id) in seen_rid:
            continue
        seen_rid.add(int(rr.id))
        detail_rows.append(row)

    included_ids: set[int] = set()
    for dbg in db.execute(
        select(
            base_sq.c.rid,
            base_sq.c.mid,
            base_sq.c.poid,
            base_sq.c.jiid,
            base_sq.c.rq,
            MaterialLibraryItem.code,
        )
        .select_from(base_sq)
        .join(MaterialLibraryItem, MaterialLibraryItem.id == base_sq.c.mid)
    ).all():
        included_ids.add(int(dbg.rid))
        logger.info(
            "[material_requirements] included reservation_id=%s material_id=%s material_code=%s "
            "production_order_id=%s job_item_id=%s required_qty=%s",
            int(dbg.rid),
            int(dbg.mid),
            dbg.code,
            int(dbg.poid),
            int(dbg.jiid),
            float(dbg.rq or 0.0),
        )

    stale = db.scalars(
        select(mr).where(
            mr.is_active.is_(True),
            mr.status.in_(tuple(MATERIAL_RESERVATION_ACTIVE_STATUSES)),
        )
    ).all()
    for s in stale:
        if int(s.id) in included_ids:
            continue
        logger.info(
            "[material_requirements] excluded reservation_id=%s material_library_item_id=%s "
            "production_order_id=%s job_item_id=%s required_qty=%s (active but failed validity join)",
            int(s.id),
            int(s.material_library_item_id),
            int(s.production_order_id),
            int(s.job_item_id),
            float(s.required_qty or 0.0),
        )

    co_ids = sorted(
        {int(job.customer_order_id) for *_, job in detail_rows if job.customer_order_id is not None}
    )
    co_by_id: dict[int, CustomerOrder] = {}
    if co_ids:
        cos = db.scalars(select(CustomerOrder).where(CustomerOrder.id.in_(co_ids))).all()
        co_by_id = {int(o.id): o for o in cos}

    merged: dict[tuple[int, int], dict] = {}
    for rr, po, ji, job in detail_rows:
        mid = int(rr.material_library_item_id)
        pid = int(po.id)
        key = (mid, pid)
        co = co_by_id.get(int(job.customer_order_id)) if job.customer_order_id is not None else None
        if key not in merged:
            merged[key] = {
                "production_order_id": pid,
                "vp_code": po.vp_code,
                "job_item_id": int(po.job_item_id) if po.job_item_id is not None else None,
                "customer_order_id": int(co.id) if co is not None else None,
                "zakazka": job.zak_code,
                "gpn": ji.gpn if ji is not None else po.gpn,
                "_lines": [],
            }
        merged[key]["_lines"].append(
            {
                "reservation_id": int(rr.id),
                "required_qty": float(rr.required_qty or 0.0),
                "reserved_qty": float(rr.reserved_qty or 0.0),
                "status": rr.status,
            }
        )

    related_by_material: dict[int, list[dict]] = defaultdict(list)
    for (mid, _pid), payload in sorted(merged.items(), key=lambda kv: (kv[0][0], kv[1].get("vp_code") or "")):
        lines = sorted(payload["_lines"], key=lambda ln: int(ln["reservation_id"]))
        req_sum = sum(float(ln["required_qty"]) for ln in lines)
        res_sum = sum(float(ln["reserved_qty"]) for ln in lines)
        ids = [int(ln["reservation_id"]) for ln in lines]
        st = lines[0]["status"]
        row_out = {k: v for k, v in payload.items() if k != "_lines"}
        row_out["required_qty"] = req_sum
        row_out["reserved_qty"] = res_sum
        row_out["reservation_id"] = ids[0]
        row_out["reservation_ids"] = ids
        row_out["reservation_count"] = len(lines)
        row_out["reservation_lines"] = lines
        row_out["status"] = st
        related_by_material[mid].append(row_out)

    out: list[dict] = []
    for row in agg_rows:
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
