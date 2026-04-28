from __future__ import annotations

from datetime import datetime, timezone

from app.services.cutting_instructions_service import build_cutting_instructions_for_pila
from app.services.material_issue_allocation_engine import AllocationErrorCode, ReceiptUnitSnapshot


def _u(uid: int, mm: float, *, received_at: datetime | None = None) -> ReceiptUnitSnapshot:
    return ReceiptUnitSnapshot(
        id=uid,
        remaining_qty=mm,
        received_at=received_at or datetime(2026, 1, uid, tzinfo=timezone.utc),
        heat_lot=None,
        certificate_no=None,
        delivery_note_no=None,
    )


def test_cutting_instructions_grouped_from_allocation_segments():
    units = [
        _u(1, 1000.0, received_at=datetime(2026, 1, 1, tzinfo=timezone.utc)),
        _u(2, 1000.0, received_at=datetime(2026, 1, 2, tzinfo=timezone.utc)),
    ]
    res = build_cutting_instructions_for_pila(
        requested_piece_count=11,
        delka_na_kus_mm=103.0,
        vyrabeno_po=2,
        na_upnuti_mm=0.0,
        prorez_mm=0.0,
        povolit_deleni_polotovaru=True,
        receipt_units=units,
    )
    assert res.ok
    assert [ln.length_mm for ln in res.lines] == [206.0, 103.0]
    assert [ln.count for ln in res.lines] == [5, 1]
    assert [ln.heat_lot for ln in res.lines] == [None, None]
    assert (
        res.text
        == "Rezat:\n"
        "ATEST    Rozmer    Pocet\n"
        "-        206 mm    5x\n"
        "-        103 mm    1x"
    )


def test_same_length_from_different_heat_lots_stays_separate():
    units = [
        ReceiptUnitSnapshot(
            id=1,
            remaining_qty=1000.0,
            received_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
            heat_lot="A",
            certificate_no="CERT-A",
            delivery_note_no="DLV-A",
        ),
        ReceiptUnitSnapshot(
            id=2,
            remaining_qty=1000.0,
            received_at=datetime(2026, 1, 2, tzinfo=timezone.utc),
            heat_lot="B",
            certificate_no="CERT-B",
            delivery_note_no="DLV-B",
        ),
    ]
    res = build_cutting_instructions_for_pila(
        requested_piece_count=12,
        delka_na_kus_mm=106.5,
        vyrabeno_po=2,
        na_upnuti_mm=5.0,
        prorez_mm=2.0,
        povolit_deleni_polotovaru=True,
        receipt_units=units,
        material_label="1.4460 D81,4 (0720 0814)",
    )
    assert res.ok
    assert len(res.lines) == 2
    assert [(ln.heat_lot, ln.length_mm, ln.count) for ln in res.lines] == [
        ("A", 220.0, 4),
        ("B", 220.0, 2),
    ]
    assert "A        220 mm    4x" in res.text
    assert "B        220 mm    2x" in res.text
    assert res.text.startswith("Rezat:\n1.4460 D81,4 (0720 0814)\n\nATEST")


def test_same_heat_lot_and_same_length_aggregates():
    units = [_u(1, 1000.0)]
    units[0] = ReceiptUnitSnapshot(
        id=1,
        remaining_qty=1000.0,
        received_at=units[0].received_at,
        heat_lot="A",
        certificate_no="CERT-A",
        delivery_note_no="DLV-A",
    )
    res = build_cutting_instructions_for_pila(
        requested_piece_count=6,
        delka_na_kus_mm=106.5,
        vyrabeno_po=2,
        na_upnuti_mm=5.0,
        prorez_mm=2.0,
        povolit_deleni_polotovaru=True,
        receipt_units=units,
    )
    assert res.ok
    assert len(res.lines) == 1
    assert res.lines[0].heat_lot == "A"
    assert res.lines[0].count == 3
    assert abs(res.lines[0].length_mm - 220.0) < 1e-6


def test_remainder_cut_keeps_heat_lot_from_its_segment():
    units = [
        ReceiptUnitSnapshot(
            id=1,
            remaining_qty=1500.0,
            received_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
            heat_lot="A",
            certificate_no="CERT-A",
            delivery_note_no="DLV-A",
        ),
        ReceiptUnitSnapshot(
            id=2,
            remaining_qty=300.0,
            received_at=datetime(2026, 1, 2, tzinfo=timezone.utc),
            heat_lot="B",
            certificate_no="CERT-B",
            delivery_note_no="DLV-B",
        ),
    ]
    res = build_cutting_instructions_for_pila(
        requested_piece_count=11,
        delka_na_kus_mm=103.0,
        vyrabeno_po=2,
        na_upnuti_mm=0.0,
        prorez_mm=0.0,
        povolit_deleni_polotovaru=True,
        receipt_units=units,
    )
    assert res.ok
    # 11 pcs -> 5 full cuts (206 mm) + 1 remainder cut (103 mm); both come from lot A due to FIFO.
    assert [(ln.heat_lot, ln.length_mm, ln.count) for ln in res.lines] == [
        ("A", 206.0, 5),
        ("A", 103.0, 1),
    ]


def test_cutting_instructions_returns_allocation_error():
    units = [_u(1, 150.0)]
    res = build_cutting_instructions_for_pila(
        requested_piece_count=4,
        delka_na_kus_mm=100.0,
        vyrabeno_po=2,
        na_upnuti_mm=0.0,
        prorez_mm=0.0,
        povolit_deleni_polotovaru=True,
        receipt_units=units,
    )
    assert not res.ok
    assert res.error_code == AllocationErrorCode.INSUFFICIENT_STOCK
    assert res.text == ""
