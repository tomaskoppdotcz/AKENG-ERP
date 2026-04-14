"""Manual CRUD for unified work reports, pauses, and audit trail."""

from __future__ import annotations

import json
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.api.deps import require_action
from app.core.database import get_db
from app.models.kiosk import Employee
from app.models.master_data import Machine
from app.models.master_libraries import WorkplaceLibraryItem
from app.models.orders import ProductionOrder
from app.models.planning import PlanningOperation
from app.models.work_report import WorkReport, WorkReportAuditLog, WorkReportPause
from app.services.kiosk_planner_queue import operation_on_same_planner_row_as_machine
from app.services.kiosk_work_report_service import (
    PAUSE_REASONS,
    SOURCE_MANUAL,
    refresh_report_duration_min,
    resolve_report_links,
    validate_pause_reason,
)

router = APIRouter()

_ALLOWED_SOURCES = frozenset({"manual", "pc_kiosk", "shopfloor_kiosk"})


def _actor_dep(x: Annotated[str | None, Header(alias="X-Akeng-Actor")] = None) -> str | None:
    a = (x or "").strip()
    return a or None


def _audit_row(
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
            actor=actor,
            details_json=json.dumps(details or {}, ensure_ascii=False, default=str),
            created_at=datetime.utcnow(),
        )
    )


def _row_to_pause(p: WorkReportPause) -> dict[str, Any]:
    return {
        "id": p.id,
        "work_report_id": p.work_report_id,
        "pause_start": p.pause_start.isoformat() if p.pause_start else None,
        "pause_end": p.pause_end.isoformat() if p.pause_end else None,
        "pause_reason": p.pause_reason,
        "note": p.note,
        "created_at": p.created_at.isoformat() if p.created_at else None,
    }


def _row_to_report(db: Session, r: WorkReport) -> dict[str, Any]:
    pauses = list(
        db.scalars(
            select(WorkReportPause)
            .where(WorkReportPause.work_report_id == r.id)
            .order_by(WorkReportPause.pause_start.asc())
        ).all()
    )
    return {
        "id": r.id,
        "employee_id": r.employee_id,
        "operator_display": r.operator_display,
        "customer_order_id": r.customer_order_id,
        "job_item_id": r.job_item_id,
        "production_order_id": r.production_order_id,
        "planning_operation_id": r.planning_operation_id,
        "machine_id": r.machine_id,
        "workplace_library_item_id": r.workplace_library_item_id,
        "operation_no": r.operation_no,
        "operation_name": r.operation_name,
        "started_at": r.started_at.isoformat() if r.started_at else None,
        "ended_at": r.ended_at.isoformat() if r.ended_at else None,
        "duration_min": r.duration_min,
        "qty_ok": r.qty_ok,
        "qty_nok": r.qty_nok,
        "note": r.note,
        "source": r.source,
        "kiosk_session_id": r.kiosk_session_id,
        "created_by": r.created_by,
        "updated_by": r.updated_by,
        "created_at": r.created_at.isoformat() if r.created_at else None,
        "updated_at": r.updated_at.isoformat() if r.updated_at else None,
        "pauses": [_row_to_pause(p) for p in pauses],
    }


def _get_open_report_for_op(db: Session, planning_operation_id: int) -> WorkReport | None:
    return db.scalar(
        select(WorkReport)
        .where(WorkReport.planning_operation_id == int(planning_operation_id))
        .where(WorkReport.ended_at.is_(None))
    )


def _close_open_pauses_for_report(db: Session, rep: WorkReport, end_time: datetime) -> None:
    for p in db.scalars(
        select(WorkReportPause).where(
            WorkReportPause.work_report_id == rep.id,
            WorkReportPause.pause_end.is_(None),
        )
    ).all():
        p.pause_end = end_time


class WorkReportCreate(BaseModel):
    planning_operation_id: int
    machine_id: int
    employee_id: int | None = None
    operator_display: str | None = None
    started_at: datetime
    ended_at: datetime | None = None
    qty_ok: int | None = None
    qty_nok: int | None = None
    note: str | None = None
    source: str = Field(default=SOURCE_MANUAL, max_length=30)


class WorkReportUpdate(BaseModel):
    employee_id: int | None = None
    operator_display: str | None = None
    machine_id: int | None = None
    planning_operation_id: int | None = None
    started_at: datetime | None = None
    ended_at: datetime | None = None
    qty_ok: int | None = None
    qty_nok: int | None = None
    note: str | None = None
    source: str | None = Field(default=None, max_length=30)


