"""
Skladové účinky dokončení TP operací v kiosk/shopfloor (ne plánovač, ne logistic_mode).

Rozpoznání je deterministické:
1) workplace_library_items.code v {PRIJEM_SKLAD, VYDEJ_SKLAD} (uppercase normalizovaný kód)
2) jinak machines.machine_code u operace v téže množině
3) jinak název pracoviště nebo operace (TP) po ASCII fold: současně „prijem“/„příjem“ → „prijem“ a „sklad“,
   resp. „vydej“/„výdej“ a „sklad“

Výběr skladové karty (hotové výrobky): GPN z operace/VP + zákazník z navázané portfolio položky VP —
všechny aktivní varianty portfolia se stejným GPN; existující karta = aktivní řádek product_stock_items
s portfolio_item_id v této množině (upřednostní se karta přesně pro portfolio VP, jinak ne-EXPEDICE, jinak nejnižší id).

Idempotence: jeden záznam product_stock_movements na planning_operation_id (UNIQUE).
"""

from __future__ import annotations

import logging
import unicodedata
from datetime import datetime
from typing import Literal

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.core.scan_code import product_stock_scan_code_for_id
from app.models.master_data import Machine
from app.models.master_libraries import WorkplaceLibraryItem
from app.models.orders import ProductionOrder
from app.models.planning import PlanningOperation
from app.models.product_stock import ProductStockItem, ProductStockMovement, ProductStockReceipt
from app.services.business_workflow import workflow_record_active
from app.services.restock_wip_reservation_fulfillment import fulfill_restock_wip_reservations_after_source_receipt

logger = logging.getLogger(__name__)

_WORKPLACE_CODES_PRIJEM = frozenset({"PRIJEM_SKLAD"})
_WORKPLACE_CODES_VYDEJ = frozenset({"VYDEJ_SKLAD"})

StockEffectKind = Literal["product_prijem", "product_vydej"]


def _ascii_fold_lower(s: str | None) -> str:
    if not s:
        return ""
    nk = unicodedata.normalize("NFKD", str(s).strip())
    return "".join(c for c in nk if not unicodedata.combining(c)).lower()


def _norm_wp_code(code: str | None) -> str:
    return (code or "").strip().upper()


def _text_implies_prijem_sklad(text: str | None) -> bool:
    f = _ascii_fold_lower(text)
    return "prijem" in f and "sklad" in f


def _text_implies_vydej_sklad(text: str | None) -> bool:
    f = _ascii_fold_lower(text)
    return "vydej" in f and "sklad" in f


def classify_tp_product_stock_effect(db: Session, op: PlanningOperation) -> StockEffectKind | None:
    wid = getattr(op, "workplace_library_item_id", None)
    if wid is not None:
        wp = db.get(WorkplaceLibraryItem, int(wid))
        if wp is not None:
            code = _norm_wp_code(getattr(wp, "code", None))
            if code in _WORKPLACE_CODES_PRIJEM:
                return "product_prijem"
            if code in _WORKPLACE_CODES_VYDEJ:
                return "product_vydej"
            if _text_implies_prijem_sklad(wp.name):
                return "product_prijem"
            if _text_implies_vydej_sklad(wp.name):
                return "product_vydej"
    mid = getattr(op, "machine_id", None)
    if mid is not None:
        m = db.get(Machine, int(mid))
        if m is not None:
            mc = _norm_wp_code(m.machine_code)
            if mc in _WORKPLACE_CODES_PRIJEM:
                return "product_prijem"
            if mc in _WORKPLACE_CODES_VYDEJ:
                return "product_vydej"
    if _text_implies_prijem_sklad(op.operation_name):
        return "product_prijem"
    if _text_implies_vydej_sklad(op.operation_name):
        return "product_vydej"
    return None


def _resolve_po_for_planning_op(db: Session, op: PlanningOperation) -> ProductionOrder | None:
    woo = (op.work_order_no or "").strip()
    if not woo:
        return None
    return db.scalar(select(ProductionOrder).where(ProductionOrder.vp_code == woo))


def _movement_delta(movement_type: str, qty: float) -> float:
    if movement_type == "prijem":
        return qty
    if movement_type == "vydej":
        return -qty
    return qty


