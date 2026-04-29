from __future__ import annotations

from datetime import datetime

from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.models.base import Base
from app.models.kiosk import OperationEvent
from app.models.master_data import Machine
from app.models.orders import ProductionOrder
from app.models.planning import PlanningOperation
from app.services.operation_tracking_service import (
    compute_operation_runtime,
    operation_tracking_done,
    operation_tracking_pause,
    operation_tracking_resume,
    operation_tracking_start,
)


def _session_factory():
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)


def test_operation_tracking_lifecycle_updates_operation_and_events_without_stock_logic():
    SessionLocal = _session_factory()
    with SessionLocal() as db:
        db.add(Machine(id=1, machine_code="PILA-1", name="Pila 1"))
        po = ProductionOrder(vp_code="VP-TRACK-1", quantity=7, status="planned")
        op = PlanningOperation(
            work_order_no="VP-TRACK-1",
            gpn="GPN-1",
            operation_name="Řezání",
            operation_no=10,
            machine_id=1,
            qty=7,
            status="planned",
        )
        db.add_all([po, op])
        db.commit()

        operation_tracking_start(db, op, user_id=11)
        assert op.status == "bezi"
        assert op.actual_start is not None

        operation_tracking_pause(db, op, reason="seřízení", user_id=11)
        assert op.status == "paused"

        operation_tracking_resume(db, op, user_id=11)
        assert op.status == "bezi"

        operation_tracking_done(db, op, user_id=11)
        assert op.status == "hotovo"
        assert op.actual_end is not None
        assert op.qty_ok == 7
        assert op.qty_nok == 0

        rows = db.scalars(select(OperationEvent).order_by(OperationEvent.id.asc())).all()
        assert [r.event_type for r in rows] == ["start", "pause", "resume", "done"]
        assert all(r.production_order_id == po.id for r in rows)
        assert all(r.planning_operation_id == op.id for r in rows)
        assert all(r.user_id == 11 for r in rows)
        assert rows[1].reason == "seřízení"


def test_operation_runtime_derives_total_pause_and_working_seconds():
    events = [
        OperationEvent(event_type="start", planning_operation_id=1, timestamp=datetime(2026, 1, 1, 8, 0, 0)),
        OperationEvent(event_type="pause", planning_operation_id=1, timestamp=datetime(2026, 1, 1, 8, 10, 0)),
        OperationEvent(event_type="resume", planning_operation_id=1, timestamp=datetime(2026, 1, 1, 8, 15, 0)),
        OperationEvent(event_type="done", planning_operation_id=1, timestamp=datetime(2026, 1, 1, 8, 30, 0)),
    ]

    runtime = compute_operation_runtime(events, now=datetime(2026, 1, 1, 9, 0, 0))

    assert runtime.total_seconds == 30 * 60
    assert runtime.pause_seconds == 5 * 60
    assert runtime.working_seconds == 25 * 60
