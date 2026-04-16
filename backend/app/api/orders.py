import logging
from collections import defaultdict
from datetime import date
from typing import Literal

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, inspect as sa_inspect, select, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from app.api.deps import get_effective_actor, require_action
from app.core.database import get_db
from app.core.scan_code import (
    customer_order_scan_code_for_id,
    order_item_scan_code_for_id,
    production_order_operation_scan_code_for_id,
    production_order_scan_code_for_id,
)
from app.models.master_data import Customer
from app.models.material_stock import MaterialReservation, MaterialStockItem
from app.models.master_libraries import WorkplaceLibraryItem
from app.models.portfolio import (
    PortfolioItem,
    PortfolioTechnologyTemplate,
    PortfolioTechnologyTemplateMaterial,
    PortfolioTechnologyTemplateOperation,
)
from app.models.orders import (
    CustomerOrder,
    Job,
    JobItem,
    JobItemCoverage,
    ProductionOrder,
    ProductionOrderOperation,
)
from app.models.restock_wip_reservation import RestockWipReservation
from app.services.material_consumption import log_material_consumption_debug, total_material_consumption
from app.services.fulfillment_decision_audit import insert_fulfillment_decision_audit
from app.services.sklad_zakaznik_fulfillment import (
    SkladZakaznikFulfillmentPlan,
    build_sklad_zakaznik_fulfillment_plan,
    compute_sklad_zakaznik_customer_split,
    list_sklad_zakaznik_resolution_options,
    normalize_restock_resolution_strategy,
    wip_primary_restock_po_for_plan,
)
from app.services.vp_operation_generator import (
    _vp_planning_pipeline_snapshot,
    ensure_planning_operations_for_production_order,
)
from app.services.business_numbering import next_internal_code, next_vp_code, next_zak_code
from app.services.planning_operation_status import normalize_production_order_status
from app.services.business_workflow import (
    WORKFLOW_STATUS_CANCELLED,
    workflow_active_sql,
    workflow_record_active,
)
from app.services.job_item_operational_metrics import job_item_operational_metrics_map
from app.services.job_item_production_labels import production_labels_for_job_item
from app.services.portfolio_drawing_overview import drawing_number_revision_by_portfolio_id
from app.services.material_reservation_sync import (
    MATERIAL_RESERVATION_ACTIVE_STATUSES,
    cancel_active_reservations_for_production_order,
    cancel_reservations_for_job_item,
    rebuild_tp_material_reservations_for_job_item,
    rebuild_tp_material_reservations_for_production_order,
    sum_eligible_reserved_qty_for_material,
    supersede_active_tp_auto_for_po,
)

router = APIRouter()
logger = logging.getLogger(__name__)


def _production_orders_for_job_item_and_source(
    db: Session,
    *,
    job_item_id: int,
    source_type: str,
) -> list[ProductionOrder]:
    return db.scalars(
        select(ProductionOrder)
        .where(
            ProductionOrder.job_item_id == int(job_item_id),
            ProductionOrder.source_type == str(source_type),
            workflow_active_sql(ProductionOrder.workflow_status),
        )
        .order_by(ProductionOrder.id.asc())
    ).all()


def _log_duplicate_production_flow(
    *,
    job_item_id: int,
    source_type: str,
    rows: list[ProductionOrder],
    duplicate_flow_warnings: list[dict],
) -> None:
    if len(rows) <= 1:
        return
    ids = [int(p.id) for p in rows]
    logger.warning(
        "[production_flow] DUPLICATE_FLOW job_item_id=%s source_type=%s production_order_count=%s ids=%s",
        job_item_id,
        source_type,
        len(rows),
        ids,
    )
    duplicate_flow_warnings.append(
        {
            "job_item_id": int(job_item_id),
            "source_type": source_type,
            "production_order_count": len(rows),
            "production_order_ids": ids,
            "flag": "duplicate_production_orders_same_job_item_source",
        }
    )


def ensure_orders_sqlite_schema(engine: Engine) -> None:
    """SQLite: doplnění sloupců hlavičky zakázky pro ruční vytvoření."""
    try:
        url = str(engine.url)
    except Exception:
        return
    if not url.startswith("sqlite"):
        return

    insp = sa_inspect(engine)
    if "customer_orders" not in insp.get_table_names():
        return
    cols = {c["name"] for c in insp.get_columns("customer_orders")}
    stmts: list[str] = []
    if "customer_id" not in cols:
        stmts.append("ALTER TABLE customer_orders ADD COLUMN customer_id INTEGER")
    if "requested_ship_date" not in cols:
        stmts.append("ALTER TABLE customer_orders ADD COLUMN requested_ship_date DATE")
    if "note" not in cols:
        stmts.append("ALTER TABLE customer_orders ADD COLUMN note VARCHAR(500)")
    if "order_type" not in cols:
        stmts.append("ALTER TABLE customer_orders ADD COLUMN order_type VARCHAR(20)")
    if "scan_code" not in cols:
        stmts.append("ALTER TABLE customer_orders ADD COLUMN scan_code VARCHAR(32)")
    if "workflow_status" not in cols:
        stmts.append("ALTER TABLE customer_orders ADD COLUMN workflow_status VARCHAR(20)")
    with engine.begin() as conn:
        for stmt in stmts:
            conn.execute(text(stmt))
        conn.execute(
            text(
                "UPDATE customer_orders SET order_type = 'customer' "
                "WHERE order_type IS NULL OR TRIM(COALESCE(order_type, '')) = ''"
            )
        )
        conn.execute(
            text(
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_customer_orders_scan_code "
                "ON customer_orders (scan_code)"
            )
        )
        rows = conn.execute(text("SELECT id, scan_code FROM customer_orders ORDER BY id ASC")).fetchall()
        for row in rows:
            if row[1] is None or str(row[1]).strip() == "":
                conn.execute(
                    text("UPDATE customer_orders SET scan_code = :scan WHERE id = :id"),
                    {"id": int(row[0]), "scan": customer_order_scan_code_for_id(int(row[0]))},
                )

    # job_items columns used by manual create flow
    if "job_items" in insp.get_table_names():
        item_cols = {c["name"] for c in insp.get_columns("job_items")}
        item_stmts: list[str] = []
        if "line_no" not in item_cols:
            item_stmts.append("ALTER TABLE job_items ADD COLUMN line_no INTEGER")
        if "description" not in item_cols:
            item_stmts.append("ALTER TABLE job_items ADD COLUMN description VARCHAR(500)")
        if "portfolio_item_id" not in item_cols:
            item_stmts.append("ALTER TABLE job_items ADD COLUMN portfolio_item_id INTEGER")
        if "scan_code" not in item_cols:
            item_stmts.append("ALTER TABLE job_items ADD COLUMN scan_code VARCHAR(32)")
        if "workflow_status" not in item_cols:
            item_stmts.append("ALTER TABLE job_items ADD COLUMN workflow_status VARCHAR(20)")
        with engine.begin() as conn:
            for stmt in item_stmts:
                conn.execute(text(stmt))
            conn.execute(
                text(
                    "CREATE UNIQUE INDEX IF NOT EXISTS uq_job_items_scan_code "
                    "ON job_items (scan_code)"
                )
            )
            # Historická normalizace: vždy přepočítej line_no per job_id na 10,20,30...
            # podle pořadí id, aby se opravily legacy hodnoty 1,2,3.
            rows = conn.execute(
                text("SELECT id, job_id FROM job_items ORDER BY job_id ASC, id ASC")
            ).fetchall()
            next_line_by_job: dict[int, int] = {}
            for row in rows:
                item_id = int(row[0])
                job_id = int(row[1]) if row[1] is not None else 0
                line_no = next_line_by_job.get(job_id, 10)
                conn.execute(
                    text("UPDATE job_items SET line_no = :line_no WHERE id = :id"),
                    {"line_no": line_no, "id": item_id},
                )
                row_scan = conn.execute(
                    text("SELECT scan_code FROM job_items WHERE id = :id"), {"id": item_id}
                ).fetchone()
                if row_scan and (row_scan[0] is None or str(row_scan[0]).strip() == ""):
                    conn.execute(
                        text("UPDATE job_items SET scan_code = :scan WHERE id = :id"),
                        {"scan": order_item_scan_code_for_id(item_id), "id": item_id},
                    )
                next_line_by_job[job_id] = line_no + 10

    # production_orders columns for first VP creation flow from allocation
    if "production_orders" in insp.get_table_names():
        po_cols = {c["name"] for c in insp.get_columns("production_orders")}
        po_stmts: list[str] = []
        if "customer_order_id" not in po_cols:
            po_stmts.append("ALTER TABLE production_orders ADD COLUMN customer_order_id INTEGER")
        if "job_id" not in po_cols:
            po_stmts.append("ALTER TABLE production_orders ADD COLUMN job_id INTEGER")
        if "portfolio_item_id" not in po_cols:
            po_stmts.append("ALTER TABLE production_orders ADD COLUMN portfolio_item_id INTEGER")
        if "gpn" not in po_cols:
            po_stmts.append("ALTER TABLE production_orders ADD COLUMN gpn VARCHAR(120)")
        if "description" not in po_cols:
            po_stmts.append("ALTER TABLE production_orders ADD COLUMN description VARCHAR(500)")
        if "quantity" not in po_cols:
            po_stmts.append("ALTER TABLE production_orders ADD COLUMN quantity INTEGER")
        if "logistic_mode" not in po_cols:
            po_stmts.append("ALTER TABLE production_orders ADD COLUMN logistic_mode VARCHAR(40)")
        if "source_type" not in po_cols:
            po_stmts.append("ALTER TABLE production_orders ADD COLUMN source_type VARCHAR(40)")
        if "status" not in po_cols:
            po_stmts.append("ALTER TABLE production_orders ADD COLUMN status VARCHAR(30)")
        if "scan_code" not in po_cols:
            po_stmts.append("ALTER TABLE production_orders ADD COLUMN scan_code VARCHAR(32)")
        if "workflow_status" not in po_cols:
            po_stmts.append("ALTER TABLE production_orders ADD COLUMN workflow_status VARCHAR(20)")
        if "is_material_ready" not in po_cols:
            po_stmts.append(
                "ALTER TABLE production_orders ADD COLUMN is_material_ready BOOLEAN NOT NULL DEFAULT 0"
            )
        if "is_material_covered" not in po_cols:
            po_stmts.append(
                "ALTER TABLE production_orders ADD COLUMN is_material_covered BOOLEAN NOT NULL DEFAULT 0"
            )
        if "is_material_released_to_production" not in po_cols:
            po_stmts.append(
                "ALTER TABLE production_orders ADD COLUMN is_material_released_to_production BOOLEAN NOT NULL DEFAULT 0"
            )
        if "restock_redirected_from_internal" not in po_cols:
            po_stmts.append(
                "ALTER TABLE production_orders ADD COLUMN restock_redirected_from_internal BOOLEAN NOT NULL DEFAULT 0"
            )
        if "blocked_until_reserved_stock_receipt" not in po_cols:
            po_stmts.append(
                "ALTER TABLE production_orders ADD COLUMN blocked_until_reserved_stock_receipt BOOLEAN NOT NULL DEFAULT 0"
            )
        with engine.begin() as conn:
            for stmt in po_stmts:
                conn.execute(text(stmt))
            conn.execute(text("DROP INDEX IF EXISTS uq_production_orders_item_source"))
            conn.execute(text("DROP INDEX IF EXISTS uq_production_orders_item_source_active"))
            conn.execute(
                text(
                    "CREATE UNIQUE INDEX IF NOT EXISTS uq_production_orders_item_source_logistic_active "
                    "ON production_orders (job_item_id, source_type, COALESCE(logistic_mode, '')) "
                    "WHERE COALESCE(workflow_status, 'active') = 'active' "
                    "AND job_item_id IS NOT NULL AND source_type IS NOT NULL"
                )
            )
            conn.execute(
                text(
                    "CREATE UNIQUE INDEX IF NOT EXISTS uq_production_orders_scan_code "
                    "ON production_orders (scan_code)"
                )
            )
            po_rows = conn.execute(text("SELECT id, scan_code FROM production_orders ORDER BY id ASC")).fetchall()
            for po_row in po_rows:
                if po_row[1] is None or str(po_row[1]).strip() == "":
                    conn.execute(
                        text("UPDATE production_orders SET scan_code = :scan WHERE id = :id"),
                        {"scan": production_order_scan_code_for_id(int(po_row[0])), "id": int(po_row[0])},
                    )

    with engine.begin() as conn:
        conn.execute(
            text(
                "CREATE TABLE IF NOT EXISTS job_item_coverages ("
                "id INTEGER PRIMARY KEY, "
                "job_item_id INTEGER NOT NULL, "
                "coverage_type VARCHAR(40) NOT NULL, "
                "qty INTEGER NOT NULL, "
                "source_production_order_id INTEGER NULL, "
                "source_stock_receipt_id INTEGER NULL, "
                "consuming_production_order_id INTEGER NULL, "
                "note VARCHAR(500) NULL, "
                "FOREIGN KEY(job_item_id) REFERENCES job_items (id), "
                "FOREIGN KEY(source_production_order_id) REFERENCES production_orders (id), "
                "FOREIGN KEY(source_stock_receipt_id) REFERENCES product_stock_receipts (id), "
                "FOREIGN KEY(consuming_production_order_id) REFERENCES production_orders (id)"
                ")"
            )
        )
        conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_job_item_coverages_job_item_id "
                "ON job_item_coverages (job_item_id)"
            )
        )
        conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_job_item_coverages_consuming_po_id "
                "ON job_item_coverages (consuming_production_order_id)"
            )
        )
        conn.execute(
            text(
                "CREATE TABLE IF NOT EXISTS production_order_operation_logs ("
                "id INTEGER PRIMARY KEY, "
                "production_order_id INTEGER NOT NULL, "
                "operation_no INTEGER NOT NULL, "
                "event_type VARCHAR(20) NOT NULL, "
                "ok_qty INTEGER NULL, "
                "nok_qty INTEGER NULL, "
                "reported_minutes INTEGER NULL, "
                "note VARCHAR(500) NULL, "
                "created_at DATETIME NOT NULL, "
                "FOREIGN KEY(production_order_id) REFERENCES production_orders (id)"
                ")"
            )
        )
        conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_po_operation_logs_po_id "
                "ON production_order_operation_logs (production_order_id)"
            )
        )
        conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_po_operation_logs_po_op "
                "ON production_order_operation_logs (production_order_id, operation_no)"
            )
        )
        conn.execute(
            text(
                "CREATE TABLE IF NOT EXISTS restock_wip_reservations ("
                "id INTEGER PRIMARY KEY AUTOINCREMENT, "
                "source_production_order_id INTEGER NOT NULL, "
                "target_job_item_id INTEGER NOT NULL, "
                "customer_order_id INTEGER NOT NULL, "
                "reserved_qty INTEGER NOT NULL, "
                "status VARCHAR(20) NOT NULL DEFAULT 'pending', "
                "fulfillment_customer_production_order_id INTEGER NULL, "
                "replenishment_production_order_id INTEGER NULL, "
                "created_at DATETIME NOT NULL, "
                "fulfilled_at DATETIME NULL, "
                "FOREIGN KEY(source_production_order_id) REFERENCES production_orders (id), "
                "FOREIGN KEY(target_job_item_id) REFERENCES job_items (id), "
                "FOREIGN KEY(customer_order_id) REFERENCES customer_orders (id), "
                "FOREIGN KEY(fulfillment_customer_production_order_id) REFERENCES production_orders (id), "
                "FOREIGN KEY(replenishment_production_order_id) REFERENCES production_orders (id)"
                ")"
            )
        )
        conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_restock_wip_res_src_po "
                "ON restock_wip_reservations (source_production_order_id)"
            )
        )
        conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_restock_wip_res_tgt_ji "
                "ON restock_wip_reservations (target_job_item_id)"
            )
        )
        conn.execute(
            text(
                "CREATE TABLE IF NOT EXISTS production_order_operations ("
                "id INTEGER PRIMARY KEY, "
                "production_order_id INTEGER NOT NULL, "
                "operation_no INTEGER NOT NULL, "
                "operation_name VARCHAR(255) NOT NULL, "
                "workplace_name VARCHAR(255) NULL, "
                "scan_code VARCHAR(32) NULL, "
                "FOREIGN KEY(production_order_id) REFERENCES production_orders (id)"
                ")"
            )
        )
        conn.execute(
            text(
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_production_order_operations_po_op "
                "ON production_order_operations (production_order_id, operation_no)"
            )
        )
        conn.execute(
            text(
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_production_order_operations_scan_code "
                "ON production_order_operations (scan_code)"
            )
        )
        op_rows = conn.execute(
            text("SELECT id, scan_code FROM production_order_operations ORDER BY id ASC")
        ).fetchall()
        for op_row in op_rows:
            if op_row[1] is None or str(op_row[1]).strip() == "":
                conn.execute(
                    text("UPDATE production_order_operations SET scan_code = :scan WHERE id = :id"),
                    {
                        "scan": production_order_operation_scan_code_for_id(int(op_row[0])),
                        "id": int(op_row[0]),
                    },
                )
        conn.execute(
            text(
                "CREATE TABLE IF NOT EXISTS product_issues ("
                "id INTEGER PRIMARY KEY, "
                "product_stock_item_id INTEGER NOT NULL, "
                "job_item_id INTEGER NULL, "
                "customer_order_id INTEGER NULL, "
                "qty INTEGER NOT NULL, "
                "note VARCHAR(500) NULL, "
                "issued_at DATETIME NOT NULL, "
                "FOREIGN KEY(product_stock_item_id) REFERENCES product_stock_items (id), "
                "FOREIGN KEY(job_item_id) REFERENCES job_items (id), "
                "FOREIGN KEY(customer_order_id) REFERENCES customer_orders (id)"
                ")"
            )
        )
        conn.execute(
            text("CREATE INDEX IF NOT EXISTS ix_product_issues_product_stock_item_id ON product_issues (product_stock_item_id)")
        )
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_product_issues_job_item_id ON product_issues (job_item_id)"))
        conn.execute(
            text("CREATE INDEX IF NOT EXISTS ix_product_issues_customer_order_id ON product_issues (customer_order_id)")
        )
        conn.execute(
            text(
                "CREATE TABLE IF NOT EXISTS fulfillment_decision_audit ("
                "id INTEGER PRIMARY KEY AUTOINCREMENT, "
                "created_at DATETIME NOT NULL, "
                "decision_phase VARCHAR(20) NOT NULL, "
                "actor VARCHAR(255) NULL, "
                "customer_order_id INTEGER NOT NULL, "
                "job_item_id INTEGER NOT NULL, "
                "gpn VARCHAR(120) NULL, "
                "portfolio_item_id INTEGER NULL, "
                "decision_mode VARCHAR(40) NULL, "
                "recommended_strategy VARCHAR(40) NULL, "
                "chosen_strategy VARCHAR(40) NULL, "
                "requested_qty INTEGER NOT NULL, "
                "finished_stock_qty_before INTEGER NULL, "
                "minimum_stock_target_qty INTEGER NULL, "
                "wip_restock_qty_before INTEGER NULL, "
                "stock_issue_qty INTEGER NULL, "
                "wip_reservation_qty INTEGER NULL, "
                "new_customer_production_qty INTEGER NULL, "
                "internal_restock_qty INTEGER NULL, "
                "stock_after_issue_qty INTEGER NULL, "
                "future_stock_after_wip_qty INTEGER NULL, "
                "source_restock_production_order_id INTEGER NULL, "
                "stock_allocation_production_order_id INTEGER NULL, "
                "customer_order_allocation_production_order_id INTEGER NULL, "
                "vyroba_zakaznik_production_order_id INTEGER NULL, "
                "internal_restock_production_order_id INTEGER NULL, "
                "restock_wip_reservation_id INTEGER NULL, "
                "note VARCHAR(500) NULL, "
                "details_json TEXT NULL, "
                "FOREIGN KEY(customer_order_id) REFERENCES customer_orders (id), "
                "FOREIGN KEY(job_item_id) REFERENCES job_items (id), "
                "FOREIGN KEY(source_restock_production_order_id) REFERENCES production_orders (id), "
                "FOREIGN KEY(stock_allocation_production_order_id) REFERENCES production_orders (id), "
                "FOREIGN KEY(customer_order_allocation_production_order_id) REFERENCES production_orders (id), "
                "FOREIGN KEY(vyroba_zakaznik_production_order_id) REFERENCES production_orders (id), "
                "FOREIGN KEY(internal_restock_production_order_id) REFERENCES production_orders (id), "
                "FOREIGN KEY(restock_wip_reservation_id) REFERENCES restock_wip_reservations (id)"
                ")"
            )
        )
        conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_fulfillment_audit_customer_order_id "
                "ON fulfillment_decision_audit (customer_order_id)"
            )
        )
        conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_fulfillment_audit_job_item_id "
                "ON fulfillment_decision_audit (job_item_id)"
            )
        )

    if "production_order_operations" in insp.get_table_names():
        poo_cols = {c["name"] for c in sa_inspect(engine).get_columns("production_order_operations")}
        if "workplace_library_item_id" not in poo_cols:
            with engine.begin() as conn:
                conn.execute(
                    text("ALTER TABLE production_order_operations ADD COLUMN workplace_library_item_id INTEGER")
                )

    if "restock_wip_reservations" in insp.get_table_names():
        rwr_cols = {c["name"] for c in sa_inspect(engine).get_columns("restock_wip_reservations")}
        if "fulfilled_at" not in rwr_cols:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE restock_wip_reservations ADD COLUMN fulfilled_at DATETIME"))


