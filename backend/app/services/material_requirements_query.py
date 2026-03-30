"""Shared queries for material requirements (by material and by VP)."""

from __future__ import annotations

import logging
from collections import defaultdict
from typing import Any

from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from app.models.material_library import MaterialLibraryItem
from app.models.material_stock import MaterialReservation, MaterialStockItem
from app.models.orders import CustomerOrder, Job, JobItem, ProductionOrder
from app.services.business_workflow import workflow_active_sql
from app.services.material_reservation_sync import MATERIAL_RESERVATION_ACTIVE_STATUSES

logger = logging.getLogger(__name__)


def _material_requirements_bundle(db: Session) -> dict[str, Any] | None:
    """
    Returns intermediate structures for both list endpoints, or None if no active requirements.
    """
    mr = MaterialReservation
    base_sq = (
        select(
            mr.id.label("rid"),
            mr.material_library_item_id.label("mid"),
            mr.production_order_id.label("poid"),
            mr.job_item_id.label("jiid"),
            func.max(mr.required_qty).label("rq"),
            func.max(mr.reserved_qty).label("rs"),
        )
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
        .join(MaterialLibraryItem, MaterialLibraryItem.id == mr.material_library_item_id)
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
        .group_by(mr.id, mr.material_library_item_id, mr.production_order_id, mr.job_item_id)
    ).subquery()

    agg_rows = db.execute(
        select(
            base_sq.c.mid.label("material_library_item_id"),
            func.coalesce(func.sum(base_sq.c.rq), 0.0).label("required_qty"),
            func.coalesce(func.sum(base_sq.c.rs), 0.0).label("reserved_qty"),
        )
        .group_by(base_sq.c.mid)
        .order_by(base_sq.c.mid.asc())
    ).all()
    if not agg_rows:
        return None

    mat_ids = [int(r.material_library_item_id) for r in agg_rows]
    mats = db.scalars(select(MaterialLibraryItem).where(MaterialLibraryItem.id.in_(mat_ids))).all()
    mat_by_id = {int(m.id): m for m in mats}

    stock_rows = db.execute(
        select(
            MaterialStockItem.material_library_item_id,
            func.coalesce(func.sum(MaterialStockItem.current_qty), 0.0),
        )
        .where(MaterialStockItem.material_library_item_id.in_(mat_ids))
        .group_by(MaterialStockItem.material_library_item_id)
    ).all()
    available_by_material = {int(mid): float(q or 0.0) for mid, q in stock_rows}

    detail_rows_raw = db.execute(
        select(mr, ProductionOrder, JobItem, Job)
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
        .join(MaterialLibraryItem, MaterialLibraryItem.id == mr.material_library_item_id)
        .outerjoin(CustomerOrder, CustomerOrder.id == Job.customer_order_id)
        .where(
            mr.material_library_item_id.in_(mat_ids),
            mr.status.in_(tuple(MATERIAL_RESERVATION_ACTIVE_STATUSES)),
            mr.is_active.is_(True),
            workflow_active_sql(ProductionOrder.workflow_status),
            workflow_active_sql(JobItem.workflow_status),
            or_(
                Job.customer_order_id.is_(None),
                and_(CustomerOrder.id.isnot(None), workflow_active_sql(CustomerOrder.workflow_status)),
            ),
        )
        .order_by(mr.material_library_item_id.asc(), ProductionOrder.id.asc(), mr.id.asc())
    ).all()

    seen_rid: set[int] = set()
    detail_rows: list = []
    for row in detail_rows_raw:
        rr = row[0]
        if int(rr.id) in seen_rid:
            continue
        seen_rid.add(int(rr.id))
        detail_rows.append(row)

    included_ids: set[int] = set()
    for dbg in db.execute(
        select(
            base_sq.c.rid,
            base_sq.c.mid,
            base_sq.c.poid,
            base_sq.c.jiid,
            base_sq.c.rq,
            MaterialLibraryItem.code,
        )
        .select_from(base_sq)
        .join(MaterialLibraryItem, MaterialLibraryItem.id == base_sq.c.mid)
    ).all():
        included_ids.add(int(dbg.rid))
        logger.info(
            "[material_requirements] included reservation_id=%s material_id=%s material_code=%s "
            "production_order_id=%s job_item_id=%s required_qty=%s",
            int(dbg.rid),
            int(dbg.mid),
            dbg.code,
            int(dbg.poid),
            int(dbg.jiid),
            float(dbg.rq or 0.0),
        )

    stale = db.scalars(
        select(mr).where(
            mr.is_active.is_(True),
            mr.status.in_(tuple(MATERIAL_RESERVATION_ACTIVE_STATUSES)),
        )
    ).all()
    for s in stale:
        if int(s.id) in included_ids:
            continue
        logger.info(
            "[material_requirements] excluded reservation_id=%s material_library_item_id=%s "
            "production_order_id=%s job_item_id=%s required_qty=%s (active but failed validity join)",
            int(s.id),
            int(s.material_library_item_id),
            int(s.production_order_id),
            int(s.job_item_id),
            float(s.required_qty or 0.0),
        )

    co_ids = sorted(
        {int(job.customer_order_id) for *_, job in detail_rows if job.customer_order_id is not None}
    )
    co_by_id: dict[int, CustomerOrder] = {}
    if co_ids:
        cos = db.scalars(select(CustomerOrder).where(CustomerOrder.id.in_(co_ids))).all()
        co_by_id = {int(o.id): o for o in cos}

    merged: dict[tuple[int, int], dict] = {}
    for rr, po, ji, job in detail_rows:
        mid = int(rr.material_library_item_id)
        pid = int(po.id)
        key = (mid, pid)
        co = co_by_id.get(int(job.customer_order_id)) if job.customer_order_id is not None else None
        if key not in merged:
            merged[key] = {
                "production_order_id": pid,
                "vp_code": po.vp_code,
                "job_item_id": int(po.job_item_id) if po.job_item_id is not None else None,
                "customer_order_id": int(co.id) if co is not None else None,
                "zakazka": job.zak_code,
                "gpn": ji.gpn if ji is not None else po.gpn,
                "_lines": [],
            }
        merged[key]["_lines"].append(
            {
                "reservation_id": int(rr.id),
                "required_qty": float(rr.required_qty or 0.0),
                "reserved_qty": float(rr.reserved_qty or 0.0),
                "status": rr.status,
            }
        )

    return {
        "agg_rows": agg_rows,
        "mat_by_id": mat_by_id,
        "available_by_material": available_by_material,
        "merged": merged,
        "detail_rows": detail_rows,
        "co_by_id": co_by_id,
    }


