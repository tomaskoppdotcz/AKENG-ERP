"""CRUD API pro dodavatelské nákupní objednávky."""

from __future__ import annotations

from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, inspect as sa_inspect, select, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, selectinload

from app.api.deps import require_action
from app.core.database import get_db
from app.models.material_library import MaterialLibraryItem
from app.models.material_stock import MaterialStockItem, MaterialStockMovement
from app.models.orders import CustomerOrder, Job, JobItem, ProductionOrder
from app.models.planning import PlanningOperation
from app.models.supplier_purchase_order import SupplierPurchaseOrder, SupplierPurchaseOrderItem
from app.models.supplier_rfq import ApprovedSupplier, SupplierRfq, SupplierRfqItem
from app.core.scan_code import material_stock_movement_scan_code_for_id, material_stock_scan_code_for_id
from app.services.cooperation_operations import (
    normalize_cooperation_status,
    receive_cooperation_operation,
)
from app.services.material_receipt_unit_service import create_receipt_unit_for_prijem
from app.services.material_readiness import refresh_material_readiness_for_material_library_item

router = APIRouter()

SUPPLIER_PURCHASE_ORDER_STATUSES = frozenset({"draft", "ordered", "partially_received", "received", "cancelled"})
SUPPLIER_PURCHASE_ORDER_CATEGORIES = frozenset({"cooperation", "tools", "oils", "material", "services", "other"})
SUPPLIER_PURCHASE_ORDER_SOURCE_TYPES = frozenset({"manual", "rfq", "requirement"})


class SupplierPurchaseOrderPayload(BaseModel):
    supplier_id: int | None = None
    supplier_name: str | None = Field(default=None, max_length=255)
    status: str = "draft"
    source_type: str | None = None
    rfq_id: int | None = None
    category: str = "other"
    customer_order_id: int | None = None
    job_item_id: int | None = None
    production_order_id: int | None = None
    planning_operation_id: int | None = None
    ordered_at: datetime | None = None
    expected_delivery_date: date | None = None
    note: str | None = None
    is_from_material_requirement: bool = False


class SupplierPurchaseOrderItemPayload(BaseModel):
    rfq_item_id: int | None = None
    material_library_item_id: int | None = None
    item_name: str = Field(min_length=1, max_length=255)
    description: str | None = None
    qty: float = Field(gt=0)
    unit: str = Field(min_length=1, max_length=40)
    unit_price: float | None = None
    currency: str = Field(default="CZK", min_length=3, max_length=3)
    received_qty: float = Field(default=0, ge=0)
    note: str | None = None


class SupplierPurchaseOrderReceiveItemPayload(BaseModel):
    item_id: int
    received_qty: float = Field(gt=0)
    mode: str = Field(pattern="^(material|cooperation)$")
    heat_lot: str | None = Field(default=None, max_length=120)
    certificate_no: str | None = Field(default=None, max_length=120)
    delivery_note_no: str | None = Field(default=None, max_length=120)
    supplier_batch: str | None = Field(default=None, max_length=120)
    note: str | None = None


class MaterialRequirementPurchaseOrderItemPayload(BaseModel):
    material_library_item_id: int
    material_code: str | None = Field(default=None, max_length=255)
    qty: float = Field(gt=0)
    unit: str | None = Field(default=None, max_length=40)
    note: str | None = None


class MaterialRequirementPurchaseOrderPayload(BaseModel):
    supplier_id: int
    customer_order_id: int | None = None
    job_item_id: int | None = None
    production_order_id: int | None = None
    note: str | None = None
    items: list[MaterialRequirementPurchaseOrderItemPayload]


