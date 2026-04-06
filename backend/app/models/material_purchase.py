"""Nákupní objednávky materiálu (MVP) — odděleně od zákaznických zakázek."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class MaterialPurchaseOrder(Base):
    __tablename__ = "material_purchase_orders"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)
    supplier_customer_id: Mapped[int] = mapped_column(ForeignKey("customers.id"), nullable=False, index=True)
    supplier_name_snapshot: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[str] = mapped_column(String(40), nullable=False, default="draft")
    header_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    lines: Mapped[list["MaterialPurchaseOrderLine"]] = relationship(
        "MaterialPurchaseOrderLine",
        back_populates="purchase_order",
        cascade="all, delete-orphan",
        order_by="MaterialPurchaseOrderLine.id.asc()",
    )


class MaterialPurchaseOrderLine(Base):
    __tablename__ = "material_purchase_order_lines"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    purchase_order_id: Mapped[int] = mapped_column(
        ForeignKey("material_purchase_orders.id", ondelete="CASCADE"), nullable=False, index=True
    )
    material_library_item_id: Mapped[int] = mapped_column(
        ForeignKey("material_library_items.id"), nullable=False, index=True
    )
    qty_ordered: Mapped[float] = mapped_column(Float, nullable=False)
    unit: Mapped[str | None] = mapped_column(String(40), nullable=True)
    traceability_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    purchase_order: Mapped["MaterialPurchaseOrder"] = relationship("MaterialPurchaseOrder", back_populates="lines")
