"""Unified work-report lifecycle for PC kiosk, shopfloor kiosk, and manual edits."""

from __future__ import annotations

import json
import logging
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo
from typing import Any

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.kiosk import OperationEvent
from app.models.master_data import Machine
from app.models.orders import Job, JobItem, ProductionOrder
from app.models.planning import PlanningOperation
from app.models.work_report import WorkReport, WorkReportAuditLog, WorkReportPause
from app.services.kiosk_planner_queue import operation_on_same_planner_row_as_machine
from app.services.kiosk_tp_stock_effects import apply_kiosk_tp_stock_effect_on_operation_complete
from app.services.kiosk_vp_operation_order import assert_vp_previous_operations_finished_for_kiosk_start
from app.services.planning_engine import PlanningEngineService
from app.services.planning_operation_status import normalize_planning_operation_status
from app.services.work_report_code import allocate_next_work_report_code

logger = logging.getLogger(__name__)
_CZECH_TZ = ZoneInfo("Europe/Prague")


def _runtime_now() -> datetime:
    """
    Runtime timestamps in ERP are stored as local naive wall-clock.
    Always generate Czech local time regardless of server system timezone.
    """
    return datetime.now(_CZECH_TZ).replace(tzinfo=None)

PAUSE_REASONS: tuple[str, ...] = (
    "seřízení",
    "čekání na materiál",
    "čekání na kontrolu",
    "porucha stroje",
    "oběd",
    "jiný důvod",
)
PAUSE_REASON_SET = frozenset(PAUSE_REASONS)

SOURCE_PC_KIOSK = "pc_kiosk"
SOURCE_SHOPFLOOR_KIOSK = "shopfloor_kiosk"
SOURCE_MANUAL = "manual"


def validate_pause_reason(raw: str | None) -> str:
    r = (raw or "").strip()
    if not r:
        raise HTTPException(status_code=422, detail="Důvod přestávky je povinný.")
    if r not in PAUSE_REASON_SET:
        raise HTTPException(
            status_code=422,
            detail=f"Neplatný důvod přestávky. Povolené: {', '.join(sorted(PAUSE_REASON_SET))}.",
        )
    return r


def _audit(
    db: Session,
    *,
    work_report_id: int | None,
    action: str,
    actor: str | None,
    details: dict[str, Any] | None,
) -> None:
    db.add(
        WorkReportAuditLog(
            work_report_id=work_report_id,
            action=action,
            actor=(actor or None),
            details_json=json.dumps(details or {}, ensure_ascii=False, default=str),
            created_at=_runtime_now(),
        )
    )


def resolve_report_links(db: Session, op: PlanningOperation) -> dict[str, int | None]:
    job_item_id = op.order_item_id
    customer_order_id: int | None = None
    production_order_id: int | None = None
    if job_item_id:
        ji = db.get(JobItem, int(job_item_id))
        if ji and ji.job_id:
            job = db.get(Job, int(ji.job_id))
            if job:
                customer_order_id = int(job.customer_order_id) if job.customer_order_id else None
        woo = (op.work_order_no or "").strip()
        if woo:
            po = db.scalar(select(ProductionOrder).where(ProductionOrder.vp_code == woo))
            if po:
                production_order_id = int(po.id)
        if production_order_id is None:
            po2 = db.scalar(
                select(ProductionOrder)
                .where(ProductionOrder.job_item_id == int(job_item_id))
                .order_by(ProductionOrder.id.desc())
            )
            if po2:
                production_order_id = int(po2.id)
    wid = getattr(op, "workplace_library_item_id", None)
    workplace_library_item_id = int(wid) if wid is not None else None
    return {
        "customer_order_id": customer_order_id,
        "job_item_id": int(job_item_id) if job_item_id is not None else None,
        "production_order_id": production_order_id,
        "workplace_library_item_id": workplace_library_item_id,
    }


def _get_open_report(db: Session, planning_operation_id: int) -> WorkReport | None:
    return db.scalar(
        select(WorkReport)
        .where(WorkReport.planning_operation_id == int(planning_operation_id))
        .where(WorkReport.ended_at.is_(None))
    )


def _get_open_pause(db: Session, work_report_id: int) -> WorkReportPause | None:
    return db.scalar(
        select(WorkReportPause)
        .where(WorkReportPause.work_report_id == int(work_report_id))
        .where(WorkReportPause.pause_end.is_(None))
    )


