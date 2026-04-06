"""
Jednorázové a idempotentní migrace: text / legacy stroj → workplace_library_item_id.
Výsledek se loguje kvůli řádkům, které nelze automaticky namapovat.
"""

from __future__ import annotations

import logging
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.master_data import Machine
from app.models.master_libraries import WorkplaceLibraryItem
from app.models.orders import ProductionOrder, ProductionOrderOperation
from app.models.planning import PlanningOperation
from app.models.portfolio import (
    PortfolioTechnologyTemplate,
    PortfolioTechnologyTemplateOperation,
)
from app.models.technology_library import TechnologyTemplateOperation
from app.services.workplace_scheduling_anchor import get_or_create_scheduling_machine_for_workplace

logger = logging.getLogger(__name__)

# Legacy technology_template_operations.machine_code → očekávaný záznam v knihovně (code nebo name, viz _find_workplace_for_legacy_tech_machine_code).
_LEGACY_TECH_MACHINE_CODE_TO_WORKPLACE_LABELS: dict[str, tuple[str, ...]] = {
    "MEZIOPERACNI_KONTROLA": ("KONTROLA",),
    "VYSTUPNI_KONTROLA": ("KONTROLA",),
    "BALENI": ("EXPEDICE",),
}


def _find_workplace_for_legacy_tech_machine_code(db: Session, machine_code: str | None) -> WorkplaceLibraryItem | None:
    key = (machine_code or "").strip().upper()
    labels = _LEGACY_TECH_MACHINE_CODE_TO_WORKPLACE_LABELS.get(key)
    if not labels:
        return None
    wps = list(db.scalars(select(WorkplaceLibraryItem)).all())
    for label in labels:
        lu = label.strip().upper()
        ll = label.strip().lower()
        for wp in wps:
            if (wp.code or "").strip().upper() == lu:
                return wp
        for wp in wps:
            if (wp.name or "").strip().lower() == ll:
                return wp
    # Demo knihovna: kontrola často jako KTRL-01 místo kódu KONTROLA
    if key in ("MEZIOPERACNI_KONTROLA", "VYSTUPNI_KONTROLA"):
        for wp in wps:
            c = (wp.code or "").strip().upper().replace("-", "")
            if c == "KTRL01":
                return wp
    return None


def _find_workplace_by_text(db: Session, raw: str | None) -> WorkplaceLibraryItem | None:
    s = (raw or "").strip()
    if not s:
        return None
    sl = s.lower()
    for wp in db.scalars(select(WorkplaceLibraryItem)).all():
        if (wp.code or "").strip().lower() == sl:
            return wp
    for wp in db.scalars(select(WorkplaceLibraryItem)).all():
        if (wp.name or "").strip().lower() == sl:
            return wp
    return None


def migrate_portfolio_tp_operations_workplace_ids(db: Session) -> dict[str, Any]:
    updated = 0
    missing: list[dict[str, Any]] = []
    for op in db.scalars(select(PortfolioTechnologyTemplateOperation)).all():
        if op.workplace_library_item_id is not None:
            continue
        wp = _find_workplace_by_text(db, op.workplace)
        if wp is None:
            missing.append(
                {
                    "portfolio_tp_op_id": int(op.id),
                    "template_id": int(op.template_id),
                    "operation_no": int(op.operation_no),
                    "legacy_workplace_text": op.workplace,
                }
            )
            continue
        op.workplace_library_item_id = int(wp.id)
        op.workplace = wp.name
        updated += 1
    if updated:
        db.flush()
    return {"portfolio_tp_ops_updated": updated, "portfolio_tp_ops_unresolved": missing}


def migrate_technology_template_operations_workplace_ids(db: Session) -> dict[str, Any]:
    updated = 0
    missing: list[dict[str, Any]] = []
    for op in db.scalars(select(TechnologyTemplateOperation)).all():
        if getattr(op, "workplace_library_item_id", None) is not None:
            continue
        m = db.scalar(select(Machine).where(Machine.machine_code == op.machine_code))
        if m is not None and m.workplace_library_item_id is not None:
            op.workplace_library_item_id = int(m.workplace_library_item_id)
            updated += 1
            continue
        wp = _find_workplace_for_legacy_tech_machine_code(db, op.machine_code)
        if wp is not None:
            op.workplace_library_item_id = int(wp.id)
            updated += 1
            continue
        wp = _find_workplace_by_text(db, op.machine_code) or _find_workplace_by_text(db, op.machine_name)
        if wp is None:
            missing.append(
                {
                    "technology_template_op_id": int(op.id),
                    "template_id": int(op.template_id),
                    "operation_no": int(op.operation_no),
                    "machine_code": op.machine_code,
                }
            )
            continue
        op.workplace_library_item_id = int(wp.id)
        updated += 1
    if updated:
        db.flush()
    return {"technology_tp_ops_updated": updated, "technology_tp_ops_unresolved": missing}


