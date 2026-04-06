import logging
from collections import defaultdict
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import bindparam, text
from sqlalchemy.orm import Session

from app.core.database import get_db

router = APIRouter()
logger = logging.getLogger(__name__)


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


def _fmt_route_code(code: str | None, fallback_name: str | None) -> str | None:
    c = (code or "").strip()
    if c:
        return c.upper()
    n = (fallback_name or "").strip()
    return n.upper() if n else None


def _build_next_workplace_code_map(db: Session, rows: list) -> dict[int, str | None]:
    """operation_id -> next workplace code on VP routing (by operation_no, id)."""
    woos = {r["work_order_no"] for r in rows if r.get("work_order_no")}
    if not woos:
        return {}
    q = text(
        """
        SELECT
            po.id AS operation_id,
            po.work_order_no AS woo,
            po.operation_no AS op_no,
            COALESCE(NULLIF(TRIM(wp.code), ''), wp.name) AS wcode
        FROM planning_operations po
        JOIN machines m ON m.id = po.machine_id
        JOIN workplace_library_items wp
            ON wp.id = COALESCE(po.workplace_library_item_id, m.workplace_library_item_id)
        WHERE po.work_order_no IN :woos
          AND po.machine_id IS NOT NULL
        ORDER BY po.work_order_no, po.operation_no ASC, po.id ASC
        """
    ).bindparams(bindparam("woos", expanding=True))
    all_rows = db.execute(q, {"woos": list(woos)}).mappings().all()
    by_woo: dict[str, list] = defaultdict(list)
    for r in all_rows:
        by_woo[r["woo"]].append(r)
    next_map: dict[int, str | None] = {}
    for lst in by_woo.values():
        lst.sort(key=lambda x: (int(x["op_no"] or 0), int(x["operation_id"])))
        for i, r in enumerate(lst):
            oid = int(r["operation_id"])
            if i + 1 < len(lst):
                nxt = lst[i + 1]["wcode"]
                next_map[oid] = _fmt_route_code(str(nxt) if nxt is not None else None, None)
            else:
                next_map[oid] = None
    return next_map


