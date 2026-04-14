import logging
from datetime import date

from fastapi import APIRouter, Body, Depends, HTTPException

from app.api.deps import require_action
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import and_, func, inspect, or_, select, text
from sqlalchemy.orm import Session, selectinload

from app.core.database import engine, get_db
from app.models.master_data import Customer, Machine
from app.models.machine_shift_template import MachineShiftTemplate
from app.models.material_library import MaterialLibraryItem
from app.models.material_purchase import MaterialPurchaseOrder, MaterialPurchaseOrderLine
from app.models.material_stock import MaterialReservation, MaterialStockItem
from app.models.orders import CustomerOrder, Job, JobItem, ProductionOrder
from app.models.planning import MachineCalendar, MachineSchedule, PlanningOperation, PlanningScheduleSegment
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
from app.services.machine_calendar_generation import (
    apply_shift_templates_to_calendar_window,
    dedupe_shift_templates_for_workplace,
)
from app.services.planning_engine import PlanningEngineService
from app.services.workplace_scheduling_anchor import get_or_create_scheduling_machine_for_workplace

router = APIRouter()
logger = logging.getLogger(__name__)


def ensure_planning_shift_schema() -> None:
    """SQLite/Postgres: sloupec machine_calendar.shift_start_minutes + tabulka šablon přes metadata.create_all."""
    try:
        insp = inspect(engine)
        cols = {c["name"] for c in insp.get_columns("machine_calendar")}
        if "shift_start_minutes" not in cols:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE machine_calendar ADD COLUMN shift_start_minutes INTEGER"))
    except Exception as e:
        logger.warning("[planning] ensure_planning_shift_schema skipped: %s", e)
    _ensure_machine_shift_template_workplace_column()


def _ensure_machine_shift_template_workplace_column() -> None:
    try:
        insp = inspect(engine)
        if "machine_shift_templates" not in insp.get_table_names():
            return
        cols = {c["name"] for c in insp.get_columns("machine_shift_templates")}
        if "workplace_library_item_id" not in cols:
            with engine.begin() as conn:
                conn.execute(
                    text(
                        "ALTER TABLE machine_shift_templates "
                        "ADD COLUMN workplace_library_item_id INTEGER "
                        "REFERENCES workplace_library_items(id)"
                    )
                )
        with engine.begin() as conn:
            conn.execute(
                text(
                    "UPDATE machine_shift_templates SET workplace_library_item_id = "
                    "(SELECT m.workplace_library_item_id FROM machines m WHERE m.id = machine_shift_templates.machine_id) "
                    "WHERE workplace_library_item_id IS NULL AND EXISTS "
                    "(SELECT 1 FROM machines m WHERE m.id = machine_shift_templates.machine_id AND m.workplace_library_item_id IS NOT NULL)"
                )
            )
    except Exception as e:
        logger.warning("[planning] ensure workplace_library_item_id on shift templates skipped: %s", e)


def _anchor_machine_id_for_workplace(db: Session, workplace_library_item_id: int) -> int:
    m = get_or_create_scheduling_machine_for_workplace(db, int(workplace_library_item_id))
    if m is None:
        raise HTTPException(status_code=404, detail="Workplace not found")
    return int(m.id)


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


class MachineShiftTemplateUpsert(BaseModel):
    """Uložení šablony: buď workplace_library_item_id (doporučeno), nebo legacy machine_id."""

    machine_id: int | None = None
    workplace_library_item_id: int | None = None
    weekday: int = Field(..., ge=0, le=6)
    start_minutes: int = Field(..., ge=0, le=24 * 60)
    end_minutes: int = Field(..., ge=0, le=24 * 60)
    label: str | None = None
    is_active: bool = True

    @model_validator(mode="after")
    def _require_owner(self):
        if self.machine_id is None and self.workplace_library_item_id is None:
            raise ValueError("Provide machine_id or workplace_library_item_id")
        return self


