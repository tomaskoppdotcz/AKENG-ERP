"""VP ↔ material stock traceability (issued movement → receipt batch / documents).

Výdej vázaný na VP (production_order_id nebo job_item_id) + stejný materiál v knihovně.
Tavba / atest preferenčně z příjmu před výdejem na stejné skladové kartě (id výdeje > id příjmu).
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.scan_code import material_stock_movement_scan_code_for_id
from app.models.material_library import MaterialLibraryItem
from app.models.material_stock import MaterialStockItem, MaterialStockMovement, MaterialStockMovementAttachment
from app.models.orders import ProductionOrder


def _strip(v: Any) -> str | None:
    if v is None:
        return None
    s = str(v).strip()
    return s or None


def _find_vp_issue_movement(
    db: Session, po: ProductionOrder, material_library_item_id: int
) -> tuple[MaterialStockMovement | None, str | None]:
    """
    Najde výdej materiálu pro daný VP a řádek TP (material_library_item_id).
    1) production_order_id == VP
    2) fallback job_item_id == VP (legacy / NULL production_order_id na pohybu)
    """
    mid = int(material_library_item_id)
    base = (
        select(MaterialStockMovement)
        .join(MaterialStockItem, MaterialStockMovement.stock_item_id == MaterialStockItem.id)
        .where(
            MaterialStockMovement.movement_type == "vydej",
            MaterialStockItem.material_library_item_id == mid,
        )
    )
    mv = db.scalars(
        base.where(MaterialStockMovement.production_order_id == int(po.id)).order_by(
            MaterialStockMovement.movement_date.desc(),
            MaterialStockMovement.id.desc(),
        )
    ).first()
    if mv is not None:
        return mv, "production_order"
    if po.job_item_id is not None:
        mv2 = db.scalars(
            base.where(MaterialStockMovement.job_item_id == int(po.job_item_id)).order_by(
                MaterialStockMovement.movement_date.desc(),
                MaterialStockMovement.id.desc(),
            )
        ).first()
        if mv2 is not None:
            return mv2, "job_item"
    return None, None


def vp_material_traceability_for_input(db: Session, po: ProductionOrder, material_library_item_id: int) -> dict[str, Any]:
    """
    Pro vstup TP typu materiál: pokud existuje výdej pro tento VP + materiál,
    vrátí dohledatelnost z výdeje a z navázaného příjmu (atest, DL, přílohy).
    """
    mid = int(material_library_item_id)
    lib = db.get(MaterialLibraryItem, mid)

    out: dict[str, Any] = {
        "heat_lot": None,
        "supplier_name": None,
        "delivery_note_no": None,
        "certificate_no": None,
        "attachments": [],
        "issue_movement_id": None,
        "linkage": None,
        "movement_scan_code": None,
        "stock_location": None,
        "length_per_piece_mm": None,
        "weight_per_piece_kg": None,
        "material_code": lib.code if lib else None,
        "material_name": lib.name if lib else None,
        "material_dimension": lib.dimension if lib else None,
        "has_issued_movement": False,
    }

    issue_mv, linkage = _find_vp_issue_movement(db, po, mid)
    if issue_mv is None:
        return out

    out["has_issued_movement"] = True
    out["issue_movement_id"] = int(issue_mv.id)
    out["linkage"] = linkage
    mv_sc = _strip(getattr(issue_mv, "scan_code", None))
    if not mv_sc:
        mv_sc = material_stock_movement_scan_code_for_id(int(issue_mv.id))
    out["movement_scan_code"] = mv_sc
    if issue_mv.length_per_piece_mm is not None:
        try:
            out["length_per_piece_mm"] = float(issue_mv.length_per_piece_mm)
        except (TypeError, ValueError):
            pass
    if issue_mv.weight_per_piece_kg is not None:
        try:
            out["weight_per_piece_kg"] = float(issue_mv.weight_per_piece_kg)
        except (TypeError, ValueError):
            pass

    stock = db.get(MaterialStockItem, int(issue_mv.stock_item_id))
    if stock is not None:
        out["stock_location"] = _strip(stock.location)

    prijem = db.scalars(
        select(MaterialStockMovement)
        .where(
            MaterialStockMovement.stock_item_id == int(issue_mv.stock_item_id),
            MaterialStockMovement.movement_type == "prijem",
            MaterialStockMovement.id < int(issue_mv.id),
        )
        .order_by(MaterialStockMovement.movement_date.desc(), MaterialStockMovement.id.desc())
    ).first()

    src = prijem if prijem is not None else issue_mv
    out["heat_lot"] = _strip(getattr(issue_mv, "heat_lot", None)) or _strip(getattr(src, "heat_lot", None))
    out["supplier_name"] = _strip(getattr(src, "supplier_name", None))
    out["delivery_note_no"] = _strip(getattr(src, "delivery_note_no", None))
    out["certificate_no"] = _strip(getattr(src, "certificate_no", None))

    if out["length_per_piece_mm"] is None and getattr(src, "length_per_piece_mm", None) is not None:
        try:
            out["length_per_piece_mm"] = float(src.length_per_piece_mm)
        except (TypeError, ValueError):
            pass
    if out["weight_per_piece_kg"] is None and getattr(src, "weight_per_piece_kg", None) is not None:
        try:
            out["weight_per_piece_kg"] = float(src.weight_per_piece_kg)
        except (TypeError, ValueError):
            pass

    if prijem is not None:
        atts = db.scalars(
            select(MaterialStockMovementAttachment).where(MaterialStockMovementAttachment.movement_id == int(prijem.id))
        ).all()
        out["attachments"] = [
            {
                "id": int(a.id),
                "original_filename": a.original_filename,
                "download_url": f"/material-stock/movements/{prijem.id}/attachments/{a.id}/file",
            }
            for a in atts
        ]
    return out
