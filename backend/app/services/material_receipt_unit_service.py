"""
Material receipt units: per-prijem lot tracking and FIFO consumption on reserved issue (vydej).

Stock totals (MaterialStockItem.current_qty) remain authoritative; this layer is additive.
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.material_stock import MaterialReceiptUnit, MaterialStockItem, MaterialStockMovement
from app.services.material_issue_allocation_engine import ReceiptUnitSnapshot

# Status values (no DB enum — matches existing string status pattern)
MRU_STATUS_ACTIVE = "active"
MRU_STATUS_CONSUMED = "consumed"
MRU_STATUS_WRITTEN_OFF = "written_off"


def _sync_mru_status(unit: MaterialReceiptUnit) -> None:
    st = str(unit.status or "").strip().lower()
    if st == MRU_STATUS_WRITTEN_OFF:
        return
    rem = float(unit.remaining_qty or 0)
    if rem <= 1e-9:
        unit.remaining_qty = 0.0
        unit.status = MRU_STATUS_CONSUMED
    else:
        unit.status = MRU_STATUS_ACTIVE


def create_receipt_unit_for_prijem(
    db: Session,
    *,
    stock: MaterialStockItem,
    received_qty: float,
    uom: str | None,
    heat_lot: str | None,
    certificate_no: str | None,
    delivery_note_no: str | None,
    invoice_no: str | None,
    supplier_name: str | None,
    received_at,
    supplier_batch: str | None = None,
) -> MaterialReceiptUnit:
    q = float(received_qty)
    unit = MaterialReceiptUnit(
        stock_item_id=int(stock.id),
        received_qty=q,
        remaining_qty=q,
        uom=uom,
        heat_lot=heat_lot,
        supplier_batch=supplier_batch,
        certificate_no=certificate_no,
        delivery_note_no=delivery_note_no,
        invoice_no=invoice_no,
        supplier_name=supplier_name,
        received_at=received_at,
        status=MRU_STATUS_ACTIVE,
    )
    db.add(unit)
    db.flush()
    _sync_mru_status(unit)
    return unit


def load_fifo_receipt_units(db: Session, stock_item_id: int) -> list[MaterialReceiptUnit]:
    return list(
        db.scalars(
            select(MaterialReceiptUnit)
            .where(
                MaterialReceiptUnit.stock_item_id == int(stock_item_id),
                MaterialReceiptUnit.remaining_qty > 1e-9,
                MaterialReceiptUnit.status == MRU_STATUS_ACTIVE,
            )
            .order_by(MaterialReceiptUnit.received_at.asc(), MaterialReceiptUnit.id.asc())
        ).all()
    )


def load_fifo_receipt_units_for_material(db: Session, material_library_item_id: int) -> list[MaterialReceiptUnit]:
    """FIFO across all inventory cards for one catalog material."""
    return list(
        db.scalars(
            select(MaterialReceiptUnit)
            .join(MaterialStockItem, MaterialStockItem.id == MaterialReceiptUnit.stock_item_id)
            .where(
                MaterialStockItem.material_library_item_id == int(material_library_item_id),
                MaterialReceiptUnit.remaining_qty > 1e-9,
                MaterialReceiptUnit.status == MRU_STATUS_ACTIVE,
            )
            .order_by(MaterialReceiptUnit.received_at.asc(), MaterialReceiptUnit.id.asc())
        ).all()
    )


def receipt_unit_rows_to_engine_snapshots(units: list[MaterialReceiptUnit]) -> list[ReceiptUnitSnapshot]:
    return [
        ReceiptUnitSnapshot(
            id=int(u.id),
            remaining_qty=float(u.remaining_qty or 0.0),
            received_at=u.received_at,
            heat_lot=u.heat_lot,
            certificate_no=u.certificate_no,
            delivery_note_no=u.delivery_note_no,
        )
        for u in units
    ]


def apply_fifo_decrement_for_vydej(
    db: Session, stock_item_id: int, need_qty: float, movement_builder
) -> list[MaterialStockMovement]:
    """
    movement_builder(allocated_qty: float, unit: MaterialReceiptUnit | None) -> MaterialStockMovement
    (caller adds each movement to session and sets scan_code after flush.)
    """
    need = float(need_qty)
    out: list[MaterialStockMovement] = []
    if need <= 1e-9:
        return out

    units = load_fifo_receipt_units(db, stock_item_id)
    for u in units:
        if need <= 1e-9:
            break
        u_rem = float(u.remaining_qty or 0)
        if u_rem <= 1e-9:
            continue
        take = min(need, u_rem)
        u.remaining_qty = u_rem - take
        _sync_mru_status(u)
        m = movement_builder(take, u)
        out.append(m)
        need -= take

    if need > 1e-6:
        m = movement_builder(need, None)
        out.append(m)

    return out


def restore_remaining_after_vydej_delete(db: Session, movement: MaterialStockMovement) -> None:
    """Call when deleting a vydej that consumed from a receipt unit."""
    ruid = getattr(movement, "receipt_unit_id", None)
    if ruid is None:
        return
    unit = db.get(MaterialReceiptUnit, int(ruid))
    if unit is None:
        return
    qty = float(movement.qty or 0)
    unit.remaining_qty = float(unit.remaining_qty or 0) + qty
    _sync_mru_status(unit)


def apply_storno_add_back_to_receipt_unit(db: Session, issue_mv: MaterialStockMovement) -> None:
    """Compensating storno_vydeje: return quantity to the same receipt unit as the original issue."""
    ruid = getattr(issue_mv, "receipt_unit_id", None)
    if ruid is None:
        return
    unit = db.get(MaterialReceiptUnit, int(ruid))
    if unit is None:
        return
    qty = float(issue_mv.qty or 0)
    unit.remaining_qty = float(unit.remaining_qty or 0) + qty
    _sync_mru_status(unit)


def release_receipt_unit_if_prijem_deleted(
    db: Session, movement: MaterialStockMovement, delete_error_detail: str
) -> None:
    """
    Before deleting a prijem movement: only allow if the linked lot was not consumed (FIFO).
    If allowed, drop the receipt unit row (movements referencing it are nulled via ORM / DB).
    """
    from fastapi import HTTPException

    ruid = getattr(movement, "receipt_unit_id", None)
    if ruid is None:
        return
    unit = db.get(MaterialReceiptUnit, int(ruid))
    if unit is None:
        return
    rec = float(unit.received_qty or 0)
    rem = float(unit.remaining_qty or 0)
    if rec - rem > 1e-6:
        raise HTTPException(status_code=409, detail=delete_error_detail)
    # Clear FK from any movement still pointing at this lot (the opening prijem, etc.)
    others = db.scalars(
        select(MaterialStockMovement).where(MaterialStockMovement.receipt_unit_id == int(ruid))
    ).all()
    for om in others:
        om.receipt_unit_id = None
    db.delete(unit)
    db.flush()
    movement.receipt_unit_id = None


def reverse_storno_effect_on_receipt_unit_delete(db: Session, storno_mv: MaterialStockMovement) -> None:
    """Deleting a storno_vydeje that had receipt_unit_id removes stock again from the lot."""
    ruid = getattr(storno_mv, "receipt_unit_id", None)
    if ruid is None:
        return
    unit = db.get(MaterialReceiptUnit, int(ruid))
    if unit is None:
        return
    qty = float(storno_mv.qty or 0)
    unit.remaining_qty = max(0.0, float(unit.remaining_qty or 0) - qty)
    _sync_mru_status(unit)