class WorkReportPauseCreate(BaseModel):
    pause_start: datetime
    pause_end: datetime | None = None
    pause_reason: str
    note: str | None = None


class WorkReportPauseUpdate(BaseModel):
    pause_start: datetime | None = None
    pause_end: datetime | None = None
    pause_reason: str | None = None
    note: str | None = None


@router.get("/pause-reasons")
def list_pause_reasons(
    _rbac: None = Depends(require_action("production.execute")),
):
    return {"pause_reasons": list(PAUSE_REASONS)}


@router.get("/context/planning-operations")
def context_planning_operations_for_vp(
    production_order_id: int = Query(..., gt=0),
    db: Session = Depends(get_db),
    _rbac: None = Depends(require_action("production.execute")),
):
    """
    Plánovací operace pro výrobní příkaz (WOO = vp_code nebo položka zakázky).
    Pro ruční výkazy — výběr operace bez zadávání technických ID.
    """
    po = db.get(ProductionOrder, int(production_order_id))
    if not po:
        raise HTTPException(status_code=404, detail="Výrobní příkaz nenalezen.")
    vp_code = (po.vp_code or "").strip()
    jid = po.job_item_id
    conds: list[Any] = []
    if vp_code:
        conds.append(PlanningOperation.work_order_no == vp_code)
    if jid is not None:
        conds.append(PlanningOperation.order_item_id == int(jid))
    if not conds:
        return {
            "production_order_id": int(po.id),
            "vp_code": po.vp_code,
            "job_item_id": po.job_item_id,
            "operations": [],
        }
    ops = list(
        db.scalars(
            select(PlanningOperation).where(or_(*conds)).order_by(PlanningOperation.operation_no.asc())
        ).all()
    )
    out: list[dict[str, Any]] = []
    for op in ops:
        m = db.get(Machine, int(op.machine_id)) if op.machine_id else None
        wp_name: str | None = None
        if op.workplace_library_item_id:
            wp = db.get(WorkplaceLibraryItem, int(op.workplace_library_item_id))
            wp_name = wp.name if wp else None
        out.append(
            {
                "planning_operation_id": int(op.id),
                "operation_no": int(op.operation_no or 0),
                "operation_name": str(op.operation_name or ""),
                "machine_id": int(op.machine_id),
                "machine_name": m.name if m else None,
                "machine_code": m.machine_code if m else None,
                "workplace_library_item_id": int(op.workplace_library_item_id)
                if op.workplace_library_item_id is not None
                else None,
                "workplace_name": wp_name,
                "status": str(op.status or ""),
                "work_order_no": op.work_order_no,
                "gpn": op.gpn,
            }
        )
    return {
        "production_order_id": int(po.id),
        "vp_code": po.vp_code,
        "job_item_id": po.job_item_id,
        "operations": out,
    }


@router.get("/context/production-order-for-planning-operation")
def context_production_order_for_planning_operation(
    planning_operation_id: int = Query(..., gt=0),
    db: Session = Depends(get_db),
    _rbac: None = Depends(require_action("production.execute")),
):
    """Dopočítá VP id z plánovací operace (pro starší výkazy bez production_order_id)."""
    op = db.get(PlanningOperation, int(planning_operation_id))
    if not op:
        raise HTTPException(status_code=404, detail="Plánovací operace nenalezena.")
    po: ProductionOrder | None = None
    woo = (op.work_order_no or "").strip()
    if woo:
        po = db.scalar(
            select(ProductionOrder)
            .where(ProductionOrder.vp_code == woo)
            .order_by(ProductionOrder.id.desc())
        )
    if po is None and op.order_item_id is not None:
        po = db.scalar(
            select(ProductionOrder)
            .where(ProductionOrder.job_item_id == int(op.order_item_id))
            .order_by(ProductionOrder.id.desc())
        )
    return {
        "production_order_id": int(po.id) if po else None,
        "vp_code": po.vp_code if po else (woo or None),
        "planning_operation_id": int(op.id),
    }


