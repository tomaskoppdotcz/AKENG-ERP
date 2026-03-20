"""Knihovna materiálů — čistý ERP standard."""

from sqlalchemy import Boolean, Float, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class MaterialLibraryItem(Base):
    __tablename__ = "material_library_items"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String(120), unique=True, index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    material_type: Mapped[str] = mapped_column(String(100), nullable=False)
    form: Mapped[str] = mapped_column(String(100), nullable=False)
    dimension: Mapped[str] = mapped_column(String(200), nullable=False)
    unit: Mapped[str] = mapped_column(String(40), nullable=False)
    density: Mapped[float | None] = mapped_column(Float, nullable=True)
    price_per_kg: Mapped[float | None] = mapped_column(Float, nullable=True)
    price_per_unit: Mapped[float | None] = mapped_column(Float, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
