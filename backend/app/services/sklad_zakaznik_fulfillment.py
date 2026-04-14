"""
Deterministické plnění řádku zakázky s portfolio variantou sklad_zakaznik.

Jeden zdroj pravdy pro interní doplnění skladu: hotové zboží pro zákazníka + rezervace WIP + díra pod minimum.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

from sqlalchemy import text
from sqlalchemy.orm import Session

if TYPE_CHECKING:
    from app.models.orders import JobItem, ProductionOrder


@dataclass(frozen=True)
class SkladZakaznikFulfillmentPlan:
    """Strukturovaný plán kroků 1–4 (hotový sklad → WIP → výroba → jedno interní doplnění)."""

    demand: int
    qty_from_finished_stock: int
    min_stock_replenishment_gap: int
    qty_reserved_wip: int
    qty_vyroba_remainder: int
    """Jedno číslo pro jeden interní restock VP (from_stock + reserve + min gap)."""
    unified_internal_replenishment_qty: int
    needs_wip_resolution: bool
    wip_open_qty: int


def read_finished_stock_and_min_qty(db: Session, portfolio_item_id: int) -> tuple[float, float]:
    row = db.execute(
        text(
            "SELECT COALESCE(SUM(current_qty), 0), COALESCE(SUM(min_qty), 0) "
            "FROM product_stock_items WHERE portfolio_item_id = :pid"
        ),
        {"pid": int(portfolio_item_id)},
    ).fetchone()
    if not row:
        return (0.0, 0.0)
    return (float(row[0] or 0.0), float(row[1] or 0.0))


def build_sklad_zakaznik_fulfillment_plan(
    db: Session,
    it: "JobItem",
    portfolio_item_id: int,
    has_portfolio: bool,
    restock_strategy: str | None,
) -> SkladZakaznikFulfillmentPlan:
    """
    restock_strategy: prefer_customer | prefer_stock | None (None = žádná rezervace WIP, jako prefer_stock).
    Lazy import z orders kvůli cyklům importů — volá se až za běhu.
    """
    from app.api.orders import (
        _job_line_needs_restock_conflict_choice,
        _open_restock_wip_quantity_for_job_item,
        _primary_open_restock_po_for_job_item_gpn,
    )

    demand = int(it.qty or 0)
    stock_qty, min_qty = read_finished_stock_and_min_qty(db, int(portfolio_item_id))
    from_stock = int(min(float(demand), stock_qty))
    after_stock_demand = max(0, demand - from_stock)
    remaining_on_shelf = max(0.0, stock_qty - float(from_stock))
    min_gap = int(max(0.0, float(min_qty) - remaining_on_shelf))

    wip_open = int(_open_restock_wip_quantity_for_job_item(db, it, has_portfolio)) if has_portfolio else 0
    needs_wip = _job_line_needs_restock_conflict_choice(
        float(after_stock_demand), float(min_gap), wip_open
    )

    strat = (restock_strategy or "prefer_stock").strip().lower()
    if strat not in ("prefer_customer", "prefer_stock"):
        strat = "prefer_stock"

    reserve_qty = 0
    if needs_wip and strat == "prefer_customer":
        primary = _primary_open_restock_po_for_job_item_gpn(db, it, has_portfolio)
        if primary is not None:
            reserve_qty = int(min(wip_open, after_stock_demand))

    vyroba = max(0, after_stock_demand - reserve_qty)
    unified = int(from_stock + reserve_qty + min_gap)

    return SkladZakaznikFulfillmentPlan(
        demand=demand,
        qty_from_finished_stock=from_stock,
        min_stock_replenishment_gap=min_gap,
        qty_reserved_wip=reserve_qty,
        qty_vyroba_remainder=vyroba,
        unified_internal_replenishment_qty=unified,
        needs_wip_resolution=bool(needs_wip),
        wip_open_qty=wip_open,
    )


def wip_primary_restock_po_for_plan(
    db: Session,
    it: "JobItem",
    has_portfolio: bool,
) -> "ProductionOrder | None":
    from app.api.orders import _primary_open_restock_po_for_job_item_gpn

    return _primary_open_restock_po_for_job_item_gpn(db, it, has_portfolio)
