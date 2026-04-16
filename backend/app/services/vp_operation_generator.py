"""
Most mezi výrobním příkazem (VP) a plánovačem: planning_operations = přesně operace z aktivního
portfolio technology postupu (TP), případně fallback na technology_library u stejného GPN.
Žádné automatické dokončovací / logistické kroky (Expedice, příjem sklad, …) se nepřidávají —
musí být součástí TP v datech.
"""

import logging
from typing import Any

from sqlalchemy import delete, func, select, text
from sqlalchemy.orm import Session

from app.core.scan_code import production_order_operation_scan_code_for_id
from app.models.master_data import Machine
from app.services.workplace_scheduling_anchor import get_or_create_scheduling_machine_for_workplace
from app.models.orders import JobItem, ProductionOrder, ProductionOrderOperation
from app.models.portfolio import PortfolioTechnologyTemplate, PortfolioTechnologyTemplateOperation
from app.models.technology_library import TechnologyTemplate
from app.models.planning import PlanningOperation, MachineSchedule, PlanningScheduleSegment
from app.services.business_workflow import workflow_record_active
from app.services.planning_operation_status import (
    normalize_planning_operation_status,
    planning_operation_status_is_protected_for_queue_normalize,
)

logger = logging.getLogger(__name__)


def _vp_planning_pipeline_snapshot(
    db: Session,
    po: ProductionOrder,
    stage: str,
    ensure_out: dict | None = None,
) -> None:
    """One-line DB truth for tracing VP → planning_ops → machine_schedule (Gantt reads these)."""
    vid = int(po.id)
    vc = (po.vp_code or "").strip()
    pid = int(po.portfolio_item_id) if po.portfolio_item_id is not None else None
    mat_covered = bool(getattr(po, "is_material_covered", False))
    mat_released = bool(getattr(po, "is_material_released_to_production", False))
    n_vp_ops = (
        db.scalar(
            select(func.count()).select_from(ProductionOrderOperation).where(
                ProductionOrderOperation.production_order_id == vid
            )
        )
        or 0
    )
    n_plo = 0
    n_ms = 0
    sample: list[dict] = []
    if vc:
        n_plo = (
            db.scalar(
                select(func.count()).select_from(PlanningOperation).where(PlanningOperation.work_order_no == vc)
            )
            or 0
        )
        n_ms = (
            db.scalar(
                select(func.count())
                .select_from(MachineSchedule)
                .join(PlanningOperation, MachineSchedule.planning_operation_id == PlanningOperation.id)
                .where(PlanningOperation.work_order_no == vc)
            )
            or 0
        )
        for r in db.scalars(
            select(PlanningOperation)
            .where(PlanningOperation.work_order_no == vc)
            .order_by(PlanningOperation.operation_no.asc(), PlanningOperation.id.asc())
            .limit(8)
        ).all():
            wid = getattr(r, "workplace_library_item_id", None)
            sample.append(
                {
                    "id": int(r.id),
                    "op_no": int(r.operation_no or 0),
                    "machine_id": int(r.machine_id) if r.machine_id is not None else None,
                    "wp_lib_id": int(wid) if wid is not None else None,
                    "material_ready": bool(getattr(r, "material_ready", False)),
                    "status": r.status,
                }
            )
    logger.info(
        "[vp_planning_pipeline] stage=%s vp_id=%s vp_code=%s portfolio_item_id=%s po_material_covered=%s "
        "po_material_released=%s vp_ops=%s planning_ops=%s machine_schedule_rows=%s ensure_out=%s sample_planning=%s",
        stage,
        vid,
        vc,
        pid,
        mat_covered,
        mat_released,
        n_vp_ops,
        n_plo,
        n_ms,
        ensure_out,
        sample,
    )