def migrate_machines_workplace_fk_exact_code_match(db: Session) -> dict[str, int]:
    """Stroj bez FK: přesná shoda machine_code s workplace.code (bez alias map)."""
    linked = 0
    for m in db.scalars(select(Machine).order_by(Machine.id.asc())).all():
        if m.workplace_library_item_id is not None:
            continue
        mc = (m.machine_code or "").strip().upper()
        if not mc or mc.startswith("__WP_"):
            continue
        for wp in db.scalars(select(WorkplaceLibraryItem)).all():
            wc = (wp.code or "").strip().upper()
            if not wc or wc != mc:
                continue
            taken = db.scalar(
                select(Machine.id).where(Machine.workplace_library_item_id == int(wp.id)).limit(1)
            )
            if taken is not None:
                break
            m.workplace_library_item_id = int(wp.id)
            linked += 1
            break
    if linked:
        db.flush()
    return {"machines_linked_by_exact_code": linked}


def sync_planning_operations_workplace_from_machine(db: Session) -> dict[str, int]:
    n = 0
    for po in db.scalars(select(PlanningOperation)).all():
        if getattr(po, "workplace_library_item_id", None) is not None:
            continue
        m = db.get(Machine, po.machine_id)
        if m is not None and m.workplace_library_item_id is not None:
            po.workplace_library_item_id = int(m.workplace_library_item_id)
            n += 1
    if n:
        db.flush()
    return {"planning_operations_filled": n}


def backfill_production_order_operations_workplace_ids(db: Session) -> dict[str, int]:
    updated = 0
    for row in db.scalars(select(ProductionOrderOperation)).all():
        if getattr(row, "workplace_library_item_id", None) is not None:
            continue
        po = db.get(ProductionOrder, int(row.production_order_id))
        if po is None or po.portfolio_item_id is None:
            continue
        tpl = db.scalars(
            select(PortfolioTechnologyTemplate)
            .where(PortfolioTechnologyTemplate.portfolio_item_id == int(po.portfolio_item_id))
            .order_by(PortfolioTechnologyTemplate.is_active.desc(), PortfolioTechnologyTemplate.id.asc())
        ).first()
        if tpl is None:
            continue
        tp_op = db.scalar(
            select(PortfolioTechnologyTemplateOperation)
            .where(
                PortfolioTechnologyTemplateOperation.template_id == int(tpl.id),
                PortfolioTechnologyTemplateOperation.operation_no == int(row.operation_no),
            )
        )
        if tp_op is None or tp_op.workplace_library_item_id is None:
            continue
        row.workplace_library_item_id = int(tp_op.workplace_library_item_id)
        wp = db.get(WorkplaceLibraryItem, int(tp_op.workplace_library_item_id))
        if wp is not None:
            row.workplace_name = wp.name
        updated += 1
    if updated:
        db.flush()
    return {"production_order_operations_updated": updated}


def ensure_scheduling_anchors_for_all_workplaces(db: Session) -> dict[str, int]:
    wps = db.scalars(select(WorkplaceLibraryItem)).all()
    for wp in wps:
        get_or_create_scheduling_machine_for_workplace(db, int(wp.id))
    db.flush()
    return {"workplace_count": len(wps)}


def run_planner_resource_migrations(db: Session) -> dict[str, Any]:
    """
    Spouštět při startu aplikace (idempotentní).
    """
    out: dict[str, Any] = {}
    out.update(migrate_portfolio_tp_operations_workplace_ids(db))
    out.update(migrate_technology_template_operations_workplace_ids(db))
    out.update(migrate_machines_workplace_fk_exact_code_match(db))
    out.update(ensure_scheduling_anchors_for_all_workplaces(db))
    out.update(sync_planning_operations_workplace_from_machine(db))
    out.update(backfill_production_order_operations_workplace_ids(db))

    pu = out.get("portfolio_tp_ops_unresolved") or []
    tu = out.get("technology_tp_ops_unresolved") or []
    if pu or tu:
        logger.warning(
            "[planner_resource_migration] unresolved portfolio_tp_ops=%s technology_tp_ops=%s detail=%s %s",
            len(pu),
            len(tu),
            pu[:8],
            tu[:8],
        )
    else:
        logger.info("[planner_resource_migration] complete no_unresolved_tp_ops")
    logger.info(
        "[planner_resource_migration] summary workplace_count=%s portfolio_tp_updated=%s tech_tp_updated=%s",
        out.get("workplace_count"),
        out.get("portfolio_tp_ops_updated"),
        out.get("technology_tp_ops_updated"),
    )
    return out
