"""Tests for pure material issue length allocation (Step 4A)."""

from __future__ import annotations

from datetime import datetime, timezone

from app.services.material_issue_allocation_engine import (
    AllocationErrorCode,
    ReceiptUnitSnapshot,
    RemnantStockSnapshot,
    allocate_material_issue_by_receipt_units,
    allocate_material_issue_with_remnants,
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


def _r(rid: int, mm: float, *, heat_lot: str | None = None) -> RemnantStockSnapshot:
    return RemnantStockSnapshot(
        id=rid,
        qty=mm,
        source_receipt_unit_id=rid + 100,
        source_stock_item_id=rid + 200,
        received_at=datetime(2026, 1, rid, tzinfo=timezone.utc),
        created_at=datetime(2026, 2, rid, tzinfo=timezone.utc),
        heat_lot=heat_lot,
        certificate_no=None,
        delivery_note_no=None,
    )


def test_remnant_best_fit_satisfies_issue_before_receipt_units():
    res = allocate_material_issue_with_remnants(
        requested_finished_piece_count=1,
        delka_na_kus_mm=100.0,
        vyrabeno_po=1,
        na_upnuti_mm=10.0,
        prorez_mm=3.0,
        povolit_deleni_polotovaru=True,
        minimalni_zbytek_pouzitelny_mm=0.0,
        minimalni_vydavana_delka_mm=0.0,
        remnant_stock_items=[_r(1, 500.0, heat_lot="A"), _r(2, 120.0, heat_lot="B")],
        receipt_units=[_u(1, 1000.0)],
    )

    assert res.ok
    assert res.demand_total_mm == 113.0
    assert len(res.lines) == 1
    assert res.lines[0].source_type == "remnant"
    assert res.lines[0].movement_type == "vydej_zbytek"
    assert res.lines[0].remnant_stock_item_id == 2
    assert res.lines[0].heat_lot == "B"
    assert res.lines[0].allocated_mm == 113.0


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
    assert abs(res.lines[0].cut_length_mm - 206.0) < 1e-6
    assert res.lines[0].cut_count == 4
    assert res.lines[0].segment == "full_batches"
    assert res.lines[1].receipt_unit_id == 2
    assert abs(res.lines[1].allocated_mm - 206.0) < 1e-6
    assert res.lines[1].finished_piece_count == 2
    assert abs(res.lines[1].cut_length_mm - 206.0) < 1e-6
    assert res.lines[1].cut_count == 1
    assert res.lines[2].receipt_unit_id == 1
    assert abs(res.lines[2].allocated_mm - 103.0) < 1e-6
    assert res.lines[2].finished_piece_count == 1
    assert abs(res.lines[2].cut_length_mm - 103.0) < 1e-6
    assert res.lines[2].cut_count == 1
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


def test_real_saw_cut_lengths_allocate_by_cut_not_net_piece_length():
    units = [
        ReceiptUnitSnapshot(
            id=1,
            remaining_qty=1000.0,
            received_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
            heat_lot="A",
        ),
        ReceiptUnitSnapshot(
            id=2,
            remaining_qty=1000.0,
            received_at=datetime(2026, 1, 2, tzinfo=timezone.utc),
            heat_lot="B",
        ),
    ]
    res = allocate_material_issue_by_receipt_units(
        requested_finished_piece_count=10,
        delka_na_kus_mm=100.0,
        vyrabeno_po=3,
        na_upnuti_mm=10.0,
        prorez_mm=3.0,
        povolit_deleni_polotovaru=True,
        minimalni_zbytek_pouzitelny_mm=0.0,
        minimalni_vydavana_delka_mm=0.0,
        receipt_units=units,
    )

    assert res.ok
    assert res.full_batches == 3
    assert res.remainder_pieces == 1
    assert abs(res.polotovar_length_mm - 313.0) < 1e-6
    assert abs(res.demand_total_mm - 1052.0) < 1e-6
    assert len(res.lines) == 2
    assert (
        res.lines[0].receipt_unit_id,
        res.lines[0].heat_lot,
        res.lines[0].cut_length_mm,
        res.lines[0].cut_count,
        res.lines[0].allocated_mm,
    ) == (1, "A", 313.0, 3, 939.0)
    assert (
        res.lines[1].receipt_unit_id,
        res.lines[1].heat_lot,
        res.lines[1].cut_length_mm,
        res.lines[1].cut_count,
        res.lines[1].allocated_mm,
    ) == (2, "B", 113.0, 1, 113.0)
    assert 1000.0 - res.lines[0].allocated_mm == 61.0
    assert 1000.0 - res.lines[1].allocated_mm == 887.0


if __name__ == "__main__":
    test_remnant_best_fit_satisfies_issue_before_receipt_units()
    test_canonical_eleven_pieces_two_bars_fifo()
    test_remainder_without_split_fails()
    test_insufficient_for_full_polotovar()
    test_min_zbytek_forces_second_bar_for_second_polotovar_partial_from_first_bar()
    test_real_saw_cut_lengths_allocate_by_cut_not_net_piece_length()
    print("ok")