def _qty_for_stock_effect(
    op: PlanningOperation,
    qty_ok: int,
    *,
    po_qty: int,
    kind: StockEffectKind,
) -> float:
    q = int(qty_ok or 0)
    if q > 0:
        return float(q)
    op_qty = int(op.qty or 0)
    if op_qty > 0:
        return float(op_qty)
    # Příjem sklad bez explicitního qty_ok musí umět převzít množství z VP,
    # jinak se efekt přeskočí jako zero_qty a sklad zůstane na 0.
    if kind == "product_prijem":
        po_q = int(po_qty or 0)
        if po_q > 0:
            return float(po_q)
    return 0.0


def _normalize_gpn(gpn: str | None) -> str:
    return (gpn or "").strip()


def _is_expedice_location(loc: str | None) -> bool:
    return (loc or "").strip().upper() == "EXPEDICE"


def _job_item_portfolio_item_id_if_present(db: Session, job_item_id: int | None) -> int | None:
    if job_item_id is None:
        return None
    try:
        row = db.execute(
            text("SELECT portfolio_item_id FROM job_items WHERE id = :id"),
            {"id": int(job_item_id)},
        ).fetchone()
    except Exception:
        return None
    if not row:
        return None
    val = row[0]
    return int(val) if val is not None else None


def _resolve_target_portfolio_item_id(db: Session, po: ProductionOrder, op: PlanningOperation) -> int | None:
    if po.portfolio_item_id is not None:
        return int(po.portfolio_item_id)
    # Fallback pro DB větve, kde je portfolio_item_id vedené na job_items.
    via_op_item = _job_item_portfolio_item_id_if_present(db, getattr(op, "order_item_id", None))
    if via_op_item is not None:
        return int(via_op_item)
    via_po_item = _job_item_portfolio_item_id_if_present(db, getattr(po, "job_item_id", None))
    if via_po_item is not None:
        return int(via_po_item)
    return None


def _load_active_product_stock_items_for_portfolio(
    db: Session, portfolio_item_id: int | None
) -> list[ProductStockItem]:
    if portfolio_item_id is None:
        return []
    return list(
        db.scalars(
            select(ProductStockItem)
            .where(
                ProductStockItem.portfolio_item_id == int(portfolio_item_id),
                ProductStockItem.is_active.is_(True),
            )
            .order_by(ProductStockItem.id.asc())
        ).all()
    )


def _pick_product_stock_item_for_tp_effect(rows: list[ProductStockItem], *, prijem: bool) -> ProductStockItem | None:
    if not rows:
        return None
    narrowed = rows
    if prijem:
        non_exp = [r for r in narrowed if not _is_expedice_location(r.location)]
        if non_exp:
            narrowed = non_exp
    return sorted(narrowed, key=lambda r: int(r.id))[0]


