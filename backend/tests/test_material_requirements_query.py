from __future__ import annotations

from datetime import datetime, timezone

import app.main  # noqa: F401
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.models.base import Base
from app.models.material_library import MaterialLibraryItem
from app.models.material_stock import MaterialReservation, MaterialStockItem, MaterialStockMovement
from app.models.orders import Job, JobItem, ProductionOrder
from app.models.planning import PlanningOperation
from app.services.material_issue_allocation_engine import ReceiptUnitSnapshot, RemnantStockSnapshot
from app.services.material_requirements_query import (
    _cutting_required_qty,
    _cutting_purchase_shortage,
    _dummy_receipt_snapshot_for_tests,
    build_standard_material_requirements,
    build_vp_material_requirements,
)


def _session_factory():
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)


def test_cutting_required_qty_includes_batches_clamp_and_kerf():
    assert (
        _cutting_required_qty(
            requested_piece_count=10,
            delka_na_kus_mm=100.0,
            vyrabeno_po=3,
            na_upnuti_mm=10.0,
            prorez_mm=3.0,
        )
        == 1052.0
    )


def test_cutting_required_qty_omits_remainder_cut_when_exact_batch():
    assert (
        _cutting_required_qty(
            requested_piece_count=6,
            delka_na_kus_mm=100.0,
            vyrabeno_po=3,
            na_upnuti_mm=10.0,
            prorez_mm=3.0,
        )
        == 626.0
    )


def test_cutting_purchase_shortage_sequential_on_one_bar_needs_remainder_only():
    """948 mm: three 313 cuts fit (939 mm); remainder 113 must be bought or another bar."""
    result = _cutting_purchase_shortage(
        requested_piece_count=10,
        delka_na_kus_mm=100.0,
        vyrabeno_po=3,
        na_upnuti_mm=10.0,
        prorez_mm=3.0,
        receipt_unit_snapshots=[_dummy_receipt_snapshot_for_tests(948.0)],
        remnant_snapshots=[],
        cutting_extra_params=None,
        available_qty_mm_fallback=948.0,
    )

    assert result is not None
    assert result["required_qty_total_mm"] == 1052.0
    assert result["raw_available_qty_mm"] == 948.0
    assert result["purchase_required_qty_mm"] == 113.0
    assert result["purchase_cut_plan"] == [
        {
            "cut_length_mm": 113.0,
            "cut_count": 1,
            "finished_pieces_per_cut": 1,
            "total_finished_pieces": 1,
        }
    ]


def test_cutting_purchase_shortage_A61_B887_one_bar_covers_remainder_buy_one_polotovar():
    """887 mm sequential: 2×313 then 113 same bar; missing one 313 → purchase 1×313 mm only."""
    r61 = ReceiptUnitSnapshot(
        id=1,
        remaining_qty=61.0,
        received_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
    )
    r887 = ReceiptUnitSnapshot(
        id=2,
        remaining_qty=887.0,
        received_at=datetime(2026, 1, 2, tzinfo=timezone.utc),
    )
    result = _cutting_purchase_shortage(
        requested_piece_count=10,
        delka_na_kus_mm=100.0,
        vyrabeno_po=3,
        na_upnuti_mm=10.0,
        prorez_mm=3.0,
        receipt_unit_snapshots=[r61, r887],
        remnant_snapshots=[],
        cutting_extra_params=None,
        available_qty_mm_fallback=948.0,
    )
    assert result is not None
    assert result["purchase_required_qty_mm"] == 313.0
    assert result["purchase_cut_plan"] == [
        {
            "cut_length_mm": 313.0,
            "cut_count": 1,
            "finished_pieces_per_cut": 3,
            "total_finished_pieces": 3,
        }
    ]
    assert result["usable_reserved_qty_mm"] == 739.0
    assert result["covered_piece_count"] == 7
    # From stock after grouping: two polotovar cuts + one remainder cut
    cur = {(round(x["cut_length_mm"], 3), x["cut_count"], x["finished_pieces_per_cut"]) for x in result["current_usable_cut_plan"]}
    assert cur == {(313.0, 2, 3), (113.0, 1, 1)}


