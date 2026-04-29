from __future__ import annotations

from datetime import datetime

import app.main  # noqa: F401
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.models.base import Base
from app.models.material_library import MaterialLibraryItem
from app.models.material_stock import MaterialStockItem, MaterialStockMovement
from app.models.kiosk import Employee, OperationEvent
from app.models.master_data import Machine
from app.models.orders import ProductionOrder
from app.models.planning import PlanningOperation
from app.services.production_metrics_service import production_order_material_cost_metrics, production_order_metrics


def _session_factory():
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)


def test_material_cost_uses_issued_round_bar_movements():
    SessionLocal = _session_factory()
    with SessionLocal() as db:
        material = MaterialLibraryItem(
            code="MAT-42",
            name="42CrMo4",
            material_type="steel",
            form="Tyč kruhová",
            dimension="20 mm",
            unit="mm",
            density=7.85,
            price_per_kg=50.0,
        )
        db.add(material)
        db.flush()
        stock = MaterialStockItem(material_library_item_id=int(material.id), current_qty=10_000, unit="mm")
        po = ProductionOrder(vp_code="VP-COST-1", quantity=1, status="planned")
        db.add_all([stock, po])
        db.flush()
        db.add(
            MaterialStockMovement(
                stock_item_id=int(stock.id),
                movement_type="vydej",
                qty=1000.0,
                movement_date=datetime(2026, 1, 1, 8, 0, 0),
                production_order_id=int(po.id),
            )
        )
        db.commit()

        metrics = production_order_material_cost_metrics(db, po)

        assert metrics == {
            "material_cost": 123.31,
            "missing_material_cost_data": False,
        }


def test_material_cost_flags_missing_price_data():
    SessionLocal = _session_factory()
    with SessionLocal() as db:
        material = MaterialLibraryItem(
            code="MAT-NO-PRICE",
            name="No price steel",
            material_type="steel",
            form="Tyč kruhová",
            dimension="20 mm",
            unit="mm",
            density=7.85,
        )
        db.add(material)
        db.flush()
        stock = MaterialStockItem(material_library_item_id=int(material.id), current_qty=1000, unit="mm")
        po = ProductionOrder(vp_code="VP-COST-2", quantity=1, status="planned")
        db.add_all([stock, po])
        db.flush()
        db.add(
            MaterialStockMovement(
                stock_item_id=int(stock.id),
                movement_type="vydej_zbytek",
                qty=500.0,
                movement_date=datetime(2026, 1, 1, 9, 0, 0),
                production_order_id=int(po.id),
            )
        )
        db.commit()

        metrics = production_order_material_cost_metrics(db, po)

        assert metrics == {
            "material_cost": 0.0,
            "missing_material_cost_data": True,
        }


def test_production_order_metrics_split_employee_and_machine_costs():
    SessionLocal = _session_factory()
    with SessionLocal() as db:
        employee = Employee(
            employee_code="EMP-COST-1",
            name="Operator Cost",
            hourly_cost_rate=300.0,
            can_use_kiosk=True,
        )
        machine = Machine(machine_code="M-COST-1", name="Machine Cost", machine_type="cnc", hourly_rate=600.0)
        po = ProductionOrder(vp_code="VP-COST-3", quantity=1, status="hotovo")
        db.add_all([employee, machine, po])
        db.flush()
        op = PlanningOperation(
            work_order_no="VP-COST-3",
            operation_no=10,
            operation_name="Soustružení",
            machine_id=int(machine.id),
            qty=1,
            setup_time_min=0,
            total_labor_time_min=30,
            status="hotovo",
            actual_start=datetime(2026, 1, 1, 8, 0, 0),
            actual_end=datetime(2026, 1, 1, 8, 30, 0),
            qty_ok=1,
        )
        db.add(op)
        db.flush()
        db.add_all(
            [
                OperationEvent(
                    production_order_id=int(po.id),
                    planning_operation_id=int(op.id),
                    event_type="start",
                    timestamp=datetime(2026, 1, 1, 8, 0, 0),
                    event_time=datetime(2026, 1, 1, 8, 0, 0),
                    user_id=int(employee.id),
                    employee_id=int(employee.id),
                ),
                OperationEvent(
                    production_order_id=int(po.id),
                    planning_operation_id=int(op.id),
                    event_type="done",
                    timestamp=datetime(2026, 1, 1, 8, 30, 0),
                    event_time=datetime(2026, 1, 1, 8, 30, 0),
                    user_id=int(employee.id),
                    employee_id=int(employee.id),
                ),
            ]
        )
        db.commit()

        metrics = production_order_metrics(db, po)

        assert metrics["reported_time_min"] == 30.0
        assert metrics["employee_labor_cost"] == 150.0
        assert metrics["machine_cost"] == 300.0
        assert metrics["labor_cost"] == 450.0
        assert metrics["total_cost"] == 450.0
        assert metrics["missing_employee_rate"] is False
        assert metrics["missing_machine_rate"] is False


def test_production_order_metrics_flags_missing_employee_rate():
    SessionLocal = _session_factory()
    with SessionLocal() as db:
        employee = Employee(employee_code="EMP-NO-RATE", name="No Rate", can_use_kiosk=True)
        machine = Machine(machine_code="M-COST-2", name="Machine Cost 2", machine_type="cnc", hourly_rate=600.0)
        po = ProductionOrder(vp_code="VP-COST-4", quantity=1, status="hotovo")
        db.add_all([employee, machine, po])
        db.flush()
        op = PlanningOperation(
            work_order_no="VP-COST-4",
            operation_no=10,
            operation_name="Soustružení",
            machine_id=int(machine.id),
            qty=1,
            status="hotovo",
            actual_start=datetime(2026, 1, 1, 9, 0, 0),
            actual_end=datetime(2026, 1, 1, 9, 15, 0),
            qty_ok=1,
        )
        db.add(op)
        db.flush()
        db.add_all(
            [
                OperationEvent(
                    production_order_id=int(po.id),
                    planning_operation_id=int(op.id),
                    event_type="start",
                    timestamp=datetime(2026, 1, 1, 9, 0, 0),
                    event_time=datetime(2026, 1, 1, 9, 0, 0),
                    user_id=int(employee.id),
                ),
                OperationEvent(
                    production_order_id=int(po.id),
                    planning_operation_id=int(op.id),
                    event_type="done",
                    timestamp=datetime(2026, 1, 1, 9, 15, 0),
                    event_time=datetime(2026, 1, 1, 9, 15, 0),
                    user_id=int(employee.id),
                ),
            ]
        )
        db.commit()

        metrics = production_order_metrics(db, po)

        assert metrics["reported_time_min"] == 15.0
        assert metrics["employee_labor_cost"] == 0.0
        assert metrics["machine_cost"] == 150.0
        assert metrics["labor_cost"] == 150.0
        assert metrics["missing_employee_rate"] is True
        assert metrics["missing_machine_rate"] is False
