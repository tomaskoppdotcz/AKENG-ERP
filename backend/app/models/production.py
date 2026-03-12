from datetime import datetime
from typing import Optional
from sqlalchemy import DateTime, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column
from app.models.base import Base

class OperationLog(Base):
    __tablename__ = 'operation_logs'
    id: Mapped[int] = mapped_column(primary_key=True)
    planning_operation_id: Mapped[int] = mapped_column(ForeignKey('planning_operations.id'))
    machine_id: Mapped[int] = mapped_column(ForeignKey('machines.id'))
    employee_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    started_at: Mapped[datetime] = mapped_column(DateTime)
    ended_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    duration_min: Mapped[Optional[float]] = mapped_column(Numeric(12,2), nullable=True)
    qty_good: Mapped[int] = mapped_column(Integer, default=0)
    qty_scrap: Mapped[int] = mapped_column(Integer, default=0)
    pause_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