def normalize_planning_queue_statuses_for_vp_code(db: Session, vp_code: str) -> dict[str, Any]:
    """
    Plánovač bere jen status in (ready, planned). První operace VP se strojem (nejmenší operation_no)
    musí být ready (nebo už planned); ostatní otevřené řádky waiting_release.
    """
    vp_code = (vp_code or "").strip()
    if not vp_code:
        return {"normalized": False, "reason": "empty_vp_code"}

    ops = db.scalars(
        select(PlanningOperation)
        .where(
            PlanningOperation.work_order_no == vp_code,
            PlanningOperation.machine_id.isnot(None),
        )
        .order_by(PlanningOperation.operation_no.asc(), PlanningOperation.id.asc())
    ).all()
    if not ops:
        return {"normalized": False, "reason": "no_machined_ops"}

    head = None
    for o in ops:
        if planning_operation_status_is_protected_for_queue_normalize(o.status):
            continue
        head = o
        break
    if head is None:
        return {"normalized": False, "reason": "all_protected"}

    updated = 0
    head_st = (head.status or "").strip().lower()
    if head_st == "planned":
        pass
    elif head_st == "scheduling_late":
        pass  # planner: nelze vložit před manufacturing_deadline — neprepisovat na ready
    elif head_st != "ready":
        head.status = "ready"
        updated += 1

    for o in ops:
        if o.id == head.id:
            continue
        if planning_operation_status_is_protected_for_queue_normalize(o.status):
            continue
        st = (o.status or "").strip().lower()
        if st == "planned":
            continue
        if st == "ready":
            o.status = "waiting_release"
            updated += 1

    if updated:
        db.flush()
    logger.info(
        "[planning_bridge] normalize_vp_queue vp_code=%s head_op_no=%s head_status=%s rows_updated=%s",
        vp_code,
        int(head.operation_no),
        head.status,
        updated,
    )
    return {
        "normalized": True,
        "vp_code": vp_code,
        "head_operation_no": int(head.operation_no),
        "rows_updated": updated,
    }


def _extract_diameter_from_template(template: TechnologyTemplate):
    if not template:
        return None

    name = (template.name or "").lower().replace(",", ".")
    tokens = name.split()

    for token in tokens:
        token = token.strip()
        if token.endswith("mm"):
            raw = token.replace("mm", "").strip()
            try:
                return float(raw)
            except ValueError:
                pass
    return None


def _select_active_portfolio_tp(db: Session, portfolio_item_id: int | None) -> PortfolioTechnologyTemplate | None:
    if portfolio_item_id is None:
        return None
    tpl = db.scalars(
        select(PortfolioTechnologyTemplate)
        .where(
            PortfolioTechnologyTemplate.portfolio_item_id == int(portfolio_item_id),
            PortfolioTechnologyTemplate.is_active.is_(True),
        )
        .order_by(PortfolioTechnologyTemplate.id.asc())
    ).first()
    if tpl is None:
        tpl = db.scalars(
            select(PortfolioTechnologyTemplate)
            .where(PortfolioTechnologyTemplate.portfolio_item_id == int(portfolio_item_id))
            .order_by(PortfolioTechnologyTemplate.id.asc())
        ).first()
    return tpl


def _resolve_machine_for_portfolio_template_op(db: Session, op: PortfolioTechnologyTemplateOperation) -> Machine | None:
    """Kanonicky pouze workplace_library_item_id → stroj (reálný nebo syntetická kotva)."""
    if op.workplace_library_item_id is None:
        return None
    return get_or_create_scheduling_machine_for_workplace(db, int(op.workplace_library_item_id))


def _resolve_machine_from_vp_order_operation(
    db: Session, po: ProductionOrder, tpl_op: PortfolioTechnologyTemplateOperation
) -> Machine | None:
    """Záloha: TP řádek bez FK, ale PO operace už má workplace_library_item_id (např. doplněno ručně)."""
    ex = db.scalar(
        select(ProductionOrderOperation).where(
            ProductionOrderOperation.production_order_id == int(po.id),
            ProductionOrderOperation.operation_no == int(tpl_op.operation_no),
        )
    )
    if ex is None or ex.workplace_library_item_id is None:
        return None
    return get_or_create_scheduling_machine_for_workplace(db, int(ex.workplace_library_item_id))


def _planning_qty_for_vp(po: ProductionOrder, job_item: JobItem) -> int:
    q = int(po.quantity or 0)
    if q <= 0:
        q = int(job_item.qty or 0)
    return max(q, 0)


