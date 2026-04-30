from __future__ import annotations

from datetime import datetime, timedelta

import app.main  # noqa: F401
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.models.base import Base
from app.models.material_library import MaterialLibraryItem
from app.models.material_stock import MaterialStockItem, MaterialStockMovement
from app.models.kiosk import Employee, OperationEvent
from app.models.master_data import Machine
from app.models.orders import CustomerOrder, Job, JobItem, ProductionOrder
from app.models.planning import PlanningOperation
from app.models.supplier_purchase_order import SupplierPurchaseOrder, SupplierPurchaseOrderItem
from app.services.production_metrics_service import (
    customer_order_financial_summary,
    customer_order_item_financial_summary,
    production_order_material_cost_metrics,
    production_order_metrics,
)


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


def test_production_order_metrics_include_received_supplier_cost_only_once():
    SessionLocal = _session_factory()
    with SessionLocal() as db:
        po = ProductionOrder(vp_code="VP-SUP-1", quantity=1, status="hotovo")
        db.add(po)
        db.flush()
        op = PlanningOperation(
            work_order_no="VP-SUP-1",
            operation_no=10,
            operation_name="Kooperace",
            qty=1,
            status="hotovo",
            qty_ok=1,
        )
        db.add(op)
        db.flush()

        received = SupplierPurchaseOrder(
            po_no="SPO-SUP-1",
            supplier_name="Supplier",
            status="received",
            category="cooperation",
            production_order_id=int(po.id),
            planning_operation_id=int(op.id),
        )
        partial = SupplierPurchaseOrder(
            po_no="SPO-SUP-2",
            supplier_name="Supplier",
            status="partially_received",
            category="services",
            planning_operation_id=int(op.id),
        )
        ordered = SupplierPurchaseOrder(
            po_no="SPO-SUP-3",
            supplier_name="Supplier",
            status="ordered",
            category="cooperation",
            production_order_id=int(po.id),
        )
        db.add_all([received, partial, ordered])
        db.flush()
        db.add_all(
            [
                SupplierPurchaseOrderItem(
                    purchase_order_id=int(received.id),
                    item_name="Kooperace",
                    qty=10,
                    unit="ks",
                    unit_price=500.0,
                    total_price=5000.0,
                    received_qty=10,
                ),
                SupplierPurchaseOrderItem(
                    purchase_order_id=int(partial.id),
                    item_name="Služba",
                    qty=5,
                    unit="ks",
                    unit_price=100.0,
                    total_price=500.0,
                    received_qty=2,
                ),
                SupplierPurchaseOrderItem(
                    purchase_order_id=int(ordered.id),
                    item_name="Objednáno",
                    qty=20,
                    unit="ks",
                    unit_price=1000.0,
                    total_price=20000.0,
                    received_qty=20,
                ),
                SupplierPurchaseOrderItem(
                    purchase_order_id=int(received.id),
                    item_name="Nepřijato",
                    qty=1,
                    unit="ks",
                    unit_price=999.0,
                    total_price=999.0,
                    received_qty=0,
                ),
            ]
        )
        db.commit()

        metrics = production_order_metrics(db, po)

        assert metrics["supplier_cost"] == 5200.0
        assert metrics["total_cost"] == 5200.0


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


