"""Agregované provozní metriky položky zakázky přes všechna navázaná aktivní VP."""

from __future__ import annotations

from collections import defaultdict

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.orders import ProductionOrder
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

    out: dict[int, dict[str, int | float | str | None]] = {}
    for ji in unique_ids:
        lst = by_ji.get(ji, [])
        if not lst:
            out[ji] = {**OPERATIONAL_METRICS_EMPTY}
            continue
        out[ji] = aggregate_operational_metrics_for_po_subset(vp_m, lst)
    return out
