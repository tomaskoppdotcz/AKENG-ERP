"""API skladu materiálu — čisté modely MaterialStock*."""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, inspect as sa_inspect, select, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, joinedload

from app.core.database import get_db
from app.core.scan_code import material_stock_scan_code_for_id
from app.models.material_library import MaterialLibraryItem
from app.models.material_stock import (
    MaterialReservation,
    MaterialStockItem,
    MaterialStockMovement,
    MaterialStockReservation,
)

router = APIRouter()

ALLOWED_MOVEMENT_TYPES = frozenset({"prijem", "vydej", "korekce"})


def ensure_material_stock_sqlite_schema(engine: Engine) -> None:
    """SQLite: doplnění scan_code + traceability sloupců u material stock."""
    try:
        url = str(engine.url)
    except Exception:
        return
    if not url.startswith("sqlite"):
        return

    insp = sa_inspect(engine)
    if "material_stock_items" not in insp.get_table_names():
        return

    cols = {c["name"] for c in insp.get_columns("material_stock_items")}
    with engine.begin() as conn:
        if "scan_code" not in cols:
            conn.execute(text("ALTER TABLE material_stock_items ADD COLUMN scan_code VARCHAR(32)"))
        conn.execute(
            text("CREATE UNIQUE INDEX IF NOT EXISTS uq_material_stock_items_scan_code ON material_stock_items (scan_code)")
        )
    if "material_stock_movements" not in insp.get_table_names():
        return
    mv_cols = {c["name"] for c in insp.get_columns("material_stock_movements")}
    with engine.begin() as conn:
        if "scan_code" not in mv_cols:
            conn.execute(text("ALTER TABLE material_stock_movements ADD COLUMN scan_code VARCHAR(32)"))
        if "heat_lot" not in mv_cols:
            conn.execute(text("ALTER TABLE material_stock_movements ADD COLUMN heat_lot VARCHAR(120)"))
        if "length_per_piece_mm" not in mv_cols:
            conn.execute(text("ALTER TABLE material_stock_movements ADD COLUMN length_per_piece_mm FLOAT"))
        if "weight_per_piece_kg" not in mv_cols:
            conn.execute(text("ALTER TABLE material_stock_movements ADD COLUMN weight_per_piece_kg FLOAT"))
        if "production_order_id" not in mv_cols:
            conn.execute(text("ALTER TABLE material_stock_movements ADD COLUMN production_order_id INTEGER"))
        if "job_item_id" not in mv_cols:
            conn.execute(text("ALTER TABLE material_stock_movements ADD COLUMN job_item_id INTEGER"))
        conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_material_stock_movements_production_order_id "
                "ON material_stock_movements (production_order_id)"
            )
        )
        conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_material_stock_movements_job_item_id "
                "ON material_stock_movements (job_item_id)"
            )
        )
        conn.execute(
            text(
                "CREATE TABLE IF NOT EXISTS material_reservations ("
                "id INTEGER PRIMARY KEY, "
                "material_library_item_id INTEGER NOT NULL, "
                "job_item_id INTEGER NOT NULL, "
                "production_order_id INTEGER NOT NULL, "
                "required_qty FLOAT NOT NULL DEFAULT 0, "
                "reserved_qty FLOAT NOT NULL DEFAULT 0, "
                "status VARCHAR(20) NOT NULL DEFAULT 'planned', "
                "note VARCHAR(500) NULL, "
                "FOREIGN KEY(material_library_item_id) REFERENCES material_library_items (id)"
                ")"
            )
        )
        conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_material_reservations_material_library_item_id "
                "ON material_reservations (material_library_item_id)"
            )
        )
        conn.execute(
            text("CREATE INDEX IF NOT EXISTS ix_material_reservations_job_item_id ON material_reservations (job_item_id)")
        )
        conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_material_reservations_production_order_id "
                "ON material_reservations (production_order_id)"
            )
        )


