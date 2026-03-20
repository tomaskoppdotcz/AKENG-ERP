"""Clean master-data library models (operations, workplaces) — new ERP standard."""

from sqlalchemy import Boolean, Float, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class OperationLibraryItem(Base):
    __tablename__ = "operation_library_items"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    code: Mapped[str | None] = mapped_column(String(120), nullable=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    description: Mapped[str | None] = mapped_column(String(2000), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class WorkplaceLibraryItem(Base):
    __tablename__ = "workplace_library_items"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    code: Mapped[str | None] = mapped_column(String(120), nullable=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    workplace_type: Mapped[str | None] = mapped_column(String(100), nullable=True)
    hourly_rate: Mapped[float | None] = mapped_column(Float, nullable=True)
    daily_capacity_hours: Mapped[float | None] = mapped_column(Float, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