def map_operation_row(row):
    po_id = row.get("production_order_id")
    wid = row.get("workplace_id")
    wc = _fmt_route_code(
        str(row["workplace_code"]) if row.get("workplace_code") is not None else None,
        str(row["machine_name"]) if row.get("machine_name") is not None else None,
    )
    raw_next = row.get("next_workplace_code")
    if raw_next is None:
        next_code = None
    else:
        next_code = _fmt_route_code(str(raw_next), None)
    out = {
        "operationId": row["operation_id"],
        "orderItemId": row["order_item_id"],
        "productionOrderId": int(po_id) if po_id is not None else None,
        "workOrderNo": row["work_order_no"],
        "gpn": row["gpn"],
        "operationName": row["operation_name"],
        "operationNo": row["operation_no"],
        "machineId": row["machine_id"],
        "machineName": row["machine_name"],
        "workplaceCode": wc,
        "nextWorkplaceCode": next_code,
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
    if wid is not None:
        out["workplaceId"] = int(wid)
    return out


@router.get("/gantt")
def get_planner_gantt(from_date: str, to_date: str, db: Session = Depends(get_db)):
    from_dt = parse_date_or_400(from_date, "from_date")
    to_dt = parse_date_or_400(to_date, "to_date")

    if to_dt < from_dt:
        raise HTTPException(status_code=400, detail="Parametr to_date musi byt stejny nebo pozdejsi nez from_date.")

    visible_start = from_dt.replace(hour=0, minute=0, second=0, microsecond=0)
    visible_end = to_dt.replace(hour=23, minute=59, second=59, microsecond=999999)

    # Řádky Gantt = knihovna pracovišť (Settings → Pracoviště), ne seznam machines.
    resources_sql = text(
        """
        SELECT
            wp.id AS workplace_id,
            wp.name AS display_name,
            COALESCE(NULLIF(TRIM(wp.code), ''), wp.name) AS workplace_code,
            (
                SELECT MIN(m.id)
                FROM machines m
                WHERE m.workplace_library_item_id = wp.id
            ) AS scheduling_machine_id
        FROM workplace_library_items wp
        WHERE
            wp.is_active
            AND (wp.is_plannable IS NULL OR wp.is_plannable)
            AND EXISTS (
                SELECT 1 FROM machines m2 WHERE m2.workplace_library_item_id = wp.id
            )
        ORDER BY wp.id ASC
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
            COALESCE(wp.name, m.name) AS machine_name,
            COALESCE(NULLIF(TRIM(wp.code), ''), wp.name) AS workplace_code,
            COALESCE(po.workplace_library_item_id, m.workplace_library_item_id) AS workplace_id,
            po.qty AS qty,
            po.setup_time_min AS setup_time_min,
            po.total_labor_time_min AS total_labor_time_min,
            po.total_operation_time_min AS total_operation_time_min,
            po.expedition_date AS expedition_date,
            COALESCE(ms.planned_start, po.planned_start) AS planned_start,
            COALESCE(ms.planned_end, po.planned_end) AS planned_end,
            COALESCE(ms.queue_position, po.queue_position) AS queue_position,
            po.status AS status,
            po.material_ready AS material_ready,
            vp.id AS production_order_id
        FROM planning_operations po
        JOIN machines m ON m.id = po.machine_id
        INNER JOIN workplace_library_items wp
            ON wp.id = COALESCE(po.workplace_library_item_id, m.workplace_library_item_id)
        LEFT JOIN machine_schedule ms ON ms.planning_operation_id = po.id
        LEFT JOIN production_orders vp ON vp.vp_code = po.work_order_no
        WHERE
            wp.is_active
            AND (wp.is_plannable IS NULL OR wp.is_plannable)
            AND po.material_ready IS 1
            AND COALESCE(ms.planned_start, po.planned_start) IS NOT NULL
            AND COALESCE(ms.planned_end, po.planned_end) IS NOT NULL
            AND COALESCE(ms.planned_end, po.planned_end) >= :visible_start
            AND COALESCE(ms.planned_start, po.planned_start) <= :visible_end
        ORDER BY
            wp.name ASC,
            COALESCE(ms.planned_start, po.planned_start) ASC,
            COALESCE(ms.queue_position, po.queue_position) ASC,
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
            COALESCE(wp.name, m.name) AS machine_name,
            COALESCE(NULLIF(TRIM(wp.code), ''), wp.name) AS workplace_code,
            COALESCE(po.workplace_library_item_id, m.workplace_library_item_id) AS workplace_id,
            po.qty AS qty,
            po.setup_time_min AS setup_time_min,
            po.total_labor_time_min AS total_labor_time_min,
            po.total_operation_time_min AS total_operation_time_min,
            po.expedition_date AS expedition_date,
            po.planned_start AS planned_start,
            po.planned_end AS planned_end,
            po.queue_position AS queue_position,
            po.status AS status,
            po.material_ready AS material_ready,
            vp.id AS production_order_id
        FROM planning_operations po
        JOIN machines m ON m.id = po.machine_id
        INNER JOIN workplace_library_items wp
            ON wp.id = COALESCE(po.workplace_library_item_id, m.workplace_library_item_id)
        LEFT JOIN machine_schedule ms ON ms.planning_operation_id = po.id
        LEFT JOIN production_orders vp ON vp.vp_code = po.work_order_no
        WHERE
            wp.is_active
            AND (wp.is_plannable IS NULL OR wp.is_plannable)
            AND po.material_ready IS 1
            AND (
                COALESCE(ms.planned_start, po.planned_start) IS NULL
                OR COALESCE(ms.planned_end, po.planned_end) IS NULL
            )
        ORDER BY
            wp.name ASC,
            po.queue_position ASC,
            po.operation_no ASC,
            po.id ASC
        """
    )

    resource_rows = db.execute(resources_sql).mappings().all()

    scheduled_rows = db.execute(
        scheduled_sql,
        {
            "visible_start": visible_start,
            "visible_end": visible_end,
        },
    ).mappings().all()
    unscheduled_rows = db.execute(unscheduled_sql).mappings().all()

    next_map = _build_next_workplace_code_map(db, list(scheduled_rows) + list(unscheduled_rows))

    machine_map: dict[int, dict] = {}

    for row in resource_rows:
        mid = row["scheduling_machine_id"]
        if mid is None:
            continue
        wid = int(row["workplace_id"])
        machine_map[wid] = {
            "machineId": int(mid),
            "machineName": row["display_name"],
            "workplaceId": wid,
            "workplaceCode": _fmt_route_code(
                str(row["workplace_code"]) if row.get("workplace_code") is not None else None,
                row["display_name"],
            ),
            "items": [],
        }

    for row in scheduled_rows:
        r = dict(row)
        r["next_workplace_code"] = next_map.get(int(row["operation_id"]))
        wp_id = int(r["workplace_id"])
        if wp_id not in machine_map:
            mid = r["machine_id"]
            machine_map[wp_id] = {
                "machineId": int(mid),
                "machineName": r["machine_name"],
                "workplaceId": wp_id,
                "workplaceCode": _fmt_route_code(
                    str(r["workplace_code"]) if r.get("workplace_code") is not None else None,
                    r["machine_name"],
                ),
                "items": [],
            }
        machine_map[wp_id]["items"].append(map_operation_row(r))

    machines = list(machine_map.values())
    unscheduled_items = []
    for row in unscheduled_rows:
        r = dict(row)
        r["next_workplace_code"] = next_map.get(int(row["operation_id"]))
        unscheduled_items.append(map_operation_row(r))

    sched_wp = {int(r["workplace_id"]) for r in scheduled_rows}
    logger.info(
        "[planner_gantt] from=%s to=%s resources(workplaces)=%s scheduled_rows=%s distinct_wp_scheduled=%s unscheduled_ops=%s",
        from_date,
        to_date,
        len(resource_rows),
        len(scheduled_rows),
        len(sched_wp),
        len(unscheduled_rows),
    )
    print(
        "[PLANNER_DIAG] planner_gantt GET "
        f"from={from_date} to={to_date} scheduled_rows={len(scheduled_rows)} "
        f"unscheduled_ops={len(unscheduled_rows)} resources={len(resource_rows)} "
        "(no rebuild on load; run material issue or POST /planning/rebuild-all)",
        flush=True,
    )

    return {
        "from": from_date,
        "to": to_date,
        "days": build_days(from_dt, to_dt),
        "machines": machines,
        "unscheduledItems": unscheduled_items,
    }
