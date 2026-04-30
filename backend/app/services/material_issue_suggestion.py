"""
Heuristic suggestions when FIFO material-issue allocation fails.

Does not relax TP rules: one contiguous cut per receipt unit or remnant.
Uses alternate cut order (remainder vs batches first) and best-fit pooling to estimate
what could be issued manually and what to order.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any

from app.services.material_issue_allocation_engine import (
    AllocationErrorCode,
    AllocationResult,
    ReceiptUnitSnapshot,
    RemnantStockSnapshot,
    _EPS,
    _issue_length_allowed,
    _take_is_residue_valid,
)

_KEY_ROUND = 3


def _agg_counts(lengths: list[float]) -> list[dict[str, float | int]]:
    buckets: dict[float, int] = {}
    for x in lengths:
        k = round(float(x), _KEY_ROUND)
        buckets[k] = buckets.get(k, 0) + 1
    return [
        {"cut_length_mm": k, "cut_count": c}
        for k, c in sorted(buckets.items(), key=lambda t: (-t[0], t[1]))
    ]


def _fmt_mm(n: float) -> str:
    if abs(n - round(n)) < 0.001:
        return f"{round(n)}"
    return f"{n:.1f}".rstrip("0").rstrip(".")


def _recommend_cs(
    *,
    missing: list[dict[str, float | int]],
    polotovar_length_mm: float,
    deficit_mm: float,
    total_stock_mm: float,
    demand_mm: float,
) -> str:
    parts: list[str] = []
    if total_stock_mm + _EPS < demand_mm:
        parts.append(f"Dostupných je zhruba {_fmt_mm(total_stock_mm)} mm oproti potřebě {_fmt_mm(demand_mm)} mm.")
    fb_missing = sum(
        int(row["cut_count"])
        for row in missing
        if abs(float(row["cut_length_mm"]) - polotovar_length_mm) < 1e-3
    )
    if fb_missing > 0 and polotovar_length_mm > _EPS:
        parts.append(
            f"OBJEDNAT: doplněte asi {fb_missing}× vstupní délku řezu {_fmt_mm(polotovar_length_mm)} mm (polotovar), "
        )
        parts.append(
            f"tj. nabízející součet řezných úseků cca {_fmt_mm(fb_missing * polotovar_length_mm)} mm "
        )
        parts.append("(nebo jednu delší tyč dostatečnou pro více řezů).")
        if deficit_mm > _EPS:
            parts.append(f" Mezera oproti dostupnému je cca {_fmt_mm(deficit_mm)} mm řezných délek.")
    extra = [row for row in missing if abs(float(row["cut_length_mm"]) - polotovar_length_mm) >= 1e-3]
    if extra:
        parts.append(
            " Doplňte také zbytkové řezy podle sloupce „Chybí“, nebo zkontrolujte minimální vydávanou délku TP."
        )
    parts.append(
        " Jeden řez vždy z jedné tyče / zbytku; slepení několika kratších vstupů by TP neumožňoval."
    )
    return "".join(parts).strip()


@dataclass(frozen=True)
class _Pool:
    kind: str
    pid: str
    remaining: float
    received_at: datetime
    created_at: datetime
    pool_id_sort: tuple[str | int, ...]


def _build_pools(
    remnant_stock_items: list[RemnantStockSnapshot],
    receipt_units: list[ReceiptUnitSnapshot],
) -> list[_Pool]:
    pools: list[_Pool] = []
    for r in remnant_stock_items:
        q = float(r.qty or 0.0)
        if q <= _EPS:
            continue
        pools.append(
            _Pool(
                kind="remnant",
                pid=f"r{int(r.id)}",
                remaining=q,
                received_at=r.received_at,
                created_at=r.created_at,
                pool_id_sort=("remnant", int(r.id)),
            )
        )
    receipt_sorted = sorted(receipt_units, key=lambda u: (u.received_at, int(u.id)))
    for u in receipt_sorted:
        q = float(u.remaining_qty or 0.0)
        if q <= _EPS:
            continue
        pools.append(
            _Pool(
                kind="receipt_unit",
                pid=f"u{int(u.id)}",
                remaining=q,
                received_at=u.received_at,
                created_at=u.received_at,
                pool_id_sort=("receipt_unit", int(u.id)),
            )
        )
    return pools


def _simulate_cut_order(
    pools: list[_Pool],
    cut_order: list[tuple[float, str]],
    *,
    minimalni_zbytek_pouzitelny_mm: float,
    minimalni_vydavana_delka_mm: float,
) -> tuple[list[float], list[float]]:
    state: dict[str, float] = {p.pid: float(p.remaining) for p in pools}
    satisfied: list[float] = []
    missing: list[float] = []

    for seg_len, _seg in cut_order:
        if not _issue_length_allowed(seg_len, minimalni_vydavana_delka_mm):
            missing.append(seg_len)
            continue
        best_pid: str | None = None
        best_key: tuple[Any, ...] | None = None
        for p in pools:
            rem = float(state[p.pid])
            if rem + _EPS < seg_len:
                continue
            if not _take_is_residue_valid(rem, seg_len, minimalni_zbytek_pouzitelny_mm):
                continue
            is_exact = abs(rem - seg_len) <= _EPS
            slack = rem - seg_len
            key = (
                0 if is_exact else 1,
                slack,
                p.received_at,
                p.created_at,
                p.pool_id_sort,
            )
            if best_key is None or key < best_key:
                best_key = key
                best_pid = p.pid
        if best_pid is None:
            missing.append(seg_len)
        else:
            state[best_pid] = max(0.0, float(state[best_pid]) - float(seg_len))
            satisfied.append(seg_len)
    return satisfied, missing


def build_material_issue_suggestion(
    alloc: AllocationResult,
    *,
    requested_finished_piece_count: int,
    delka_na_kus_mm: float,
    vyrabeno_po: int,
    povolit_deleni_polotovaru: bool,
    minimalni_zbytek_pouzitelny_mm: float,
    minimalni_vydavana_delka_mm: float,
    remnant_stock_items: list[RemnantStockSnapshot],
    receipt_units: list[ReceiptUnitSnapshot],
    na_upnuti_mm: float = 0.0,
    prorez_mm: float = 0.0,
) -> dict[str, Any] | None:
    """
    Returns a suggestion dict when FIFO allocation fails, or None if not applicable.
    """
    if alloc.error_code in (
        AllocationErrorCode.OK,
        AllocationErrorCode.INVALID_INPUT,
        AllocationErrorCode.REMAINDER_SPLIT_NOT_ALLOWED,
        AllocationErrorCode.MIN_ISSUE_LENGTH,
        AllocationErrorCode.NO_RECEIPT_UNITS,
    ):
        return None

    qty = int(requested_finished_piece_count)
    vpo = int(vyrabeno_po)
    upnuti = float(na_upnuti_mm)
    prorez = float(prorez_mm)

    polotovar_length = float(delka_na_kus_mm) * vpo + upnuti + prorez
    full_batches = qty // vpo if vpo > 0 else 0
    remainder_pieces = qty % vpo if vpo > 0 else 0

    partial_need = (
        float(remainder_pieces) * float(delka_na_kus_mm) + upnuti + prorez if remainder_pieces > 0 else 0.0
    )

    if remainder_pieces > 0 and not povolit_deleni_polotovaru:
        return None

    partial_list: list[tuple[float, str]] = (
        [(partial_need, "partial_remainder")] if remainder_pieces > 0 and partial_need > _EPS else []
    )
    batch_list: list[tuple[float, str]] = [(polotovar_length, "full_batches") for _ in range(full_batches)]
    order_partial_first = partial_list + batch_list
    order_batches_first = batch_list + partial_list

    pools = _build_pools(remnant_stock_items, receipt_units)
    if not pools:
        return None

    total_stock_mm = sum(p.remaining for p in pools)
    demand_mm = sum(c[0] for c in order_partial_first)

    sims = [
        _simulate_cut_order(
            pools,
            order_partial_first,
            minimalni_zbytek_pouzitelny_mm=minimalni_zbytek_pouzitelny_mm,
            minimalni_vydavana_delka_mm=minimalni_vydavana_delka_mm,
        ),
        _simulate_cut_order(
            _build_pools(remnant_stock_items, receipt_units),
            order_batches_first,
            minimalni_zbytek_pouzitelny_mm=minimalni_zbytek_pouzitelny_mm,
            minimalni_vydavana_delka_mm=minimalni_vydavana_delka_mm,
        ),
    ]

    best = max(sims, key=lambda t: (len(t[0]), -len(t[1])))
    satisfied, missing_list = best

    usable = _agg_counts(satisfied)
    missing = _agg_counts(missing_list)

    deficit_mm = max(0.0, demand_mm - total_stock_mm)

    reason = alloc.message.strip() if (alloc.message or "").strip() else ""

    if alloc.error_code == AllocationErrorCode.INSUFFICIENT_STOCK:
        fifo_reason = "Nedostatek souvislého materiálu na jednotlivých tyčích pro všechny řezy při výchozím FIFO pořadí."
    elif alloc.error_code == AllocationErrorCode.MIN_REMAINDER_USABLE:
        fifo_reason = "Nelze vydat všechny řezy z jedné tyče podle výchozího FIFO pořadí a zbytkových limitů TP."
    else:
        fifo_reason = "Nelze automaticky složit kompletní výdej podle výchozího FIFO pořadí."

    detail_reason = fifo_reason + (
        (" " + reason) if reason and reason not in fifo_reason else ""
    )

    return {
        "can_issue": False,
        "reason": detail_reason,
        "fifo_blocks": True,
        "alternate_order_tried": True,
        "usable_now": usable,
        "missing": missing,
        "recommendation": _recommend_cs(
            missing=missing,
            polotovar_length_mm=polotovar_length,
            deficit_mm=deficit_mm,
            total_stock_mm=total_stock_mm,
            demand_mm=demand_mm,
        ),
        "totals_mm": {
            "demand_mm": round(demand_mm, _KEY_ROUND),
            "available_stock_mm": round(total_stock_mm, _KEY_ROUND),
        },
        "single_bar_per_cut": True,
        "mixing_heat_lots_per_cut": False,
    }
