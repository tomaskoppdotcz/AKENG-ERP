"""Production metrics calculated from planning runtime and operation_events."""

from __future__ import annotations

from collections import Counter, defaultdict
from datetime import datetime
import math
import re

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.models.kiosk import Employee, OperationEvent
from app.models.master_data import Machine
from app.models.material_library import MaterialLibraryItem
from app.models.material_stock import MaterialStockItem, MaterialStockMovement
from app.models.orders import ProductionOrder
from app.models.planning import PlanningOperation
from app.services.operation_tracking_service import (
    EVENT_DONE,
    EVENT_PAUSE,
    EVENT_RESUME,
    EVENT_START,
    TRACKING_EVENT_TYPES,
)


def _safe_float(value: object) -> float:
    try:
        return float(value or 0.0)
    except (TypeError, ValueError):
        return 0.0


def machine_hourly_rate(machine: Machine | None) -> float:
    if machine is None:
        return 0.0
    return max(0.0, _safe_float(getattr(machine, "hourly_rate", None)))


def _rate_value(value: object) -> float | None:
    try:
        rate = float(value)
    except (TypeError, ValueError):
        return None
    return rate if math.isfinite(rate) and rate > 0 else None


def employee_hourly_cost_rate(employee: Employee | None) -> float | None:
    if employee is None:
        return None
    return _rate_value(getattr(employee, "hourly_cost_rate", None)) or _rate_value(
        getattr(employee, "cost_rate_per_hour", None)
    )


def machine_hourly_cost_rate(machine: Machine | None) -> float | None:
    if machine is None:
        return None
    return _rate_value(getattr(machine, "hourly_rate", None))


def _positive_float(value: object) -> float | None:
    try:
        out = float(value)
    except (TypeError, ValueError):
        return None
    return out if math.isfinite(out) and out > 0 else None


def _parse_first_dimension_mm(dimension: str | None) -> float | None:
    if dimension is None:
        return None
    raw = str(dimension).strip().replace(" ", "")
    if not raw:
        return None
    m = re.match(r"^([\d]+(?:[.,]\d+)?)", raw)
    if not m:
        return None
    return _positive_float(m.group(1).replace(",", "."))


def _density_g_cm3(value: object) -> float | None:
    density = _positive_float(value)
    if density is None:
        return None
    # Some library rows use kg/m3 (7850), newer seed data uses g/cm3 (7.85).
    return density / 1000.0 if density > 100.0 else density


def _is_round_bar(material: MaterialLibraryItem | None) -> bool:
    form = str(getattr(material, "form", "") or "").strip().lower()
    return "kruhov" in form or "round" in form


def _round_bar_weight_kg(
    *,
    diameter_mm: float,
    length_mm: float,
    density_g_cm3: float = 7.85,
) -> float:
    return math.pi * (diameter_mm / 2.0) ** 2 * length_mm * density_g_cm3 / 1_000_000.0


def _movement_material_cost(movement: MaterialStockMovement) -> tuple[float, bool]:
    qty = _positive_float(getattr(movement, "qty", None))
    stock_item = getattr(movement, "stock_item", None)
    material = getattr(stock_item, "material_library_item", None) if stock_item is not None else None
    price_per_kg = _positive_float(getattr(material, "price_per_kg", None))
    if qty is None or price_per_kg is None:
        return 0.0, True

    weight_per_piece_kg = _positive_float(getattr(movement, "weight_per_piece_kg", None))
    if weight_per_piece_kg is not None:
        return weight_per_piece_kg * qty * price_per_kg, False

    if _is_round_bar(material):
        diameter_mm = _parse_first_dimension_mm(getattr(material, "dimension", None))
        if diameter_mm is None:
            return 0.0, True
        density = _density_g_cm3(getattr(material, "density", None)) or 7.85
        return _round_bar_weight_kg(diameter_mm=diameter_mm, length_mm=qty, density_g_cm3=density) * price_per_kg, False

    return 0.0, True


