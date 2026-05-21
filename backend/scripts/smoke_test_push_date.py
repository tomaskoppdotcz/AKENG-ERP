"""
One-off: push VP-000001 expedition/due dates +3 weeks, reset plan fields, global rebuild.

Run from backend:
    .venv/bin/python -m scripts.smoke_test_push_date
"""

from __future__ import annotations

import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from sqlalchemy import delete, select  # noqa: E402

from app.core.database import SessionLocal  # noqa: E402
from app.models.orders import JobItem, ProductionOrder  # noqa: E402
from app.models.portfolio import PortfolioItem  # noqa: F401,E402
from app.models.product_stock import ProductStockItem  # noqa: F401,E402
from app.models.supplier_purchase_order import (  # noqa: F401,E402
    SupplierPurchaseOrder,
    SupplierPurchaseOrderItem,
)
from app.models.master_data import Machine  # noqa: F401,E402
from app.models.planning import (  # noqa: E402
    MachineSchedule,
    PlanningOperation,
    PlanningScheduleSegment,
)
from app.services.planning_engine import (  # noqa: E402
    _chain_terminal_completed,
    PlanningEngineService,
)

VP_CODE = "VP-000001"
NEW_DATE = date(2026, 6, 5)


def main() -> None:
    db = SessionLocal()
    try:
        po = db.scalar(select(ProductionOrder).where(ProductionOrder.vp_code == VP_CODE))
        if po is None:
            raise RuntimeError(f"Production order {VP_CODE} not found")

        if po.job_item_id is not None:
            ji = db.get(JobItem, int(po.job_item_id))
            if ji is not None:
                ji.due_date = NEW_DATE
                print(f"job_item id={ji.id} due_date -> {NEW_DATE.isoformat()}")

        ops = db.scalars(
            select(PlanningOperation)
            .where(PlanningOperation.work_order_no == VP_CODE)
            .order_by(PlanningOperation.operation_no.asc())
        ).all()
        if len(ops) != 10:
            print(f"warning: expected 10 planning_operations, found {len(ops)}")

        op_ids = [int(o.id) for o in ops]
        new_date_str = NEW_DATE.isoformat()

        for op in ops:
            op.expedition_date = new_date_str
            op.is_locked = False
            op.planned_start = None
            op.planned_end = None
            op.queue_position = None
            op.latest_start = None
            op.planning_status = "unscheduled"
            op.blocking_reason = None
            if not _chain_terminal_completed(op.status):
                op.status = "ready"

        if op_ids:
            db.execute(
                delete(MachineSchedule).where(MachineSchedule.planning_operation_id.in_(op_ids))
            )
            db.execute(
                delete(PlanningScheduleSegment).where(
                    PlanningScheduleSegment.planning_operation_id.in_(op_ids)
                )
            )

        db.commit()
        print(f"updated {len(ops)} planning_operations expedition_date -> {new_date_str}")
        print("cleared schedules/segments for VP ops; unlocked ops 1–2")

        service = PlanningEngineService(db)
        created = service.rebuild_global_schedules(
            date.today(), trigger_reason="smoke_test_F4"
        )
        db.commit()
        print(f"rebuild_global_schedules created MachineSchedule rows: {len(created)}")
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