class CustomerOrderCreatePayload(BaseModel):
    customer_id: int | None = None
    customer_po_no: str = Field(default="")
    order_type: Literal["customer", "internal"] = "customer"
    order_date: date
    requested_ship_date: date | None = None
    note: str | None = None


class JobItemCreatePayload(BaseModel):
    job_id: int
    gpn: str = Field(..., min_length=1)
    name: str | None = None
    quantity: int = Field(..., gt=0)
    due_date: date | None = None
    portfolio_item_id: int | None = None


class JobItemUpdatePayload(BaseModel):
    gpn: str = Field(..., min_length=1)
    name: str | None = None
    quantity: int = Field(..., gt=0)
    due_date: date | None = None
    portfolio_item_id: int | None = None


class CustomerOrderUpdatePayload(BaseModel):
    customer_id: int
    customer_po_no: str = Field(..., min_length=1)
    order_date: date
    requested_ship_date: date | None = None
    note: str | None = None


class ProductionOrderCreateFromAllocationRow(BaseModel):
    id: int
    vp_code: str
    job_item_id: int
    source_type: str
    logistic_mode: str
    quantity: int
    status: str
    state: str


def _normalize_note(v: str | None) -> str | None:
    if v is None:
        return None
    t = str(v).strip()
    return t if t else None


def _next_line_no(db: Session, job_id: int) -> int:
    row = db.scalar(select(JobItem.line_no).where(JobItem.job_id == job_id).order_by(JobItem.line_no.desc()).limit(1))
    return (int(row) + 10) if row is not None else 10


def _validate_portfolio_item_gpn(db: Session, gpn: str, portfolio_item_id: int | None) -> None:
    if portfolio_item_id is None:
        return
    p_item = db.scalar(select(PortfolioItem).where(PortfolioItem.id == portfolio_item_id))
    if p_item is None:
        raise HTTPException(status_code=404, detail="Portfolio položka nebyla nalezena.")
    if (p_item.gpn or "").strip().lower() != gpn.strip().lower():
        raise HTTPException(
            status_code=422,
            detail="GPN položky objednávky musí odpovídat GPN vybrané portfolio položky.",
        )


def _get_or_create_internal_order_and_job(db: Session) -> tuple[CustomerOrder, Job]:
    internal_orders = db.scalars(
        select(CustomerOrder).where(getattr(CustomerOrder, "order_type") == "internal").order_by(CustomerOrder.id.asc())
    ).all()
    for co in internal_orders:
        if not workflow_record_active(co):
            continue
        if not getattr(co, "scan_code", None):
            co.scan_code = customer_order_scan_code_for_id(int(co.id))
        job = db.scalars(
            select(Job).where(Job.customer_order_id == co.id).order_by(Job.id.asc())
        ).first()
        if job is not None:
            return co, job

    internal_code = next_internal_code(db)
    co = CustomerOrder(
        customer_po_no=internal_code,
        customer_name="Interní doplnění skladu",
        order_date=date.today(),
        order_type="internal",
    )
    setattr(co, "customer_id", None)
    setattr(co, "requested_ship_date", None)
    setattr(co, "note", "Automaticky vytvořeno pro doplnění skladu.")
    db.add(co)
    db.flush()
    co.scan_code = customer_order_scan_code_for_id(int(co.id))

    job = Job(
        zak_code=internal_code,
        customer_order_id=co.id,
    )
    db.add(job)
    db.flush()
    return co, job


def _create_new_internal_order_and_job(db: Session) -> tuple[CustomerOrder, Job]:
    """
    Vždy nová interní objednávka + zakázka (ne sdílená s existujícími řádky).
    Pro náhradní doplnění skladu po rezervaci WIP — nesmí sdílet job_item se zdrojovým restock VP.
    """
    internal_code = next_internal_code(db)
    co = CustomerOrder(
        customer_po_no=internal_code,
        customer_name="Interní doplnění skladu",
        order_date=date.today(),
        order_type="internal",
    )
    setattr(co, "customer_id", None)
    setattr(co, "requested_ship_date", None)
    setattr(co, "note", "Automaticky vytvořeno — náhradní doplnění skladu (rezervace WIP pro zákazníka).")
    db.add(co)
    db.flush()
    co.scan_code = customer_order_scan_code_for_id(int(co.id))

    job = Job(
        zak_code=internal_code,
        customer_order_id=co.id,
    )
    db.add(job)
    db.flush()
    return co, job


def _find_internal_job_item_by_portfolio(
    db: Session,
    internal_job_id: int,
    portfolio_item_id: int,
    has_portfolio: bool,
) -> JobItem | None:
    """Vrátí první interní řádek se stejným portfolio_item_id (deterministicky podle id)."""
    if not has_portfolio:
        return None
    raw = db.execute(
        text(
            "SELECT id FROM job_items WHERE job_id = :jid AND portfolio_item_id = :pid "
            "ORDER BY id ASC LIMIT 1"
        ),
        {"jid": int(internal_job_id), "pid": int(portfolio_item_id)},
    ).fetchone()
    if not raw:
        return None
    row = db.get(JobItem, int(raw[0]))
    if row is not None and not getattr(row, "scan_code", None):
        row.scan_code = order_item_scan_code_for_id(int(row.id))
    return row


def _sync_internal_restock_job_item_qty(db: Session, job_item_id: int) -> None:
    """Qty interního řádku = součet množství VP typu restock_allocation (ne poptávka zákazníka)."""
    total = db.scalar(
        select(func.coalesce(func.sum(ProductionOrder.quantity), 0)).where(
            ProductionOrder.job_item_id == int(job_item_id),
            ProductionOrder.source_type == "restock_allocation",
        )
    )
    row = db.get(JobItem, int(job_item_id))
    if row is not None:
        row.qty = int(total or 0)


def _create_internal_restock_job_item(
    db: Session,
    internal_job_id: int,
    customer_item: JobItem,
    portfolio_item_id: int,
    description: str | None,
    qty: int,
    has_portfolio: bool,
    has_desc: bool,
) -> JobItem:
    """Nová interní řádka pro doplnění skladu (restock), navázaná na portfolio."""
    line_no = _next_line_no(db, internal_job_id)
    gpn = (customer_item.gpn or "").strip()
    if not gpn:
        gpn = "—"
    row = JobItem(
        job_id=internal_job_id,
        line_no=line_no,
        gpn=gpn,
        qty=int(qty),
        due_date=customer_item.due_date,
    )
    db.add(row)
    db.flush()
    row.scan_code = order_item_scan_code_for_id(int(row.id))
    if has_desc:
        db.execute(
            text("UPDATE job_items SET description = :description WHERE id = :id"),
            {"description": description, "id": row.id},
        )
    if has_portfolio:
        db.execute(
            text("UPDATE job_items SET portfolio_item_id = :pid WHERE id = :id"),
            {"pid": int(portfolio_item_id), "id": row.id},
        )
    db.flush()
    return row


def _job_item_allocation_values(
    db: Session,
    item: JobItem,
    portfolio_item_id: int | None,
) -> tuple[float, float, float]:
    required_qty = float(item.qty or 0.0)
    if portfolio_item_id is None:
        return (0.0, required_qty, 0.0)
    stock_rows = db.execute(
        text(
            "SELECT COALESCE(SUM(current_qty), 0), COALESCE(SUM(min_qty), 0) "
            "FROM product_stock_items WHERE portfolio_item_id = :pid"
        ),
        {"pid": int(portfolio_item_id)},
    ).fetchone()
    stock_qty = float(stock_rows[0] or 0.0) if stock_rows else 0.0
    min_qty = float(stock_rows[1] or 0.0) if stock_rows else 0.0
    from_stock_qty = min(required_qty, stock_qty)
    to_production_qty = max(required_qty - stock_qty, 0.0)
    remaining_after_allocation = stock_qty - from_stock_qty
    restock_qty = max(min_qty - remaining_after_allocation, 0.0)
    return (from_stock_qty, to_production_qty, restock_qty)


