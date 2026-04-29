import logging
import re
from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import func, not_, or_, select, text
from sqlalchemy.orm import Session

from app.api.deps import require_action
from app.core.database import get_db
from app.models.master_data import Machine
from app.models.master_libraries import OperationLibraryItem, WorkplaceLibraryItem
from app.models.material_library import MaterialLibraryItem
from app.models.material_stock import MaterialReservation
from app.core.scan_code import production_order_operation_scan_code_for_id, product_stock_scan_code_for_id
from app.models.orders import (
    CustomerOrder,
    Job,
    JobItem,
    ProductIssue,
    ProductionOrder,
    ProductionOrderOperation,
    ProductionOrderOperationLog,
)
from app.models.portfolio import (
    PortfolioItem,
    PortfolioTechnologyTemplate,
    PortfolioTechnologyTemplateMaterial,
    PortfolioTechnologyTemplateOperation,
)
from app.models.planning import PlanningOperation
from app.models.product_stock import ProductStockItem, ProductStockMovement, ProductStockReceipt
from app.models.restock_wip_reservation import RestockWipReservation
from app.models.work_report import WorkReport
from app.services.business_workflow import WORKFLOW_STATUS_CANCELLED, workflow_active_sql, workflow_record_active
from app.services.material_consumption import log_material_consumption_debug, total_material_consumption
from app.services.material_readiness import (
    evaluate_production_order_material_covered,
    evaluate_production_order_material_released,
)
from app.services.material_reservation_sync import cancel_active_reservations_for_production_order
from app.services.material_issue_rollback import (
    rollback_material_issue_movements_for_cancelled_production_order,
)
from app.services.material_traceability_vp import vp_material_traceability_for_input
from app.services.planning_operation_status import normalize_production_order_status
from app.services.production_order_operation_runtime import (
    operation_nos_for_production_order,
    operation_statuses_for_production_order,
)
from app.services.kiosk_planner_queue import cancel_open_planning_operations_for_vp_code
from app.services.kiosk_tp_stock_effects import rollback_kiosk_tp_stock_effects_for_vp_code
from app.services.planning_engine import PlanningEngineService
from app.services.planning_operation_status import normalize_planning_operation_status
from app.services.portfolio_drawing_overview import drawing_number_revision_by_portfolio_id
from app.services.vp_operational_metrics import (
    vp_operational_metrics_map,
    vp_operational_metrics_single,
)
from app.services.production_metrics_service import (
    operation_event_runtime_metrics_by_planning_id,
    production_order_metrics,
)
from app.services.vp_operation_generator import regenerate_single_production_order_from_tp
from app.services.vp_pila_operation_notes import apply_pila_cutting_notes_to_vp_operations, is_pila_operation_name

# Rezervace materiálu z TP se synchronizují z orders (vytvoření/úprava VP, řádky zakázky) a z portfolio (vstupy TP).
# Tento modul nemění portfolio ani množství VP tak, aby bylo potřeba zde spouštět přepočet rezervací.
from app.services.pdf_generator import generate_production_order_pdf
from app.services.restock_wip_reservation_fulfillment import fulfill_restock_wip_reservations_after_source_receipt

router = APIRouter()
logger = logging.getLogger(__name__)

class OperationReportPayload(BaseModel):
    ok_qty: int = Field(ge=0)
    nok_qty: int = Field(ge=0)
    reported_minutes: int = Field(ge=0)
    note: str | None = None


class ProductIssuePayload(BaseModel):
    product_stock_item_id: int
    qty: int = Field(gt=0)
    movement_date: datetime | None = None
    job_item_id: int | None = None
    customer_order_id: int | None = None
    note: str | None = None


class ReceiveToStockPayload(BaseModel):
    qty: float = Field(gt=0)
    location: str | None = None


def _normalize_stock_location(value: str | None) -> str | None:
    if value is None:
        return None
    t = value.strip()
    return t if t else None


def _job_item_optional_map(db: Session, item_ids: list[int]) -> tuple[dict[int, str | None], dict[int, int | None]]:
    if not item_ids:
        return ({}, {})
    cols = {r[1] for r in db.execute(text("PRAGMA table_info(job_items)")).fetchall()}
    has_desc = "description" in cols
    has_portfolio = "portfolio_item_id" in cols
    if not has_desc and not has_portfolio:
        return ({}, {})
    desc_map: dict[int, str | None] = {}
    portfolio_map: dict[int, int | None] = {}
    for iid in item_ids:
        sel = []
        if has_desc:
            sel.append("description")
        if has_portfolio:
            sel.append("portfolio_item_id")
        row = db.execute(
            text("SELECT " + ", ".join(sel) + " FROM job_items WHERE id = :id"),
            {"id": int(iid)},
        ).fetchone()
        if not row:
            continue
        idx = 0
        if has_desc:
            desc_map[int(iid)] = row[idx]
            idx += 1
        if has_portfolio:
            portfolio_map[int(iid)] = row[idx]
    return (desc_map, portfolio_map)


def _job_item_selling_price_per_piece(db: Session, ji: JobItem | None, portfolio: PortfolioItem | None) -> float | None:
    if ji is not None:
        cols = {r[1] for r in db.execute(text("PRAGMA table_info(job_items)")).fetchall()}
        price_cols = [
            c for c in ("selling_price_per_piece", "sales_price_per_unit", "sale_price_per_piece") if c in cols
        ]
        if price_cols:
            row = db.execute(
                text(f"SELECT {', '.join(price_cols)} FROM job_items WHERE id = :id"),
                {"id": int(ji.id)},
            ).fetchone()
            if row:
                for value in row:
                    if value is not None:
                        return float(value)

    if portfolio is not None and portfolio.sale_price_per_piece is not None:
        return float(portfolio.sale_price_per_piece)
    return None


def _production_order_financials(
    selling_price_per_piece: float | None,
    quantity: int | float | None,
    total_cost: int | float | None,
) -> dict[str, float | None]:
    revenue = float(selling_price_per_piece or 0.0) * float(quantity or 0.0)
    profit = revenue - float(total_cost or 0.0)
    margin_percent = (profit / revenue * 100.0) if revenue > 0 else None
    return {
        "revenue": revenue,
        "profit": profit,
        "margin_percent": margin_percent,
    }


def _recompute_and_set_po_status(db: Session, po: ProductionOrder, operation_nos: list[int]) -> str:
    _, any_activity, all_done = operation_statuses_for_production_order(db, int(po.id), operation_nos)
    if all_done:
        po.status = "hotovo"
    elif any_activity:
        po.status = "bezi"
    elif not po.status:
        po.status = "planned"
    return str(po.status or "planned")


