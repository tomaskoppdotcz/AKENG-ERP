"""Dodavatelské nákupní objednávky vytvořené z RFQ nebo ručně."""

from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class SupplierPurchaseOrder(Base):
    __tablename__ = "supplier_purchase_orders"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    po_no: Mapped[str] = mapped_column(String(40), nullable=False, unique=True, index=True)
    supplier_id: Mapped[int | None] = mapped_column(ForeignKey("approved_suppliers.id"), nullable=True, index=True)
    supplier_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    status: Mapped[str] = mapped_column(String(40), nullable=False, default="draft", index=True)
    source_type: Mapped[str] = mapped_column(String(20), nullable=False, default="manual", index=True)
    rfq_id: Mapped[int | None] = mapped_column(ForeignKey("supplier_rfqs.id"), nullable=True, index=True)
    category: Mapped[str] = mapped_column(String(40), nullable=False, default="other", index=True)
    customer_order_id: Mapped[int | None] = mapped_column(ForeignKey("customer_orders.id"), nullable=True, index=True)
    job_item_id: Mapped[int | None] = mapped_column(ForeignKey("job_items.id"), nullable=True, index=True)
    production_order_id: Mapped[int | None] = mapped_column(ForeignKey("production_orders.id"), nullable=True, index=True)
    planning_operation_id: Mapped[int | None] = mapped_column(ForeignKey("planning_operations.id"), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)
    ordered_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    expected_delivery_date: Mapped[date | None] = mapped_column(Date, nullable=True, index=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_from_material_requirement: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, index=True)

    items: Mapped[list["SupplierPurchaseOrderItem"]] = relationship(
        "SupplierPurchaseOrderItem",
        back_populates="purchase_order",
        cascade="all, delete-orphan",
        order_by="SupplierPurchaseOrderItem.id.asc()",
    )


class SupplierPurchaseOrderItem(Base):
    __tablename__ = "supplier_purchase_order_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    purchase_order_id: Mapped[int] = mapped_column(
        ForeignKey("supplier_purchase_orders.id", ondelete="CASCADE"), nullable=False, index=True
    )
    rfq_item_id: Mapped[int | None] = mapped_column(ForeignKey("supplier_rfq_items.id"), nullable=True, index=True)
    material_library_item_id: Mapped[int | None] = mapped_column(ForeignKey("material_library_items.id"), nullable=True, index=True)
    item_name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    qty: Mapped[float] = mapped_column(Float, nullable=False)
    unit: Mapped[str] = mapped_column(String(40), nullable=False)
    unit_price: Mapped[float | None] = mapped_column(Float, nullable=True)
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="CZK")
    total_price: Mapped[float | None] = mapped_column(Float, nullable=True)
    received_qty: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    received_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    received_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)

    purchase_order: Mapped["SupplierPurchaseOrder"] = relationship("SupplierPurchaseOrder", back_populates="items")
