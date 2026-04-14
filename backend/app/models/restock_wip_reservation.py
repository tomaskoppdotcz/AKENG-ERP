"""Rezervace budoucího výstupu z běžícího doplnění skladu (restock WIP) pro řádek zákazníka."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import relationship

from app.models.base import Base


class RestockWipReservation(Base):
    """
    Vazba: zdrojový restock VP (sklad) → cílový řádek zakázky, množství budoucího příjmu na sklad.
    Nevydává zboží okamžitě — aktivuje následný sklad_zakaznik VP po příjmu na sklad.
    """

    __tablename__ = "restock_wip_reservations"

    id = Column(Integer, primary_key=True, autoincrement=True)
    source_production_order_id = Column(Integer, ForeignKey("production_orders.id"), nullable=False, index=True)
    target_job_item_id = Column(Integer, ForeignKey("job_items.id"), nullable=False, index=True)
    customer_order_id = Column(Integer, ForeignKey("customer_orders.id"), nullable=False, index=True)
    reserved_qty = Column(Integer, nullable=False)
    status = Column(String(20), nullable=False, default="pending")  # pending | fulfilled | cancelled
    fulfillment_customer_production_order_id = Column(Integer, ForeignKey("production_orders.id"), nullable=True)
    replenishment_production_order_id = Column(Integer, ForeignKey("production_orders.id"), nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    fulfilled_at = Column(DateTime, nullable=True)

    source_production_order = relationship("ProductionOrder", foreign_keys=[source_production_order_id])
    fulfillment_customer_production_order = relationship(
        "ProductionOrder", foreign_keys=[fulfillment_customer_production_order_id]
    )
    replenishment_production_order = relationship(
        "ProductionOrder", foreign_keys=[replenishment_production_order_id]
    )