def _terminal_phase_from_operation_name(name: str | None) -> str | None:
    """Sklad vs expedice podle názvu poslední operace TP (shoda s frontend productionOrderDetailHeader)."""
    if not name or not str(name).strip():
        return None
    n = str(name).strip().lower()
    if re.search(r"exped|expedi|balen|odesl|pick|ship", n):
        return "expedition"
    if re.search(r"příjem|prijem|sklad|náklad|naklad|stock|receipt", n):
        return "stock"
    return None


def _completion_terminal_phase_from_last_vp_operation(
    db: Session, po: ProductionOrder, operation_nos: list[int]
) -> str | None:
    if not operation_nos:
        return None
    last_no = max(int(x) for x in operation_nos)
    r = db.scalar(
        select(ProductionOrderOperation).where(
            ProductionOrderOperation.production_order_id == int(po.id),
            ProductionOrderOperation.operation_no == int(last_no),
        )
    )
    if r is None:
        return None
    return _terminal_phase_from_operation_name(r.operation_name)


def _vp_detail_operation_status_from_planning(planning_status: str | None) -> str:
    """Kanonicalizace pro UI (hlavička + tabulka): planning → stejné slovníky jako dříve u logů."""
    s = normalize_planning_operation_status(planning_status)
    if s == "hotovo":
        return "hotovo"
    if s == "bezi":
        return "bezi"
    return "planned"


def _work_report_totals_by_planning_operation_ids(
    db: Session, planning_ids: list[int]
) -> dict[int, dict[str, int]]:
    if not planning_ids:
        return {}
    rows = db.execute(
        select(
            WorkReport.planning_operation_id,
            func.coalesce(func.sum(WorkReport.qty_ok), 0),
            func.coalesce(func.sum(WorkReport.qty_nok), 0),
            func.coalesce(func.sum(func.coalesce(WorkReport.duration_min, 0.0)), 0.0),
        )
        .where(WorkReport.planning_operation_id.in_(planning_ids))
        .group_by(WorkReport.planning_operation_id)
    ).all()
    out: dict[int, dict[str, int]] = {}
    for r in rows:
        pid = int(r[0])
        out[pid] = {
            "reported_ok_qty_total": int(r[1] or 0),
            "reported_nok_qty_total": int(r[2] or 0),
            "reported_minutes_total": int(round(float(r[3] or 0.0))),
        }
    return out


def _aggregate_vp_status_from_merged_operations(po: ProductionOrder, operations: list[dict]) -> str:
    """Agregovaný stav VP ze sjednocených operation_status na řádcích (planning + případný fallback log)."""
    nos = [int(op["operation_no"]) for op in operations]
    if not nos:
        return normalize_production_order_status(po.status) or "planned"

    def _canon(st: str | None) -> str:
        x = (st or "planned").strip().lower()
        if x in ("hotovo", "done", "finished", "complete", "completed"):
            return "hotovo"
        if x in ("bezi", "running", "in_progress", "started"):
            return "bezi"
        return "planned"

    st_vals = [_canon(op.get("operation_status")) for op in operations]
    all_done = all(v == "hotovo" for v in st_vals)
    any_activity = any(v in ("bezi", "hotovo") for v in st_vals)
    return _po_aggregate_status_string(po, nos, all_done, any_activity)


def _completion_percent_from_operations(operations: list[dict]) -> float | None:
    if not operations:
        return None
    done = 0
    for op in operations:
        st = (op.get("operation_status") or "planned").strip().lower()
        if st in ("hotovo", "done", "finished", "complete", "completed"):
            done += 1
    return round(100.0 * float(done) / float(len(operations)), 1)


def _current_phase_from_operations(operations: list[dict]) -> str | None:
    if not operations:
        return None

    def _canon(st: str | None) -> str:
        x = (st or "planned").strip().lower()
        if x in ("hotovo", "done", "finished", "complete", "completed"):
            return "hotovo"
        if x in ("bezi", "running", "in_progress", "started"):
            return "bezi"
        return "planned"

    st_vals = [_canon(op.get("operation_status")) for op in operations]
    if all(s == "hotovo" for s in st_vals):
        return "hotovo"
    if any(s == "bezi" for s in st_vals):
        return "bezi"
    return "planned"


def _machine_code_for_header(machine: Machine | None) -> str:
    if machine is None:
        return "—"
    code = (machine.machine_code or "").strip()
    if code:
        return code
    name = (machine.name or "").strip()
    return name or "—"


def _planning_operation_header_line(
    op: PlanningOperation | None,
    machines_by_id: dict[int, Machine],
) -> str | None:
    if op is None:
        return None
    machine = machines_by_id.get(int(op.machine_id)) if op.machine_id is not None else None
    return f"{int(op.operation_no or 0)}. {op.operation_name} — {_machine_code_for_header(machine)}"


def _planning_operation_header(
    planning_operations: list[PlanningOperation],
    machines_by_id: dict[int, Machine],
) -> dict[str, str | None]:
    sorted_ops = sorted(
        planning_operations,
        key=lambda op: (int(op.operation_no or 0), int(op.id or 0)),
    )
    if not sorted_ops:
        return {
            "completed_operation": None,
            "current_operation": "Hotovo",
            "next_operation": None,
        }

    last_done: PlanningOperation | None = None
    for op in sorted_ops:
        if normalize_planning_operation_status(op.status) == "hotovo":
            last_done = op

    current_index: int | None = None
    for idx, op in enumerate(sorted_ops):
        if normalize_planning_operation_status(op.status) != "hotovo":
            current_index = idx
            break

    current = sorted_ops[current_index] if current_index is not None else None
    next_op = (
        sorted_ops[current_index + 1]
        if current_index is not None and current_index + 1 < len(sorted_ops)
        else None
    )

    return {
        "completed_operation": _planning_operation_header_line(last_done, machines_by_id),
        "current_operation": _planning_operation_header_line(current, machines_by_id) if current is not None else "Hotovo",
        "next_operation": _planning_operation_header_line(next_op, machines_by_id),
    }


def _po_aggregate_status_string(
    po: ProductionOrder, operation_nos: list[int], all_done: bool, any_activity: bool
) -> str:
    """Kanonický agregovaný stav VP (planned | bezi | hotovo) — shodně v přehledu i detailu."""
    if not operation_nos:
        return normalize_production_order_status(po.status) or "planned"
    if all_done:
        return "hotovo"
    if any_activity:
        return "bezi"
    return normalize_production_order_status(po.status) or "planned"