def _list_pauses_for_report(db: Session, work_report_id: int) -> list[WorkReportPause]:
    return list(
        db.scalars(
            select(WorkReportPause)
            .where(WorkReportPause.work_report_id == int(work_report_id))
            .order_by(WorkReportPause.pause_start.asc())
        ).all()
    )


def _compute_duration_min(report: WorkReport, pauses: list[WorkReportPause], ended_at: datetime) -> float:
    gross = (ended_at - report.started_at).total_seconds() / 60.0
    pause_total = 0.0
    for p in pauses:
        pe = p.pause_end or ended_at
        pause_total += max(0.0, (pe - p.pause_start).total_seconds() / 60.0)
    return max(0.0, gross - pause_total)


def refresh_report_duration_min(db: Session, rep: WorkReport) -> None:
    """Recompute net duration for a closed report (gross time minus closed pauses)."""
    if rep.ended_at is None:
        rep.duration_min = None
        return
    pauses = _list_pauses_for_report(db, rep.id)
    rep.duration_min = _compute_duration_min(rep, pauses, rep.ended_at)


def _maybe_operation_event(
    db: Session,
    *,
    op: PlanningOperation,
    machine_id: int,
    employee_id: int | None,
    event_type: str,
    qty_ok: int | None = None,
    qty_nok: int | None = None,
    reason: str | None = None,
    note: str | None = None,
) -> None:
    if employee_id is None:
        return
    db.add(
        OperationEvent(
            planning_operation_id=op.id,
            machine_id=int(machine_id),
            employee_id=int(employee_id),
            event_type=event_type,
            event_time=_runtime_now(),
            qty_ok=qty_ok,
            qty_nok=qty_nok,
            reason=reason,
            note=note,
            created_at=_runtime_now(),
        )
    )


def _require_op_on_machine_row(db: Session, machine: Machine, op: PlanningOperation) -> None:
    if not operation_on_same_planner_row_as_machine(db, op, machine):
        raise HTTPException(
            status_code=400,
            detail="Operace nepatří na stejný řádek Planneru jako tento stroj / pracoviště.",
        )


def _recompute_po_status_from_planning_chain(db: Session, op: PlanningOperation) -> str | None:
    """
    Kiosk flow zapisuje stav do planning_operations, ne do production_order_operation_logs.
    Proto zde dopočítáme production_orders.status z celé VP chain (work_order_no).
    """
    woo = (op.work_order_no or "").strip()
    if not woo:
        return None
    po = db.scalar(select(ProductionOrder).where(ProductionOrder.vp_code == woo))
    if po is None:
        return None
    chain = db.scalars(
        select(PlanningOperation)
        .where(PlanningOperation.work_order_no == woo)
        .order_by(PlanningOperation.operation_no.asc(), PlanningOperation.id.asc())
    ).all()
    if not chain:
        return None
    statuses = [normalize_planning_operation_status(getattr(r, "status", None)) for r in chain]
    active = [s for s in statuses if s != "cancelled"]
    if active and all(s == "hotovo" for s in active):
        po.status = "hotovo"
    elif any(s == "bezi" for s in active):
        po.status = "bezi"
    elif any(s in {"hotovo", "ceka"} for s in active):
        po.status = "bezi"
    else:
        po.status = "planned"
    return str(po.status or "planned")