class RegenerateCalendarFromShiftsRequest(BaseModel):
    from_date: str
    to_date: str
    machine_id: int | None = None
    workplace_library_item_id: int | None = None


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
    op_ids = [int(o.id) for o in ops]
    seg_by: dict[int, list] = {}
    if op_ids:
        seg_rows = db.scalars(
            select(PlanningScheduleSegment)
            .where(PlanningScheduleSegment.planning_operation_id.in_(op_ids))
            .order_by(PlanningScheduleSegment.planning_operation_id, PlanningScheduleSegment.segment_index)
        ).all()
        for s in seg_rows:
            seg_by.setdefault(int(s.planning_operation_id), []).append(s)

    out: list[dict] = []
    for op in ops:
        oid = int(op.id)
        segs = seg_by.get(oid, [])
        planned_schedule_segments = [
            {
                "segment_index": int(s.segment_index),
                "machine_id": int(s.machine_id),
                "segment_start": s.segment_start.isoformat() if s.segment_start else None,
                "segment_end": s.segment_end.isoformat() if s.segment_end else None,
                "duration_min": int(s.duration_min),
            }
            for s in segs
        ]
        out.append(
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
                "planned_schedule_segments": planned_schedule_segments,
            }
        )
    return out


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
            "shift_start_minutes": getattr(row, "shift_start_minutes", None),
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
def build_schedule(
    payload: BuildScheduleRequest,
    db: Session = Depends(get_db),
    _rbac: None = Depends(require_action("planning.write")),
):
    service = PlanningEngineService(db)
    service.rebuild_machine_schedule(payload.machine_id, date.fromisoformat(payload.from_date))
    return {"status": "ok", "machine_id": payload.machine_id}


@router.post("/rebuild-all")
def rebuild_all(
    db: Session = Depends(get_db),
    _rbac: None = Depends(require_action("planning.write")),
):
    service = PlanningEngineService(db)
    result = service.rebuild_all(date.today())
    return {
        "status": "ok",
        "machines": result,
    }


@router.get("/machine-shift-templates")
def list_machine_shift_templates(
    machine_id: int | None = None,
    workplace_library_item_id: int | None = None,
    db: Session = Depends(get_db),
):
    if workplace_library_item_id is not None:
        get_or_create_scheduling_machine_for_workplace(db, int(workplace_library_item_id))
        rows = dedupe_shift_templates_for_workplace(db, int(workplace_library_item_id), active_only=False)
        rows = sorted(rows, key=lambda r: int(r.weekday))
    else:
        q = select(MachineShiftTemplate).order_by(
            MachineShiftTemplate.machine_id.asc(),
            MachineShiftTemplate.weekday.asc(),
        )
        if machine_id is not None:
            q = q.where(MachineShiftTemplate.machine_id == int(machine_id))
        rows = db.scalars(q).all()
    return [
        {
            "id": int(r.id),
            "machine_id": int(r.machine_id),
            "workplace_library_item_id": getattr(r, "workplace_library_item_id", None),
            "weekday": int(r.weekday),
            "start_minutes": int(r.start_minutes),
            "end_minutes": int(r.end_minutes),
            "label": r.label,
            "is_active": bool(r.is_active),
        }
        for r in rows
    ]


@router.put("/machine-shift-templates")
def upsert_machine_shift_template(
    payload: MachineShiftTemplateUpsert,
    db: Session = Depends(get_db),
    _rbac: None = Depends(require_action("planning.write")),
):
    if int(payload.end_minutes) <= int(payload.start_minutes):
        raise HTTPException(status_code=400, detail="end_minutes must be greater than start_minutes")
    wid: int | None = None
    mid: int
    if payload.workplace_library_item_id is not None:
        wid = int(payload.workplace_library_item_id)
        mid = _anchor_machine_id_for_workplace(db, wid)
    elif payload.machine_id is not None:
        mid = int(payload.machine_id)
        m = db.get(Machine, mid)
        if m is None:
            raise HTTPException(status_code=404, detail="Machine not found")
        if m.workplace_library_item_id is not None:
            wid = int(m.workplace_library_item_id)
    else:
        raise HTTPException(status_code=400, detail="Provide machine_id or workplace_library_item_id")
    row = db.scalar(
        select(MachineShiftTemplate).where(
            MachineShiftTemplate.machine_id == mid,
            MachineShiftTemplate.weekday == int(payload.weekday),
        )
    )
    if row is None:
        row = MachineShiftTemplate(
            machine_id=mid,
            workplace_library_item_id=wid,
            weekday=int(payload.weekday),
            start_minutes=int(payload.start_minutes),
            end_minutes=int(payload.end_minutes),
            label=payload.label,
            is_active=bool(payload.is_active),
        )
        db.add(row)
    else:
        row.workplace_library_item_id = wid
        row.start_minutes = int(payload.start_minutes)
        row.end_minutes = int(payload.end_minutes)
        row.label = payload.label
        row.is_active = bool(payload.is_active)
    db.commit()
    db.refresh(row)
    return {"status": "ok", "id": int(row.id)}