def _overview_operational_status_and_terminal(
    db: Session, po: ProductionOrder,
) -> tuple[str, str | None]:
    """
    Stejná agregace jako GET detail (logy operací), ne jen production_orders.status v DB.
    Druhá hodnota: stock | expedition podle názvu poslední operace při plném dokončení.
    """
    operation_nos = operation_nos_for_production_order(db, po)
    if not operation_nos:
        return (normalize_production_order_status(po.status) or "planned", None)
    _, any_activity, all_done = operation_statuses_for_production_order(db, int(po.id), operation_nos)
    terminal = (
        _completion_terminal_phase_from_last_vp_operation(db, po, operation_nos) if all_done else None
    )
    return (_po_aggregate_status_string(po, operation_nos, all_done, any_activity), terminal)


def _ensure_product_stock_receipt_for_done_po(db: Session, po: ProductionOrder) -> None:
    if int(po.quantity or 0) <= 0:
        return
    existing = db.scalars(
        select(ProductStockReceipt).where(ProductStockReceipt.production_order_id == int(po.id))
    ).first()
    if existing is not None:
        return
    portfolio_item_id = int(po.portfolio_item_id) if po.portfolio_item_id is not None else None
    if portfolio_item_id is None:
        return
    stock = db.scalars(
        select(ProductStockItem)
        .where(ProductStockItem.portfolio_item_id == portfolio_item_id)
        .order_by(ProductStockItem.id.asc())
    ).first()
    if stock is None:
        stock = ProductStockItem(
            portfolio_item_id=portfolio_item_id,
            location="EXPEDICE",
            current_qty=0,
            min_qty=0,
            unit="ks",
            note="Auto-created from completed production order.",
            is_active=True,
        )
        db.add(stock)
        db.flush()
    qty = float(po.quantity or 0)
    stock.current_qty = float(stock.current_qty or 0) + qty
    db.add(
        ProductStockReceipt(
            product_stock_item_id=int(stock.id),
            production_order_id=int(po.id),
            qty_received=qty,
            received_at=datetime.utcnow(),
            note=f"Auto receipt from {po.vp_code}",
        )
    )
    db.add(
        ProductStockMovement(
            stock_item_id=int(stock.id),
            movement_type="prijem",
            qty=qty,
            movement_date=datetime.utcnow(),
            reference=f"VP:{po.vp_code}",
            note="Auto receipt from production completion.",
        )
    )


def _ensure_operation_scan_rows(db: Session, po: ProductionOrder) -> None:
    portfolio_item_id = int(po.portfolio_item_id) if po.portfolio_item_id is not None else None
    if portfolio_item_id is None and po.job_item_id is not None:
        _, portfolio_map = _job_item_optional_map(db, [int(po.job_item_id)])
        portfolio_item_id = portfolio_map.get(int(po.job_item_id))
    if portfolio_item_id is None:
        return
    tpl = db.scalars(
        select(PortfolioTechnologyTemplate)
        .where(
            PortfolioTechnologyTemplate.portfolio_item_id == portfolio_item_id,
            PortfolioTechnologyTemplate.is_active.is_(True),
        )
        .order_by(PortfolioTechnologyTemplate.id.asc())
    ).first()
    if tpl is None:
        tpl = db.scalars(
            select(PortfolioTechnologyTemplate)
            .where(PortfolioTechnologyTemplate.portfolio_item_id == portfolio_item_id)
            .order_by(PortfolioTechnologyTemplate.id.asc())
        ).first()
    if tpl is None:
        return
    tpl_ops = db.scalars(
        select(PortfolioTechnologyTemplateOperation)
        .where(PortfolioTechnologyTemplateOperation.template_id == int(tpl.id))
        .order_by(PortfolioTechnologyTemplateOperation.operation_no.asc(), PortfolioTechnologyTemplateOperation.id.asc())
    ).all()
    normalized_tpl_ops: list[tuple[int, PortfolioTechnologyTemplateOperation]] = [
        ((idx + 1) * 10, op) for idx, op in enumerate(tpl_ops)
    ]
    tp_op_nos = {int(no) for no, _ in normalized_tpl_ops}
    stale_rows = db.scalars(
        select(ProductionOrderOperation).where(
            ProductionOrderOperation.production_order_id == int(po.id)
        )
    ).all()
    for stale in stale_rows:
        if int(stale.operation_no) not in tp_op_nos:
            db.delete(stale)
    db.flush()
    for effective_no, op in normalized_tpl_ops:
        ex = db.scalar(
            select(ProductionOrderOperation).where(
                ProductionOrderOperation.production_order_id == int(po.id),
                ProductionOrderOperation.operation_no == int(effective_no),
            )
        )
        if ex is None:
            wname = op.workplace
            wid = op.workplace_library_item_id
            if wid is not None:
                wp_lib = db.get(WorkplaceLibraryItem, int(wid))
                if wp_lib is not None:
                    wname = wp_lib.name
            row = ProductionOrderOperation(
                production_order_id=int(po.id),
                operation_no=int(effective_no),
                operation_name=op.operation_name,
                workplace_name=wname,
                workplace_library_item_id=int(wid) if wid is not None else None,
            )
            db.add(row)
            db.flush()
            row.scan_code = production_order_operation_scan_code_for_id(int(row.id))
        else:
            # Keep VP operation scans aligned with current TP order and continuous numbering (10,20,30,...).
            if int(ex.operation_no) != int(effective_no):
                ex.operation_no = int(effective_no)
    ji = db.get(JobItem, int(po.job_item_id)) if po.job_item_id is not None else None
    apply_pila_cutting_notes_to_vp_operations(db, po=po, job_item=ji)


def _refresh_pila_cutting_notes_for_print_detail(db: Session, po: ProductionOrder) -> JobItem | None:
    _ensure_operation_scan_rows(db, po)
    ji = db.get(JobItem, int(po.job_item_id)) if po.job_item_id is not None else None
    logger.info(
        "[vp_pila_notes] print/detail refresh po_id=%s job_item_id=%s",
        int(po.id),
        int(po.job_item_id) if po.job_item_id is not None else None,
    )
    apply_pila_cutting_notes_to_vp_operations(db, po=po, job_item=ji)
    db.flush()
    db.commit()
    return ji