def _merged_to_related_by_material(merged: dict[tuple[int, int], dict]) -> dict[int, list[dict]]:
    related_by_material: dict[int, list[dict]] = defaultdict(list)
    for (mid, _pid), payload in sorted(merged.items(), key=lambda kv: (kv[0][0], kv[1].get("vp_code") or "")):
        lines = sorted(payload["_lines"], key=lambda ln: int(ln["reservation_id"]))
        req_sum = sum(float(ln["required_qty"]) for ln in lines)
        res_sum = sum(float(ln["reserved_qty"]) for ln in lines)
        ids = [int(ln["reservation_id"]) for ln in lines]
        st = lines[0]["status"]
        row_out = {k: v for k, v in payload.items() if k != "_lines"}
        row_out["required_qty"] = req_sum
        row_out["reserved_qty"] = res_sum
        row_out["reservation_id"] = ids[0]
        row_out["reservation_ids"] = ids
        row_out["reservation_count"] = len(lines)
        row_out["reservation_lines"] = lines
        row_out["status"] = st
        related_by_material[mid].append(row_out)
    return related_by_material


def build_standard_material_requirements(db: Session) -> list[dict]:
    b = _material_requirements_bundle(db)
    if b is None:
        return []
    agg_rows = b["agg_rows"]
    mat_by_id = b["mat_by_id"]
    available_by_material = b["available_by_material"]
    merged = b["merged"]
    related_by_material = _merged_to_related_by_material(merged)

    out: list[dict] = []
    for row in agg_rows:
        material_id = int(row.material_library_item_id)
        required = float(row.required_qty or 0.0)
        available = float(available_by_material.get(material_id, 0.0))
        out.append(
            {
                "material_library_item_id": material_id,
                "material": {
                    "code": mat_by_id[material_id].code if material_id in mat_by_id else None,
                    "name": mat_by_id[material_id].name if material_id in mat_by_id else None,
                },
                "required": required,
                "available": available,
                "shortage": max(required - available, 0.0),
                "related_orders": related_by_material.get(material_id, []),
            }
        )
    return out


