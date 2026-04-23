"""
Fronta kiosku zarovnaná na Planner (řádek pracoviště + kotvy __WP_{id}__).

Plánovač může ukládat operace na syntetický stroj `__WP_{workplace_id}__`; kiosk vybírá
reálný stroj se stejným `workplace_library_item_id` (nebo explicitním kódem pracoviště).
Mapování výhradně přes FK / kód v DB, ne podle lidských jmen.
"""

from __future__ import annotations

import logging

from sqlalchemy import exists, func, or_, select, update
from sqlalchemy.orm import Session, aliased

from app.models.master_data import Machine
from app.models.master_libraries import WorkplaceLibraryItem
from app.models.orders import ProductionOrder
from app.models.planning import PlanningOperation
from app.services.business_workflow import workflow_active_sql

logger = logging.getLogger(__name__)

# Syntetická kotva z workplace_scheduling_anchor.get_or_create_scheduling_machine_for_workplace
_WORKPLACE_ANCHOR_TYPE = "WORKPLACE_ANCHOR"


def _parse_wp_id_from_anchor_code(machine_code: str | None) -> int | None:
    mc = (machine_code or "").strip()
    if not (mc.startswith("__WP_") and mc.endswith("__")):
        return None
    inner = mc[len("__WP_") : -len("__")]
    try:
        return int(inner)
    except ValueError:
        return None


def _resolve_workplace_via_same_workcenter(db: Session, machine: Machine) -> int | None:
    """
    Jednoznačné WP ze strojů se stejným workcenter_id: sloučí
    - workplace_library_item_id na řádcích kolegů
    - workplace ID parsované z machine_code kotvy __WP_* (kotva často nemá vyplněný FK, jen kód)
    """
    if machine.workcenter_id is None:
        return None
    candidates: set[int] = set()
    for row in db.execute(
        select(Machine.workplace_library_item_id, Machine.machine_code).where(
            Machine.workcenter_id == int(machine.workcenter_id)
        )
    ).all():
        wid_col, mc = row[0], row[1]
        if wid_col is not None:
            candidates.add(int(wid_col))
        wp = _parse_wp_id_from_anchor_code(mc)
        if wp is not None:
            candidates.add(wp)
    if len(candidates) == 1:
        return candidates.pop()
    if len(candidates) > 1:
        logger.warning(
            "[kiosk_planner_queue] ambiguous workplace for workcenter_id=%s machine_id=%s candidates=%s",
            machine.workcenter_id,
            machine.id,
            sorted(candidates),
        )
    return None


def resolve_workplace_id_for_kiosk_machine(db: Session, machine: Machine) -> int | None:
    """
    Pracoviště pro mapování kiosku na planner řádek / kotvu __WP_*.
    Pořadí: FK stroje → kód __WP_* na stroji → workplace.code == machine_code → stejný workcenter (FK + kotvy).
    """
    wid = _resolve_workplace_id_core(db, machine)
    if wid is not None:
        logger.info(
            "[kiosk_planner_queue] resolve_workplace machine_id=%s code=%s step=core workplace_id=%s",
            machine.id,
            machine.machine_code,
            wid,
        )
        return wid
    wid = _resolve_workplace_via_same_workcenter(db, machine)
    if wid is not None:
        logger.info(
            "[kiosk_planner_queue] resolve_workplace machine_id=%s code=%s step=same_workcenter workplace_id=%s",
            machine.id,
            machine.machine_code,
            wid,
        )
        return wid
    logger.info(
        "[kiosk_planner_queue] resolve_workplace machine_id=%s code=%s step=failed workplace_id=None "
        "(workcenter_id=%s workplace_fk=%s)",
        machine.id,
        machine.machine_code,
        machine.workcenter_id,
        machine.workplace_library_item_id,
    )
    return None


def _resolve_workplace_id_core(db: Session, machine: Machine) -> int | None:
    """Jádro bez workcenter fallbacku (pro případné reuse)."""
    if machine.workplace_library_item_id is not None:
        return int(machine.workplace_library_item_id)
    wid = _parse_wp_id_from_anchor_code(machine.machine_code)
    if wid is not None:
        return wid
    mc = (machine.machine_code or "").strip()
    if not mc:
        return None
    row = db.scalar(
        select(WorkplaceLibraryItem.id).where(
            WorkplaceLibraryItem.code == mc,
            WorkplaceLibraryItem.is_active.is_(True),
        )
    )
    return int(row) if row is not None else None


def planner_anchor_machine_ids_for_workplace(db: Session, workplace_id: int) -> set[int]:
    """
    ID řádků strojů planner kotvy pro dané pracoviště: přesný kód __WP_{wid}__ a/nebo
    řádek se stejným workplace_library_item_id a typem WORKPLACE_ANCHOR (odolné vůči odchylce v kódu).
    """
    wid = int(workplace_id)
    code = f"__WP_{wid}__"
    ids: set[int] = set()
    a = db.scalar(select(Machine.id).where(Machine.machine_code == code))
    if a is not None:
        ids.add(int(a))
    for mid in db.scalars(
        select(Machine.id).where(
            Machine.workplace_library_item_id == wid,
            or_(
                Machine.machine_type == _WORKPLACE_ANCHOR_TYPE,
                Machine.machine_code.startswith("__WP_"),
            ),
        )
    ).all():
        ids.add(int(mid))
    return ids