@router.get("")
def list_production_orders(
    workflow_filter: str = Query("active", description="active | cancelled | all"),
    limit: int | None = Query(None, ge=1, le=2000, description="Server-side pagination: max. záznamů na stránku."),
    offset: int = Query(0, ge=0, description="Server-side pagination: offset od začátku."),
    db: Session = Depends(get_db),
):
    """
    Přehled VP — připraveno na server-side pagination:
    - `limit` + `offset` + `total` v odpovědi.
    - pokud `limit` není uveden, vrací se všechny řádky pro klientskou pagination/search.
    Response: `{items, total, limit, offset}`.
    """
    wf = (workflow_filter or "active").strip().lower()
    if wf not in ("active", "cancelled", "all"):
        wf = "active"
    q = select(ProductionOrder)
    if wf == "active":
        q = q.where(workflow_active_sql(ProductionOrder.workflow_status))
    elif wf == "cancelled":
        q = q.where(not_(workflow_active_sql(ProductionOrder.workflow_status)))

    # Celkový počet po aplikaci filtru (pro pagination UI).
    count_stmt = select(func.count()).select_from(q.subquery())
    total = int(db.scalar(count_stmt) or 0)

    page_q = q.order_by(ProductionOrder.id.desc())
    if limit is not None:
        page_q = page_q.offset(int(offset)).limit(int(limit))
    rows = db.scalars(page_q).all()
    if not rows:
        return {
            "items": [],
            "total": total,
            "limit": int(limit) if limit is not None else 0,
            "offset": int(offset),
        }

    job_item_ids = sorted({int(r.job_item_id) for r in rows if r.job_item_id is not None})
    job_ids = sorted({int(r.job_id) for r in rows if r.job_id is not None})
    customer_order_ids = sorted({int(r.customer_order_id) for r in rows if r.customer_order_id is not None})

    job_items = db.scalars(select(JobItem).where(JobItem.id.in_(job_item_ids))).all() if job_item_ids else []
    jobs = db.scalars(select(Job).where(Job.id.in_(job_ids))).all() if job_ids else []
    customer_orders = (
        db.scalars(select(CustomerOrder).where(CustomerOrder.id.in_(customer_order_ids))).all()
        if customer_order_ids
        else []
    )
    item_by_id = {int(i.id): i for i in job_items}
    job_by_id = {int(j.id): j for j in jobs}
    co_by_id = {int(c.id): c for c in customer_orders}
    desc_map, portfolio_map = _job_item_optional_map(db, job_item_ids)

    resolved_portfolio_for_draw: list[int | None] = []
    for po in rows:
        ji = item_by_id.get(int(po.job_item_id)) if po.job_item_id is not None else None
        rid: int | None = None
        if po.portfolio_item_id is not None:
            rid = int(po.portfolio_item_id)
        elif ji is not None:
            rid = portfolio_map.get(int(ji.id))
        resolved_portfolio_for_draw.append(rid)
    draw_by_pid = drawing_number_revision_by_portfolio_id(db, resolved_portfolio_for_draw)

    metrics_by_id = vp_operational_metrics_map(db, rows)

    out: list[dict] = []
    for idx, po in enumerate(rows):
        wf_ok = workflow_record_active(po)
        mat_cov = evaluate_production_order_material_covered(db, po) if wf_ok else False
        mat_rel = evaluate_production_order_material_released(db, po) if wf_ok else False
        ji = item_by_id.get(int(po.job_item_id)) if po.job_item_id is not None else None
        job = job_by_id.get(int(po.job_id)) if po.job_id is not None else None
        co = co_by_id.get(int(po.customer_order_id)) if po.customer_order_id is not None else None
        resolved_portfolio_id: int | None = None
        if po.portfolio_item_id is not None:
            resolved_portfolio_id = int(po.portfolio_item_id)
        elif ji is not None:
            resolved_portfolio_id = portfolio_map.get(int(ji.id))
        op_status, completion_terminal = _overview_operational_status_and_terminal(db, po)
        mm = metrics_by_id.get(int(po.id)) or {}
        pid_draw = resolved_portfolio_for_draw[idx]
        dr_num, dr_rev = (
            draw_by_pid.get(int(pid_draw), (None, None)) if pid_draw is not None else (None, None)
        )
        out.append(
            {
                "id": int(po.id),
                "vp_code": po.vp_code,
                "scan_code": po.scan_code,
                "gpn": po.gpn or (ji.gpn if ji is not None else None),
                "description": po.description or desc_map.get(int(ji.id)) if ji is not None else po.description,
                "drawing_number": dr_num,
                "drawing_revision": dr_rev,
                "quantity": int(po.quantity or 0),
                "logistic_mode": po.logistic_mode,
                "source_type": po.source_type,
                "status": op_status,
                "completion_terminal": completion_terminal,
                "zakazka": job.zak_code if job is not None else None,
                "customer_order_no": (co.customer_po_no if co is not None else None),
                "line_no": int(ji.line_no) if ji is not None and ji.line_no is not None else None,
                "due_date": ji.due_date.isoformat() if ji is not None and ji.due_date is not None else None,
                "order_type": str(getattr(co, "order_type", "customer") or "customer"),
                "portfolio_item_id": resolved_portfolio_id,
                "customer_order_id": int(po.customer_order_id) if po.customer_order_id is not None else None,
                "job_item_id": int(po.job_item_id) if po.job_item_id is not None else None,
                "workflow_status": getattr(po, "workflow_status", None) or "active",
                "is_material_covered": mat_cov,
                "is_material_released_to_production": mat_rel,
                "is_material_ready": mat_rel,
                "restock_redirected_from_internal": bool(getattr(po, "restock_redirected_from_internal", False)),
                "blocked_until_reserved_stock_receipt": bool(
                    getattr(po, "blocked_until_reserved_stock_receipt", False)
                ),
                "reported_time_min": int(mm.get("reported_time_min") or 0),
                "direct_labor_cost": float(mm.get("direct_labor_cost") or 0.0),
                "employee_labor_cost": float(mm.get("employee_labor_cost") or 0.0),
                "machine_cost": float(mm.get("machine_cost") or 0.0),
                "labor_cost": float(mm.get("labor_cost") or mm.get("direct_labor_cost") or 0.0),
                "missing_employee_rate": bool(mm.get("missing_employee_rate") or False),
                "missing_machine_rate": bool(mm.get("missing_machine_rate") or False),
                "completion_percent": mm.get("completion_percent"),
                "performance_percent": mm.get("performance_percent"),
            }
        )
    return {
        "items": out,
        "total": total,
        "limit": int(limit) if limit is not None else total,
        "offset": int(offset),
    }


