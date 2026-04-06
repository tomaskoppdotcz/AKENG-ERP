"""
TP-driven material reservations are working/derived data: supersede or cancel when business objects change.
Active pipeline for requirements: status planned | reserved + is_active (see MATERIAL_RESERVATION_ACTIVE_STATUSES).
Terminal: issued (stock history OK), superseded (replaced by newer TP auto), cancelled (PO/job gone or ineligible).
"""

from __future__ import annotations

import logging
from typing import Any

from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from app.models.material_stock import MaterialReservation, MaterialStockItem
from app.models.orders import CustomerOrder, Job, JobItem, ProductionOrder
from app.models.portfolio import PortfolioTechnologyTemplate
from app.services.business_workflow import workflow_active_sql, workflow_record_active

logger = logging.getLogger(__name__)

# "Active" for availability + material requirements (not the literal DB value "active")
MATERIAL_RESERVATION_ACTIVE_STATUSES: frozenset[str] = frozenset({"planned", "reserved"})


def sum_eligible_reserved_qty_for_material(
    db: Session,
    material_library_item_id: int,
    *,
    exclude_reservation_id: int | None = None,
) -> float:
    """
    Součet reserved_qty jen u rezervací, které vstupují do požadavků (aktivní VP, položka, zakázka).
    Shodné filtry jako material_requirements_query — bez „mrtvých“ řádků blokujících sklad.
    """
    mr = MaterialReservation
    stmt = (
        select(func.coalesce(func.sum(mr.reserved_qty), 0.0))
        .select_from(mr)
        .join(ProductionOrder, ProductionOrder.id == mr.production_order_id)
        .join(
            JobItem,
            and_(
                JobItem.id == mr.job_item_id,
                JobItem.id == ProductionOrder.job_item_id,
            ),
        )
        .join(Job, Job.id == JobItem.job_id)
        .outerjoin(CustomerOrder, CustomerOrder.id == Job.customer_order_id)
        .where(
            mr.material_library_item_id == int(material_library_item_id),
            mr.status.in_(tuple(MATERIAL_RESERVATION_ACTIVE_STATUSES)),
            mr.is_active.is_(True),
            workflow_active_sql(ProductionOrder.workflow_status),
            workflow_active_sql(JobItem.workflow_status),
            or_(
                Job.customer_order_id.is_(None),
                and_(CustomerOrder.id.isnot(None), workflow_active_sql(CustomerOrder.workflow_status)),
            ),
        )
    )
    if exclude_reservation_id is not None:
        stmt = stmt.where(mr.id != int(exclude_reservation_id))
    return float(db.scalar(stmt) or 0.0)


