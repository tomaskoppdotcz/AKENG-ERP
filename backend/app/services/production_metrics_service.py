"""Production metrics calculated from planning runtime and operation_events."""

from __future__ import annotations

from collections import Counter, defaultdict
from datetime import datetime
import math
import re

from sqlalchemy import or_, select, text
from sqlalchemy.orm import Session, joinedload

from app.models.kiosk import Employee, OperationEvent
from app.models.master_data import Machine
from app.models.material_library import MaterialLibraryItem
from app.models.material_stock import MaterialStockItem, MaterialStockMovement
from app.models.orders import CustomerOrder, Job, JobItem, ProductionOrder
from app.models.planning import PlanningOperation
from app.models.portfolio import PortfolioItem
from app.models.supplier_purchase_order import SupplierPurchaseOrder, SupplierPurchaseOrderItem
from app.services.business_workflow import workflow_active_sql, workflow_record_active
from app.services.operation_tracking_service import (
    EVENT_DONE,
    EVENT_PAUSE,
    EVENT_RESUME,
    EVENT_START,
    TRACKING_EVENT_TYPES,
)

RECEIVED_SUPPLIER_PURCHASE_STATUSES = ("partially_received", "received")


def _safe_float(value: object) -> float:
    try:
        return float(value or 0.0)
    except (TypeError, ValueError):
        return 0.0


def _optional_table_columns(db: Session, table_name: str) -> set[str]:
    rows = db.execute(text(f"PRAGMA table_info({table_name})")).fetchall()
    return {str(row[1]) for row in rows}


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


def _supplier_received_cost_for_filters(db: Session, filters: list[object]) -> float:
    if not filters:
        return 0.0

    rows = db.execute(
        select(
            SupplierPurchaseOrderItem.id,
            SupplierPurchaseOrderItem.received_qty,
            SupplierPurchaseOrderItem.unit_price,
        )
        .join(SupplierPurchaseOrder, SupplierPurchaseOrder.id == SupplierPurchaseOrderItem.purchase_order_id)
        .where(SupplierPurchaseOrder.status.in_(RECEIVED_SUPPLIER_PURCHASE_STATUSES))
        .where(SupplierPurchaseOrderItem.received_qty > 0)
        .where(SupplierPurchaseOrderItem.unit_price.is_not(None))
        .where(or_(*filters))
    ).all()

    seen_item_ids: set[int] = set()
    supplier_cost = 0.0
    for item_id, received_qty, unit_price in rows:
        if item_id is None:
            continue
        item_id_int = int(item_id)
        if item_id_int in seen_item_ids:
            continue
        seen_item_ids.add(item_id_int)
        supplier_cost += _safe_float(received_qty) * _safe_float(unit_price)
    return round(supplier_cost, 2)


def _planning_operation_ids_for_production_order(
    db: Session,
    po: ProductionOrder,
    planning_rows: list[PlanningOperation] | None = None,
) -> list[int]:
    if planning_rows is not None:
        return [int(o.id) for o in planning_rows if o.id is not None]

    vp_code = (po.vp_code or "").strip()
    if not vp_code:
        return []
    return [
        int(op_id)
        for op_id in db.scalars(
            select(PlanningOperation.id).where(PlanningOperation.work_order_no == vp_code)
        ).all()
        if op_id is not None
    ]


def production_order_supplier_cost(
    db: Session,
    po: ProductionOrder,
    planning_rows: list[PlanningOperation] | None = None,
) -> float:
    filters: list[object] = []
    if po.id is not None:
        filters.append(SupplierPurchaseOrder.production_order_id == int(po.id))

    planning_operation_ids = _planning_operation_ids_for_production_order(db, po, planning_rows)
    if planning_operation_ids:
        filters.append(SupplierPurchaseOrder.planning_operation_id.in_(planning_operation_ids))

    return _supplier_received_cost_for_filters(db, filters)


def _supplier_cost_for_job_item_scope(
    db: Session,
    job_item_id: int,
    production_order_ids: list[int],
    planning_operation_ids: list[int],
) -> float:
    filters: list[object] = [SupplierPurchaseOrder.job_item_id == int(job_item_id)]
    if production_order_ids:
        filters.append(SupplierPurchaseOrder.production_order_id.in_(production_order_ids))
    if planning_operation_ids:
        filters.append(SupplierPurchaseOrder.planning_operation_id.in_(planning_operation_ids))
    return _supplier_received_cost_for_filters(db, filters)