@router.get("")
def list_work_reports(
    db: Session = Depends(get_db),
    _rbac: None = Depends(require_action("production.execute")),
    planning_operation_id: int | None = Query(None),
    production_order_id: int | None = Query(None),
    machine_id: int | None = Query(None),
    employee_id: int | None = Query(None),
    open_only: bool = Query(False),
    limit: int = Query(200, ge=1, le=500),
):
    stmt = select(WorkReport).order_by(WorkReport.started_at.desc())
    if planning_operation_id is not None:
        stmt = stmt.where(WorkReport.planning_operation_id == int(planning_operation_id))
    if production_order_id is not None:
        stmt = stmt.where(WorkReport.production_order_id == int(production_order_id))
    if machine_id is not None:
        stmt = stmt.where(WorkReport.machine_id == int(machine_id))
    if employee_id is not None:
        stmt = stmt.where(WorkReport.employee_id == int(employee_id))
    if open_only:
        stmt = stmt.where(WorkReport.ended_at.is_(None))
    stmt = stmt.limit(limit)
    rows = list(db.scalars(stmt).all())
    return {"reports": [_row_to_report(db, r) for r in rows]}


@router.get("/{report_id}")
def get_work_report(
    report_id: int,
    db: Session = Depends(get_db),
    _rbac: None = Depends(require_action("production.execute")),
):
    r = db.get(WorkReport, int(report_id))
    if not r:
        raise HTTPException(status_code=404, detail="Výkaz nenalezen.")
    return _row_to_report(db, r)


@router.get("/{report_id}/audit")
def list_work_report_audit(
    report_id: int,
    db: Session = Depends(get_db),
    _rbac: None = Depends(require_action("production.execute")),
):
    r = db.get(WorkReport, int(report_id))
    if not r:
        raise HTTPException(status_code=404, detail="Výkaz nenalezen.")
    logs = list(
        db.scalars(
            select(WorkReportAuditLog)
            .where(WorkReportAuditLog.work_report_id == int(report_id))
            .order_by(WorkReportAuditLog.created_at.desc())
        ).all()
    )
    out = []
    for row in logs:
        details: Any = None
        if row.details_json:
            try:
                details = json.loads(row.details_json)
            except json.JSONDecodeError:
                details = row.details_json
        out.append(
            {
                "id": row.id,
                "action": row.action,
                "actor": row.actor,
                "created_at": row.created_at.isoformat() if row.created_at else None,
                "details": details,
            }
        )
    return {"audit": out}


@router.post("")
def create_work_report(
    payload: WorkReportCreate,
    db: Session = Depends(get_db),
    _rbac: None = Depends(require_action("production.execute")),
    actor: str | None = Depends(_actor_dep),
):
    src = (payload.source or SOURCE_MANUAL).strip()
    if src not in _ALLOWED_SOURCES:
        raise HTTPException(status_code=422, detail="Neplatný zdroj výkazu.")

    op = db.get(PlanningOperation, int(payload.planning_operation_id))
    if not op:
        raise HTTPException(status_code=404, detail="Plánovací operace nenalezena.")
    machine = db.get(Machine, int(payload.machine_id))
    if not machine:
        raise HTTPException(status_code=404, detail="Stroj nenalezen.")
    if not operation_on_same_planner_row_as_machine(db, op, machine):
        raise HTTPException(
            status_code=400,
            detail="Operace nepatří na stejný řádek Planneru jako zvolený stroj.",
        )

    if _get_open_report_for_op(db, op.id):
        raise HTTPException(
            status_code=409,
            detail="Pro tuto operaci už existuje otevřený výkaz — nejdřív ho uzavřete nebo upravte.",
        )

    if payload.employee_id is not None:
        emp = db.get(Employee, int(payload.employee_id))
        if not emp:
            raise HTTPException(status_code=404, detail="Zaměstnanec nenalezen.")

    links = resolve_report_links(db, op)
    now = datetime.utcnow()
    rep = WorkReport(
        employee_id=payload.employee_id,
        operator_display=(payload.operator_display or None),
        customer_order_id=links["customer_order_id"],
        job_item_id=links["job_item_id"],
        production_order_id=links["production_order_id"],
        planning_operation_id=int(op.id),
        machine_id=int(machine.id),
        workplace_library_item_id=links["workplace_library_item_id"],
        operation_no=int(op.operation_no or 0),
        operation_name=str(op.operation_name or "")[:200],
        started_at=payload.started_at,
        ended_at=payload.ended_at,
        duration_min=None,
        qty_ok=payload.qty_ok,
        qty_nok=payload.qty_nok,
        note=(payload.note or None),
        source=src,
        kiosk_session_id=None,
        created_by=actor,
        updated_by=actor,
        created_at=now,
        updated_at=now,
    )
    db.add(rep)
    db.flush()
    if rep.ended_at:
        _close_open_pauses_for_report(db, rep, rep.ended_at)
        refresh_report_duration_min(db, rep)
    _audit_row(
        db,
        work_report_id=rep.id,
        action="manual_report_created",
        actor=actor,
        details={"fields": payload.model_dump()},
    )
    db.commit()
    db.refresh(rep)
    return _row_to_report(db, rep)


