from datetime import datetime

from sqlalchemy import Boolean, Column, Date, DateTime, Float, ForeignKey, Integer, String, Text
from app.models.base import Base


class PlanningOperation(Base):
    __tablename__ = "planning_operations"

    id = Column(Integer, primary_key=True)

    order_item_id = Column(Integer, nullable=True)
    product_group_id = Column(Integer, nullable=True)

    work_order_no = Column(String(50), nullable=True)

    gpn = Column(String(50), nullable=False)
    operation_name = Column(String(100), nullable=False)
    operation_no = Column(Integer, nullable=False)

    machine_id = Column(Integer, ForeignKey("machines.id"), nullable=True)
    workplace_library_item_id = Column(Integer, ForeignKey("workplace_library_items.id"), nullable=True)

    qty = Column(Integer, nullable=False, default=0)

    # denormalized planning attribute for grouping
    input_diameter_mm = Column(Float, nullable=True)

    setup_time_min = Column(Float, nullable=False, default=0)
    total_labor_time_min = Column(Float, nullable=False, default=0)
    total_operation_time_min = Column(Float, nullable=False, default=0)

    expedition_date = Column(String(20), nullable=True)

    planned_start = Column(DateTime, nullable=True)
    planned_end = Column(DateTime, nullable=True)

    actual_start = Column(DateTime, nullable=True)
    actual_end = Column(DateTime, nullable=True)

    qty_ok = Column(Integer, nullable=True)
    qty_nok = Column(Integer, nullable=True)

    released_at = Column(DateTime, nullable=True)
    latest_start = Column(DateTime, nullable=True)

    buffer_after_min = Column(Integer, nullable=True, default=20)

    queue_position = Column(Integer, nullable=True)

    material_ready = Column(Boolean, nullable=False, default=True)

    status = Column(String(20), nullable=False, default="planned")
    planning_status = Column(String(32), nullable=False, default="unscheduled")
    planning_mode = Column(String(20), nullable=True, default="auto")
    # is_locked is logically NOT NULL, but SQLite schema may contain NULL from legacy data - always coerce via bool()
    is_locked = Column(Boolean, nullable=False, default=False)
    priority = Column(Integer, nullable=False, default=50)
    material_code = Column(String(64), nullable=True)
    material_name = Column(String(255), nullable=True)
    part_group = Column(String(64), nullable=True)
    blocking_reason = Column(String(255), nullable=True)
    predecessor_op_id = Column(Integer, nullable=True)
    last_planned_at = Column(DateTime, nullable=True)

    is_cooperation = Column(Boolean, nullable=False, default=False)
    cooperation_status = Column(String(30), nullable=True)
    cooperation_category = Column(String(80), nullable=True)
    preferred_supplier_id = Column(Integer, ForeignKey("customers.id"), nullable=True)
    cooperation_supplier_purchase_order_id = Column(Integer, ForeignKey("supplier_purchase_orders.id"), nullable=True)
    cooperation_sent_at = Column(DateTime, nullable=True)
    cooperation_received_at = Column(DateTime, nullable=True)
    cooperation_note = Column(Text, nullable=True)


class MachineCalendar(Base):
    __tablename__ = "machine_calendar"

    id = Column(Integer, primary_key=True)
    machine_id = Column(Integer, ForeignKey("machines.id"), nullable=False)
    calendar_date = Column(Date, nullable=False)

    available_minutes = Column(Integer, nullable=False, default=0)
    # Začátek směny v minutách od půlnoci; NULL = výchozí 06:00 v plánovači (legacy).
    shift_start_minutes = Column(Integer, nullable=True)
    planned_minutes = Column(Integer, nullable=False, default=0)
    maintenance_minutes = Column(Integer, nullable=False, default=0)
    reserved_minutes = Column(Integer, nullable=False, default=0)

    is_working_day = Column(Boolean, nullable=False, default=True)
    is_machine_available = Column(Boolean, nullable=False, default=True)

    note = Column(Text, nullable=True)


class MachineSchedule(Base):
    __tablename__ = "machine_schedule"

    id = Column(Integer, primary_key=True)

    machine_id = Column(Integer, ForeignKey("machines.id"), nullable=False)
    planning_operation_id = Column(Integer, ForeignKey("planning_operations.id"), nullable=False, unique=True)

    queue_position = Column(Integer, nullable=False)

    planned_start = Column(DateTime, nullable=True)
    planned_end = Column(DateTime, nullable=True)

    setup_time_min = Column(Float, nullable=False, default=0)
    labor_time_total_min = Column(Float, nullable=False, default=0)
    total_time_min = Column(Float, nullable=False, default=0)

    status = Column(String(20), nullable=False, default="planned")


class PlanningScheduleSegment(Base):
    """
    Kalendářní segmenty jedné planning operace (např. zbytek směny + pokračování další den).
    machine_schedule zůstává jeden řádek na operaci (první/poslední čas); segmenty = pravda pro Gantt.
    """

    __tablename__ = "planning_schedule_segments"

    id = Column(Integer, primary_key=True, autoincrement=True)
    planning_operation_id = Column(Integer, ForeignKey("planning_operations.id"), nullable=False, index=True)
    machine_id = Column(Integer, ForeignKey("machines.id"), nullable=False, index=True)
    segment_index = Column(Integer, nullable=False)
    segment_start = Column(DateTime, nullable=False)
    segment_end = Column(DateTime, nullable=False)
    duration_min = Column(Integer, nullable=False)


class PlanningRun(Base):
    __tablename__ = "planning_runs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    triggered_by_user_id = Column(Integer, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    triggered_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    trigger_reason = Column(String(64), nullable=False)
    operations_affected = Column(Integer, nullable=True)
    operations_locked_skipped = Column(Integer, nullable=True)
    duration_ms = Column(Integer, nullable=True)
    status = Column(String(16), nullable=False, default="success")
    error_message = Column(String(2000), nullable=True)
    notes = Column(String(1000), nullable=True)


class OperationMachineAlternative(Base):
    __tablename__ = "operation_machine_alternatives"

    id = Column(Integer, primary_key=True, autoincrement=True)
    # Logical FK to portfolio_technology_template_operations.id (no physical constraint per project convention)
    tp_operation_id = Column(Integer, nullable=False)
    machine_id = Column(Integer, nullable=False)
    is_primary = Column(Boolean, nullable=False, default=False)
    setup_time_min = Column(Float, nullable=True)
    cycle_time_min = Column(Float, nullable=True)
    preference_order = Column(Integer, nullable=False, default=0)
    is_active = Column(Boolean, nullable=False, default=True)
    notes = Column(String(500), nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow)
