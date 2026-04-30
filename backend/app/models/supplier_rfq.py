"""Odchozí poptávky dodavatelům."""

from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class ApprovedSupplier(Base):
    __tablename__ = "approved_suppliers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    supplier_code: Mapped[str] = mapped_column(String(50), nullable=False, unique=True, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    category: Mapped[str | None] = mapped_column(String(80), nullable=True)
    is_approved: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, index=True)
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(64), nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)


class SupplierRfq(Base):
    __tablename__ = "supplier_rfqs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    rfq_no: Mapped[str] = mapped_column(String(40), nullable=False, unique=True, index=True)
    supplier_id: Mapped[int | None] = mapped_column(ForeignKey("approved_suppliers.id"), nullable=True, index=True)
    supplier_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    category: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(40), nullable=False, default="draft", index=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    customer_order_id: Mapped[int | None] = mapped_column(ForeignKey("customer_orders.id"), nullable=True, index=True)
    job_item_id: Mapped[int | None] = mapped_column(ForeignKey("job_items.id"), nullable=True, index=True)
    production_order_id: Mapped[int | None] = mapped_column(ForeignKey("production_orders.id"), nullable=True, index=True)
    planning_operation_id: Mapped[int | None] = mapped_column(ForeignKey("planning_operations.id"), nullable=True, index=True)
    production_order_operation_id: Mapped[int | None] = mapped_column(
        ForeignKey("production_order_operations.id"), nullable=True, index=True
    )
    requested_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)

    items: Mapped[list["SupplierRfqItem"]] = relationship(
        "SupplierRfqItem",
        back_populates="rfq",
        cascade="all, delete-orphan",
        order_by="SupplierRfqItem.id.asc()",
    )


class SupplierRfqItem(Base):
    __tablename__ = "supplier_rfq_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    rfq_id: Mapped[int] = mapped_column(ForeignKey("supplier_rfqs.id", ondelete="CASCADE"), nullable=False, index=True)
    item_name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    qty: Mapped[float] = mapped_column(Float, nullable=False)
    unit: Mapped[str] = mapped_column(String(40), nullable=False)
    target_price: Mapped[float | None] = mapped_column(Float, nullable=True)
    offered_price: Mapped[float | None] = mapped_column(Float, nullable=True)
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="CZK")
    supplier_lead_time_days: Mapped[int | None] = mapped_column(Integer, nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)

    rfq: Mapped["SupplierRfq"] = relationship("SupplierRfq", back_populates="items")
