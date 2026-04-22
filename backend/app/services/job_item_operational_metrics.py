"""Agregované provozní metriky položky zakázky přes všechna navázaná aktivní VP."""

from __future__ import annotations

from collections import defaultdict

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.kiosk import Employee
from app.models.orders import ProductionOrder
from app.models.planning import PlanningOperation
from app.models.work_report import WorkReport
from app.services.business_workflow import workflow_active_sql
from app.services.vp_operational_metrics import (
    OPERATIONAL_METRICS_EMPTY,
    aggregate_operational_metrics_for_po_subset,
    vp_operational_metrics_map,
)


def job_item_operational_metrics_map(
    db: Session,
    job_item_ids: list[int],
) -> dict[int, dict[str, int | float | str | None]]:
    """
    Součty a podíly přes aktivní production_orders s daným job_item_id.
    """
    if not job_item_ids:
        return {}
    unique_ids = sorted({int(x) for x in job_item_ids})

    pos = db.scalars(
        select(ProductionOrder).where(
            ProductionOrder.job_item_id.in_(unique_ids),
            workflow_active_sql(ProductionOrder.workflow_status),
        )
    ).all()

    by_ji: dict[int, list[ProductionOrder]] = defaultdict(list)
    for p in pos:
        if p.job_item_id is not None:
            by_ji[int(p.job_item_id)].append(p)

    vp_m = vp_operational_metrics_map(db, pos) if pos else {}
    wr_agg_by_ji: dict[int, tuple[int, int, int, float]] = {}
    if unique_ids:
        wr_rows = db.execute(
            select(
                ProductionOrder.job_item_id,
                func.coalesce(func.sum(func.coalesce(WorkReport.duration_min, 0.0)), 0.0),
                func.coalesce(func.sum(func.coalesce(WorkReport.qty_ok, 0)), 0),
                func.coalesce(func.sum(func.coalesce(WorkReport.qty_nok, 0)), 0),
                func.coalesce(
                    func.sum(
                        (func.coalesce(WorkReport.duration_min, 0.0) / 60.0)
                        * func.coalesce(Employee.cost_rate_per_hour, 0.0)
                    ),
                    0.0,
                ),
            )
            .select_from(WorkReport)
            .join(PlanningOperation, PlanningOperation.id == WorkReport.planning_operation_id)
            .join(
                ProductionOrder,
                func.lower(func.trim(ProductionOrder.vp_code))
                == func.lower(func.trim(PlanningOperation.work_order_no)),
            )
            .outerjoin(Employee, Employee.id == WorkReport.employee_id)
            .where(
                ProductionOrder.job_item_id.in_(unique_ids),
                workflow_active_sql(ProductionOrder.workflow_status),
            )
            .group_by(ProductionOrder.job_item_id)
        ).all()
        wr_agg_by_ji = {
            int(r[0]): (
                int(round(float(r[1] or 0.0))),
                int(r[2] or 0),
                int(r[3] or 0),
                float(r[4] or 0.0),
            )
            for r in wr_rows
            if r[0] is not None
        }

    out: dict[int, dict[str, int | float | str | None]] = {}
    for ji in unique_ids:
        lst = by_ji.get(ji, [])
        wr_duration_min, wr_ok_qty, wr_nok_qty, wr_labor_cost = wr_agg_by_ji.get(ji, (0, 0, 0, 0.0))
        if not lst:
            out[ji] = {
                **OPERATIONAL_METRICS_EMPTY,
                "total_duration_min": int(wr_duration_min),
                "total_ok_qty": int(wr_ok_qty),
                "total_nok_qty": int(wr_nok_qty),
                "labor_cost": round(float(wr_labor_cost), 2),
            }
            continue
        out[ji] = {
            **aggregate_operational_metrics_for_po_subset(vp_m, lst),
            "total_duration_min": int(wr_duration_min),
            "total_ok_qty": int(wr_ok_qty),
            "total_nok_qty": int(wr_nok_qty),
            "labor_cost": round(float(wr_labor_cost), 2),
        }
    return out
