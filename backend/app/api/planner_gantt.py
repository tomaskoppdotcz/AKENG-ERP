import logging
from collections import defaultdict
from datetime import date, datetime, time, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import bindparam, select, text
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.planning import PlanningScheduleSegment

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


def _coerce_planner_datetime(value) -> datetime | None:
    """
    Raw SQL (např. SQLite) často vrací TIMESTAMP jako řetězec; ORM vrací datetime.
    Sjednocení pro aritmetiku a výstup ISO.
    """
    if value is None:
        return None
    if isinstance(value, datetime):
        return value
    if isinstance(value, date) and not isinstance(value, datetime):
        return datetime.combine(value, time.min)
    if isinstance(value, str):
        s = value.strip()
        if not s:
            return None
        if s.endswith("Z"):
            s = s[:-1] + "+00:00"
        norm = s.replace(" ", "T", 1) if "T" not in s and " " in s else s
        try:
            return datetime.fromisoformat(norm)
        except ValueError:
            pass
        for fmt in ("%Y-%m-%d %H:%M:%S.%f", "%Y-%m-%d %H:%M:%S"):
            try:
                return datetime.strptime(s, fmt)
            except ValueError:
                continue
        logger.warning("[planner_gantt] Could not parse datetime %r", value)
        return None
    return None


def _planned_bounds_iso(planned_start, planned_end) -> tuple[str | None, str | None]:
    ps = _coerce_planner_datetime(planned_start)
    pe = _coerce_planner_datetime(planned_end)
    return (ps.isoformat() if ps else None, pe.isoformat() if pe else None)


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


def _build_cooperation_block_map(db: Session, rows: list) -> dict[int, dict]:
    """operation_id -> pending cooperation predecessor that blocks this VP step."""
    woos = {r["work_order_no"] for r in rows if r.get("work_order_no")}
    if not woos:
        return {}
    q = text(
        """
        SELECT
            po.id AS operation_id,
            po.work_order_no AS woo,
            po.operation_no AS op_no,
            po.operation_name AS operation_name,
            COALESCE(po.is_cooperation, 0) AS is_cooperation,
            po.cooperation_status AS cooperation_status
        FROM planning_operations po
        WHERE po.work_order_no IN :woos
        ORDER BY po.work_order_no, po.operation_no ASC, po.id ASC
        """
    ).bindparams(bindparam("woos", expanding=True))
    all_rows = db.execute(q, {"woos": list(woos)}).mappings().all()
    by_woo: dict[str, list] = defaultdict(list)
    for r in all_rows:
        by_woo[r["woo"]].append(r)
    out: dict[int, dict] = {}
    for lst in by_woo.values():
        blocker = None
        for r in sorted(lst, key=lambda x: (int(x["op_no"] or 0), int(x["operation_id"]))):
            oid = int(r["operation_id"])
            if blocker is not None:
                out[oid] = blocker
            if bool(r["is_cooperation"]):
                status = str(r["cooperation_status"] or "pending_send").strip().lower()
                blocker = None if status == "received" else {
                    "operationId": oid,
                    "operationNo": int(r["op_no"] or 0),
                    "operationName": r["operation_name"],
                    "cooperationStatus": status,
                }
    return out


def _batch_load_schedule_segments(db: Session, op_ids: set[int]) -> dict[int, list]:
    if not op_ids:
        return {}
    rows = db.scalars(
        select(PlanningScheduleSegment)
        .where(PlanningScheduleSegment.planning_operation_id.in_(op_ids))
        .order_by(PlanningScheduleSegment.planning_operation_id, PlanningScheduleSegment.segment_index)
    ).all()
    by_op: dict[int, list] = defaultdict(list)
    for r in rows:
        by_op[int(r.planning_operation_id)].append(r)
    return dict(by_op)


