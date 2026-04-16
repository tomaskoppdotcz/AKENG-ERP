"""Provozní metriky VP z runtime dat (work_reports, planning_operations, sazby zaměstnanců)."""

from __future__ import annotations

from collections import defaultdict

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.kiosk import Employee
from app.models.master_data import Machine
from app.models.orders import ProductionOrder
from app.models.planning import PlanningOperation
from app.models.work_report import WorkReport
from app.services.planning_operation_status import normalize_planning_operation_status


def vp_operational_metrics_map(
    db: Session,
    production_orders: list[ProductionOrder],
) -> dict[int, dict[str, float | int | str | None]]:
    """
    Metriky pro více VP najednou (minimalizace dotazů).
    """
    if not production_orders:
        return {}

    po_ids = [int(p.id) for p in production_orders]
    code_by_po_id: dict[int, str] = {}
    for p in production_orders:
        vc = (p.vp_code or "").strip()
        if vc:
            code_by_po_id[int(p.id)] = vc

    time_rows = db.execute(
        select(
            WorkReport.production_order_id,
            func.coalesce(func.sum(func.coalesce(WorkReport.duration_min, 0.0)), 0.0),
        )
        .where(WorkReport.production_order_id.in_(po_ids))
        .group_by(WorkReport.production_order_id)
    ).all()
    reported_by_po: dict[int, float] = {int(r[0]): float(r[1] or 0) for r in time_rows}

    cost_rows = db.execute(
        select(
            WorkReport.production_order_id,
            func.coalesce(
                func.sum(
                    (func.coalesce(WorkReport.duration_min, 0.0) / 60.0)
                    * func.coalesce(Employee.cost_rate_per_hour, 0.0)
                ),
                0.0,
            ),
        )
        .select_from(WorkReport)
        .join(Employee, Employee.id == WorkReport.employee_id)
        .where(WorkReport.production_order_id.in_(po_ids))
        .where(WorkReport.employee_id.isnot(None))
        .where(Employee.cost_rate_per_hour.isnot(None))
        .group_by(WorkReport.production_order_id)
    ).all()
    cost_by_po: dict[int, float] = {int(r[0]): float(r[1] or 0) for r in cost_rows}

    codes = sorted({c for c in code_by_po_id.values() if c})
    pl_by_code: dict[str, list[PlanningOperation]] = defaultdict(list)
    if codes:
        pl_rows = db.scalars(
            select(PlanningOperation)
            .where(PlanningOperation.work_order_no.in_(codes))
            .order_by(PlanningOperation.operation_no.asc(), PlanningOperation.id.asc())
        ).all()
        for o in pl_rows:
            wn = (o.work_order_no or "").strip()
            if wn:
                pl_by_code[wn].append(o)

    machine_ids: set[int] = set()
    for lst in pl_by_code.values():
        for o in lst:
            if normalize_planning_operation_status(o.status) == "bezi" and o.machine_id is not None:
                machine_ids.add(int(o.machine_id))
    machines: dict[int, Machine] = {}
    if machine_ids:
        for m in db.scalars(select(Machine).where(Machine.id.in_(sorted(machine_ids)))).all():
            machines[int(m.id)] = m

    out: dict[int, dict[str, float | int | str | None]] = {}
    for pid in po_ids:
        vc = code_by_po_id.get(pid, "")
        pl_ops = pl_by_code.get(vc, [])
        reported_time_min = float(reported_by_po.get(pid, 0.0))
        direct_labor_cost = float(cost_by_po.get(pid, 0.0))

        total_ops = len(pl_ops)
        done = 0
        planned_total = 0.0
        if total_ops <= 0:
            completion_percent: float | None = None
            performance_percent: float | None = None
            current_phase: str | None = None
        else:
            done = sum(
                1
                for o in pl_ops
                if normalize_planning_operation_status(getattr(o, "status", None)) == "hotovo"
            )
            completion_percent = round(100.0 * float(done) / float(total_ops), 1)
            planned_total = float(
                sum(float(getattr(o, "total_operation_time_min", 0) or 0) for o in pl_ops)
            )
            if planned_total <= 0 or reported_time_min <= 1e-9:
                performance_percent = None
            else:
                performance_percent = round(100.0 * planned_total / reported_time_min, 1)

            any_bezi = any(
                normalize_planning_operation_status(getattr(o, "status", None)) == "bezi" for o in pl_ops
            )
            if done == total_ops:
                current_phase = "hotovo"
            elif any_bezi:
                current_phase = "bezi"
            else:
                current_phase = "planned"

        current_location: str | None = None
        if pl_ops:
            running = [
                o
                for o in pl_ops
                if normalize_planning_operation_status(getattr(o, "status", None)) == "bezi"
            ]
            running.sort(key=lambda x: (int(x.operation_no or 0), int(x.id or 0)))
            if running:
                mid = running[0].machine_id
                if mid is not None:
                    mm = machines.get(int(mid))
                    if mm is not None:
                        nm = (mm.name or "").strip()
                        current_location = nm or (mm.machine_code or "").strip() or None

        out[pid] = {
            "reported_time_min": int(round(reported_time_min)),
            "direct_labor_cost": round(direct_labor_cost, 2),
            "completion_percent": completion_percent,
            "performance_percent": performance_percent,
            "current_location": current_location,
            "current_phase": current_phase,
            "planned_runtime_total_min": float(planned_total) if total_ops > 0 else 0.0,
            "planning_operations_total": int(total_ops),
            "planning_operations_done": int(done),
        }
    return out