@router.post("/machine-calendar/regenerate-from-shifts")
def regenerate_calendar_from_shifts(
    payload: RegenerateCalendarFromShiftsRequest,
    db: Session = Depends(get_db),
    _rbac: None = Depends(require_action("planning.write")),
):
    fd = date.fromisoformat(payload.from_date)
    td = date.fromisoformat(payload.to_date)
    if payload.workplace_library_item_id is not None:
        out = apply_shift_templates_to_calendar_window(
            db,
            from_date=fd,
            to_date=td,
            workplace_library_item_ids=[int(payload.workplace_library_item_id)],
        )
    elif payload.machine_id is not None:
        out = apply_shift_templates_to_calendar_window(
            db, from_date=fd, to_date=td, machine_ids=[int(payload.machine_id)]
        )
    else:
        out = apply_shift_templates_to_calendar_window(db, from_date=fd, to_date=td, machine_ids=None)
    db.commit()
    return {"status": "ok", **out}


@router.post("/move")
def move_operation(
    payload: MoveOperationRequest,
    db: Session = Depends(get_db),
    _rbac: None = Depends(require_action("planning.write")),
):
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
def move_gantt_operation(
    payload: MoveGanttOperationRequest,
    db: Session = Depends(get_db),
    _rbac: None = Depends(require_action("planning.write")),
):
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
    op.workplace_library_item_id = getattr(target_machine, "workplace_library_item_id", None)
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
def update_operation(
    payload: UpdatePlanningOperationRequest,
    db: Session = Depends(get_db),
    _rbac: None = Depends(require_action("planning.write")),
):
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
def build_demo_schedules(
    db: Session = Depends(get_db),
    _rbac: None = Depends(require_action("planning.write")),
):
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
    _rbac: None = Depends(require_action("planning.write")),
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
def cleanup_material_reservation_orphans(
    db: Session = Depends(get_db),
    _rbac: None = Depends(require_action("planning.write")),
):
    summary = cleanup_orphan_material_reservations(db)
    db.commit()
    return {"status": "ok", **summary}


@router.post("/material-reservations/rebuild-all")
def material_reservations_rebuild_all(
    db: Session = Depends(get_db),
    _rbac: None = Depends(require_action("planning.write")),
):
    tp_summary = rebuild_all_tp_material_reservations(db)
    consumption_summary = run_material_reservation_rebuild(db)
    db.commit()
    return {"status": "ok", **tp_summary, "consumption_rebuild": consumption_summary}


@router.post("/material-reservations/rebuild-for-job-item/{job_item_id}")
def material_reservations_rebuild_for_job_item_endpoint(
    job_item_id: int,
    db: Session = Depends(get_db),
    _rbac: None = Depends(require_action("planning.write")),
):
    tp_summary = rebuild_tp_material_reservations_for_job_item(db, job_item_id)
    consumption_summary = run_material_reservation_rebuild(db, job_item_id=job_item_id)
    db.commit()
    return {"status": "ok", **tp_summary, "consumption_rebuild": consumption_summary}


@router.post("/material-reservations/rebuild-for-template/{template_id}")
def material_reservations_rebuild_for_template_endpoint(
    template_id: int,
    db: Session = Depends(get_db),
    _rbac: None = Depends(require_action("planning.write")),
):
    tp_summary = rebuild_tp_material_reservations_for_technology_template(db, template_id)
    consumption_summary = run_material_reservation_rebuild(db)
    db.commit()
    return {"status": "ok", **tp_summary, "consumption_rebuild": consumption_summary}


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


MATERIAL_PURCHASE_ORDER_STATUSES = frozenset({"draft", "ordered", "confirmed", "received", "cancelled"})


def _material_purchase_order_number(po_id: int) -> str:
    return f"NMPO-{int(po_id):06d}"


def _dt_iso(dt) -> str:
    if dt is None:
        return ""
    s = dt.isoformat()
    if getattr(dt, "tzinfo", None) is None:
        return f"{s}Z"
    return s


@router.get("/material/purchase-orders")
def list_material_purchase_orders(db: Session = Depends(get_db)):
    pos = (
        db.scalars(
            select(MaterialPurchaseOrder)
            .options(selectinload(MaterialPurchaseOrder.lines))
            .order_by(MaterialPurchaseOrder.id.desc())
        )
        .unique()
        .all()
    )
    items = []
    for p in pos:
        lines = list(p.lines or [])
        items.append(
            {
                "id": int(p.id),
                "order_number": _material_purchase_order_number(p.id),
                "supplier_name": p.supplier_name_snapshot,
                "supplier_customer_id": int(p.supplier_customer_id),
                "created_at": _dt_iso(p.created_at),
                "status": p.status,
                "lines_count": len(lines),
                "total_qty_ordered": float(sum(float(x.qty_ordered or 0) for x in lines)),
            }
        )
    return {"items": items}


