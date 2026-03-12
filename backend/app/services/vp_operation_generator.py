from sqlalchemy.orm import Session
from sqlalchemy import select, delete

from app.models.orders import ProductionOrder, JobItem
from app.models.technology_library import TechnologyTemplate
from app.models.planning import PlanningOperation, MachineSchedule
from app.models.master_data import Machine


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
            except Exception:
                pass
    return None


def generate_operations_from_vp(db: Session):
    created = []

    vps = db.scalars(select(ProductionOrder).order_by(ProductionOrder.id.asc())).all()

    for vp in vps:
        job_item = db.get(JobItem, vp.job_item_id)
        if not job_item:
            continue

        gpn = job_item.gpn

        template = db.scalar(
            select(TechnologyTemplate).where(TechnologyTemplate.gpn == gpn)
        )
        if not template:
            continue

        existing = db.scalars(
            select(PlanningOperation).where(PlanningOperation.work_order_no == vp.vp_code)
        ).all()
        if existing:
            continue

        input_diameter = _extract_diameter_from_template(template)

        for op in template.operations:
            machine = db.scalar(
                select(Machine).where(Machine.machine_code == op.machine_code)
            )
            if not machine:
                created.append(
                    {
                        "vp": vp.vp_code,
                        "gpn": gpn,
                        "operation": op.operation_name,
                        "status": f"SKIPPED - machine_code not found: {op.machine_code}",
                    }
                )
                continue

            total_labor = float(op.labor_time_per_piece_min or 0) * int(job_item.qty or 0)
            total_time = float(op.setup_time_min or 0) + total_labor

            status = "ready" if op.operation_no == 10 else "waiting_release"

            planning = PlanningOperation(
                order_item_id=job_item.id,
                product_group_id=None,
                work_order_no=vp.vp_code,
                gpn=gpn,
                operation_name=op.operation_name,
                operation_no=op.operation_no,
                machine_id=machine.id,
                qty=job_item.qty,
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
                material_ready=True,
                status=status,
                planning_mode="auto",
                is_locked=False,
            )

            db.add(planning)

            created.append(
                {
                    "vp": vp.vp_code,
                    "gpn": gpn,
                    "operation_no": op.operation_no,
                    "operation": op.operation_name,
                    "machine_code": op.machine_code,
                    "machine_id": machine.id,
                    "product_group": template.product_group,
                    "input_diameter_mm": input_diameter,
                    "status": status,
                }
            )

    db.commit()
    return created


def regenerate_operations_from_tp(db: Session):
    changed = []

    vps = db.scalars(select(ProductionOrder).order_by(ProductionOrder.id.asc())).all()

    for vp in vps:
        job_item = db.get(JobItem, vp.job_item_id)
        if not job_item:
            continue

        template = db.scalar(
            select(TechnologyTemplate).where(TechnologyTemplate.gpn == job_item.gpn)
        )
        if not template:
            continue

        ops = db.scalars(
            select(PlanningOperation).where(PlanningOperation.work_order_no == vp.vp_code)
        ).all()

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
            db.execute(
                delete(MachineSchedule).where(MachineSchedule.planning_operation_id.in_(op_ids))
            )
            db.execute(
                delete(PlanningOperation).where(PlanningOperation.id.in_(op_ids))
            )
            db.flush()

        input_diameter = _extract_diameter_from_template(template)

        for tpl_op in template.operations:
            machine = db.scalar(
                select(Machine).where(Machine.machine_code == tpl_op.machine_code)
            )
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

            total_labor = float(tpl_op.labor_time_per_piece_min or 0) * int(job_item.qty or 0)
            total_time = float(tpl_op.setup_time_min or 0) + total_labor

            status = "ready" if tpl_op.operation_no == 10 else "waiting_release"

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
                    material_ready=True,
                    status=status,
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

    db.commit()
    return changed