def _stock_item_payload(row: MaterialStockItem) -> dict:
    lib = row.material_library_item
    group = lib.material_group if lib else None
    return {
        "id": row.id,
        "scan_code": row.scan_code,
        "material_library_item_id": row.material_library_item_id,
        "material_code": lib.code if lib else "",
        "material_name": lib.name if lib else "",
        "material_form": lib.form if lib else None,
        "material_group_id": group.id if group else None,
        "material_group_name": group.name if group else None,
        "location": row.location,
        "current_qty": row.current_qty,
        "min_qty": row.min_qty,
        "unit": row.unit,
        "note": row.note,
        "is_active": row.is_active,
    }


def _stock_item_list_payload(row: MaterialStockItem, reserved_qty: float = 0.0) -> dict:
    out = _stock_item_payload(row)
    r = float(reserved_qty)
    out["reserved_qty"] = r
    out["available_qty"] = row.current_qty - r
    return out


def _reserved_totals_by_stock_id(db: Session, stock_item_ids: list[int]) -> dict[int, float]:
    if not stock_item_ids:
        return {}
    rows = db.execute(
        select(
            MaterialStockReservation.stock_item_id,
            func.coalesce(func.sum(MaterialStockReservation.reserved_qty), 0.0),
        )
        .where(MaterialStockReservation.stock_item_id.in_(stock_item_ids))
        .group_by(MaterialStockReservation.stock_item_id)
    ).all()
    return {int(sid): float(total) for sid, total in rows}


def _reservation_payload(row: MaterialStockReservation) -> dict:
    return {
        "id": row.id,
        "job_item_id": row.job_item_id,
        "gpn": row.gpn,
        "reserved_qty": row.reserved_qty,
        "created_at": row.created_at,
        "note": row.note,
    }