@router.get("/material/purchase-orders/{po_id}")
def get_material_purchase_order(po_id: int, db: Session = Depends(get_db)):
    po = db.scalar(
        select(MaterialPurchaseOrder)
        .options(selectinload(MaterialPurchaseOrder.lines))
        .where(MaterialPurchaseOrder.id == int(po_id))
    )
    if po is None:
        raise HTTPException(status_code=404, detail="Nákupní objednávka nebyla nalezena.")
    lines = sorted(po.lines or [], key=lambda x: int(x.id))
    mat_ids = {int(l.material_library_item_id) for l in lines}
    mats_by_id: dict[int, MaterialLibraryItem] = {}
    if mat_ids:
        mats = db.scalars(select(MaterialLibraryItem).where(MaterialLibraryItem.id.in_(mat_ids))).all()
        mats_by_id = {int(m.id): m for m in mats}
    out_lines = []
    for ln in lines:
        m = mats_by_id.get(int(ln.material_library_item_id))
        out_lines.append(
            {
                "id": int(ln.id),
                "material_library_item_id": int(ln.material_library_item_id),
                "qty_ordered": float(ln.qty_ordered),
                "unit": ln.unit or (m.unit if m else None),
                "traceability_note": ln.traceability_note,
                "material": {
                    "code": m.code if m else None,
                    "name": m.name if m else None,
                    "dimension": m.dimension if m else None,
                    "unit": m.unit if m else None,
                },
            }
        )
    return {
        "id": int(po.id),
        "order_number": _material_purchase_order_number(po.id),
        "supplier_customer_id": int(po.supplier_customer_id),
        "supplier_name": po.supplier_name_snapshot,
        "status": po.status,
        "created_at": _dt_iso(po.created_at),
        "header_note": po.header_note,
        "lines": out_lines,
    }


class MaterialPurchaseOrderPatchPayload(BaseModel):
    status: str


@router.patch("/material/purchase-orders/{po_id}")
def patch_material_purchase_order(
    po_id: int,
    body: MaterialPurchaseOrderPatchPayload,
    db: Session = Depends(get_db),
    _rbac: None = Depends(require_action("purchase.write")),
):
    st = (body.status or "").strip().lower()
    if st not in MATERIAL_PURCHASE_ORDER_STATUSES:
        raise HTTPException(
            status_code=422,
            detail=f"Neplatný stav. Povolené: {', '.join(sorted(MATERIAL_PURCHASE_ORDER_STATUSES))}.",
        )
    po = db.get(MaterialPurchaseOrder, int(po_id))
    if po is None:
        raise HTTPException(status_code=404, detail="Nákupní objednávka nebyla nalezena.")
    po.status = st
    db.commit()
    return {"status": "ok", "material_purchase_order_id": int(po.id)}


@router.post("/material/purchase-orders")
def create_material_purchase_order(
    body: MaterialPurchaseOrderPayload,
    db: Session = Depends(get_db),
    _rbac: None = Depends(require_action("purchase.write")),
):
    if not body.lines:
        raise HTTPException(status_code=422, detail="Alespoň jedna řádka objednávky.")
    cust = db.get(Customer, int(body.supplier_customer_id))
    if cust is None:
        raise HTTPException(status_code=404, detail="Dodavatel (zákazník v adresáři) nebyl nalezen.")
    po = MaterialPurchaseOrder(
        supplier_customer_id=int(cust.id),
        supplier_name_snapshot=(cust.name or "").strip() or cust.code,
        status="draft",
        header_note=(body.header_note.strip() if body.header_note else None) or None,
    )
    db.add(po)
    db.flush()
    for ln in body.lines:
        if ln.qty_ordered <= 0:
            raise HTTPException(status_code=422, detail="Množství musí být kladné.")
        lib = db.get(MaterialLibraryItem, int(ln.material_library_item_id))
        if lib is None:
            raise HTTPException(status_code=404, detail=f"Materiál ID {ln.material_library_item_id} neexistuje.")
        db.add(
            MaterialPurchaseOrderLine(
                purchase_order_id=int(po.id),
                material_library_item_id=int(ln.material_library_item_id),
                qty_ordered=float(ln.qty_ordered),
                unit=(lib.unit or "").strip() or None,
                traceability_note=(ln.traceability_note.strip() if ln.traceability_note else None) or None,
            )
        )
    db.commit()
    db.refresh(po)
    return {
        "status": "ok",
        "material_purchase_order_id": int(po.id),
        "order_number": _material_purchase_order_number(po.id),
        "lines_count": len(body.lines),
        "supplier_name": po.supplier_name_snapshot,
    }