def enforce_material_reservation_stock_ceiling(db: Session) -> dict[str, Any]:
    """
    Po přepočtech: součet eligible reserved_qty na materiál nesmí překročit skutečný stav skladu.
    Převis se odebírá od nejnovějších rezervací (vyšší id).
    """
    mr = MaterialReservation
    rows = db.scalars(
        select(mr)
        .join(ProductionOrder, ProductionOrder.id == mr.production_order_id)
        .join(
            JobItem,
            and_(
                JobItem.id == mr.job_item_id,
                JobItem.id == ProductionOrder.job_item_id,
            ),
        )
        .join(Job, Job.id == JobItem.job_id)
        .outerjoin(CustomerOrder, CustomerOrder.id == Job.customer_order_id)
        .where(
            mr.status.in_(tuple(MATERIAL_RESERVATION_ACTIVE_STATUSES)),
            mr.is_active.is_(True),
            workflow_active_sql(ProductionOrder.workflow_status),
            workflow_active_sql(JobItem.workflow_status),
            or_(
                Job.customer_order_id.is_(None),
                and_(CustomerOrder.id.isnot(None), workflow_active_sql(CustomerOrder.workflow_status)),
            ),
        )
        .order_by(mr.material_library_item_id.asc(), mr.id.asc())
    ).all()
    by_mid: dict[int, list[MaterialReservation]] = {}
    for r in rows:
        mid = int(r.material_library_item_id)
        by_mid.setdefault(mid, []).append(r)

    materials_capped = 0
    rows_adjusted = 0
    po_ids: set[int] = set()
    for mid, lst in by_mid.items():
        stock = float(
            db.scalar(
                select(func.coalesce(func.sum(MaterialStockItem.current_qty), 0.0)).where(
                    MaterialStockItem.material_library_item_id == mid
                )
            )
            or 0.0
        )
        total_r = sum(float(x.reserved_qty or 0.0) for x in lst)
        if total_r <= stock + 1e-6:
            continue
        materials_capped += 1
        excess = total_r - stock
        logger.warning(
            "[material_reservation] stock_ceiling material_library_item_id=%s stock=%s reserved_total=%s excess=%s",
            mid,
            stock,
            total_r,
            excess,
        )
        for r in reversed(lst):
            if excess <= 1e-9:
                break
            rq = float(r.reserved_qty or 0.0)
            if rq <= 1e-9:
                continue
            cut = min(rq, excess)
            r.reserved_qty = rq - cut
            excess -= cut
            rows_adjusted += 1
            po_ids.add(int(r.production_order_id))
            if r.reserved_qty <= 1e-9:
                r.reserved_qty = 0.0
                r.status = "planned"
            else:
                r.status = "reserved"
            db.flush()

    if po_ids:
        from app.services.material_readiness import refresh_material_readiness_for_production_order_ids

        refresh_material_readiness_for_production_order_ids(db, po_ids)

    out = {
        "materials_capped": materials_capped,
        "rows_adjusted": rows_adjusted,
    }
    if materials_capped:
        logger.info("[material_reservation_sync] enforce_stock_ceiling %s", out)
    return out


def tp_auto_note_matches_vp(note: str | None, vp_code: str) -> bool:
    """Match 'Auto from {vp_code}' without colliding VP-1 vs VP-10."""
    if not note or not vp_code:
        return False
    p = f"Auto from {str(vp_code).strip()}"
    s = str(note).strip()
    return s == p or s.startswith(p + " | ")


def supersede_active_tp_auto_for_po(db: Session, po: ProductionOrder) -> int:
    """Mark active TP-auto reservations for this VP as superseded (never touches issued)."""
    vp = po.vp_code or ""
    n = 0
    rows = db.scalars(
        select(MaterialReservation).where(
            MaterialReservation.production_order_id == int(po.id),
            MaterialReservation.status.in_(tuple(MATERIAL_RESERVATION_ACTIVE_STATUSES)),
            MaterialReservation.is_active.is_(True),
        )
    ).all()
    for r in rows:
        if str(r.status or "").lower() == "issued":
            continue
        if not tp_auto_note_matches_vp(r.note, vp):
            continue
        r.status = "superseded"
        r.is_active = False
        cur = (r.note or "").strip()
        r.note = (cur + " | superseded (TP auto refresh)") if cur else f"Auto from {vp} | superseded (TP auto refresh)"
        n += 1
    if n:
        logger.info("[material_reservation_sync] superseded %s TP-auto rows for po_id=%s vp=%s", n, po.id, vp)
    db.flush()
    return n


def cancel_active_reservations_for_production_order(
    db: Session,
    production_order_id: int,
    *,
    reason: str,
) -> int:
    """Cancel planned/reserved active rows for a PO; issued and movements stay intact."""
    n = 0
    rows = db.scalars(
        select(MaterialReservation).where(
            MaterialReservation.production_order_id == int(production_order_id),
            MaterialReservation.status.in_(tuple(MATERIAL_RESERVATION_ACTIVE_STATUSES)),
            MaterialReservation.is_active.is_(True),
        )
    ).all()
    for r in rows:
        if str(r.status or "").lower() == "issued":
            continue
        r.status = "cancelled"
        r.is_active = False
        cur = (r.note or "").strip()
        suf = f" | cancelled ({reason})"
        r.note = (cur + suf) if cur else suf.strip()
        n += 1
    if n:
        logger.info(
            "[material_reservation_sync] cancelled %s reservations for po_id=%s reason=%s",
            n,
            production_order_id,
            reason,
        )
    db.flush()
    return n


