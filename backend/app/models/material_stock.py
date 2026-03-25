"""Sklad materiálu — první vrstva modelů (bez API)."""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base

if TYPE_CHECKING:
    from app.models.material_library import MaterialLibraryItem


class MaterialStockItem(Base):
    __tablename__ = "material_stock_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    scan_code: Mapped[str | None] = mapped_column(String(32), nullable=True)
    material_library_item_id: Mapped[int] = mapped_column(
        ForeignKey("material_library_items.id"), index=True, nullable=False
    )
    location: Mapped[str | None] = mapped_column(String(200), nullable=True)
    current_qty: Mapped[float] = mapped_column(Float, default=0, nullable=False)
    min_qty: Mapped[float | None] = mapped_column(Float, nullable=True)
    unit: Mapped[str | None] = mapped_column(String(40), nullable=True)
    note: Mapped[str | None] = mapped_column(String(500), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    material_library_item: Mapped["MaterialLibraryItem"] = relationship("MaterialLibraryItem")
    movements: Mapped[list["MaterialStockMovement"]] = relationship(
        "MaterialStockMovement",
        back_populates="stock_item",
        cascade="all, delete-orphan",
        order_by="MaterialStockMovement.movement_date.desc(), MaterialStockMovement.id.desc()",
    )
    reservations: Mapped[list["MaterialStockReservation"]] = relationship(
        "MaterialStockReservation",
        back_populates="stock_item",
        cascade="all, delete-orphan",
        order_by="MaterialStockReservation.created_at.desc(), MaterialStockReservation.id.desc()",
    )


class MaterialStockMovement(Base):
    __tablename__ = "material_stock_movements"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    stock_item_id: Mapped[int] = mapped_column(
        ForeignKey("material_stock_items.id"), index=True, nullable=False
    )
    movement_type: Mapped[str] = mapped_column(String(40), nullable=False)
    qty: Mapped[float] = mapped_column(Float, nullable=False)
    movement_date: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    reference: Mapped[str | None] = mapped_column(String(200), nullable=True)
    note: Mapped[str | None] = mapped_column(String(500), nullable=True)

    stock_item: Mapped["MaterialStockItem"] = relationship("MaterialStockItem", back_populates="movements")


class MaterialStockReservation(Base):
    __tablename__ = "material_stock_reservations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    stock_item_id: Mapped[int] = mapped_column(ForeignKey("material_stock_items.id"), index=True, nullable=False)
    job_item_id: Mapped[int] = mapped_column(Integer, index=True, nullable=False)
    gpn: Mapped[str | None] = mapped_column(String(100), nullable=True)
    reserved_qty: Mapped[float] = mapped_column(Float, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    note: Mapped[str | None] = mapped_column(String(500), nullable=True)

    stock_item: Mapped["MaterialStockItem"] = relationship("MaterialStockItem", back_populates="reservations")
