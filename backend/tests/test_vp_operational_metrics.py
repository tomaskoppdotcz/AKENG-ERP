from __future__ import annotations

from datetime import datetime

from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.main  # noqa: F401
from app.models.kiosk import OperationEvent
from app.models.master_data import Machine
from app.models.orders import ProductionOrder
from app.models.planning import PlanningOperation
from app.services.vp_operational_metrics import (
    operation_event_runtime_metrics_by_planning_id,
    vp_operational_metrics_single,
)


def _session_factory():
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                CREATE TABLE machines (
                    id INTEGER PRIMARY KEY,
                    machine_code VARCHAR(50),
                    name VARCHAR(100),
                    machine_type VARCHAR(50),
                    workcenter_id INTEGER,
                    workplace_library_item_id INTEGER,
                    planning_enabled BOOLEAN,
                    is_plannable BOOLEAN,
                    is_active BOOLEAN,
                    default_shift_minutes INTEGER,
                    hourly_rate FLOAT
                )
                """
            )
        )
        conn.execute(
            text(
                """
                CREATE TABLE production_orders (
                    id INTEGER PRIMARY KEY,
                    vp_code VARCHAR NOT NULL,
                    scan_code VARCHAR(32),
                    job_item_id INTEGER,
                    customer_order_id INTEGER,
                    job_id INTEGER,
                    portfolio_item_id INTEGER,
                    gpn VARCHAR,
                    description VARCHAR,
                    quantity INTEGER,
                    logistic_mode VARCHAR,
                    source_type VARCHAR,
                    status VARCHAR,
                    workflow_status VARCHAR(20),
                    is_material_covered BOOLEAN,
                    is_material_released_to_production BOOLEAN,
                    is_material_ready BOOLEAN,
                    restock_redirected_from_internal BOOLEAN,
                    blocked_until_reserved_stock_receipt BOOLEAN
                )
                """
            )
        )
        conn.execute(
            text(
                """
                CREATE TABLE planning_operations (
                    id INTEGER PRIMARY KEY,
                    order_item_id INTEGER,
                    product_group_id INTEGER,
                    work_order_no VARCHAR(50),
                    gpn VARCHAR(50) NOT NULL,
                    operation_name VARCHAR(100) NOT NULL,
                    operation_no INTEGER NOT NULL,
                    machine_id INTEGER NOT NULL,
                    workplace_library_item_id INTEGER,
                    qty INTEGER NOT NULL,
                    input_diameter_mm FLOAT,
                    setup_time_min FLOAT NOT NULL,
                    total_labor_time_min FLOAT NOT NULL,
                    total_operation_time_min FLOAT NOT NULL,
                    expedition_date VARCHAR(20),
                    planned_start DATETIME,
                    planned_end DATETIME,
                    actual_start DATETIME,
                    actual_end DATETIME,
                    qty_ok INTEGER,
                    qty_nok INTEGER,
                    released_at DATETIME,
                    latest_start DATETIME,
                    buffer_after_min INTEGER,
                    queue_position INTEGER,
                    material_ready BOOLEAN NOT NULL,
                    status VARCHAR(20) NOT NULL,
                    planning_mode VARCHAR(20),
                    is_locked BOOLEAN
                )
                """
            )
        )
        conn.execute(
            text(
                """
                CREATE TABLE operation_events (
                    id INTEGER PRIMARY KEY,
                    production_order_id INTEGER,
                    planning_operation_id INTEGER NOT NULL,
                    event_type VARCHAR(30),
                    timestamp DATETIME,
                    reason VARCHAR(100),
                    user_id INTEGER,
                    machine_id INTEGER,
                    employee_id INTEGER,
                    event_time DATETIME,
                    qty_ok INTEGER,
                    qty_nok INTEGER,
                    note TEXT,
                    created_at DATETIME
                )
                """
            )
        )
    return sessionmaker(bind=engine)


def test_vp_metrics_use_operation_events_minus_pauses():
    SessionLocal = _session_factory()
    with SessionLocal() as db:
        db.add(Machine(id=1, machine_code="PILA-1", name="Pila 1", machine_type="pila", hourly_rate=1200))
        po = ProductionOrder(vp_code="VP-MET-1", quantity=2, status="hotovo")
        op = PlanningOperation(
            work_order_no="VP-MET-1",
            gpn="GPN-1",
            operation_name="Řezání",
            operation_no=10,
            machine_id=1,
            qty=2,
            setup_time_min=5,
            total_labor_time_min=20,
            total_operation_time_min=20,
            status="hotovo",
            actual_start=datetime(2026, 1, 1, 8, 0, 0),
            actual_end=datetime(2026, 1, 1, 8, 30, 0),
            qty_ok=2,
        )
        db.add_all([po, op])
        db.flush()
        db.add_all(
            [
                OperationEvent(
                    production_order_id=po.id,
                    planning_operation_id=op.id,
                    event_type="start",
                    timestamp=datetime(2026, 1, 1, 8, 0, 0),
                    event_time=datetime(2026, 1, 1, 8, 0, 0),
                ),
                OperationEvent(
                    production_order_id=po.id,
                    planning_operation_id=op.id,
                    event_type="pause",
                    timestamp=datetime(2026, 1, 1, 8, 10, 0),
                    event_time=datetime(2026, 1, 1, 8, 10, 0),
                ),
                OperationEvent(
                    production_order_id=po.id,
                    planning_operation_id=op.id,
                    event_type="resume",
                    timestamp=datetime(2026, 1, 1, 8, 15, 0),
                    event_time=datetime(2026, 1, 1, 8, 15, 0),
                ),
                OperationEvent(
                    production_order_id=po.id,
                    planning_operation_id=op.id,
                    event_type="done",
                    timestamp=datetime(2026, 1, 1, 8, 30, 0),
                    event_time=datetime(2026, 1, 1, 8, 30, 0),
                ),
            ]
        )
        db.commit()

        metrics = vp_operational_metrics_single(db, po)
        per_op = operation_event_runtime_metrics_by_planning_id(db, [op])

        assert metrics["reported_time_min"] == 25
        assert metrics["direct_labor_cost"] == 500.0
        assert metrics["labor_cost"] == 500.0
        assert metrics["performance_percent"] == 100.0
        assert per_op[op.id]["elapsed_time_min"] == 30.0
        assert per_op[op.id]["pause_time_min"] == 5.0
        assert per_op[op.id]["working_time_min"] == 25.0
        assert per_op[op.id]["planned_time_min"] == 25.0


def test_vp_metrics_fall_back_to_actual_timestamps_without_events():
    SessionLocal = _session_factory()
    with SessionLocal() as db:
        db.add(Machine(id=1, machine_code="SOU-1", name="Soustruh 1", machine_type="cnc"))
        po = ProductionOrder(vp_code="VP-MET-2", quantity=1, status="hotovo")
        op = PlanningOperation(
            work_order_no="VP-MET-2",
            gpn="GPN-1",
            operation_name="Soustružení",
            operation_no=20,
            machine_id=1,
            qty=1,
            setup_time_min=10,
            total_labor_time_min=35,
            status="hotovo",
            actual_start=datetime(2026, 1, 1, 9, 0, 0),
            actual_end=datetime(2026, 1, 1, 9, 45, 0),
            qty_ok=1,
        )
        db.add_all([po, op])
        db.commit()

        metrics = vp_operational_metrics_single(db, po)

        assert metrics["reported_time_min"] == 45
        assert metrics["performance_percent"] == 100.0


def test_vp_metrics_close_unmatched_pause_at_actual_end():
    SessionLocal = _session_factory()
    with SessionLocal() as db:
        db.add(Machine(id=1, machine_code="PILA-2", name="Pila 2", machine_type="pila", hourly_rate=600))
        po = ProductionOrder(vp_code="VP-MET-3", quantity=1, status="hotovo")
        op = PlanningOperation(
            work_order_no="VP-MET-3",
            gpn="GPN-1",
            operation_name="Řezání",
            operation_no=10,
            machine_id=1,
            qty=1,
            setup_time_min=5,
            total_labor_time_min=10,
            status="hotovo",
            actual_start=datetime(2026, 1, 1, 10, 0, 0),
            actual_end=datetime(2026, 1, 1, 10, 30, 0),
            qty_ok=1,
        )
        db.add_all([po, op])
        db.flush()
        db.add_all(
            [
                OperationEvent(
                    production_order_id=po.id,
                    planning_operation_id=op.id,
                    event_type="start",
                    timestamp=datetime(2026, 1, 1, 10, 0, 0),
                    event_time=datetime(2026, 1, 1, 10, 0, 0),
                ),
                OperationEvent(
                    production_order_id=po.id,
                    planning_operation_id=op.id,
                    event_type="pause",
                    timestamp=datetime(2026, 1, 1, 10, 20, 0),
                    event_time=datetime(2026, 1, 1, 10, 20, 0),
                ),
            ]
        )
        db.commit()

        metrics = vp_operational_metrics_single(db, po)
        per_op = operation_event_runtime_metrics_by_planning_id(db, [op], {1: db.get(Machine, 1)})

        assert metrics["reported_time_min"] == 20
        assert metrics["labor_cost"] == 200.0
        assert metrics["performance_percent"] == 75.0
        assert per_op[op.id]["elapsed_time_min"] == 30.0
        assert per_op[op.id]["pause_time_min"] == 10.0
        assert per_op[op.id]["working_time_min"] == 20.0
