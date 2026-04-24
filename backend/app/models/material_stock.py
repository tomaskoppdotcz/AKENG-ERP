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
    receipt_units: Mapped[list["MaterialReceiptUnit"]] = relationship(
        "MaterialReceiptUnit",
        back_populates="stock_item",
        order_by="MaterialReceiptUnit.received_at.asc(), MaterialReceiptUnit.id.asc()",
    )
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


class MaterialReceiptUnit(Base):
    """Jednotlivý příjem / šarže / ingot — stopy pro FIFO a pozdější odpisy zbytků."""

    __tablename__ = "material_receipt_units"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    stock_item_id: Mapped[int] = mapped_column(
        ForeignKey("material_stock_items.id", ondelete="CASCADE"), index=True, nullable=False
    )
    received_qty: Mapped[float] = mapped_column(Float, nullable=False)
    remaining_qty: Mapped[float] = mapped_column(Float, nullable=False)
    uom: Mapped[str | None] = mapped_column(String(40), nullable=True)
    heat_lot: Mapped[str | None] = mapped_column(String(120), nullable=True)
    certificate_no: Mapped[str | None] = mapped_column(String(120), nullable=True)
    delivery_note_no: Mapped[str | None] = mapped_column(String(120), nullable=True)
    invoice_no: Mapped[str | None] = mapped_column(String(120), nullable=True)
    supplier_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    received_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    # active | consumed | written_off
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active", index=True)

    stock_item: Mapped["MaterialStockItem"] = relationship("MaterialStockItem", back_populates="receipt_units")
    movements: Mapped[list["MaterialStockMovement"]] = relationship(
        "MaterialStockMovement", back_populates="receipt_unit"
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
    scan_code: Mapped[str | None] = mapped_column(String(32), nullable=True)
    reference: Mapped[str | None] = mapped_column(String(200), nullable=True)
    heat_lot: Mapped[str | None] = mapped_column(String(120), nullable=True)
    length_per_piece_mm: Mapped[float | None] = mapped_column(Float, nullable=True)
    weight_per_piece_kg: Mapped[float | None] = mapped_column(Float, nullable=True)
    production_order_id: Mapped[int | None] = mapped_column(Integer, index=True, nullable=True)
    job_item_id: Mapped[int | None] = mapped_column(Integer, index=True, nullable=True)
    note: Mapped[str | None] = mapped_column(String(500), nullable=True)
    supplier_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    delivery_note_no: Mapped[str | None] = mapped_column(String(120), nullable=True)
    certificate_no: Mapped[str | None] = mapped_column(String(120), nullable=True)
    receipt_unit_id: Mapped[int | None] = mapped_column(
        ForeignKey("material_receipt_units.id", ondelete="SET NULL"), index=True, nullable=True
    )

    stock_item: Mapped["MaterialStockItem"] = relationship("MaterialStockItem", back_populates="movements")
    receipt_unit: Mapped["MaterialReceiptUnit | None"] = relationship(
        "MaterialReceiptUnit", back_populates="movements"
    )
    attachments: Mapped[list["MaterialStockMovementAttachment"]] = relationship(
        "MaterialStockMovementAttachment",
        back_populates="movement",
        cascade="all, delete-orphan",
        order_by="MaterialStockMovementAttachment.id.asc()",
    )


class MaterialStockMovementAttachment(Base):
    __tablename__ = "material_stock_movement_attachments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    movement_id: Mapped[int] = mapped_column(
        ForeignKey("material_stock_movements.id", ondelete="CASCADE"), index=True, nullable=False
    )
    original_filename: Mapped[str] = mapped_column(String(260), nullable=False)
    stored_relpath: Mapped[str] = mapped_column(String(500), nullable=False)
    mime_type: Mapped[str] = mapped_column(String(120), nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)

    movement: Mapped["MaterialStockMovement"] = relationship("MaterialStockMovement", back_populates="attachments")


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


class MaterialReservation(Base):
    __tablename__ = "material_reservations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    material_library_item_id: Mapped[int] = mapped_column(
        ForeignKey("material_library_items.id"), index=True, nullable=False
    )
    job_item_id: Mapped[int] = mapped_column(Integer, index=True, nullable=False)
    production_order_id: Mapped[int] = mapped_column(Integer, index=True, nullable=False)
    required_qty: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    reserved_qty: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    # planned | reserved = active pipeline for requirements; issued = fulfilled; superseded | cancelled = terminal (excluded)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="planned")
    note: Mapped[str | None] = mapped_column(String(500), nullable=True)
    # False = excluded from requirements (orphan cleanup); preserves row for audit vs hard delete
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