OPERATIONAL_METRICS_EMPTY: dict[str, int | float | str | None] = {
    "reported_time_min": 0,
    "direct_labor_cost": 0.0,
    "completion_percent": None,
    "performance_percent": None,
    "current_phase": None,
    "current_location": None,
    "operational_summary_cs": None,
}


def aggregate_operational_metrics_for_po_subset(
    vp_metrics_by_po_id: dict[int, dict[str, float | int | str | None]],
    production_orders: list[ProductionOrder],
) -> dict[str, int | float | str | None]:
    """
    Součty a dominantní fáze přes podmnožinu VP; vp_metrics_by_po_id = výstup z vp_operational_metrics_map.
    Poloha: první neprázdná z VP ve fázi „bezi“ (pořadí podle id VP).
    """
    if not production_orders:
        return {**OPERATIONAL_METRICS_EMPTY}

    lst = sorted(production_orders, key=lambda p: int(p.id))
    reported = 0
    labor = 0.0
    planned_sum = 0.0
    done_ops = 0
    total_ops = 0
    phase_list: list[str | None] = []
    cur_loc: str | None = None

    for p in lst:
        m = vp_metrics_by_po_id.get(int(p.id)) or {}
        reported += int(m.get("reported_time_min") or 0)
        labor += float(m.get("direct_labor_cost") or 0.0)
        planned_sum += float(m.get("planned_runtime_total_min") or 0.0)
        done_ops += int(m.get("planning_operations_done") or 0)
        total_ops += int(m.get("planning_operations_total") or 0)
        ph = m.get("current_phase")
        phase_list.append(ph if isinstance(ph, str) else None)
        if cur_loc is None and ph == "bezi":
            loc = m.get("current_location")
            if isinstance(loc, str) and loc.strip():
                cur_loc = loc.strip()

    completion = round(100.0 * float(done_ops) / float(total_ops), 1) if total_ops > 0 else None
    performance = (
        round(100.0 * planned_sum / float(reported), 1) if reported > 1e-9 and planned_sum > 0 else None
    )

    n_bez = sum(1 for x in phase_list if x == "bezi")
    n_hot = sum(1 for x in phase_list if x == "hotovo")
    n_wait = sum(1 for x in phase_list if x not in ("bezi", "hotovo"))
    parts: list[str] = []
    if n_bez:
        parts.append(f"{n_bez} VP běží")
    if n_hot:
        parts.append(f"{n_hot} VP hotovo")
    if n_wait:
        parts.append(f"{n_wait} VP čeká")
    summary = ", ".join(parts) if parts else None

    if n_bez > 0:
        dom_phase = "bezi"
    elif phase_list and all(x == "hotovo" for x in phase_list):
        dom_phase = "hotovo"
    else:
        dom_phase = "planned"

    return {
        "reported_time_min": int(reported),
        "direct_labor_cost": round(labor, 2),
        "completion_percent": completion,
        "performance_percent": performance,
        "current_phase": dom_phase,
        "current_location": cur_loc,
        "operational_summary_cs": summary,
    }


def vp_operational_metrics_single(db: Session, po: ProductionOrder) -> dict[str, float | int | str | None]:
    m = vp_operational_metrics_map(db, [po])
    return m.get(int(po.id)) or {
        "reported_time_min": 0,
        "direct_labor_cost": 0.0,
        "completion_percent": None,
        "performance_percent": None,
        "current_location": None,
        "current_phase": None,
        "planned_runtime_total_min": 0.0,
        "planning_operations_total": 0,
        "planning_operations_done": 0,
    }
