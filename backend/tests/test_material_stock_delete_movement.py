"""Tests for deleting material issue movements linked to reservations."""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import create_engine, select, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api import material_stock as material_stock_api
from app.models.base import Base
from app.models.material_library import MaterialLibraryItem
from app.models.material_stock import (
    MaterialRemnantStockItem,
    MaterialReceiptUnit,
    MaterialReservation,
    MaterialStockItem,
    MaterialStockMovement,
    MaterialStockMovementAttachment,
)


def _session_factory():
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(
        engine,
        tables=[
            MaterialLibraryItem.__table__,
            MaterialStockItem.__table__,
            MaterialReceiptUnit.__table__,
            MaterialRemnantStockItem.__table__,
            MaterialReservation.__table__,
            MaterialStockMovement.__table__,
            MaterialStockMovementAttachment.__table__,
        ],
    )
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS production_orders (
                    id INTEGER PRIMARY KEY,
                    vp_code VARCHAR NOT NULL DEFAULT '',
                    scan_code VARCHAR(32),
                    job_item_id INTEGER,
                    customer_order_id INTEGER,
                    job_id INTEGER,
                    portfolio_item_id INTEGER,
                    gpn VARCHAR,
                    description VARCHAR,
                    quantity INTEGER,
                    logistic_mode VARCHAR,
                    source_type VARCHAR,
                    status VARCHAR,
                    workflow_status VARCHAR(20),
                    is_material_covered BOOLEAN NOT NULL DEFAULT 0,
                    is_material_released_to_production BOOLEAN NOT NULL DEFAULT 0,
                    is_material_ready BOOLEAN NOT NULL DEFAULT 0,
                    restock_redirected_from_internal BOOLEAN NOT NULL DEFAULT 0,
                    blocked_until_reserved_stock_receipt BOOLEAN NOT NULL DEFAULT 0
                )
                """
            )
        )
    return sessionmaker(bind=engine)


def test_delete_issue_restores_reservation_only_after_last_res_reference(monkeypatch, tmp_path):
    import app.services.material_readiness as material_readiness

    monkeypatch.setattr(material_stock_api, "_material_upload_root", lambda: tmp_path)
    monkeypatch.setattr(
        material_readiness,
        "refresh_material_readiness_for_material_library_item",
        lambda *args, **kwargs: None,
    )

    SessionLocal = _session_factory()
    with SessionLocal() as db:
        material = MaterialLibraryItem(
            code="MAT-DEL-1",
            name="Material for delete test",
            material_type="steel",
            form="bar",
            dimension="1000",
            unit="mm",
            is_active=True,
        )
        db.add(material)
        db.flush()

        stock = MaterialStockItem(
            material_library_item_id=int(material.id),
            current_qty=40.0,
            unit="mm",
            is_active=True,
        )
        db.add(stock)
        db.flush()

        reservation = MaterialReservation(
            material_library_item_id=int(material.id),
            job_item_id=10,
            production_order_id=20,
            required_qty=60.0,
            reserved_qty=60.0,
            status="issued",
            is_active=False,
        )
        db.add(reservation)
        db.flush()

        ref = f"RES-{int(reservation.id)}"
        unit_1 = MaterialReceiptUnit(
            stock_item_id=int(stock.id),
            received_qty=50.0,
            remaining_qty=20.0,
            uom="mm",
            received_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
            status="active",
        )
        unit_2 = MaterialReceiptUnit(
            stock_item_id=int(stock.id),
            received_qty=50.0,
            remaining_qty=20.0,
            uom="mm",
            received_at=datetime(2026, 1, 2, tzinfo=timezone.utc),
            status="active",
        )
        db.add_all([unit_1, unit_2])
        db.flush()

        movement_1 = MaterialStockMovement(
            stock_item_id=int(stock.id),
            movement_type="vydej",
            qty=30.0,
            movement_date=datetime(2026, 1, 3, tzinfo=timezone.utc),
            reference=ref,
            receipt_unit_id=int(unit_1.id),
        )
        movement_2 = MaterialStockMovement(
            stock_item_id=int(stock.id),
            movement_type="vydej",
            qty=30.0,
            movement_date=datetime(2026, 1, 3, tzinfo=timezone.utc),
            reference=ref,
            receipt_unit_id=int(unit_2.id),
        )
        db.add_all([movement_1, movement_2])
        db.commit()
        movement_1_id = int(movement_1.id)
        movement_2_id = int(movement_2.id)
        reservation_id = int(reservation.id)
        stock_id = int(stock.id)
        unit_1_id = int(unit_1.id)
        unit_2_id = int(unit_2.id)

        assert material_stock_api.delete_movement(movement_1_id, db, _rbac=None) == {"status": "ok"}

        db.expire_all()
        reservation = db.get(MaterialReservation, reservation_id)
        assert reservation is not None
        assert reservation.status == "issued"
        assert reservation.is_active is False
        assert db.get(MaterialReceiptUnit, unit_1_id).remaining_qty == 50.0
        assert db.get(MaterialStockItem, stock_id).current_qty == 70.0
        assert (
            db.scalar(
                select(MaterialStockMovement).where(
                    MaterialStockMovement.movement_type == "vydej",
                    MaterialStockMovement.reference == ref,
                )
            )
            is not None
        )

        assert material_stock_api.delete_movement(movement_2_id, db, _rbac=None) == {"status": "ok"}

        db.expire_all()
        reservation = db.get(MaterialReservation, reservation_id)
        assert reservation is not None
        assert reservation.status == "reserved"
        assert reservation.reserved_qty == reservation.required_qty
        assert reservation.is_active is True
        assert db.get(MaterialReceiptUnit, unit_2_id).remaining_qty == 50.0
        assert db.get(MaterialStockItem, stock_id).current_qty == 100.0
        assert (
            db.scalar(
                select(MaterialStockMovement).where(
                    MaterialStockMovement.movement_type == "vydej",
                    MaterialStockMovement.reference == ref,
                )
            )
            is None
        )


def test_issue_material_decrements_receipt_units_by_real_cut_lengths(monkeypatch):
    monkeypatch.setattr(material_stock_api, "refresh_production_order_material_readiness", lambda *args, **kwargs: False)
    monkeypatch.setattr(material_stock_api, "refresh_material_readiness_for_material_library_item", lambda *args, **kwargs: None)

    SessionLocal = _session_factory()
    with SessionLocal() as db:
        material = MaterialLibraryItem(
            code="MAT-CUT-1",
            name="Material for cut allocation test",
            material_type="steel",
            form="bar",
            dimension="1000",
            unit="mm",
            is_active=True,
        )
        db.add(material)
        db.flush()

        stock = MaterialStockItem(
            material_library_item_id=int(material.id),
            current_qty=2000.0,
            unit="mm",
            is_active=True,
        )
        db.add(stock)
        db.flush()

        reservation = MaterialReservation(
            material_library_item_id=int(material.id),
            job_item_id=10,
            production_order_id=20,
            required_qty=1052.0,
            reserved_qty=1052.0,
            status="reserved",
            is_active=True,
        )
        unit_a = MaterialReceiptUnit(
            stock_item_id=int(stock.id),
            received_qty=1000.0,
            remaining_qty=1000.0,
            uom="mm",
            heat_lot="A",
            received_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
            status="active",
        )
        unit_b = MaterialReceiptUnit(
            stock_item_id=int(stock.id),
            received_qty=1000.0,
            remaining_qty=1000.0,
            uom="mm",
            heat_lot="B",
            received_at=datetime(2026, 1, 2, tzinfo=timezone.utc),
            status="active",
        )
        db.add_all([reservation, unit_a, unit_b])
        db.commit()

        response = material_stock_api.issue_material(
            material_stock_api.MaterialIssuePayload(
                reservation_id=int(reservation.id),
                stock_item_id=int(stock.id),
                requested_piece_count=10,
                delka_na_kus_mm=100.0,
                vyrabeno_po=3,
                na_upnuti_mm=10.0,
                prorez_mm=3.0,
                povolit_deleni_polotovaru=True,
                minimalni_zbytek_pouzitelny_mm=0.0,
                minimalni_vydavana_delka_mm=0.0,
            ),
            db,
            _rbac=None,
        )

        assert response["issued_qty"] == 1052.0
        db.expire_all()
        assert db.get(MaterialStockItem, int(stock.id)).current_qty == 948.0
        assert db.get(MaterialReceiptUnit, int(unit_a.id)).remaining_qty == 61.0
        assert db.get(MaterialReceiptUnit, int(unit_b.id)).remaining_qty == 887.0
        receipt_units = material_stock_api.list_receipt_units(int(stock.id), db)
        assert [(r["heat_lot"], r["received_qty"], r["remaining_qty"], r["status"]) for r in receipt_units] == [
            ("A", 1000.0, 61.0, "active"),
            ("B", 1000.0, 887.0, "active"),
        ]
        movements = db.scalars(
            select(MaterialStockMovement).order_by(MaterialStockMovement.receipt_unit_id.asc(), MaterialStockMovement.qty.desc())
        ).all()
        assert [(m.receipt_unit_id, m.qty) for m in movements] == [
            (int(unit_a.id), 939.0),
            (int(unit_b.id), 113.0),
        ]


def test_issue_material_uses_remnant_before_receipt_units(monkeypatch):
    monkeypatch.setattr(material_stock_api, "refresh_production_order_material_readiness", lambda *args, **kwargs: False)
    monkeypatch.setattr(material_stock_api, "refresh_material_readiness_for_material_library_item", lambda *args, **kwargs: None)

    SessionLocal = _session_factory()
    with SessionLocal() as db:
        material = MaterialLibraryItem(
            code="MAT-REM-1",
            name="Material with remnant",
            material_type="steel",
            form="bar",
            dimension="1000",
            unit="mm",
            is_active=True,
        )
        db.add(material)
        db.flush()

        stock = MaterialStockItem(
            material_library_item_id=int(material.id),
            current_qty=1000.0,
            unit="mm",
            is_active=True,
        )
        db.add(stock)
        db.flush()

        reservation = MaterialReservation(
            material_library_item_id=int(material.id),
            job_item_id=10,
            production_order_id=20,
            required_qty=113.0,
            reserved_qty=113.0,
            status="reserved",
            is_active=True,
        )
        unit_main = MaterialReceiptUnit(
            stock_item_id=int(stock.id),
            received_qty=1000.0,
            remaining_qty=1000.0,
            uom="mm",
            heat_lot="A",
            received_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
            status="active",
        )
        unit_source = MaterialReceiptUnit(
            stock_item_id=int(stock.id),
            received_qty=500.0,
            remaining_qty=0.0,
            uom="mm",
            heat_lot="B",
            received_at=datetime(2026, 1, 2, tzinfo=timezone.utc),
            status="consumed",
        )
        db.add_all([reservation, unit_main, unit_source])
        db.flush()
        remnant = MaterialRemnantStockItem(
            source_receipt_unit_id=int(unit_source.id),
            source_stock_item_id=int(stock.id),
            material_library_item_id=int(material.id),
            qty=120.0,
            uom="mm",
            heat_lot="B",
            received_at=datetime(2026, 1, 2, tzinfo=timezone.utc),
            created_at=datetime(2026, 1, 3, tzinfo=timezone.utc),
            status="active",
        )
        db.add(remnant)
        db.commit()

        preview = material_stock_api.get_material_issue_allocation_preview(
            stock_item_id=int(stock.id),
            requested_piece_count=1,
            delka_na_kus_mm=100.0,
            vyrabeno_po=1,
            na_upnuti_mm=10.0,
            prorez_mm=3.0,
            povolit_deleni_polotovaru=True,
            minimalni_zbytek_pouzitelny_mm=0.0,
            minimalni_vydavana_delka_mm=0.0,
            db=db,
        )
        assert preview["ok"] is True
        assert preview["remnant_selection"] == "best_fit"
        assert [(ln["movement_type"], ln["remnant_stock_item_id"], ln["allocated_mm"]) for ln in preview["lines"]] == [
            ("vydej_zbytek", int(remnant.id), 113.0)
        ]

        response = material_stock_api.issue_material(
            material_stock_api.MaterialIssuePayload(
                reservation_id=int(reservation.id),
                stock_item_id=int(stock.id),
                requested_piece_count=1,
                delka_na_kus_mm=100.0,
                vyrabeno_po=1,
                na_upnuti_mm=10.0,
                prorez_mm=3.0,
                povolit_deleni_polotovaru=True,
                minimalni_zbytek_pouzitelny_mm=0.0,
                minimalni_vydavana_delka_mm=0.0,
            ),
            db,
            _rbac=None,
        )

        assert response["issued_qty"] == 113.0
        db.expire_all()
        assert db.get(MaterialStockItem, int(stock.id)).current_qty == 1000.0
        assert db.get(MaterialReceiptUnit, int(unit_main.id)).remaining_qty == 1000.0
        remnant_after = db.get(MaterialRemnantStockItem, int(remnant.id))
        assert remnant_after.qty == 7.0
        assert remnant_after.status == "active"
        movements = db.scalars(select(MaterialStockMovement)).all()
        assert [(m.movement_type, m.qty, m.receipt_unit_id, m.remnant_stock_item_id, m.heat_lot) for m in movements] == [
            ("vydej_zbytek", 113.0, int(unit_source.id), int(remnant.id), "B")
        ]


def test_scrap_receipt_unit_remainder_moves_a_61_mm_to_remnant_stock(monkeypatch):
    monkeypatch.setattr(material_stock_api, "refresh_material_readiness_for_material_library_item", lambda *args, **kwargs: None)

    SessionLocal = _session_factory()
    with SessionLocal() as db:
        material = MaterialLibraryItem(
            code="A",
            name="Material A",
            material_type="steel",
            form="bar",
            dimension="1000",
            unit="mm",
            is_active=True,
        )
        db.add(material)
        db.flush()

        stock = MaterialStockItem(
            material_library_item_id=int(material.id),
            current_qty=948.0,
            unit="mm",
            is_active=True,
        )
        db.add(stock)
        db.flush()

        unit_a = MaterialReceiptUnit(
            stock_item_id=int(stock.id),
            received_qty=1000.0,
            remaining_qty=61.0,
            uom="mm",
            heat_lot="A",
            certificate_no="ATEST-Y",
            delivery_note_no="DL-1",
            invoice_no="INV-1",
            supplier_name="Supplier",
            received_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
            status="active",
        )
        db.add(unit_a)
        db.commit()

        response = material_stock_api.scrap_receipt_unit_remainder(int(unit_a.id), db, _rbac=None)

        assert response["status"] == "ok"
        assert response["scrapped_qty"] == 61.0
        assert response["remnant"]["qty"] == 61.0
        assert response["remnant"]["material_code"] == "A"
        assert response["remnant"]["heat_lot"] == "A"
        assert response["remnant"]["certificate_no"] == "ATEST-Y"
        assert "přesunut do skladu zbytků" in response["message"]

        db.expire_all()
        refreshed_stock = db.get(MaterialStockItem, int(stock.id))
        refreshed_unit = db.get(MaterialReceiptUnit, int(unit_a.id))
        remnant = db.scalar(select(MaterialRemnantStockItem))
        movement = db.scalar(select(MaterialStockMovement).where(MaterialStockMovement.movement_type == "odpis_zbytku"))

        assert refreshed_stock.current_qty == 887.0
        assert refreshed_unit.remaining_qty == 0.0
        assert refreshed_unit.status == "consumed"
        assert remnant is not None
        assert remnant.qty == 61.0
        assert remnant.status == "active"
        assert remnant.source_receipt_unit_id == int(unit_a.id)
        assert remnant.source_stock_item_id == int(stock.id)
        assert movement is not None
        assert movement.qty == 61.0
        assert movement.receipt_unit_id == int(unit_a.id)


def test_dispose_remnant_marks_scrapped_and_keeps_main_stock_qty():
    SessionLocal = _session_factory()
    with SessionLocal() as db:
        material = MaterialLibraryItem(
            code="REM-DISP",
            name="Material for remnant disposal",
            material_type="steel",
            form="bar",
            dimension="1000",
            unit="mm",
            is_active=True,
        )
        db.add(material)
        db.flush()

        stock = MaterialStockItem(
            material_library_item_id=int(material.id),
            current_qty=887.0,
            unit="mm",
            is_active=True,
        )
        db.add(stock)
        db.flush()

        receipt_unit = MaterialReceiptUnit(
            stock_item_id=int(stock.id),
            received_qty=1000.0,
            remaining_qty=0.0,
            uom="mm",
            heat_lot="T-1",
            certificate_no="ATEST-1",
            delivery_note_no="DL-1",
            invoice_no="INV-1",
            supplier_name="Supplier",
            received_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
            status="consumed",
        )
        db.add(receipt_unit)
        db.flush()

        remnant = MaterialRemnantStockItem(
            source_receipt_unit_id=int(receipt_unit.id),
            source_stock_item_id=int(stock.id),
            material_library_item_id=int(material.id),
            qty=10.0,
            uom="mm",
            heat_lot="T-1",
            certificate_no="ATEST-1",
            delivery_note_no="DL-1",
            invoice_no="INV-1",
            supplier_name="Supplier",
            received_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
            created_at=datetime(2026, 1, 2, tzinfo=timezone.utc),
            status="active",
        )
        db.add(remnant)
        db.commit()

        response = material_stock_api.dispose_remnant_stock_item(int(remnant.id), db, _rbac=None)

        assert response["status"] == "ok"
        assert response["remnant"]["qty"] == 0.0
        assert response["remnant"]["status"] == "scrapped"
        assert response["movement"]["movement_type"] == "likvidace_zbytku"
        assert response["movement"]["qty"] == 10.0
        assert response["movement"]["remnant_stock_item_id"] == int(remnant.id)
        assert response["movement"]["heat_lot"] == "T-1"
        assert response["movement"]["certificate_no"] == "ATEST-1"
        assert response["movement"]["delivery_note_no"] == "DL-1"
        assert response["movement"]["supplier_name"] == "Supplier"
        assert response["movement"]["note"] == "Likvidace nepoužitelného zbytku"

        db.expire_all()
        assert db.get(MaterialStockItem, int(stock.id)).current_qty == 887.0
        remnant_after = db.get(MaterialRemnantStockItem, int(remnant.id))
        assert remnant_after.qty == 0.0
        assert remnant_after.status == "scrapped"
        movement = db.scalar(select(MaterialStockMovement).where(MaterialStockMovement.movement_type == "likvidace_zbytku"))
        assert movement is not None
        assert movement.stock_item_id == int(stock.id)
        assert movement.remnant_stock_item_id == int(remnant.id)