def _regenerate_blocked_by_running_ops(ops: list[PlanningOperation]) -> bool:
    """
    Regenerate must be blocked only for truly running operations.
    Historical terminal statuses (hotovo/cancelled) must not prevent TP rebuild.
    """
    for op in ops:
        st = normalize_planning_operation_status(op.status)
        if st == "bezi":
            return True
    return False


def _normalized_operation_specs_for_vp(
    db: Session,
    *,
    po: ProductionOrder,
    job_item: JobItem,
) -> list[dict[str, Any]]:
    """
    Current canonical routing for VP regenerate, renumbered in steps of 10.
    Source priority: active portfolio TP, fallback technology_library by GPN.
    """
    pid = int(po.portfolio_item_id) if po.portfolio_item_id is not None else None
    if pid is None:
        cols = {r[1] for r in db.execute(text("PRAGMA table_info(job_items)")).fetchall()}
        if "portfolio_item_id" in cols:
            row = db.execute(
                text("SELECT portfolio_item_id FROM job_items WHERE id = :id"),
                {"id": int(job_item.id)},
            ).fetchone()
            if row is not None and row[0] is not None:
                pid = int(row[0])

    specs: list[dict[str, Any]] = []
    tpl = _select_active_portfolio_tp(db, pid)
    if tpl is not None:
        ops = db.scalars(
            select(PortfolioTechnologyTemplateOperation)
            .where(PortfolioTechnologyTemplateOperation.template_id == int(tpl.id))
            .order_by(PortfolioTechnologyTemplateOperation.operation_no.asc(), PortfolioTechnologyTemplateOperation.id.asc())
        ).all()
        for idx, op in enumerate(ops, start=1):
            specs.append(
                {
                    "operation_no": idx * 10,
                    "operation_name": op.operation_name,
                    "workplace_name": op.workplace,
                    "workplace_library_item_id": int(op.workplace_library_item_id)
                    if op.workplace_library_item_id is not None
                    else None,
                }
            )
        return specs

    template = db.scalar(select(TechnologyTemplate).where(TechnologyTemplate.gpn == job_item.gpn))
    if template is None:
        return []
    ops = sorted(template.operations, key=lambda x: (int(x.operation_no or 0), int(x.id)))
    for idx, op in enumerate(ops, start=1):
        specs.append(
            {
                "operation_no": idx * 10,
                "operation_name": op.operation_name,
                "workplace_name": getattr(op, "workplace", None),
                "workplace_library_item_id": int(op.workplace_library_item_id)
                if getattr(op, "workplace_library_item_id", None) is not None
                else None,
            }
        )
    return specs


def _rebuild_production_order_operation_rows_from_current_tp(
    db: Session,
    *,
    po: ProductionOrder,
    job_item: JobItem,
) -> int:
    specs = _normalized_operation_specs_for_vp(db, po=po, job_item=job_item)
    db.execute(
        delete(ProductionOrderOperation).where(
            ProductionOrderOperation.production_order_id == int(po.id)
        )
    )
    db.flush()
    created = 0
    for spec in specs:
        row = ProductionOrderOperation(
            production_order_id=int(po.id),
            operation_no=int(spec["operation_no"]),
            operation_name=str(spec.get("operation_name") or ""),
            workplace_name=spec.get("workplace_name"),
            workplace_library_item_id=spec.get("workplace_library_item_id"),
        )
        db.add(row)
        db.flush()
        row.scan_code = production_order_operation_scan_code_for_id(int(row.id))
        created += 1
    return created