_RESTOCK_PO_TERMINAL_NORMALIZED = frozenset({"hotovo", "cancelled"})


def _restock_po_is_open_wip(po: ProductionOrder) -> bool:
    s = normalize_production_order_status(po.status)
    return s not in _RESTOCK_PO_TERMINAL_NORMALIZED


def _existing_po_matching_candidate(
    rows: list[ProductionOrder], logistic_mode: str
) -> ProductionOrder | None:
    want = (logistic_mode or "").strip()
    for p in rows:
        if (p.logistic_mode or "").strip() == want:
            return p
    return rows[0] if rows else None


def _primary_open_restock_po_for_job_item_gpn(
    db: Session, item: JobItem, has_portfolio: bool
) -> ProductionOrder | None:
    """První otevřený restock VP pro skladovou variantu GPN (stejná kotva jako náhled WIP)."""
    if not has_portfolio:
        return None
    gpn_norm = (item.gpn or "").strip()
    if not gpn_norm:
        return None
    try:
        skld = _resolve_portfolio_variant_by_gpn_and_logistics(
            db, gpn=gpn_norm, logistic_mode="sklad"
        )
        wip_all = _open_restock_production_for_skld_portfolio(db, int(skld.id))
        wip = [p for p in wip_all if _restock_po_is_open_wip(p)]
        return wip[0] if wip else None
    except HTTPException:
        return None


def _open_restock_production_for_skld_portfolio(db: Session, skld_portfolio_item_id: int) -> list[ProductionOrder]:
    return list(
        db.scalars(
            select(ProductionOrder)
            .where(
                ProductionOrder.source_type == "restock_allocation",
                ProductionOrder.portfolio_item_id == int(skld_portfolio_item_id),
                workflow_active_sql(ProductionOrder.workflow_status),
            )
            .order_by(ProductionOrder.id.asc())
        ).all()
    )


def _open_restock_wip_quantity_for_job_item(db: Session, item: JobItem, has_portfolio: bool) -> int:
    """Součet množství otevřených VP restock_allocation pro skladovou variantu GPN (stejná logika jako náhled)."""
    if not has_portfolio:
        return 0
    try:
        skld = _resolve_portfolio_variant_by_gpn_and_logistics(db, gpn=item.gpn, logistic_mode="sklad")
        wip_all = _open_restock_production_for_skld_portfolio(db, int(skld.id))
        wip = [p for p in wip_all if _restock_po_is_open_wip(p)]
        return int(sum(int(p.quantity or 0) for p in wip))
    except HTTPException:
        return 0


def _job_line_needs_restock_wip_modal(
    to_production_qty: float,
    wip_open_qty: int,
) -> bool:
    """
    Modal „sklad vs. zakázka“ jen když lze rozpracované doplnění skladu (WIP) reálně použít
    jako náhradu za chybějící hotové kusy pro zákazníka (požadavek nad stav skladu).

    Minimální zásoba sama o sobě výdej ze skladu neblokuje — rozhodnutí o interním doplnění
    se dopočítá z cílového minima a budoucího stavu po dokončení WIP.
    """
    return wip_open_qty > 0 and to_production_qty > 0


def _portfolio_logistic_mode_for_job_item(
    db: Session,
    portfolio_item_id: int | None,
) -> str | None:
    """logistic_mode z navázané portfolio položky řádku zakázky (rozhoduje o restock konfliktu)."""
    if portfolio_item_id is None:
        return None
    p = db.get(PortfolioItem, int(portfolio_item_id))
    if p is None:
        return None
    lm = (p.logistic_mode or "").strip()
    return lm if lm else None


def _allocation_triple_for_line_logistic_mode(
    db: Session,
    it: JobItem,
    portfolio_item_id: int | None,
    *,
    line_lm: str | None,
) -> tuple[float, float, float]:
    """
    (from_stock_qty, to_production_qty, restock_qty) dle varianty portfolia:
    vyroba_zakaznik = celý řádek do přímé výroby; sklad = jen interní doplnění (množství řádku);
    sklad_zakaznik / None = klasický rozklad sklad + výroba + doplnění minima.
    """
    base = _job_item_allocation_values(db, it, portfolio_item_id)
    if line_lm == "vyroba_zakaznik":
        return (0.0, float(int(it.qty or 0)), 0.0)
    if line_lm == "sklad":
        return (0.0, 0.0, float(int(it.qty or 0)))
    return base


def _zero_stock_allocation_pos_on_job_item(db: Session, it: JobItem) -> None:
    for zpo in _production_orders_for_job_item_and_source(
        db, job_item_id=int(it.id), source_type="stock_allocation"
    ):
        if int(zpo.quantity or 0) != 0:
            zpo.quantity = 0
            db.flush()
            rebuild_tp_material_reservations_for_production_order(db, zpo)
        _ensure_job_item_coverage(
            db,
            job_item_id=it.id,
            coverage_type="stock",
            qty=0,
            consuming_production_order_id=int(zpo.id),
            source_production_order_id=None,
            source_stock_receipt_id=None,
            note=None,
        )


def _zero_vyroba_order_allocation_pos_on_job_item(db: Session, it: JobItem) -> None:
    for zpo in _production_orders_for_job_item_and_source(
        db, job_item_id=int(it.id), source_type="order_allocation"
    ):
        if str(zpo.logistic_mode or "").strip() != "vyroba_zakaznik":
            continue
        if int(zpo.quantity or 0) != 0:
            zpo.quantity = 0
            db.flush()
            rebuild_tp_material_reservations_for_production_order(db, zpo)
        _ensure_job_item_coverage(
            db,
            job_item_id=it.id,
            coverage_type="new_production",
            qty=0,
            consuming_production_order_id=int(zpo.id),
            source_production_order_id=None,
            source_stock_receipt_id=None,
            note=None,
        )


def _zero_sklad_zakaznik_order_allocation_pos_on_job_item(db: Session, it: JobItem) -> None:
    for zpo in _production_orders_for_job_item_and_source(
        db, job_item_id=int(it.id), source_type="order_allocation"
    ):
        if str(zpo.logistic_mode or "").strip() != "sklad_zakaznik":
            continue
        if int(zpo.quantity or 0) != 0:
            zpo.quantity = 0
            db.flush()
            rebuild_tp_material_reservations_for_production_order(db, zpo)
        _ensure_job_item_coverage(
            db,
            job_item_id=it.id,
            coverage_type="new_production",
            qty=0,
            consuming_production_order_id=int(zpo.id),
            source_production_order_id=None,
            source_stock_receipt_id=None,
            note=None,
        )


def _sklad_portfolio_id_for_job_item_gpn(db: Session, item: JobItem) -> int | None:
    """ID skladové portfolio varianty pro GPN řádku (stejná kotva jako WIP restock)."""
    if not (item.gpn or "").strip():
        return None
    try:
        skld = _resolve_portfolio_variant_by_gpn_and_logistics(db, gpn=item.gpn, logistic_mode="sklad")
        return int(skld.id)
    except HTTPException:
        return None


def _assert_no_multi_line_shared_restock_wip_conflict_in_request(db: Session, preview: dict) -> None:
    """
    Více aktivních řádků se stejným GPN / sdíleným skladovým portfoliem, které v jednom požadavku
    vyžadují rozhodnutí o konfliktu WIP, nejsou bezpečně zpracovatelné (Phase 2 neřeší sekvenční rezervaci).
    """
    by_skld: dict[int, list[int]] = defaultdict(list)
    for ln in preview.get("lines", []) or []:
        if not ln.get("needs_user_choice"):
            continue
        jid = int(ln["job_item_id"])
        it = db.get(JobItem, jid)
        if it is None or not workflow_record_active(it):
            continue
        skld_id = _sklad_portfolio_id_for_job_item_gpn(db, it)
        if skld_id is None:
            continue
        by_skld[skld_id].append(jid)
    for _skld_id, jids in by_skld.items():
        if len(set(jids)) > 1:
            raise HTTPException(
                status_code=409,
                detail=(
                    "V jednom požadavku nelze současně vytvářet VP pro více aktivních řádků se stejným GPN, "
                    "když každý z nich potřebuje rozhodnout o konfliktu s běžícím doplněním skladu (WIP). "
                    "Nejdříve dokončete vytvoření VP pro jeden řádek, potom pro druhý, nebo slučte řádky zakázky."
                ),
            )


def _allocation_preview_for_customer_order(db: Session, customer_order_id: int) -> dict:
    """Náhled alokace + otevřené VP doplnění skladu (stejné GPN / sklad varianta)."""
    co = db.get(CustomerOrder, customer_order_id)
    if co is None:
        raise HTTPException(status_code=404, detail="Objednávka nebyla nalezena.")
    ot = str(getattr(co, "order_type", None) or "customer").strip().lower()
    if ot != "customer":
        return {
            "customer_order_id": int(customer_order_id),
            "lines": [],
            "any_needs_user_choice": False,
        }

    job = db.scalars(
        select(Job).where(Job.customer_order_id == customer_order_id).order_by(Job.id.asc())
    ).first()
    if job is None:
        return {
            "customer_order_id": int(customer_order_id),
            "lines": [],
            "any_needs_user_choice": False,
        }

    items = db.scalars(select(JobItem).where(JobItem.job_id == job.id).order_by(JobItem.line_no.asc())).all()
    cols = {r[1] for r in db.execute(text("PRAGMA table_info(job_items)")).fetchall()}
    has_portfolio = "portfolio_item_id" in cols
    has_desc = "description" in cols

    lines: list[dict] = []
    for it in items:
        if not workflow_record_active(it):
            continue
        row = None
        if has_portfolio or has_desc:
            sel = "portfolio_item_id, description" if (has_portfolio and has_desc) else (
                "portfolio_item_id" if has_portfolio else "description"
            )
            row = db.execute(text(f"SELECT {sel} FROM job_items WHERE id = :id"), {"id": it.id}).fetchone()
        portfolio_item_id = None
        if row is not None:
            if has_portfolio and has_desc:
                portfolio_item_id = row[0]
            elif has_portfolio:
                portfolio_item_id = row[0]

        line_logistic = _portfolio_logistic_mode_for_job_item(db, portfolio_item_id)
        pl_sz: SkladZakaznikFulfillmentPlan | None = None
        if line_logistic == "sklad_zakaznik" and portfolio_item_id is not None and has_portfolio:
            pl_sz = build_sklad_zakaznik_fulfillment_plan(
                db, it, int(portfolio_item_id), has_portfolio, None
            )
            from_stock_qty = float(pl_sz.qty_from_finished_stock)
            to_production_qty = float(max(0, pl_sz.demand - pl_sz.qty_from_finished_stock))
            restock_qty = float(pl_sz.min_stock_replenishment_gap)
            internal_repl = float(pl_sz.unified_internal_replenishment_qty)
        else:
            from_stock_qty, to_production_qty, restock_qty = _allocation_triple_for_line_logistic_mode(
                db, it, portfolio_item_id, line_lm=line_logistic
            )
            internal_repl = float(restock_qty)

        restock_wip = {"quantity_open": 0, "production_order_ids": [], "vp_codes": []}
        needs_user_choice = False

        gpn_norm = (it.gpn or "").strip()
        if gpn_norm:
            try:
                skld = _resolve_portfolio_variant_by_gpn_and_logistics(
                    db,
                    gpn=gpn_norm,
                    logistic_mode="sklad",
                )
                skld_id = int(skld.id)
                wip_all = _open_restock_production_for_skld_portfolio(db, skld_id)
                wip = [p for p in wip_all if _restock_po_is_open_wip(p)]
                qo = int(sum(int(p.quantity or 0) for p in wip))
                restock_wip = {
                    "quantity_open": qo,
                    "production_order_ids": [int(p.id) for p in wip],
                    "vp_codes": [p.vp_code for p in wip if p.vp_code],
                }
                if pl_sz is not None:
                    needs_user_choice = bool(pl_sz.needs_wip_resolution)
                elif line_logistic == "sklad_zakaznik":
                    needs_user_choice = _job_line_needs_restock_wip_modal(to_production_qty, qo)
            except HTTPException:
                pass

        restock_resolution_options: list[dict] = []
        recommended_fulfillment_strategy: str | None = None
        if needs_user_choice and pl_sz is not None and portfolio_item_id is not None:
            opts, rec = list_sklad_zakaznik_resolution_options(
                customer_required_qty=int(it.qty or 0),
                finished_stock_qty=float(pl_sz.finished_stock_qty),
                wip_restock_qty=int(pl_sz.wip_open_qty),
                minimum_stock_target_qty=float(pl_sz.minimum_stock_target_qty),
            )
            restock_resolution_options = [{**o, "is_recommended": o.get("strategy") == rec} for o in opts]
            recommended_fulfillment_strategy = rec

        reserve_wip_plan: dict | None = None
        if needs_user_choice and has_portfolio:
            if pl_sz is not None and portfolio_item_id is not None:
                pl_cust = build_sklad_zakaznik_fulfillment_plan(
                    db, it, int(portfolio_item_id), has_portfolio, "stock_and_wip"
                )
                reserve_wip_plan = {
                    "reserved_qty": int(pl_cust.qty_reserved_wip),
                    "customer_sklad_zakaznik_qty": int(pl_cust.qty_reserved_wip),
                    "replenishment_internal_qty": int(pl_cust.unified_internal_replenishment_qty),
                    "customer_vyroba_extra_qty": int(pl_cust.qty_vyroba_remainder),
                    "stock_restock_vp_unchanged": True,
                }
            else:
                wip_q = int(restock_wip.get("quantity_open") or 0)
                tp_r = int(round(float(to_production_qty)))
                rq_res = min(wip_q, max(0, tp_r))
                rem = max(0, tp_r - rq_res)
                reserve_wip_plan = {
                    "reserved_qty": int(rq_res),
                    "customer_sklad_zakaznik_qty": int(rq_res),
                    "replenishment_internal_qty": int(rq_res),
                    "customer_vyroba_extra_qty": int(rem),
                    "stock_restock_vp_unchanged": True,
                }

        line_payload: dict = {
            "job_item_id": int(it.id),
            "gpn": (it.gpn or "").strip(),
            "from_stock_qty": float(from_stock_qty),
            "to_production_qty": float(to_production_qty),
            "restock_qty": float(restock_qty),
            "internal_replenishment_qty": float(internal_repl),
            "required_qty": float(it.qty or 0.0),
            "restock_wip": restock_wip,
            "needs_user_choice": bool(needs_user_choice),
            "reserve_wip_plan": reserve_wip_plan,
            "line_logistic_mode": line_logistic,
            "restock_resolution_options": restock_resolution_options,
            "recommended_fulfillment_strategy": recommended_fulfillment_strategy,
        }
        if pl_sz is not None:
            line_payload["finished_stock_qty"] = float(pl_sz.finished_stock_qty)
            line_payload["minimum_stock_target_qty"] = float(pl_sz.minimum_stock_target_qty)
            line_payload["wip_restock_qty"] = float(pl_sz.wip_open_qty)
            line_payload["stock_after_customer_issue_qty"] = float(pl_sz.stock_after_customer_issue_qty)
            line_payload["future_stock_after_wip_qty"] = float(pl_sz.future_stock_after_wip_qty)
            line_payload["wip_covers_minimum_after_customer_issue"] = bool(
                pl_sz.wip_covers_minimum_after_customer_issue
            )
        lines.append(line_payload)

    return {
        "customer_order_id": int(customer_order_id),
        "lines": lines,
        "any_needs_user_choice": any(bool(ln.get("needs_user_choice")) for ln in lines),
    }


