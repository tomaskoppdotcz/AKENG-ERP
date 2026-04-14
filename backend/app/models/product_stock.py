"""Sklad výrobků — hotové výrobky (portfolio), odděleně od skladu materiálu."""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base

if TYPE_CHECKING:
    from app.models.orders import ProductionOrder
    from app.models.portfolio import PortfolioItem


class ProductStockItem(Base):
    __tablename__ = "product_stock_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    portfolio_item_id: Mapped[int] = mapped_column(ForeignKey("portfolio_items.id"), index=True, nullable=False)
    location: Mapped[str | None] = mapped_column(String(200), nullable=True)
    current_qty: Mapped[float] = mapped_column(Float, default=0, nullable=False)
    min_qty: Mapped[float | None] = mapped_column(Float, nullable=True)
    unit: Mapped[str | None] = mapped_column(String(40), nullable=True, default="ks")
    note: Mapped[str | None] = mapped_column(String(500), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    scan_code: Mapped[str | None] = mapped_column(String(32), nullable=True)

    portfolio_item: Mapped["PortfolioItem"] = relationship("PortfolioItem", back_populates="product_stock_items")
    movements: Mapped[list["ProductStockMovement"]] = relationship(
        "ProductStockMovement",
        back_populates="stock_item",
        cascade="all, delete-orphan",
        order_by="ProductStockMovement.movement_date.desc(), ProductStockMovement.id.desc()",
    )
    receipts: Mapped[list["ProductStockReceipt"]] = relationship(
        "ProductStockReceipt",
        back_populates="stock_item",
        cascade="all, delete-orphan",
        order_by="ProductStockReceipt.received_at.desc(), ProductStockReceipt.id.desc()",
    )


class ProductStockMovement(Base):
    __tablename__ = "product_stock_movements"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    stock_item_id: Mapped[int] = mapped_column(ForeignKey("product_stock_items.id"), index=True, nullable=False)
    movement_type: Mapped[str] = mapped_column(String(40), nullable=False)
    qty: Mapped[float] = mapped_column(Float, nullable=False)
    movement_date: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    reference: Mapped[str | None] = mapped_column(String(200), nullable=True)
    note: Mapped[str | None] = mapped_column(String(500), nullable=True)
    # Kiosk dokončení TP kroku Příjem/Výdej sklad — jeden pohyb na plánovací operaci (idempotence).
    planning_operation_id: Mapped[int | None] = mapped_column(
        ForeignKey("planning_operations.id"), index=True, nullable=True, unique=True
    )

    stock_item: Mapped["ProductStockItem"] = relationship("ProductStockItem", back_populates="movements")


class ProductStockReceipt(Base):
    __tablename__ = "product_stock_receipts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    product_stock_item_id: Mapped[int] = mapped_column(ForeignKey("product_stock_items.id"), index=True, nullable=False)
    production_order_id: Mapped[int | None] = mapped_column(ForeignKey("production_orders.id"), index=True, nullable=True)
    qty_received: Mapped[float] = mapped_column(Float, nullable=False)
    received_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)
    note: Mapped[str | None] = mapped_column(String(500), nullable=True)
    planning_operation_id: Mapped[int | None] = mapped_column(
        ForeignKey("planning_operations.id"), index=True, nullable=True, unique=True
    )

    stock_item: Mapped["ProductStockItem"] = relationship("ProductStockItem", back_populates="receipts")
    production_order: Mapped["ProductionOrder | None"] = relationship("ProductionOrder")
