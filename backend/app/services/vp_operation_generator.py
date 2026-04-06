import logging
from typing import Any

from sqlalchemy import delete, func, select, text
from sqlalchemy.orm import Session

from app.models.master_data import Machine
from app.services.workplace_scheduling_anchor import get_or_create_scheduling_machine_for_workplace
from app.models.orders import JobItem, ProductionOrder, ProductionOrderOperation
from app.models.portfolio import PortfolioTechnologyTemplate, PortfolioTechnologyTemplateOperation
from app.models.technology_library import TechnologyTemplate
from app.models.planning import PlanningOperation, MachineSchedule
from app.services.business_workflow import workflow_record_active

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


def _planning_op_status_is_protected(status: str | None) -> bool:
    s = (status or "").strip().lower()
    return s in {
        "finished",
        "in_progress",
        "started",
        "cancelled",
        "done",
        "complete",
        "completed",
        "hotovo",
        "bezi",
        "running",
    }


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
        if _planning_op_status_is_protected(o.status):
            continue
        head = o
        break
    if head is None:
        return {"normalized": False, "reason": "all_protected"}

    updated = 0
    head_st = (head.status or "").strip().lower()
    if head_st == "planned":
        pass
    elif head_st != "ready":
        head.status = "ready"
        updated += 1

    for o in ops:
        if o.id == head.id:
            continue
        if _planning_op_status_is_protected(o.status):
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

    resolved: list[tuple[PortfolioTechnologyTemplateOperation, Machine]] = []
    skipped: list[dict] = []
    for op in op_rows:
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
        resolved.append((op, machine))

    if not resolved:
        return {
            "source": "portfolio_tp",
            "created": 0,
            "vp_id": int(po.id),
            "vp_code": vp_code,
            "skipped": skipped,
            "reason": "no_machine_for_any_operation",
        }

    first_no = min(int(x[0].operation_no) for x in resolved)
    created = 0
    for op, machine in resolved:
        setup = float(op.setup_min or 0)
        run_piece = float(op.run_min_per_piece or 0)
        total_labor = run_piece * float(qty_pl)
        total_time = setup + total_labor
        st = "ready" if int(op.operation_no) == first_no else "waiting_release"
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
            operation_no=int(op.operation_no),
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
        "first_ready_operation_no": first_no,
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

    resolved: list[tuple] = []
    skipped: list[dict] = []
    for op in sorted(template.operations, key=lambda x: (int(x.operation_no or 0), int(x.id))):
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
        resolved.append((op, machine))

    if not resolved:
        return {
            "source": "technology_library",
            "created": 0,
            "vp_id": int(po.id),
            "vp_code": vp_code,
            "skipped": skipped,
            "reason": "no_machine_for_any_operation",
        }

    first_no = min(int(x[0].operation_no) for x in resolved)
    created = 0
    for op, machine in resolved:
        total_labor = float(op.labor_time_per_piece_min or 0) * float(qty_pl)
        total_time = float(op.setup_time_min or 0) + total_labor
        st = "ready" if int(op.operation_no) == first_no else "waiting_release"
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
            operation_no=int(op.operation_no),
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
        "first_ready_operation_no": first_no,
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
    changed = []

    vps = db.scalars(select(ProductionOrder).order_by(ProductionOrder.id.asc())).all()

    for vp in vps:
        job_item = db.get(JobItem, vp.job_item_id)
        if not job_item:
            continue

        template = db.scalar(select(TechnologyTemplate).where(TechnologyTemplate.gpn == job_item.gpn))
        if not template:
            continue

        ops = db.scalars(select(PlanningOperation).where(PlanningOperation.work_order_no == vp.vp_code)).all()

        protected_statuses = {"finished", "in_progress", "started"}
        has_protected = any((op.status or "").lower() in protected_statuses for op in ops)
        if has_protected:
            changed.append(
                {
                    "vp": vp.vp_code,
                    "gpn": job_item.gpn,
                    "status": "SKIPPED - protected operation exists",
                }
            )
            continue

        op_ids = [op.id for op in ops]
        if op_ids:
            db.execute(delete(MachineSchedule).where(MachineSchedule.planning_operation_id.in_(op_ids)))
            db.execute(delete(PlanningOperation).where(PlanningOperation.id.in_(op_ids)))
            db.flush()

        input_diameter = _extract_diameter_from_template(template)

        resolved_regen: list[tuple] = []
        for tpl_op in sorted(template.operations, key=lambda x: (int(x.operation_no or 0), int(x.id))):
            machine = db.scalar(select(Machine).where(Machine.machine_code == tpl_op.machine_code))
            if not machine:
                changed.append(
                    {
                        "vp": vp.vp_code,
                        "gpn": job_item.gpn,
                        "operation": tpl_op.operation_name,
                        "status": f"SKIPPED - machine_code not found: {tpl_op.machine_code}",
                    }
                )
                continue
            resolved_regen.append((tpl_op, machine))

        first_no_r = min(int(x[0].operation_no) for x in resolved_regen) if resolved_regen else None
        for tpl_op, machine in resolved_regen:
            total_labor = float(tpl_op.labor_time_per_piece_min or 0) * int(job_item.qty or 0)
            total_time = float(tpl_op.setup_time_min or 0) + total_labor
            st = "ready" if first_no_r is not None and int(tpl_op.operation_no) == first_no_r else "waiting_release"

            db.add(
                PlanningOperation(
                    order_item_id=job_item.id,
                    product_group_id=None,
                    work_order_no=vp.vp_code,
                    gpn=job_item.gpn,
                    operation_name=tpl_op.operation_name,
                    operation_no=tpl_op.operation_no,
                    machine_id=machine.id,
                    qty=job_item.qty,
                    input_diameter_mm=input_diameter,
                    setup_time_min=float(tpl_op.setup_time_min or 0),
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
                    buffer_after_min=int(tpl_op.buffer_after_min or 20),
                    queue_position=None,
                    material_ready=bool(getattr(vp, "is_material_released_to_production", False)),
                    status=st,
                    planning_mode="auto",
                    is_locked=False,
                )
            )

            changed.append(
                {
                    "vp": vp.vp_code,
                    "gpn": job_item.gpn,
                    "operation_no": tpl_op.operation_no,
                    "operation": tpl_op.operation_name,
                    "machine_code": tpl_op.machine_code,
                    "product_group": template.product_group,
                    "input_diameter_mm": input_diameter,
                    "status": "REGENERATED",
                }
            )

        if resolved_regen:
            normalize_planning_queue_statuses_for_vp_code(db, vp.vp_code)

    db.commit()
    return changed