def _insert_fulfillment_decision_preview_audits_if_requested(
    db: Session,
    *,
    customer_order_id: int,
    preview: dict,
    actor: str | None,
) -> None:
    """Volitelný zápis náhledu rozhodnutí (bez vazeb na VP — ty vznikají až při commit)."""
    for ln in preview.get("lines", []) or []:
        if ln.get("line_logistic_mode") != "sklad_zakaznik":
            continue
        if ln.get("finished_stock_qty") is None:
            continue
        jid = int(ln["job_item_id"])
        req = int(ln.get("required_qty") or 0)
        fin = float(ln["finished_stock_qty"])
        wip = int(ln.get("wip_restock_qty") or ln.get("restock_wip", {}).get("quantity_open") or 0)
        min_t = float(ln.get("minimum_stock_target_qty") or 0.0)
        recommended = ln.get("recommended_fulfillment_strategy")
        if not recommended:
            _opts, recommended = list_sklad_zakaznik_resolution_options(
                customer_required_qty=req,
                finished_stock_qty=fin,
                wip_restock_qty=wip,
                minimum_stock_target_qty=min_t,
            )
        sp = compute_sklad_zakaznik_customer_split(
            customer_required_qty=req,
            finished_stock_qty=fin,
            wip_restock_qty=wip,
            minimum_stock_target_qty=min_t,
            mode=str(recommended),
        )
        it = db.get(JobItem, jid)
        raw_port = getattr(it, "portfolio_item_id", None) if it is not None else None
        portfolio_item_id_audit = int(raw_port) if raw_port is not None else None
        insert_fulfillment_decision_audit(
            db,
            decision_phase="preview",
            actor=actor,
            customer_order_id=int(customer_order_id),
            job_item_id=jid,
            gpn=(ln.get("gpn") or None),
            portfolio_item_id=portfolio_item_id_audit,
            decision_mode="sklad_zakaznik",
            recommended_strategy=str(recommended),
            chosen_strategy=None,
            requested_qty=req,
            finished_stock_qty_before=fin,
            minimum_stock_target_qty=min_t,
            wip_restock_qty_before=wip,
            stock_issue_qty=int(sp["stock_issue_qty"]),
            wip_reservation_qty=int(sp["wip_reservation_qty"]),
            new_customer_production_qty=int(sp["new_customer_production_qty"]),
            internal_restock_qty=int(sp["unified_internal_replenishment_qty"]),
            stock_after_issue_qty=float(sp["stock_after_customer_issue_qty"]),
            future_stock_after_wip_qty=float(sp["future_stock_after_wip_qty"]),
            source_restock_production_order_id=None,
            stock_allocation_production_order_id=None,
            customer_order_allocation_production_order_id=None,
            vyroba_zakaznik_production_order_id=None,
            internal_restock_production_order_id=None,
            restock_wip_reservation_id=None,
            details={
                "needs_user_choice": bool(ln.get("needs_user_choice")),
                "restock_wip_production_order_ids": (ln.get("restock_wip") or {}).get("production_order_ids"),
            },
            note="allocation_preview",
        )


RestockConflictStrategy = Literal[
    "prefer_customer",
    "prefer_stock",
    "stock_and_wip",
    "stock_and_new_production",
    "wip_only",
    "new_production_only",
    "stock_only",
]


class RestockConflictResolutionItem(BaseModel):
    job_item_id: int = Field(..., ge=1)
    strategy: RestockConflictStrategy


class CreateProductionOrdersFromAllocationBody(BaseModel):
    restock_conflict_resolutions: list[RestockConflictResolutionItem] = Field(default_factory=list)


def _ensure_internal_restock_allocation_po(
    db: Session,
    *,
    it: JobItem,
    description: str | None,
    resolved_portfolio_item_id: int,
    add_q: int,
    has_portfolio: bool,
    has_desc: bool,
    internal_co: CustomerOrder | None,
    internal_job: Job | None,
    duplicate_flow_warnings: list[dict],
    result: list[dict],
) -> tuple[CustomerOrder | None, Job | None, ProductionOrder | None]:
    if not has_portfolio or add_q <= 0:
        return internal_co, internal_job, None
    if internal_co is None or internal_job is None:
        internal_co, internal_job = _get_or_create_internal_order_and_job(db)
    ij_id = int(internal_job.id)
    internal_item = _find_internal_job_item_by_portfolio(
        db, ij_id, int(resolved_portfolio_item_id), has_portfolio
    )
    restock_existing = (
        _production_orders_for_job_item_and_source(
            db,
            job_item_id=int(internal_item.id),
            source_type="restock_allocation",
        )
        if internal_item is not None
        else []
    )
    if internal_item is not None:
        logger.info(
            "[production_flow] job_item_id=%s source_type=restock_allocation production_order_count=%s ids=%s",
            int(internal_item.id),
            len(restock_existing),
            [int(p.id) for p in restock_existing],
        )
        _log_duplicate_production_flow(
            job_item_id=int(internal_item.id),
            source_type="restock_allocation",
            rows=restock_existing,
            duplicate_flow_warnings=duplicate_flow_warnings,
        )

    if internal_item is None:
        internal_item = _create_internal_restock_job_item(
            db,
            ij_id,
            it,
            int(resolved_portfolio_item_id),
            description,
            add_q,
            has_portfolio,
            has_desc,
        )

    po = ProductionOrder(
        vp_code=next_vp_code(db),
        job_item_id=internal_item.id,
        customer_order_id=int(internal_co.id),
        job_id=ij_id,
        portfolio_item_id=resolved_portfolio_item_id,
        gpn=it.gpn,
        description=description,
        quantity=add_q,
        logistic_mode="sklad",
        source_type="restock_allocation",
        status="planned",
    )
    setattr(po, "restock_redirected_from_internal", False)
    setattr(po, "blocked_until_reserved_stock_receipt", False)
    db.add(po)
    db.flush()
    po.scan_code = production_order_scan_code_for_id(int(po.id))
    rebuild_tp_material_reservations_for_production_order(db, po)
    _ensure_production_order_operation_scans(
        db,
        production_order_id=int(po.id),
        portfolio_item_id=resolved_portfolio_item_id,
    )
    plan_info = ensure_planning_operations_for_production_order(db, po)
    _vp_planning_pipeline_snapshot(db, po, "orders_after_new_vp_internal_restock", plan_info)
    _sync_internal_restock_job_item_qty(db, internal_item.id)
    result.append(
        {
            "id": po.id,
            "vp_code": po.vp_code,
            "job_item_id": po.job_item_id,
            "source_type": po.source_type,
            "logistic_mode": po.logistic_mode,
            "quantity": int(po.quantity or 0),
            "status": po.status or "planned",
            "state": "created",
            "duplicate_flow": False,
        }
    )
    return internal_co, internal_job, po


def _ensure_customer_facing_allocation_po(
    db: Session,
    *,
    it: JobItem,
    job: Job,
    customer_order_id: int,
    description: str | None,
    c: dict,
    resolved_portfolio_item_id: int,
    duplicate_flow_warnings: list[dict],
    result: list[dict],
) -> None:
    existing_list = _production_orders_for_job_item_and_source(
        db,
        job_item_id=int(it.id),
        source_type=str(c["source_type"]),
    )
    logger.info(
        "[production_flow] job_item_id=%s source_type=%s production_order_count=%s ids=%s",
        int(it.id),
        str(c["source_type"]),
        len(existing_list),
        [int(p.id) for p in existing_list],
    )
    _log_duplicate_production_flow(
        job_item_id=int(it.id),
        source_type=str(c["source_type"]),
        rows=existing_list,
        duplicate_flow_warnings=duplicate_flow_warnings,
    )
    if existing_list:
        existing = _existing_po_matching_candidate(existing_list, str(c["logistic_mode"]))
        if existing is None:
            return
        if not getattr(existing, "scan_code", None):
            existing.scan_code = production_order_scan_code_for_id(int(existing.id))
        _ensure_production_order_operation_scans(
            db,
            production_order_id=int(existing.id),
            portfolio_item_id=resolved_portfolio_item_id,
        )
        ensure_planning_operations_for_production_order(db, existing)
        target_q = int(round(c["quantity"]))
        if int(existing.quantity or 0) != target_q:
            existing.quantity = target_q
            db.flush()
            rebuild_tp_material_reservations_for_production_order(db, existing)
        if c["source_type"] == "order_allocation":
            _ensure_job_item_coverage(
                db,
                job_item_id=it.id,
                coverage_type="new_production",
                qty=target_q,
                consuming_production_order_id=int(existing.id),
                source_production_order_id=None,
                source_stock_receipt_id=None,
                note=None,
            )
        elif c["source_type"] == "stock_allocation":
            src_po_id, src_receipt_id = _best_source_receipt_for_portfolio_item(
                db, resolved_portfolio_item_id
            )
            _ensure_job_item_coverage(
                db,
                job_item_id=it.id,
                coverage_type="stock",
                qty=target_q,
                consuming_production_order_id=int(existing.id),
                source_production_order_id=src_po_id,
                source_stock_receipt_id=src_receipt_id,
                note=None,
            )
        result.append(
            {
                "id": existing.id,
                "vp_code": existing.vp_code,
                "job_item_id": existing.job_item_id,
                "source_type": existing.source_type or c["source_type"],
                "logistic_mode": existing.logistic_mode or c["logistic_mode"],
                "quantity": int(existing.quantity or 0),
                "status": existing.status or "planned",
                "state": "existing",
                "duplicate_flow": len(existing_list) > 1,
            }
        )
        return

    race_guard = _production_orders_for_job_item_and_source(
        db,
        job_item_id=int(it.id),
        source_type=str(c["source_type"]),
    )
    if race_guard:
        logger.warning(
            "[production_flow] skipped_new_po_allocation_already_exists job_item_id=%s source_type=%s ids=%s",
            int(it.id),
            str(c["source_type"]),
            [int(p.id) for p in race_guard],
        )
        _log_duplicate_production_flow(
            job_item_id=int(it.id),
            source_type=str(c["source_type"]),
            rows=race_guard,
            duplicate_flow_warnings=duplicate_flow_warnings,
        )
        existing = _existing_po_matching_candidate(race_guard, str(c["logistic_mode"]))
        if existing is None:
            return
        if not getattr(existing, "scan_code", None):
            existing.scan_code = production_order_scan_code_for_id(int(existing.id))
        _ensure_production_order_operation_scans(
            db,
            production_order_id=int(existing.id),
            portfolio_item_id=resolved_portfolio_item_id,
        )
        ensure_planning_operations_for_production_order(db, existing)
        if c["source_type"] == "order_allocation":
            _ensure_job_item_coverage(
                db,
                job_item_id=it.id,
                coverage_type="new_production",
                qty=int(existing.quantity or c["quantity"]),
                consuming_production_order_id=int(existing.id),
                source_production_order_id=None,
                source_stock_receipt_id=None,
                note=None,
            )
        elif c["source_type"] == "stock_allocation":
            src_po_id, src_receipt_id = _best_source_receipt_for_portfolio_item(
                db, resolved_portfolio_item_id
            )
            _ensure_job_item_coverage(
                db,
                job_item_id=it.id,
                coverage_type="stock",
                qty=int(existing.quantity or c["quantity"]),
                consuming_production_order_id=int(existing.id),
                source_production_order_id=src_po_id,
                source_stock_receipt_id=src_receipt_id,
                note=None,
            )
        result.append(
            {
                "id": existing.id,
                "vp_code": existing.vp_code,
                "job_item_id": existing.job_item_id,
                "source_type": existing.source_type or c["source_type"],
                "logistic_mode": existing.logistic_mode or c["logistic_mode"],
                "quantity": int(existing.quantity or c["quantity"]),
                "status": existing.status or "planned",
                "state": "existing",
                "duplicate_flow": len(race_guard) > 1,
            }
        )
        return

    po = ProductionOrder(
        vp_code=next_vp_code(db),
        job_item_id=it.id,
        customer_order_id=customer_order_id,
        job_id=job.id,
        portfolio_item_id=resolved_portfolio_item_id,
        gpn=it.gpn,
        description=description,
        quantity=int(c["quantity"]),
        logistic_mode=c["logistic_mode"],
        source_type=c["source_type"],
        status="planned",
    )
    setattr(po, "restock_redirected_from_internal", False)
    setattr(po, "blocked_until_reserved_stock_receipt", False)
    db.add(po)
    db.flush()
    po.scan_code = production_order_scan_code_for_id(int(po.id))
    rebuild_tp_material_reservations_for_production_order(db, po)
    _ensure_production_order_operation_scans(
        db,
        production_order_id=int(po.id),
        portfolio_item_id=resolved_portfolio_item_id,
    )
    plan_info = ensure_planning_operations_for_production_order(db, po)
    _vp_planning_pipeline_snapshot(db, po, "orders_after_new_vp_allocation", plan_info)
    if c["source_type"] == "order_allocation":
        _ensure_job_item_coverage(
            db,
            job_item_id=it.id,
            coverage_type="new_production",
            qty=int(c["quantity"]),
            consuming_production_order_id=int(po.id),
            source_production_order_id=None,
            source_stock_receipt_id=None,
            note=None,
        )
    elif c["source_type"] == "stock_allocation":
        src_po_id, src_receipt_id = _best_source_receipt_for_portfolio_item(
            db, resolved_portfolio_item_id
        )
        _ensure_job_item_coverage(
            db,
            job_item_id=it.id,
            coverage_type="stock",
            qty=int(c["quantity"]),
            consuming_production_order_id=int(po.id),
            source_production_order_id=src_po_id,
            source_stock_receipt_id=src_receipt_id,
            note=None,
        )
    result.append(
        {
            "id": po.id,
            "vp_code": po.vp_code,
            "job_item_id": po.job_item_id,
            "source_type": po.source_type,
            "logistic_mode": po.logistic_mode,
            "quantity": int(po.quantity or 0),
            "status": po.status or "planned",
            "state": "created",
            "duplicate_flow": False,
        }
    )


