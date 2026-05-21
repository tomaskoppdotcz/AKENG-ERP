"""
F-reset: clean reset of VP-000001 planning operations.

Deletes machine_schedule, planning_schedule_segments, and planning_operations for
VP-000001, then regenerates via ensure_planning_operations_for_production_order
(same logic as POST /production-orders/{id}/regenerate-from-tp), then runs a
global rebuild.

Run from repo root:
    cd backend && .venv/bin/python -m scripts.reset_vp_000001
"""

from __future__ import annotations

import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from sqlalchemy import delete, select  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

from app.core.database import SessionLocal  # noqa: E402
from app.models.master_data import Machine  # noqa: F401,E402
from app.models.orders import JobItem, ProductionOrder  # noqa: E402
from app.models.portfolio import PortfolioItem  # noqa: F401,E402
from app.models.product_stock import ProductStockItem  # noqa: F401,E402
from app.models.supplier_purchase_order import (  # noqa: F401,E402
    SupplierPurchaseOrder,
    SupplierPurchaseOrderItem,
)
from app.models.planning import (  # noqa: E402
    MachineSchedule,
    PlanningOperation,
    PlanningScheduleSegment,
)
from app.services.vp_operation_generator import (  # noqa: E402
    ensure_planning_operations_for_production_order,
)
from app.services.planning_engine import PlanningEngineService  # noqa: E402

VP_CODE = "VP-000001"


def find_production_order(db: Session) -> ProductionOrder:
    row = db.scalar(select(ProductionOrder).where(ProductionOrder.vp_code == VP_CODE))
    if row is None:
        raise RuntimeError(f"Production order with vp_code={VP_CODE} not found")
    return row


def delete_existing_data(db: Session) -> dict[str, int]:
    """Delete machine_schedule, segments, and planning_operations for VP."""
    counts: dict[str, int] = {}

    res_ms = db.execute(
        delete(MachineSchedule).where(
            MachineSchedule.planning_operation_id.in_(
                select(PlanningOperation.id).where(PlanningOperation.work_order_no == VP_CODE)
            )
        )
    )
    counts["machine_schedule"] = res_ms.rowcount or 0

    res_seg = db.execute(
        delete(PlanningScheduleSegment).where(
            PlanningScheduleSegment.planning_operation_id.in_(
                select(PlanningOperation.id).where(PlanningOperation.work_order_no == VP_CODE)
            )
        )
    )
    counts["planning_schedule_segments"] = res_seg.rowcount or 0

    res_po = db.execute(
        delete(PlanningOperation).where(PlanningOperation.work_order_no == VP_CODE)
    )
    counts["planning_operations"] = res_po.rowcount or 0

    db.flush()
    return counts


def main() -> None:
    db = SessionLocal()
    try:
        po = find_production_order(db)
        print(f"=== Found ProductionOrder id={po.id} vp_code={po.vp_code} ===")

        print()
        print("=== STEP 1: delete existing data ===")
        deleted = delete_existing_data(db)
        for k, v in deleted.items():
            print(f"  deleted {v} {k} rows")

        print()
        print("=== STEP 2: regenerate planning_operations from portfolio TP ===")
        result = ensure_planning_operations_for_production_order(db, po)
        print(f"  ensure_planning_operations_for_production_order result: {result}")

        db.commit()

        print()
        print("=== STEP 3: global rebuild ===")
        service = PlanningEngineService(db)
        created = service.rebuild_global_schedules(
            date.today(), trigger_reason="reset_vp_000001"
        )
        print(f"  rebuild_global_schedules created {len(created)} MachineSchedule rows")

        db.commit()

        print()
        print("=== STEP 4: verify ===")
        ops = db.scalars(
            select(PlanningOperation)
            .where(PlanningOperation.work_order_no == VP_CODE)
            .order_by(PlanningOperation.operation_no)
        ).all()
        print(f"  planning_operations rows: {len(ops)}")
        print()
        print("  op# | op_name | machine_id | planned_start | planned_end | status | is_locked")
        for op in ops:
            mid = op.machine_id if op.machine_id is not None else "—"
            ps = op.planned_start.isoformat() if op.planned_start else "—"
            pe = op.planned_end.isoformat() if op.planned_end else "—"
            print(
                f"  {op.operation_no} | {op.operation_name} | "
                f"{mid} | {ps} | {pe} | "
                f"{op.status} | {bool(op.is_locked)}"
            )
        print()
        print("=== DONE: committed ===")
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