@router.patch("/{report_id}")
def update_work_report(
    report_id: int,
    payload: WorkReportUpdate,
    db: Session = Depends(get_db),
    _rbac: None = Depends(require_action("production.execute")),
    actor: str | None = Depends(_actor_dep),
):
    rep = db.get(WorkReport, int(report_id))
    if not rep:
        raise HTTPException(status_code=404, detail="Výkaz nenalezen.")

    before = _row_to_report(db, rep)
    data = payload.model_dump(exclude_unset=True)

    if "source" in data and data["source"] is not None:
        if data["source"] not in _ALLOWED_SOURCES:
            raise HTTPException(status_code=422, detail="Neplatný zdroj výkazu.")

    if "planning_operation_id" in data and data["planning_operation_id"] is not None:
        op_new = db.get(PlanningOperation, int(data["planning_operation_id"]))
        if not op_new:
            raise HTTPException(status_code=404, detail="Plánovací operace nenalezena.")
        rep.planning_operation_id = int(op_new.id)
        links = resolve_report_links(db, op_new)
        rep.customer_order_id = links["customer_order_id"]
        rep.job_item_id = links["job_item_id"]
        rep.production_order_id = links["production_order_id"]
        rep.workplace_library_item_id = links["workplace_library_item_id"]
        rep.operation_no = int(op_new.operation_no or 0)
        rep.operation_name = str(op_new.operation_name or "")[:200]

    if "machine_id" in data and data["machine_id"] is not None:
        m = db.get(Machine, int(data["machine_id"]))
        if not m:
            raise HTTPException(status_code=404, detail="Stroj nenalezen.")
        op_chk = db.get(PlanningOperation, int(rep.planning_operation_id))
        if not op_chk:
            raise HTTPException(status_code=400, detail="Chybí plánovací operace u výkazu.")
        if not operation_on_same_planner_row_as_machine(db, op_chk, m):
            raise HTTPException(
                status_code=400,
                detail="Operace nepatří na stejný řádek Planneru jako zvolený stroj.",
            )
        rep.machine_id = int(m.id)

    if "employee_id" in data:
        eid = data["employee_id"]
        if eid is not None:
            emp = db.get(Employee, int(eid))
            if not emp:
                raise HTTPException(status_code=404, detail="Zaměstnanec nenalezen.")
        rep.employee_id = eid

    if "operator_display" in data:
        rep.operator_display = data["operator_display"]
    if "started_at" in data and data["started_at"] is not None:
        rep.started_at = data["started_at"]
    if "ended_at" in data:
        rep.ended_at = data["ended_at"]
    if "qty_ok" in data:
        rep.qty_ok = data["qty_ok"]
    if "qty_nok" in data:
        rep.qty_nok = data["qty_nok"]
    if "note" in data:
        rep.note = data["note"]
    if "source" in data and data["source"] is not None:
        rep.source = data["source"]

    if rep.ended_at and rep.started_at and rep.ended_at < rep.started_at:
        raise HTTPException(status_code=422, detail="ended_at musí být po started_at.")

    if rep.ended_at:
        _close_open_pauses_for_report(db, rep, rep.ended_at)
        refresh_report_duration_min(db, rep)
    else:
        rep.duration_min = None

    rep.updated_at = datetime.utcnow()
    rep.updated_by = actor

    after = _row_to_report(db, rep)
    _audit_row(
        db,
        work_report_id=rep.id,
        action="manual_report_updated",
        actor=actor,
        details={"before": before, "after": after, "patch": data},
    )
    db.commit()
    db.refresh(rep)
    return _row_to_report(db, rep)


