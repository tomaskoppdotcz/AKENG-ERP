"""CRUD API pro odchozí poptávky dodavatelům."""

from __future__ import annotations

from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import inspect as sa_inspect, or_, select, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, selectinload

from app.api.deps import require_action
from app.core.database import get_db
from app.models.orders import CustomerOrder, Job, JobItem, ProductionOrder, ProductionOrderOperation
from app.models.planning import PlanningOperation
from app.models.supplier_rfq import ApprovedSupplier, SupplierRfq, SupplierRfqItem

router = APIRouter()

SUPPLIER_RFQ_CATEGORIES = frozenset({"cooperation", "tools", "oils", "material", "services", "other"})
SUPPLIER_RFQ_STATUSES = frozenset({"draft", "sent", "quoted", "ordered", "cancelled"})


class SupplierRfqPayload(BaseModel):
    supplier_id: int | None = None
    supplier_name: str | None = Field(default=None, max_length=255)
    category: str
    status: str = "draft"
    title: str = Field(min_length=1, max_length=255)
    description: str | None = None
    customer_order_id: int | None = None
    job_item_id: int | None = None
    production_order_id: int | None = None
    planning_operation_id: int | None = None
    production_order_operation_id: int | None = None
    requested_date: date | None = None
    due_date: date | None = None
    note: str | None = None


class SupplierRfqItemPayload(BaseModel):
    item_name: str = Field(min_length=1, max_length=255)
    description: str | None = None
    qty: float = Field(gt=0)
    unit: str = Field(min_length=1, max_length=40)
    target_price: float | None = None
    offered_price: float | None = None
    currency: str = Field(default="CZK", min_length=3, max_length=3)
    supplier_lead_time_days: int | None = Field(default=None, ge=0)
    note: str | None = None


