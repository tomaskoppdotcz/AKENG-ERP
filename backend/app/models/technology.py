from typing import Optional
from sqlalchemy import Boolean, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from app.models.base import Base

class Routing(Base):
    __tablename__ = 'routings'
    id: Mapped[int] = mapped_column(primary_key=True)
    order_item_id: Mapped[int] = mapped_column(ForeignKey('order_items.id'))
    routing_code: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    revision: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    is_default: Mapped[bool] = mapped_column(Boolean, default=True)
    status: Mapped[str] = mapped_column(String(30), default='draft')

class RoutingOperation(Base):
    __tablename__ = 'routing_operations'
    __table_args__ = (UniqueConstraint('routing_id', 'operation_no', name='uq_routing_operation_no'),)
    id: Mapped[int] = mapped_column(primary_key=True)
    routing_id: Mapped[int] = mapped_column(ForeignKey('routings.id'))
    operation_no: Mapped[int] = mapped_column(Integer)
    operation_code: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    operation_name: Mapped[str] = mapped_column(String(100))
    assigned_machine_id: Mapped[int] = mapped_column(ForeignKey('machines.id'))
    setup_time_min: Mapped[int] = mapped_column(Integer, default=0)
    labor_time_per_piece_min: Mapped[float] = mapped_column(Numeric(10,2), default=0)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    is_outsource: Mapped[bool] = mapped_column(Boolean, default=False)
    note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