def production_order_material_cost_metrics(db: Session, po: ProductionOrder) -> dict[str, float | bool]:
    if po.id is None:
        return {"material_cost": 0.0, "missing_material_cost_data": False}

    movements = list(
        db.scalars(
            select(MaterialStockMovement)
            .where(MaterialStockMovement.production_order_id == int(po.id))
            .where(MaterialStockMovement.movement_type.in_(("vydej", "vydej_zbytek")))
            .options(
                joinedload(MaterialStockMovement.stock_item).joinedload(MaterialStockItem.material_library_item),
            )
            .order_by(MaterialStockMovement.id.asc())
        ).all()
    )
    material_cost = 0.0
    missing_material_cost_data = False
    for movement in movements:
        cost, missing = _movement_material_cost(movement)
        material_cost += cost
        missing_material_cost_data = missing_material_cost_data or missing

    return {
        "material_cost": round(material_cost, 2),
        "missing_material_cost_data": bool(missing_material_cost_data),
    }


def planned_operation_time_min(op: PlanningOperation) -> float:
    setup = max(0.0, _safe_float(getattr(op, "setup_time_min", 0.0)))
    qty_ok_raw = getattr(op, "qty_ok", None)
    qty_ok = max(0.0, _safe_float(qty_ok_raw))

    labor_per_piece = _safe_float(getattr(op, "labor_time_min", None))
    if labor_per_piece <= 0:
        planned_qty = max(0.0, _safe_float(getattr(op, "qty", 0)))
        total_labor = max(0.0, _safe_float(getattr(op, "total_labor_time_min", 0.0)))
        if total_labor <= 0:
            total_operation = max(0.0, _safe_float(getattr(op, "total_operation_time_min", 0.0)))
            total_labor = max(0.0, total_operation - setup)
        labor_per_piece = total_labor / planned_qty if planned_qty > 0 else 0.0

    return setup + (qty_ok * labor_per_piece)


def _event_timestamp(event: OperationEvent) -> datetime | None:
    return getattr(event, "timestamp", None) or getattr(event, "event_time", None)


def _event_employee_id(event: OperationEvent) -> int | None:
    raw = getattr(event, "user_id", None)
    if raw is None:
        raw = getattr(event, "employee_id", None)
    try:
        return int(raw) if raw is not None else None
    except (TypeError, ValueError):
        return None


def operator_id_from_events(events: list[OperationEvent]) -> int | None:
    ordered = sorted(events, key=lambda e: (_event_timestamp(e) or datetime.min, int(e.id or 0)))
    for event in ordered:
        if event.event_type == EVENT_START:
            operator_id = _event_employee_id(event)
            if operator_id is not None:
                return operator_id

    counts = Counter(operator_id for event in ordered if (operator_id := _event_employee_id(event)) is not None)
    if not counts:
        return None
    return counts.most_common(1)[0][0]


def _runtime_window_from_events(
    op: PlanningOperation,
    events: list[OperationEvent],
) -> tuple[datetime | None, datetime | None]:
    ordered = sorted(events, key=lambda e: (_event_timestamp(e) or datetime.min, int(e.id or 0)))
    event_start = next(
        (_event_timestamp(event) for event in ordered if event.event_type == EVENT_START and _event_timestamp(event)),
        None,
    )
    event_end = next(
        (_event_timestamp(event) for event in ordered if event.event_type == EVENT_DONE and _event_timestamp(event)),
        None,
    )
    if event_start is not None:
        return event_start, event_end or getattr(op, "actual_end", None)
    return getattr(op, "actual_start", None), getattr(op, "actual_end", None)


def _overlap_seconds(start_at: datetime, end_at: datetime, window_start: datetime, window_end: datetime) -> int:
    effective_start = max(start_at, window_start)
    effective_end = min(end_at, window_end)
    return max(0, int((effective_end - effective_start).total_seconds()))


