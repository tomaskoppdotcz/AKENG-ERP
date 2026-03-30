import logging
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, inspect as sa_inspect, select, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.scan_code import (
    customer_order_scan_code_for_id,
    order_item_scan_code_for_id,
    production_order_operation_scan_code_for_id,
    production_order_scan_code_for_id,
)
from app.models.master_data import Customer
from app.models.material_stock import MaterialReservation, MaterialStockItem
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
from app.services.material_consumption import log_material_consumption_debug, total_material_consumption
from app.services.business_workflow import (
    WORKFLOW_STATUS_CANCELLED,
    workflow_active_sql,
    workflow_record_active,
)
from app.services.material_reservation_sync import (
    MATERIAL_RESERVATION_ACTIVE_STATUSES,
    cancel_reservations_for_job_item,
    rebuild_tp_material_reservations_for_job_item,
    rebuild_tp_material_reservations_for_production_order,
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
        with engine.begin() as conn:
            for stmt in po_stmts:
                conn.execute(text(stmt))
            conn.execute(text("DROP INDEX IF EXISTS uq_production_orders_item_source"))
            conn.execute(
                text(
                    "CREATE UNIQUE INDEX IF NOT EXISTS uq_production_orders_item_source_active "
                    "ON production_orders (job_item_id, source_type) "
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


class CustomerOrderCreatePayload(BaseModel):
    customer_id: int
    customer_po_no: str = Field(..., min_length=1)
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


def _next_zak_code(db: Session) -> str:
    row_id = db.scalar(select(Job.id).order_by(Job.id.desc()).limit(1)) or 0
    return f"ZAK-{int(row_id) + 1:06d}"


def _next_internal_code(db: Session) -> str:
    jobs = db.scalars(select(Job).where(Job.zak_code.like("INT-%")).order_by(Job.id.asc())).all()
    max_num = 0
    for j in jobs:
        code = (j.zak_code or "").strip()
        if not code.startswith("INT-"):
            continue
        try:
            num = int(code.split("-", 1)[1])
        except Exception:
            continue
        if num > max_num:
            max_num = num
    return f"INT-{max_num + 1:06d}"


def _next_line_no(db: Session, job_id: int) -> int:
    row = db.scalar(select(JobItem.line_no).where(JobItem.job_id == job_id).order_by(JobItem.line_no.desc()).limit(1))
    return (int(row) + 10) if row is not None else 10


def _next_vp_code(db: Session) -> str:
    row_id = db.scalar(select(ProductionOrder.id).order_by(ProductionOrder.id.desc()).limit(1)) or 0
    return f"VP-{int(row_id) + 1:06d}"


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
        if not getattr(co, "scan_code", None):
            co.scan_code = customer_order_scan_code_for_id(int(co.id))
        job = db.scalars(
            select(Job).where(Job.customer_order_id == co.id).order_by(Job.id.asc())
        ).first()
        if job is not None:
            return co, job

    internal_code = _next_internal_code(db)
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
    for op in operations:
        existing = db.scalar(
            select(ProductionOrderOperation).where(
                ProductionOrderOperation.production_order_id == int(production_order_id),
                ProductionOrderOperation.operation_no == int(op.operation_no),
            )
        )
        if existing is not None:
            continue
        row = ProductionOrderOperation(
            production_order_id=int(production_order_id),
            operation_no=int(op.operation_no),
            operation_name=op.operation_name,
            workplace_name=op.workplace,
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
    reserved = db.scalar(
        select(func.coalesce(func.sum(MaterialReservation.reserved_qty), 0.0)).where(
            MaterialReservation.material_library_item_id == int(material_library_item_id),
            MaterialReservation.status.in_(tuple(MATERIAL_RESERVATION_ACTIVE_STATUSES)),
            MaterialReservation.is_active.is_(True),
        )
    )
    return max(float(on_stock or 0.0) - float(reserved or 0.0), 0.0)


def _create_material_reservations_for_po(
    db: Session,
    *,
    po: ProductionOrder,
    portfolio_item_id: int | None,
    quantity: int,
) -> None:
    mode = str(po.logistic_mode or "").strip()
    if mode not in {"vyroba_zakaznik", "sklad"}:
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
        available = _available_material_qty(db, material_id)
        reserved_qty = min(required_qty, available)
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
def create_customer_order(payload: CustomerOrderCreatePayload, db: Session = Depends(get_db)):
    customer = db.scalar(select(Customer).where(Customer.id == payload.customer_id))
    if customer is None:
        raise HTTPException(status_code=404, detail="Zákazník nebyl nalezen.")

    po_no = payload.customer_po_no.strip()
    if not po_no:
        raise HTTPException(status_code=422, detail="Číslo objednávky zákazníka je povinné.")

    co = CustomerOrder(
        customer_po_no=po_no,
        customer_name=customer.name,
        order_date=payload.order_date,
        order_type="customer",
    )
    # legacy model zatím nemá explicitní atributy pro nové sloupce
    setattr(co, "customer_id", payload.customer_id)
    setattr(co, "requested_ship_date", payload.requested_ship_date)
    setattr(co, "note", _normalize_note(payload.note))
    db.add(co)
    db.flush()
    co.scan_code = customer_order_scan_code_for_id(int(co.id))

    job = Job(
        zak_code=_next_zak_code(db),
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
def update_customer_order(customer_order_id: int, payload: CustomerOrderUpdatePayload, db: Session = Depends(get_db)):
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
def storno_customer_order(customer_order_id: int, db: Session = Depends(get_db)):
    """Storno celé objednávky — zachová záznamy, zruší aktivní rezervace materiálu."""
    co = db.get(CustomerOrder, customer_order_id)
    if co is None:
        raise HTTPException(status_code=404, detail="Objednávka nebyla nalezena.")
    if not workflow_record_active(co):
        raise HTTPException(status_code=409, detail="Objednávka je již stornována.")

    co.workflow_status = WORKFLOW_STATUS_CANCELLED
    jobs = db.scalars(select(Job).where(Job.customer_order_id == customer_order_id)).all()
    for job in jobs:
        items = db.scalars(select(JobItem).where(JobItem.job_id == job.id)).all()
        for it in items:
            it.workflow_status = WORKFLOW_STATUS_CANCELLED
            for po in db.scalars(select(ProductionOrder).where(ProductionOrder.job_item_id == it.id)).all():
                po.workflow_status = WORKFLOW_STATUS_CANCELLED
            cancel_reservations_for_job_item(db, int(it.id), reason="customer_order_storno")
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
def get_job_items(db: Session = Depends(get_db)):
    rows_cols = {r[1] for r in db.execute(text("PRAGMA table_info(job_items)")).fetchall()}
    has_desc = "description" in rows_cols
    has_portfolio = "portfolio_item_id" in rows_cols
    rows = db.scalars(select(JobItem).order_by(JobItem.job_id.asc(), JobItem.line_no.asc(), JobItem.id.asc())).all()
    out = []
    for row in rows:
        item = {
            "id": row.id,
            "job_id": row.job_id,
            "line_no": row.line_no,
            "gpn": row.gpn,
            "qty": row.qty,
            "due_date": row.due_date.isoformat() if row.due_date else None,
            "workflow_status": getattr(row, "workflow_status", None),
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
        out.append(item)
    return out


@router.post("/job-items")
def create_job_item(payload: JobItemCreatePayload, db: Session = Depends(get_db)):
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
def update_job_item(item_id: int, payload: JobItemUpdatePayload, db: Session = Depends(get_db)):
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
def storno_job_item(item_id: int, db: Session = Depends(get_db)):
    """Storno řádku zakázky — VP zůstávají v historii, materiál se uvolní."""
    row = db.get(JobItem, item_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Položka zakázky nebyla nalezena.")
    if not workflow_record_active(row):
        raise HTTPException(status_code=409, detail="Položka je již stornována.")

    row.workflow_status = WORKFLOW_STATUS_CANCELLED
    for po in db.scalars(select(ProductionOrder).where(ProductionOrder.job_item_id == item_id)).all():
        po.workflow_status = WORKFLOW_STATUS_CANCELLED
    cancel_reservations_for_job_item(db, int(item_id), reason="job_item_storno")
    db.commit()
    return {"status": "ok", "job_item_id": int(item_id)}


@router.post("/{customer_order_id}/create-production-orders")
def create_production_orders_from_allocation(customer_order_id: int, db: Session = Depends(get_db)):
    co = db.get(CustomerOrder, customer_order_id)
    if co is None:
        raise HTTPException(status_code=404, detail="Objednávka nebyla nalezena.")
    if not workflow_record_active(co):
        raise HTTPException(status_code=409, detail="Objednávka je stornována — nelze tvořit výrobní příkazy.")

    ot = str(getattr(co, "order_type", None) or "customer").strip().lower()
    if ot == "internal":
        # Interní zakázka = jen doplnění skladu; alokace zákazníka se znovu nepočítá.
        return {"production_orders": []}

    job = db.scalars(
        select(Job).where(Job.customer_order_id == customer_order_id).order_by(Job.id.asc())
    ).first()
    if job is None:
        return {"production_orders": []}

    items = db.scalars(select(JobItem).where(JobItem.job_id == job.id).order_by(JobItem.line_no.asc())).all()
    if not items:
        return {"production_orders": []}

    cols = {r[1] for r in db.execute(text("PRAGMA table_info(job_items)")).fetchall()}
    has_portfolio = "portfolio_item_id" in cols
    has_desc = "description" in cols

    result: list[dict] = []
    duplicate_flow_warnings: list[dict] = []
    internal_co: CustomerOrder | None = None
    internal_job: Job | None = None
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
        description = None
        if row is not None:
            if has_portfolio and has_desc:
                portfolio_item_id = row[0]
                description = row[1]
            elif has_portfolio:
                portfolio_item_id = row[0]
            elif has_desc:
                description = row[0]

        from_stock_qty, to_production_qty, restock_qty = _job_item_allocation_values(db, it, portfolio_item_id)

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
        if restock_qty > 0:
            candidates.append(
                {
                    "source_type": "restock_allocation",
                    "logistic_mode": "sklad",
                    "quantity": int(round(restock_qty)),
                }
            )

        for c in candidates:
            resolved_portfolio = _resolve_portfolio_variant_by_gpn_and_logistics(
                db,
                gpn=it.gpn,
                logistic_mode=str(c["logistic_mode"]),
            )
            resolved_portfolio_item_id = int(resolved_portfolio.id)
            # restock_allocation: interní zakázka + interní job_item (řádek na portfolio_item_id),
            # unikátní VP na (interní job_item_id, restock_allocation); více zdrojů přičítá množství.
            if c["source_type"] == "restock_allocation":
                if not has_portfolio:
                    continue
                if internal_co is None or internal_job is None:
                    internal_co, internal_job = _get_or_create_internal_order_and_job(db)
                ij_id = int(internal_job.id)
                internal_item = _find_internal_job_item_by_portfolio(
                    db, ij_id, int(resolved_portfolio_item_id), has_portfolio
                )
                add_q = int(c["quantity"])
                if internal_item is not None:
                    restock_existing = _production_orders_for_job_item_and_source(
                        db,
                        job_item_id=int(internal_item.id),
                        source_type="restock_allocation",
                    )
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
                    if restock_existing:
                        existing_restock = restock_existing[0]
                        if not getattr(existing_restock, "scan_code", None):
                            existing_restock.scan_code = production_order_scan_code_for_id(int(existing_restock.id))
                        _ensure_production_order_operation_scans(
                            db,
                            production_order_id=int(existing_restock.id),
                            portfolio_item_id=resolved_portfolio_item_id,
                        )
                        existing_restock.quantity = int(existing_restock.quantity or 0) + add_q
                        db.flush()
                        rebuild_tp_material_reservations_for_production_order(db, existing_restock)
                        _sync_internal_restock_job_item_qty(db, internal_item.id)
                        result.append(
                            {
                                "id": existing_restock.id,
                                "vp_code": existing_restock.vp_code,
                                "job_item_id": existing_restock.job_item_id,
                                "source_type": existing_restock.source_type or c["source_type"],
                                "logistic_mode": existing_restock.logistic_mode or c["logistic_mode"],
                                "quantity": int(existing_restock.quantity or 0),
                                "status": existing_restock.status or "planned",
                                "state": "existing",
                                "duplicate_flow": len(restock_existing) > 1,
                            }
                        )
                        continue
                else:
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
                    vp_code=_next_vp_code(db),
                    job_item_id=internal_item.id,
                    customer_order_id=int(internal_co.id),
                    job_id=ij_id,
                    portfolio_item_id=resolved_portfolio_item_id,
                    gpn=it.gpn,
                    description=description,
                    quantity=add_q,
                    logistic_mode=c["logistic_mode"],
                    source_type=c["source_type"],
                    status="planned",
                )
                db.add(po)
                db.flush()
                po.scan_code = production_order_scan_code_for_id(int(po.id))
                rebuild_tp_material_reservations_for_production_order(db, po)
                _ensure_production_order_operation_scans(
                    db,
                    production_order_id=int(po.id),
                    portfolio_item_id=resolved_portfolio_item_id,
                )
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
                continue

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
                existing = existing_list[0]
                if not getattr(existing, "scan_code", None):
                    existing.scan_code = production_order_scan_code_for_id(int(existing.id))
                _ensure_production_order_operation_scans(
                    db,
                    production_order_id=int(existing.id),
                    portfolio_item_id=resolved_portfolio_item_id,
                )
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
                        "duplicate_flow": len(existing_list) > 1,
                    }
                )
                continue

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
                existing = race_guard[0]
                if not getattr(existing, "scan_code", None):
                    existing.scan_code = production_order_scan_code_for_id(int(existing.id))
                _ensure_production_order_operation_scans(
                    db,
                    production_order_id=int(existing.id),
                    portfolio_item_id=resolved_portfolio_item_id,
                )
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
                continue

            po = ProductionOrder(
                vp_code=_next_vp_code(db),
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
            db.add(po)
            db.flush()
            po.scan_code = production_order_scan_code_for_id(int(po.id))
            rebuild_tp_material_reservations_for_production_order(db, po)
            _ensure_production_order_operation_scans(
                db,
                production_order_id=int(po.id),
                portfolio_item_id=resolved_portfolio_item_id,
            )
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
def get_production_orders(db: Session = Depends(get_db)):
    rows = db.scalars(select(ProductionOrder).order_by(ProductionOrder.id.asc())).all()
    return [
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
        for row in rows
    ]