def _create_planning_ops_from_portfolio_tp(
    db: Session,
    *,
    po: ProductionOrder,
    job_item: JobItem,
    tpl: PortfolioTechnologyTemplate,
) -> dict:
    vp_code = (po.vp_code or "").strip()
    gpn = (job_item.gpn or po.gpn or "").strip() or "?"
    qty_pl = _planning_qty_for_vp(po, job_item)

    op_rows = db.scalars(
        select(PortfolioTechnologyTemplateOperation)
        .where(PortfolioTechnologyTemplateOperation.template_id == int(tpl.id))
        .order_by(PortfolioTechnologyTemplateOperation.operation_no.asc(), PortfolioTechnologyTemplateOperation.id.asc())
    ).all()

    resolved: list[tuple[int, PortfolioTechnologyTemplateOperation, Machine]] = []
    skipped: list[dict] = []
    for idx, op in enumerate(op_rows, start=1):
        machine = _resolve_machine_for_portfolio_template_op(db, op)
        if machine is None:
            machine = _resolve_machine_from_vp_order_operation(db, po, op)
        if machine is None:
            skipped.append(
                {
                    "operation_no": int(op.operation_no),
                    "operation_name": op.operation_name,
                    "reason": "missing_workplace_library_item_id",
                }
            )
            continue
        effective_no = idx * 10
        resolved.append((effective_no, op, machine))

    if not resolved:
        return {
            "source": "portfolio_tp",
            "created": 0,
            "vp_id": int(po.id),
            "vp_code": vp_code,
            "skipped": skipped,
            "reason": "no_machine_for_any_operation",
        }

    first_no = 10
    created = 0
    for effective_no, op, machine in resolved:
        setup = float(op.setup_min or 0)
        run_piece = float(op.run_min_per_piece or 0)
        total_labor = run_piece * float(qty_pl)
        total_time = setup + total_labor
        st = "ready" if int(effective_no) == first_no else "waiting_release"
        wp_fk = None
        if op.workplace_library_item_id is not None:
            wp_fk = int(op.workplace_library_item_id)
        elif machine.workplace_library_item_id is not None:
            wp_fk = int(machine.workplace_library_item_id)
        planning = PlanningOperation(
            order_item_id=job_item.id,
            product_group_id=None,
            work_order_no=vp_code,
            gpn=gpn,
            operation_name=op.operation_name,
            operation_no=int(effective_no),
            machine_id=int(machine.id),
            workplace_library_item_id=wp_fk,
            qty=qty_pl,
            input_diameter_mm=None,
            setup_time_min=setup,
            total_labor_time_min=total_labor,
            total_operation_time_min=total_time,
            expedition_date=str(job_item.due_date) if job_item.due_date else None,
            planned_start=None,
            planned_end=None,
            actual_start=None,
            actual_end=None,
            qty_ok=None,
            qty_nok=None,
            released_at=None,
            latest_start=None,
            buffer_after_min=20,
            queue_position=None,
            material_ready=bool(getattr(po, "is_material_released_to_production", False)),
            status=st,
            planning_mode="auto",
            is_locked=False,
        )
        db.add(planning)
        created += 1

    db.flush()
    norm = normalize_planning_queue_statuses_for_vp_code(db, vp_code)
    planning_ids = [
        int(r.id)
        for r in db.scalars(
            select(PlanningOperation)
            .where(PlanningOperation.work_order_no == vp_code)
            .order_by(PlanningOperation.id.asc())
        ).all()
    ]
    logger.info(
        "[planning_bridge] portfolio_tp_planning_rows vp_code=%s created=%s planning_operation_ids=%s queue_normalize=%s",
        vp_code,
        created,
        planning_ids,
        norm,
    )
    return {
        "source": "portfolio_tp",
        "created": created,
        "vp_id": int(po.id),
        "vp_code": vp_code,
        "skipped": skipped,
        "first_ready_operation_no": int(first_no),
        "queue_normalize": norm,
        "planning_operation_ids": planning_ids,
    }


