"""
Deterministické plnění řádku zakázky s portfolio variantou sklad_zakaznik.

Minimální zásoba = cílová úroveň po obsloužení zákazníka, ne zákaz výdeje.
Plán umí kombinovat: hotový sklad + rezervace WIP + nová výroba + interní doplnění minima.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from sqlalchemy import text
from sqlalchemy.orm import Session

if TYPE_CHECKING:
    from app.models.orders import JobItem, ProductionOrder


def _iceil_nonneg(x: float) -> int:
    if x <= 1e-9:
        return 0
    return int(math.ceil(x - 1e-9))


def normalize_restock_resolution_strategy(raw: str | None) -> str:
    """Kanonická hodnota strategie pro API (včetně zpětné kompatibility prefer_*)."""
    s = (raw or "stock_and_new_production").strip().lower()
    if s == "prefer_customer":
        return "stock_and_wip"
    if s == "prefer_stock":
        return "stock_and_new_production"
    allowed = {
        "stock_and_wip",
        "stock_and_new_production",
        "wip_only",
        "new_production_only",
        "stock_only",
    }
    return s if s in allowed else "stock_and_new_production"


def compute_sklad_zakaznik_customer_split(
    *,
    customer_required_qty: int,
    finished_stock_qty: float,
    wip_restock_qty: int,
    minimum_stock_target_qty: float,
    mode: str,
) -> dict[str, int | float | bool]:
    """
    Rozdělí požadavek: sklad → WIP → nová výroba; dopočítá deficit minima a interní doplnění.

    Interní doplnění = wip_reservation_qty (náhrada za výstup z WIP pro zákazníka) + min_stock_replenishment_gap.
    """
    req = int(customer_required_qty)
    fin = float(finished_stock_qty)
    wip = int(wip_restock_qty)
    min_t = float(minimum_stock_target_qty)
    mode_n = normalize_restock_resolution_strategy(mode)

    stock_issue = int(min(float(req), fin))
    rem_after_stock = max(0, req - stock_issue)

    if mode_n == "stock_and_wip":
        wip_res = int(min(rem_after_stock, wip))
    elif mode_n in ("stock_and_new_production", "stock_only"):
        wip_res = 0
    elif mode_n == "wip_only":
        stock_issue = 0
        rem_after_stock = req
        wip_res = int(min(rem_after_stock, wip))
    elif mode_n == "new_production_only":
        stock_issue = 0
        rem_after_stock = req
        wip_res = 0
    else:
        wip_res = 0

    rem_after_wip = max(0, rem_after_stock - wip_res)
    new_prod = int(rem_after_wip)

    stock_after = max(0.0, fin - float(stock_issue))
    future = stock_after + float(max(0, wip - wip_res))
    min_gap = _iceil_nonneg(min_t - future)
    unified = int(wip_res + min_gap)

    return {
        "stock_issue_qty": int(stock_issue),
        "wip_reservation_qty": int(wip_res),
        "new_customer_production_qty": int(new_prod),
        "remaining_after_stock": int(rem_after_stock),
        "remaining_after_wip": int(rem_after_wip),
        "stock_after_customer_issue_qty": float(stock_after),
        "future_stock_after_wip_qty": float(future),
        "min_stock_replenishment_gap": int(min_gap),
        "unified_internal_replenishment_qty": int(unified),
    }


def _split_signature(split: dict[str, Any]) -> tuple[int, int, int, int]:
    return (
        int(split["stock_issue_qty"]),
        int(split["wip_reservation_qty"]),
        int(split["new_customer_production_qty"]),
        int(split["min_stock_replenishment_gap"]),
    )


def _summary_cs(split: dict[str, Any]) -> str:
    s = int(split["stock_issue_qty"])
    w = int(split["wip_reservation_qty"])
    p = int(split["new_customer_production_qty"])
    parts: list[str] = []
    if s > 0:
        parts.append(f"{s} ks ihned ze skladu")
    if w > 0:
        parts.append(f"{w} ks rezervovat z rozpracované výroby")
    if p > 0:
        parts.append(f"{p} ks nová výroba pro zákazníka")
    if not parts:
        return "Bez čerpání skladu a WIP."
    return ", ".join(parts) + "."


def list_sklad_zakaznik_resolution_options(
    *,
    customer_required_qty: int,
    finished_stock_qty: float,
    wip_restock_qty: int,
    minimum_stock_target_qty: float,
) -> tuple[list[dict[str, Any]], str]:
    """
    Nabídne strategie pro modal (unikátní rozložení). Vrací (options, recommended_strategy).
    Doporučení: sklad + WIP (+ výroba), pokud WIP reálně snižuje novou výrobu oproti čistě sklad+výroba.
    """
    req = int(customer_required_qty)
    fin = float(finished_stock_qty)
    wip = int(wip_restock_qty)
    min_t = float(minimum_stock_target_qty)

    modes_meta: list[tuple[str, str]] = [
        ("stock_and_wip", "Sklad + WIP (+ případně nová výroba)"),
        ("stock_and_new_production", "Ze skladu + zbytek nová výroba"),
        ("wip_only", "Jen z rozpracované výroby (WIP)"),
        ("new_production_only", "Jen nová výroba"),
        ("stock_only", "Maximálně ze skladu (+ případně výroba)"),
    ]

    seen: set[tuple[int, int, int, int]] = set()
    options: list[dict[str, Any]] = []
    for mode, label in modes_meta:
        sp = compute_sklad_zakaznik_customer_split(
            customer_required_qty=req,
            finished_stock_qty=fin,
            wip_restock_qty=wip,
            minimum_stock_target_qty=min_t,
            mode=mode,
        )
        sig = _split_signature(sp)
        if sig in seen:
            continue
        seen.add(sig)
        options.append(
            {
                "strategy": mode,
                "label_cs": label,
                "summary_cs": _summary_cs(sp),
                "stock_issue_qty": sp["stock_issue_qty"],
                "wip_reservation_qty": sp["wip_reservation_qty"],
                "new_customer_production_qty": sp["new_customer_production_qty"],
                "stock_after_customer_issue_qty": sp["stock_after_customer_issue_qty"],
                "future_stock_after_wip_qty": sp["future_stock_after_wip_qty"],
                "min_stock_replenishment_gap": sp["min_stock_replenishment_gap"],
                "unified_internal_replenishment_qty": sp["unified_internal_replenishment_qty"],
            }
        )

    base_stock = int(min(float(req), fin))
    rem0 = max(0, req - base_stock)
    split_stock_only = compute_sklad_zakaznik_customer_split(
        customer_required_qty=req,
        finished_stock_qty=fin,
        wip_restock_qty=wip,
        minimum_stock_target_qty=min_t,
        mode="stock_and_new_production",
    )
    split_combo = compute_sklad_zakaznik_customer_split(
        customer_required_qty=req,
        finished_stock_qty=fin,
        wip_restock_qty=wip,
        minimum_stock_target_qty=min_t,
        mode="stock_and_wip",
    )
    recommended = "stock_and_new_production"
    if wip > 0 and rem0 > 0:
        combo_np = int(split_combo["new_customer_production_qty"])
        stock_np = int(split_stock_only["new_customer_production_qty"])
        if combo_np == 0:
            # Sklad + WIP plně pokryje zákazníka — preferovat kombinaci.
            recommended = "stock_and_wip"
        elif combo_np < stock_np:
            recommended = "stock_and_wip"
        elif combo_np == stock_np and int(split_combo["wip_reservation_qty"]) > 0:
            recommended = "stock_and_wip"

    if rem0 <= 0 and wip > 0:
        recommended = "stock_and_new_production"

    return options, recommended


@dataclass(frozen=True)
class SkladZakaznikFulfillmentPlan:
    """Strukturovaný plán: hotový sklad → volitelná rezervace WIP → výroba → interní doplnění."""

    demand: int
    qty_from_finished_stock: int
    min_stock_replenishment_gap: int
    qty_reserved_wip: int
    qty_vyroba_remainder: int
    unified_internal_replenishment_qty: int
    needs_wip_resolution: bool
    wip_open_qty: int
    finished_stock_qty: float = 0.0
    minimum_stock_target_qty: float = 0.0
    stock_after_customer_issue_qty: float = 0.0
    future_stock_after_wip_qty: float = 0.0
    wip_covers_minimum_after_customer_issue: bool = False


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
    restock_strategy: viz normalize_restock_resolution_strategy (včetně legacy prefer_*).
    """
    from app.api.orders import _open_restock_wip_quantity_for_job_item

    demand = int(it.qty or 0)
    stock_qty, min_qty = read_finished_stock_and_min_qty(db, int(portfolio_item_id))
    wip_open = int(_open_restock_wip_quantity_for_job_item(db, it, has_portfolio)) if has_portfolio else 0

    mode = normalize_restock_resolution_strategy(restock_strategy)
    sp = compute_sklad_zakaznik_customer_split(
        customer_required_qty=demand,
        finished_stock_qty=float(stock_qty),
        wip_restock_qty=int(wip_open),
        minimum_stock_target_qty=float(min_qty),
        mode=mode,
    )

    stock_issue_best = int(min(float(demand), float(stock_qty)))
    sa_best = max(0.0, float(stock_qty) - float(stock_issue_best))
    future_full_wip = sa_best + float(wip_open)
    wip_covers_minimum = _iceil_nonneg(float(min_qty) - future_full_wip) <= 0

    after_stock_demand = max(0, demand - stock_issue_best)
    needs_wip = wip_open > 0 and after_stock_demand > 0

    return SkladZakaznikFulfillmentPlan(
        demand=demand,
        qty_from_finished_stock=int(sp["stock_issue_qty"]),
        min_stock_replenishment_gap=int(sp["min_stock_replenishment_gap"]),
        qty_reserved_wip=int(sp["wip_reservation_qty"]),
        qty_vyroba_remainder=int(sp["new_customer_production_qty"]),
        unified_internal_replenishment_qty=int(sp["unified_internal_replenishment_qty"]),
        needs_wip_resolution=bool(needs_wip),
        wip_open_qty=wip_open,
        finished_stock_qty=float(stock_qty),
        minimum_stock_target_qty=float(min_qty),
        stock_after_customer_issue_qty=float(sp["stock_after_customer_issue_qty"]),
        future_stock_after_wip_qty=float(future_full_wip),
        wip_covers_minimum_after_customer_issue=bool(wip_covers_minimum),
    )


def wip_primary_restock_po_for_plan(
    db: Session,
    it: "JobItem",
    has_portfolio: bool,
) -> "ProductionOrder | None":
    from app.api.orders import _primary_open_restock_po_for_job_item_gpn

    return _primary_open_restock_po_for_job_item_gpn(db, it, has_portfolio)
