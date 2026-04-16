"""Auditní záznam rozhodnutí o plnění sklad_zakaznik (sklad / WIP / výroba / interní doplnění)."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text

from app.models.base import Base


class FulfillmentDecisionAudit(Base):
    __tablename__ = "fulfillment_decision_audit"

    id = Column(Integer, primary_key=True, autoincrement=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    decision_phase = Column(String(20), nullable=False)  # preview | committed
    actor = Column(String(255), nullable=True)

    customer_order_id = Column(Integer, ForeignKey("customer_orders.id"), nullable=False, index=True)
    job_item_id = Column(Integer, ForeignKey("job_items.id"), nullable=False, index=True)
    gpn = Column(String(120), nullable=True)
    portfolio_item_id = Column(Integer, nullable=True)

    decision_mode = Column(String(40), nullable=True)  # např. sklad_zakaznik
    recommended_strategy = Column(String(40), nullable=True)
    chosen_strategy = Column(String(40), nullable=True)

    requested_qty = Column(Integer, nullable=False)
    finished_stock_qty_before = Column(Integer, nullable=True)
    minimum_stock_target_qty = Column(Integer, nullable=True)
    wip_restock_qty_before = Column(Integer, nullable=True)

    stock_issue_qty = Column(Integer, nullable=True)
    wip_reservation_qty = Column(Integer, nullable=True)
    new_customer_production_qty = Column(Integer, nullable=True)
    internal_restock_qty = Column(Integer, nullable=True)

    stock_after_issue_qty = Column(Integer, nullable=True)
    future_stock_after_wip_qty = Column(Integer, nullable=True)

    source_restock_production_order_id = Column(Integer, ForeignKey("production_orders.id"), nullable=True)
    stock_allocation_production_order_id = Column(Integer, ForeignKey("production_orders.id"), nullable=True)
    customer_order_allocation_production_order_id = Column(Integer, ForeignKey("production_orders.id"), nullable=True)
    vyroba_zakaznik_production_order_id = Column(Integer, ForeignKey("production_orders.id"), nullable=True)
    internal_restock_production_order_id = Column(Integer, ForeignKey("production_orders.id"), nullable=True)
    restock_wip_reservation_id = Column(Integer, ForeignKey("restock_wip_reservations.id"), nullable=True)

    note = Column(String(500), nullable=True)
    details_json = Column(Text, nullable=True)
