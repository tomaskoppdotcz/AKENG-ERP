from datetime import date, datetime
from typing import Optional

from sqlalchemy import Boolean, Date, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class Employee(Base):
    __tablename__ = "employees"

    id: Mapped[int] = mapped_column(primary_key=True)
    employee_code: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    """Zobrazované celé jméno (stejné jako full_name v API)."""
    name: Mapped[str] = mapped_column(String(255))
    first_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    last_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    # Legacy kiosk chip; prefer chip_card_uid. Multiple NULL allowed for unique in SQLite.
    card_uid: Mapped[str | None] = mapped_column(String(100), unique=True, index=True, nullable=True)
    chip_card_uid: Mapped[str | None] = mapped_column(String(100), unique=True, index=True, nullable=True)
    pin_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    scan_code: Mapped[str | None] = mapped_column(String(64), unique=True, index=True, nullable=True)

    phone: Mapped[str | None] = mapped_column(String(40), nullable=True)
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    street: Mapped[str | None] = mapped_column(String(255), nullable=True)
    city: Mapped[str | None] = mapped_column(String(120), nullable=True)
    postal_code: Mapped[str | None] = mapped_column(String(20), nullable=True)
    country: Mapped[str | None] = mapped_column(String(80), nullable=True)
    birth_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    job_title: Mapped[str | None] = mapped_column(String(120), nullable=True)

    employee_subgroup_id: Mapped[int | None] = mapped_column(
        ForeignKey("employee_subgroups.id"),
        nullable=True,
        index=True,
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    can_use_kiosk: Mapped[bool] = mapped_column(Boolean, default=True)
    hourly_cost_rate: Mapped[float | None] = mapped_column(Float, nullable=True)
    cost_rate_per_hour: Mapped[float | None] = mapped_column(Float, nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class Kiosk(Base):
    __tablename__ = "kiosks"

    id: Mapped[int] = mapped_column(primary_key=True)
    kiosk_code: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(255))
    machine_id: Mapped[int] = mapped_column(ForeignKey("machines.id"))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class KioskSession(Base):
    __tablename__ = "kiosk_sessions"

    id: Mapped[int] = mapped_column(primary_key=True)
    kiosk_id: Mapped[int] = mapped_column(ForeignKey("kiosks.id"))
    machine_id: Mapped[int] = mapped_column(ForeignKey("machines.id"))
    employee_id: Mapped[int] = mapped_column(ForeignKey("employees.id"))
    started_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    ended_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class OperationEvent(Base):
    __tablename__ = "operation_events"

    id: Mapped[int] = mapped_column(primary_key=True)
    production_order_id: Mapped[int | None] = mapped_column(ForeignKey("production_orders.id"), nullable=True, index=True)
    planning_operation_id: Mapped[int] = mapped_column(ForeignKey("planning_operations.id"), nullable=False, index=True)
    event_type: Mapped[str] = mapped_column(String(30))
    timestamp: Mapped[datetime] = mapped_column("timestamp", DateTime, default=datetime.utcnow)
    reason: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    user_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)

    # Legacy/diagnostic fields still used by older work-report logging.
    machine_id: Mapped[int | None] = mapped_column(ForeignKey("machines.id"), nullable=True)
    employee_id: Mapped[int | None] = mapped_column(ForeignKey("employees.id"), nullable=True)
    event_time: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    qty_ok: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    qty_nok: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class KioskActivityLog(Base):
    """Overhead / attendance on kiosk (no planning operation). MVP."""

    __tablename__ = "kiosk_activity_logs"

    id: Mapped[int] = mapped_column(primary_key=True)
    machine_id: Mapped[int] = mapped_column(ForeignKey("machines.id"), index=True)
    employee_id: Mapped[int | None] = mapped_column(ForeignKey("employees.id"), nullable=True)
    kiosk_session_id: Mapped[int | None] = mapped_column(ForeignKey("kiosk_sessions.id"), nullable=True)
    activity_type: Mapped[str] = mapped_column(String(50))
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