def _effective_workplace_id(db: Session, op: PlanningOperation) -> int | None:
    wid = op.workplace_library_item_id
    if wid is not None:
        return int(wid)
    if op.machine_id is None:
        return None
    m = db.get(Machine, int(op.machine_id))
    if m is None or m.workplace_library_item_id is None:
        return None
    return int(m.workplace_library_item_id)


def operation_on_same_planner_row_as_machine(db: Session, op: PlanningOperation, kiosk_machine: Machine) -> bool:
    """Stejný řádek Planneru: vlastní stroj, kotva __WP_* pracoviště, nebo stejné efektivní WP."""
    if int(op.machine_id or 0) == int(kiosk_machine.id):
        return True
    wid = resolve_workplace_id_for_kiosk_machine(db, kiosk_machine)
    if wid is None:
        return False
    machine_ids = {int(kiosk_machine.id)} | planner_anchor_machine_ids_for_workplace(db, wid)
    if int(op.machine_id or 0) in machine_ids:
        return True
    op_wp = _effective_workplace_id(db, op)
    return op_wp is not None and int(op_wp) == int(wid)


def _open_queue_status_clause():
    """Exclude terminal planning rows (hotovo/cancelled); legacy finished/done migrated at startup."""
    return or_(
        PlanningOperation.status.is_(None),
        ~PlanningOperation.status.in_(["hotovo", "cancelled"]),
    )


def _kiosk_queue_active_production_workflow_clause():
    """
    Odfiltrovat řádky, jejichž work_order_no odpovídá production_orders (vp) se zrušeným
    nebo jinak neaktivním workflow (stejná logika jako workflow_record_active / workflow_active_sql).
    Řádky bez WOO (NULL/prázdné) ponecháme.
    """
    woo_trim = func.trim(PlanningOperation.work_order_no)
    inactive_matches_vp = exists(
        select(1)
        .select_from(ProductionOrder)
        .where(
            func.lower(func.trim(ProductionOrder.vp_code)) == func.lower(woo_trim),
            ~workflow_active_sql(ProductionOrder.workflow_status),
        )
    )
    return or_(
        PlanningOperation.work_order_no.is_(None),
        woo_trim == "",
        ~inactive_matches_vp,
    )


def cancel_open_planning_operations_for_vp_code(db: Session, vp_code: str | None) -> int:
    """Nastaví otevřené planning operace pro daný WOO/vp na status cancelled (synchron s VP stornem)."""
    code = (vp_code or "").strip()
    if not code:
        return 0
    r = db.execute(
        update(PlanningOperation)
        .where(func.lower(func.trim(PlanningOperation.work_order_no)) == func.lower(code))
        .where(
            or_(
                PlanningOperation.status.is_(None),
                ~PlanningOperation.status.in_(["hotovo", "cancelled"]),
            )
        )
        .values(status="cancelled")
    )
    return int(r.rowcount or 0)


def list_planning_operations_for_kiosk_machine(db: Session, machine: Machine) -> list[PlanningOperation]:
    """Operace na vybraném stroji, na kotvě __WP_{wp}__, nebo se stejným efektivním pracovištěm jako Planner."""
    wid = resolve_workplace_id_for_kiosk_machine(db, machine)
    if wid is None:
        logger.info(
            "[kiosk_planner_queue] queue machine_id=%s machine_code=%s workplace_resolved=None "
            "anchor_ids=[] final_machine_ids=[%s] (fallback: own machine only)",
            machine.id,
            machine.machine_code,
            machine.id,
        )
        stmt = (
            select(PlanningOperation)
            .where(PlanningOperation.machine_id == int(machine.id))
            .where(_open_queue_status_clause())
            .where(_kiosk_queue_active_production_workflow_clause())
            .order_by(
                PlanningOperation.planned_start.asc().nulls_last(),
                PlanningOperation.queue_position.asc().nulls_last(),
                PlanningOperation.operation_no.asc(),
                PlanningOperation.id.asc(),
            )
        )
        return list(db.scalars(stmt).all())

    wp_id = int(wid)
    anchor_ids = planner_anchor_machine_ids_for_workplace(db, wp_id)
    machine_ids = {int(machine.id)} | anchor_ids
    logger.info(
        "[kiosk_planner_queue] queue machine_id=%s machine_code=%s workplace_resolved=%s "
        "anchor_machine_ids=%s final_machine_id_set=%s",
        machine.id,
        machine.machine_code,
        wp_id,
        sorted(anchor_ids),
        sorted(machine_ids),
    )
    PoM = aliased(Machine)
    stmt = (
        select(PlanningOperation)
        .join(PoM, PoM.id == PlanningOperation.machine_id)
        .where(
            or_(
                PlanningOperation.machine_id.in_(machine_ids),
                func.coalesce(PlanningOperation.workplace_library_item_id, PoM.workplace_library_item_id) == wp_id,
            )
        )
        .where(_open_queue_status_clause())
        .where(_kiosk_queue_active_production_workflow_clause())
        .order_by(
            PlanningOperation.planned_start.asc().nulls_last(),
            PlanningOperation.queue_position.asc().nulls_last(),
            PlanningOperation.operation_no.asc(),
            PlanningOperation.id.asc(),
        )
    )
    rows = list(db.scalars(stmt).all())
    logger.info(
        "[kiosk_planner_queue] queue result_count=%s planning_operation_ids=%s",
        len(rows),
        [int(o.id) for o in rows[:50]],
    )
    return rows