def _apply_sklad_zakaznik_fulfillment_plan(
    db: Session,
    *,
    it: JobItem,
    job: Job,
    customer_order_id: int,
    description: str | None,
    portfolio_item_id: int,
    restock_strategy: str | None,
    has_portfolio: bool,
    has_desc: bool,
    duplicate_flow_warnings: list[dict],
    result: list[dict],
    internal_co: CustomerOrder | None,
    internal_job: Job | None,
) -> tuple[CustomerOrder | None, Job | None, dict[str, int | None]]:
    plan = build_sklad_zakaznik_fulfillment_plan(
        db, it, int(portfolio_item_id), has_portfolio, restock_strategy
    )
    primary_restock_po: ProductionOrder | None = None
    replen_po_out: ProductionOrder | None = None
    if plan.qty_reserved_wip <= 0:
        _zero_sklad_zakaznik_order_allocation_pos_on_job_item(db, it)

    if plan.qty_from_finished_stock > 0:
        resolved = _resolve_portfolio_variant_by_gpn_and_logistics(
            db, gpn=it.gpn, logistic_mode="sklad_zakaznik"
        )
        _ensure_customer_facing_allocation_po(
            db,
            it=it,
            job=job,
            customer_order_id=int(customer_order_id),
            description=description,
            c={
                "source_type": "stock_allocation",
                "logistic_mode": "sklad_zakaznik",
                "quantity": int(plan.qty_from_finished_stock),
            },
            resolved_portfolio_item_id=int(resolved.id),
            duplicate_flow_warnings=duplicate_flow_warnings,
            result=result,
        )
    else:
        _zero_stock_allocation_pos_on_job_item(db, it)

    pending_rsv_id: int | None = None
    if plan.qty_reserved_wip > 0:
        primary_restock_po = wip_primary_restock_po_for_plan(db, it, has_portfolio)
        if primary_restock_po is not None:
            resolved_sz = _resolve_portfolio_variant_by_gpn_and_logistics(
                db, gpn=it.gpn, logistic_mode="sklad_zakaznik"
            )
            resolved_sklad = _resolve_portfolio_variant_by_gpn_and_logistics(
                db, gpn=it.gpn, logistic_mode="sklad"
            )
            pending_rsv_id = _execute_reserve_wip_for_customer_bundle(
                db,
                source_restock_po=primary_restock_po,
                reserve_qty=int(plan.qty_reserved_wip),
                customer_it=it,
                customer_order_id=int(customer_order_id),
                customer_job=job,
                description=description,
                portfolio_sklad_zakaznik=resolved_sz,
                portfolio_sklad_restock=resolved_sklad,
                has_portfolio=has_portfolio,
                has_desc=has_desc,
                duplicate_flow_warnings=duplicate_flow_warnings,
                result=result,
                defer_replenishment_po=True,
            )

    if plan.qty_vyroba_remainder <= 0:
        order_zm = _production_orders_for_job_item_and_source(
            db,
            job_item_id=int(it.id),
            source_type="order_allocation",
        )
        for zpo in order_zm:
            if str(zpo.logistic_mode or "").strip() != "vyroba_zakaznik":
                continue
            if int(zpo.quantity or 0) != 0:
                zpo.quantity = 0
                db.flush()
                rebuild_tp_material_reservations_for_production_order(db, zpo)
            _ensure_job_item_coverage(
                db,
                job_item_id=it.id,
                coverage_type="new_production",
                qty=0,
                consuming_production_order_id=int(zpo.id),
                source_production_order_id=None,
                source_stock_receipt_id=None,
                note=None,
            )
    elif plan.qty_vyroba_remainder > 0:
        resolved_vy = _resolve_portfolio_variant_by_gpn_and_logistics(
            db, gpn=it.gpn, logistic_mode="vyroba_zakaznik"
        )
        _ensure_customer_facing_allocation_po(
            db,
            it=it,
            job=job,
            customer_order_id=int(customer_order_id),
            description=description,
            c={
                "source_type": "order_allocation",
                "logistic_mode": "vyroba_zakaznik",
                "quantity": int(plan.qty_vyroba_remainder),
            },
            resolved_portfolio_item_id=int(resolved_vy.id),
            duplicate_flow_warnings=duplicate_flow_warnings,
            result=result,
        )

    if plan.unified_internal_replenishment_qty > 0:
        resolved_re = _resolve_portfolio_variant_by_gpn_and_logistics(db, gpn=it.gpn, logistic_mode="sklad")
        internal_co, internal_job, replen_po_out = _ensure_internal_restock_allocation_po(
            db,
            it=it,
            description=description,
            resolved_portfolio_item_id=int(resolved_re.id),
            add_q=int(plan.unified_internal_replenishment_qty),
            has_portfolio=has_portfolio,
            has_desc=has_desc,
            internal_co=internal_co,
            internal_job=internal_job,
            duplicate_flow_warnings=duplicate_flow_warnings,
            result=result,
        )
    if pending_rsv_id is not None and replen_po_out is not None:
        rsv_row = db.get(RestockWipReservation, int(pending_rsv_id))
        if rsv_row is not None:
            rsv_row.replenishment_production_order_id = int(replen_po_out.id)
            db.flush()

    db.flush()

    def _latest_line_po_id(source_type: str, logistic_mode: str) -> int | None:
        p = db.scalar(
            select(ProductionOrder)
            .where(
                ProductionOrder.job_item_id == int(it.id),
                ProductionOrder.source_type == str(source_type),
                ProductionOrder.logistic_mode == str(logistic_mode),
                workflow_active_sql(ProductionOrder.workflow_status),
            )
            .order_by(ProductionOrder.id.desc())
        )
        return int(p.id) if p is not None else None

    snap: dict[str, int | None] = {
        "source_restock_production_order_id": int(primary_restock_po.id)
        if primary_restock_po is not None
        else None,
        "stock_allocation_production_order_id": _latest_line_po_id("stock_allocation", "sklad_zakaznik"),
        "customer_order_allocation_production_order_id": _latest_line_po_id("order_allocation", "sklad_zakaznik"),
        "vyroba_zakaznik_production_order_id": _latest_line_po_id("order_allocation", "vyroba_zakaznik"),
        "internal_restock_production_order_id": int(replen_po_out.id) if replen_po_out is not None else None,
        "restock_wip_reservation_id": int(pending_rsv_id) if pending_rsv_id is not None else None,
    }
    return internal_co, internal_job, snap


def _get_active_internal_job(db: Session) -> Job | None:
    for co in db.scalars(
        select(CustomerOrder).where(getattr(CustomerOrder, "order_type") == "internal").order_by(CustomerOrder.id.asc())
    ).all():
        if not workflow_record_active(co):
            continue
        job = db.scalars(select(Job).where(Job.customer_order_id == co.id).order_by(Job.id.asc())).first()
        if job is not None:
            return job
    return None


def _sync_linked_production_order_quantities_for_customer_job_item(db: Session, it: JobItem) -> None:
    """Nastaví množství existujících VP podle aktuální alokace řádku (bez přičítání)."""
    job = db.get(Job, int(it.job_id)) if it.job_id is not None else None
    if job is None or job.customer_order_id is None:
        return
    co = db.get(CustomerOrder, int(job.customer_order_id))
    if co is None:
        return
    if str(getattr(co, "order_type", "customer") or "customer").strip().lower() != "customer":
        return
    if not workflow_record_active(it):
        return

    cols = {r[1] for r in db.execute(text("PRAGMA table_info(job_items)")).fetchall()}
    has_portfolio = "portfolio_item_id" in cols
    has_desc = "description" in cols
    row = None
    if has_portfolio or has_desc:
        sel = "portfolio_item_id, description" if (has_portfolio and has_desc) else (
            "portfolio_item_id" if has_portfolio else "description"
        )
        row = db.execute(text(f"SELECT {sel} FROM job_items WHERE id = :id"), {"id": it.id}).fetchone()
    portfolio_item_id = None
    description = None
    if row is not None:
        if has_portfolio and has_desc:
            portfolio_item_id = row[0]
            description = row[1]
        elif has_portfolio:
            portfolio_item_id = row[0]
        else:
            description = row[0]

    line_lm_sync = _portfolio_logistic_mode_for_job_item(db, portfolio_item_id)
    if line_lm_sync == "sklad_zakaznik" and portfolio_item_id is not None and has_portfolio:
        rsum_pending = int(
            sum(
                int(r.reserved_qty or 0)
                for r in db.scalars(
                    select(RestockWipReservation).where(
                        RestockWipReservation.target_job_item_id == int(it.id),
                        RestockWipReservation.status == "pending",
                    )
                ).all()
            )
        )
        pl_sy = build_sklad_zakaznik_fulfillment_plan(
            db, it, int(portfolio_item_id), has_portfolio, None
        )
        t_stock = int(pl_sy.qty_from_finished_stock)
        t_order = int(max(0, pl_sy.demand - pl_sy.qty_from_finished_stock))
        t_restock = int(pl_sy.unified_internal_replenishment_qty + rsum_pending)
    else:
        from_stock_qty, to_production_qty, restock_qty = _allocation_triple_for_line_logistic_mode(
            db, it, portfolio_item_id, line_lm=line_lm_sync
        )
        t_stock = int(round(from_stock_qty))
        t_order = int(round(to_production_qty))
        if has_portfolio:
            t_restock = int(round(restock_qty))
        else:
            t_restock = 0

    stock_list = _production_orders_for_job_item_and_source(
        db,
        job_item_id=int(it.id),
        source_type="stock_allocation",
    )
    if stock_list:
        po = stock_list[0]
        if int(po.quantity or 0) != t_stock:
            po.quantity = t_stock
            db.flush()
            rebuild_tp_material_reservations_for_production_order(db, po)
        resolved = _resolve_portfolio_variant_by_gpn_and_logistics(db, gpn=it.gpn, logistic_mode="sklad_zakaznik")
        rid = int(resolved.id)
        if t_stock > 0:
            src_po_id, src_receipt_id = _best_source_receipt_for_portfolio_item(db, rid)
            _ensure_job_item_coverage(
                db,
                job_item_id=it.id,
                coverage_type="stock",
                qty=t_stock,
                consuming_production_order_id=int(po.id),
                source_production_order_id=src_po_id,
                source_stock_receipt_id=src_receipt_id,
                note=None,
            )
        else:
            _ensure_job_item_coverage(
                db,
                job_item_id=it.id,
                coverage_type="stock",
                qty=0,
                consuming_production_order_id=int(po.id),
                source_production_order_id=None,
                source_stock_receipt_id=None,
                note=None,
            )

    order_list = _production_orders_for_job_item_and_source(
        db,
        job_item_id=int(it.id),
        source_type="order_allocation",
    )
    if order_list:
        if len(order_list) <= 1:
            po = order_list[0]
            if int(po.quantity or 0) != t_order:
                po.quantity = t_order
                db.flush()
                rebuild_tp_material_reservations_for_production_order(db, po)
            _ensure_job_item_coverage(
                db,
                job_item_id=it.id,
                coverage_type="new_production",
                qty=t_order,
                consuming_production_order_id=int(po.id),
                source_production_order_id=None,
                source_stock_receipt_id=None,
                note=None,
            )
        else:
            pending_rsv = db.scalars(
                select(RestockWipReservation).where(
                    RestockWipReservation.target_job_item_id == int(it.id),
                    RestockWipReservation.status == "pending",
                )
            ).all()
            rsum = int(sum(int(r.reserved_qty or 0) for r in pending_rsv))
            sz_target = min(int(t_order), max(0, rsum))
            vy_target = max(0, int(t_order) - sz_target)
            sz_rows = [p for p in order_list if str(p.logistic_mode or "").strip() == "sklad_zakaznik"]
            vz_rows = [p for p in order_list if str(p.logistic_mode or "").strip() == "vyroba_zakaznik"]
            for po in sz_rows[:1]:
                tgt = sz_target
                if int(po.quantity or 0) != tgt:
                    po.quantity = tgt
                    db.flush()
                    rebuild_tp_material_reservations_for_production_order(db, po)
                _ensure_job_item_coverage(
                    db,
                    job_item_id=it.id,
                    coverage_type="new_production",
                    qty=int(tgt),
                    consuming_production_order_id=int(po.id),
                    source_production_order_id=None,
                    source_stock_receipt_id=None,
                    note=None,
                )
            for po in vz_rows[:1]:
                tgt = vy_target
                if int(po.quantity or 0) != tgt:
                    po.quantity = tgt
                    db.flush()
                    rebuild_tp_material_reservations_for_production_order(db, po)
                _ensure_job_item_coverage(
                    db,
                    job_item_id=it.id,
                    coverage_type="new_production",
                    qty=int(tgt),
                    consuming_production_order_id=int(po.id),
                    source_production_order_id=None,
                    source_stock_receipt_id=None,
                    note=None,
                )

    internal_job = _get_active_internal_job(db)
    if line_lm_sync != "vyroba_zakaznik" and has_portfolio and internal_job is not None:
        resolved_re = _resolve_portfolio_variant_by_gpn_and_logistics(db, gpn=it.gpn, logistic_mode="sklad")
        rid = int(resolved_re.id)
        internal_item = _find_internal_job_item_by_portfolio(db, int(internal_job.id), rid, has_portfolio)
        if internal_item is not None:
            restock_list = _production_orders_for_job_item_and_source(
                db,
                job_item_id=int(internal_item.id),
                source_type="restock_allocation",
            )
            if restock_list:
                rpo = restock_list[0]
                if int(rpo.quantity or 0) != t_restock:
                    rpo.quantity = t_restock
                    db.flush()
                    rebuild_tp_material_reservations_for_production_order(db, rpo)
                _sync_internal_restock_job_item_qty(db, int(internal_item.id))


