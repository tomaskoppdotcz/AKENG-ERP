from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.database import get_db

router = APIRouter()


def parse_date_or_400(value: str, field_name: str) -> datetime:
    try:
        return datetime.strptime(value, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Neplatny format parametru {field_name}. Pouzij YYYY-MM-DD.")


def build_days(from_date: datetime, to_date: datetime) -> list[str]:
    days: list[str] = []
    cur = from_date
    while cur <= to_date:
        days.append(cur.strftime("%Y-%m-%d"))
        cur += timedelta(days=1)
    return days


def normalize_status(status: str | None) -> str:
    value = (status or "").strip().lower()
    if value in {"done", "finished", "complete", "completed", "hotovo"}:
        return "hotovo"
    if value in {"running", "in_progress", "bezi"}:
        return "bezi"
    if value in {"blocked", "blokovano"}:
        return "blokovano"
    if value in {"waiting", "queued", "ceka"}:
        return "ceka"
    if value in {"waiting_release"}:
        return "ceka"
    if value in {"planned", "naplanovano", ""}:
        return "naplanovano"
    return value


def to_iso_or_none(value):
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, str):
        return value
    return str(value)


def map_operation_row(row):
    return {
        "operationId": row["operation_id"],
        "orderItemId": row["order_item_id"],
        "workOrderNo": row["work_order_no"],
        "gpn": row["gpn"],
        "operationName": row["operation_name"],
        "operationNo": row["operation_no"],
        "machineId": row["machine_id"],
        "machineName": row["machine_name"],
        "status": normalize_status(row["status"]),
        "plannedStart": to_iso_or_none(row["planned_start"]),
        "plannedEnd": to_iso_or_none(row["planned_end"]),
        "setupTimeMin": float(row["setup_time_min"] or 0),
        "laborTimeTotalMin": float(row["total_labor_time_min"] or 0),
        "totalOperationTimeMin": float(row["total_operation_time_min"] or 0),
        "qty": int(row["qty"] or 0),
        "expeditionDate": row["expedition_date"],
        "queuePosition": row["queue_position"],
        "materialReady": bool(row["material_ready"]) if row["material_ready"] is not None else False,
    }


@router.get("/gantt")
def get_planner_gantt(from_date: str, to_date: str, db: Session = Depends(get_db)):
    from_dt = parse_date_or_400(from_date, "from_date")
    to_dt = parse_date_or_400(to_date, "to_date")

    if to_dt < from_dt:
        raise HTTPException(status_code=400, detail="Parametr to_date musi byt stejny nebo pozdejsi nez from_date.")

    visible_start = from_dt.replace(hour=0, minute=0, second=0, microsecond=0)
    visible_end = to_dt.replace(hour=23, minute=59, second=59, microsecond=999999)

    machines_sql = text(
        """
        SELECT
            m.id AS machine_id,
            m.name AS machine_name
        FROM machines m
        ORDER BY m.name ASC, m.id ASC
        """
    )

    scheduled_sql = text(
        """
        SELECT
            po.id AS operation_id,
            po.order_item_id AS order_item_id,
            po.work_order_no AS work_order_no,
            po.gpn AS gpn,
            po.operation_name AS operation_name,
            po.operation_no AS operation_no,
            po.machine_id AS machine_id,
            m.name AS machine_name,
            po.qty AS qty,
            po.setup_time_min AS setup_time_min,
            po.total_labor_time_min AS total_labor_time_min,
            po.total_operation_time_min AS total_operation_time_min,
            po.expedition_date AS expedition_date,
            po.planned_start AS planned_start,
            po.planned_end AS planned_end,
            po.queue_position AS queue_position,
            po.status AS status,
            po.material_ready AS material_ready
        FROM planning_operations po
        JOIN machines m ON m.id = po.machine_id
        WHERE
            po.planned_start IS NOT NULL
            AND po.planned_end IS NOT NULL
            AND po.planned_end >= :visible_start
            AND po.planned_start <= :visible_end
        ORDER BY
            m.name ASC,
            po.planned_start ASC,
            po.queue_position ASC,
            po.operation_no ASC,
            po.id ASC
        """
    )

    unscheduled_sql = text(
        """
        SELECT
            po.id AS operation_id,
            po.order_item_id AS order_item_id,
            po.work_order_no AS work_order_no,
            po.gpn AS gpn,
            po.operation_name AS operation_name,
            po.operation_no AS operation_no,
            po.machine_id AS machine_id,
            m.name AS machine_name,
            po.qty AS qty,
            po.setup_time_min AS setup_time_min,
            po.total_labor_time_min AS total_labor_time_min,
            po.total_operation_time_min AS total_operation_time_min,
            po.expedition_date AS expedition_date,
            po.planned_start AS planned_start,
            po.planned_end AS planned_end,
            po.queue_position AS queue_position,
            po.status AS status,
            po.material_ready AS material_ready
        FROM planning_operations po
        JOIN machines m ON m.id = po.machine_id
        WHERE
            po.planned_start IS NULL
            OR po.planned_end IS NULL
        ORDER BY
            m.name ASC,
            po.queue_position ASC,
            po.operation_no ASC,
            po.id ASC
        """
    )

    machine_rows = db.execute(machines_sql).mappings().all()
    scheduled_rows = db.execute(
        scheduled_sql,
        {
            "visible_start": visible_start,
            "visible_end": visible_end,
        },
    ).mappings().all()
    unscheduled_rows = db.execute(unscheduled_sql).mappings().all()

    machine_map: dict[int, dict] = {}

    for row in machine_rows:
        machine_map[row["machine_id"]] = {
            "machineId": row["machine_id"],
            "machineName": row["machine_name"],
            "items": [],
        }

    for row in scheduled_rows:
        machine_id = row["machine_id"]
        if machine_id not in machine_map:
            machine_map[machine_id] = {
                "machineId": machine_id,
                "machineName": row["machine_name"],
                "items": [],
            }
        machine_map[machine_id]["items"].append(map_operation_row(row))

    machines = list(machine_map.values())
    unscheduled_items = [map_operation_row(row) for row in unscheduled_rows]

    return {
        "from": from_date,
        "to": to_date,
        "days": build_days(from_dt, to_dt),
        "machines": machines,
        "unscheduledItems": unscheduled_items,
    }
