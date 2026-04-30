"""Tests for heuristic material issue reallocation suggestions."""

from __future__ import annotations

from datetime import datetime, timezone

from app.services.material_issue_allocation_engine import AllocationErrorCode, AllocationResult, ReceiptUnitSnapshot
from app.services.material_issue_suggestion import build_material_issue_suggestion


def _u(uid: int, mm: float, *, received_at: datetime | None = None) -> ReceiptUnitSnapshot:
    return ReceiptUnitSnapshot(
        id=uid,
        remaining_qty=mm,
        received_at=received_at or datetime(2026, 1, uid, tzinfo=timezone.utc),
        heat_lot=None,
        certificate_no=None,
        delivery_note_no=None,
    )


def test_suggestion_three_full_one_partial_short_last_full_bar():
    """
    Same cut math as allocation engine test; stock fragmented so FIFO fails but totals suffice.
    61 + 887 + 113 mm; demand 313*3 + 113.
    """
    alloc = AllocationResult(
        ok=False,
        demand_total_mm=1052.0,
        polotovar_length_mm=313.0,
        full_batches=3,
        remainder_pieces=1,
        lines=[],
        error_code=AllocationErrorCode.INSUFFICIENT_STOCK,
        message="fifo fail",
    )
    sug = build_material_issue_suggestion(
        alloc,
        requested_finished_piece_count=10,
        delka_na_kus_mm=100.0,
        vyrabeno_po=3,
        na_upnuti_mm=10.0,
        prorez_mm=3.0,
        povolit_deleni_polotovaru=True,
        minimalni_zbytek_pouzitelny_mm=0.0,
        minimalni_vydavana_delka_mm=0.0,
        remnant_stock_items=[],
        receipt_units=[
            _u(1, 61.0),
            _u(2, 887.0),
            _u(3, 113.0),
        ],
    )
    assert sug is not None
    assert sug["usable_now"] == [{"cut_length_mm": 313.0, "cut_count": 2}, {"cut_length_mm": 113.0, "cut_count": 1}]
    assert sug["missing"] == [{"cut_length_mm": 313.0, "cut_count": 1}]
    assert isinstance(sug["recommendation"], str) and "313" in sug["recommendation"]
