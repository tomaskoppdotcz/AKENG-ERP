"""Popisky fáze výroby a postupu pro řádek položky zakázky (Položky zakázek)."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.master_data import Machine
from app.models.orders import ProductionOrder, ProductionOrderOperation
from app.models.planning import PlanningOperation
from app.services.business_workflow import workflow_record_active
from app.services.material_readiness import evaluate_production_order_material_released
from app.services.production_order_operation_runtime import (
    operation_nos_for_production_order,
    operation_statuses_for_production_order,
)

# Stejné jako frontend DrawingsPage — VP navázané na řádek zakázky.
VP_ROW_SOURCE_TYPES = frozenset({"stock_allocation", "order_allocation", "restock_allocation"})


def _normalize_wf(wf: str) -> str:
    w = (wf or "active").strip().lower()
    if w not in ("active", "cancelled", "all"):
        return "active"
    return w


def _po_matches_sidebar_filter(po: ProductionOrder, wf: str) -> bool:
    ok = workflow_record_active(po)
    if wf == "active":
        return ok
    if wf == "cancelled":
        return not ok
    return True


def _material_released_for_po(db: Session, po: ProductionOrder) -> bool:
    if not workflow_record_active(po):
        return True
    try:
        return bool(evaluate_production_order_material_released(db, po))
    except Exception:
        return bool(getattr(po, "is_material_released_to_production", False))


def _phase_and_progress_from_ops(entries: list[dict]) -> tuple[str, str]:
    """
    entries: { "wp": str, "st": planned|in_progress|done, "mat_ok": bool }
    mat_ok = může se začít (materiál uvolněn / ready).
    """
    if not entries:
        return "—", "—"
    total = len(entries)
    done_n = sum(1 for e in entries if e["st"] == "done")
    progress = f"{done_n} / {total}"

    for e in entries:
        if e["st"] == "in_progress":
            return f"{e['wp']} – běží", progress
    if done_n == total:
        return "Hotovo", progress

    any_started = done_n > 0 or any(e["st"] == "in_progress" for e in entries)
    if not any_started and any(not e.get("mat_ok", True) for e in entries):
        return "Čeká na materiál", progress

    for e in entries:
        if e["st"] != "done":
            return f"{e['wp']} – čeká", progress
    return "Hotovo", progress


def _entries_from_filtered_pos(db: Session, pos: list[ProductionOrder]) -> list[dict]:
    entries: list[dict] = []
    for po in pos:
        nos = operation_nos_for_production_order(db, po)
        if not nos:
            continue
        by_status, _, _ = operation_statuses_for_production_order(db, int(po.id), nos)
        op_rows = db.scalars(
            select(ProductionOrderOperation)
            .where(ProductionOrderOperation.production_order_id == int(po.id))
            .order_by(ProductionOrderOperation.operation_no.asc())
        ).all()
        row_by_no = {int(r.operation_no): r for r in op_rows}
        mat_ok = _material_released_for_po(db, po)
        for no in nos:
            st = str(by_status.get(int(no), {}).get("operation_status") or "planned")
            r = row_by_no.get(int(no))
            wp_raw = (r.workplace_name or "").strip() if r is not None else ""
            wp = wp_raw or "Pracoviště"
            entries.append({"wp": wp, "st": st, "mat_ok": mat_ok})
    return entries


def _normalize_planning_status(raw: str | None) -> str:
    s = (raw or "planned").strip().lower()
    if s in ("running", "in_progress", "bezi"):
        return "in_progress"
    if s in ("done", "finished", "hotovo", "completed"):
        return "done"
    return "planned"


def _entries_from_planning(db: Session, job_item_id: int) -> list[dict]:
    ops = db.scalars(
        select(PlanningOperation)
        .where(PlanningOperation.order_item_id == int(job_item_id))
        .order_by(PlanningOperation.operation_no.asc(), PlanningOperation.id.asc())
    ).all()
    if not ops:
        return []
    mids = {int(o.machine_id) for o in ops if o.machine_id is not None}
    machines: dict[int, Machine] = {}
    if mids:
        for m in db.scalars(select(Machine).where(Machine.id.in_(mids))).all():
            machines[int(m.id)] = m
    entries: list[dict] = []
    for o in ops:
        mid = int(o.machine_id) if o.machine_id is not None else None
        if mid is not None and mid in machines:
            wp = (machines[mid].name or "").strip() or "Stroj"
        else:
            wp = (o.operation_name or "").strip() or "Operace"
        st = _normalize_planning_status(o.status)
        mat_ok = bool(o.material_ready)
        entries.append({"wp": wp, "st": st, "mat_ok": mat_ok})
    return entries


def production_labels_for_job_item(db: Session, job_item_id: int, workflow_filter: str) -> tuple[str, str]:
    """
    Vrací (production_phase_label, production_progress_label) v češtině.
    """
    wf = _normalize_wf(workflow_filter)
    pos_all = db.scalars(
        select(ProductionOrder)
        .where(
            ProductionOrder.job_item_id == int(job_item_id),
            ProductionOrder.source_type.in_(VP_ROW_SOURCE_TYPES),
        )
        .order_by(ProductionOrder.id.asc())
    ).all()
    pos = [p for p in pos_all if _po_matches_sidebar_filter(p, wf)]

    vp_entries = _entries_from_filtered_pos(db, pos)
    if vp_entries:
        return _phase_and_progress_from_ops(vp_entries)

    pl_entries = _entries_from_planning(db, job_item_id)
    if pl_entries:
        return _phase_and_progress_from_ops(pl_entries)

    if pos:
        if all(str(p.status or "").strip().lower() == "done" for p in pos):
            return "Hotovo", "—"
        active = [p for p in pos if workflow_record_active(p)]
        if active and all(not _material_released_for_po(db, p) for p in active):
            return "Čeká na materiál", "—"
        return "VP bez operací", "—"

    return "Bez VP", "—"
