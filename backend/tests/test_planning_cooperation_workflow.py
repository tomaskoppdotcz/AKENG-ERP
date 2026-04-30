from __future__ import annotations

from datetime import date, timedelta

from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.models.base import Base
from app.models.master_data import Customer, Machine
from app.models.master_libraries import WorkplaceLibraryItem
from app.models.orders import JobItem, ProductionOrder
from app.models.planning import MachineCalendar, MachineSchedule, PlanningOperation
from app.models.portfolio import PortfolioItem, PortfolioTechnologyTemplate, PortfolioTechnologyTemplateOperation
from app.services.cooperation_operations import receive_cooperation_operation
from app.services.planning_engine import PlanningEngineService
from app.services.vp_operation_generator import ensure_planning_operations_for_production_order


def _session_factory():
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)


def _op(vp: str, no: int, machine_id: int, *, is_cooperation: bool = False) -> PlanningOperation:
    return PlanningOperation(
        work_order_no=vp,
        gpn="GPN-COOP",
        operation_name="Kooperace" if is_cooperation else f"Operace {no}",
        operation_no=no,
        machine_id=machine_id,
        qty=1,
        setup_time_min=0,
        total_labor_time_min=30,
        total_operation_time_min=30,
        expedition_date=(date.today() + timedelta(days=30)).isoformat(),
        material_ready=True,
        status="ready" if no == 10 else "waiting_release",
        is_cooperation=is_cooperation,
        cooperation_status="sent" if is_cooperation else None,
    )


def test_planner_skips_cooperation_and_blocks_following_until_received():
    SessionLocal = _session_factory()
    with SessionLocal() as db:
        machine = Machine(machine_code="M-COOP", name="Machine", machine_type="cnc")
        db.add(machine)
        db.flush()
        for i in range(7):
            db.add(
                MachineCalendar(
                    machine_id=int(machine.id),
                    calendar_date=date.today() + timedelta(days=i),
                    available_minutes=480,
                    is_working_day=True,
                    is_machine_available=True,
                )
            )
        db.add(
            ProductionOrder(
                vp_code="VP-COOP-1",
                quantity=1,
                status="planned",
                is_material_released_to_production=True,
                is_material_ready=True,
            )
        )
        op10 = _op("VP-COOP-1", 10, int(machine.id))
        op20 = _op("VP-COOP-1", 20, int(machine.id), is_cooperation=True)
        op30 = _op("VP-COOP-1", 30, int(machine.id))
        db.add_all([op10, op20, op30])
        db.commit()

        PlanningEngineService(db).rebuild_all(date.today())

        scheduled_ids = set(db.scalars(select(MachineSchedule.planning_operation_id)).all())
        assert int(op10.id) in scheduled_ids
        assert int(op20.id) not in scheduled_ids
        assert int(op30.id) not in scheduled_ids
        assert db.get(PlanningOperation, int(op30.id)).planned_start is None

        receive_cooperation_operation(db, int(op20.id))

        scheduled_ids = set(db.scalars(select(MachineSchedule.planning_operation_id)).all())
        assert int(op20.id) not in scheduled_ids
        assert int(op30.id) in scheduled_ids
        assert db.get(PlanningOperation, int(op20.id)).status == "hotovo"


def test_generation_copies_cooperation_from_portfolio_tp_without_machine_capacity():
    SessionLocal = _session_factory()
    with SessionLocal() as db:
        customer = Customer(code="C-COOP", name="Cooperation Customer")
        db.add(customer)
        db.flush()
        portfolio_item = PortfolioItem(
            customer_id=int(customer.id),
            gpn="GPN-COOP-TP",
            name="Coop part",
            logistic_mode="vyroba_zakaznik",
            is_active=True,
        )
        db.add(portfolio_item)
        db.flush()
        template = PortfolioTechnologyTemplate(
            portfolio_item_id=int(portfolio_item.id),
            name="TP Coop",
            version="A",
            is_active=True,
        )
        db.add(template)
        db.flush()
        workplace = WorkplaceLibraryItem(code="FIN", name="Dokončení")
        db.add(workplace)
        db.flush()
        portfolio_item.active_template_id = int(template.id)
        db.add_all(
            [
                PortfolioTechnologyTemplateOperation(
                    template_id=int(template.id),
                    operation_no=10,
                    operation_name="Kooperace - kalení",
                    setup_min=0,
                    run_min_per_piece=0,
                    is_cooperation=True,
                    default_cooperation_status="pending_send",
                    cooperation_category="kalení",
                    cooperation_note="Externí tepelné zpracování",
                ),
                PortfolioTechnologyTemplateOperation(
                    template_id=int(template.id),
                    operation_no=20,
                    operation_name="Dokončení",
                    workplace="Manual",
                    workplace_library_item_id=int(workplace.id),
                    setup_min=5,
                    run_min_per_piece=10,
                ),
            ]
        )
        job_item = JobItem(
            line_no=1,
            gpn="GPN-COOP-TP",
            qty=2,
            due_date=date.today() + timedelta(days=14),
        )
        po = ProductionOrder(
            vp_code="VP-COOP-TP",
            job_item=job_item,
            portfolio_item_id=int(portfolio_item.id),
            gpn="GPN-COOP-TP",
            quantity=2,
            status="planned",
            is_material_released_to_production=True,
            is_material_ready=True,
        )
        db.add(po)
        db.commit()

        out = ensure_planning_operations_for_production_order(db, po)
        assert out["created"] == 2

        coop = db.scalar(select(PlanningOperation).where(PlanningOperation.operation_name == "Kooperace - kalení"))
        assert coop is not None
        assert coop.is_cooperation is True
        assert coop.cooperation_status == "pending_send"
        assert coop.cooperation_category == "kalení"
        assert coop.cooperation_note == "Externí tepelné zpracování"
        assert coop.machine_id is not None
        assert db.scalar(select(MachineSchedule).where(MachineSchedule.planning_operation_id == int(coop.id))) is None
