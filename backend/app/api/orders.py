from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import inspect as sa_inspect, select, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.master_data import Customer
from app.models.portfolio import PortfolioItem
from app.models.orders import CustomerOrder, Job, JobItem, ProductionOrder

router = APIRouter()


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
    with engine.begin() as conn:
        for stmt in stmts:
            conn.execute(text(stmt))
        conn.execute(
            text(
                "UPDATE customer_orders SET order_type = 'customer' "
                "WHERE order_type IS NULL OR TRIM(COALESCE(order_type, '')) = ''"
            )
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
        with engine.begin() as conn:
            for stmt in item_stmts:
                conn.execute(text(stmt))
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
        with engine.begin() as conn:
            for stmt in po_stmts:
                conn.execute(text(stmt))
            conn.execute(
                text(
                    "CREATE UNIQUE INDEX IF NOT EXISTS uq_production_orders_item_source "
                    "ON production_orders (job_item_id, source_type)"
                )
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

    job = Job(
        zak_code=internal_code,
        customer_order_id=co.id,
    )
    db.add(job)
    db.flush()
    return co, job


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


@router.delete("/customer-orders/{customer_order_id}")
def delete_customer_order(customer_order_id: int, db: Session = Depends(get_db)):
    co = db.get(CustomerOrder, customer_order_id)
    if co is None:
        raise HTTPException(status_code=404, detail="Objednávka nebyla nalezena.")

    jobs = db.scalars(select(Job).where(Job.customer_order_id == customer_order_id)).all()
    for job in jobs:
        items = db.scalars(select(JobItem).where(JobItem.job_id == job.id)).all()
        for it in items:
            for po in db.scalars(select(ProductionOrder).where(ProductionOrder.job_item_id == it.id)).all():
                db.delete(po)
            db.delete(it)
        db.delete(job)
    db.delete(co)
    db.commit()
    return {"status": "ok"}


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


@router.delete("/job-items/{item_id}")
def delete_job_item(item_id: int, db: Session = Depends(get_db)):
    row = db.get(JobItem, item_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Položka zakázky nebyla nalezena.")

    for po in db.scalars(select(ProductionOrder).where(ProductionOrder.job_item_id == item_id)).all():
        db.delete(po)
    db.delete(row)
    db.commit()
    return {"status": "ok"}


@router.post("/{customer_order_id}/create-production-orders")
def create_production_orders_from_allocation(customer_order_id: int, db: Session = Depends(get_db)):
    co = db.get(CustomerOrder, customer_order_id)
    if co is None:
        raise HTTPException(status_code=404, detail="Objednávka nebyla nalezena.")

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
    internal_co: CustomerOrder | None = None
    internal_job: Job | None = None
    for it in items:
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
            existing = db.scalar(
                select(ProductionOrder).where(
                    ProductionOrder.job_item_id == it.id,
                    ProductionOrder.source_type == c["source_type"],
                )
            )
            if existing is not None:
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
                    }
                )
                continue

            po_customer_order_id = customer_order_id
            po_job_id = job.id
            if c["source_type"] == "restock_allocation":
                if internal_co is None or internal_job is None:
                    internal_co, internal_job = _get_or_create_internal_order_and_job(db)
                po_customer_order_id = int(internal_co.id)
                po_job_id = int(internal_job.id)

            po = ProductionOrder(
                vp_code=_next_vp_code(db),
                job_item_id=it.id,
                customer_order_id=po_customer_order_id,
                job_id=po_job_id,
                portfolio_item_id=portfolio_item_id,
                gpn=it.gpn,
                description=description,
                quantity=int(c["quantity"]),
                logistic_mode=c["logistic_mode"],
                source_type=c["source_type"],
                status="planned",
            )
            db.add(po)
            db.flush()
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
                }
            )

    db.commit()
    return {"production_orders": result}


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
        }
        for row in rows
    ]