def pause_time_seconds_from_events(
    events: list[OperationEvent],
    *,
    actual_start: datetime,
    actual_end: datetime,
) -> int:
    pause_started_at: datetime | None = None
    pause_seconds = 0

    for event in sorted(events, key=lambda e: (_event_timestamp(e) or datetime.min, int(e.id or 0))):
        ts = _event_timestamp(event)
        if ts is None:
            continue
        if event.event_type == EVENT_PAUSE and pause_started_at is None:
            pause_started_at = ts
        elif event.event_type in {EVENT_RESUME, EVENT_DONE} and pause_started_at is not None:
            pause_seconds += _overlap_seconds(pause_started_at, ts, actual_start, actual_end)
            pause_started_at = None
        if event.event_type == EVENT_DONE:
            break

    if pause_started_at is not None:
        pause_seconds += _overlap_seconds(pause_started_at, actual_end, actual_start, actual_end)

    elapsed_seconds = max(0, int((actual_end - actual_start).total_seconds()))
    return max(0, min(pause_seconds, elapsed_seconds))


def operation_metrics_from_events(
    op: PlanningOperation,
    events: list[OperationEvent],
    *,
    machine: Machine | None = None,
    employee: Employee | None = None,
) -> dict[str, float | None]:
    actual_start, actual_end = _runtime_window_from_events(op, events)
    if actual_start is None or actual_end is None or actual_end < actual_start:
        elapsed_min = 0.0
        pause_min = 0.0
        working_min = 0.0
    else:
        elapsed_seconds = max(0, int((actual_end - actual_start).total_seconds()))
        pause_seconds = pause_time_seconds_from_events(events, actual_start=actual_start, actual_end=actual_end)
        elapsed_min = elapsed_seconds / 60.0
        pause_min = pause_seconds / 60.0
        working_min = max(0, elapsed_seconds - pause_seconds) / 60.0

    planned_min = planned_operation_time_min(op)
    working_hours = working_min / 60.0
    employee_rate = employee_hourly_cost_rate(employee)
    machine_rate = machine_hourly_cost_rate(machine)
    employee_labor_cost = working_hours * (employee_rate or 0.0)
    machine_cost = working_hours * (machine_rate or 0.0)
    labor_cost = employee_labor_cost + machine_cost
    performance_percent = (
        round((planned_min / working_min) * 100.0, 1) if planned_min > 0 and working_min > 1e-9 else None
    )

    return {
        "elapsed_time_min": round(elapsed_min, 2),
        "pause_time_min": round(pause_min, 2),
        "working_time_min": round(working_min, 2),
        "planned_time_min": round(planned_min, 2),
        "employee_labor_cost": round(employee_labor_cost, 2),
        "machine_cost": round(machine_cost, 2),
        "labor_cost": round(labor_cost, 2),
        "missing_employee_rate": bool(working_min > 1e-9 and employee_rate is None),
        "missing_machine_rate": bool(working_min > 1e-9 and machine_rate is None),
        "performance_percent": performance_percent,
    }


def operation_event_runtime_metrics_by_planning_id(
    db: Session,
    planning_operations: list[PlanningOperation],
    machines_by_id: dict[int, Machine] | None = None,
) -> dict[int, dict[str, float | None]]:
    planning_ids = [int(o.id) for o in planning_operations if o.id is not None]
    if not planning_ids:
        return {}

    events_by_planning_id: dict[int, list[OperationEvent]] = defaultdict(list)
    events = db.scalars(
        select(OperationEvent)
        .where(OperationEvent.planning_operation_id.in_(planning_ids))
        .where(OperationEvent.event_type.in_(tuple(TRACKING_EVENT_TYPES)))
        .order_by(
            OperationEvent.planning_operation_id.asc(),
            OperationEvent.timestamp.asc(),
            OperationEvent.id.asc(),
        )
    ).all()
    for event in events:
        events_by_planning_id[int(event.planning_operation_id)].append(event)

    machines = machines_by_id or {}
    operator_ids = {
        operator_id
        for event_list in events_by_planning_id.values()
        if (operator_id := operator_id_from_events(event_list)) is not None
    }
    employees_by_id = (
        {int(e.id): e for e in db.scalars(select(Employee).where(Employee.id.in_(sorted(operator_ids)))).all()}
        if operator_ids
        else {}
    )
    return {
        int(op.id): operation_metrics_from_events(
            op,
            events_by_planning_id.get(int(op.id), []),
            machine=machines.get(int(op.machine_id)) if op.machine_id is not None else None,
            employee=employees_by_id.get(operator_id_from_events(events_by_planning_id.get(int(op.id), []))),
        )
        for op in planning_operations
        if op.id is not None
    }