def _create_planning_ops_from_technology_library(
    db: Session,
    *,
    po: ProductionOrder,
    job_item: JobItem,
    template: TechnologyTemplate,
) -> dict:
    vp_code = (po.vp_code or "").strip()
    gpn = job_item.gpn
    qty_pl = _planning_qty_for_vp(po, job_item)
    input_diameter = _extract_diameter_from_template(template)

    resolved: list[tuple[int, Any, Machine]] = []
    skipped: list[dict] = []
    ordered_ops = sorted(template.operations, key=lambda x: (int(x.operation_no or 0), int(x.id)))
    for idx, op in enumerate(ordered_ops, start=1):
        wid = getattr(op, "workplace_library_item_id", None)
        if wid is None:
            skipped.append(
                {
                    "operation_no": int(op.operation_no),
                    "operation_name": op.operation_name,
                    "reason": "missing_workplace_library_item_id",
                }
            )
            continue
        machine = get_or_create_scheduling_machine_for_workplace(db, int(wid))
        if machine is None:
            skipped.append(
                {
                    "operation_no": int(op.operation_no),
                    "operation_name": op.operation_name,
                    "reason": "workplace_not_found",
                }
            )
            continue
        effective_no = idx * 10
        resolved.append((effective_no, op, machine))

    if not resolved:
        return {
            "source": "technology_library",
            "created": 0,
            "vp_id": int(po.id),
            "vp_code": vp_code,
            "skipped": skipped,
            "reason": "no_machine_for_any_operation",
        }

    first_no = 10
    created = 0
    for effective_no, op, machine in resolved:
        total_labor = float(op.labor_time_per_piece_min or 0) * float(qty_pl)
        total_time = float(op.setup_time_min or 0) + total_labor
        st = "ready" if int(effective_no) == first_no else "waiting_release"
        wp_fk = getattr(op, "workplace_library_item_id", None)
        if wp_fk is None:
            wp_fk = machine.workplace_library_item_id
        if wp_fk is None:
            continue
        planning = PlanningOperation(
            order_item_id=job_item.id,
            product_group_id=None,
            work_order_no=vp_code,
            gpn=gpn,
            operation_name=op.operation_name,
            operation_no=int(effective_no),
            machine_id=int(machine.id),
            workplace_library_item_id=int(wp_fk),
            qty=qty_pl,
            input_diameter_mm=input_diameter,
            setup_time_min=float(op.setup_time_min or 0),
            total_labor_time_min=total_labor,
            total_operation_time_min=total_time,
            expedition_date=str(job_item.due_date) if job_item.due_date else None,
            planned_start=None,
            planned_end=None,
            actual_start=None,
            actual_end=None,
            qty_ok=None,
            qty_nok=None,
            released_at=None,
            latest_start=None,
            buffer_after_min=int(op.buffer_after_min or 20),
            queue_position=None,
            material_ready=bool(getattr(po, "is_material_released_to_production", False)),
            status=st,
            planning_mode="auto",
            is_locked=False,
        )
        db.add(planning)
        created += 1

    db.flush()
    norm = normalize_planning_queue_statuses_for_vp_code(db, vp_code)
    planning_ids = [
        int(r.id)
        for r in db.scalars(
            select(PlanningOperation)
            .where(PlanningOperation.work_order_no == vp_code)
            .order_by(PlanningOperation.id.asc())
        ).all()
    ]
    logger.info(
        "[planning_bridge] technology_library_planning_rows vp_code=%s created=%s planning_operation_ids=%s queue_normalize=%s",
        vp_code,
        created,
        planning_ids,
        norm,
    )
    return {
        "source": "technology_library",
        "created": created,
        "vp_id": int(po.id),
        "vp_code": vp_code,
        "skipped": skipped,
        "first_ready_operation_no": int(first_no),
        "queue_normalize": norm,
        "planning_operation_ids": planning_ids,
    }


