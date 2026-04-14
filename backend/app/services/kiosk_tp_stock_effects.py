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

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.scan_code import product_stock_scan_code_for_id
from app.models.master_data import Machine
from app.models.master_libraries import WorkplaceLibraryItem
from app.models.orders import ProductionOrder
from app.models.planning import PlanningOperation
from app.models.portfolio import PortfolioItem
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


def _qty_for_stock_effect(op: PlanningOperation, qty_ok: int) -> float:
    q = int(qty_ok or 0)
    if q > 0:
        return float(q)
    return float(int(op.qty or 0))


def _normalize_gpn(gpn: str | None) -> str:
    return (gpn or "").strip()


def _is_expedice_location(loc: str | None) -> bool:
    return (loc or "").strip().upper() == "EXPEDICE"


def _candidate_portfolio_item_ids_for_gpn_stock(
    db: Session, po: ProductionOrder, op: PlanningOperation
) -> list[int]:
    """
    Všechny portfolio položky se stejným GPN jako VP (v rámci stejného zákazníka jako VP), plus id z VP.
    Hotový sklad je vázaný na konkrétní portfolio řádek; stejné GPN = více logistic_mode variant —
    příjem musí najít existující kartu na libovolné z této skupiny.
    """
    anchor: PortfolioItem | None = None
    if po.portfolio_item_id is not None:
        anchor = db.get(PortfolioItem, int(po.portfolio_item_id))
    gpn = _normalize_gpn(op.gpn or po.gpn or (anchor.gpn if anchor else ""))
    if not gpn:
        return [int(anchor.id)] if anchor is not None else []
    q = select(PortfolioItem.id).where(func.lower(func.trim(PortfolioItem.gpn)) == gpn.lower())
    if anchor is not None:
        q = q.where(PortfolioItem.customer_id == int(anchor.customer_id))
    ids = sorted({int(x) for x in db.scalars(q).all()})
    if po.portfolio_item_id is not None:
        pid = int(po.portfolio_item_id)
        if pid not in ids:
            ids.append(pid)
        ids.sort()
    return ids


def _load_active_product_stock_items(
    db: Session, portfolio_ids: list[int]
) -> list[ProductStockItem]:
    if not portfolio_ids:
        return []
    return list(
        db.scalars(
            select(ProductStockItem)
            .where(
                ProductStockItem.portfolio_item_id.in_(portfolio_ids),
                ProductStockItem.is_active.is_(True),
            )
            .order_by(ProductStockItem.id.asc())
        ).all()
    )


def _pick_product_stock_item_for_tp_effect(
    rows: list[ProductStockItem],
    *,
    preferred_portfolio_item_id: int | None,
    prijem: bool,
) -> ProductStockItem | None:
    if not rows:
        return None
    narrowed = rows
    if preferred_portfolio_item_id is not None:
        exact = [r for r in narrowed if int(r.portfolio_item_id) == int(preferred_portfolio_item_id)]
        if exact:
            narrowed = exact
    if prijem:
        non_exp = [r for r in narrowed if not _is_expedice_location(r.location)]
        if non_exp:
            narrowed = non_exp
    return sorted(narrowed, key=lambda r: int(r.id))[0]


def _portfolio_item_id_for_new_stock_card(
    po: ProductionOrder, candidate_portfolio_ids: list[int]
) -> int | None:
    if po.portfolio_item_id is not None:
        return int(po.portfolio_item_id)
    if candidate_portfolio_ids:
        return int(candidate_portfolio_ids[0])
    return None


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

    candidate_pids = _candidate_portfolio_item_ids_for_gpn_stock(db, po, op)
    if not candidate_pids:
        logger.warning(
            "[kiosk_tp_stock] skip effect=%s planning_op_id=%s: no portfolio candidates for GPN",
            kind,
            op.id,
        )
        return {"stock_effect": kind, "skipped": True, "reason": "no_portfolio_item"}

    qty = _qty_for_stock_effect(op, qty_ok)
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

    pref_pid = int(po.portfolio_item_id) if po.portfolio_item_id is not None else None
    stock_rows = _load_active_product_stock_items(db, candidate_pids)
    stock = _pick_product_stock_item_for_tp_effect(
        stock_rows,
        preferred_portfolio_item_id=pref_pid,
        prijem=(kind == "product_prijem"),
    )
    if stock is None:
        new_pid = _portfolio_item_id_for_new_stock_card(po, candidate_pids)
        if new_pid is None:
            return {"stock_effect": kind, "skipped": True, "reason": "no_portfolio_for_new_card"}
        loc = None
        note = "Auto-created from kiosk TP stock operation (Příjem sklad — žádná existující karta)."
        if kind == "product_vydej":
            logger.warning(
                "[kiosk_tp_stock] skip vydej planning_op_id=%s: no stock card for GPN portfolio group",
                op.id,
            )
            return {"stock_effect": kind, "skipped": True, "reason": "no_stock_card_for_vydej"}
        stock = ProductStockItem(
            portfolio_item_id=int(new_pid),
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
