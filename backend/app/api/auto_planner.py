from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import require_action
from app.core.database import get_db
from app.models.planning import PlanningOperation
from app.services.planning_engine import PlanningEngineService

router = APIRouter()


class AutoPlanWorkOrderRequest(BaseModel):
    work_order_no: str


@router.get("/work-orders")
def get_work_orders(db: Session = Depends(get_db)):
    rows = db.scalars(
        select(PlanningOperation.work_order_no).distinct()
    ).all()

    values = sorted([x for x in rows if x])
    return {"work_orders": values}


@router.post("/plan-work-order")
def auto_plan_work_order(
    payload: AutoPlanWorkOrderRequest,
    db: Session = Depends(get_db),
    _rbac: None = Depends(require_action("planning.write")),
):
    work_order_no = (payload.work_order_no or "").strip()
    if not work_order_no:
        raise HTTPException(status_code=400, detail="work_order_no je povinny.")

    ops = db.scalars(
        select(PlanningOperation)
        .where(PlanningOperation.work_order_no == work_order_no)
        .order_by(
            PlanningOperation.operation_no.asc(),
            PlanningOperation.id.asc(),
        )
    ).all()

    if not ops:
        raise HTTPException(status_code=404, detail="Pro zadany work_order_no nebyly nalezeny operace.")

    machine_ids = set()

    grouped_by_machine = {}
    for op in ops:
        grouped_by_machine.setdefault(op.machine_id, []).append(op)

    for machine_id, machine_ops in grouped_by_machine.items():
        machine_ids.add(machine_id)

        existing = db.scalars(
            select(PlanningOperation)
            .where(PlanningOperation.machine_id == machine_id)
            .where(PlanningOperation.work_order_no != work_order_no)
            .order_by(
                PlanningOperation.queue_position.asc().nulls_last(),
                PlanningOperation.operation_no.asc(),
                PlanningOperation.id.asc(),
            )
        ).all()

        max_queue = 0
        for item in existing:
            if item.queue_position and item.queue_position > max_queue:
                max_queue = item.queue_position

        next_queue = max_queue + 1
        ordered_machine_ops = sorted(machine_ops, key=lambda x: (x.operation_no or 9999, x.id))

        for op in ordered_machine_ops:
            op.queue_position = next_queue
            if not op.status or op.status in ["waiting_release", "ready", "planned", "naplanovano", "ceka"]:
                op.status = "planned"
            next_queue += 1

    db.commit()

    service = PlanningEngineService(db)
    rebuilt = []

    for machine_id in sorted(machine_ids):
        rows = service.rebuild_machine_schedule(machine_id, date.today())
        rebuilt.append({
            "machine_id": machine_id,
            "scheduled_rows": len(rows or []),
        })

    return {
        "status": "ok",
        "work_order_no": work_order_no,
        "operations_found": len(ops),
        "machines_rebuilt": rebuilt,
    }