def ensure_supplier_purchase_orders_sqlite_schema(engine: Engine) -> None:
    """SQLite: vytvoří tabulky pro dodavatelské objednávky i při starší lokální DB."""
    try:
        url = str(engine.url)
    except Exception:
        return
    if not url.startswith("sqlite"):
        return

    insp = sa_inspect(engine)
    tables = set(insp.get_table_names())
    with engine.begin() as conn:
        if "supplier_purchase_orders" not in tables:
            conn.execute(
                text(
                    """
                    CREATE TABLE supplier_purchase_orders (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        po_no VARCHAR(40) NOT NULL UNIQUE,
                        supplier_id INTEGER,
                        supplier_name VARCHAR(255),
                        status VARCHAR(40) NOT NULL DEFAULT 'draft',
                        source_type VARCHAR(20) NOT NULL DEFAULT 'manual',
                        rfq_id INTEGER,
                        category VARCHAR(40) NOT NULL DEFAULT 'other',
                        customer_order_id INTEGER,
                        job_item_id INTEGER,
                        production_order_id INTEGER,
                        planning_operation_id INTEGER,
                        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        ordered_at DATETIME,
                        expected_delivery_date DATE,
                        note TEXT,
                        is_from_material_requirement BOOLEAN NOT NULL DEFAULT 0
                    )
                    """
                )
            )
            for col in (
                "po_no",
                "supplier_id",
                "status",
                "source_type",
                "rfq_id",
                "category",
                "customer_order_id",
                "job_item_id",
                "production_order_id",
                "planning_operation_id",
                "expected_delivery_date",
                "is_from_material_requirement",
            ):
                conn.execute(text(f"CREATE INDEX IF NOT EXISTS ix_supplier_purchase_orders_{col} ON supplier_purchase_orders ({col})"))
        else:
            po_cols = {c["name"] for c in insp.get_columns("supplier_purchase_orders")}
            for col, sql_type in (
                ("source_type", "VARCHAR(20) NOT NULL DEFAULT 'manual'"),
                ("category", "VARCHAR(40) NOT NULL DEFAULT 'other'"),
                ("is_from_material_requirement", "BOOLEAN NOT NULL DEFAULT 0"),
            ):
                if col not in po_cols:
                    conn.execute(text(f"ALTER TABLE supplier_purchase_orders ADD COLUMN {col} {sql_type}"))
                    conn.execute(text(f"CREATE INDEX IF NOT EXISTS ix_supplier_purchase_orders_{col} ON supplier_purchase_orders ({col})"))

        if "supplier_purchase_order_items" not in tables:
            conn.execute(
                text(
                    """
                    CREATE TABLE supplier_purchase_order_items (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        purchase_order_id INTEGER NOT NULL,
                        rfq_item_id INTEGER,
                        material_library_item_id INTEGER,
                        item_name VARCHAR(255) NOT NULL,
                        description TEXT,
                        qty FLOAT NOT NULL,
                        unit VARCHAR(40) NOT NULL,
                        unit_price FLOAT,
                        currency VARCHAR(3) NOT NULL DEFAULT 'CZK',
                        total_price FLOAT,
                        received_qty FLOAT NOT NULL DEFAULT 0,
                        received_at DATETIME,
                        received_note TEXT,
                        note TEXT
                    )
                    """
                )
            )
            conn.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS ix_supplier_purchase_order_items_purchase_order_id "
                    "ON supplier_purchase_order_items (purchase_order_id)"
                )
            )
            conn.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS ix_supplier_purchase_order_items_rfq_item_id "
                    "ON supplier_purchase_order_items (rfq_item_id)"
                )
            )
            conn.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS ix_supplier_purchase_order_items_material_library_item_id "
                    "ON supplier_purchase_order_items (material_library_item_id)"
                )
            )
        else:
            item_cols = {c["name"] for c in insp.get_columns("supplier_purchase_order_items")}
            for col, sql_type in (
                ("material_library_item_id", "INTEGER"),
                ("unit_price", "FLOAT"),
                ("total_price", "FLOAT"),
                ("received_qty", "FLOAT NOT NULL DEFAULT 0"),
                ("received_at", "DATETIME"),
                ("received_note", "TEXT"),
            ):
                if col not in item_cols:
                    conn.execute(text(f"ALTER TABLE supplier_purchase_order_items ADD COLUMN {col} {sql_type}"))
            conn.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS ix_supplier_purchase_order_items_material_library_item_id "
                    "ON supplier_purchase_order_items (material_library_item_id)"
                )
            )