@router.get("/restock-wip-reservation-notices")
def list_restock_wip_reservation_notices(
    limit: int = Query(30, ge=1, le=200),
    db: Session = Depends(get_db),
):
    """Aktivní/pending rezervace výstupu z restock VP (signál pro UI: čeká se na příjem rezervovaného výstupu)."""
    rows = db.scalars(
        select(RestockWipReservation)
        .where(
            RestockWipReservation.status == "pending",
            RestockWipReservation.reserved_qty > 0,
        )
        .order_by(RestockWipReservation.created_at.desc(), RestockWipReservation.id.desc())
        .limit(int(limit))
    ).all()
    if not rows:
        return {"items": []}
    src_ids = {int(r.source_production_order_id) for r in rows}
    cust_ids = {
        int(r.fulfillment_customer_production_order_id)
        for r in rows
        if r.fulfillment_customer_production_order_id is not None
    }
    src_pos = db.scalars(select(ProductionOrder).where(ProductionOrder.id.in_(src_ids))).all() if src_ids else []
    cust_pos = (
        db.scalars(select(ProductionOrder).where(ProductionOrder.id.in_(cust_ids))).all() if cust_ids else []
    )
    src_by_id = {int(p.id): p for p in src_pos}
    cust_by_id = {int(p.id): p for p in cust_pos}
    items: list[dict] = []
    for r in rows:
        sp = src_by_id.get(int(r.source_production_order_id))
        # Jen skutečně aktivní vazby: zdrojový VP musí existovat a být workflow active.
        if sp is None or not workflow_record_active(sp):
            continue
        cp = (
            cust_by_id.get(int(r.fulfillment_customer_production_order_id))
            if r.fulfillment_customer_production_order_id is not None
            else None
        )
        if cp is not None and not workflow_record_active(cp):
            continue
        items.append(
            {
                "reservation_id": int(r.id),
                "status": r.status,
                "created_at": r.created_at.isoformat() if r.created_at else None,
                "reserved_qty": int(r.reserved_qty or 0),
                "source_production_order_id": int(r.source_production_order_id),
                "source_vp_code": sp.vp_code if sp is not None else None,
                "customer_production_order_id": int(r.fulfillment_customer_production_order_id)
                if r.fulfillment_customer_production_order_id is not None
                else None,
                "customer_vp_code": cp.vp_code if cp is not None else None,
                "user_message_cs": (
                    "Příjem rezervovaného výstupu čeká na naskladnění. "
                    "Následný výrobní příkaz zákazníka bude odblokován po příjmu."
                ),
            }
        )
    return {"items": items}


@router.post("/{production_order_id}/storno")
def storno_production_order(
    production_order_id: int,
    db: Session = Depends(get_db),
    _rbac: None = Depends(require_action("production.storno")),
):
    po = db.get(ProductionOrder, production_order_id)
    if po is None:
        raise HTTPException(status_code=404, detail="Výrobní příkaz nebyl nalezen.")
    if not workflow_record_active(po):
        raise HTTPException(status_code=409, detail="Výrobní příkaz je již stornován.")
    po.workflow_status = WORKFLOW_STATUS_CANCELLED
    rollback_kiosk_tp_stock_effects_for_vp_code(db, po.vp_code)
    rollback_material_issue_movements_for_cancelled_production_order(db, po)
    cancel_open_planning_operations_for_vp_code(db, po.vp_code)
    ji_id = int(po.job_item_id) if po.job_item_id is not None else None
    material_ids: set[int] = set()
    if ji_id is not None:
        material_ids = {
            int(mid)
            for mid in db.scalars(
                select(MaterialReservation.material_library_item_id).where(
                    MaterialReservation.job_item_id == ji_id
                ).distinct()
            ).all()
            if mid is not None
        }
    cancel_active_reservations_for_production_order(db, int(po.id), reason="production_order_storno")
    from app.services.material_readiness import (
        refresh_material_readiness_for_material_library_item,
        refresh_production_order_material_readiness,
    )

    refresh_production_order_material_readiness(db, po)
    for mid in material_ids:
        refresh_material_readiness_for_material_library_item(db, mid)
    db.commit()
    db.refresh(po)
    return {"status": "ok", "production_order_id": int(po.id)}


@router.post("/{production_order_id}/regenerate-from-tp")
def regenerate_one_production_order_from_tp(
    production_order_id: int,
    db: Session = Depends(get_db),
    _rbac: None = Depends(require_action("production.execute")),
):
    po = db.get(ProductionOrder, int(production_order_id))
    if po is None:
        raise HTTPException(status_code=404, detail="Výrobní příkaz nebyl nalezen.")
    if not workflow_record_active(po):
        raise HTTPException(status_code=409, detail="Výrobní příkaz je stornován.")

    ops = db.scalars(
        select(PlanningOperation).where(PlanningOperation.work_order_no == (po.vp_code or "").strip())
    ).all()
    has_completed = any(normalize_planning_operation_status(o.status) == "hotovo" for o in ops)
    has_running = any(normalize_planning_operation_status(o.status) == "bezi" for o in ops)
    if has_completed or has_running:
        raise HTTPException(
            status_code=409,
            detail="Nelze přegenerovat VP: obsahuje dokončené nebo běžící operace. Nejprve je vraťte do plánovaného stavu.",
        )

    out = regenerate_single_production_order_from_tp(db, po)
    planner_rows = PlanningEngineService(db).rebuild_global_schedules(date.today())
    db.commit()
    return {
        "status": "ok",
        "production_order_id": int(po.id),
        "vp_code": po.vp_code,
        "regenerate": out,
        "planner_rows": len(planner_rows),
    }


@router.post("/{production_order_id}/receive-to-stock")
def receive_finished_goods_to_stock(
    production_order_id: int,
    payload: ReceiveToStockPayload,
    db: Session = Depends(get_db),
    _rbac: None = Depends(require_action("stock.mutate")),
):
    """Ruční příjem hotového výrobku na sklad výrobků (pohyb příjem + zápis příjemky)."""
    po = db.get(ProductionOrder, production_order_id)
    if po is None:
        raise HTTPException(status_code=404, detail="Výrobní příkaz nebyl nalezen.")
    if not workflow_record_active(po):
        raise HTTPException(status_code=409, detail="Výrobní příkaz je stornován.")
    portfolio_item_id = int(po.portfolio_item_id) if po.portfolio_item_id is not None else None
    if portfolio_item_id is None:
        raise HTTPException(status_code=422, detail="VP nemá navázanou portfolio položku — nelze přijmout na sklad.")

    loc = _normalize_stock_location(payload.location)
    qty = float(payload.qty)

    if loc is not None:
        stock = db.scalars(
            select(ProductStockItem)
            .where(
                ProductStockItem.portfolio_item_id == portfolio_item_id,
                ProductStockItem.location == loc,
            )
            .order_by(ProductStockItem.id.asc())
        ).first()
    else:
        stock = db.scalars(
            select(ProductStockItem)
            .where(ProductStockItem.portfolio_item_id == portfolio_item_id)
            .where(or_(ProductStockItem.location.is_(None), ProductStockItem.location == ""))
            .order_by(ProductStockItem.id.asc())
        ).first()

    if stock is None:
        stock = ProductStockItem(
            portfolio_item_id=portfolio_item_id,
            location=loc,
            current_qty=0,
            min_qty=0,
            unit="ks",
            note="Vytvořeno ručním příjmem z VP.",
            is_active=True,
        )
        db.add(stock)
        db.flush()
        stock.scan_code = product_stock_scan_code_for_id(int(stock.id))

    stock.current_qty = float(stock.current_qty or 0) + qty
    if loc is not None:
        stock.location = loc

    db.add(
        ProductStockReceipt(
            product_stock_item_id=int(stock.id),
            production_order_id=int(po.id),
            qty_received=qty,
            received_at=datetime.utcnow(),
            note=f"Ruční příjem VP {po.vp_code}",
        )
    )
    db.add(
        ProductStockMovement(
            stock_item_id=int(stock.id),
            movement_type="prijem",
            qty=qty,
            movement_date=datetime.utcnow(),
            reference=f"VP:{po.vp_code}",
            note="Ruční příjem na sklad výrobků.",
        )
    )
    db.flush()
    restock_fulfillment = fulfill_restock_wip_reservations_after_source_receipt(
        db, source_production_order_id=int(po.id)
    )
    db.commit()
    return {
        "status": "ok",
        "product_stock_item_id": int(stock.id),
        "qty_received": qty,
        "current_qty": float(stock.current_qty or 0),
        "restock_wip_reservation_fulfillment": restock_fulfillment,
    }


