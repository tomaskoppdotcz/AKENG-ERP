from datetime import datetime
from typing import Optional
from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column
from app.models.base import Base

class Customer(Base):
    __tablename__ = 'customers'
    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(255))
    ico: Mapped[str | None] = mapped_column(String(32), nullable=True)
    dic: Mapped[str | None] = mapped_column(String(32), nullable=True)
    billing_address: Mapped[str | None] = mapped_column(String(500), nullable=True)
    delivery_address: Mapped[str | None] = mapped_column(String(500), nullable=True)
    contact_person: Mapped[str | None] = mapped_column(String(255), nullable=True)
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(64), nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

class ProductGroup(Base):
    __tablename__ = 'product_groups'
    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(100))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

class Material(Base):
    __tablename__ = 'materials'
    id: Mapped[int] = mapped_column(primary_key=True)
    material_code: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(255))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

class Workcenter(Base):
    __tablename__ = 'workcenters'
    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(100))

class Machine(Base):
    __tablename__ = 'machines'
    id: Mapped[int] = mapped_column(primary_key=True)
    machine_code: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(100))
    machine_type: Mapped[str] = mapped_column(String(50))
    workcenter_id: Mapped[Optional[int]] = mapped_column(ForeignKey('workcenters.id'), nullable=True)
    planning_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    default_shift_minutes: Mapped[int] = mapped_column(Integer, default=450)