def _movement_payload(row: MaterialStockMovement) -> dict:
    return {
        "id": row.id,
        "movement_type": row.movement_type,
        "qty": row.qty,
        "movement_date": row.movement_date,
        "scan_code": row.scan_code,
        "reference": row.reference,
        "heat_lot": row.heat_lot,
        "length_per_piece_mm": row.length_per_piece_mm,
        "weight_per_piece_kg": row.weight_per_piece_kg,
        "production_order_id": row.production_order_id,
        "job_item_id": row.job_item_id,
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
    scan_code: str | None = None
    reference: str | None = None
    heat_lot: str | None = None
    length_per_piece_mm: float | None = None
    weight_per_piece_kg: float | None = None
    production_order_id: int | None = None
    job_item_id: int | None = None
    note: str | None = None


class MovementUpdate(BaseModel):
    movement_type: str = Field(..., min_length=1)
    qty: float
    movement_date: datetime
    scan_code: str | None = None
    reference: str | None = None
    heat_lot: str | None = None
    length_per_piece_mm: float | None = None
    weight_per_piece_kg: float | None = None
    production_order_id: int | None = None
    job_item_id: int | None = None
    note: str | None = None


class ReservationCreate(BaseModel):
    stock_item_id: int
    job_item_id: int
    gpn: str | None = None
    reserved_qty: float
    note: str | None = None


class MaterialIssuePayload(BaseModel):
    reservation_id: int | None = None
    production_order_id: int | None = None
    material_library_item_id: int | None = None
    qty: float | None = None
    note: str | None = None


@router.get("/items")
def list_stock_items(db: Session = Depends(get_db)):
    rows = db.scalars(
        select(MaterialStockItem)
        .join(MaterialLibraryItem, MaterialStockItem.material_library_item_id == MaterialLibraryItem.id)
        .options(
            joinedload(MaterialStockItem.material_library_item).joinedload(MaterialLibraryItem.material_group)
        )
        .order_by(MaterialLibraryItem.name.asc())
    ).unique().all()
    stock_ids = [r.id for r in rows]
    reserved_map = _reserved_totals_by_stock_id(db, stock_ids)
    return [_stock_item_list_payload(r, reserved_map.get(r.id, 0.0)) for r in rows]


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
    db.flush()
    if not (row.scan_code and str(row.scan_code).strip()):
        row.scan_code = material_stock_scan_code_for_id(row.id)
    db.commit()
    row = db.scalar(
        select(MaterialStockItem)
        .where(MaterialStockItem.id == row.id)
        .options(
            joinedload(MaterialStockItem.material_library_item).joinedload(MaterialLibraryItem.material_group)
        )
    )
    reserved_map = _reserved_totals_by_stock_id(db, [row.id])
    return _stock_item_list_payload(row, reserved_map.get(row.id, 0.0))


@router.put("/items/{item_id}")
def update_stock_item(item_id: int, payload: StockItemUpdate, db: Session = Depends(get_db)):
    row = db.scalar(
        select(MaterialStockItem)
        .where(MaterialStockItem.id == item_id)
        .options(
            joinedload(MaterialStockItem.material_library_item).joinedload(MaterialLibraryItem.material_group)
        )
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
    reserved_map = _reserved_totals_by_stock_id(db, [row.id])
    return _stock_item_list_payload(row, reserved_map.get(row.id, 0.0))


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


@router.get("/items/{item_id}/reservations")
def list_stock_reservations(item_id: int, db: Session = Depends(get_db)):
    stock = db.scalar(select(MaterialStockItem).where(MaterialStockItem.id == item_id))
    if not stock:
        raise HTTPException(status_code=404, detail="Stock item not found")

    rows = db.scalars(
        select(MaterialStockReservation)
        .where(MaterialStockReservation.stock_item_id == item_id)
        .order_by(MaterialStockReservation.created_at.desc(), MaterialStockReservation.id.desc())
    ).all()
    return [_reservation_payload(r) for r in rows]


@router.post("/reservations")
def create_reservation(payload: ReservationCreate, db: Session = Depends(get_db)):
    stock = db.scalar(select(MaterialStockItem).where(MaterialStockItem.id == payload.stock_item_id))
    if not stock:
        raise HTTPException(status_code=404, detail="Stock item not found")
    if payload.reserved_qty <= 0:
        raise HTTPException(status_code=422, detail="reserved_qty must be greater than 0")

    gpn_val = payload.gpn.strip() if payload.gpn else None
    row = MaterialStockReservation(
        stock_item_id=payload.stock_item_id,
        job_item_id=payload.job_item_id,
        gpn=gpn_val,
        reserved_qty=payload.reserved_qty,
        created_at=datetime.now(timezone.utc),
        note=payload.note,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _reservation_payload(row)


@router.delete("/reservations/{reservation_id}")
def delete_reservation(reservation_id: int, db: Session = Depends(get_db)):
    row = db.scalar(select(MaterialStockReservation).where(MaterialStockReservation.id == reservation_id))
    if not row:
        raise HTTPException(status_code=404, detail="Reservation not found")
    db.delete(row)
    db.commit()
    return {"status": "ok"}


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

    delta = _movement_delta(mtype, payload.qty)

    movement = MaterialStockMovement(
        stock_item_id=item_id,
        movement_type=mtype,
        qty=payload.qty,
        movement_date=payload.movement_date,
        scan_code=(payload.scan_code.strip() if payload.scan_code else None),
        reference=payload.reference,
        heat_lot=(payload.heat_lot.strip() if payload.heat_lot else None),
        length_per_piece_mm=payload.length_per_piece_mm,
        weight_per_piece_kg=payload.weight_per_piece_kg,
        production_order_id=payload.production_order_id,
        job_item_id=payload.job_item_id,
        note=payload.note,
    )
    db.add(movement)
    stock.current_qty = stock.current_qty + delta
    db.commit()
    db.refresh(movement)
    return _movement_payload(movement)


@router.put("/movements/{movement_id}")
def update_movement(movement_id: int, payload: MovementUpdate, db: Session = Depends(get_db)):
    movement = db.scalar(select(MaterialStockMovement).where(MaterialStockMovement.id == movement_id))
    if not movement:
        raise HTTPException(status_code=404, detail="Movement not found")
    stock = db.scalar(select(MaterialStockItem).where(MaterialStockItem.id == movement.stock_item_id))
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

    old_delta = _movement_delta(movement.movement_type, movement.qty)
    new_delta = _movement_delta(mtype, payload.qty)
    stock.current_qty = stock.current_qty - old_delta + new_delta

    movement.movement_type = mtype
    movement.qty = payload.qty
    movement.movement_date = payload.movement_date
    movement.scan_code = payload.scan_code.strip() if payload.scan_code else None
    movement.reference = payload.reference
    movement.heat_lot = payload.heat_lot.strip() if payload.heat_lot else None
    movement.length_per_piece_mm = payload.length_per_piece_mm
    movement.weight_per_piece_kg = payload.weight_per_piece_kg
    movement.production_order_id = payload.production_order_id
    movement.job_item_id = payload.job_item_id
    movement.note = payload.note
    db.commit()
    db.refresh(movement)
    return _movement_payload(movement)


@router.delete("/movements/{movement_id}")
def delete_movement(movement_id: int, db: Session = Depends(get_db)):
    movement = db.scalar(select(MaterialStockMovement).where(MaterialStockMovement.id == movement_id))
    if not movement:
        raise HTTPException(status_code=404, detail="Movement not found")
    stock = db.scalar(select(MaterialStockItem).where(MaterialStockItem.id == movement.stock_item_id))
    if not stock:
        raise HTTPException(status_code=404, detail="Stock item not found")
    stock.current_qty = stock.current_qty - _movement_delta(movement.movement_type, movement.qty)
    db.delete(movement)
    db.commit()
    return {"status": "ok"}


@router.post("/issue")
@router.post("/material/issue")
def issue_material(payload: MaterialIssuePayload, db: Session = Depends(get_db)):
    reservation: MaterialReservation | None = None
    if payload.reservation_id is not None:
        reservation = db.get(MaterialReservation, int(payload.reservation_id))
    else:
        if payload.production_order_id is None or payload.material_library_item_id is None:
            raise HTTPException(
                status_code=422,
                detail="Provide reservation_id or both production_order_id and material_library_item_id.",
            )
        reservation = db.scalars(
            select(MaterialReservation)
            .where(
                MaterialReservation.production_order_id == int(payload.production_order_id),
                MaterialReservation.material_library_item_id == int(payload.material_library_item_id),
                MaterialReservation.status != "issued",
            )
            .order_by(MaterialReservation.id.asc())
        ).first()
    if reservation is None:
        raise HTTPException(status_code=404, detail="Material reservation not found.")

    issue_qty = float(payload.qty if payload.qty is not None else reservation.reserved_qty)
    if issue_qty <= 0:
        raise HTTPException(status_code=422, detail="qty must be greater than 0")

    stock = db.scalars(
        select(MaterialStockItem)
        .where(MaterialStockItem.material_library_item_id == int(reservation.material_library_item_id))
        .order_by(MaterialStockItem.current_qty.desc(), MaterialStockItem.id.asc())
    ).first()
    if stock is None:
        raise HTTPException(status_code=404, detail="No material stock item found for reserved material.")
    if float(stock.current_qty or 0) < issue_qty:
        raise HTTPException(status_code=409, detail="Insufficient stock quantity for issue.")

    movement = MaterialStockMovement(
        stock_item_id=int(stock.id),
        movement_type="vydej",
        qty=issue_qty,
        movement_date=datetime.now(timezone.utc),
        reference=f"RES-{reservation.id}",
        production_order_id=int(reservation.production_order_id),
        job_item_id=int(reservation.job_item_id),
        note=(payload.note.strip() if payload.note else reservation.note),
    )
    db.add(movement)
    stock.current_qty = float(stock.current_qty or 0) - issue_qty
    reservation.status = "issued"
    reservation.reserved_qty = issue_qty
    if payload.note:
        reservation.note = payload.note.strip() or reservation.note
    db.commit()
    db.refresh(movement)
    return {
        "status": "ok",
        "reservation_id": int(reservation.id),
        "issued_qty": issue_qty,
        "movement": _movement_payload(movement),
    }