def ensure_planning_operations_for_production_order(db: Session, po: ProductionOrder | None) -> dict:
    """
    Zajistí planning_operations pro VP z portfolio TP (preferovaně) nebo z technology_library (fallback).
    Necommituje — volat uvnitř transakce výroby.
    """
    if po is None:
        return {"skipped": "no_po"}
    if not workflow_record_active(po):
        _vp_planning_pipeline_snapshot(
            db,
            po,
            "skip_workflow_inactive",
            {"skipped": "workflow_inactive"},
        )
        return {"skipped": "workflow_inactive", "vp_id": int(po.id)}
    if bool(getattr(po, "blocked_until_reserved_stock_receipt", False)):
        _vp_planning_pipeline_snapshot(
            db,
            po,
            "skip_blocked_reserved_stock",
            {"skipped": "blocked_reserved_stock"},
        )
        return {"skipped": "blocked_reserved_stock", "vp_id": int(po.id)}
    vp_code = (po.vp_code or "").strip()
    if not vp_code:
        return {"skipped": "no_vp_code", "vp_id": int(po.id)}

    _vp_planning_pipeline_snapshot(db, po, "enter", None)

    existing = db.scalars(select(PlanningOperation).where(PlanningOperation.work_order_no == vp_code)).all()
    if existing:
        states = [str(x.status or "") for x in existing]
        mids = sorted({int(x.machine_id) for x in existing if x.machine_id is not None})
        logger.info(
            "[planning_bridge] ensure_skip vp_id=%s vp_code=%s existing_planning_ops=%s machine_ids=%s states=%s",
            int(po.id),
            vp_code,
            len(existing),
            mids,
            states[:12],
        )
        norm = normalize_planning_queue_statuses_for_vp_code(db, vp_code)
        out_existing = {
            "skipped": "already_exists",
            "vp_id": int(po.id),
            "vp_code": vp_code,
            "planning_ops": len(existing),
            "machine_ids": mids,
            "states_sample": states[:12],
            "queue_normalize": norm,
        }
        _vp_planning_pipeline_snapshot(db, po, "skip_already_exists", out_existing)
        return out_existing

    job_item = db.get(JobItem, po.job_item_id) if po.job_item_id is not None else None
    if job_item is None:
        _vp_planning_pipeline_snapshot(
            db,
            po,
            "skip_no_job_item",
            {"skipped": "no_job_item", "vp_code": vp_code},
        )
        return {"skipped": "no_job_item", "vp_id": int(po.id), "vp_code": vp_code}

    pid = int(po.portfolio_item_id) if po.portfolio_item_id is not None else None
    if pid is None:
        cols = {r[1] for r in db.execute(text("PRAGMA table_info(job_items)")).fetchall()}
        if "portfolio_item_id" in cols:
            row = db.execute(
                text("SELECT portfolio_item_id FROM job_items WHERE id = :id"),
                {"id": int(job_item.id)},
            ).fetchone()
            if row is not None and row[0] is not None:
                pid = int(row[0])
    tpl = _select_active_portfolio_tp(db, pid)
    if tpl is not None:
        out = _create_planning_ops_from_portfolio_tp(db, po=po, job_item=job_item, tpl=tpl)
        logger.info(
            "[planning_bridge] ensure_portfolio vp_id=%s vp_code=%s created=%s skipped_machines=%s",
            int(po.id),
            vp_code,
            out.get("created"),
            len(out.get("skipped") or []),
        )
        _vp_planning_pipeline_snapshot(db, po, "after_portfolio_tp", out)
        return out

    template = db.scalar(select(TechnologyTemplate).where(TechnologyTemplate.gpn == job_item.gpn))
    if template is None:
        logger.warning(
            "[planning_bridge] ensure_fail vp_id=%s vp_code=%s gpn=%s reason=no_portfolio_tp_no_technology_template",
            int(po.id),
            vp_code,
            job_item.gpn,
        )
        out_fail = {"skipped": "no_template", "vp_id": int(po.id), "vp_code": vp_code, "gpn": job_item.gpn}
        _vp_planning_pipeline_snapshot(db, po, "skip_no_template", out_fail)
        return out_fail

    out = _create_planning_ops_from_technology_library(db, po=po, job_item=job_item, template=template)
    logger.info(
        "[planning_bridge] ensure_technology_library vp_id=%s vp_code=%s created=%s",
        int(po.id),
        vp_code,
        out.get("created"),
    )
    _vp_planning_pipeline_snapshot(db, po, "after_technology_library", out)
    return out


def generate_operations_from_vp(db: Session):
    created = []

    vps = db.scalars(select(ProductionOrder).order_by(ProductionOrder.id.asc())).all()

    for vp in vps:
        job_item = db.get(JobItem, vp.job_item_id)
        if not job_item:
            continue

        existing = db.scalars(select(PlanningOperation).where(PlanningOperation.work_order_no == vp.vp_code)).all()
        if existing:
            normalize_planning_queue_statuses_for_vp_code(db, vp.vp_code)
            continue

        info = ensure_planning_operations_for_production_order(db, vp)
        if info.get("skipped") != "already_exists":
            created.append({"vp": vp.vp_code, **info})

    db.commit()
    return created


