"""Tests for pure material issue length allocation (Step 4A)."""

from __future__ import annotations

from datetime import datetime, timezone

from app.services.material_issue_allocation_engine import (
    AllocationErrorCode,
    ReceiptUnitSnapshot,
    allocate_material_issue_by_receipt_units,
)


def _u(uid: int, mm: float, *, received_at: datetime | None = None) -> ReceiptUnitSnapshot:
    return ReceiptUnitSnapshot(
        id=uid,
        remaining_qty=mm,
        received_at=received_at or datetime(2026, 1, uid, tzinfo=timezone.utc),
        heat_lot=None,
        certificate_no=None,
        delivery_note_no=None,
    )


def test_canonical_eleven_pieces_two_bars_fifo():
    """AKENG example: A 1000, B 1000; 103 mm/pc, vyrabeno_po=2, qty=11, split allowed."""
    units = [
        _u(1, 1000.0, received_at=datetime(2026, 1, 1, tzinfo=timezone.utc)),
        _u(2, 1000.0, received_at=datetime(2026, 1, 2, tzinfo=timezone.utc)),
    ]
    res = allocate_material_issue_by_receipt_units(
        requested_finished_piece_count=11,
        delka_na_kus_mm=103.0,
        vyrabeno_po=2,
        povolit_deleni_polotovaru=True,
        minimalni_zbytek_pouzitelny_mm=0.0,
        minimalni_vydavana_delka_mm=0.0,
        receipt_units=units,
    )
    assert res.ok
    assert res.error_code == AllocationErrorCode.OK
    assert res.polotovar_length_mm == 206.0
    assert res.full_batches == 5
    assert res.remainder_pieces == 1
    assert abs(res.demand_total_mm - 11 * 103.0) < 1e-6
    assert len(res.lines) == 3
    assert res.lines[0].receipt_unit_id == 1
    assert abs(res.lines[0].allocated_mm - 824.0) < 1e-6
    assert res.lines[0].finished_piece_count == 8
    assert res.lines[0].segment == "full_batches"
    assert res.lines[1].receipt_unit_id == 2
    assert abs(res.lines[1].allocated_mm - 206.0) < 1e-6
    assert res.lines[1].finished_piece_count == 2
    assert res.lines[2].receipt_unit_id == 1
    assert abs(res.lines[2].allocated_mm - 103.0) < 1e-6
    assert res.lines[2].finished_piece_count == 1
    assert res.lines[2].segment == "partial_remainder"


def test_remainder_without_split_fails():
    res = allocate_material_issue_by_receipt_units(
        requested_finished_piece_count=3,
        delka_na_kus_mm=100.0,
        vyrabeno_po=2,
        povolit_deleni_polotovaru=False,
        minimalni_zbytek_pouzitelny_mm=0.0,
        minimalni_vydavana_delka_mm=0.0,
        receipt_units=[_u(1, 10_000.0)],
    )
    assert not res.ok
    assert res.error_code == AllocationErrorCode.REMAINDER_SPLIT_NOT_ALLOWED


def test_insufficient_for_full_polotovar():
    res = allocate_material_issue_by_receipt_units(
        requested_finished_piece_count=4,
        delka_na_kus_mm=100.0,
        vyrabeno_po=2,
        povolit_deleni_polotovaru=True,
        minimalni_zbytek_pouzitelny_mm=0.0,
        minimalni_vydavana_delka_mm=0.0,
        receipt_units=[_u(1, 150.0)],
    )
    assert not res.ok
    assert res.error_code == AllocationErrorCode.INSUFFICIENT_STOCK


def test_min_zbytek_forces_second_bar_for_second_polotovar_partial_from_first_bar():
    """
    min_zbytek 650: second 200 mm polotovar on 1000 mm bar would leave 600 (<650),
    so second full polotovar comes from bar B; partial FIFO from bar A (800 -> 700).
    """
    units = [
        _u(1, 1000.0, received_at=datetime(2026, 1, 1, tzinfo=timezone.utc)),
        _u(2, 1000.0, received_at=datetime(2026, 1, 2, tzinfo=timezone.utc)),
    ]
    res = allocate_material_issue_by_receipt_units(
        requested_finished_piece_count=5,
        delka_na_kus_mm=100.0,
        vyrabeno_po=2,
        povolit_deleni_polotovaru=True,
        minimalni_zbytek_pouzitelny_mm=650.0,
        minimalni_vydavana_delka_mm=0.0,
        receipt_units=units,
    )
    assert res.ok
    assert res.full_batches == 2
    assert res.remainder_pieces == 1
    assert len(res.lines) == 3
    assert abs(res.lines[0].allocated_mm - 200.0) < 1e-6
    assert res.lines[0].receipt_unit_id == 1
    assert res.lines[1].receipt_unit_id == 2
    assert abs(res.lines[1].allocated_mm - 200.0) < 1e-6
    assert res.lines[2].segment == "partial_remainder"
    assert abs(res.lines[2].allocated_mm - 100.0) < 1e-6
    assert res.lines[2].receipt_unit_id == 1


if __name__ == "__main__":
    test_canonical_eleven_pieces_two_bars_fifo()
    test_remainder_without_split_fails()
    test_insufficient_for_full_polotovar()
    test_min_zbytek_forces_second_bar_for_second_polotovar_partial_from_first_bar()
    print("ok")
