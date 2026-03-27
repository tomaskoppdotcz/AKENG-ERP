"""API skladu výrobků (hotové výrobky z portfolia)."""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, inspect as sa_inspect, select, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, joinedload

from app.core.database import get_db
from app.core.scan_code import product_stock_scan_code_for_id
from app.models.portfolio import PortfolioItem
from app.models.product_stock import ProductStockItem, ProductStockMovement

router = APIRouter()

ALLOWED_MOVEMENT_TYPES = frozenset({"prijem", "vydej", "korekce"})


def ensure_product_stock_sqlite_schema(engine: Engine) -> None:
    """SQLite: doplnění scan_code a tabulky příjmů hotových výrobků."""
    try:
        url = str(engine.url)
    except Exception:
        return
    if not url.startswith("sqlite"):
        return

    insp = sa_inspect(engine)
    if "product_stock_items" not in insp.get_table_names():
        return

    cols = {c["name"] for c in insp.get_columns("product_stock_items")}
    with engine.begin() as conn:
        if "scan_code" not in cols:
            conn.execute(text("ALTER TABLE product_stock_items ADD COLUMN scan_code VARCHAR(32)"))
        conn.execute(
            text(
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_product_stock_items_scan_code ON product_stock_items (scan_code)"
            )
        )
        conn.execute(
            text(
                "CREATE TABLE IF NOT EXISTS product_stock_receipts ("
                "id INTEGER PRIMARY KEY, "
                "product_stock_item_id INTEGER NOT NULL, "
                "production_order_id INTEGER NULL, "
                "qty_received FLOAT NOT NULL, "
                "received_at DATETIME NOT NULL, "
                "note VARCHAR(500) NULL, "
                "FOREIGN KEY(product_stock_item_id) REFERENCES product_stock_items (id), "
                "FOREIGN KEY(production_order_id) REFERENCES production_orders (id)"
                ")"
            )
        )
        conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_product_stock_receipts_product_stock_item_id "
                "ON product_stock_receipts (product_stock_item_id)"
            )
        )
        conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_product_stock_receipts_production_order_id "
                "ON product_stock_receipts (production_order_id)"
            )
        )
        conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_product_stock_receipts_received_at "
                "ON product_stock_receipts (received_at)"
            )
        )


def _item_payload(row: ProductStockItem) -> dict:
    p = row.portfolio_item
    cust = p.customer if p else None
    return {
        "id": row.id,
        "portfolio_item_id": row.portfolio_item_id,
        "portfolio_gpn": p.gpn if p else "",
        "portfolio_name": p.name if p else "",
        "portfolio_customer_name": cust.name if cust else None,
        "location": row.location,
        "current_qty": row.current_qty,
        "min_qty": row.min_qty,
        "unit": row.unit,
        "note": row.note,
        "is_active": row.is_active,
        "scan_code": row.scan_code,
    }


def _movement_payload(row: ProductStockMovement) -> dict:
    return {
        "id": row.id,
        "movement_type": row.movement_type,
        "qty": row.qty,
        "movement_date": row.movement_date,
        "reference": row.reference,
        "note": row.note,
    }