def _resolve_portfolio_variant_by_gpn_and_logistics(
    db: Session,
    *,
    gpn: str,
    logistic_mode: str,
) -> PortfolioItem:
    """Vybere portfolio variantu deterministicky: aktivní + current, jinak nejnižší id."""
    gpn_norm = (gpn or "").strip()
    if not gpn_norm:
        raise HTTPException(
            status_code=422,
            detail=f"Nelze určit portfolio variantu: chybí GPN pro logistický režim '{logistic_mode}'.",
        )
    rows = db.scalars(
        select(PortfolioItem).where(
            func.lower(func.trim(PortfolioItem.gpn)) == gpn_norm.lower(),
            PortfolioItem.logistic_mode == logistic_mode,
        )
    ).all()
    if not rows:
        raise HTTPException(
            status_code=422,
            detail=(
                f"Pro GPN '{gpn_norm}' neexistuje portfolio varianta s logistic_mode "
                f"'{logistic_mode}'. Nejprve ji založte v portfoliu."
            ),
        )
    ranked = sorted(
        rows,
        key=lambda p: (
            0 if bool(getattr(p, "is_active", False)) else 1,
            0 if getattr(p, "active_template_id", None) is not None else 1,
            int(p.id),
        ),
    )
    return ranked[0]


def _best_source_receipt_for_portfolio_item(db: Session, portfolio_item_id: int | None) -> tuple[int | None, int | None]:
    """Vrací nejlepší dohledatelný zdroj ze skladu: (production_order_id, stock_receipt_id)."""
    if portfolio_item_id is None:
        return (None, None)
    row = db.execute(
        text(
            "SELECT r.id, r.production_order_id "
            "FROM product_stock_receipts r "
            "JOIN product_stock_items s ON s.id = r.product_stock_item_id "
            "WHERE s.portfolio_item_id = :pid "
            "ORDER BY r.received_at DESC, r.id DESC "
            "LIMIT 1"
        ),
        {"pid": int(portfolio_item_id)},
    ).fetchone()
    if not row:
        return (None, None)
    return (
        (int(row[1]) if row[1] is not None else None),
        int(row[0]),
    )


def _ensure_job_item_coverage(
    db: Session,
    *,
    job_item_id: int,
    coverage_type: str,
    qty: int,
    consuming_production_order_id: int,
    source_production_order_id: int | None,
    source_stock_receipt_id: int | None,
    note: str | None = None,
) -> None:
    """Deterministicky drží max 1 coverage řádek pro (job_item, typ, consuming VP)."""
    row = db.scalar(
        select(JobItemCoverage).where(
            JobItemCoverage.job_item_id == int(job_item_id),
            JobItemCoverage.coverage_type == coverage_type,
            JobItemCoverage.consuming_production_order_id == int(consuming_production_order_id),
        )
    )
    if row is None:
        db.add(
            JobItemCoverage(
                job_item_id=int(job_item_id),
                coverage_type=coverage_type,
                qty=int(qty),
                source_production_order_id=source_production_order_id,
                source_stock_receipt_id=source_stock_receipt_id,
                consuming_production_order_id=int(consuming_production_order_id),
                note=note,
            )
        )
        db.flush()
        return
    row.qty = int(qty)
    row.source_production_order_id = source_production_order_id
    row.source_stock_receipt_id = source_stock_receipt_id
    row.note = note


def _execute_reserve_wip_for_customer_bundle(
    db: Session,
    *,
    source_restock_po: ProductionOrder,
    reserve_qty: int,
    customer_it: JobItem,
    customer_order_id: int,
    customer_job: Job,
    description: str | None,
    portfolio_sklad_zakaznik: PortfolioItem,
    portfolio_sklad_restock: PortfolioItem,
    has_portfolio: bool,
    has_desc: bool,
    duplicate_flow_warnings: list[dict],
    result: list[dict],
    defer_replenishment_po: bool = False,
) -> int | None:
    """
    Rezervace výstupu z běžícího skladového restock VP pro zákazníka bez změny zdrojového VP.
    Vytvoří: záznam rezervace, zákaznický VP sklad_zakaznik (čeká na příjem), nové interní CO+job+řádek
    a na něm náhradní restock VP (nelze sdílet job_item se zdrojovým restock VP — unikátní index).

    defer_replenishment_po=True: nevytváří interní náhradní restock VP; rezervace má replenishment_production_order_id
    NULL do doplnění jednotného interního doplnění (sklad_zakaznik fulfillment).
    Vrací id RestockWipReservation při defer, jinak None.
    """
    rq = int(reserve_qty)
    if rq <= 0:
        return None
    ri_sz = int(portfolio_sklad_zakaznik.id)
    ri_sk = int(portfolio_sklad_restock.id)
    replen_po: ProductionOrder | None = None
    if not defer_replenishment_po:
        replen_co, replen_job = _create_new_internal_order_and_job(db)
        ij_id = int(replen_job.id)
        internal_item = _create_internal_restock_job_item(
            db,
            ij_id,
            customer_it,
            ri_sk,
            description,
            rq,
            has_portfolio,
            has_desc,
        )
        restock_list = _production_orders_for_job_item_and_source(
            db,
            job_item_id=int(internal_item.id),
            source_type="restock_allocation",
        )
        _log_duplicate_production_flow(
            job_item_id=int(internal_item.id),
            source_type="restock_allocation",
            rows=restock_list,
            duplicate_flow_warnings=duplicate_flow_warnings,
        )

        replen_po = ProductionOrder(
            vp_code=next_vp_code(db),
            job_item_id=internal_item.id,
            customer_order_id=int(replen_co.id),
            job_id=ij_id,
            portfolio_item_id=ri_sk,
            gpn=customer_it.gpn,
            description=description,
            quantity=rq,
            logistic_mode="sklad",
            source_type="restock_allocation",
            status="planned",
        )
        setattr(replen_po, "restock_redirected_from_internal", False)
        setattr(replen_po, "blocked_until_reserved_stock_receipt", False)
        db.add(replen_po)
        db.flush()
        replen_po.scan_code = production_order_scan_code_for_id(int(replen_po.id))
        rebuild_tp_material_reservations_for_production_order(db, replen_po)
        _ensure_production_order_operation_scans(db, production_order_id=int(replen_po.id), portfolio_item_id=ri_sk)
        plan_info_r = ensure_planning_operations_for_production_order(db, replen_po)
        _vp_planning_pipeline_snapshot(db, replen_po, "orders_reserve_wip_replenishment", plan_info_r)
        _sync_internal_restock_job_item_qty(db, internal_item.id)

    cust_po = ProductionOrder(
        vp_code=next_vp_code(db),
        job_item_id=int(customer_it.id),
        customer_order_id=int(customer_order_id),
        job_id=int(customer_job.id),
        portfolio_item_id=ri_sz,
        gpn=customer_it.gpn,
        description=description,
        quantity=rq,
        logistic_mode="sklad_zakaznik",
        source_type="order_allocation",
        status="planned",
    )
    setattr(cust_po, "restock_redirected_from_internal", False)
    setattr(cust_po, "blocked_until_reserved_stock_receipt", True)
    db.add(cust_po)
    db.flush()
    cust_po.scan_code = production_order_scan_code_for_id(int(cust_po.id))
    rebuild_tp_material_reservations_for_production_order(db, cust_po)
    _ensure_production_order_operation_scans(db, production_order_id=int(cust_po.id), portfolio_item_id=ri_sz)
    ensure_planning_operations_for_production_order(db, cust_po)
    _ensure_job_item_coverage(
        db,
        job_item_id=int(customer_it.id),
        coverage_type="new_production",
        qty=rq,
        consuming_production_order_id=int(cust_po.id),
        source_production_order_id=None,
        source_stock_receipt_id=None,
        note=None,
    )

    rsv = RestockWipReservation(
        source_production_order_id=int(source_restock_po.id),
        target_job_item_id=int(customer_it.id),
        customer_order_id=int(customer_order_id),
        reserved_qty=rq,
        status="pending",
        fulfillment_customer_production_order_id=int(cust_po.id),
        replenishment_production_order_id=(int(replen_po.id) if replen_po is not None else None),
    )
    db.add(rsv)
    db.flush()

    result.append(
        {
            "id": cust_po.id,
            "vp_code": cust_po.vp_code,
            "job_item_id": cust_po.job_item_id,
            "source_type": cust_po.source_type,
            "logistic_mode": cust_po.logistic_mode,
            "quantity": int(cust_po.quantity or 0),
            "status": cust_po.status or "planned",
            "state": "created",
            "duplicate_flow": False,
            "reserve_wip_flow": "customer_sklad_zakaznik",
        }
    )
    if replen_po is not None:
        result.append(
            {
                "id": replen_po.id,
                "vp_code": replen_po.vp_code,
                "job_item_id": replen_po.job_item_id,
                "source_type": replen_po.source_type,
                "logistic_mode": replen_po.logistic_mode,
                "quantity": int(replen_po.quantity or 0),
                "status": replen_po.status or "planned",
                "state": "created",
                "duplicate_flow": False,
                "reserve_wip_flow": "internal_replenishment",
            }
        )
    return int(rsv.id) if defer_replenishment_po else None


def _ensure_production_order_operation_scans(
    db: Session,
    *,
    production_order_id: int,
    portfolio_item_id: int | None,
) -> None:
    if portfolio_item_id is None:
        return
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
    if tpl is None:
        return
    operations = db.scalars(
        select(PortfolioTechnologyTemplateOperation)
        .where(PortfolioTechnologyTemplateOperation.template_id == int(tpl.id))
        .order_by(PortfolioTechnologyTemplateOperation.operation_no.asc(), PortfolioTechnologyTemplateOperation.id.asc())
    ).all()
    tp_op_nos = {int(op.operation_no) for op in operations}
    stale_rows = db.scalars(
        select(ProductionOrderOperation).where(
            ProductionOrderOperation.production_order_id == int(production_order_id)
        )
    ).all()
    for stale in stale_rows:
        if int(stale.operation_no) not in tp_op_nos:
            db.delete(stale)
    db.flush()
    for op in operations:
        existing = db.scalar(
            select(ProductionOrderOperation).where(
                ProductionOrderOperation.production_order_id == int(production_order_id),
                ProductionOrderOperation.operation_no == int(op.operation_no),
            )
        )
        if existing is not None:
            continue
        wname = op.workplace
        wid = op.workplace_library_item_id
        if wid is not None:
            wp_lib = db.get(WorkplaceLibraryItem, int(wid))
            if wp_lib is not None:
                wname = wp_lib.name
        row = ProductionOrderOperation(
            production_order_id=int(production_order_id),
            operation_no=int(op.operation_no),
            operation_name=op.operation_name,
            workplace_name=wname,
            workplace_library_item_id=int(wid) if wid is not None else None,
        )
        db.add(row)
        db.flush()
        row.scan_code = production_order_operation_scan_code_for_id(int(row.id))


def _select_active_template_id(db: Session, portfolio_item_id: int | None) -> int | None:
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
    return int(tpl.id) if tpl is not None else None


def _available_material_qty(db: Session, material_library_item_id: int) -> float:
    on_stock = db.scalar(
        select(func.coalesce(func.sum(MaterialStockItem.current_qty), 0.0)).where(
            MaterialStockItem.material_library_item_id == int(material_library_item_id)
        )
    )
    reserved = sum_eligible_reserved_qty_for_material(db, int(material_library_item_id))
    return max(float(on_stock or 0.0) - reserved, 0.0)


def _create_material_reservations_for_po(
    db: Session,
    *,
    po: ProductionOrder,
    portfolio_item_id: int | None,
    quantity: int,
) -> None:
    mode = str(po.logistic_mode or "").strip()
    if mode not in {"vyroba_zakaznik", "sklad", "sklad_zakaznik"}:
        return
    template_id = _select_active_template_id(db, portfolio_item_id)
    if template_id is None:
        return
    # Idempotent: supersede prior TP-auto rows (status superseded); never touch issued.
    supersede_active_tp_auto_for_po(db, po)

    rows = db.scalars(
        select(PortfolioTechnologyTemplateMaterial)
        .where(PortfolioTechnologyTemplateMaterial.template_id == int(template_id))
        .order_by(PortfolioTechnologyTemplateMaterial.id.asc())
    ).all()
    pending_by_mid: defaultdict[int, float] = defaultdict(float)
    for row in rows:
        input_type = str(row.input_type or "material").strip().lower()
        if input_type not in {"", "material"}:
            continue
        if row.material_library_item_id is None:
            continue
        material_id = int(row.material_library_item_id)
        per_piece = float(row.consumption_per_piece or 0.0)
        kerf = max(float(row.scrap_allowance or 0.0), 0.0)
        qty_f = float(quantity)
        required_qty = total_material_consumption(per_piece, kerf, quantity)
        log_material_consumption_debug(
            context="material_reservation",
            vp_code=po.vp_code,
            material_library_item_id=material_id,
            template_material_id=int(row.id),
            consumption_per_piece=per_piece,
            kerf_per_piece=kerf,
            quantity=qty_f,
            total=required_qty,
        )
        pool = max(0.0, _available_material_qty(db, material_id) - pending_by_mid[material_id])
        reserved_qty = min(required_qty, pool)
        pending_by_mid[material_id] += reserved_qty
        db.add(
            MaterialReservation(
                material_library_item_id=material_id,
                job_item_id=int(po.job_item_id),
                production_order_id=int(po.id),
                required_qty=required_qty,
                reserved_qty=reserved_qty,
                status="reserved" if reserved_qty > 0 else "planned",
                note=f"Auto from {po.vp_code}",
                is_active=True,
            )
        )
    db.flush()


@router.get("/customer-orders")
def get_customer_orders(db: Session = Depends(get_db)):
    rows = db.scalars(
        select(CustomerOrder)
        .where(getattr(CustomerOrder, "order_type") != "internal")
        .order_by(CustomerOrder.id.desc())
    ).all()
    return [
        {
            "id": row.id,
            "customer_po_no": row.customer_po_no,
            "customer_name": row.customer_name,
            "order_date": row.order_date.isoformat() if row.order_date else None,
        }
        for row in rows
    ]


@router.post("/customer-orders")
def create_customer_order(
    payload: CustomerOrderCreatePayload,
    db: Session = Depends(get_db),
    _rbac: None = Depends(require_action("orders.write")),
):
    order_type = str(payload.order_type or "customer").strip().lower()
    if order_type not in {"customer", "internal"}:
        order_type = "customer"
    customer = None
    if order_type == "customer":
        if payload.customer_id is None:
            raise HTTPException(status_code=422, detail="Vyberte zákazníka.")
        customer = db.scalar(select(Customer).where(Customer.id == payload.customer_id))
        if customer is None:
            raise HTTPException(status_code=404, detail="Zákazník nebyl nalezen.")

    po_no = payload.customer_po_no.strip()
    if order_type == "customer" and not po_no:
        raise HTTPException(status_code=422, detail="Číslo objednávky zákazníka je povinné.")
    internal_zak_code: str | None = None
    if order_type == "internal":
        internal_zak_code = next_internal_code(db)
        if not po_no:
            po_no = internal_zak_code

    co = CustomerOrder(
        customer_po_no=po_no,
        customer_name=(customer.name if customer is not None else "Interní zakázka"),
        order_date=payload.order_date,
        order_type=order_type,
    )
    # legacy model zatím nemá explicitní atributy pro nové sloupce
    setattr(co, "customer_id", payload.customer_id if order_type == "customer" else None)
    setattr(co, "requested_ship_date", payload.requested_ship_date)
    setattr(co, "note", _normalize_note(payload.note))
    db.add(co)
    db.flush()
    co.scan_code = customer_order_scan_code_for_id(int(co.id))

    job = Job(
        zak_code=(internal_zak_code if order_type == "internal" else next_zak_code(db)),
        customer_order_id=co.id,
    )
    db.add(job)
    db.commit()
    db.refresh(co)
    db.refresh(job)
    return {
        "customer_order_id": co.id,
        "job_id": job.id,
        "zakazka": job.zak_code,
    }


