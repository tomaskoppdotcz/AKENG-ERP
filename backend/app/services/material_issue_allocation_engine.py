"""
Pure allocation engine for material issue by length (mm) on receipt units.

No database access or side effects. Intended for Step 4A planning only.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Literal


class AllocationErrorCode(str, Enum):
    OK = "ok"
    INVALID_INPUT = "invalid_input"
    NO_RECEIPT_UNITS = "no_receipt_units"
    INSUFFICIENT_STOCK = "insufficient_stock"
    REMAINDER_SPLIT_NOT_ALLOWED = "remainder_split_not_allowed"
    MIN_ISSUE_LENGTH = "min_issue_length"
    MIN_REMAINDER_USABLE = "min_remainder_usable"


@dataclass(frozen=True)
class ReceiptUnitSnapshot:
    """FIFO-ordered snapshot of one receipt unit (remaining length in mm)."""

    id: int
    remaining_qty: float
    received_at: datetime
    heat_lot: str | None = None
    certificate_no: str | None = None
    delivery_note_no: str | None = None


@dataclass
class AllocationLine:
    """One issue line; always exactly one receipt unit (rule 6)."""

    receipt_unit_id: int
    allocated_mm: float
    finished_piece_count: int
    segment: Literal["full_batches", "partial_remainder"]
    heat_lot: str | None = None
    certificate_no: str | None = None
    delivery_note_no: str | None = None


@dataclass
class AllocationResult:
    ok: bool
    demand_total_mm: float
    polotovar_length_mm: float
    full_batches: int
    remainder_pieces: int
    lines: list[AllocationLine] = field(default_factory=list)
    error_code: AllocationErrorCode = AllocationErrorCode.OK
    message: str = ""


_EPS = 1e-6


def _leftover_after_take(remaining_before: float, take: float) -> float:
    return remaining_before - take


def _take_is_residue_valid(remaining_before: float, take: float, minimalni_zbytek_pouzitelny_mm: float) -> bool:
    if take < -_EPS or take > remaining_before + _EPS:
        return False
    left = _leftover_after_take(remaining_before, take)
    if left <= _EPS:
        return True
    return left + _EPS >= minimalni_zbytek_pouzitelny_mm


def _issue_length_allowed(take: float, minimalni_vydavana_delka_mm: float) -> bool:
    if take <= _EPS:
        return False
    return take + _EPS >= minimalni_vydavana_delka_mm


def allocate_material_issue_by_receipt_units(
    *,
    requested_finished_piece_count: int,
    delka_na_kus_mm: float,
    vyrabeno_po: int,
    povolit_deleni_polotovaru: bool,
    minimalni_zbytek_pouzitelny_mm: float,
    minimalni_vydavana_delka_mm: float,
    receipt_units: list[ReceiptUnitSnapshot],
) -> AllocationResult:
    """
    Algorithm (high level):

    1. ``polotovar_length_mm = delka_na_kus_mm * vyrabeno_po``.
    2. ``full_batches = qty // vyrabeno_po``, ``remainder_pieces = qty % vyrabeno_po``.
    3. ``demand_total_mm = qty * delka_na_kus_mm`` (total length for all finished pieces).
    4. Sort receipt units FIFO: ``received_at``, then ``id``.
    5. Full polotovars (``full_batches`` times): each consumption is exactly one
       ``polotovar_length_mm`` from a single unit. Pick the first FIFO unit that can supply
       that length while respecting ``minimalni_zbytek_pouzitelny_mm`` and
       ``minimalni_vydavana_delka_mm``. Consecutive full-batch pulls from the *same* unit are
       merged into one line; switching to another unit and later returning creates a new line
       (rule 6 still holds: one receipt unit per line).
    6. If ``remainder_pieces > 0`` and splitting is allowed, allocate
       ``remainder_pieces * delka_na_kus_mm`` as one ``partial_remainder`` line from the first
       FIFO unit that still has enough length and valid residue. If splitting is not allowed, fail.
    """
    qty = int(requested_finished_piece_count)
    vpo = int(vyrabeno_po)

    def fail(code: AllocationErrorCode, msg: str, **kwargs) -> AllocationResult:
        base = dict(
            ok=False,
            demand_total_mm=float(qty) * float(delka_na_kus_mm) if qty > 0 and delka_na_kus_mm > 0 else 0.0,
            polotovar_length_mm=float(delka_na_kus_mm) * vpo if delka_na_kus_mm > 0 and vpo > 0 else 0.0,
            full_batches=qty // vpo if vpo > 0 else 0,
            remainder_pieces=qty % vpo if vpo > 0 else 0,
            lines=[],
            error_code=code,
            message=msg,
        )
        base.update(kwargs)
        return AllocationResult(**base)

    if qty < 0 or delka_na_kus_mm <= _EPS or vpo <= 0:
        return fail(AllocationErrorCode.INVALID_INPUT, "Neplatné vstupy: qty, delka_na_kus_mm nebo vyrabeno_po.")
    if minimalni_zbytek_pouzitelny_mm < 0 or minimalni_vydavana_delka_mm < 0:
        return fail(AllocationErrorCode.INVALID_INPUT, "Minimální limity nesmí být záporné.")

    polotovar_length = float(delka_na_kus_mm) * vpo
    full_batches = qty // vpo
    remainder_pieces = qty % vpo
    demand_total_mm = float(qty) * float(delka_na_kus_mm)

    if not receipt_units:
        return fail(
            AllocationErrorCode.NO_RECEIPT_UNITS,
            "Žádné příjemové jednotky.",
            demand_total_mm=demand_total_mm,
            polotovar_length_mm=polotovar_length,
            full_batches=full_batches,
            remainder_pieces=remainder_pieces,
        )

    if remainder_pieces > 0 and not povolit_deleni_polotovaru:
        return fail(
            AllocationErrorCode.REMAINDER_SPLIT_NOT_ALLOWED,
            "Zakázka vyžaduje nedoplněný polotovar, dělení polotovaru není povoleno.",
            demand_total_mm=demand_total_mm,
            polotovar_length_mm=polotovar_length,
            full_batches=full_batches,
            remainder_pieces=remainder_pieces,
        )

    if not _issue_length_allowed(polotovar_length, minimalni_vydavana_delka_mm):
        return fail(
            AllocationErrorCode.MIN_ISSUE_LENGTH,
            f"Délka polotovaru {polotovar_length:.3f} mm je pod minimální vydávanou délkou.",
            demand_total_mm=demand_total_mm,
            polotovar_length_mm=polotovar_length,
            full_batches=full_batches,
            remainder_pieces=remainder_pieces,
        )

    ordered = sorted(receipt_units, key=lambda u: (u.received_at, u.id))
    remaining: dict[int, float] = {int(u.id): float(u.remaining_qty) for u in ordered}
    meta: dict[int, ReceiptUnitSnapshot] = {int(u.id): u for u in ordered}

    lines: list[AllocationLine] = []

    def flush_mergeable(
        current_id: int | None,
        acc_mm: float,
        acc_pcs: int,
    ) -> tuple[int | None, float, int]:
        if current_id is None or acc_mm <= _EPS:
            return None, 0.0, 0
        u = meta[current_id]
        lines.append(
            AllocationLine(
                receipt_unit_id=current_id,
                allocated_mm=acc_mm,
                finished_piece_count=acc_pcs,
                segment="full_batches",
                heat_lot=u.heat_lot,
                certificate_no=u.certificate_no,
                delivery_note_no=u.delivery_note_no,
            )
        )
        return None, 0.0, 0

    cur_unit: int | None = None
    cur_mm = 0.0
    cur_pcs = 0

    for _ in range(full_batches):
        placed = False
        for u in ordered:
            rid = int(u.id)
            rem = remaining.get(rid, 0.0)
            if rem < polotovar_length - _EPS:
                continue
            if not _take_is_residue_valid(rem, polotovar_length, minimalni_zbytek_pouzitelny_mm):
                continue
            if not _issue_length_allowed(polotovar_length, minimalni_vydavana_delka_mm):
                continue
            remaining[rid] = rem - polotovar_length
            if cur_unit is not None and cur_unit != rid:
                cur_unit, cur_mm, cur_pcs = flush_mergeable(cur_unit, cur_mm, cur_pcs)
            cur_unit = rid
            cur_mm += polotovar_length
            cur_pcs += vpo
            placed = True
            break
        if not placed:
            cur_unit, cur_mm, cur_pcs = flush_mergeable(cur_unit, cur_mm, cur_pcs)
            return fail(
                AllocationErrorCode.INSUFFICIENT_STOCK,
                "Nedostatek materiálu pro celé polotovary podle FIFO a zbytkových pravidel.",
                demand_total_mm=demand_total_mm,
                polotovar_length_mm=polotovar_length,
                full_batches=full_batches,
                remainder_pieces=remainder_pieces,
                lines=lines,
            )

    cur_unit, cur_mm, cur_pcs = flush_mergeable(cur_unit, cur_mm, cur_pcs)

    if remainder_pieces > 0:
        partial_need = float(remainder_pieces) * float(delka_na_kus_mm)
        if partial_need > _EPS:
            if not _issue_length_allowed(partial_need, minimalni_vydavana_delka_mm):
                return fail(
                    AllocationErrorCode.MIN_ISSUE_LENGTH,
                    f"Délka zbytku {partial_need:.3f} mm je pod minimální vydávanou délkou.",
                    demand_total_mm=demand_total_mm,
                    polotovar_length_mm=polotovar_length,
                    full_batches=full_batches,
                    remainder_pieces=remainder_pieces,
                    lines=lines,
                )
            placed_partial = False
            for u in ordered:
                rid = int(u.id)
                rem = remaining.get(rid, 0.0)
                if rem < partial_need - _EPS:
                    continue
                if not _take_is_residue_valid(rem, partial_need, minimalni_zbytek_pouzitelny_mm):
                    continue
                if not _issue_length_allowed(partial_need, minimalni_vydavana_delka_mm):
                    continue
                remaining[rid] = rem - partial_need
                umeta = meta[rid]
                lines.append(
                    AllocationLine(
                        receipt_unit_id=rid,
                        allocated_mm=partial_need,
                        finished_piece_count=remainder_pieces,
                        segment="partial_remainder",
                        heat_lot=umeta.heat_lot,
                        certificate_no=umeta.certificate_no,
                        delivery_note_no=umeta.delivery_note_no,
                    )
                )
                placed_partial = True
                break
            if not placed_partial:
                return fail(
                    AllocationErrorCode.MIN_REMAINDER_USABLE,
                    "Nelze vydat zbytek kusů z jedné příjemové jednotky podle FIFO a zbytkových pravidel.",
                    demand_total_mm=demand_total_mm,
                    polotovar_length_mm=polotovar_length,
                    full_batches=full_batches,
                    remainder_pieces=remainder_pieces,
                    lines=lines,
                )

    return AllocationResult(
        ok=True,
        demand_total_mm=demand_total_mm,
        polotovar_length_mm=polotovar_length,
        full_batches=full_batches,
        remainder_pieces=remainder_pieces,
        lines=lines,
        error_code=AllocationErrorCode.OK,
        message="",
    )