def regenerate_operations_from_tp(db: Session):
    """
    Smaže existující VP operation rows + planning_operations VP (bez chráněných stavů) a znovu je vytvoří stejnou
    cestou jako při vzniku VP: portfolio TP (kanonický postup), jinak technology_library.
    Dříve se zde vždy brala jen technology_library — mohla obsahovat jiný počet kroků než portfolio TP
    (např. další logistické operace) a plánovač tak neodpovídal řádnému TP výrobku.
    """
    changed: list[dict] = []

    vps = db.scalars(select(ProductionOrder).order_by(ProductionOrder.id.asc())).all()

    for vp in vps:
        job_item = db.get(JobItem, vp.job_item_id)
        if not job_item:
            continue
        if not workflow_record_active(vp):
            changed.append({"vp": vp.vp_code, "status": "SKIPPED - workflow_inactive"})
            continue
        if bool(getattr(vp, "blocked_until_reserved_stock_receipt", False)):
            changed.append({"vp": vp.vp_code, "status": "SKIPPED - blocked_reserved_stock"})
            continue

        ops = db.scalars(select(PlanningOperation).where(PlanningOperation.work_order_no == vp.vp_code)).all()

        blocked_running = _regenerate_blocked_by_running_ops(ops)
        if blocked_running:
            changed.append(
                {
                    "vp": vp.vp_code,
                    "gpn": job_item.gpn,
                    "status": "SKIPPED - running operation exists",
                }
            )
            continue

        vp_ops_created = _rebuild_production_order_operation_rows_from_current_tp(db, po=vp, job_item=job_item)

        op_ids = [op.id for op in ops]
        if op_ids:
            db.execute(delete(PlanningScheduleSegment).where(PlanningScheduleSegment.planning_operation_id.in_(op_ids)))
            db.execute(delete(MachineSchedule).where(MachineSchedule.planning_operation_id.in_(op_ids)))
            db.execute(delete(PlanningOperation).where(PlanningOperation.id.in_(op_ids)))
            db.flush()

        info = ensure_planning_operations_for_production_order(db, vp)
        row = {
            "vp": vp.vp_code,
            "gpn": job_item.gpn,
            "regenerate": True,
            "production_order_operations_rebuilt": int(vp_ops_created),
            **info,
        }
        changed.append(row)
        if info.get("created", 0) and not info.get("skipped"):
            logger.info("[planning_bridge] regenerate_vp vp_code=%s created=%s source=%s", vp.vp_code, info.get("created"), info.get("source"))

    db.commit()
    return changed


def regenerate_single_production_order_from_tp(db: Session, po: ProductionOrder) -> dict[str, Any]:
    """
    Rebuild one VP from current TP:
    - rewrite production_order_operations with normalized numbering (10,20,30,...)
    - recreate planning_operations for this VP
    Caller handles transaction/commit and optional planner rebuild.
    """
    if po is None:
        return {"status": "SKIPPED - no_po"}
    if not workflow_record_active(po):
        return {"vp": po.vp_code, "status": "SKIPPED - workflow_inactive"}
    if bool(getattr(po, "blocked_until_reserved_stock_receipt", False)):
        return {"vp": po.vp_code, "status": "SKIPPED - blocked_reserved_stock"}

    job_item = db.get(JobItem, po.job_item_id)
    if not job_item:
        return {"vp": po.vp_code, "status": "SKIPPED - no_job_item"}

    ops = db.scalars(select(PlanningOperation).where(PlanningOperation.work_order_no == po.vp_code)).all()
    if _regenerate_blocked_by_running_ops(ops):
        return {"vp": po.vp_code, "gpn": job_item.gpn, "status": "SKIPPED - running operation exists"}

    vp_ops_created = _rebuild_production_order_operation_rows_from_current_tp(db, po=po, job_item=job_item)

    op_ids = [op.id for op in ops]
    if op_ids:
        db.execute(delete(PlanningScheduleSegment).where(PlanningScheduleSegment.planning_operation_id.in_(op_ids)))
        db.execute(delete(MachineSchedule).where(MachineSchedule.planning_operation_id.in_(op_ids)))
        db.execute(delete(PlanningOperation).where(PlanningOperation.id.in_(op_ids)))
        db.flush()

    info = ensure_planning_operations_for_production_order(db, po)
    return {
        "vp": po.vp_code,
        "gpn": job_item.gpn,
        "regenerate": True,
        "production_order_operations_rebuilt": int(vp_ops_created),
        **info,
    }