@router.delete("/{report_id}")
def delete_work_report(
    report_id: int,
    db: Session = Depends(get_db),
    _rbac: None = Depends(require_action("production.execute")),
    actor: str | None = Depends(_actor_dep),
):
    rep = db.get(WorkReport, int(report_id))
    if not rep:
        raise HTTPException(status_code=404, detail="Výkaz nenalezen.")
    snap = _row_to_report(db, rep)
    rid = int(rep.id)
    _audit_row(
        db,
        work_report_id=rid,
        action="report_deleted",
        actor=actor,
        details={"snapshot": snap},
    )
    db.delete(rep)
    db.commit()
    return {"status": "ok", "deleted_id": rid}


@router.post("/{report_id}/pauses")
def create_pause(
    report_id: int,
    payload: WorkReportPauseCreate,
    db: Session = Depends(get_db),
    _rbac: None = Depends(require_action("production.execute")),
    actor: str | None = Depends(_actor_dep),
):
    rep = db.get(WorkReport, int(report_id))
    if not rep:
        raise HTTPException(status_code=404, detail="Výkaz nenalezen.")
    reason = validate_pause_reason(payload.pause_reason)
    now = datetime.utcnow()
    p = WorkReportPause(
        work_report_id=rep.id,
        pause_start=payload.pause_start,
        pause_end=payload.pause_end,
        pause_reason=reason,
        note=(payload.note or None),
        created_at=now,
    )
    db.add(p)
    rep.updated_at = now
    rep.updated_by = actor
    db.flush()
    if rep.ended_at:
        refresh_report_duration_min(db, rep)
    _audit_row(
        db,
        work_report_id=rep.id,
        action="pause_created",
        actor=actor,
        details={"pause": _row_to_pause(p)},
    )
    db.commit()
    db.refresh(p)
    return _row_to_pause(p)


@router.patch("/{report_id}/pauses/{pause_id}")
def update_pause(
    report_id: int,
    pause_id: int,
    payload: WorkReportPauseUpdate,
    db: Session = Depends(get_db),
    _rbac: None = Depends(require_action("production.execute")),
    actor: str | None = Depends(_actor_dep),
):
    rep = db.get(WorkReport, int(report_id))
    if not rep:
        raise HTTPException(status_code=404, detail="Výkaz nenalezen.")
    p = db.get(WorkReportPause, int(pause_id))
    if not p or int(p.work_report_id) != int(report_id):
        raise HTTPException(status_code=404, detail="Přestávka nenalezena.")

    before = _row_to_pause(p)
    data = payload.model_dump(exclude_unset=True)
    if "pause_reason" in data and data["pause_reason"] is not None:
        p.pause_reason = validate_pause_reason(data["pause_reason"])
    if "pause_start" in data and data["pause_start"] is not None:
        p.pause_start = data["pause_start"]
    if "pause_end" in data:
        p.pause_end = data["pause_end"]
    if "note" in data:
        p.note = data["note"]

    if p.pause_end and p.pause_start and p.pause_end < p.pause_start:
        raise HTTPException(status_code=422, detail="pause_end musí být po pause_start.")

    now = datetime.utcnow()
    rep.updated_at = now
    rep.updated_by = actor
    if rep.ended_at:
        refresh_report_duration_min(db, rep)
    _audit_row(
        db,
        work_report_id=rep.id,
        action="pause_updated",
        actor=actor,
        details={"before": before, "after": _row_to_pause(p), "patch": data},
    )
    db.commit()
    db.refresh(p)
    return _row_to_pause(p)


@router.delete("/{report_id}/pauses/{pause_id}")
def delete_pause(
    report_id: int,
    pause_id: int,
    db: Session = Depends(get_db),
    _rbac: None = Depends(require_action("production.execute")),
    actor: str | None = Depends(_actor_dep),
):
    rep = db.get(WorkReport, int(report_id))
    if not rep:
        raise HTTPException(status_code=404, detail="Výkaz nenalezen.")
    p = db.get(WorkReportPause, int(pause_id))
    if not p or int(p.work_report_id) != int(report_id):
        raise HTTPException(status_code=404, detail="Přestávka nenalezena.")
    snap = _row_to_pause(p)
    db.delete(p)
    now = datetime.utcnow()
    rep.updated_at = now
    rep.updated_by = actor
    if rep.ended_at:
        refresh_report_duration_min(db, rep)
    _audit_row(
        db,
        work_report_id=rep.id,
        action="pause_deleted",
        actor=actor,
        details={"snapshot": snap},
    )
    db.commit()
    return {"status": "ok", "deleted_pause_id": int(pause_id)}
