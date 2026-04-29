from __future__ import annotations

from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.models.base import Base
from app.models.master_data import Machine, Workcenter  # noqa: F401
from app.models.master_libraries import WorkplaceLibraryItem
from app.services.workplace_scheduling_anchor import sync_machine_hourly_rates_for_workplace


def _session_factory():
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)


def test_sync_machine_hourly_rates_for_workplace_updates_all_linked_machines():
    SessionLocal = _session_factory()
    with SessionLocal() as db:
        db.add(
            WorkplaceLibraryItem(
                id=10,
                code="PILA",
                name="Pila",
                workplace_type="rezani",
                hourly_rate=420.0,
                daily_capacity_hours=8.0,
            )
        )
        db.add_all(
            [
                Machine(
                    id=1,
                    machine_code="PILA-1",
                    name="Pila 1",
                    machine_type="pila",
                    workplace_library_item_id=10,
                    hourly_rate=None,
                ),
                Machine(
                    id=2,
                    machine_code="PILA-2",
                    name="Pila 2",
                    machine_type="pila",
                    workplace_library_item_id=10,
                    hourly_rate=100.0,
                ),
                Machine(
                    id=3,
                    machine_code="OTHER",
                    name="Other",
                    machine_type="other",
                    workplace_library_item_id=None,
                    hourly_rate=999.0,
                ),
            ]
        )
        db.commit()

        updated = sync_machine_hourly_rates_for_workplace(db, 10)
        db.commit()

        assert updated == 2
        rates = dict(db.execute(select(Machine.machine_code, Machine.hourly_rate)).all())
        assert rates["PILA-1"] == 420.0
        assert rates["PILA-2"] == 420.0
        assert rates["OTHER"] == 999.0