@router.put("/customer-orders/{customer_order_id}")
def update_customer_order(
    customer_order_id: int,
    payload: CustomerOrderUpdatePayload,
    db: Session = Depends(get_db),
    _rbac: None = Depends(require_action("orders.write")),
):
    co = db.get(CustomerOrder, customer_order_id)
    if co is None:
        raise HTTPException(status_code=404, detail="Objednávka nebyla nalezena.")
    if not workflow_record_active(co):
        raise HTTPException(status_code=409, detail="Objednávka je stornována — úpravy nejsou povoleny.")

    customer = db.scalar(select(Customer).where(Customer.id == payload.customer_id))
    if customer is None:
        raise HTTPException(status_code=404, detail="Zákazník nebyl nalezen.")

    po_no = payload.customer_po_no.strip()
    if not po_no:
        raise HTTPException(status_code=422, detail="Číslo objednávky zákazníka je povinné.")

    co.customer_po_no = po_no
    co.customer_name = customer.name
    co.order_date = payload.order_date
    setattr(co, "customer_id", payload.customer_id)
    setattr(co, "requested_ship_date", payload.requested_ship_date)
    setattr(co, "note", _normalize_note(payload.note))
    db.commit()
    db.refresh(co)
    return {"status": "ok", "customer_order_id": co.id}


@router.post("/customer-orders/{customer_order_id}/storno")
def storno_customer_order(
    customer_order_id: int,
    db: Session = Depends(get_db),
    _rbac: None = Depends(require_action("orders.storno")),
):
    """Storno celé objednávky — zachová záznamy, zruší aktivní rezervace materiálu."""
    co = db.get(CustomerOrder, customer_order_id)
    if co is None:
        raise HTTPException(status_code=404, detail="Objednávka nebyla nalezena.")
    if not workflow_record_active(co):
        raise HTTPException(status_code=409, detail="Objednávka je již stornována.")

    co.workflow_status = WORKFLOW_STATUS_CANCELLED
    jobs = db.scalars(select(Job).where(Job.customer_order_id == customer_order_id)).all()
    from app.services.material_readiness import (
        refresh_material_readiness_for_material_library_item,
        refresh_production_order_material_readiness,
    )

    material_ids: set[int] = set()
    for job in jobs:
        items = db.scalars(select(JobItem).where(JobItem.job_id == job.id)).all()
        for it in items:
            it.workflow_status = WORKFLOW_STATUS_CANCELLED
            for po in db.scalars(select(ProductionOrder).where(ProductionOrder.job_item_id == it.id)).all():
                po.workflow_status = WORKFLOW_STATUS_CANCELLED
            for mid in db.scalars(
                select(MaterialReservation.material_library_item_id).where(
                    MaterialReservation.job_item_id == int(it.id)
                ).distinct()
            ).all():
                if mid is not None:
                    material_ids.add(int(mid))
            cancel_reservations_for_job_item(db, int(it.id), reason="customer_order_storno")
            for po in db.scalars(select(ProductionOrder).where(ProductionOrder.job_item_id == it.id)).all():
                refresh_production_order_material_readiness(db, po)
    for mid in material_ids:
        refresh_material_readiness_for_material_library_item(db, mid)
    db.commit()
    return {"status": "ok", "customer_order_id": int(customer_order_id)}


@router.get("/jobs")
def get_jobs(db: Session = Depends(get_db)):
    rows = db.scalars(select(Job).order_by(Job.id.desc())).all()
    return [
        {
            "id": row.id,
            "zak_code": row.zak_code,
            "customer_order_id": row.customer_order_id,
        }
        for row in rows
    ]


@router.get("/job-items")
def get_job_items(
    workflow_filter: str = Query("active", description="active | cancelled | all"),
    db: Session = Depends(get_db),
):
    wf = (workflow_filter or "active").strip().lower()
    if wf not in ("active", "cancelled", "all"):
        wf = "active"
    rows_cols = {r[1] for r in db.execute(text("PRAGMA table_info(job_items)")).fetchall()}
    has_desc = "description" in rows_cols
    has_portfolio = "portfolio_item_id" in rows_cols
    rows = db.scalars(select(JobItem).order_by(JobItem.job_id.asc(), JobItem.line_no.asc(), JobItem.id.asc())).all()
    job_ids = {int(r.job_id) for r in rows}
    jobs_map: dict[int, Job] = {}
    if job_ids:
        for j in db.scalars(select(Job).where(Job.id.in_(job_ids))).all():
            jobs_map[int(j.id)] = j
    cos_map: dict[int, CustomerOrder] = {}
    co_ids = {int(j.customer_order_id) for j in jobs_map.values() if j.customer_order_id is not None}
    if co_ids:
        for c in db.scalars(select(CustomerOrder).where(CustomerOrder.id.in_(co_ids))).all():
            cos_map[int(c.id)] = c
    out = []
    for row in rows:
        job = jobs_map.get(int(row.job_id)) if row.job_id is not None else None
        co = cos_map.get(int(job.customer_order_id)) if job is not None and job.customer_order_id is not None else None
        ji_active = workflow_record_active(row)
        co_active = co is None or workflow_record_active(co)
        row_active = ji_active and co_active
        if wf == "active" and not row_active:
            continue
        if wf == "cancelled" and row_active:
            continue
        if co is not None:
            item_order_type = str(getattr(co, "order_type", None) or "customer")
        else:
            item_order_type = "internal"
        item = {
            "id": row.id,
            "job_id": row.job_id,
            "line_no": row.line_no,
            "gpn": row.gpn,
            "qty": row.qty,
            "due_date": row.due_date.isoformat() if row.due_date else None,
            "workflow_status": getattr(row, "workflow_status", None),
            "order_workflow_status": getattr(co, "workflow_status", None) if co is not None else None,
            "order_type": item_order_type,
            "description": None,
            "portfolio_item_id": None,
        }
        if has_desc or has_portfolio:
            raw = db.execute(
                text(
                    "SELECT "
                    + ("description, " if has_desc else "")
                    + ("portfolio_item_id " if has_portfolio else "")
                    + "FROM job_items WHERE id = :id"
                ),
                {"id": row.id},
            ).fetchone()
            if raw:
                idx = 0
                if has_desc:
                    item["description"] = raw[idx]
                    idx += 1
                if has_portfolio:
                    item["portfolio_item_id"] = raw[idx]
        ph, prg = production_labels_for_job_item(db, int(row.id), wf)
        item["production_phase_label"] = ph
        item["production_progress_label"] = prg
        out.append(item)
    draw_by_pid = drawing_number_revision_by_portfolio_id(db, (it.get("portfolio_item_id") for it in out))
    for it in out:
        pid = it.get("portfolio_item_id")
        if pid is not None:
            dr_num, dr_rev = draw_by_pid.get(int(pid), (None, None))
        else:
            dr_num, dr_rev = None, None
        it["drawing_number"] = dr_num
        it["drawing_revision"] = dr_rev
    ji_ids = [int(it["id"]) for it in out]
    ji_m = job_item_operational_metrics_map(db, ji_ids) if ji_ids else {}
    for it in out:
        it.update(ji_m.get(int(it["id"]), {}))
    return out


@router.post("/job-items")
def create_job_item(
    payload: JobItemCreatePayload,
    db: Session = Depends(get_db),
    _rbac: None = Depends(require_action("orders.write")),
):
    job = db.scalar(select(Job).where(Job.id == payload.job_id))
    if job is None:
        raise HTTPException(status_code=404, detail="Zakázka nebyla nalezena.")
    if job.customer_order_id is not None:
        head = db.get(CustomerOrder, int(job.customer_order_id))
        if head is not None and not workflow_record_active(head):
            raise HTTPException(status_code=409, detail="Objednávka je stornována — nelze přidávat položky.")

    gpn = payload.gpn.strip()
    if not gpn:
        raise HTTPException(status_code=422, detail="GPN je povinné.")

    _validate_portfolio_item_gpn(db, gpn, payload.portfolio_item_id)

    line_no = _next_line_no(db, payload.job_id)
    row = JobItem(
        job_id=payload.job_id,
        line_no=line_no,
        gpn=gpn,
        qty=int(payload.quantity),
        due_date=payload.due_date,
    )
    db.add(row)
    db.flush()
    row.scan_code = order_item_scan_code_for_id(int(row.id))

    cols = {r[1] for r in db.execute(text("PRAGMA table_info(job_items)")).fetchall()}
    if "description" in cols:
        db.execute(
            text("UPDATE job_items SET description = :description WHERE id = :id"),
            {"description": (payload.name.strip() if payload.name else None), "id": row.id},
        )
    if "portfolio_item_id" in cols:
        db.execute(
            text("UPDATE job_items SET portfolio_item_id = :pid WHERE id = :id"),
            {"pid": payload.portfolio_item_id, "id": row.id},
        )
    db.commit()
    db.refresh(row)
    return {
        "id": row.id,
        "job_id": row.job_id,
        "line_no": row.line_no,
        "gpn": row.gpn,
        "qty": row.qty,
        "due_date": row.due_date.isoformat() if row.due_date else None,
        "description": payload.name.strip() if payload.name else None,
        "portfolio_item_id": payload.portfolio_item_id,
    }