def test_customer_order_financial_summary_uses_item_revenue_once_and_active_pos_only():
    SessionLocal = _session_factory()
    with SessionLocal() as db:
        db.execute(text("ALTER TABLE job_items ADD COLUMN sales_price_per_unit FLOAT"))
        customer_order = CustomerOrder(customer_po_no="PO-1", customer_name="Customer", workflow_status="active")
        db.add(customer_order)
        db.flush()
        job = Job(zak_code="ZAK-1", customer_order_id=int(customer_order.id))
        db.add(job)
        db.flush()
        item = JobItem(job_id=int(job.id), line_no=1, gpn="GPN-1", qty=10, workflow_status="active")
        db.add(item)
        db.flush()
        db.execute(
            text("UPDATE job_items SET sales_price_per_unit = :price WHERE id = :id"),
            {"price": 100.0, "id": int(item.id)},
        )

        employee = Employee(employee_code="EMP-FIN-1", name="Operator", hourly_cost_rate=100.0, can_use_kiosk=True)
        machine = Machine(machine_code="M-FIN-1", name="Machine", machine_type="cnc", hourly_rate=200.0)
        po_1 = ProductionOrder(
            vp_code="VP-FIN-1",
            job_item_id=int(item.id),
            customer_order_id=int(customer_order.id),
            job_id=int(job.id),
            quantity=5,
            workflow_status="active",
        )
        po_2 = ProductionOrder(
            vp_code="VP-FIN-2",
            job_item_id=int(item.id),
            customer_order_id=int(customer_order.id),
            job_id=int(job.id),
            quantity=5,
            workflow_status="active",
        )
        po_cancelled = ProductionOrder(
            vp_code="VP-FIN-X",
            job_item_id=int(item.id),
            customer_order_id=int(customer_order.id),
            job_id=int(job.id),
            quantity=5,
            workflow_status="cancelled",
        )
        db.add_all([employee, machine, po_1, po_2, po_cancelled])
        db.flush()

        for vp_code, start_min, end_min in [
            ("VP-FIN-1", 0, 60),
            ("VP-FIN-2", 60, 90),
            ("VP-FIN-X", 90, 150),
        ]:
            actual_start = datetime(2026, 1, 1, 8, 0, 0) + timedelta(minutes=start_min)
            actual_end = datetime(2026, 1, 1, 8, 0, 0) + timedelta(minutes=end_min)
            op = PlanningOperation(
                work_order_no=vp_code,
                operation_no=10,
                operation_name="Obrábění",
                machine_id=int(machine.id),
                qty=1,
                status="hotovo",
                actual_start=actual_start,
                actual_end=actual_end,
                qty_ok=1,
            )
            db.add(op)
            db.flush()
            po_id = int(
                po_1.id if vp_code == "VP-FIN-1" else po_2.id if vp_code == "VP-FIN-2" else po_cancelled.id
            )
            db.add_all(
                [
                    OperationEvent(
                        production_order_id=po_id,
                        planning_operation_id=int(op.id),
                        event_type="start",
                        timestamp=op.actual_start,
                        event_time=op.actual_start,
                        user_id=int(employee.id),
                        employee_id=int(employee.id),
                    ),
                    OperationEvent(
                        production_order_id=po_id,
                        planning_operation_id=int(op.id),
                        event_type="done",
                        timestamp=op.actual_end,
                        event_time=op.actual_end,
                        user_id=int(employee.id),
                        employee_id=int(employee.id),
                    ),
                ]
            )
        db.commit()

        summary = customer_order_financial_summary(db, int(customer_order.id))

        assert summary["total_reported_time_min"] == 90.0
        assert summary["total_employee_labor_cost"] == 150.0
        assert summary["total_machine_cost"] == 300.0
        assert summary["total_cost"] == 450.0
        assert summary["total_revenue"] == 1000.0
        assert summary["total_profit"] == 550.0
        assert summary["margin_percent"] == 55.0
        assert summary["revenue_source"] == "order_items"


def test_customer_and_item_summaries_include_received_supplier_cost_without_double_counting():
    SessionLocal = _session_factory()
    with SessionLocal() as db:
        db.execute(text("ALTER TABLE job_items ADD COLUMN sales_price_per_unit FLOAT"))
        customer_order = CustomerOrder(customer_po_no="PO-SUP", customer_name="Customer", workflow_status="active")
        db.add(customer_order)
        db.flush()
        job = Job(zak_code="ZAK-SUP", customer_order_id=int(customer_order.id))
        db.add(job)
        db.flush()
        item = JobItem(job_id=int(job.id), line_no=1, gpn="GPN-SUP", qty=1, workflow_status="active")
        db.add(item)
        db.flush()
        db.execute(
            text("UPDATE job_items SET sales_price_per_unit = :price WHERE id = :id"),
            {"price": 10000.0, "id": int(item.id)},
        )

        supplier_po = SupplierPurchaseOrder(
            po_no="SPO-SUM-1",
            supplier_name="Supplier",
            status="received",
            category="cooperation",
            customer_order_id=int(customer_order.id),
            job_item_id=int(item.id),
        )
        draft_po = SupplierPurchaseOrder(
            po_no="SPO-SUM-2",
            supplier_name="Supplier",
            status="draft",
            category="cooperation",
            customer_order_id=int(customer_order.id),
            job_item_id=int(item.id),
        )
        db.add_all([supplier_po, draft_po])
        db.flush()
        db.add_all(
            [
                SupplierPurchaseOrderItem(
                    purchase_order_id=int(supplier_po.id),
                    item_name="Kooperace",
                    qty=10,
                    unit="ks",
                    unit_price=500.0,
                    total_price=5000.0,
                    received_qty=10,
                ),
                SupplierPurchaseOrderItem(
                    purchase_order_id=int(draft_po.id),
                    item_name="Návrh",
                    qty=10,
                    unit="ks",
                    unit_price=500.0,
                    total_price=5000.0,
                    received_qty=10,
                ),
            ]
        )
        db.commit()

        item_summary = customer_order_item_financial_summary(db, int(item.id))
        order_summary = customer_order_financial_summary(db, int(customer_order.id))

        assert item_summary["supplier_cost"] == 5000.0
        assert item_summary["total_cost"] == 5000.0
        assert item_summary["profit"] == 5000.0
        assert order_summary["total_supplier_cost"] == 5000.0
        assert order_summary["total_cost"] == 5000.0
        assert order_summary["total_profit"] == 5000.0


