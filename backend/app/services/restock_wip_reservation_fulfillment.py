"""Po příjmu hotového výstupu na sklad ze zdrojového restock VP: uvolnění RestockWipReservation a zákaznického sklad_zakaznik VP."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.orders import ProductionOrder
from app.models.product_stock import ProductStockReceipt
from app.models.restock_wip_reservation import RestockWipReservation
from app.services.business_workflow import workflow_record_active
from app.services.material_readiness import refresh_production_order_material_readiness
from app.services.vp_operation_generator import ensure_planning_operations_for_production_order


def _total_qty_received_for_production_order(db: Session, production_order_id: int) -> float:
    total = db.scalar(
        select(func.coalesce(func.sum(ProductStockReceipt.qty_received), 0.0)).where(
            ProductStockReceipt.production_order_id == int(production_order_id)
        )
    )
    return float(total or 0.0)


def fulfill_restock_wip_reservations_after_source_receipt(
    db: Session,
    *,
    source_production_order_id: int,
) -> dict:
    """
    Součet všech příjemek k source VP; sekvenční „waterfill“ pending rezervací podle id.
    Idempotentní: už splněné řádky přeskočí. Nevyžaduje commit — volat po flush nové příjemky.
    """
    src_id = int(source_production_order_id)
    total_received = _total_qty_received_for_production_order(db, src_id)
    pending = db.scalars(
        select(RestockWipReservation)
        .where(
            RestockWipReservation.source_production_order_id == src_id,
            RestockWipReservation.status == "pending",
        )
        .order_by(RestockWipReservation.id.asc())
    ).all()

    remaining = float(total_received)
    fulfilled_out: list[dict] = []

    for rsv in pending:
        need = float(int(rsv.reserved_qty or 0))
        if need <= 0:
            continue
        if remaining + 1e-9 < need:
            break
        remaining -= need
        rsv.status = "fulfilled"
        rsv.fulfilled_at = datetime.utcnow()
        db.flush()

        cust_id = rsv.fulfillment_customer_production_order_id
        entry: dict = {
            "reservation_id": int(rsv.id),
            "reserved_qty": int(need),
            "source_production_order_id": src_id,
            "customer_production_order_id": None,
            "customer_vp_code": None,
            "customer_unblocked": False,
            "planning": None,
        }
        if cust_id is None:
            fulfilled_out.append(entry)
            continue

        cust_po = db.get(ProductionOrder, int(cust_id))
        if cust_po is None or not workflow_record_active(cust_po):
            entry["customer_production_order_id"] = int(cust_id) if cust_id is not None else None
            fulfilled_out.append(entry)
            continue

        entry["customer_production_order_id"] = int(cust_po.id)
        entry["customer_vp_code"] = cust_po.vp_code
        setattr(cust_po, "blocked_until_reserved_stock_receipt", False)
        db.flush()
        entry["customer_unblocked"] = True
        plan_info = ensure_planning_operations_for_production_order(db, cust_po)
        entry["planning"] = plan_fields_for_client(plan_info)
        refresh_production_order_material_readiness(db, cust_po)
        fulfilled_out.append(entry)

    pending_cnt = db.scalar(
        select(func.count())
        .select_from(RestockWipReservation)
        .where(
            RestockWipReservation.source_production_order_id == src_id,
            RestockWipReservation.status == "pending",
        )
    )
    has_pending = int(pending_cnt or 0) > 0
    user_message_cs: str | None = None
    if fulfilled_out:
        user_message_cs = (
            "Rezervovaný výstup byl přijat na sklad. Následný výrobní příkaz zákazníka (sklad) "
            "lze nyní naplánovat a vydat do výroby podle běžného toku."
        )
    elif has_pending and total_received > 0:
        user_message_cs = (
            "Příjem na sklad zaznamenán; část rezervací zatím nemá dostatek přijatého množství "
            "(další příjem může rezervaci dokončit)."
        )

    return {
        "fulfilled": fulfilled_out,
        "total_received_qty": round(total_received, 6),
        "remaining_unallocated_qty": round(max(remaining, 0.0), 6),
        "has_pending_reservations": bool(has_pending),
        "user_message_cs": user_message_cs,
    }


def plan_fields_for_client(plan_info: dict) -> dict:
    """Zkrácený přehled pro API odpovědi."""
    if not plan_info:
        return {}
    keys = ("skipped", "vp_id", "vp_code", "created", "planning_ops", "queue_normalize")
    return {k: plan_info[k] for k in keys if k in plan_info}