@router.get("/{production_order_id}")
def get_production_order_detail(production_order_id: int, db: Session = Depends(get_db)):
    po = db.get(ProductionOrder, production_order_id)
    if po is None:
        raise HTTPException(status_code=404, detail="Výrobní příkaz nebyl nalezen.")
    wf = getattr(po, "workflow_status", None)
    ji = _refresh_pila_cutting_notes_for_print_detail(db, po)
    job = db.get(Job, po.job_id) if po.job_id is not None else None
    co = db.get(CustomerOrder, po.customer_order_id) if po.customer_order_id is not None else None

    desc_map, portfolio_map = _job_item_optional_map(db, [int(ji.id)] if ji is not None else [])
    portfolio_item_id = int(po.portfolio_item_id) if po.portfolio_item_id is not None else portfolio_map.get(int(ji.id)) if ji is not None else None
    portfolio = db.get(PortfolioItem, int(portfolio_item_id)) if portfolio_item_id is not None else None

    tp_template = None
    if portfolio is not None:
        tp_template = db.scalars(
            select(PortfolioTechnologyTemplate)
            .where(
                PortfolioTechnologyTemplate.portfolio_item_id == int(portfolio.id),
                PortfolioTechnologyTemplate.is_active.is_(True),
            )
            .order_by(PortfolioTechnologyTemplate.id.asc())
        ).first()
        if tp_template is None:
            tp_template = db.scalars(
                select(PortfolioTechnologyTemplate)
                .where(PortfolioTechnologyTemplate.portfolio_item_id == int(portfolio.id))
                .order_by(PortfolioTechnologyTemplate.id.asc())
            ).first()

    operations: list[dict] = []
    inputs: list[dict] = []
    operation_nos: list[int] = []
    op_scan_rows = db.scalars(
        select(ProductionOrderOperation)
        .where(ProductionOrderOperation.production_order_id == int(po.id))
        .order_by(ProductionOrderOperation.operation_no.asc(), ProductionOrderOperation.id.asc())
    ).all()
    op_scan_by_no = {int(r.operation_no): r for r in op_scan_rows}

    if tp_template is not None:
        op_rows = db.scalars(
            select(PortfolioTechnologyTemplateOperation)
            .where(PortfolioTechnologyTemplateOperation.template_id == int(tp_template.id))
            .order_by(PortfolioTechnologyTemplateOperation.operation_no.asc(), PortfolioTechnologyTemplateOperation.id.asc())
        ).all()
        for idx, op in enumerate(op_rows):
            effective_no = (idx + 1) * 10
            operation_nos.append(int(effective_no))
            op_lib = db.get(OperationLibraryItem, op.operation_library_item_id) if op.operation_library_item_id is not None else None
            wp_lib = db.get(WorkplaceLibraryItem, op.workplace_library_item_id) if op.workplace_library_item_id is not None else None
            scan_row = op_scan_by_no.get(int(effective_no))
            operation_name = op_lib.name if op_lib is not None else op.operation_name
            generated_note = (getattr(scan_row, "note", None) if scan_row is not None else None)
            note_for_detail = (
                generated_note
                if generated_note and is_pila_operation_name(operation_name)
                else op.note
            )
            operations.append(
                {
                    "id": int(op.id),
                    "operation_no": int(effective_no),
                    "operation_name": operation_name,
                    "workplace_library_item_id": op.workplace_library_item_id,
                    "workplace_name": wp_lib.name if wp_lib is not None else op.workplace,
                    "setup_time_min": float(op.setup_min or 0),
                    "run_min_per_piece": float(op.run_min_per_piece or 0),
                    "control_required": bool(op.control_required),
                    "outsourcing": bool(op.outsourcing),
                    "note": note_for_detail,
                    "vp_operation_note": generated_note,
                    "operation_scan_code": (scan_row.scan_code if scan_row is not None else None),
                    "machine_id": None,
                    "machine_code": None,
                    "machine_name": None,
                }
            )

        input_rows = db.scalars(
            select(PortfolioTechnologyTemplateMaterial)
            .where(PortfolioTechnologyTemplateMaterial.template_id == int(tp_template.id))
            .order_by(PortfolioTechnologyTemplateMaterial.id.asc())
        ).all()
        po_qty = int(po.quantity or 0)
        for row in input_rows:
            mat = db.get(MaterialLibraryItem, row.material_library_item_id) if row.material_library_item_id is not None else None
            in_portfolio = db.get(PortfolioItem, row.portfolio_item_id) if row.portfolio_item_id is not None else None
            per_piece = float(row.consumption_per_piece or 0)
            kerf = max(float(row.scrap_allowance or 0), 0.0)
            total_inp = total_material_consumption(per_piece, kerf, po_qty)
            log_material_consumption_debug(
                context="production_order_detail_inputs",
                vp_code=po.vp_code,
                material_library_item_id=int(row.material_library_item_id) if row.material_library_item_id is not None else None,
                template_material_id=int(row.id),
                consumption_per_piece=per_piece,
                kerf_per_piece=kerf,
                quantity=float(po_qty),
                total=total_inp,
            )
            inp_row: dict = {
                "id": int(row.id),
                "input_type": (row.input_type or "material"),
                "material_code": mat.code if mat is not None else None,
                "material_name": mat.name if mat is not None else None,
                "portfolio_item_gpn": in_portfolio.gpn if in_portfolio is not None else None,
                "portfolio_item_name": in_portfolio.name if in_portfolio is not None else None,
                "consumption_per_piece": per_piece,
                "consumption_unit": row.consumption_unit,
                "scrap_allowance": float(row.scrap_allowance or 0),
                "total_consumption": total_inp,
                "note": row.note,
                "material_library_item_id": int(row.material_library_item_id) if row.material_library_item_id is not None else None,
                "material_traceability": None,
            }
            itype = str(row.input_type or "material").strip().lower()
            if itype == "material" and row.material_library_item_id is not None:
                inp_row["material_traceability"] = vp_material_traceability_for_input(
                    db, po, int(row.material_library_item_id)
                )
            inputs.append(inp_row)

    log_status_by_no: dict[int, dict] = {}
    if operation_nos:
        log_status_by_no, _, _ = operation_statuses_for_production_order(db, int(po.id), operation_nos)

    planning_rows: list[PlanningOperation] = []
    planning_by_no: dict[int, PlanningOperation] = {}
    vp_code = (po.vp_code or "").strip()
    if vp_code:
        planning_rows = list(db.scalars(
            select(PlanningOperation)
            .where(PlanningOperation.work_order_no == vp_code)
            .order_by(PlanningOperation.operation_no.asc(), PlanningOperation.id.asc())
        ).all())
        for prow in planning_rows:
            planning_by_no[int(prow.operation_no)] = prow

    machine_ids = sorted({int(p.machine_id) for p in planning_rows if p.machine_id is not None})
    machines_by_id = {
        int(m.id): m
        for m in db.scalars(select(Machine).where(Machine.id.in_(machine_ids))).all()
    } if machine_ids else {}
    operation_header = _planning_operation_header(planning_rows, machines_by_id)
    runtime_by_planning_id = operation_event_runtime_metrics_by_planning_id(
        db, planning_rows, machines_by_id
    )

    wr_by_planning = _work_report_totals_by_planning_operation_ids(
        db, [int(p.id) for p in planning_by_no.values()]
    )

    for op in operations:
        no = int(op["operation_no"])
        pl = planning_by_no.get(no)
        if pl is not None:
            op["operation_status"] = _vp_detail_operation_status_from_planning(pl.status)
            op["started_at"] = pl.actual_start.isoformat() if pl.actual_start else None
            op["last_reported_at"] = (
                pl.actual_end.isoformat()
                if pl.actual_end is not None
                and normalize_planning_operation_status(pl.status) == "hotovo"
                else None
            )
            wt = wr_by_planning.get(int(pl.id))
            op["reported_ok_qty_total"] = int(wt["reported_ok_qty_total"]) if wt else 0
            op["reported_nok_qty_total"] = int(wt["reported_nok_qty_total"]) if wt else 0
            op["reported_minutes_total"] = int(wt["reported_minutes_total"]) if wt else 0
            runtime_metrics = runtime_by_planning_id.get(int(pl.id)) or {}
            op["elapsed_time_min"] = runtime_metrics.get("elapsed_time_min")
            op["pause_time_min"] = runtime_metrics.get("pause_time_min")
            op["working_time_min"] = runtime_metrics.get("working_time_min")
            op["planned_time_min"] = runtime_metrics.get("planned_time_min")
            op["performance_percent"] = runtime_metrics.get("performance_percent")
            machine = machines_by_id.get(int(pl.machine_id)) if pl.machine_id is not None else None
            op["machine_id"] = int(pl.machine_id) if pl.machine_id is not None else None
            op["machine_code"] = machine.machine_code if machine is not None else None
            op["machine_name"] = machine.name if machine is not None else None
        else:
            st = log_status_by_no.get(no)
            if st:
                op.update(st)

    po_status = (
        _aggregate_vp_status_from_merged_operations(po, operations)
        if operations
        else (normalize_production_order_status(po.status) or "planned")
    )

    wf_ok_detail = workflow_record_active(po)
    mat_cov_d = evaluate_production_order_material_covered(db, po) if wf_ok_detail else False
    mat_rel_d = evaluate_production_order_material_released(db, po) if wf_ok_detail else False

    om = vp_operational_metrics_single(db, po)
    production_metrics = production_order_metrics(db, po)
    total_cost = float(production_metrics.get("total_cost") or 0.0)
    financials = _production_order_financials(
        _job_item_selling_price_per_piece(db, ji, portfolio),
        int(po.quantity or 0),
        total_cost,
    )
    unified_completion = _completion_percent_from_operations(operations) if operations else None
    unified_phase = _current_phase_from_operations(operations) if operations else None

    draw_map = drawing_number_revision_by_portfolio_id(
        db, [int(portfolio.id)] if portfolio is not None else []
    )
    draw_num_d, draw_rev_d = (
        draw_map.get(int(portfolio.id), (None, None)) if portfolio is not None else (None, None)
    )

    return {
        "id": int(po.id),
        "vp_code": po.vp_code,
        "scan_code": po.scan_code,
        "workflow_status": wf,
        "zakazka": job.zak_code if job is not None else None,
        "customer_order_no": (co.customer_po_no if co is not None else None),
        "customer_order_id": int(po.customer_order_id) if po.customer_order_id is not None else None,
        "job_item_id": int(po.job_item_id) if po.job_item_id is not None else None,
        "order_type": str(getattr(co, "order_type", "customer") or "customer"),
        "line_no": int(ji.line_no) if ji is not None and ji.line_no is not None else None,
        "restock_redirected_from_internal": bool(getattr(po, "restock_redirected_from_internal", False)),
        "blocked_until_reserved_stock_receipt": bool(
            getattr(po, "blocked_until_reserved_stock_receipt", False)
        ),
        "gpn": po.gpn or (ji.gpn if ji is not None else None),
        "description": po.description or (desc_map.get(int(ji.id)) if ji is not None else None),
        "drawing_number": draw_num_d,
        "drawing_revision": draw_rev_d,
        "portfolio_item_id": int(portfolio.id) if portfolio is not None else None,
        "portfolio_item_gpn": portfolio.gpn if portfolio is not None else None,
        "portfolio_item_name": portfolio.name if portfolio is not None else None,
        "portfolio_item_logistic_mode": portfolio.logistic_mode if portfolio is not None else None,
        "logistic_mode": po.logistic_mode,
        "source_type": po.source_type,
        "status": po_status,
        "is_material_covered": mat_cov_d,
        "is_material_released_to_production": mat_rel_d,
        "is_material_ready": mat_rel_d,
        "quantity": int(po.quantity or 0),
        "due_date": ji.due_date.isoformat() if ji is not None and ji.due_date is not None else None,
        "technology_template": {
            "id": int(tp_template.id),
            "name": tp_template.name,
        }
        if tp_template is not None
        else None,
        "operations": operations,
        "inputs": inputs,
        "reported_time_min": float(production_metrics.get("reported_time_min") or 0.0),
        "direct_labor_cost": float(production_metrics.get("labor_cost") or 0.0),
        "labor_cost": float(production_metrics.get("labor_cost") or 0.0),
        "employee_labor_cost": float(production_metrics.get("employee_labor_cost") or 0.0),
        "machine_cost": float(production_metrics.get("machine_cost") or 0.0),
        "material_cost": float(production_metrics.get("material_cost") or 0.0),
        "total_cost": total_cost,
        "revenue": financials["revenue"],
        "profit": financials["profit"],
        "margin_percent": financials["margin_percent"],
        "missing_employee_rate": bool(production_metrics.get("missing_employee_rate") or False),
        "missing_machine_rate": bool(production_metrics.get("missing_machine_rate") or False),
        "missing_material_cost_data": bool(production_metrics.get("missing_material_cost_data") or False),
        "completion_percent": unified_completion if operations else om.get("completion_percent"),
        "performance_percent": production_metrics.get("performance_percent"),
        "current_location": om.get("current_location"),
        "current_phase": unified_phase if operations else om.get("current_phase"),
        "operation_header": operation_header,
    }