def test_cutting_purchase_shortage_keeps_full_cuts_before_remainder():
    """Only one 313 mm bar → must buy two missing batch cuts plus remainder cut."""
    result = _cutting_purchase_shortage(
        requested_piece_count=10,
        delka_na_kus_mm=100.0,
        vyrabeno_po=3,
        na_upnuti_mm=10.0,
        prorez_mm=3.0,
        receipt_unit_snapshots=[_dummy_receipt_snapshot_for_tests(313.0)],
        remnant_snapshots=[],
        cutting_extra_params=None,
        available_qty_mm_fallback=313.0,
    )

    assert result is not None
    assert result["raw_available_qty_mm"] == 313.0
    assert result["usable_reserved_qty_mm"] == 313.0
    assert result["covered_piece_count"] == 3
    assert result["missing_piece_count"] == 7
    assert abs(result["purchase_required_qty_mm"] - 739.0) < 0.001
    assert result["purchase_cut_plan"] == [
        {
            "cut_length_mm": 313.0,
            "cut_count": 2,
            "finished_pieces_per_cut": 3,
            "total_finished_pieces": 6,
        },
        {
            "cut_length_mm": 113.0,
            "cut_count": 1,
            "finished_pieces_per_cut": 1,
            "total_finished_pieces": 1,
        },
    ]


def test_material_requirements_exclude_issued_or_started_production_orders():
    SessionLocal = _session_factory()
    with SessionLocal() as db:
        material = MaterialLibraryItem(
            code="MAT-REQ-1",
            name="Material",
            material_type="steel",
            form="bar",
            dimension="20 mm",
            unit="ks",
        )
        job = Job(zak_code="Z-REQ")
        db.add_all([material, job])
        db.flush()
        ji = JobItem(job_id=int(job.id), line_no=1, gpn="GPN-REQ", qty=2)
        db.add(ji)
        db.flush()

        issued_started_po = ProductionOrder(
            vp_code="VP-000001",
            job_item_id=int(ji.id),
            gpn="GPN-REQ",
            quantity=1,
            status="bezi",
        )
        planned_po = ProductionOrder(
            vp_code="VP-000002",
            job_item_id=int(ji.id),
            gpn="GPN-REQ",
            quantity=1,
            status="planned",
        )
        done_po = ProductionOrder(
            vp_code="VP-000003",
            job_item_id=int(ji.id),
            gpn="GPN-REQ",
            quantity=1,
            status="planned",
        )
        db.add_all([issued_started_po, planned_po, done_po])
        db.flush()

        db.add_all(
            [
                MaterialReservation(
                    material_library_item_id=int(material.id),
                    job_item_id=int(ji.id),
                    production_order_id=int(issued_started_po.id),
                    required_qty=10.0,
                    reserved_qty=0.0,
                    status="planned",
                    is_active=True,
                ),
                MaterialReservation(
                    material_library_item_id=int(material.id),
                    job_item_id=int(ji.id),
                    production_order_id=int(planned_po.id),
                    required_qty=20.0,
                    reserved_qty=0.0,
                    status="planned",
                    is_active=True,
                ),
                MaterialReservation(
                    material_library_item_id=int(material.id),
                    job_item_id=int(ji.id),
                    production_order_id=int(done_po.id),
                    required_qty=30.0,
                    reserved_qty=0.0,
                    status="planned",
                    is_active=True,
                ),
            ]
        )
        stock = MaterialStockItem(material_library_item_id=int(material.id), current_qty=0.0, unit="ks")
        db.add(stock)
        db.flush()
        db.add_all(
            [
                MaterialStockMovement(
                    stock_item_id=int(stock.id),
                    movement_type="vydej",
                    qty=10.0,
                    movement_date=datetime(2026, 1, 1, 8, 0, 0),
                    production_order_id=int(issued_started_po.id),
                    job_item_id=int(ji.id),
                ),
                PlanningOperation(
                    order_item_id=int(ji.id),
                    work_order_no="VP-000001",
                    gpn="GPN-REQ",
                    operation_name="Op",
                    operation_no=10,
                    qty=1,
                    actual_start=datetime(2026, 1, 1, 8, 30, 0),
                    status="bezi",
                ),
                PlanningOperation(
                    order_item_id=int(ji.id),
                    work_order_no="VP-000003",
                    gpn="GPN-REQ",
                    operation_name="Op",
                    operation_no=10,
                    qty=1,
                    status="hotovo",
                ),
            ]
        )
        db.commit()

        material_rows = build_standard_material_requirements(db)
        vp_rows = build_vp_material_requirements(db)

    assert len(material_rows) == 1
    assert material_rows[0]["required"] == 20.0
    assert material_rows[0]["shortage"] == 20.0
    assert [rel["vp_code"] for rel in material_rows[0]["related_orders"]] == ["VP-000002"]
    assert [row["vp_code"] for row in vp_rows] == ["VP-000002"]