def _supplier_cost_for_customer_order_scope(
    db: Session,
    customer_order_id: int,
    job_item_ids: list[int],
    production_order_ids: list[int],
    planning_operation_ids: list[int],
) -> float:
    filters: list[object] = [SupplierPurchaseOrder.customer_order_id == int(customer_order_id)]
    if job_item_ids:
        filters.append(SupplierPurchaseOrder.job_item_id.in_(job_item_ids))
    if production_order_ids:
        filters.append(SupplierPurchaseOrder.production_order_id.in_(production_order_ids))
    if planning_operation_ids:
        filters.append(SupplierPurchaseOrder.planning_operation_id.in_(planning_operation_ids))
    return _supplier_received_cost_for_filters(db, filters)


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
        supplier_cost = production_order_supplier_cost(db, po, [])
        return {
            "reported_time_min": 0.0,
            "employee_labor_cost": 0.0,
            "machine_cost": 0.0,
            "labor_cost": 0.0,
            "material_cost": float(material_metrics["material_cost"]),
            "supplier_cost": supplier_cost,
            "total_cost": round(float(material_metrics["material_cost"]) + supplier_cost, 2),
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
    supplier_cost = production_order_supplier_cost(db, po, planning_rows)

    return {
        "reported_time_min": round(reported_time_min, 2),
        "employee_labor_cost": round(employee_labor_cost, 2),
        "machine_cost": round(machine_cost, 2),
        "labor_cost": round(labor_cost, 2),
        "material_cost": float(material_metrics["material_cost"]),
        "supplier_cost": supplier_cost,
        "total_cost": round(float(material_metrics["material_cost"]) + labor_cost + supplier_cost, 2),
        "missing_employee_rate": any(
            bool((by_planning_id.get(int(o.id)) or {}).get("missing_employee_rate")) for o in planning_rows
        ),
        "missing_machine_rate": any(
            bool((by_planning_id.get(int(o.id)) or {}).get("missing_machine_rate")) for o in planning_rows
        ),
        "missing_material_cost_data": bool(material_metrics["missing_material_cost_data"]),
        "performance_percent": performance_percent,
    }


def _job_item_selling_price_per_piece(
    db: Session,
    job_item_id: int,
    portfolio_by_id: dict[int, PortfolioItem],
    job_item_portfolio_id_by_id: dict[int, int | None],
) -> float | None:
    cols = _optional_table_columns(db, "job_items")
    price_cols = [
        c for c in ("selling_price_per_piece", "sales_price_per_unit", "sale_price_per_piece") if c in cols
    ]
    if price_cols:
        row = db.execute(
            text(f"SELECT {', '.join(price_cols)} FROM job_items WHERE id = :id"),
            {"id": int(job_item_id)},
        ).fetchone()
        if row is not None:
            for value in row:
                if value is not None:
                    return float(value)

    portfolio_id = job_item_portfolio_id_by_id.get(int(job_item_id))
    portfolio = portfolio_by_id.get(int(portfolio_id)) if portfolio_id is not None else None
    if portfolio is not None and portfolio.sale_price_per_piece is not None:
        return float(portfolio.sale_price_per_piece)
    return None


def _job_item_price_context(
    db: Session,
    job_item_ids: list[int],
) -> tuple[dict[int, PortfolioItem], dict[int, int | None]]:
    cols = _optional_table_columns(db, "job_items")
    job_item_portfolio_id_by_id: dict[int, int | None] = {}
    if "portfolio_item_id" in cols and job_item_ids:
        placeholders = ", ".join(f":id_{idx}" for idx, _ in enumerate(job_item_ids))
        params = {f"id_{idx}": item_id for idx, item_id in enumerate(job_item_ids)}
        rows = db.execute(
            text(f"SELECT id, portfolio_item_id FROM job_items WHERE id IN ({placeholders})"),
            params,
        ).fetchall()
        job_item_portfolio_id_by_id = {
            int(row[0]): (int(row[1]) if row[1] is not None else None)
            for row in rows
        }

    portfolio_ids = sorted({int(pid) for pid in job_item_portfolio_id_by_id.values() if pid is not None})
    portfolio_by_id = (
        {int(p.id): p for p in db.scalars(select(PortfolioItem).where(PortfolioItem.id.in_(portfolio_ids))).all()}
        if portfolio_ids
        else {}
    )
    return portfolio_by_id, job_item_portfolio_id_by_id


def customer_order_item_financial_summary(db: Session, job_item_id: int) -> dict[str, float | str | bool | None]:
    """
    Financial summary for one customer-order item.

    Revenue is counted once from the item quantity and selling price. Costs and reported time
    are summed from unique active production orders linked to the item, using the same
    production_order_metrics() helper as production-order and customer-order summaries.
    """
    empty: dict[str, float | str | bool | None] = {
        "reported_time_min": 0.0,
        "employee_labor_cost": 0.0,
        "machine_cost": 0.0,
        "material_cost": 0.0,
        "supplier_cost": 0.0,
        "total_cost": 0.0,
        "revenue": 0.0,
        "profit": 0.0,
        "margin_percent": None,
        "revenue_source": "order_item",
        "missing_employee_rate": False,
        "missing_machine_rate": False,
        "missing_material_cost_data": False,
    }

    item = db.get(JobItem, int(job_item_id))
    if item is None:
        return dict(empty)

    active_pos_by_id: dict[int, ProductionOrder] = {}
    raw_pos = db.scalars(
        select(ProductionOrder)
        .where(ProductionOrder.job_item_id == int(job_item_id))
        .where(workflow_active_sql(ProductionOrder.workflow_status))
        .order_by(ProductionOrder.id.asc())
    ).all()
    for po in raw_pos:
        if po.id is not None:
            active_pos_by_id[int(po.id)] = po
    active_pos = list(active_pos_by_id.values())
    active_po_ids = sorted(active_pos_by_id)
    active_vp_codes = sorted({(p.vp_code or "").strip() for p in active_pos if (p.vp_code or "").strip()})
    planning_operation_ids = (
        [
            int(op_id)
            for op_id in db.scalars(
                select(PlanningOperation.id).where(PlanningOperation.work_order_no.in_(active_vp_codes))
            ).all()
            if op_id is not None
        ]
        if active_vp_codes
        else []
    )

    reported_time_min = 0.0
    employee_labor_cost = 0.0
    machine_cost = 0.0
    material_cost = 0.0
    missing_employee_rate = False
    missing_machine_rate = False
    missing_material_cost_data = False
    for po in active_pos:
        metrics = production_order_metrics(db, po)
        reported_time_min += float(metrics.get("reported_time_min") or 0.0)
        employee_labor_cost += float(metrics.get("employee_labor_cost") or 0.0)
        machine_cost += float(metrics.get("machine_cost") or 0.0)
        material_cost += float(metrics.get("material_cost") or 0.0)
        missing_employee_rate = missing_employee_rate or bool(metrics.get("missing_employee_rate"))
        missing_machine_rate = missing_machine_rate or bool(metrics.get("missing_machine_rate"))
        missing_material_cost_data = missing_material_cost_data or bool(metrics.get("missing_material_cost_data"))
    supplier_cost = _supplier_cost_for_job_item_scope(db, int(job_item_id), active_po_ids, planning_operation_ids)
    total_cost = material_cost + employee_labor_cost + machine_cost + supplier_cost

    portfolio_by_id, job_item_portfolio_id_by_id = _job_item_price_context(db, [int(job_item_id)])
    price = _job_item_selling_price_per_piece(
        db,
        int(job_item_id),
        portfolio_by_id,
        job_item_portfolio_id_by_id,
    )
    revenue = (float(price) * int(item.qty or 0)) if price is not None else 0.0
    profit = revenue - total_cost
    margin_percent = (profit / revenue * 100.0) if revenue > 0 else None

    return {
        "reported_time_min": round(reported_time_min, 2),
        "employee_labor_cost": round(employee_labor_cost, 2),
        "machine_cost": round(machine_cost, 2),
        "material_cost": round(material_cost, 2),
        "supplier_cost": round(supplier_cost, 2),
        "total_cost": round(total_cost, 2),
        "revenue": round(revenue, 2),
        "profit": round(profit, 2),
        "margin_percent": round(margin_percent, 2) if margin_percent is not None else None,
        "revenue_source": "order_item",
        "missing_employee_rate": missing_employee_rate,
        "missing_machine_rate": missing_machine_rate,
        "missing_material_cost_data": missing_material_cost_data,
    }


def customer_order_financial_summary(db: Session, customer_order_id: int) -> dict[str, float | str | None]:
    """
    Customer-order financial summary.

    Costs are summed from unique active production orders with the same production_order_metrics()
    used by production-order detail. Revenue is intentionally aggregated once per active order
    item using the same selling-price precedence as production-order detail, so multiple VPs for
    a single line do not multiply the order revenue.
    """
    empty: dict[str, float | str | None] = {
        "total_reported_time_min": 0.0,
        "total_employee_labor_cost": 0.0,
        "total_machine_cost": 0.0,
        "total_material_cost": 0.0,
        "supplier_cost": 0.0,
        "total_supplier_cost": 0.0,
        "total_cost": 0.0,
        "total_revenue": 0.0,
        "total_profit": 0.0,
        "margin_percent": None,
        "revenue_source": "order_items",
    }

    co = db.get(CustomerOrder, int(customer_order_id))
    if co is None or not workflow_record_active(co):
        return dict(empty)

    jobs = db.scalars(select(Job).where(Job.customer_order_id == int(customer_order_id))).all()
    job_ids = [int(j.id) for j in jobs if j.id is not None]
    items = db.scalars(select(JobItem).where(JobItem.job_id.in_(job_ids))).all() if job_ids else []
    active_items = [it for it in items if workflow_record_active(it)]
    active_item_ids = [int(it.id) for it in active_items if it.id is not None]

    po_filters = [ProductionOrder.customer_order_id == int(customer_order_id)]
    if job_ids:
        po_filters.append(ProductionOrder.job_id.in_(job_ids))
    if active_item_ids:
        po_filters.append(ProductionOrder.job_item_id.in_(active_item_ids))

    raw_pos = db.scalars(
        select(ProductionOrder).where(or_(*po_filters), workflow_active_sql(ProductionOrder.workflow_status))
    ).all()

    active_item_id_set = set(active_item_ids)
    active_pos_by_id: dict[int, ProductionOrder] = {}
    for po in raw_pos:
        if po.id is None:
            continue
        if po.job_item_id is not None and int(po.job_item_id) not in active_item_id_set:
            continue
        active_pos_by_id[int(po.id)] = po
    active_pos = list(active_pos_by_id.values())
    active_po_ids = sorted(active_pos_by_id)
    active_vp_codes = sorted({(p.vp_code or "").strip() for p in active_pos if (p.vp_code or "").strip()})
    planning_operation_ids = (
        [
            int(op_id)
            for op_id in db.scalars(
                select(PlanningOperation.id).where(PlanningOperation.work_order_no.in_(active_vp_codes))
            ).all()
            if op_id is not None
        ]
        if active_vp_codes
        else []
    )

    reported_time_min = 0.0
    employee_labor_cost = 0.0
    machine_cost = 0.0
    material_cost = 0.0
    for po in active_pos:
        metrics = production_order_metrics(db, po)
        reported_time_min += float(metrics.get("reported_time_min") or 0.0)
        employee_labor_cost += float(metrics.get("employee_labor_cost") or 0.0)
        machine_cost += float(metrics.get("machine_cost") or 0.0)
        material_cost += float(metrics.get("material_cost") or 0.0)
    supplier_cost = _supplier_cost_for_customer_order_scope(
        db,
        int(customer_order_id),
        active_item_ids,
        active_po_ids,
        planning_operation_ids,
    )
    total_cost = material_cost + employee_labor_cost + machine_cost + supplier_cost

    portfolio_by_id, job_item_portfolio_id_by_id = _job_item_price_context(db, active_item_ids)

    total_revenue = 0.0
    for item in active_items:
        price = _job_item_selling_price_per_piece(
            db,
            int(item.id),
            portfolio_by_id,
            job_item_portfolio_id_by_id,
        )
        if price is None:
            continue
        total_revenue += float(price) * int(item.qty or 0)

    total_profit = total_revenue - total_cost
    margin_percent = (total_profit / total_revenue * 100.0) if total_revenue > 0 else None

    return {
        "total_reported_time_min": round(reported_time_min, 2),
        "total_employee_labor_cost": round(employee_labor_cost, 2),
        "total_machine_cost": round(machine_cost, 2),
        "total_material_cost": round(material_cost, 2),
        "supplier_cost": round(supplier_cost, 2),
        "total_supplier_cost": round(supplier_cost, 2),
        "total_cost": round(total_cost, 2),
        "total_revenue": round(total_revenue, 2),
        "total_profit": round(total_profit, 2),
        "margin_percent": round(margin_percent, 2) if margin_percent is not None else None,
        "revenue_source": "order_items",
    }