def work_report_start(
    db: Session,
    op: PlanningOperation,
    *,
    machine: Machine,
    employee_id: int | None,
    operator_display: str | None,
    source: str,
    actor: str | None = None,
    kiosk_session_id: int | None = None,
) -> dict[str, Any]:
    _require_op_on_machine_row(db, machine, op)
    assert_vp_previous_operations_finished_for_kiosk_start(db, op)
    from app.services.material_readiness import ensure_planning_operation_material_ready_for_start

    ensure_planning_operation_material_ready_for_start(db, op)

    now = _runtime_now()
    open_rep = _get_open_report(db, op.id)
    if open_rep:
        if _get_open_pause(db, open_rep.id):
            raise HTTPException(
                status_code=409,
                detail="Operace je v přestávce — použijte Pokračovat (resume).",
            )
        now_idem = _runtime_now()
        op.status = "bezi"
        if op.actual_start is None:
            op.actual_start = now_idem
        db.commit()
        db.refresh(open_rep)
        db.refresh(op)
        return {"status": "ok", "work_report_id": open_rep.id, "idempotent": True, "operation_status": op.status}

    links = resolve_report_links(db, op)
    rep = WorkReport(
        code=allocate_next_work_report_code(db),
        employee_id=employee_id,
        operator_display=(operator_display or None),
        customer_order_id=links["customer_order_id"],
        job_item_id=links["job_item_id"],
        production_order_id=links["production_order_id"],
        planning_operation_id=int(op.id),
        machine_id=int(machine.id),
        workplace_library_item_id=links["workplace_library_item_id"],
        operation_no=int(op.operation_no or 0),
        operation_name=str(op.operation_name or "")[:200],
        started_at=now,
        ended_at=None,
        duration_min=None,
        qty_ok=None,
        qty_nok=None,
        note=None,
        source=source,
        kiosk_session_id=kiosk_session_id,
        created_by=actor,
        updated_by=actor,
        created_at=now,
        updated_at=now,
    )
    db.add(rep)
    _maybe_operation_event(db, op=op, machine_id=machine.id, employee_id=employee_id, event_type="start")
    op.status = "bezi"
    if op.actual_start is None:
        op.actual_start = now
    db.flush()
    _audit(
        db,
        work_report_id=rep.id,
        action="report_created",
        actor=actor,
        details={"source": source, "planning_operation_id": op.id},
    )
    db.commit()
    db.refresh(rep)
    return {"status": "ok", "work_report_id": rep.id, "idempotent": False, "operation_status": op.status}


def work_report_pause(
    db: Session,
    op: PlanningOperation,
    *,
    machine: Machine,
    employee_id: int | None,
    operator_display: str | None,
    pause_reason: str,
    note: str | None,
    source: str,
    actor: str | None = None,
) -> dict[str, Any]:
    _require_op_on_machine_row(db, machine, op)
    reason = validate_pause_reason(pause_reason)
    rep = _get_open_report(db, op.id)
    if not rep:
        raise HTTPException(status_code=409, detail="Neexistuje otevřený výkaz — nejdřív START.")
    if _get_open_pause(db, rep.id):
        raise HTTPException(status_code=409, detail="Přestávka už je otevřená.")
    effective_employee_id = int(employee_id) if employee_id is not None else (int(rep.employee_id) if rep.employee_id is not None else None)
    incoming_operator = (operator_display or "").strip() or None
    if rep.employee_id is None and effective_employee_id is not None:
        rep.employee_id = int(effective_employee_id)
    if incoming_operator and not (rep.operator_display or "").strip():
        rep.operator_display = incoming_operator
    now = _runtime_now()
    p = WorkReportPause(
        work_report_id=rep.id,
        pause_start=now,
        pause_end=None,
        pause_reason=reason,
        note=(note or None),
        created_at=now,
    )
    db.add(p)
    _maybe_operation_event(
        db,
        op=op,
        machine_id=machine.id,
        employee_id=effective_employee_id,
        event_type="pause",
        reason=reason,
        note=note,
    )
    op.status = "ceka"
    rep.updated_at = now
    rep.updated_by = actor
    _audit(
        db,
        work_report_id=rep.id,
        action="pause_opened",
        actor=actor,
        details={"pause_reason": reason, "note": note},
    )
    db.commit()
    db.refresh(p)
    return {"status": "ok", "work_report_id": rep.id, "pause_id": p.id, "operation_status": op.status}


def work_report_resume(
    db: Session,
    op: PlanningOperation,
    *,
    machine: Machine,
    employee_id: int | None,
    operator_display: str | None,
    source: str,
    actor: str | None = None,
) -> dict[str, Any]:
    _require_op_on_machine_row(db, machine, op)
    assert_vp_previous_operations_finished_for_kiosk_start(db, op)
    rep = _get_open_report(db, op.id)
    if not rep:
        raise HTTPException(status_code=409, detail="Neexistuje otevřený výkaz.")
    open_p = _get_open_pause(db, rep.id)
    if not open_p:
        raise HTTPException(status_code=409, detail="Není otevřená přestávka.")
    effective_employee_id = int(employee_id) if employee_id is not None else (int(rep.employee_id) if rep.employee_id is not None else None)
    incoming_operator = (operator_display or "").strip() or None
    if rep.employee_id is None and effective_employee_id is not None:
        rep.employee_id = int(effective_employee_id)
    if incoming_operator and not (rep.operator_display or "").strip():
        rep.operator_display = incoming_operator
    now = _runtime_now()
    open_p.pause_end = now
    _maybe_operation_event(db, op=op, machine_id=machine.id, employee_id=effective_employee_id, event_type="resume")
    op.status = "bezi"
    rep.updated_at = now
    rep.updated_by = actor
    _audit(
        db,
        work_report_id=rep.id,
        action="pause_closed",
        actor=actor,
        details={"pause_id": open_p.id},
    )
    db.commit()
    return {"status": "ok", "work_report_id": rep.id, "operation_status": op.status}


