"""Simple kiosk operation tracking based on operation_events.

This service intentionally does not create material movements, reservations, or
stock effects. It only updates planning_operations runtime fields and appends
operation_events.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from sqlalchemy import inspect, select, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from app.models.kiosk import OperationEvent
from app.models.orders import ProductionOrder
from app.models.planning import PlanningOperation

EVENT_START = "start"
EVENT_PAUSE = "pause"
EVENT_RESUME = "resume"
EVENT_DONE = "done"
TRACKING_EVENT_TYPES = frozenset({EVENT_START, EVENT_PAUSE, EVENT_RESUME, EVENT_DONE})
_CZECH_TZ = ZoneInfo("Europe/Prague")


@dataclass(frozen=True)
class OperationRuntime:
    total_seconds: int
    pause_seconds: int
    working_seconds: int


def tracking_now() -> datetime:
    return datetime.now(_CZECH_TZ).replace(tzinfo=None)


def ensure_operation_events_sqlite_schema(engine: Engine) -> None:
    """Backfill columns for existing SQLite databases where create_all is not enough."""
    if engine.dialect.name != "sqlite":
        return
    with engine.begin() as conn:
        tables = set(inspect(conn).get_table_names())
        if "operation_events" not in tables:
            return
        cols = {row[1] for row in conn.execute(text("PRAGMA table_info(operation_events)")).fetchall()}
        if "production_order_id" not in cols:
            conn.execute(text("ALTER TABLE operation_events ADD COLUMN production_order_id INTEGER"))
        if "timestamp" not in cols:
            conn.execute(text("ALTER TABLE operation_events ADD COLUMN timestamp DATETIME"))
            conn.execute(text("UPDATE operation_events SET timestamp = event_time WHERE timestamp IS NULL"))
        if "user_id" not in cols:
            conn.execute(text("ALTER TABLE operation_events ADD COLUMN user_id INTEGER"))


def resolve_operation_production_order(db: Session, op: PlanningOperation) -> ProductionOrder | None:
    woo = (op.work_order_no or "").strip()
    if woo:
        po = db.scalar(select(ProductionOrder).where(ProductionOrder.vp_code == woo))
        if po:
            return po
    if op.order_item_id is not None:
        return db.scalar(
            select(ProductionOrder)
            .where(ProductionOrder.job_item_id == int(op.order_item_id))
            .order_by(ProductionOrder.id.desc())
        )
    return None


def list_tracking_events(db: Session, planning_operation_id: int) -> list[OperationEvent]:
    return list(
        db.scalars(
            select(OperationEvent)
            .where(OperationEvent.planning_operation_id == int(planning_operation_id))
            .where(OperationEvent.event_type.in_(tuple(TRACKING_EVENT_TYPES)))
            .order_by(OperationEvent.timestamp.asc(), OperationEvent.id.asc())
        ).all()
    )


def compute_operation_runtime(
    events: list[OperationEvent],
    *,
    now: datetime | None = None,
) -> OperationRuntime:
    if not events:
        return OperationRuntime(total_seconds=0, pause_seconds=0, working_seconds=0)

    current_time = now or tracking_now()
    start_at: datetime | None = None
    end_at: datetime | None = None
    pause_started_at: datetime | None = None
    pause_seconds = 0

    for event in events:
        ts = event.timestamp or event.event_time
        if ts is None:
            continue
        if event.event_type == EVENT_START and start_at is None:
            start_at = ts
        elif event.event_type == EVENT_PAUSE and start_at is not None and pause_started_at is None:
            pause_started_at = ts
        elif event.event_type == EVENT_RESUME and pause_started_at is not None:
            pause_seconds += max(0, int((ts - pause_started_at).total_seconds()))
            pause_started_at = None
        elif event.event_type == EVENT_DONE and start_at is not None:
            if pause_started_at is not None:
                pause_seconds += max(0, int((ts - pause_started_at).total_seconds()))
                pause_started_at = None
            end_at = ts
            break

    if start_at is None:
        return OperationRuntime(total_seconds=0, pause_seconds=0, working_seconds=0)

    effective_end = end_at or current_time
    if pause_started_at is not None:
        pause_seconds += max(0, int((effective_end - pause_started_at).total_seconds()))
    total_seconds = max(0, int((effective_end - start_at).total_seconds()))
    pause_seconds = max(0, min(pause_seconds, total_seconds))
    return OperationRuntime(
        total_seconds=total_seconds,
        pause_seconds=pause_seconds,
        working_seconds=max(0, total_seconds - pause_seconds),
    )


def runtime_dict(db: Session, planning_operation_id: int) -> dict[str, int]:
    rt = compute_operation_runtime(list_tracking_events(db, planning_operation_id))
    return {
        "total_seconds": rt.total_seconds,
        "pause_seconds": rt.pause_seconds,
        "working_seconds": rt.working_seconds,
    }


def _append_event(
    db: Session,
    *,
    op: PlanningOperation,
    event_type: str,
    reason: str | None = None,
    user_id: int | None = None,
) -> OperationEvent:
    if event_type not in TRACKING_EVENT_TYPES:
        raise HTTPException(status_code=422, detail="Neplatný typ události operace.")
    now = tracking_now()
    po = resolve_operation_production_order(db, op)
    row = OperationEvent(
        production_order_id=int(po.id) if po is not None else None,
        planning_operation_id=int(op.id),
        event_type=event_type,
        timestamp=now,
        event_time=now,
        reason=(reason.strip() if reason else None),
        user_id=int(user_id) if user_id is not None else None,
        employee_id=int(user_id) if user_id is not None else None,
        machine_id=int(op.machine_id) if op.machine_id is not None else None,
    )
    db.add(row)
    return row


def _latest_tracking_event(events: list[OperationEvent]) -> OperationEvent | None:
    return events[-1] if events else None


def operation_tracking_start(db: Session, op: PlanningOperation, *, user_id: int | None) -> OperationEvent:
    if str(op.status or "").strip().lower() == "hotovo":
        raise HTTPException(status_code=409, detail="Operace už je hotová.")
    events = list_tracking_events(db, int(op.id))
    if _latest_tracking_event(events) is not None:
        raise HTTPException(status_code=409, detail="Operace už byla zahájena.")
    now = tracking_now()
    op.status = "bezi"
    if op.actual_start is None:
        op.actual_start = now
    row = _append_event(db, op=op, event_type=EVENT_START, user_id=user_id)
    db.commit()
    db.refresh(row)
    db.refresh(op)
    return row


def operation_tracking_pause(
    db: Session,
    op: PlanningOperation,
    *,
    reason: str,
    user_id: int | None,
) -> OperationEvent:
    reason = (reason or "").strip()
    if not reason:
        raise HTTPException(status_code=422, detail="Důvod pauzy je povinný.")
    latest = _latest_tracking_event(list_tracking_events(db, int(op.id)))
    if latest is None or latest.event_type not in {EVENT_START, EVENT_RESUME}:
        raise HTTPException(status_code=409, detail="Operace neběží.")
    op.status = "paused"
    row = _append_event(db, op=op, event_type=EVENT_PAUSE, reason=reason, user_id=user_id)
    db.commit()
    db.refresh(row)
    db.refresh(op)
    return row


def operation_tracking_resume(db: Session, op: PlanningOperation, *, user_id: int | None) -> OperationEvent:
    latest = _latest_tracking_event(list_tracking_events(db, int(op.id)))
    if latest is None or latest.event_type != EVENT_PAUSE:
        raise HTTPException(status_code=409, detail="Operace není v pauze.")
    op.status = "bezi"
    row = _append_event(db, op=op, event_type=EVENT_RESUME, user_id=user_id)
    db.commit()
    db.refresh(row)
    db.refresh(op)
    return row


def operation_tracking_done(db: Session, op: PlanningOperation, *, user_id: int | None) -> OperationEvent:
    latest = _latest_tracking_event(list_tracking_events(db, int(op.id)))
    if latest is None:
        raise HTTPException(status_code=409, detail="Operace nebyla zahájena.")
    if latest.event_type == EVENT_DONE:
        raise HTTPException(status_code=409, detail="Operace už je hotová.")
    now = tracking_now()
    op.status = "hotovo"
    op.actual_end = now
    op.qty_ok = int(op.qty or 0)
    op.qty_nok = 0
    row = _append_event(db, op=op, event_type=EVENT_DONE, user_id=user_id)
    db.commit()
    db.refresh(row)
    db.refresh(op)
    return row