def _gantt_segment_payloads(
    machine_id: int,
    planned_start,
    planned_end,
    total_op_min: float,
    persisted: list | None,
) -> list[dict]:
    if persisted:
        out_seg: list[dict] = []
        for r in persisted:
            ps_i, pe_i = _planned_bounds_iso(r.segment_start, r.segment_end)
            out_seg.append(
                {
                    "segmentIndex": int(r.segment_index),
                    "machineId": int(r.machine_id),
                    "plannedStart": ps_i or to_iso_or_none(r.segment_start),
                    "plannedEnd": pe_i or to_iso_or_none(r.segment_end),
                    "durationMin": int(r.duration_min),
                }
            )
        return out_seg
    ps = _coerce_planner_datetime(planned_start)
    pe = _coerce_planner_datetime(planned_end)
    if ps is not None and pe is not None:
        wall = max(0, int((pe - ps).total_seconds() // 60))
        dm = int(round(float(total_op_min or 0)))
        if dm <= 0:
            dm = max(1, wall) if wall else 1
        return [
            {
                "segmentIndex": 0,
                "machineId": int(machine_id),
                "plannedStart": ps.isoformat(),
                "plannedEnd": pe.isoformat(),
                "durationMin": dm,
            }
        ]
    return []


def map_operation_row(row, schedule_segments: list[dict] | None = None):
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
    planned_iso_start, planned_iso_end = _planned_bounds_iso(row.get("planned_start"), row.get("planned_end"))
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
        "plannedStart": planned_iso_start or to_iso_or_none(row.get("planned_start")),
        "plannedEnd": planned_iso_end or to_iso_or_none(row.get("planned_end")),
        "setupTimeMin": float(row["setup_time_min"] or 0),
        "laborTimeTotalMin": float(row["total_labor_time_min"] or 0),
        "totalOperationTimeMin": float(row["total_operation_time_min"] or 0),
        "qty": int(row["qty"] or 0),
        "expeditionDate": row["expedition_date"],
        "queuePosition": row["queue_position"],
        "materialReady": bool(row["material_ready"]) if row["material_ready"] is not None else False,
        "isCooperation": bool(row.get("is_cooperation")) if row.get("is_cooperation") is not None else False,
        "cooperationStatus": row.get("cooperation_status"),
        "cooperationSupplierPurchaseOrderId": row.get("cooperation_supplier_purchase_order_id"),
        "cooperationSentAt": to_iso_or_none(row.get("cooperation_sent_at")),
        "cooperationReceivedAt": to_iso_or_none(row.get("cooperation_received_at")),
        # F2: expose lock/blocking state to frontend detail panel
        "isLocked": bool(row.get("is_locked")) if row.get("is_locked") is not None else False,
        "planningStatus": row.get("planning_status"),
        "blockingReason": row.get("blocking_reason"),
    }
    blocker = row.get("cooperation_blocker")
    if blocker:
        out["blockedByCooperation"] = True
        out["cooperationBlocker"] = blocker
    if wid is not None:
        out["workplaceId"] = int(wid)
    mc = row.get("machine_code")
    if mc is not None and str(mc).strip():
        out["machineCode"] = str(mc).strip()
    if schedule_segments:
        out["scheduleSegments"] = schedule_segments
    return out


@router.get("/gantt")
def get_planner_gantt(from_date: str, to_date: str, db: Session = Depends(get_db)):
    from_dt = parse_date_or_400(from_date, "from_date")
    to_dt = parse_date_or_400(to_date, "to_date")

    if to_dt < from_dt:
        raise HTTPException(status_code=400, detail="Parametr to_date musi byt stejny nebo pozdejsi nez from_date.")

    visible_start = from_dt.replace(hour=0, minute=0, second=0, microsecond=0)
    visible_end = to_dt.replace(hour=23, minute=59, second=59, microsecond=999999)

    # Řádky Gantt = knihovna pracoviště (Planner jako zdroj pravdy); stroj v řádku = kotva MIN(m.id).
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
            m.machine_code AS machine_code,
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
            COALESCE(po.is_cooperation, 0) AS is_cooperation,
            po.cooperation_status AS cooperation_status,
            po.cooperation_supplier_purchase_order_id AS cooperation_supplier_purchase_order_id,
            po.cooperation_sent_at AS cooperation_sent_at,
            po.cooperation_received_at AS cooperation_received_at,
            po.is_locked AS is_locked,
            po.planning_status AS planning_status,
            po.blocking_reason AS blocking_reason,
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
            AND COALESCE(po.is_cooperation, 0) = 0
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
            m.machine_code AS machine_code,
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
            COALESCE(po.is_cooperation, 0) AS is_cooperation,
            po.cooperation_status AS cooperation_status,
            po.cooperation_supplier_purchase_order_id AS cooperation_supplier_purchase_order_id,
            po.cooperation_sent_at AS cooperation_sent_at,
            po.cooperation_received_at AS cooperation_received_at,
            po.is_locked AS is_locked,
            po.planning_status AS planning_status,
            po.blocking_reason AS blocking_reason,
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

    all_op_ids = {int(r["operation_id"]) for r in scheduled_rows} | {int(r["operation_id"]) for r in unscheduled_rows}
    seg_by_op = _batch_load_schedule_segments(db, all_op_ids)

    gantt_rows = list(scheduled_rows) + list(unscheduled_rows)
    next_map = _build_next_workplace_code_map(db, gantt_rows)
    cooperation_block_map = _build_cooperation_block_map(db, gantt_rows)

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
        r["cooperation_blocker"] = cooperation_block_map.get(int(row["operation_id"]))
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
        segs = _gantt_segment_payloads(
            int(r["machine_id"]),
            r.get("planned_start"),
            r.get("planned_end"),
            float(r.get("total_operation_time_min") or 0),
            seg_by_op.get(int(r["operation_id"])),
        )
        machine_map[wp_id]["items"].append(map_operation_row(r, segs))

    machines = list(machine_map.values())
    unscheduled_items = []
    for row in unscheduled_rows:
        r = dict(row)
        r["next_workplace_code"] = next_map.get(int(row["operation_id"]))
        r["cooperation_blocker"] = cooperation_block_map.get(int(row["operation_id"]))
        unscheduled_items.append(map_operation_row(r, []))

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
