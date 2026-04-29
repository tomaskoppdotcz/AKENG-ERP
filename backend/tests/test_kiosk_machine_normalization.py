from __future__ import annotations

from datetime import datetime

from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.kiosk import _resolve_machine
from app.models.base import Base
from app.models.master_data import Machine, Workcenter  # noqa: F401
from app.models.master_libraries import WorkplaceLibraryItem  # noqa: F401
from app.models.planning import MachineSchedule, PlanningOperation, PlanningScheduleSegment
from app.services.kiosk_machine_normalization import (
    OFFICIAL_KIOSK_MACHINE_CODES,
    normalize_kiosk_machine_codes,
)


def _session_factory():
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)


def _machine(id_: int, code: str, *, active: bool = True) -> Machine:
    return Machine(
        id=id_,
        machine_code=code,
        name=code,
        machine_type="WORKCENTER",
        planning_enabled=active,
        is_active=active,
        is_plannable=active,
        default_shift_minutes=450,
    )


def test_normalization_merges_duplicate_target_and_moves_planning_references():
    SessionLocal = _session_factory()
    with SessionLocal() as db:
        source = _machine(1, "HAAS_ST40")
        target = _machine(2, "HAASST40")
        op = PlanningOperation(
            id=10,
            work_order_no="VP-1",
            gpn="GPN-1",
            operation_name="Soustruzeni",
            operation_no=20,
            machine_id=1,
            qty=1,
            status="planned",
        )
        schedule = MachineSchedule(
            id=20,
            machine_id=1,
            planning_operation_id=10,
            queue_position=1,
            planned_start=datetime(2026, 1, 1, 8, 0),
            planned_end=datetime(2026, 1, 1, 9, 0),
        )
        segment = PlanningScheduleSegment(
            id=30,
            planning_operation_id=10,
            machine_id=1,
            segment_index=0,
            segment_start=datetime(2026, 1, 1, 8, 0),
            segment_end=datetime(2026, 1, 1, 9, 0),
            duration_min=60,
        )
        db.add_all([source, target, op, schedule, segment])
        db.commit()

        summary = normalize_kiosk_machine_codes(db)
        db.commit()

        assert summary["moved_ops"] == 1
        assert db.get(PlanningOperation, 10).machine_id == 2
        assert db.get(MachineSchedule, 20).machine_id == 2
        assert db.get(PlanningScheduleSegment, 30).machine_id == 2
        assert db.get(Machine, 1).is_active is False
        assert db.get(Machine, 1).planning_enabled is False
        assert db.get(Machine, 2).machine_code == "HAASST40"
        assert db.get(Machine, 2).is_active is True


def test_normalization_renames_one_source_row_and_disables_other_sources_for_same_target():
    SessionLocal = _session_factory()
    with SessionLocal() as db:
        db.add_all([_machine(1, "MEZIOPERACNI_KONTROLA"), _machine(2, "VYSTUPNI_KONTROLA")])
        db.add(
            PlanningOperation(
                id=10,
                work_order_no="VP-2",
                gpn="GPN-2",
                operation_name="Kontrola",
                operation_no=30,
                machine_id=2,
                qty=1,
                status="planned",
            )
        )
        db.commit()

        normalize_kiosk_machine_codes(db)
        db.commit()

        kontrola = db.scalar(select(Machine).where(Machine.machine_code == "KONTROLA"))
        assert kontrola is not None
        assert kontrola.is_active is True
        assert db.get(PlanningOperation, 10).machine_id == kontrola.id

        inactive_sources = db.scalars(
            select(Machine).where(Machine.machine_code == "VYSTUPNI_KONTROLA")
        ).all()
        assert len(inactive_sources) == 1
        assert inactive_sources[0].is_active is False
        assert inactive_sources[0].planning_enabled is False


def test_normalization_ensures_all_official_kiosk_codes_and_kiosk_resolver_accepts_legacy_code():
    SessionLocal = _session_factory()
    with SessionLocal() as db:
        normalize_kiosk_machine_codes(db)
        db.commit()

        active_codes = {
            code
            for code in db.scalars(
                select(Machine.machine_code).where(Machine.is_active.is_(True))
            ).all()
        }
        assert set(OFFICIAL_KIOSK_MACHINE_CODES).issubset(active_codes)

        machine = _resolve_machine(db, "CMX_600_V")
        assert machine.machine_code == "CMX600"
        assert machine.planning_enabled is True
        assert machine.is_plannable is True