@router.put("/job-items/{item_id}")
def update_job_item(
    item_id: int,
    payload: JobItemUpdatePayload,
    db: Session = Depends(get_db),
    _rbac: None = Depends(require_action("orders.write")),
):
    row = db.get(JobItem, item_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Položka zakázky nebyla nalezena.")
    if not workflow_record_active(row):
        raise HTTPException(status_code=409, detail="Položka je stornována — úpravy nejsou povoleny.")

    gpn = payload.gpn.strip()
    if not gpn:
        raise HTTPException(status_code=422, detail="GPN je povinné.")

    _validate_portfolio_item_gpn(db, gpn, payload.portfolio_item_id)

    row.gpn = gpn
    row.qty = int(payload.quantity)
    row.due_date = payload.due_date

    cols = {r[1] for r in db.execute(text("PRAGMA table_info(job_items)")).fetchall()}
    if "description" in cols:
        db.execute(
            text("UPDATE job_items SET description = :description WHERE id = :id"),
            {"description": (payload.name.strip() if payload.name else None), "id": row.id},
        )
    if "portfolio_item_id" in cols:
        db.execute(
            text("UPDATE job_items SET portfolio_item_id = :pid WHERE id = :id"),
            {"pid": payload.portfolio_item_id, "id": row.id},
        )
    db.commit()
    db.refresh(row)
    _sync_linked_production_order_quantities_for_customer_job_item(db, row)
    rebuild_tp_material_reservations_for_job_item(db, item_id)
    db.commit()
    return {
        "id": row.id,
        "job_id": row.job_id,
        "line_no": row.line_no,
        "gpn": row.gpn,
        "qty": row.qty,
        "due_date": row.due_date.isoformat() if row.due_date else None,
        "description": payload.name.strip() if payload.name else None,
        "portfolio_item_id": payload.portfolio_item_id,
    }


@router.post("/job-items/{item_id}/storno")
def storno_job_item(
    item_id: int,
    db: Session = Depends(get_db),
    _rbac: None = Depends(require_action("orders.storno")),
):
    """Storno řádku zakázky — VP zůstávají v historii, materiál se uvolní."""
    row = db.get(JobItem, item_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Položka zakázky nebyla nalezena.")
    if not workflow_record_active(row):
        raise HTTPException(status_code=409, detail="Položka je již stornována.")

    row.workflow_status = WORKFLOW_STATUS_CANCELLED
    for po in db.scalars(select(ProductionOrder).where(ProductionOrder.job_item_id == item_id)).all():
        po.workflow_status = WORKFLOW_STATUS_CANCELLED
    material_ids: set[int] = {
        int(mid)
        for mid in db.scalars(
            select(MaterialReservation.material_library_item_id).where(
                MaterialReservation.job_item_id == int(item_id)
            ).distinct()
        ).all()
        if mid is not None
    }
    cancel_reservations_for_job_item(db, int(item_id), reason="job_item_storno")
    from app.services.material_readiness import (
        refresh_material_readiness_for_material_library_item,
        refresh_production_order_material_readiness,
    )

    for po in db.scalars(select(ProductionOrder).where(ProductionOrder.job_item_id == item_id)).all():
        refresh_production_order_material_readiness(db, po)
    for mid in material_ids:
        refresh_material_readiness_for_material_library_item(db, mid)
    db.commit()
    return {"status": "ok", "job_item_id": int(item_id)}


@router.get("/{customer_order_id}/allocation-preview")
def get_allocation_preview(
    customer_order_id: int,
    audit_preview: bool = Query(False),
    db: Session = Depends(get_db),
    actor: str | None = Depends(get_effective_actor),
):
    """Náhled alokace a konfliktu s běžící výrobou doplnění skladu (restock) pro stejné GPN."""
    out = _allocation_preview_for_customer_order(db, customer_order_id)
    if audit_preview:
        _insert_fulfillment_decision_preview_audits_if_requested(
            db, customer_order_id=customer_order_id, preview=out, actor=actor
        )
        db.commit()
    return out


@router.post("/{customer_order_id}/create-production-orders")
def create_production_orders_from_allocation(
    customer_order_id: int,
    payload: CreateProductionOrdersFromAllocationBody | None = Body(default=None),
    db: Session = Depends(get_db),
    actor: str | None = Depends(get_effective_actor),
    _rbac: None = Depends(require_action("orders.write")),
):
    body = payload or CreateProductionOrdersFromAllocationBody()
    co = db.get(CustomerOrder, customer_order_id)
    if co is None:
        raise HTTPException(status_code=404, detail="Objednávka nebyla nalezena.")
    if not workflow_record_active(co):
        raise HTTPException(status_code=409, detail="Objednávka je stornována — nelze tvořit výrobní příkazy.")

    ot = str(getattr(co, "order_type", None) or "customer").strip().lower()
    job = db.scalars(
        select(Job).where(Job.customer_order_id == customer_order_id).order_by(Job.id.asc())
    ).first()
    if job is None:
        return {"production_orders": []}

    items = db.scalars(select(JobItem).where(JobItem.job_id == job.id).order_by(JobItem.line_no.asc())).all()
    if not items:
        return {"production_orders": []}

    if ot == "internal":
        # Interní zakázka: vytvoř / synchronizuj pouze restock VP pro sklad (bez konfliktního modalu).
        cols = {r[1] for r in db.execute(text("PRAGMA table_info(job_items)")).fetchall()}
        has_portfolio = "portfolio_item_id" in cols
        has_desc = "description" in cols
        result: list[dict] = []
        duplicate_flow_warnings: list[dict] = []
        for it in items:
            if not workflow_record_active(it):
                continue
            row = None
            if has_portfolio or has_desc:
                sel = "portfolio_item_id, description" if (has_portfolio and has_desc) else (
                    "portfolio_item_id" if has_portfolio else "description"
                )
                row = db.execute(text(f"SELECT {sel} FROM job_items WHERE id = :id"), {"id": it.id}).fetchone()
            description = None
            if row is not None:
                if has_portfolio and has_desc:
                    description = row[1]
                elif has_desc:
                    description = row[0]

            add_q = int(it.qty or 0)
            if add_q <= 0:
                continue
            resolved_portfolio = _resolve_portfolio_variant_by_gpn_and_logistics(
                db,
                gpn=it.gpn,
                logistic_mode="sklad",
            )
            rid = int(resolved_portfolio.id)
            existing_list = _production_orders_for_job_item_and_source(
                db,
                job_item_id=int(it.id),
                source_type="restock_allocation",
            )
            _log_duplicate_production_flow(
                job_item_id=int(it.id),
                source_type="restock_allocation",
                rows=existing_list,
                duplicate_flow_warnings=duplicate_flow_warnings,
            )
            if existing_list:
                existing = existing_list[0]
                existing.customer_order_id = int(co.id)
                existing.job_id = int(job.id)
                existing.portfolio_item_id = rid
                existing.logistic_mode = "sklad"
                existing.source_type = "restock_allocation"
                if description is not None:
                    existing.description = description
                target_q = int(add_q)
                if int(existing.quantity or 0) != target_q:
                    existing.quantity = target_q
                    db.flush()
                if not getattr(existing, "scan_code", None):
                    existing.scan_code = production_order_scan_code_for_id(int(existing.id))
                _ensure_production_order_operation_scans(
                    db,
                    production_order_id=int(existing.id),
                    portfolio_item_id=rid,
                )
                ensure_planning_operations_for_production_order(db, existing)
                rebuild_tp_material_reservations_for_production_order(db, existing)
                result.append(
                    {
                        "id": existing.id,
                        "vp_code": existing.vp_code,
                        "job_item_id": existing.job_item_id,
                        "source_type": existing.source_type or "restock_allocation",
                        "logistic_mode": existing.logistic_mode or "sklad",
                        "quantity": int(existing.quantity or 0),
                        "status": existing.status or "planned",
                        "state": "existing",
                        "duplicate_flow": len(existing_list) > 1,
                    }
                )
                continue

            po = ProductionOrder(
                vp_code=next_vp_code(db),
                job_item_id=it.id,
                customer_order_id=int(co.id),
                job_id=int(job.id),
                portfolio_item_id=rid,
                gpn=it.gpn,
                description=description,
                quantity=add_q,
                logistic_mode="sklad",
                source_type="restock_allocation",
                status="planned",
            )
            setattr(po, "restock_redirected_from_internal", False)
            setattr(po, "blocked_until_reserved_stock_receipt", False)
            db.add(po)
            db.flush()
            po.scan_code = production_order_scan_code_for_id(int(po.id))
            _ensure_production_order_operation_scans(
                db,
                production_order_id=int(po.id),
                portfolio_item_id=rid,
            )
            plan_info = ensure_planning_operations_for_production_order(db, po)
            _vp_planning_pipeline_snapshot(db, po, "orders_after_new_vp_internal_order", plan_info)
            rebuild_tp_material_reservations_for_production_order(db, po)
            result.append(
                {
                    "id": po.id,
                    "vp_code": po.vp_code,
                    "job_item_id": po.job_item_id,
                    "source_type": po.source_type,
                    "logistic_mode": po.logistic_mode,
                    "quantity": int(po.quantity or 0),
                    "status": po.status or "planned",
                    "state": "created",
                    "duplicate_flow": False,
                }
            )
        db.commit()
        return {
            "production_orders": result,
            "duplicate_flow_warnings": duplicate_flow_warnings,
        }

    strategies = {
        int(r.job_item_id): normalize_restock_resolution_strategy(str(r.strategy))
        for r in body.restock_conflict_resolutions
    }

    preview = _allocation_preview_for_customer_order(db, customer_order_id)
    _assert_no_multi_line_shared_restock_wip_conflict_in_request(db, preview)

    needed = {int(ln["job_item_id"]) for ln in preview.get("lines", []) if ln.get("needs_user_choice")}
    if needed:
        res_list = list(body.restock_conflict_resolutions)
        seen_j: set[int] = set()
        for r in res_list:
            jid = int(r.job_item_id)
            if jid in seen_j:
                raise HTTPException(
                    status_code=400,
                    detail="Duplicitní job_item_id v restock_conflict_resolutions.",
                )
            seen_j.add(jid)
        provided = {int(r.job_item_id): r.strategy for r in res_list}
        missing = sorted(needed - set(provided.keys()))
        if missing:
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "restock_conflict_resolutions_required",
                    "message": "Před vytvořením VP je nutné rozhodnout o běžící výrobě na doplnění skladu.",
                    "missing_job_item_ids": missing,
                },
            )

    cols = {r[1] for r in db.execute(text("PRAGMA table_info(job_items)")).fetchall()}
    has_portfolio = "portfolio_item_id" in cols
    has_desc = "description" in cols

    result: list[dict] = []
    duplicate_flow_warnings: list[dict] = []
    internal_co: CustomerOrder | None = None
    internal_job: Job | None = None
    preview_line_by_job_item_id = {int(ln["job_item_id"]): ln for ln in preview.get("lines", []) or []}
    for it in items:
        if not workflow_record_active(it):
            continue
        current_strat = strategies.get(int(it.id))
        row = None
        if has_portfolio or has_desc:
            sel = "portfolio_item_id, description" if (has_portfolio and has_desc) else (
                "portfolio_item_id" if has_portfolio else "description"
            )
            row = db.execute(text(f"SELECT {sel} FROM job_items WHERE id = :id"), {"id": it.id}).fetchone()
        portfolio_item_id = None
        description = None
        if row is not None:
            if has_portfolio and has_desc:
                portfolio_item_id = row[0]
                description = row[1]
            elif has_portfolio:
                portfolio_item_id = row[0]
            elif has_desc:
                description = row[0]

        line_lm = _portfolio_logistic_mode_for_job_item(db, portfolio_item_id)
        from_stock_qty, to_production_qty, restock_qty = _allocation_triple_for_line_logistic_mode(
            db, it, portfolio_item_id, line_lm=line_lm
        )

        if line_lm == "sklad_zakaznik" and portfolio_item_id is not None and has_portfolio:
            chosen = normalize_restock_resolution_strategy(current_strat)
            plan_m = build_sklad_zakaznik_fulfillment_plan(
                db, it, int(portfolio_item_id), has_portfolio, chosen
            )
            split = compute_sklad_zakaznik_customer_split(
                customer_required_qty=int(it.qty or 0),
                finished_stock_qty=float(plan_m.finished_stock_qty),
                wip_restock_qty=int(plan_m.wip_open_qty),
                minimum_stock_target_qty=float(plan_m.minimum_stock_target_qty),
                mode=chosen,
            )
            internal_co, internal_job, snap = _apply_sklad_zakaznik_fulfillment_plan(
                db,
                it=it,
                job=job,
                customer_order_id=int(customer_order_id),
                description=description,
                portfolio_item_id=int(portfolio_item_id),
                restock_strategy=current_strat,
                has_portfolio=has_portfolio,
                has_desc=has_desc,
                duplicate_flow_warnings=duplicate_flow_warnings,
                result=result,
                internal_co=internal_co,
                internal_job=internal_job,
            )
            pln = preview_line_by_job_item_id.get(int(it.id))
            insert_fulfillment_decision_audit(
                db,
                decision_phase="committed",
                actor=actor,
                customer_order_id=int(customer_order_id),
                job_item_id=int(it.id),
                gpn=it.gpn,
                portfolio_item_id=int(portfolio_item_id),
                decision_mode="sklad_zakaznik",
                recommended_strategy=(pln or {}).get("recommended_fulfillment_strategy"),
                chosen_strategy=chosen,
                requested_qty=int(it.qty or 0),
                finished_stock_qty_before=float(plan_m.finished_stock_qty),
                minimum_stock_target_qty=float(plan_m.minimum_stock_target_qty),
                wip_restock_qty_before=int(plan_m.wip_open_qty),
                stock_issue_qty=int(split["stock_issue_qty"]),
                wip_reservation_qty=int(split["wip_reservation_qty"]),
                new_customer_production_qty=int(split["new_customer_production_qty"]),
                internal_restock_qty=int(split["unified_internal_replenishment_qty"]),
                stock_after_issue_qty=float(split["stock_after_customer_issue_qty"]),
                future_stock_after_wip_qty=float(split["future_stock_after_wip_qty"]),
                source_restock_production_order_id=snap.get("source_restock_production_order_id"),
                stock_allocation_production_order_id=snap.get("stock_allocation_production_order_id"),
                customer_order_allocation_production_order_id=snap.get(
                    "customer_order_allocation_production_order_id"
                ),
                vyroba_zakaznik_production_order_id=snap.get("vyroba_zakaznik_production_order_id"),
                internal_restock_production_order_id=snap.get("internal_restock_production_order_id"),
                restock_wip_reservation_id=snap.get("restock_wip_reservation_id"),
                details={"needs_user_choice": (pln or {}).get("needs_user_choice")},
                note="create_production_orders_from_allocation",
            )
            continue

        if line_lm == "vyroba_zakaznik":
            _zero_stock_allocation_pos_on_job_item(db, it)
            _zero_sklad_zakaznik_order_allocation_pos_on_job_item(db, it)
        elif line_lm == "sklad":
            _zero_stock_allocation_pos_on_job_item(db, it)
            _zero_vyroba_order_allocation_pos_on_job_item(db, it)
            _zero_sklad_zakaznik_order_allocation_pos_on_job_item(db, it)

        tpo_i = int(round(to_production_qty))
        if tpo_i <= 0:
            order_zm = _production_orders_for_job_item_and_source(
                db,
                job_item_id=int(it.id),
                source_type="order_allocation",
            )
            for zpo in order_zm:
                if str(zpo.logistic_mode or "").strip() != "vyroba_zakaznik":
                    continue
                if int(zpo.quantity or 0) != 0:
                    zpo.quantity = 0
                    db.flush()
                    rebuild_tp_material_reservations_for_production_order(db, zpo)
                _ensure_job_item_coverage(
                    db,
                    job_item_id=it.id,
                    coverage_type="new_production",
                    qty=0,
                    consuming_production_order_id=int(zpo.id),
                    source_production_order_id=None,
                    source_stock_receipt_id=None,
                    note=None,
                )

        candidates = []
        if from_stock_qty > 0:
            candidates.append(
                {
                    "source_type": "stock_allocation",
                    "logistic_mode": "sklad_zakaznik",
                    "quantity": int(round(from_stock_qty)),
                }
            )
        if to_production_qty > 0:
            candidates.append(
                {
                    "source_type": "order_allocation",
                    "logistic_mode": "vyroba_zakaznik",
                    "quantity": int(round(to_production_qty)),
                }
            )
        restock_internal_qty = float(restock_qty)
        if restock_internal_qty > 0:
            candidates.append(
                {
                    "source_type": "restock_allocation",
                    "logistic_mode": "sklad",
                    "quantity": int(round(restock_internal_qty)),
                }
            )

        for c in candidates:
            resolved_portfolio = _resolve_portfolio_variant_by_gpn_and_logistics(
                db,
                gpn=it.gpn,
                logistic_mode=str(c["logistic_mode"]),
            )
            resolved_portfolio_item_id = int(resolved_portfolio.id)
            if c["source_type"] == "restock_allocation":
                internal_co, internal_job, _ = _ensure_internal_restock_allocation_po(
                    db,
                    it=it,
                    description=description,
                    resolved_portfolio_item_id=resolved_portfolio_item_id,
                    add_q=int(c["quantity"]),
                    has_portfolio=has_portfolio,
                    has_desc=has_desc,
                    internal_co=internal_co,
                    internal_job=internal_job,
                    duplicate_flow_warnings=duplicate_flow_warnings,
                    result=result,
                )
                continue

            _ensure_customer_facing_allocation_po(
                db,
                it=it,
                job=job,
                customer_order_id=customer_order_id,
                description=description,
                c=c,
                resolved_portfolio_item_id=resolved_portfolio_item_id,
                duplicate_flow_warnings=duplicate_flow_warnings,
                result=result,
            )

    db.commit()
    for it in items:
        n = db.scalar(
            select(func.count()).select_from(ProductionOrder).where(ProductionOrder.job_item_id == int(it.id))
        )
        logger.info(
            "[production_flow] job_item_id=%s production_order_total_count=%s",
            int(it.id),
            int(n or 0),
        )
    return {
        "production_orders": result,
        "duplicate_flow_warnings": duplicate_flow_warnings,
    }


@router.get("/production-orders")
def get_production_orders(
    workflow_filter: str = Query("active", description="active | cancelled | all"),
    db: Session = Depends(get_db),
):
    wf = (workflow_filter or "active").strip().lower()
    if wf not in ("active", "cancelled", "all"):
        wf = "active"
    rows = db.scalars(select(ProductionOrder).order_by(ProductionOrder.id.asc())).all()
    out: list[dict] = []
    for row in rows:
        po_active = workflow_record_active(row)
        if wf == "active" and not po_active:
            continue
        if wf == "cancelled" and po_active:
            continue
        out.append(
            {
                "id": row.id,
                "vp_code": row.vp_code,
                "job_item_id": row.job_item_id,
                "customer_order_id": row.customer_order_id,
                "job_id": row.job_id,
                "portfolio_item_id": row.portfolio_item_id,
                "gpn": row.gpn,
                "description": row.description,
                "quantity": row.quantity,
                "logistic_mode": row.logistic_mode,
                "source_type": row.source_type,
                "status": row.status,
                "workflow_status": getattr(row, "workflow_status", None),
            }
        )
    return out