def cancel_tp_auto_for_ineligible_po(db: Session, po: ProductionOrder, *, reason: str) -> int:
    """Only TP-auto rows; keep possible manual/other notes on the same PO."""
    vp = po.vp_code or ""
    n = 0
    rows = db.scalars(
        select(MaterialReservation).where(
            MaterialReservation.production_order_id == int(po.id),
            MaterialReservation.status.in_(tuple(MATERIAL_RESERVATION_ACTIVE_STATUSES)),
            MaterialReservation.is_active.is_(True),
        )
    ).all()
    for r in rows:
        if not tp_auto_note_matches_vp(r.note, vp):
            continue
        r.status = "cancelled"
        r.is_active = False
        cur = (r.note or "").strip()
        suf = f" | cancelled ({reason})"
        r.note = (cur + suf) if cur else suf.strip()
        n += 1
    db.flush()
    return n


def cancel_reservations_for_job_item(db: Session, job_item_id: int, *, reason: str) -> int:
    total = 0
    rows = db.scalars(
        select(MaterialReservation).where(MaterialReservation.job_item_id == int(job_item_id))
    ).all()
    for r in rows:
        st = str(r.status or "").lower()
        if st == "issued":
            continue
        if st in {"superseded", "cancelled"}:
            continue
        r.status = "cancelled"
        r.is_active = False
        cur = (r.note or "").strip()
        suf = f" | cancelled ({reason})"
        r.note = (cur + suf) if cur else suf.strip()
        total += 1
    if total:
        logger.info(
            "[material_reservation_sync] cancelled %s reservations for job_item_id=%s reason=%s",
            total,
            job_item_id,
            reason,
        )
    db.flush()
    return total


def _workflow_blocks_tp_rebuild(db: Session, po: ProductionOrder) -> str | None:
    if not workflow_record_active(po):
        return "production_order_workflow_inactive"
    if po.job_item_id is None:
        return None
    ji = db.get(JobItem, int(po.job_item_id))
    if ji is None:
        return None
    if not workflow_record_active(ji):
        return "job_item_workflow_inactive"
    job = db.get(Job, int(ji.job_id)) if ji.job_id is not None else None
    if job is None or job.customer_order_id is None:
        return None
    co = db.get(CustomerOrder, int(job.customer_order_id))
    if co is not None and not workflow_record_active(co):
        return "customer_order_workflow_inactive"
    return None


def rebuild_tp_material_reservations_for_production_order(db: Session, po: ProductionOrder) -> dict[str, Any]:
    from app.services.material_readiness import refresh_production_order_material_readiness

    block = _workflow_blocks_tp_rebuild(db, po)
    if block:
        n = cancel_tp_auto_for_ineligible_po(db, po, reason=block)
        refresh_production_order_material_readiness(db, po)
        return {
            "production_order_id": int(po.id),
            "vp_code": po.vp_code,
            "cancelled_tp_auto_rows": n,
            "skipped": block,
        }
    supersede_active_tp_auto_for_po(db, po)
    from app.api.orders import _create_material_reservations_for_po

    _create_material_reservations_for_po(
        db,
        po=po,
        portfolio_item_id=int(po.portfolio_item_id) if po.portfolio_item_id is not None else None,
        quantity=int(po.quantity or 0),
    )
    refresh_production_order_material_readiness(db, po)
    return {
        "production_order_id": int(po.id),
        "vp_code": po.vp_code,
    }


