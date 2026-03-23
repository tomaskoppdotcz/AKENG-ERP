"""API skladu materiálu — čisté modely MaterialStock*."""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload

from app.core.database import get_db
from app.models.material_library import MaterialLibraryItem
from app.models.material_stock import MaterialStockItem, MaterialStockMovement

router = APIRouter()

ALLOWED_MOVEMENT_TYPES = frozenset({"prijem", "vydej", "korekce"})


def _stock_item_payload(row: MaterialStockItem) -> dict:
    lib = row.material_library_item
    return {
        "id": row.id,
        "material_library_item_id": row.material_library_item_id,
        "material_code": lib.code if lib else "",
        "material_name": lib.name if lib else "",
        "location": row.location,
        "current_qty": row.current_qty,
        "min_qty": row.min_qty,
        "unit": row.unit,
        "note": row.note,
        "is_active": row.is_active,
    }


def _stock_item_list_payload(row: MaterialStockItem) -> dict:
    d = _stock_item_payload(row)
    return {k: v for k, v in d.items() if k != "note"}


def _movement_payload(row: MaterialStockMovement) -> dict:
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


class StockItemCreate(BaseModel):
    material_library_item_id: int
    location: str | None = None
    current_qty: float = 0
    min_qty: float | None = None
    unit: str | None = None
    note: str | None = None
    is_active: bool = True


class StockItemUpdate(BaseModel):
    location: str | None = None
    current_qty: float | None = None
    min_qty: float | None = None
    unit: str | None = None
    note: str | None = None
    is_active: bool | None = None


class MovementCreate(BaseModel):
    movement_type: str = Field(..., min_length=1)
    qty: float
    movement_date: datetime
    reference: str | None = None
    note: str | None = None


@router.get("/items")
def list_stock_items(db: Session = Depends(get_db)):
    rows = db.scalars(
        select(MaterialStockItem)
        .join(MaterialLibraryItem, MaterialStockItem.material_library_item_id == MaterialLibraryItem.id)
        .options(joinedload(MaterialStockItem.material_library_item))
        .order_by(MaterialLibraryItem.name.asc())
    ).unique().all()
    return [_stock_item_list_payload(r) for r in rows]


@router.post("/items")
def create_stock_item(payload: StockItemCreate, db: Session = Depends(get_db)):
    material = db.scalar(select(MaterialLibraryItem).where(MaterialLibraryItem.id == payload.material_library_item_id))
    if not material:
        raise HTTPException(status_code=404, detail="Material library item not found")

    normalized_location = _normalize_location(payload.location)
    duplicate = db.scalar(
        select(MaterialStockItem).where(
            MaterialStockItem.material_library_item_id == payload.material_library_item_id,
            func.coalesce(func.trim(MaterialStockItem.location), "") == (normalized_location or ""),
        )
    )
    if duplicate:
        raise HTTPException(
            status_code=409,
            detail="Skladová karta pro tento materiál a lokaci už existuje.",
        )

    row = MaterialStockItem(
        material_library_item_id=payload.material_library_item_id,
        location=normalized_location,
        current_qty=payload.current_qty,
        min_qty=payload.min_qty,
        unit=payload.unit,
        note=payload.note,
        is_active=payload.is_active,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    row = db.scalar(
        select(MaterialStockItem)
        .where(MaterialStockItem.id == row.id)
        .options(joinedload(MaterialStockItem.material_library_item))
    )
    return _stock_item_list_payload(row)


@router.put("/items/{item_id}")
def update_stock_item(item_id: int, payload: StockItemUpdate, db: Session = Depends(get_db)):
    row = db.scalar(
        select(MaterialStockItem)
        .where(MaterialStockItem.id == item_id)
        .options(joinedload(MaterialStockItem.material_library_item))
    )
    if not row:
        raise HTTPException(status_code=404, detail="Stock item not found")

    data = payload.model_dump(exclude_unset=True)
    if "location" in data:
        row.location = data["location"]
    if "current_qty" in data:
        row.current_qty = data["current_qty"]
    if "min_qty" in data:
        row.min_qty = data["min_qty"]
    if "unit" in data:
        row.unit = data["unit"]
    if "note" in data:
        row.note = data["note"]
    if "is_active" in data:
        row.is_active = data["is_active"]

    db.commit()
    db.refresh(row)
    return _stock_item_list_payload(row)


@router.delete("/items/{item_id}")
def delete_stock_item(item_id: int, db: Session = Depends(get_db)):
    row = db.scalar(select(MaterialStockItem).where(MaterialStockItem.id == item_id))
    if not row:
        raise HTTPException(status_code=404, detail="Stock item not found")
    db.delete(row)
    db.commit()
    return {"status": "ok"}


@router.get("/items/{item_id}/movements")
def list_movements(item_id: int, db: Session = Depends(get_db)):
    stock = db.scalar(select(MaterialStockItem).where(MaterialStockItem.id == item_id))
    if not stock:
        raise HTTPException(status_code=404, detail="Stock item not found")

    rows = db.scalars(
        select(MaterialStockMovement)
        .where(MaterialStockMovement.stock_item_id == item_id)
        .order_by(MaterialStockMovement.movement_date.desc(), MaterialStockMovement.id.desc())
    ).all()
    return [_movement_payload(r) for r in rows]


@router.post("/items/{item_id}/movements")
def create_movement(item_id: int, payload: MovementCreate, db: Session = Depends(get_db)):
    stock = db.scalar(select(MaterialStockItem).where(MaterialStockItem.id == item_id))
    if not stock:
        raise HTTPException(status_code=404, detail="Stock item not found")

    mtype = payload.movement_type.strip().lower()
    if mtype not in ALLOWED_MOVEMENT_TYPES:
        raise HTTPException(
            status_code=422,
            detail="movement_type must be one of: prijem, vydej, korekce",
        )
    if payload.qty <= 0:
        raise HTTPException(status_code=422, detail="qty must be greater than 0")

    if mtype == "prijem":
        delta = payload.qty
    elif mtype == "vydej":
        delta = -payload.qty
    else:
        delta = payload.qty

    movement = MaterialStockMovement(
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