@router.post("/{production_order_id}/operations/{operation_no}/start")
def start_production_order_operation(
    production_order_id: int,
    operation_no: int,
    db: Session = Depends(get_db),
    _rbac: None = Depends(require_action("production.execute")),
):
    po = db.get(ProductionOrder, production_order_id)
    if po is None:
        raise HTTPException(status_code=404, detail="Výrobní příkaz nebyl nalezen.")
    if not workflow_record_active(po):
        raise HTTPException(status_code=409, detail="Výrobní příkaz je stornován.")
    if not (
        evaluate_production_order_material_released(db, po)
        if workflow_record_active(po)
        else False
    ):
        raise HTTPException(
            status_code=409,
            detail="Nelze zahájit operaci: materiál nebyl vydán na výrobu (nejprve vydání ze skladu).",
        )
    _ensure_operation_scan_rows(db, po)
    operation_nos = operation_nos_for_production_order(db, po)
    if operation_nos and int(operation_no) not in operation_nos:
        raise HTTPException(status_code=422, detail="Operace pro tento VP neexistuje.")

    db.add(
        ProductionOrderOperationLog(
            production_order_id=int(po.id),
            operation_no=int(operation_no),
            event_type="start",
            created_at=datetime.utcnow(),
        )
    )

    new_status = _recompute_and_set_po_status(db, po, operation_nos)
    db.commit()
    return {"status": "ok", "po_status": new_status}


