"""Návrh skladové karty a tavby pro výdej materiálu (FIFO = nejstarší příjem na kartě)."""

from __future__ import annotations

from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.material_stock import MaterialStockItem, MaterialStockMovement, MaterialStockReservation


def reserved_totals_for_stock_items(
    db: Session,
    stock_item_ids: list[int],
    *,
    exclude_job_item_id: int | None = None,
) -> dict[int, float]:
    """Součet material_stock_reservations na kartě. Volitelně vynechá řádky dané položky zakázky (výdej pro vlastní VP)."""
    if not stock_item_ids:
        return {}
    stmt = (
        select(
            MaterialStockReservation.stock_item_id,
            func.coalesce(func.sum(MaterialStockReservation.reserved_qty), 0.0),
        )
        .where(MaterialStockReservation.stock_item_id.in_(stock_item_ids))
    )
    if exclude_job_item_id is not None:
        stmt = stmt.where(MaterialStockReservation.job_item_id != int(exclude_job_item_id))
    rows = db.execute(stmt.group_by(MaterialStockReservation.stock_item_id)).all()
    return {int(sid): float(total) for sid, total in rows}


def oldest_prijem_movement(db: Session, stock_item_id: int) -> MaterialStockMovement | None:
    return db.scalars(
        select(MaterialStockMovement)
        .where(
            MaterialStockMovement.stock_item_id == int(stock_item_id),
            MaterialStockMovement.movement_type == "prijem",
        )
        .order_by(MaterialStockMovement.movement_date.asc(), MaterialStockMovement.id.asc())
    ).first()


def available_qty_for_stock_item(
    db: Session,
    stock_item_id: int,
    *,
    exclude_job_item_id: int | None = None,
) -> float:
    s = db.get(MaterialStockItem, int(stock_item_id))
    if s is None:
        return 0.0
    m = reserved_totals_for_stock_items(db, [int(s.id)], exclude_job_item_id=exclude_job_item_id)
    return max(0.0, float(s.current_qty or 0) - float(m.get(int(s.id), 0.0)))


def resolve_issue_heat_lot(db: Session, stock_item_id: int, payload_heat_lot: str | None) -> str | None:
    if payload_heat_lot is not None and str(payload_heat_lot).strip():
        return str(payload_heat_lot).strip()
    op = oldest_prijem_movement(db, int(stock_item_id))
    if op and op.heat_lot and str(op.heat_lot).strip():
        return str(op.heat_lot).strip()
    return None


def propose_material_issue_source(
    db: Session,
    material_library_item_id: int,
    qty_needed: float,
    *,
    exclude_job_item_id: int | None = None,
) -> dict[str, Any] | None:
    """
    Vybere skladovou kartu stejného materiálu s kladným dostupným množstvím
    (stav − rezervace ostatních zakázek; vlastní job_item se pro výdej neodečítá)
    a preferuje kartu s nejstarším příjmem (FIFO / tavba). Bez příjmu na kartě
    stále navrhne kartu, pokud je na ní fyzicky dostatek.
    """
    qty_needed = max(0.0, float(qty_needed))
    stocks = db.scalars(
        select(MaterialStockItem)
        .where(
            MaterialStockItem.material_library_item_id == int(material_library_item_id),
            MaterialStockItem.is_active.is_(True),
        )
        .order_by(MaterialStockItem.id.asc())
    ).all()
    if not stocks:
        return None

    ids = [int(s.id) for s in stocks]
    reserved_map = reserved_totals_for_stock_items(db, ids, exclude_job_item_id=exclude_job_item_id)

    ranked: list[tuple[tuple, MaterialStockItem, float, MaterialStockMovement | None]] = []
    for s in stocks:
        cur = float(s.current_qty or 0)
        res = float(reserved_map.get(int(s.id), 0.0))
        avail = max(0.0, cur - res)
        if avail <= 1e-9:
            continue
        op = oldest_prijem_movement(db, int(s.id))
        if op is not None:
            sort_key = (0, op.movement_date, op.id, int(s.id))
        else:
            sort_key = (1, int(s.id))
        ranked.append((sort_key, s, avail, op))

    if not ranked:
        return None

    ranked.sort(key=lambda x: x[0])
    _, stock, available_qty, op = ranked[0]
    heat = (op.heat_lot or "").strip() if op and op.heat_lot else None
    suggested = min(qty_needed, available_qty) if qty_needed > 0 else available_qty
    strategy = "fifo_oldest_prijem" if op is not None else "stock_card_no_receipt"

    return {
        "stock_item_id": int(stock.id),
        "scan_code": stock.scan_code,
        "location": stock.location,
        "current_qty": float(stock.current_qty or 0),
        "available_qty": float(available_qty),
        "heat_lot": heat,
        "oldest_prijem_at": op.movement_date.isoformat() if op and op.movement_date else None,
        "suggested_issue_qty": float(suggested),
        "strategy": strategy,
        "heat_lot_must_be_manual": heat is None,
    }
