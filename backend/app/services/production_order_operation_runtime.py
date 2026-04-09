"""Stav operací VP podle logů (sdíleno API detailu a přehledu položek zakázky)."""

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.orders import ProductionOrder, ProductionOrderOperation, ProductionOrderOperationLog
from app.models.portfolio import (
    PortfolioTechnologyTemplate,
    PortfolioTechnologyTemplateOperation,
)


def operation_statuses_for_production_order(
    db: Session, production_order_id: int, operation_nos: list[int]
) -> tuple[dict[int, dict], bool, bool]:
    logs = db.scalars(
        select(ProductionOrderOperationLog)
        .where(ProductionOrderOperationLog.production_order_id == int(production_order_id))
        .order_by(ProductionOrderOperationLog.created_at.asc(), ProductionOrderOperationLog.id.asc())
    ).all()
    by_op: dict[int, dict] = {
        int(no): {
            "operation_status": "planned",
            "started_at": None,
            "last_reported_at": None,
            "reported_ok_qty_total": 0,
            "reported_nok_qty_total": 0,
            "reported_minutes_total": 0,
        }
        for no in operation_nos
    }
    any_activity = False
    for log in logs:
        no = int(log.operation_no)
        if no not in by_op:
            continue
        entry = by_op[no]
        any_activity = True
        if log.event_type == "start":
            if entry["started_at"] is None:
                entry["started_at"] = log.created_at.isoformat() if log.created_at else None
            if entry["operation_status"] == "planned":
                entry["operation_status"] = "in_progress"
        elif log.event_type == "report":
            entry["reported_ok_qty_total"] += int(log.ok_qty or 0)
            entry["reported_nok_qty_total"] += int(log.nok_qty or 0)
            entry["reported_minutes_total"] += int(log.reported_minutes or 0)
            entry["last_reported_at"] = log.created_at.isoformat() if log.created_at else None
            entry["operation_status"] = "done"
    all_done = bool(by_op) and all(v["operation_status"] == "done" for v in by_op.values())
    return (by_op, any_activity, all_done)


def operation_nos_for_production_order(db: Session, po: ProductionOrder) -> list[int]:
    mapped_rows = db.scalars(
        select(ProductionOrderOperation)
        .where(ProductionOrderOperation.production_order_id == int(po.id))
        .order_by(ProductionOrderOperation.operation_no.asc(), ProductionOrderOperation.id.asc())
    ).all()
    if mapped_rows:
        return [int(r.operation_no) for r in mapped_rows]
    portfolio_item_id = int(po.portfolio_item_id) if po.portfolio_item_id is not None else None
    if portfolio_item_id is None:
        return []
    tpl = db.scalars(
        select(PortfolioTechnologyTemplate)
        .where(
            PortfolioTechnologyTemplate.portfolio_item_id == portfolio_item_id,
            PortfolioTechnologyTemplate.is_active.is_(True),
        )
        .order_by(PortfolioTechnologyTemplate.id.asc())
    ).first()
    if tpl is None:
        tpl = db.scalars(
            select(PortfolioTechnologyTemplate)
            .where(PortfolioTechnologyTemplate.portfolio_item_id == portfolio_item_id)
            .order_by(PortfolioTechnologyTemplate.id.asc())
        ).first()
    if tpl is None:
        return []
    op_rows = db.scalars(
        select(PortfolioTechnologyTemplateOperation)
        .where(PortfolioTechnologyTemplateOperation.template_id == int(tpl.id))
        .order_by(PortfolioTechnologyTemplateOperation.operation_no.asc())
    ).all()
    return [int(r.operation_no) for r in op_rows]