@router.post("/{production_order_id}/operations/{operation_no}/report")
def report_production_order_operation(
    production_order_id: int,
    operation_no: int,
    payload: OperationReportPayload,
    db: Session = Depends(get_db),
    _rbac: None = Depends(require_action("production.execute")),
):
    po = db.get(ProductionOrder, production_order_id)
    if po is None:
        raise HTTPException(status_code=404, detail="Výrobní příkaz nebyl nalezen.")
    if not workflow_record_active(po):
        raise HTTPException(status_code=409, detail="Výrobní příkaz je stornován.")
    _ensure_operation_scan_rows(db, po)
    operation_nos = operation_nos_for_production_order(db, po)
    if operation_nos and int(operation_no) not in operation_nos:
        raise HTTPException(status_code=422, detail="Operace pro tento VP neexistuje.")

    db.add(
        ProductionOrderOperationLog(
            production_order_id=int(po.id),
            operation_no=int(operation_no),
            event_type="report",
            ok_qty=int(payload.ok_qty),
            nok_qty=int(payload.nok_qty),
            reported_minutes=int(payload.reported_minutes),
            note=(payload.note.strip() if payload.note else None),
            created_at=datetime.utcnow(),
        )
    )

    new_status = _recompute_and_set_po_status(db, po, operation_nos)
    restock_fulfillment: dict | None = None
    if new_status == "hotovo":
        _ensure_product_stock_receipt_for_done_po(db, po)
        db.flush()
        restock_fulfillment = fulfill_restock_wip_reservations_after_source_receipt(
            db, source_production_order_id=int(po.id)
        )
    db.commit()
    out: dict = {"status": "ok", "po_status": new_status}
    if restock_fulfillment is not None:
        out["restock_wip_reservation_fulfillment"] = restock_fulfillment
    return out


@router.post("/product/issue")
def issue_product_from_stock(
    payload: ProductIssuePayload,
    db: Session = Depends(get_db),
    _rbac: None = Depends(require_action("stock.mutate")),
):
    stock = db.get(ProductStockItem, int(payload.product_stock_item_id))
    if stock is None:
        raise HTTPException(status_code=404, detail="Skladová karta výrobku nebyla nalezena.")
    if float(stock.current_qty or 0) < float(payload.qty):
        raise HTTPException(status_code=409, detail="Nedostatečné množství na skladě výrobků.")
    movement_date = payload.movement_date or datetime.utcnow()
    stock.current_qty = float(stock.current_qty or 0) - float(payload.qty)
    db.add(
        ProductStockMovement(
            stock_item_id=int(stock.id),
            movement_type="vydej",
            qty=float(payload.qty),
            movement_date=movement_date,
            reference=(
                f"CO:{payload.customer_order_id};JI:{payload.job_item_id}"
                if payload.customer_order_id or payload.job_item_id
                else None
            ),
            note=(payload.note.strip() if payload.note else None),
        )
    )
    issue = ProductIssue(
        product_stock_item_id=int(stock.id),
        job_item_id=payload.job_item_id,
        customer_order_id=payload.customer_order_id,
        qty=int(payload.qty),
        note=(payload.note.strip() if payload.note else None),
        issued_at=movement_date,
    )
    db.add(issue)
    db.commit()
    db.refresh(issue)
    return {
        "status": "ok",
        "issue_id": int(issue.id),
        "product_stock_item_id": int(stock.id),
        "qty": int(issue.qty),
        "job_item_id": issue.job_item_id,
        "customer_order_id": issue.customer_order_id,
    }


@router.get("/{production_order_id}/print")
def print_production_order_pdf(
    production_order_id: int,
    db: Session = Depends(get_db),
    _rbac: None = Depends(require_action("production.execute")),
):
    po = db.get(ProductionOrder, production_order_id)
    if po is None:
        raise HTTPException(status_code=404, detail="Výrobní příkaz nebyl nalezen.")
    _refresh_pila_cutting_notes_for_print_detail(db, po)
    pdf_bytes = generate_production_order_pdf(int(production_order_id))
    safe_name = (po.vp_code or f"{production_order_id}").replace("/", "-")
    filename = f"VP-{safe_name}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{filename}"'},
    )