def test_customer_order_item_financial_summary_uses_item_revenue_once_and_active_pos_only():
    SessionLocal = _session_factory()
    with SessionLocal() as db:
        db.execute(text("ALTER TABLE job_items ADD COLUMN sales_price_per_unit FLOAT"))
        customer_order = CustomerOrder(customer_po_no="PO-ITEM", customer_name="Customer", workflow_status="active")
        db.add(customer_order)
        db.flush()
        job = Job(zak_code="ZAK-ITEM", customer_order_id=int(customer_order.id))
        db.add(job)
        db.flush()
        item = JobItem(job_id=int(job.id), line_no=1, gpn="GPN-ITEM", qty=4, workflow_status="active")
        db.add(item)
        db.flush()
        db.execute(
            text("UPDATE job_items SET sales_price_per_unit = :price WHERE id = :id"),
            {"price": 250.0, "id": int(item.id)},
        )

        employee = Employee(employee_code="EMP-ITEM", name="Operator", hourly_cost_rate=120.0, can_use_kiosk=True)
        machine = Machine(machine_code="M-ITEM", name="Machine", machine_type="cnc", hourly_rate=180.0)
        po_1 = ProductionOrder(
            vp_code="VP-ITEM-1",
            job_item_id=int(item.id),
            customer_order_id=int(customer_order.id),
            job_id=int(job.id),
            quantity=2,
            workflow_status="active",
        )
        po_2 = ProductionOrder(
            vp_code="VP-ITEM-2",
            job_item_id=int(item.id),
            customer_order_id=int(customer_order.id),
            job_id=int(job.id),
            quantity=2,
            workflow_status="active",
        )
        po_cancelled = ProductionOrder(
            vp_code="VP-ITEM-X",
            job_item_id=int(item.id),
            customer_order_id=int(customer_order.id),
            job_id=int(job.id),
            quantity=2,
            workflow_status="cancelled",
        )
        db.add_all([employee, machine, po_1, po_2, po_cancelled])
        db.flush()

        for vp_code, start_min, end_min in [
            ("VP-ITEM-1", 0, 30),
            ("VP-ITEM-2", 30, 60),
            ("VP-ITEM-X", 60, 120),
        ]:
            actual_start = datetime(2026, 1, 1, 8, 0, 0) + timedelta(minutes=start_min)
            actual_end = datetime(2026, 1, 1, 8, 0, 0) + timedelta(minutes=end_min)
            op = PlanningOperation(
                work_order_no=vp_code,
                operation_no=10,
                operation_name="Obrábění",
                machine_id=int(machine.id),
                qty=1,
                status="hotovo",
                actual_start=actual_start,
                actual_end=actual_end,
                qty_ok=1,
            )
            db.add(op)
            db.flush()
            po_id = int(
                po_1.id if vp_code == "VP-ITEM-1" else po_2.id if vp_code == "VP-ITEM-2" else po_cancelled.id
            )
            db.add_all(
                [
                    OperationEvent(
                        production_order_id=po_id,
                        planning_operation_id=int(op.id),
                        event_type="start",
                        timestamp=op.actual_start,
                        event_time=op.actual_start,
                        user_id=int(employee.id),
                        employee_id=int(employee.id),
                    ),
                    OperationEvent(
                        production_order_id=po_id,
                        planning_operation_id=int(op.id),
                        event_type="done",
                        timestamp=op.actual_end,
                        event_time=op.actual_end,
                        user_id=int(employee.id),
                        employee_id=int(employee.id),
                    ),
                ]
            )
        db.commit()

        summary = customer_order_item_financial_summary(db, int(item.id))

        assert summary["reported_time_min"] == 60.0
        assert summary["employee_labor_cost"] == 120.0
        assert summary["machine_cost"] == 180.0
        assert summary["total_cost"] == 300.0
        assert summary["revenue"] == 1000.0
        assert summary["profit"] == 700.0
        assert summary["margin_percent"] == 70.0
        assert summary["revenue_source"] == "order_item"
