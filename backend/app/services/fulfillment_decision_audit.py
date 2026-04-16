"""Zápis auditních záznamů fulfillment rozhodnutí (sklad / WIP / výroba)."""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any

from sqlalchemy.orm import Session

from app.models.fulfillment_decision_audit import FulfillmentDecisionAudit


def insert_fulfillment_decision_audit(
    db: Session,
    *,
    decision_phase: str,
    actor: str | None,
    customer_order_id: int,
    job_item_id: int,
    gpn: str | None,
    portfolio_item_id: int | None,
    decision_mode: str | None,
    recommended_strategy: str | None,
    chosen_strategy: str | None,
    requested_qty: int,
    finished_stock_qty_before: float | None,
    minimum_stock_target_qty: float | None,
    wip_restock_qty_before: int | None,
    stock_issue_qty: int | None,
    wip_reservation_qty: int | None,
    new_customer_production_qty: int | None,
    internal_restock_qty: int | None,
    stock_after_issue_qty: float | None,
    future_stock_after_wip_qty: float | None,
    source_restock_production_order_id: int | None,
    stock_allocation_production_order_id: int | None,
    customer_order_allocation_production_order_id: int | None,
    vyroba_zakaznik_production_order_id: int | None,
    internal_restock_production_order_id: int | None,
    restock_wip_reservation_id: int | None,
    details: dict[str, Any] | None = None,
    note: str | None = None,
) -> None:
    def _i(x: float | int | None) -> int | None:
        if x is None:
            return None
        return int(round(float(x)))

    row = FulfillmentDecisionAudit(
        created_at=datetime.now(),
        decision_phase=str(decision_phase)[:20],
        actor=(actor or None),
        customer_order_id=int(customer_order_id),
        job_item_id=int(job_item_id),
        gpn=(gpn or None),
        portfolio_item_id=int(portfolio_item_id) if portfolio_item_id is not None else None,
        decision_mode=(decision_mode or None),
        recommended_strategy=(recommended_strategy or None),
        chosen_strategy=(chosen_strategy or None),
        requested_qty=int(requested_qty or 0),
        finished_stock_qty_before=_i(finished_stock_qty_before),
        minimum_stock_target_qty=_i(minimum_stock_target_qty),
        wip_restock_qty_before=int(wip_restock_qty_before) if wip_restock_qty_before is not None else None,
        stock_issue_qty=int(stock_issue_qty) if stock_issue_qty is not None else None,
        wip_reservation_qty=int(wip_reservation_qty) if wip_reservation_qty is not None else None,
        new_customer_production_qty=int(new_customer_production_qty) if new_customer_production_qty is not None else None,
        internal_restock_qty=int(internal_restock_qty) if internal_restock_qty is not None else None,
        stock_after_issue_qty=_i(stock_after_issue_qty),
        future_stock_after_wip_qty=_i(future_stock_after_wip_qty),
        source_restock_production_order_id=int(source_restock_production_order_id)
        if source_restock_production_order_id is not None
        else None,
        stock_allocation_production_order_id=int(stock_allocation_production_order_id)
        if stock_allocation_production_order_id is not None
        else None,
        customer_order_allocation_production_order_id=int(customer_order_allocation_production_order_id)
        if customer_order_allocation_production_order_id is not None
        else None,
        vyroba_zakaznik_production_order_id=int(vyroba_zakaznik_production_order_id)
        if vyroba_zakaznik_production_order_id is not None
        else None,
        internal_restock_production_order_id=int(internal_restock_production_order_id)
        if internal_restock_production_order_id is not None
        else None,
        restock_wip_reservation_id=int(restock_wip_reservation_id) if restock_wip_reservation_id is not None else None,
        note=(note or None),
        details_json=(
            json.dumps(details, ensure_ascii=False, default=str) if details is not None else None
        ),
    )
    db.add(row)
