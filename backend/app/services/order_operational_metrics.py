"""Agregované provozní metriky zakázky přes aktivní položky a jejich aktivní VP."""

from __future__ import annotations

from collections import defaultdict

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.orders import CustomerOrder, Job, JobItem, ProductionOrder
from app.services.business_workflow import workflow_active_sql, workflow_record_active
from app.services.vp_operational_metrics import (
    OPERATIONAL_METRICS_EMPTY,
    aggregate_operational_metrics_for_po_subset,
    vp_operational_metrics_map,
)


def order_operational_metrics_map(
    db: Session,
    customer_order_ids: list[int],
) -> dict[int, dict[str, int | float | str | None]]:
    """
    Součty přes aktivní customer_order → aktivní job_items → aktivní production_orders.
    Stornovaná / neaktivní zakázka nebo položka se nezapočítává.
    """
    if not customer_order_ids:
        return {}
    ids = sorted({int(x) for x in customer_order_ids})

    cos = db.scalars(select(CustomerOrder).where(CustomerOrder.id.in_(ids))).all()
    co_active = {int(c.id) for c in cos if workflow_record_active(c)}

    jobs = db.scalars(select(Job).where(Job.customer_order_id.in_(ids))).all()
    job_by_id = {int(j.id): j for j in jobs}
    job_ids = [int(j.id) for j in jobs]

    items = db.scalars(select(JobItem).where(JobItem.job_id.in_(job_ids))).all() if job_ids else []

    active_item_ids: list[int] = []
    item_to_co: dict[int, int] = {}
    for it in items:
        if not workflow_record_active(it):
            continue
        job = job_by_id.get(int(it.job_id))
        if job is None or job.customer_order_id is None:
            continue
        coid = int(job.customer_order_id)
        if coid not in co_active:
            continue
        jid = int(it.id)
        active_item_ids.append(jid)
        item_to_co[jid] = coid

    pos = (
        db.scalars(
            select(ProductionOrder).where(
                ProductionOrder.job_item_id.in_(active_item_ids),
                workflow_active_sql(ProductionOrder.workflow_status),
            )
        ).all()
        if active_item_ids
        else []
    )

    po_by_co: dict[int, list[ProductionOrder]] = defaultdict(list)
    for p in pos:
        if p.job_item_id is None:
            continue
        ji = int(p.job_item_id)
        coid = item_to_co.get(ji)
        if coid is None:
            continue
        po_by_co[coid].append(p)

    vp_m = vp_operational_metrics_map(db, pos) if pos else {}

    out: dict[int, dict[str, int | float | str | None]] = {}
    for coid in ids:
        if coid not in co_active:
            out[coid] = {**OPERATIONAL_METRICS_EMPTY}
            continue
        sub = po_by_co.get(coid, [])
        out[coid] = aggregate_operational_metrics_for_po_subset(vp_m, sub)
    return out