def _clean_str(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = value.strip()
    return cleaned or None


def ensure_supplier_rfqs_sqlite_schema(engine: Engine) -> None:
    """SQLite: doplnění RFQ vazeb a jednoduchého číselníku schválených dodavatelů."""
    try:
        url = str(engine.url)
    except Exception:
        return
    if not url.startswith("sqlite"):
        return

    insp = sa_inspect(engine)
    tables = set(insp.get_table_names())
    with engine.begin() as conn:
        if "approved_suppliers" not in tables:
            conn.execute(
                text(
                    """
                    CREATE TABLE approved_suppliers (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        supplier_code VARCHAR(50) NOT NULL UNIQUE,
                        name VARCHAR(255) NOT NULL,
                        category VARCHAR(80),
                        is_approved BOOLEAN NOT NULL DEFAULT 1,
                        is_active BOOLEAN NOT NULL DEFAULT 1,
                        email VARCHAR(255),
                        phone VARCHAR(64),
                        note TEXT,
                        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                    )
                    """
                )
            )
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_approved_suppliers_supplier_code ON approved_suppliers (supplier_code)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_approved_suppliers_is_approved ON approved_suppliers (is_approved)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_approved_suppliers_is_active ON approved_suppliers (is_active)"))
        else:
            supplier_cols = {c["name"] for c in insp.get_columns("approved_suppliers")}
            for col, sql_type in (
                ("supplier_code", "VARCHAR(50)"),
                ("name", "VARCHAR(255)"),
                ("category", "VARCHAR(80)"),
                ("is_approved", "BOOLEAN NOT NULL DEFAULT 1"),
                ("is_active", "BOOLEAN NOT NULL DEFAULT 1"),
                ("email", "VARCHAR(255)"),
                ("phone", "VARCHAR(64)"),
                ("note", "TEXT"),
                ("created_at", "DATETIME"),
                ("updated_at", "DATETIME"),
            ):
                if col not in supplier_cols:
                    conn.execute(text(f"ALTER TABLE approved_suppliers ADD COLUMN {col} {sql_type}"))

        if "supplier_rfqs" in tables:
            rfq_cols = {c["name"] for c in insp.get_columns("supplier_rfqs")}
            for col in ("planning_operation_id", "production_order_operation_id"):
                if col not in rfq_cols:
                    conn.execute(text(f"ALTER TABLE supplier_rfqs ADD COLUMN {col} INTEGER"))
                    conn.execute(text(f"CREATE INDEX IF NOT EXISTS ix_supplier_rfqs_{col} ON supplier_rfqs ({col})"))

        if "customers" in tables:
            existing = conn.execute(text("SELECT COUNT(*) FROM approved_suppliers")).scalar() or 0
            if int(existing) == 0:
                customer_cols = {c["name"] for c in insp.get_columns("customers")}
                email_expr = "email" if "email" in customer_cols else "NULL"
                phone_expr = "phone" if "phone" in customer_cols else "NULL"
                note_expr = "note" if "note" in customer_cols else "NULL"
                active_expr = "COALESCE(is_active, 1)" if "is_active" in customer_cols else "1"
                conn.execute(
                    text(
                        f"""
                        INSERT INTO approved_suppliers
                            (supplier_code, name, category, is_approved, is_active, email, phone, note, created_at, updated_at)
                        SELECT
                            COALESCE(NULLIF(TRIM(code), ''), 'SUP-' || id),
                            COALESCE(NULLIF(TRIM(name), ''), COALESCE(NULLIF(TRIM(code), ''), 'Dodavatel ' || id)),
                            'Adresář zákazníků',
                            1,
                            {active_expr},
                            {email_expr},
                            {phone_expr},
                            {note_expr},
                            CURRENT_TIMESTAMP,
                            CURRENT_TIMESTAMP
                        FROM customers
                        """
                    )
                )


def _validate_category(value: str) -> str:
    category = (value or "").strip().lower()
    if category not in SUPPLIER_RFQ_CATEGORIES:
        raise HTTPException(
            status_code=422,
            detail=f"Neplatná kategorie. Povolené: {', '.join(sorted(SUPPLIER_RFQ_CATEGORIES))}.",
        )
    return category


def _validate_status(value: str) -> str:
    status = (value or "").strip().lower()
    if status not in SUPPLIER_RFQ_STATUSES:
        raise HTTPException(
            status_code=422,
            detail=f"Neplatný stav. Povolené: {', '.join(sorted(SUPPLIER_RFQ_STATUSES))}.",
        )
    return status


def _rfq_no_for_id(rfq_id: int) -> str:
    return f"SRFQ-{int(rfq_id):06d}"


def _date_iso(value: date | None) -> str | None:
    return value.isoformat() if value else None


def _dt_iso(value: datetime | None) -> str:
    if value is None:
        return ""
    s = value.isoformat()
    if value.tzinfo is None:
        return f"{s}Z"
    return s


def _supplier_to_dict(row: ApprovedSupplier) -> dict:
    return {
        "id": int(row.id),
        "supplier_code": row.supplier_code,
        "name": row.name,
        "category": row.category,
        "is_approved": bool(row.is_approved),
        "is_active": bool(row.is_active),
        "email": row.email,
        "phone": row.phone,
        "note": row.note,
    }


def _supplier_snapshot(db: Session, supplier_id: int | None) -> tuple[int | None, str | None]:
    if supplier_id is None:
        return None, None
    supplier = db.get(ApprovedSupplier, int(supplier_id))
    if supplier is None:
        raise HTTPException(status_code=404, detail="Dodavatel nebyl nalezen ve schváleném seznamu.")
    if not supplier.is_active or not supplier.is_approved:
        raise HTTPException(status_code=422, detail="Dodavatel není aktivní a schválený pro nové poptávky.")
    return int(supplier.id), supplier.name


def _operation_label(op_no: int | None, op_name: str | None, workplace: str | None = None) -> str:
    base = f"Op. {int(op_no or 0)} · {op_name or 'bez názvu'}"
    return f"{base} ({workplace})" if workplace else base


def _relation_label(db: Session, rfq: SupplierRfq) -> str:
    parts: list[str] = []
    if rfq.customer_order_id is not None:
        order = db.get(CustomerOrder, int(rfq.customer_order_id))
        if order is not None:
            job = db.scalar(select(Job).where(Job.customer_order_id == int(order.id)).order_by(Job.id.asc()))
            label = job.zak_code if job is not None else (order.customer_po_no or f"#{order.id}")
            parts.append(f"Zakázka {label}")
        else:
            parts.append(f"Zakázka #{rfq.customer_order_id}")
    if rfq.job_item_id is not None:
        item = db.get(JobItem, int(rfq.job_item_id))
        parts.append(f"Položka {item.line_no} · {item.gpn}" if item is not None else f"Položka #{rfq.job_item_id}")
    if rfq.production_order_id is not None:
        po = db.get(ProductionOrder, int(rfq.production_order_id))
        parts.append(f"VP {po.vp_code}" if po is not None else f"VP #{rfq.production_order_id}")
    if rfq.planning_operation_id is not None:
        op = db.get(PlanningOperation, int(rfq.planning_operation_id))
        parts.append(_operation_label(op.operation_no, op.operation_name) if op is not None else f"Operace plán #{rfq.planning_operation_id}")
    elif rfq.production_order_operation_id is not None:
        op = db.get(ProductionOrderOperation, int(rfq.production_order_operation_id))
        parts.append(_operation_label(op.operation_no, op.operation_name, op.workplace_name) if op is not None else f"Operace VP #{rfq.production_order_operation_id}")
    return " / ".join(parts) if parts else "bez vazby"


def _item_to_dict(item: SupplierRfqItem) -> dict:
    offered = item.offered_price
    total_offered = (float(item.qty or 0) * float(offered)) if offered is not None else None
    return {
        "id": int(item.id),
        "rfq_id": int(item.rfq_id),
        "item_name": item.item_name,
        "description": item.description,
        "qty": float(item.qty or 0),
        "unit": item.unit,
        "target_price": float(item.target_price) if item.target_price is not None else None,
        "offered_price": float(item.offered_price) if item.offered_price is not None else None,
        "currency": item.currency,
        "supplier_lead_time_days": item.supplier_lead_time_days,
        "note": item.note,
        "total_offered_price": total_offered,
    }


def _rfq_to_dict(rfq: SupplierRfq, db: Session, include_items: bool = False) -> dict:
    items = list(rfq.items or [])
    total_offered = sum(float(i.qty or 0) * float(i.offered_price or 0) for i in items if i.offered_price is not None)
    out = {
        "id": int(rfq.id),
        "rfq_no": rfq.rfq_no,
        "supplier_id": rfq.supplier_id,
        "supplier_name": rfq.supplier_name,
        "category": rfq.category,
        "status": rfq.status,
        "title": rfq.title,
        "description": rfq.description,
        "customer_order_id": rfq.customer_order_id,
        "job_item_id": rfq.job_item_id,
        "production_order_id": rfq.production_order_id,
        "planning_operation_id": rfq.planning_operation_id,
        "production_order_operation_id": rfq.production_order_operation_id,
        "relation_label": _relation_label(db, rfq),
        "requested_date": _date_iso(rfq.requested_date),
        "due_date": _date_iso(rfq.due_date),
        "created_at": _dt_iso(rfq.created_at),
        "updated_at": _dt_iso(rfq.updated_at),
        "note": rfq.note,
        "items_count": len(items),
        "total_offered_price": total_offered,
    }
    if include_items:
        out["items"] = [_item_to_dict(i) for i in sorted(items, key=lambda x: int(x.id))]
    return out


def _get_rfq_or_404(db: Session, rfq_id: int) -> SupplierRfq:
    rfq = db.scalar(
        select(SupplierRfq)
        .options(selectinload(SupplierRfq.items))
        .where(SupplierRfq.id == int(rfq_id))
    )
    if rfq is None:
        raise HTTPException(status_code=404, detail="Poptávka dodavateli nebyla nalezena.")
    return rfq


def _apply_rfq_payload(rfq: SupplierRfq, body: SupplierRfqPayload, db: Session, *, require_supplier_id: bool) -> None:
    if body.supplier_id is not None:
        try:
            supplier_id, supplier_name = _supplier_snapshot(db, body.supplier_id)
        except HTTPException:
            if require_supplier_id or rfq.supplier_id != body.supplier_id:
                raise
            supplier_id = body.supplier_id
            supplier_name = _clean_str(body.supplier_name)
        rfq.supplier_id = supplier_id
        rfq.supplier_name = supplier_name
    elif require_supplier_id:
        raise HTTPException(status_code=422, detail="Pro novou poptávku vyberte schváleného aktivního dodavatele.")
    else:
        rfq.supplier_id = None
        rfq.supplier_name = _clean_str(body.supplier_name)
    rfq.category = _validate_category(body.category)
    rfq.status = _validate_status(body.status)
    rfq.title = body.title.strip()
    rfq.description = _clean_str(body.description)
    rfq.customer_order_id = body.customer_order_id
    rfq.job_item_id = body.job_item_id
    rfq.production_order_id = body.production_order_id
    rfq.planning_operation_id = body.planning_operation_id
    rfq.production_order_operation_id = body.production_order_operation_id
    rfq.requested_date = body.requested_date
    rfq.due_date = body.due_date
    rfq.note = _clean_str(body.note)


def _apply_item_payload(item: SupplierRfqItem, body: SupplierRfqItemPayload) -> None:
    item.item_name = body.item_name.strip()
    item.description = _clean_str(body.description)
    item.qty = float(body.qty)
    item.unit = body.unit.strip()
    item.target_price = float(body.target_price) if body.target_price is not None else None
    item.offered_price = float(body.offered_price) if body.offered_price is not None else None
    item.currency = body.currency.strip().upper() or "CZK"
    item.supplier_lead_time_days = body.supplier_lead_time_days
    item.note = _clean_str(body.note)


@router.get("/supplier-rfqs")
def list_supplier_rfqs(db: Session = Depends(get_db)):
    rows = (
        db.scalars(
            select(SupplierRfq)
            .options(selectinload(SupplierRfq.items))
            .order_by(SupplierRfq.id.desc())
        )
        .unique()
        .all()
    )
    return {"items": [_rfq_to_dict(r, db) for r in rows]}


@router.get("/supplier-rfqs/suppliers")
def list_approved_suppliers(db: Session = Depends(get_db)):
    rows = db.scalars(
        select(ApprovedSupplier)
        .where(ApprovedSupplier.is_active == True, ApprovedSupplier.is_approved == True)  # noqa: E712
        .order_by(ApprovedSupplier.name.asc(), ApprovedSupplier.supplier_code.asc())
    ).all()
    return {"items": [_supplier_to_dict(r) for r in rows]}


@router.get("/supplier-rfqs/link-options")
def list_supplier_rfq_link_options(db: Session = Depends(get_db)):
    jobs_by_order: dict[int, Job] = {}
    for job in db.scalars(select(Job).order_by(Job.id.asc())).all():
        if job.customer_order_id is not None and int(job.customer_order_id) not in jobs_by_order:
            jobs_by_order[int(job.customer_order_id)] = job
    orders = []
    for order in db.scalars(select(CustomerOrder).order_by(CustomerOrder.id.desc())).all():
        job = jobs_by_order.get(int(order.id))
        label = job.zak_code if job is not None else (order.customer_po_no or f"#{order.id}")
        orders.append(
            {
                "id": int(order.id),
                "label": label,
                "customer_po_no": order.customer_po_no,
                "customer_name": order.customer_name,
                "workflow_status": getattr(order, "workflow_status", None),
            }
        )

    items = []
    job_map: dict[int, Job] = {}
    for item in db.scalars(select(JobItem).order_by(JobItem.id.desc())).all():
        job = job_map.get(int(item.job_id)) if item.job_id is not None else None
        if job is None and item.job_id is not None:
            job = db.get(Job, int(item.job_id))
            if job is not None:
                job_map[int(job.id)] = job
        items.append(
            {
                "id": int(item.id),
                "job_id": item.job_id,
                "customer_order_id": job.customer_order_id if job is not None else None,
                "label": f"{job.zak_code if job is not None else 'Zakázka'} / pol. {item.line_no} · {item.gpn}",
                "line_no": item.line_no,
                "gpn": item.gpn,
                "workflow_status": getattr(item, "workflow_status", None),
            }
        )

    production_orders = []
    for po in db.scalars(select(ProductionOrder).order_by(ProductionOrder.id.desc())).all():
        production_orders.append(
            {
                "id": int(po.id),
                "vp_code": po.vp_code,
                "label": f"{po.vp_code} · {po.gpn or po.description or ''}".strip(),
                "customer_order_id": po.customer_order_id,
                "job_item_id": po.job_item_id,
                "gpn": po.gpn,
                "description": po.description,
                "workflow_status": getattr(po, "workflow_status", None),
            }
        )
    return {"customer_orders": orders, "job_items": items, "production_orders": production_orders}


@router.get("/supplier-rfqs/production-orders/{production_order_id}/operations")
def list_supplier_rfq_operation_options(production_order_id: int, db: Session = Depends(get_db)):
    po = db.get(ProductionOrder, int(production_order_id))
    if po is None:
        raise HTTPException(status_code=404, detail="Výrobní příkaz nebyl nalezen.")
    vp_ops = db.scalars(
        select(ProductionOrderOperation)
        .where(ProductionOrderOperation.production_order_id == int(po.id))
        .order_by(ProductionOrderOperation.operation_no.asc(), ProductionOrderOperation.id.asc())
    ).all()
    conds = []
    if po.vp_code:
        conds.append(PlanningOperation.work_order_no == po.vp_code)
    if po.job_item_id is not None:
        conds.append(PlanningOperation.order_item_id == int(po.job_item_id))
    planning_ops = (
        db.scalars(select(PlanningOperation).where(or_(*conds)).order_by(PlanningOperation.operation_no.asc(), PlanningOperation.id.asc())).all()
        if conds
        else []
    )
    return {
        "production_order_id": int(po.id),
        "vp_code": po.vp_code,
        "operations": [
            {
                "source": "planning",
                "planning_operation_id": int(op.id),
                "production_order_operation_id": None,
                "operation_no": int(op.operation_no or 0),
                "operation_name": op.operation_name,
                "label": _operation_label(op.operation_no, op.operation_name),
            }
            for op in planning_ops
        ]
        + [
            {
                "source": "production_order",
                "planning_operation_id": None,
                "production_order_operation_id": int(op.id),
                "operation_no": int(op.operation_no or 0),
                "operation_name": op.operation_name,
                "label": _operation_label(op.operation_no, op.operation_name, op.workplace_name),
            }
            for op in vp_ops
        ],
    }


@router.get("/supplier-rfqs/{rfq_id}")
def get_supplier_rfq(rfq_id: int, db: Session = Depends(get_db)):
    return _rfq_to_dict(_get_rfq_or_404(db, rfq_id), db, include_items=True)


@router.post("/supplier-rfqs")
def create_supplier_rfq(
    body: SupplierRfqPayload,
    db: Session = Depends(get_db),
    _rbac: None = Depends(require_action("purchase.write")),
):
    rfq = SupplierRfq(
        rfq_no="PENDING",
        category="other",
        status="draft",
        title=body.title.strip(),
    )
    _apply_rfq_payload(rfq, body, db, require_supplier_id=True)
    db.add(rfq)
    db.flush()
    rfq.rfq_no = _rfq_no_for_id(rfq.id)
    db.commit()
    db.refresh(rfq)
    return _rfq_to_dict(rfq, db, include_items=True)


@router.put("/supplier-rfqs/{rfq_id}")
def update_supplier_rfq(
    rfq_id: int,
    body: SupplierRfqPayload,
    db: Session = Depends(get_db),
    _rbac: None = Depends(require_action("purchase.write")),
):
    rfq = _get_rfq_or_404(db, rfq_id)
    _apply_rfq_payload(rfq, body, db, require_supplier_id=False)
    db.commit()
    db.refresh(rfq)
    return _rfq_to_dict(rfq, db, include_items=True)


@router.post("/supplier-rfqs/{rfq_id}/items")
def create_supplier_rfq_item(
    rfq_id: int,
    body: SupplierRfqItemPayload,
    db: Session = Depends(get_db),
    _rbac: None = Depends(require_action("purchase.write")),
):
    rfq = _get_rfq_or_404(db, rfq_id)
    item = SupplierRfqItem(rfq_id=int(rfq.id), item_name=body.item_name.strip(), qty=float(body.qty), unit=body.unit.strip())
    _apply_item_payload(item, body)
    db.add(item)
    db.commit()
    db.refresh(rfq)
    return _rfq_to_dict(rfq, db, include_items=True)


@router.put("/supplier-rfqs/{rfq_id}/items/{item_id}")
def update_supplier_rfq_item(
    rfq_id: int,
    item_id: int,
    body: SupplierRfqItemPayload,
    db: Session = Depends(get_db),
    _rbac: None = Depends(require_action("purchase.write")),
):
    _get_rfq_or_404(db, rfq_id)
    item = db.get(SupplierRfqItem, int(item_id))
    if item is None or int(item.rfq_id) != int(rfq_id):
        raise HTTPException(status_code=404, detail="Položka poptávky nebyla nalezena.")
    _apply_item_payload(item, body)
    db.commit()
    return _rfq_to_dict(_get_rfq_or_404(db, rfq_id), db, include_items=True)


@router.delete("/supplier-rfqs/{rfq_id}/items/{item_id}")
def delete_supplier_rfq_item(
    rfq_id: int,
    item_id: int,
    db: Session = Depends(get_db),
    _rbac: None = Depends(require_action("purchase.write")),
):
    _get_rfq_or_404(db, rfq_id)
    item = db.get(SupplierRfqItem, int(item_id))
    if item is None or int(item.rfq_id) != int(rfq_id):
        raise HTTPException(status_code=404, detail="Položka poptávky nebyla nalezena.")
    db.delete(item)
    db.commit()
    return _rfq_to_dict(_get_rfq_or_404(db, rfq_id), db, include_items=True)
