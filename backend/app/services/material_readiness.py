"""Production order material readiness from active TP material reservations + free stock."""

from __future__ import annotations

import logging
from collections import defaultdict

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.material_stock import MaterialReservation
from app.models.orders import ProductionOrder
from app.models.planning import PlanningOperation
from app.services.business_workflow import workflow_record_active
from app.services.material_reservation_sync import MATERIAL_RESERVATION_ACTIVE_STATUSES

logger = logging.getLogger(__name__)


def evaluate_production_order_material_covered(db: Session, po: ProductionOrder) -> bool:
    """Pokryto = rezervace + volný sklad pokrývají požadavek (možnost vydat)."""
    if not workflow_record_active(po):
        return False
    rows = db.scalars(
        select(MaterialReservation).where(
            MaterialReservation.production_order_id == int(po.id),
            MaterialReservation.status.in_(tuple(MATERIAL_RESERVATION_ACTIVE_STATUSES)),
            MaterialReservation.is_active.is_(True),
        )
    ).all()
    if not rows:
        return True

    from app.api.orders import _available_material_qty

    gaps: dict[int, float] = defaultdict(float)
    for r in rows:
        mid = int(r.material_library_item_id)
        req = float(r.required_qty or 0.0)
        res = float(r.reserved_qty or 0.0)
        gaps[mid] += max(0.0, req - res)
    for mid, gap in gaps.items():
        if gap <= 1e-9:
            continue
        free = float(_available_material_qty(db, mid))
        if free + 1e-9 < gap:
            return False
    return True


def count_active_pipeline_reservations_for_production_order(db: Session, production_order_id: int) -> int:
    n = db.scalar(
        select(func.count())
        .select_from(MaterialReservation)
        .where(
            MaterialReservation.production_order_id == int(production_order_id),
            MaterialReservation.is_active.is_(True),
            MaterialReservation.status.in_(tuple(MATERIAL_RESERVATION_ACTIVE_STATUSES)),
        )
    )
    return int(n or 0)


def count_planning_operations_material_ready_for_vp(db: Session, vp_code: str) -> int:
    vc = (vp_code or "").strip()
    if not vc:
        return 0
    n = db.scalar(
        select(func.count())
        .select_from(PlanningOperation)
        .where(PlanningOperation.work_order_no == vc, PlanningOperation.material_ready.is_(True))
    )
    return int(n or 0)


def evaluate_production_order_material_released(db: Session, po: ProductionOrder) -> bool:
    """
    Vydáno na výrobu = žádná aktivní rezervace ve stavu planned/reserved (fronta výdeje je prázdná).
    Po vydání má řádek status issued a do tohoto výběru nepatří.
    """
    if not workflow_record_active(po):
        return False
    active = db.scalars(
        select(MaterialReservation).where(
            MaterialReservation.production_order_id == int(po.id),
            MaterialReservation.is_active.is_(True),
            MaterialReservation.status.in_(tuple(MATERIAL_RESERVATION_ACTIVE_STATUSES)),
        )
    ).all()
    return len(active) == 0


# Zpětná kompatibilita názvu (pokrytí skladem)
evaluate_production_order_material_ready = evaluate_production_order_material_covered


def sync_planning_operations_material_ready(db: Session, po: ProductionOrder) -> int:
    vp = (po.vp_code or "").strip()
    if not vp:
        return 0
    released = bool(getattr(po, "is_material_released_to_production", False))
    ops = db.scalars(select(PlanningOperation).where(PlanningOperation.work_order_no == vp)).all()
    for op in ops:
        op.material_ready = released
    from app.services.vp_operation_generator import normalize_planning_queue_statuses_for_vp_code

    normalize_planning_queue_statuses_for_vp_code(db, vp)
    return sum(1 for o in ops if bool(getattr(o, "material_ready", False)))


def refresh_production_order_material_readiness(db: Session, po: ProductionOrder | None) -> bool:
    if po is None:
        return False
    covered = evaluate_production_order_material_covered(db, po)
    released = evaluate_production_order_material_released(db, po)
    po.is_material_covered = covered
    po.is_material_released_to_production = released
    po.is_material_ready = released
    sync_planning_operations_material_ready(db, po)
    return covered