def _normalize_location(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip()
    return normalized or None


def _movement_delta(movement_type: str, qty: float) -> float:
    if movement_type == "prijem":
        return qty
    if movement_type == "vydej":
        return -qty
    return qty


class ProductStockItemCreate(BaseModel):
    portfolio_item_id: int
    location: str | None = None
    current_qty: float = 0
    min_qty: float | None = None
    unit: str | None = None
    note: str | None = None
    is_active: bool = True


class ProductStockItemUpdate(BaseModel):
    location: str | None = None
    current_qty: float | None = None
    min_qty: float | None = None
    unit: str | None = None
    note: str | None = None
    is_active: bool | None = None


class ProductStockMovementCreate(BaseModel):
    movement_type: str = Field(..., min_length=1)
    qty: float
    movement_date: datetime
    reference: str | None = None
    note: str | None = None


class ProductStockMovementUpdate(BaseModel):
    movement_type: str | None = None
    qty: float | None = None
    movement_date: datetime | None = None
    reference: str | None = None
    note: str | None = None


@router.get("/items")
def list_product_stock_items(db: Session = Depends(get_db)):
    rows = db.scalars(
        select(ProductStockItem)
        .join(PortfolioItem, ProductStockItem.portfolio_item_id == PortfolioItem.id)
        .options(joinedload(ProductStockItem.portfolio_item).joinedload(PortfolioItem.customer))
        .order_by(PortfolioItem.name.asc())
    ).unique().all()
    return [_item_payload(r) for r in rows]


@router.post("/items")
def create_product_stock_item(payload: ProductStockItemCreate, db: Session = Depends(get_db)):
    portfolio = db.scalar(select(PortfolioItem).where(PortfolioItem.id == payload.portfolio_item_id))
    if not portfolio:
        raise HTTPException(status_code=404, detail="Portfolio položka nebyla nalezena.")

    normalized_location = _normalize_location(payload.location)
    duplicate = db.scalar(
        select(ProductStockItem).where(
            ProductStockItem.portfolio_item_id == payload.portfolio_item_id,
            func.coalesce(func.trim(ProductStockItem.location), "") == (normalized_location or ""),
        )
    )
    if duplicate:
        raise HTTPException(
            status_code=409,
            detail="Skladová karta pro tuto portfolio položku a lokaci už existuje.",
        )

    unit_val = (payload.unit or "").strip() or "ks"
    row = ProductStockItem(
        portfolio_item_id=payload.portfolio_item_id,
        location=normalized_location,
        current_qty=payload.current_qty,
        min_qty=payload.min_qty,
        unit=unit_val,
        note=payload.note,
        is_active=payload.is_active,
    )
    db.add(row)
    db.flush()
    if not (row.scan_code and str(row.scan_code).strip()):
        row.scan_code = product_stock_scan_code_for_id(row.id)
    db.commit()
    row = db.scalar(
        select(ProductStockItem)
        .where(ProductStockItem.id == row.id)
        .options(joinedload(ProductStockItem.portfolio_item).joinedload(PortfolioItem.customer))
    )
    return _item_payload(row)


@router.put("/items/{item_id}")
def update_product_stock_item(item_id: int, payload: ProductStockItemUpdate, db: Session = Depends(get_db)):
    row = db.scalar(
        select(ProductStockItem)
        .where(ProductStockItem.id == item_id)
        .options(joinedload(ProductStockItem.portfolio_item).joinedload(PortfolioItem.customer))
    )
    if not row:
        raise HTTPException(status_code=404, detail="Skladová karta nebyla nalezena.")

    data = payload.model_dump(exclude_unset=True)
    if "location" in data:
        row.location = data["location"]
    if "current_qty" in data:
        row.current_qty = data["current_qty"]
    if "min_qty" in data:
        row.min_qty = data["min_qty"]
    if "unit" in data:
        u = data["unit"]
        if u is None:
            row.unit = "ks"
        else:
            row.unit = str(u).strip() or "ks"
    if "note" in data:
        row.note = data["note"]
    if "is_active" in data:
        row.is_active = data["is_active"]

    db.commit()
    db.refresh(row)
    row = db.scalar(
        select(ProductStockItem)
        .where(ProductStockItem.id == item_id)
        .options(joinedload(ProductStockItem.portfolio_item).joinedload(PortfolioItem.customer))
    )
    return _item_payload(row)


@router.delete("/items/{item_id}")
def delete_product_stock_item(item_id: int, db: Session = Depends(get_db)):
    row = db.scalar(select(ProductStockItem).where(ProductStockItem.id == item_id))
    if not row:
        raise HTTPException(status_code=404, detail="Skladová karta nebyla nalezena.")
    db.delete(row)
    db.commit()
    return {"status": "ok"}


@router.get("/items/{item_id}/movements")
def list_movements(item_id: int, db: Session = Depends(get_db)):
    stock = db.scalar(select(ProductStockItem).where(ProductStockItem.id == item_id))
    if not stock:
        raise HTTPException(status_code=404, detail="Skladová karta nebyla nalezena.")

    rows = db.scalars(
        select(ProductStockMovement)
        .where(ProductStockMovement.stock_item_id == item_id)
        .order_by(ProductStockMovement.movement_date.desc(), ProductStockMovement.id.desc())
    ).all()
    return [_movement_payload(r) for r in rows]


@router.post("/items/{item_id}/movements")
def create_movement(item_id: int, payload: ProductStockMovementCreate, db: Session = Depends(get_db)):
    stock = db.scalar(select(ProductStockItem).where(ProductStockItem.id == item_id))
    if not stock:
        raise HTTPException(status_code=404, detail="Skladová karta nebyla nalezena.")

    mtype = payload.movement_type.strip().lower()
    if mtype not in ALLOWED_MOVEMENT_TYPES:
        raise HTTPException(
            status_code=422,
            detail="movement_type musí být: prijem, vydej, korekce",
        )
    if payload.qty <= 0:
        raise HTTPException(status_code=422, detail="qty musí být větší než 0")

    delta = _movement_delta(mtype, payload.qty)
    movement = ProductStockMovement(
        stock_item_id=item_id,
        movement_type=mtype,
        qty=payload.qty,
        movement_date=payload.movement_date,
        reference=payload.reference,
        note=payload.note,
    )
    db.add(movement)
    stock.current_qty = stock.current_qty + delta
    db.commit()
    db.refresh(movement)
    return _movement_payload(movement)


@router.put("/movements/{movement_id}")
def update_movement(movement_id: int, payload: ProductStockMovementUpdate, db: Session = Depends(get_db)):
    movement = db.scalar(select(ProductStockMovement).where(ProductStockMovement.id == movement_id))
    if not movement:
        raise HTTPException(status_code=404, detail="Pohyb nebyl nalezen.")
    stock = db.scalar(select(ProductStockItem).where(ProductStockItem.id == movement.stock_item_id))
    if not stock:
        raise HTTPException(status_code=404, detail="Skladová karta nebyla nalezena.")

    data = payload.model_dump(exclude_unset=True)
    if not data:
        return _movement_payload(movement)

    mtype_new = movement.movement_type
    if "movement_type" in data and data["movement_type"] is not None:
        mtype_new = str(data["movement_type"]).strip().lower()
    if mtype_new not in ALLOWED_MOVEMENT_TYPES:
        raise HTTPException(
            status_code=422,
            detail="movement_type musí být: prijem, vydej, korekce",
        )

    qty_new = movement.qty
    if "qty" in data and data["qty"] is not None:
        qty_new = float(data["qty"])
    if qty_new <= 0:
        raise HTTPException(status_code=422, detail="qty musí být větší než 0")

    date_new = movement.movement_date
    if "movement_date" in data and data["movement_date"] is not None:
        date_new = data["movement_date"]

    old_delta = _movement_delta(movement.movement_type, movement.qty)
    new_delta = _movement_delta(mtype_new, qty_new)
    stock.current_qty = stock.current_qty - old_delta + new_delta

    movement.movement_type = mtype_new
    movement.qty = qty_new
    movement.movement_date = date_new
    if "reference" in data:
        movement.reference = data["reference"]
    if "note" in data:
        movement.note = data["note"]

    db.commit()
    db.refresh(movement)
    return _movement_payload(movement)


@router.delete("/movements/{movement_id}")
def delete_movement(movement_id: int, db: Session = Depends(get_db)):
    movement = db.scalar(select(ProductStockMovement).where(ProductStockMovement.id == movement_id))
    if not movement:
        raise HTTPException(status_code=404, detail="Pohyb nebyl nalezen.")
    stock = db.scalar(select(ProductStockItem).where(ProductStockItem.id == movement.stock_item_id))
    if not stock:
        raise HTTPException(status_code=404, detail="Skladová karta nebyla nalezena.")
    stock.current_qty = stock.current_qty - _movement_delta(movement.movement_type, movement.qty)
    db.delete(movement)
    db.commit()
    return {"status": "ok"}