def apply_kiosk_tp_stock_effect_on_operation_complete(
    db: Session,
    op: PlanningOperation,
    *,
    qty_ok: int,
) -> dict | None:
    """
    Po HOTOVO/done v kiosk: příjem/výdej skladu výrobků podle TP operace.
    Vrací dict s účinkem nebo None, pokud operace skladový efekt nemá.
    """
    kind = classify_tp_product_stock_effect(db, op)
    if kind is None:
        return None

    existing = db.scalar(
        select(ProductStockMovement).where(ProductStockMovement.planning_operation_id == int(op.id))
    )
    if existing is not None:
        return {
            "stock_effect": kind,
            "idempotent": True,
            "product_stock_movement_id": int(existing.id),
            "message": "Stock movement already exists for this planning operation.",
        }

    po = _resolve_po_for_planning_op(db, op)
    if po is None:
        logger.warning(
            "[kiosk_tp_stock] skip effect=%s planning_op_id=%s: production order not found for vp_code=%s",
            kind,
            op.id,
            op.work_order_no,
        )
        return {
            "stock_effect": kind,
            "skipped": True,
            "reason": "production_order_not_found",
        }
    if not workflow_record_active(po):
        logger.warning(
            "[kiosk_tp_stock] skip effect=%s planning_op_id=%s: workflow inactive for po_id=%s",
            kind,
            op.id,
            po.id,
        )
        return {"stock_effect": kind, "skipped": True, "reason": "workflow_inactive"}

    target_portfolio_item_id = _resolve_target_portfolio_item_id(db, po, op)
    if target_portfolio_item_id is None:
        logger.warning(
            "[kiosk_tp_stock] skip effect=%s planning_op_id=%s: missing portfolio_item_id link",
            kind,
            op.id,
        )
        return {"stock_effect": kind, "skipped": True, "reason": "no_portfolio_item"}

    qty = _qty_for_stock_effect(
        op,
        qty_ok,
        po_qty=int(po.quantity or 0),
        kind=kind,
    )
    if qty <= 0:
        logger.warning(
            "[kiosk_tp_stock] skip effect=%s planning_op_id=%s: qty<=0 (qty_ok=%s op.qty=%s)",
            kind,
            op.id,
            qty_ok,
            op.qty,
        )
        return {"stock_effect": kind, "skipped": True, "reason": "zero_qty"}

    now = datetime.utcnow()
    vp_ref = (po.vp_code or "").strip()
    gpn = (op.gpn or po.gpn or "").strip()

    stock_rows = _load_active_product_stock_items_for_portfolio(db, target_portfolio_item_id)
    stock = _pick_product_stock_item_for_tp_effect(
        stock_rows,
        prijem=(kind == "product_prijem"),
    )
    if stock is None:
        loc = None
        note = "Auto-created from kiosk TP stock operation (Příjem sklad — žádná existující karta)."
        if kind == "product_vydej":
            logger.warning(
                "[kiosk_tp_stock] skip vydej planning_op_id=%s: no stock card for portfolio_item_id=%s",
                op.id,
                target_portfolio_item_id,
            )
            return {"stock_effect": kind, "skipped": True, "reason": "no_stock_card_for_vydej"}
        stock = ProductStockItem(
            portfolio_item_id=int(target_portfolio_item_id),
            location=loc,
            current_qty=0,
            min_qty=0,
            unit="ks",
            note=note,
            is_active=True,
        )
        db.add(stock)
        db.flush()
        stock.scan_code = product_stock_scan_code_for_id(int(stock.id))

    if kind == "product_prijem":
        stock.current_qty = float(stock.current_qty or 0) + qty
        receipt = ProductStockReceipt(
            product_stock_item_id=int(stock.id),
            production_order_id=int(po.id),
            planning_operation_id=int(op.id),
            qty_received=qty,
            received_at=now,
            note=f"Kiosk TP příjem sklad; planning_op={op.id} GPN={gpn}",
        )
        db.add(receipt)
        movement = ProductStockMovement(
            stock_item_id=int(stock.id),
            movement_type="prijem",
            qty=qty,
            movement_date=now,
            reference=f"VP:{vp_ref};GPN:{gpn};PO:{po.id};PLO:{op.id}",
            note="Kiosk: dokončení operace Příjem sklad (TP).",
            planning_operation_id=int(op.id),
        )
        db.add(movement)
        db.flush()
        fulfill_restock_wip_reservations_after_source_receipt(db, source_production_order_id=int(po.id))
        logger.info(
            "[kiosk_tp_stock] prijem planning_op_id=%s po_id=%s qty=%s movement_id=%s",
            op.id,
            po.id,
            qty,
            movement.id,
        )
        return {
            "stock_effect": kind,
            "product_stock_movement_id": int(movement.id),
            "product_stock_item_id": int(stock.id),
            "qty": qty,
            "current_qty": float(stock.current_qty or 0),
        }

    # product_vydej
    stock.current_qty = float(stock.current_qty or 0) + _movement_delta("vydej", qty)
    movement = ProductStockMovement(
        stock_item_id=int(stock.id),
        movement_type="vydej",
        qty=qty,
        movement_date=now,
        reference=f"VP:{vp_ref};GPN:{gpn};PO:{po.id};PLO:{op.id}",
        note="Kiosk: dokončení operace Výdej sklad (TP).",
        planning_operation_id=int(op.id),
    )
    db.add(movement)
    db.flush()
    logger.info(
        "[kiosk_tp_stock] vydej planning_op_id=%s po_id=%s qty=%s movement_id=%s",
        op.id,
        po.id,
        qty,
        movement.id,
    )
    return {
        "stock_effect": kind,
        "product_stock_movement_id": int(movement.id),
        "product_stock_item_id": int(stock.id),
        "qty": qty,
        "current_qty": float(stock.current_qty or 0),
    }