def refresh_material_readiness_for_production_order_ids(db: Session, ids: set[int] | list[int]) -> int:
    id_list = sorted({int(x) for x in ids})
    if not id_list:
        return 0
    n = 0
    for pid in id_list:
        po = db.get(ProductionOrder, int(pid))
        if po is not None:
            refresh_production_order_material_readiness(db, po)
            n += 1
    return n


def refresh_material_readiness_for_material_library_item(db: Session, material_library_item_id: int) -> int:
    po_ids = db.scalars(
        select(MaterialReservation.production_order_id).where(
            MaterialReservation.material_library_item_id == int(material_library_item_id),
            MaterialReservation.status.in_(tuple(MATERIAL_RESERVATION_ACTIVE_STATUSES)),
            MaterialReservation.is_active.is_(True),
        ).distinct()
    ).all()
    return refresh_material_readiness_for_production_order_ids(db, {int(x) for x in po_ids if x is not None})


def rebuild_machine_schedules_after_vps_became_material_ready(db: Session, pos: list[ProductionOrder]) -> list[int]:
    """
    Po vydání materiálu: jedna globální přestavba rozvrhu (sekvenční VP + material_ready v engine).
    """
    from datetime import date

    from app.services.planning_engine import PlanningEngineService

    if not pos:
        return []

    print(
        "[PLANNER_DIAG] material_issue rebuild_machine_schedules_after_vps_became_material_ready "
        f"vp_ids={[int(p.id) for p in pos]}",
        flush=True,
    )

    related_machines: set[int] = set()
    for po in pos:
        if not workflow_record_active(po):
            continue
        vp = (po.vp_code or "").strip()
        if not vp:
            continue
        all_for_vp = db.scalars(select(PlanningOperation).where(PlanningOperation.work_order_no == vp)).all()
        diag_states = [
            {
                "id": int(x.id),
                "machine_id": int(x.machine_id) if x.machine_id is not None else None,
                "status": x.status,
                "material_ready": bool(getattr(x, "material_ready", False)),
                "op_no": int(x.operation_no or 0),
            }
            for x in all_for_vp
        ]
        logger.info(
            "[planning_bridge] material_issue_rebuild_scan vp_id=%s vp_code=%s planning_ops_total=%s detail=%s",
            int(po.id),
            vp,
            len(all_for_vp),
            diag_states[:20],
        )
        for op in all_for_vp:
            if op.machine_id is None:
                continue
            related_machines.add(int(op.machine_id))

    svc = PlanningEngineService(db)
    created = svc.rebuild_global_schedules(date.today())
    machines_with_rows = sorted({int(s.machine_id) for s in created})
    logger.info(
        "[planning_bridge] rebuild_global_after_material_issue scheduled_rows=%s machines_with_rows=%s",
        len(created),
        machines_with_rows,
    )
    print(
        "[PLANNER_DIAG] material_issue rebuild_global_schedules finished "
        f"scheduled_rows={len(created)} machines_with_rows={machines_with_rows}",
        flush=True,
    )
    from app.services.vp_operation_generator import _vp_planning_pipeline_snapshot

    for po in pos:
        _vp_planning_pipeline_snapshot(
            db,
            po,
            "after_material_issue_rebuild",
            {
                "machines_with_schedule_rows": machines_with_rows,
                "related_machine_ids_from_vp": sorted(related_machines),
            },
        )
    return machines_with_rows


def ensure_planning_operation_material_ready_for_start(db: Session, op: PlanningOperation) -> None:
    woo = (op.work_order_no or "").strip()
    if not woo:
        return
    po = db.scalar(select(ProductionOrder).where(ProductionOrder.vp_code == woo))
    if po is None:
        return
    if not workflow_record_active(po):
        return
    if not bool(getattr(po, "is_material_released_to_production", False)):
        raise HTTPException(
            status_code=409,
            detail="Nelze zahájit operaci: materiál nebyl vydán na výrobu (nejprve vydání ze skladu).",
        )
