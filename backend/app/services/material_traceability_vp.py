"""VP ↔ material stock traceability (issued movement → receipt batch / documents)."""

from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.material_stock import MaterialStockItem, MaterialStockMovement, MaterialStockMovementAttachment
from app.models.orders import ProductionOrder


def _strip(v: Any) -> str | None:
    if v is None:
        return None
    s = str(v).strip()
    return s or None


def vp_material_traceability_for_input(db: Session, po: ProductionOrder, material_library_item_id: int) -> dict[str, Any]:
    """
    For one TP material line: if this VP has a material issue (vydej) for that library item,
    resolve the linked prijem batch (same stock item, before issue) for audit fields and attachments.
    """
    out: dict[str, Any] = {
        "heat_lot": None,
        "supplier_name": None,
        "delivery_note_no": None,
        "certificate_no": None,
        "attachments": [],
    }
    mid = int(material_library_item_id)
    issue_mv = db.scalars(
        select(MaterialStockMovement)
        .join(MaterialStockItem, MaterialStockMovement.stock_item_id == MaterialStockItem.id)
        .where(
            MaterialStockMovement.production_order_id == int(po.id),
            MaterialStockMovement.movement_type == "vydej",
            MaterialStockItem.material_library_item_id == mid,
        )
        .order_by(MaterialStockMovement.movement_date.desc(), MaterialStockMovement.id.desc())
    ).first()
    if issue_mv is None:
        return out

    prijem = db.scalars(
        select(MaterialStockMovement)
        .where(
            MaterialStockMovement.stock_item_id == int(issue_mv.stock_item_id),
            MaterialStockMovement.movement_type == "prijem",
            MaterialStockMovement.movement_date <= issue_mv.movement_date,
        )
        .order_by(MaterialStockMovement.movement_date.desc(), MaterialStockMovement.id.desc())
    ).first()

    src = prijem if prijem is not None else issue_mv
    out["heat_lot"] = _strip(getattr(src, "heat_lot", None)) or _strip(getattr(issue_mv, "heat_lot", None))
    out["supplier_name"] = _strip(getattr(src, "supplier_name", None))
    out["delivery_note_no"] = _strip(getattr(src, "delivery_note_no", None))
    out["certificate_no"] = _strip(getattr(src, "certificate_no", None))

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