def rebuild_all_tp_material_reservations(db: Session) -> dict[str, Any]:
    from app.services.material_readiness import refresh_production_order_material_readiness

    eligible_modes = {"vyroba_zakaznik", "sklad"}
    pos = db.scalars(select(ProductionOrder).order_by(ProductionOrder.id.asc())).all()
    out: dict[str, Any] = {
        "production_orders_rebuilt": 0,
        "production_orders_tp_auto_cancelled_ineligible": 0,
    }
    for po in pos:
        block = _workflow_blocks_tp_rebuild(db, po)
        if block:
            out["production_orders_tp_auto_cancelled_ineligible"] += cancel_tp_auto_for_ineligible_po(
                db,
                po,
                reason=block,
            )
            refresh_production_order_material_readiness(db, po)
            continue
        mode = str(po.logistic_mode or "").strip()
        ji_ok = po.job_item_id is not None and db.get(JobItem, int(po.job_item_id)) is not None
        if mode in eligible_modes and ji_ok and po.portfolio_item_id is not None:
            rebuild_tp_material_reservations_for_production_order(db, po)
            out["production_orders_rebuilt"] += 1
        else:
            out["production_orders_tp_auto_cancelled_ineligible"] += cancel_tp_auto_for_ineligible_po(
                db,
                po,
                reason="po_ineligible_or_missing_job_item_portfolio",
            )
            refresh_production_order_material_readiness(db, po)
    logger.info("[material_reservation_sync] rebuild_all %s", out)
    return out


def rebuild_tp_material_reservations_for_technology_template(db: Session, template_id: int) -> dict[str, Any]:
    """Rebuild TP-auto reservations for all VPs tied to the portfolio item of this technology template."""
    tpl = db.get(PortfolioTechnologyTemplate, int(template_id))
    if tpl is None:
        return {"template_id": int(template_id), "error": "template_not_found", "production_orders": []}
    pid = int(tpl.portfolio_item_id)
    pos = db.scalars(
        select(ProductionOrder)
        .where(ProductionOrder.portfolio_item_id == pid)
        .order_by(ProductionOrder.id.asc())
    ).all()
    details: list[dict[str, Any]] = []
    for po in pos:
        details.append(rebuild_tp_material_reservations_for_production_order(db, po))
    logger.info(
        "[material_reservation_sync] template_rebuild template_id=%s portfolio_item_id=%s production_orders=%s",
        int(template_id),
        pid,
        len(pos),
    )
    return {
        "template_id": int(template_id),
        "portfolio_item_id": pid,
        "production_orders": details,
    }


def rebuild_tp_material_reservations_for_job_item(db: Session, job_item_id: int) -> dict[str, Any]:
    from app.services.material_readiness import refresh_production_order_material_readiness

    ji = db.get(JobItem, int(job_item_id))
    pos = db.scalars(
        select(ProductionOrder)
        .where(ProductionOrder.job_item_id == int(job_item_id))
        .order_by(ProductionOrder.id.asc())
    ).all()
    details = []
    if ji is not None and not workflow_record_active(ji):
        for po in pos:
            n = cancel_tp_auto_for_ineligible_po(db, po, reason="job_item_workflow_inactive")
            refresh_production_order_material_readiness(db, po)
            details.append(
                {
                    "action": "cancelled_tp_auto",
                    "production_order_id": int(po.id),
                    "vp_code": po.vp_code,
                    "rows": n,
                }
            )
        return {"job_item_id": int(job_item_id), "production_orders": details}
    for po in pos:
        mode = str(po.logistic_mode or "").strip()
        ji_ok = po.job_item_id is not None and db.get(JobItem, int(po.job_item_id)) is not None
        if mode in {"vyroba_zakaznik", "sklad"} and ji_ok and po.portfolio_item_id is not None:
            d = rebuild_tp_material_reservations_for_production_order(db, po)
            details.append({"action": "rebuilt", **d})
        else:
            n = cancel_tp_auto_for_ineligible_po(db, po, reason="job_item_rebuild_ineligible_po")
            refresh_production_order_material_readiness(db, po)
            details.append(
                {
                    "action": "cancelled_tp_auto",
                    "production_order_id": int(po.id),
                    "vp_code": po.vp_code,
                    "rows": n,
                }
            )
    return {"job_item_id": int(job_item_id), "production_orders": details}
