"""Unified work reports (PC kiosk, shopfloor kiosk, manual corrections)."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class WorkReport(Base):
    __tablename__ = "work_reports"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    code: Mapped[str | None] = mapped_column(String(32), nullable=True, unique=True, index=True)
    """Public id (e.g. WR-000001); allocated at create and backfilled for legacy rows."""

    employee_id: Mapped[int | None] = mapped_column(ForeignKey("employees.id"), nullable=True, index=True)
    operator_display: Mapped[str | None] = mapped_column(String(255), nullable=True)

    customer_order_id: Mapped[int | None] = mapped_column(ForeignKey("customer_orders.id"), nullable=True, index=True)
    job_item_id: Mapped[int | None] = mapped_column(ForeignKey("job_items.id"), nullable=True, index=True)
    production_order_id: Mapped[int | None] = mapped_column(ForeignKey("production_orders.id"), nullable=True, index=True)
    planning_operation_id: Mapped[int] = mapped_column(
        ForeignKey("planning_operations.id"), nullable=False, index=True
    )
    machine_id: Mapped[int] = mapped_column(ForeignKey("machines.id"), nullable=False, index=True)
    workplace_library_item_id: Mapped[int | None] = mapped_column(
        ForeignKey("workplace_library_items.id"), nullable=True, index=True
    )

    operation_no: Mapped[int] = mapped_column(Integer, nullable=False)
    operation_name: Mapped[str] = mapped_column(String(200), nullable=False)

    started_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    duration_min: Mapped[float | None] = mapped_column(Float, nullable=True)

    qty_ok: Mapped[int | None] = mapped_column(Integer, nullable=True)
    qty_nok: Mapped[int | None] = mapped_column(Integer, nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)

    source: Mapped[str] = mapped_column(String(30), nullable=False, default="manual")
    """pc_kiosk | shopfloor_kiosk | manual"""

    kiosk_session_id: Mapped[int | None] = mapped_column(ForeignKey("kiosk_sessions.id"), nullable=True)

    created_by: Mapped[str | None] = mapped_column(String(120), nullable=True)
    updated_by: Mapped[str | None] = mapped_column(String(120), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class WorkReportCodeSequence(Base):
    __tablename__ = "work_report_code_seq"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    next_val: Mapped[int] = mapped_column(Integer, nullable=False)


class WorkReportPause(Base):
    __tablename__ = "work_report_pauses"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    work_report_id: Mapped[int] = mapped_column(
        ForeignKey("work_reports.id", ondelete="CASCADE"), nullable=False, index=True
    )
    pause_start: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    pause_end: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    pause_reason: Mapped[str] = mapped_column(String(80), nullable=False)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class WorkReportAuditLog(Base):
    __tablename__ = "work_report_audit_logs"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    work_report_id: Mapped[int | None] = mapped_column(
        ForeignKey("work_reports.id", ondelete="SET NULL"), nullable=True, index=True
    )
    action: Mapped[str] = mapped_column(String(40), nullable=False)
    details_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    actor: Mapped[str | None] = mapped_column(String(120), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