def work_report_complete(
    db: Session,
    op: PlanningOperation,
    *,
    machine: Machine,
    employee_id: int | None,
    operator_display: str | None,
    qty_ok: int,
    qty_nok: int,
    note: str | None,
    source: str,
    actor: str | None = None,
) -> dict[str, Any]:
    _require_op_on_machine_row(db, machine, op)
    rep = _get_open_report(db, op.id)
    if not rep:
        raise HTTPException(status_code=409, detail="Neexistuje otevřený výkaz — nelze dokončit bez START.")
    effective_employee_id = int(employee_id) if employee_id is not None else (int(rep.employee_id) if rep.employee_id is not None else None)
    incoming_operator = (operator_display or "").strip() or None
    if rep.employee_id is None and effective_employee_id is not None:
        rep.employee_id = int(effective_employee_id)
    if incoming_operator and not (rep.operator_display or "").strip():
        rep.operator_display = incoming_operator
    now = _runtime_now()
    open_p = _get_open_pause(db, rep.id)
    if open_p:
        open_p.pause_end = now

    pauses = _list_pauses_for_report(db, rep.id)
    rep.ended_at = now
    rep.qty_ok = int(qty_ok or 0)
    rep.qty_nok = int(qty_nok or 0)
    rep.note = (note or None)
    rep.duration_min = _compute_duration_min(rep, pauses, now)
    rep.updated_at = now
    rep.updated_by = actor

    _maybe_operation_event(
        db,
        op=op,
        machine_id=machine.id,
        employee_id=effective_employee_id,
        event_type="done",
        qty_ok=rep.qty_ok,
        qty_nok=rep.qty_nok,
        note=note,
    )

    op.status = "hotovo"
    op.actual_end = now
    op.qty_ok = rep.qty_ok
    op.qty_nok = rep.qty_nok
    _recompute_po_status_from_planning_chain(db, op)

    next_op = db.scalar(
        select(PlanningOperation)
        .where(PlanningOperation.order_item_id == op.order_item_id)
        .where(PlanningOperation.operation_no > op.operation_no)
        .order_by(PlanningOperation.operation_no.asc())
    )
    next_operation_released = False
    if next_op:
        buffer_after_min = getattr(op, "buffer_after_min", 20) or 20
        release_time = now + timedelta(minutes=buffer_after_min)
        if hasattr(next_op, "released_at"):
            next_op.released_at = release_time
        next_op.status = "ready"
        next_operation_released = True

    db.flush()
    stock_effect = apply_kiosk_tp_stock_effect_on_operation_complete(db, op, qty_ok=int(rep.qty_ok or 0))
    PlanningEngineService(db).rebuild_global_schedules(date.today())

    _audit(
        db,
        work_report_id=rep.id,
        action="report_completed",
        actor=actor,
        details={"qty_ok": rep.qty_ok, "qty_nok": rep.qty_nok, "duration_min": rep.duration_min},
    )
    db.commit()
    db.refresh(rep)

    out: dict[str, Any] = {
        "status": "ok",
        "work_report_id": rep.id,
        "finished_operation_id": op.id,
        "qty_ok": rep.qty_ok,
        "qty_nok": rep.qty_nok,
        "next_operation_released": next_operation_released,
        "next_operation_id": next_op.id if next_op else None,
        "operation_status": op.status,
    }
    if stock_effect is not None:
        out["tp_stock_effect"] = stock_effect
    return out


def resolve_shopfloor_actor(operator_name: str | None, employee_id: int | None) -> str | None:
    if employee_id is not None:
        return f"employee:{employee_id}"
    if operator_name and operator_name.strip():
        return f"operator:{operator_name.strip()[:80]}"
    return "shopfloor:anonymous"
