from __future__ import annotations

from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.material_stock import MaterialStockItem, MaterialStockMovement


def _storno_reference_for_issue_movement(issue_mv: MaterialStockMovement, po) -> str:
    vp_code = (getattr(po, "vp_code", None) or "").strip()
    return f"STORNO_VYDEJE_OF:{int(issue_mv.id)};PO:{int(po.id)};VP:{vp_code}"


def rollback_material_issue_movements_for_cancelled_production_order(
    db: Session,
    po,
) -> int:
    """
    For a cancelled production order:
    - keep original material issue movement (vydej)
    - create one compensating storno_vydeje movement per original issue
    - restore stock quantity
    - do nothing if rollback movement already exists
    """

    if po is None or getattr(po, "id", None) is None:
        return 0

    po_id = int(po.id)

    original_issues = (
        db.scalars(
            select(MaterialStockMovement)
            .where(
                MaterialStockMovement.production_order_id == po_id,
                MaterialStockMovement.movement_type == "vydej",
            )
            .order_by(MaterialStockMovement.id.asc())
        )
        .all()
    )

    created = 0

    for issue_mv in original_issues:
        stock_item_id = getattr(issue_mv, "stock_item_id", None)
        if stock_item_id is None:
            continue

        qty = float(getattr(issue_mv, "qty", 0) or 0)
        if qty <= 0:
            continue

        storno_ref = _storno_reference_for_issue_movement(issue_mv, po)

        existing_storno = db.scalar(
            select(MaterialStockMovement).where(
                MaterialStockMovement.movement_type == "storno_vydeje",
                MaterialStockMovement.stock_item_id == int(stock_item_id),
                MaterialStockMovement.reference == storno_ref,
            )
        )
        if existing_storno is not None:
            continue

        stock = db.get(MaterialStockItem, int(stock_item_id))
        if stock is None:
            continue

        stock.current_qty = float(stock.current_qty or 0) + qty

        orig_ref = (getattr(issue_mv, "reference", None) or "").strip() or "-"
        vp_code = (getattr(po, "vp_code", None) or "").strip() or "-"

        db.add(
            MaterialStockMovement(
                stock_item_id=int(stock_item_id),
                movement_type="storno_vydeje",
                qty=qty,
                movement_date=datetime.utcnow(),
                reference=storno_ref,
                heat_lot=getattr(issue_mv, "heat_lot", None),
                production_order_id=po_id,
                job_item_id=(
                    int(issue_mv.job_item_id)
                    if getattr(issue_mv, "job_item_id", None) is not None
                    else None
                ),
                note=(
                    "Auto storno vydeje materialu pri storno VP; "
                    f"orig_movement_id={int(issue_mv.id)}; "
                    f"orig_reference={orig_ref}; "
                    f"vp_code={vp_code}"
                ),
            )
        )
        created += 1

    return created