def _clean_str(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = value.strip()
    return cleaned or None


def _validate_status(value: str) -> str:
    status = (value or "").strip().lower()
    if status not in SUPPLIER_PURCHASE_ORDER_STATUSES:
        raise HTTPException(
            status_code=422,
            detail=f"Neplatný stav. Povolené: {', '.join(sorted(SUPPLIER_PURCHASE_ORDER_STATUSES))}.",
        )
    return status


def _validate_category(value: str) -> str:
    category = (value or "other").strip().lower()
    if category not in SUPPLIER_PURCHASE_ORDER_CATEGORIES:
        raise HTTPException(
            status_code=422,
            detail=f"Neplatná kategorie. Povolené: {', '.join(sorted(SUPPLIER_PURCHASE_ORDER_CATEGORIES))}.",
        )
    return category


def _validate_source_type(value: str | None) -> str:
    source_type = (value or "manual").strip().lower()
    if source_type not in SUPPLIER_PURCHASE_ORDER_SOURCE_TYPES:
        raise HTTPException(
            status_code=422,
            detail=f"Neplatný zdroj. Povolené: {', '.join(sorted(SUPPLIER_PURCHASE_ORDER_SOURCE_TYPES))}.",
        )
    return source_type


def _po_no_for_id(po_id: int) -> str:
    return f"SPO-{int(po_id):06d}"


def _date_iso(value: date | None) -> str | None:
    return value.isoformat() if value else None


def _dt_iso(value: datetime | None) -> str | None:
    if value is None:
        return None
    s = value.isoformat()
    if value.tzinfo is None:
        return f"{s}Z"
    return s


def _supplier_snapshot(db: Session, supplier_id: int | None) -> tuple[int | None, str | None]:
    if supplier_id is None:
        return None, None
    supplier = db.get(ApprovedSupplier, int(supplier_id))
    if supplier is None:
        raise HTTPException(status_code=404, detail="Dodavatel nebyl nalezen ve schváleném seznamu.")
    if not supplier.is_active or not supplier.is_approved:
        raise HTTPException(status_code=422, detail="Dodavatel není aktivní a schválený pro nové objednávky.")
    return int(supplier.id), supplier.name


def _operation_label(op_no: int | None, op_name: str | None) -> str:
    return f"Op. {int(op_no or 0)} · {op_name or 'bez názvu'}"


def _relation_label(db: Session, po: SupplierPurchaseOrder) -> str:
    parts: list[str] = []
    if po.customer_order_id is not None:
        order = db.get(CustomerOrder, int(po.customer_order_id))
        if order is not None:
            job = db.scalar(select(Job).where(Job.customer_order_id == int(order.id)).order_by(Job.id.asc()))
            label = job.zak_code if job is not None else (order.customer_po_no or f"#{order.id}")
            parts.append(f"Zakázka {label}")
        else:
            parts.append(f"Zakázka #{po.customer_order_id}")
    if po.job_item_id is not None:
        item = db.get(JobItem, int(po.job_item_id))
        parts.append(f"Položka {item.line_no} · {item.gpn}" if item is not None else f"Položka #{po.job_item_id}")
    if po.production_order_id is not None:
        production_order = db.get(ProductionOrder, int(po.production_order_id))
        parts.append(f"VP {production_order.vp_code}" if production_order is not None else f"VP #{po.production_order_id}")
    if po.planning_operation_id is not None:
        op = db.get(PlanningOperation, int(po.planning_operation_id))
        parts.append(_operation_label(op.operation_no, op.operation_name) if op is not None else f"Operace #{po.planning_operation_id}")
    return " / ".join(parts) if parts else "bez vazby"


def _item_total(qty: float, unit_price: float | None) -> float | None:
    if unit_price is None:
        return None
    return float(qty or 0) * float(unit_price)


def _item_to_dict(item: SupplierPurchaseOrderItem) -> dict:
    return {
        "id": int(item.id),
        "purchase_order_id": int(item.purchase_order_id),
        "rfq_item_id": item.rfq_item_id,
        "material_library_item_id": item.material_library_item_id,
        "item_name": item.item_name,
        "description": item.description,
        "qty": float(item.qty or 0),
        "unit": item.unit,
        "unit_price": float(item.unit_price) if item.unit_price is not None else None,
        "currency": item.currency,
        "total_price": float(item.total_price) if item.total_price is not None else None,
        "received_qty": float(item.received_qty or 0),
        "received_at": _dt_iso(item.received_at),
        "received_note": item.received_note,
        "note": item.note,
    }


def _po_to_dict(po: SupplierPurchaseOrder, db: Session, include_items: bool = False) -> dict:
    items = list(po.items or [])
    total_price = sum(float(i.total_price or 0) for i in items if i.total_price is not None)
    currency = next((i.currency for i in items if i.currency), "CZK")
    coop_operation = None
    if po.planning_operation_id is not None:
        op = db.get(PlanningOperation, int(po.planning_operation_id))
        if op is not None and (bool(getattr(op, "is_cooperation", False)) or po.category == "cooperation"):
            coop_operation = {
                "planning_operation_id": int(op.id),
                "work_order_no": op.work_order_no,
                "operation_no": int(op.operation_no or 0),
                "operation_name": op.operation_name,
                "is_cooperation": bool(getattr(op, "is_cooperation", False)),
                "cooperation_status": normalize_cooperation_status(
                    getattr(op, "cooperation_status", None),
                    is_cooperation=bool(getattr(op, "is_cooperation", False)) or po.category == "cooperation",
                ),
                "cooperation_sent_at": _dt_iso(getattr(op, "cooperation_sent_at", None)),
                "cooperation_received_at": _dt_iso(getattr(op, "cooperation_received_at", None)),
            }
    out = {
        "id": int(po.id),
        "po_no": po.po_no,
        "supplier_id": po.supplier_id,
        "supplier_name": po.supplier_name,
        "status": po.status,
        "source_type": po.source_type,
        "rfq_id": po.rfq_id,
        "category": po.category,
        "customer_order_id": po.customer_order_id,
        "job_item_id": po.job_item_id,
        "production_order_id": po.production_order_id,
        "planning_operation_id": po.planning_operation_id,
        "relation_label": _relation_label(db, po),
        "created_at": _dt_iso(po.created_at),
        "ordered_at": _dt_iso(po.ordered_at),
        "expected_delivery_date": _date_iso(po.expected_delivery_date),
        "note": po.note,
        "is_from_material_requirement": bool(getattr(po, "is_from_material_requirement", False)),
        "items_count": len(items),
        "total_price": total_price,
        "currency": currency,
        "cooperation_operation": coop_operation,
    }
    if include_items:
        out["items"] = [_item_to_dict(i) for i in sorted(items, key=lambda x: int(x.id))]
    return out


def _get_po_or_404(db: Session, po_id: int) -> SupplierPurchaseOrder:
    po = db.scalar(
        select(SupplierPurchaseOrder)
        .options(selectinload(SupplierPurchaseOrder.items))
        .where(SupplierPurchaseOrder.id == int(po_id))
    )
    if po is None:
        raise HTTPException(status_code=404, detail="Dodavatelská objednávka nebyla nalezena.")
    return po


def _apply_po_payload(po: SupplierPurchaseOrder, body: SupplierPurchaseOrderPayload, db: Session, *, require_supplier_id: bool) -> None:
    if body.supplier_id is not None:
        try:
            supplier_id, supplier_name = _supplier_snapshot(db, body.supplier_id)
        except HTTPException:
            if require_supplier_id or po.supplier_id != body.supplier_id:
                raise
            supplier_id = body.supplier_id
            supplier_name = _clean_str(body.supplier_name)
        po.supplier_id = supplier_id
        po.supplier_name = supplier_name
    elif require_supplier_id:
        raise HTTPException(status_code=422, detail="Pro novou objednávku vyberte schváleného aktivního dodavatele.")
    else:
        po.supplier_id = None
        po.supplier_name = _clean_str(body.supplier_name)

    next_status = _validate_status(body.status)
    po.status = next_status
    if next_status == "ordered" and po.ordered_at is None:
        po.ordered_at = body.ordered_at or datetime.utcnow()
    elif body.ordered_at is not None:
        po.ordered_at = body.ordered_at
    po.source_type = _validate_source_type(body.source_type or po.source_type)
    po.rfq_id = body.rfq_id if po.source_type == "rfq" else None
    po.category = _validate_category(body.category)
    po.customer_order_id = body.customer_order_id
    po.job_item_id = body.job_item_id
    po.production_order_id = body.production_order_id
    po.planning_operation_id = body.planning_operation_id
    po.is_from_material_requirement = bool(body.is_from_material_requirement)
    if po.planning_operation_id is not None and po.category == "cooperation":
        op = db.get(PlanningOperation, int(po.planning_operation_id))
        if op is not None:
            op.is_cooperation = True
            op.cooperation_status = op.cooperation_status or "pending_send"
            op.cooperation_supplier_purchase_order_id = int(po.id) if po.id else op.cooperation_supplier_purchase_order_id
    po.expected_delivery_date = body.expected_delivery_date
    po.note = _clean_str(body.note)


def _apply_item_payload(item: SupplierPurchaseOrderItem, body: SupplierPurchaseOrderItemPayload) -> None:
    item.rfq_item_id = body.rfq_item_id
    item.material_library_item_id = body.material_library_item_id
    item.item_name = body.item_name.strip()
    item.description = _clean_str(body.description)
    item.qty = float(body.qty)
    item.unit = body.unit.strip()
    item.unit_price = float(body.unit_price) if body.unit_price is not None else None
    item.currency = body.currency.strip().upper() or "CZK"
    item.total_price = _item_total(item.qty, item.unit_price)
    item.received_qty = float(body.received_qty or 0)
    item.note = _clean_str(body.note)


def _sync_cooperation_link(db: Session, po: SupplierPurchaseOrder) -> None:
    if po.planning_operation_id is None or po.category != "cooperation":
        return
    op = db.get(PlanningOperation, int(po.planning_operation_id))
    if op is None:
        return
    op.is_cooperation = True
    op.cooperation_status = op.cooperation_status or "pending_send"
    op.cooperation_supplier_purchase_order_id = int(po.id)


def _update_receipt_status(po: SupplierPurchaseOrder) -> None:
    items = list(po.items or [])
    if not items:
        return
    fully_received = all(float(item.received_qty or 0) >= float(item.qty or 0) - 1e-9 for item in items)
    any_received = any(float(item.received_qty or 0) > 1e-9 for item in items)
    if fully_received:
        po.status = "received"
    elif any_received:
        po.status = "partially_received"


def _resolve_material_for_spo_item(db: Session, item: SupplierPurchaseOrderItem) -> MaterialLibraryItem:
    if item.material_library_item_id is not None:
        material = db.get(MaterialLibraryItem, int(item.material_library_item_id))
        if material is not None:
            return material

    item_name = (item.item_name or "").strip()
    if item_name:
        material = db.scalar(
            select(MaterialLibraryItem).where(func.lower(MaterialLibraryItem.code) == item_name.lower())
        )
        if material is None:
            material = db.scalar(
                select(MaterialLibraryItem).where(func.lower(MaterialLibraryItem.name) == item_name.lower())
            )
        if material is not None:
            item.material_library_item_id = int(material.id)
            return material

    raise HTTPException(
        status_code=422,
        detail="Pro příjem na sklad nelze určit materiál. Vyberte položku vytvořenou z požadavku materiálu nebo použijte přesný kód materiálu.",
    )


def _get_or_create_stock_item_for_material(
    db: Session,
    *,
    material: MaterialLibraryItem,
    item: SupplierPurchaseOrderItem,
) -> MaterialStockItem:
    stock = db.scalar(
        select(MaterialStockItem)
        .where(MaterialStockItem.material_library_item_id == int(material.id), MaterialStockItem.is_active.is_(True))
        .order_by(MaterialStockItem.location.is_not(None), MaterialStockItem.id.asc())
    )
    if stock is not None:
        return stock

    stock = MaterialStockItem(
        material_library_item_id=int(material.id),
        location=None,
        current_qty=0.0,
        unit=(item.unit or material.unit or None),
        note=f"Automaticky založeno při příjmu dodavatelské objednávky {item.purchase_order_id}.",
        is_active=True,
    )
    db.add(stock)
    db.flush()
    stock.scan_code = material_stock_scan_code_for_id(int(stock.id))
    return stock


def _receive_material_item(
    db: Session,
    *,
    po: SupplierPurchaseOrder,
    item: SupplierPurchaseOrderItem,
    body: SupplierPurchaseOrderReceiveItemPayload,
    received_at: datetime,
) -> None:
    material = _resolve_material_for_spo_item(db, item)
    stock = _get_or_create_stock_item_for_material(db, material=material, item=item)
    note_parts = [body.note, f"SPO {po.po_no} / položka #{item.id}"]
    if body.supplier_batch:
        note_parts.insert(1, f"Dodavatelská šarže: {body.supplier_batch}")
    movement = MaterialStockMovement(
        stock_item_id=int(stock.id),
        movement_type="prijem",
        qty=float(body.received_qty),
        movement_date=received_at,
        reference=po.po_no,
        heat_lot=_clean_str(body.heat_lot) or _clean_str(body.supplier_batch),
        supplier_batch=_clean_str(body.supplier_batch),
        production_order_id=po.production_order_id,
        job_item_id=po.job_item_id,
        supplier_purchase_order_item_id=int(item.id),
        note=" | ".join(part for part in note_parts if part),
        supplier_name=po.supplier_name,
        delivery_note_no=_clean_str(body.delivery_note_no),
        certificate_no=_clean_str(body.certificate_no),
    )
    db.add(movement)
    mru = create_receipt_unit_for_prijem(
        db,
        stock=stock,
        received_qty=float(body.received_qty),
        uom=stock.unit or item.unit,
        heat_lot=movement.heat_lot,
        supplier_batch=movement.supplier_batch,
        certificate_no=movement.certificate_no,
        delivery_note_no=movement.delivery_note_no,
        invoice_no=None,
        supplier_name=movement.supplier_name,
        received_at=received_at,
    )
    movement.receipt_unit_id = int(mru.id)
    stock.current_qty = float(stock.current_qty or 0) + float(body.received_qty)
    refresh_material_readiness_for_material_library_item(db, int(material.id))


@router.get("/supplier-purchase-orders")
def list_supplier_purchase_orders(db: Session = Depends(get_db)):
    rows = (
        db.scalars(
            select(SupplierPurchaseOrder)
            .options(selectinload(SupplierPurchaseOrder.items))
            .order_by(SupplierPurchaseOrder.id.desc())
        )
        .unique()
        .all()
    )
    return {"items": [_po_to_dict(r, db) for r in rows]}


@router.get("/supplier-purchase-orders/{po_id}")
def get_supplier_purchase_order(po_id: int, db: Session = Depends(get_db)):
    return _po_to_dict(_get_po_or_404(db, po_id), db, include_items=True)


@router.post("/supplier-purchase-orders")
def create_supplier_purchase_order(
    body: SupplierPurchaseOrderPayload,
    db: Session = Depends(get_db),
    _rbac: None = Depends(require_action("purchase.write")),
):
    po = SupplierPurchaseOrder(po_no="PENDING", status="draft", source_type="manual", rfq_id=None)
    _apply_po_payload(po, body, db, require_supplier_id=True)
    po.source_type = "manual"
    po.rfq_id = None
    db.add(po)
    db.flush()
    po.po_no = _po_no_for_id(po.id)
    _sync_cooperation_link(db, po)
    db.commit()
    db.refresh(po)
    return _po_to_dict(po, db, include_items=True)


@router.post("/supplier-purchase-orders/from-material-requirement")
def create_supplier_purchase_order_from_material_requirement(
    body: MaterialRequirementPurchaseOrderPayload,
    db: Session = Depends(get_db),
    _rbac: None = Depends(require_action("purchase.write")),
):
    if not body.items:
        raise HTTPException(status_code=422, detail="Alespoň jedna řádka objednávky.")
    supplier_id, supplier_name = _supplier_snapshot(db, body.supplier_id)
    po = SupplierPurchaseOrder(
        po_no="PENDING",
        supplier_id=supplier_id,
        supplier_name=supplier_name,
        status="draft",
        source_type="requirement",
        rfq_id=None,
        category="material",
        customer_order_id=body.customer_order_id,
        job_item_id=body.job_item_id,
        production_order_id=body.production_order_id,
        planning_operation_id=None,
        note=_clean_str(body.note),
        is_from_material_requirement=True,
    )
    db.add(po)
    db.flush()
    po.po_no = _po_no_for_id(po.id)

    for ln in body.items:
        lib = db.get(MaterialLibraryItem, int(ln.material_library_item_id))
        if lib is None:
            raise HTTPException(status_code=404, detail=f"Materiál ID {ln.material_library_item_id} neexistuje.")
        material_code = _clean_str(ln.material_code) or _clean_str(getattr(lib, "code", None))
        material_name = _clean_str(getattr(lib, "name", None))
        item_name = material_code or material_name or f"Materiál #{ln.material_library_item_id}"
        unit = _clean_str(ln.unit) or _clean_str(getattr(lib, "unit", None)) or "mm"
        db.add(
            SupplierPurchaseOrderItem(
                purchase_order_id=int(po.id),
                rfq_item_id=None,
                material_library_item_id=int(lib.id),
                item_name=item_name,
                description=material_name,
                qty=float(ln.qty),
                unit=unit,
                unit_price=None,
                currency="CZK",
                total_price=None,
                received_qty=0,
                note=_clean_str(ln.note),
            )
        )

    db.commit()
    return _po_to_dict(_get_po_or_404(db, po.id), db, include_items=True)


@router.post("/supplier-purchase-orders/from-rfq/{rfq_id}")
def create_supplier_purchase_order_from_rfq(
    rfq_id: int,
    db: Session = Depends(get_db),
    _rbac: None = Depends(require_action("purchase.write")),
):
    rfq = db.scalar(
        select(SupplierRfq)
        .options(selectinload(SupplierRfq.items))
        .where(SupplierRfq.id == int(rfq_id))
    )
    if rfq is None:
        raise HTTPException(status_code=404, detail="Poptávka dodavateli nebyla nalezena.")
    if rfq.supplier_id is None:
        raise HTTPException(status_code=422, detail="Poptávka nemá vybraného dodavatele.")

    po = SupplierPurchaseOrder(
        po_no="PENDING",
        supplier_id=rfq.supplier_id,
        supplier_name=rfq.supplier_name,
        status="draft",
        source_type="rfq",
        rfq_id=int(rfq.id),
        category=rfq.category,
        customer_order_id=rfq.customer_order_id,
        job_item_id=rfq.job_item_id,
        production_order_id=rfq.production_order_id,
        planning_operation_id=rfq.planning_operation_id,
        expected_delivery_date=rfq.due_date,
        note=rfq.note,
    )
    db.add(po)
    db.flush()
    po.po_no = _po_no_for_id(po.id)
    _sync_cooperation_link(db, po)
    for rfq_item in sorted(rfq.items or [], key=lambda x: int(x.id)):
        unit_price = float(rfq_item.offered_price) if rfq_item.offered_price is not None else None
        db.add(
            SupplierPurchaseOrderItem(
                purchase_order_id=int(po.id),
                rfq_item_id=int(rfq_item.id),
                item_name=rfq_item.item_name,
                description=rfq_item.description,
                qty=float(rfq_item.qty or 0),
                unit=rfq_item.unit,
                unit_price=unit_price,
                currency=rfq_item.currency or "CZK",
                total_price=_item_total(float(rfq_item.qty or 0), unit_price),
                received_qty=0,
                note=rfq_item.note,
            )
        )
    db.commit()
    return _po_to_dict(_get_po_or_404(db, po.id), db, include_items=True)


@router.put("/supplier-purchase-orders/{po_id}")
def update_supplier_purchase_order(
    po_id: int,
    body: SupplierPurchaseOrderPayload,
    db: Session = Depends(get_db),
    _rbac: None = Depends(require_action("purchase.write")),
):
    po = _get_po_or_404(db, po_id)
    _apply_po_payload(po, body, db, require_supplier_id=False)
    _sync_cooperation_link(db, po)
    db.commit()
    db.refresh(po)
    return _po_to_dict(po, db, include_items=True)


@router.post("/supplier-purchase-orders/{po_id}/receive-cooperation")
def receive_linked_cooperation(
    po_id: int,
    db: Session = Depends(get_db),
    _rbac: None = Depends(require_action("purchase.write")),
):
    po = _get_po_or_404(db, po_id)
    if po.planning_operation_id is None:
        raise HTTPException(status_code=422, detail="Objednávka není navázaná na plánovací operaci.")
    if po.status not in {"received", "partially_received"}:
        raise HTTPException(status_code=422, detail="Kooperaci lze přijmout zpět až po příjmu objednávky.")
    op = receive_cooperation_operation(
        db,
        int(po.planning_operation_id),
        supplier_purchase_order_id=int(po.id),
        note=f"Přijato zpět přes dodavatelskou objednávku {po.po_no}.",
    )
    op.cooperation_supplier_purchase_order_id = int(po.id)
    db.commit()
    return _po_to_dict(_get_po_or_404(db, po_id), db, include_items=True)


@router.post("/supplier-purchase-orders/{po_id}/receive-item")
def receive_supplier_purchase_order_item(
    po_id: int,
    body: SupplierPurchaseOrderReceiveItemPayload,
    db: Session = Depends(get_db),
    _rbac: None = Depends(require_action("purchase.write")),
):
    po = _get_po_or_404(db, po_id)
    item = db.get(SupplierPurchaseOrderItem, int(body.item_id))
    if item is None or int(item.purchase_order_id) != int(po.id):
        raise HTTPException(status_code=404, detail="Položka objednávky nebyla nalezena.")
    if po.status == "cancelled":
        raise HTTPException(status_code=409, detail="Zrušenou objednávku nelze přijmout.")

    current_received = float(item.received_qty or 0)
    item_qty = float(item.qty or 0)
    receive_qty = float(body.received_qty)
    if current_received + receive_qty > item_qty + 1e-9:
        raise HTTPException(status_code=422, detail="Přijaté množství nesmí překročit objednané množství položky.")

    received_at = datetime.utcnow()
    item.received_qty = current_received + receive_qty
    item.received_at = received_at
    item.received_note = _clean_str(body.note) or item.received_note

    mode = body.mode.strip().lower()
    if mode == "material":
        _receive_material_item(db, po=po, item=item, body=body, received_at=received_at)
    elif mode == "cooperation":
        if po.planning_operation_id is None:
            raise HTTPException(status_code=422, detail="Kooperační příjem vyžaduje vazbu na plánovací operaci.")
        op = receive_cooperation_operation(
            db,
            int(po.planning_operation_id),
            supplier_purchase_order_id=int(po.id),
            note=_clean_str(body.note) or f"Vráceno z kooperace přes dodavatelskou objednávku {po.po_no}.",
            commit=False,
            rebuild=True,
        )
        op.cooperation_supplier_purchase_order_id = int(po.id)
    else:
        raise HTTPException(status_code=422, detail="Neplatný režim příjmu.")

    _update_receipt_status(po)
    db.flush()
    for movement in db.scalars(
        select(MaterialStockMovement).where(
            MaterialStockMovement.supplier_purchase_order_item_id == int(item.id),
            MaterialStockMovement.scan_code.is_(None),
        )
    ):
        movement.scan_code = material_stock_movement_scan_code_for_id(int(movement.id))
    db.commit()
    return _po_to_dict(_get_po_or_404(db, po_id), db, include_items=True)


@router.post("/supplier-purchase-orders/{po_id}/items")
def create_supplier_purchase_order_item(
    po_id: int,
    body: SupplierPurchaseOrderItemPayload,
    db: Session = Depends(get_db),
    _rbac: None = Depends(require_action("purchase.write")),
):
    po = _get_po_or_404(db, po_id)
    if body.rfq_item_id is not None and db.get(SupplierRfqItem, int(body.rfq_item_id)) is None:
        raise HTTPException(status_code=404, detail="Položka poptávky nebyla nalezena.")
    item = SupplierPurchaseOrderItem(purchase_order_id=int(po.id), item_name=body.item_name.strip(), qty=float(body.qty), unit=body.unit.strip())
    _apply_item_payload(item, body)
    db.add(item)
    db.commit()
    return _po_to_dict(_get_po_or_404(db, po_id), db, include_items=True)


@router.delete("/supplier-purchase-orders/{po_id}/items/{item_id}")
def delete_supplier_purchase_order_item(
    po_id: int,
    item_id: int,
    db: Session = Depends(get_db),
    _rbac: None = Depends(require_action("purchase.write")),
):
    _get_po_or_404(db, po_id)
    item = db.get(SupplierPurchaseOrderItem, int(item_id))
    if item is None or int(item.purchase_order_id) != int(po_id):
        raise HTTPException(status_code=404, detail="Položka objednávky nebyla nalezena.")
    db.delete(item)
    db.commit()
    return _po_to_dict(_get_po_or_404(db, po_id), db, include_items=True)


@router.put("/supplier-purchase-orders/{po_id}/items/{item_id}")
def update_supplier_purchase_order_item(
    po_id: int,
    item_id: int,
    body: SupplierPurchaseOrderItemPayload,
    db: Session = Depends(get_db),
    _rbac: None = Depends(require_action("purchase.write")),
):
    _get_po_or_404(db, po_id)
    item = db.get(SupplierPurchaseOrderItem, int(item_id))
    if item is None or int(item.purchase_order_id) != int(po_id):
        raise HTTPException(status_code=404, detail="Položka objednávky nebyla nalezena.")
    if body.rfq_item_id is not None and db.get(SupplierRfqItem, int(body.rfq_item_id)) is None:
        raise HTTPException(status_code=404, detail="Položka poptávky nebyla nalezena.")
    _apply_item_payload(item, body)
    db.commit()
    return _po_to_dict(_get_po_or_404(db, po_id), db, include_items=True)