def build_vp_material_requirements(db: Session) -> list[dict]:
    b = _material_requirements_bundle(db)
    if b is None:
        return []
    agg_rows = b["agg_rows"]
    mat_by_id = b["mat_by_id"]
    available_by_material = b["available_by_material"]
    merged = b["merged"]
    detail_rows = b["detail_rows"]
    co_by_id = b["co_by_id"]

    agg_required = {int(r.material_library_item_id): float(r.required_qty or 0.0) for r in agg_rows}

    po_header: dict[int, dict] = {}
    for _rr, po, ji, job in detail_rows:
        pid = int(po.id)
        if pid in po_header:
            continue
        co = co_by_id.get(int(job.customer_order_id)) if job.customer_order_id is not None else None
        po_header[pid] = {
            "production_order_id": pid,
            "vp_code": po.vp_code,
            "zakazka": job.zak_code,
            "customer_order_id": int(co.id) if co is not None else None,
            "order_type": str(getattr(co, "order_type", "customer") or "customer") if co is not None else None,
            "gpn": ji.gpn if ji is not None else po.gpn,
            "due_date": ji.due_date.isoformat() if ji is not None and ji.due_date is not None else None,
            "job_item_id": int(ji.id) if ji is not None else None,
            "is_material_ready": bool(getattr(po, "is_material_ready", True)),
        }

    by_vp: dict[int, list[dict]] = defaultdict(list)
    for (mid, pid), payload in sorted(merged.items(), key=lambda kv: (kv[0][1], kv[0][0])):
        lines = sorted(payload["_lines"], key=lambda ln: int(ln["reservation_id"]))
        req_sum = sum(float(ln["required_qty"]) for ln in lines)
        res_sum = sum(float(ln["reserved_qty"]) for ln in lines)
        ids = [int(ln["reservation_id"]) for ln in lines]
        st = lines[0]["status"]
        mat = mat_by_id.get(mid)
        avail = float(available_by_material.get(mid, 0.0))
        total_req = float(agg_required.get(mid, 0.0))
        shortage = max(total_req - avail, 0.0)
        by_vp[pid].append(
            {
                "material_library_item_id": mid,
                "material": {
                    "code": mat.code if mat else None,
                    "name": mat.name if mat else None,
                    "dimension": mat.dimension if mat else None,
                    "unit": mat.unit if mat else None,
                },
                "required_qty": req_sum,
                "reserved_qty": res_sum,
                "available": avail,
                "shortage": shortage,
                "status": st,
                "reservation_id": ids[0],
                "reservation_ids": ids,
                "reservation_count": len(lines),
                "reservation_lines": lines,
                "production_order_id": pid,
                "vp_code": payload.get("vp_code"),
                "zakazka": payload.get("zakazka"),
                "customer_order_id": payload.get("customer_order_id"),
                "gpn": payload.get("gpn"),
            }
        )

    out: list[dict] = []
    for pid in sorted(by_vp.keys()):
        materials = by_vp[pid]
        header = po_header.get(pid, {})
        covered = True
        for m in materials:
            mid = int(m["material_library_item_id"])
            if float(m["reserved_qty"] or 0) + 1e-9 < float(m["required_qty"] or 0):
                covered = False
                break
            g_short = max(float(agg_required.get(mid, 0.0)) - float(available_by_material.get(mid, 0.0)), 0.0)
            if g_short > 1e-6:
                covered = False
                break

        out.append(
            {
                **header,
                "coverage": "covered" if covered and materials else "uncovered",
                "materials": materials,
            }
        )

    def _sort_key(row: dict) -> tuple:
        d = row.get("due_date") or "9999-12-31"
        return (d, row.get("vp_code") or "")

    out.sort(key=_sort_key)
    return out