def production_order_metrics(db: Session, po: ProductionOrder) -> dict[str, float | None]:
    material_metrics = production_order_material_cost_metrics(db, po)
    vp_code = (po.vp_code or "").strip()
    if not vp_code:
        return {
            "reported_time_min": 0.0,
            "employee_labor_cost": 0.0,
            "machine_cost": 0.0,
            "labor_cost": 0.0,
            "material_cost": float(material_metrics["material_cost"]),
            "total_cost": float(material_metrics["material_cost"]),
            "missing_employee_rate": False,
            "missing_machine_rate": False,
            "missing_material_cost_data": bool(material_metrics["missing_material_cost_data"]),
            "performance_percent": None,
        }

    planning_rows = list(
        db.scalars(
            select(PlanningOperation)
            .where(PlanningOperation.work_order_no == vp_code)
            .order_by(PlanningOperation.operation_no.asc(), PlanningOperation.id.asc())
        ).all()
    )
    machine_ids = sorted({int(o.machine_id) for o in planning_rows if o.machine_id is not None})
    machines_by_id = (
        {int(m.id): m for m in db.scalars(select(Machine).where(Machine.id.in_(machine_ids))).all()}
        if machine_ids
        else {}
    )

    by_planning_id = operation_event_runtime_metrics_by_planning_id(db, planning_rows, machines_by_id)
    reported_time_min = sum(
        float((by_planning_id.get(int(o.id)) or {}).get("working_time_min") or 0.0) for o in planning_rows
    )
    labor_cost = sum(
        float((by_planning_id.get(int(o.id)) or {}).get("labor_cost") or 0.0) for o in planning_rows
    )
    employee_labor_cost = sum(
        float((by_planning_id.get(int(o.id)) or {}).get("employee_labor_cost") or 0.0) for o in planning_rows
    )
    machine_cost = sum(
        float((by_planning_id.get(int(o.id)) or {}).get("machine_cost") or 0.0) for o in planning_rows
    )
    planned_time_min = sum(
        float((by_planning_id.get(int(o.id)) or {}).get("planned_time_min") or 0.0) for o in planning_rows
    )
    performance_percent = (
        round((planned_time_min / reported_time_min) * 100.0, 1)
        if planned_time_min > 0 and reported_time_min > 1e-9
        else None
    )

    return {
        "reported_time_min": round(reported_time_min, 2),
        "employee_labor_cost": round(employee_labor_cost, 2),
        "machine_cost": round(machine_cost, 2),
        "labor_cost": round(labor_cost, 2),
        "material_cost": float(material_metrics["material_cost"]),
        "total_cost": round(float(material_metrics["material_cost"]) + labor_cost, 2),
        "missing_employee_rate": any(
            bool((by_planning_id.get(int(o.id)) or {}).get("missing_employee_rate")) for o in planning_rows
        ),
        "missing_machine_rate": any(
            bool((by_planning_id.get(int(o.id)) or {}).get("missing_machine_rate")) for o in planning_rows
        ),
        "missing_material_cost_data": bool(material_metrics["missing_material_cost_data"]),
        "performance_percent": performance_percent,
    }
