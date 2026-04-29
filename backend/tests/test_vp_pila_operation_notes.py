from __future__ import annotations

from datetime import datetime

from sqlalchemy import create_engine, select, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.production_orders import _refresh_pila_cutting_notes_for_print_detail
from app.models.base import Base
from app.models.master_data import Customer
from app.models.master_libraries import OperationLibraryItem, WorkplaceLibraryItem
from app.models.material_library import MaterialLibraryItem
from app.models.material_stock import MaterialReceiptUnit, MaterialStockItem, MaterialStockMovement
from app.models.orders import Job, JobItem, ProductionOrder, ProductionOrderOperation
from app.models.portfolio import (
    PortfolioItem,
    PortfolioTechnologyTemplate,
    PortfolioTechnologyTemplateMaterial,
    PortfolioTechnologyTemplateOperation,
)
from app.services.vp_pila_operation_notes import is_pila_operation_name


def _session_factory():
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    with engine.begin() as conn:
        conn.execute(text("ALTER TABLE job_items ADD COLUMN portfolio_item_id INTEGER"))
    return sessionmaker(bind=engine)


def test_print_detail_refresh_persists_pila_note_from_job_item_portfolio():
    SessionLocal = _session_factory()
    with SessionLocal() as db:
        db.add(Customer(id=1, code="C1", name="Customer"))
        mat = MaterialLibraryItem(
            code="MAT-REZ",
            name="Round bar",
            material_type="steel",
            form="bar",
            dimension="D10",
            unit="mm",
            is_active=True,
        )
        portfolio = PortfolioItem(
            id=1,
            customer_id=1,
            gpn="GPN-1",
            name="Part",
            logistic_mode="vyroba_zakaznik",
            is_active=True,
        )
        db.add_all([mat, portfolio])
        db.flush()

        tpl = PortfolioTechnologyTemplate(
            portfolio_item_id=int(portfolio.id),
            name="TP",
            version="A",
            is_active=True,
        )
        db.add(tpl)
        db.flush()
        db.add_all(
            [
                PortfolioTechnologyTemplateOperation(
                    template_id=int(tpl.id),
                    operation_no=10,
                    operation_name="Řezání",
                    workplace="Pila",
                    note="Template cutting text",
                ),
                PortfolioTechnologyTemplateMaterial(
                    template_id=int(tpl.id),
                    input_type="material",
                    material_library_item_id=int(mat.id),
                    consumption_per_piece=100.0,
                    scrap_allowance=0.0,
                    na_upnuti_mm=0.0,
                    vyrabet_max_po_ks=2,
                    povolit_deleni_polotovaru=True,
                ),
            ]
        )

        job = Job(zak_code="ZAK-1")
        db.add(job)
        db.flush()
        ji = JobItem(job_id=int(job.id), line_no=1, gpn="GPN-1", qty=4)
        db.add(ji)
        db.flush()
        db.execute(
            text("UPDATE job_items SET portfolio_item_id = :pid WHERE id = :id"),
            {"pid": int(portfolio.id), "id": int(ji.id)},
        )

        po = ProductionOrder(
            vp_code="VP-1",
            job_item_id=int(ji.id),
            portfolio_item_id=None,
            quantity=4,
            status="planned",
        )
        db.add(po)
        db.flush()
        db.add(
            ProductionOrderOperation(
                production_order_id=int(po.id),
                operation_no=10,
                operation_name="Řezání",
                workplace_name="Pila",
                note=None,
            )
        )
        stock = MaterialStockItem(
            material_library_item_id=int(mat.id),
            current_qty=1000.0,
            unit="mm",
            is_active=True,
        )
        db.add(stock)
        db.flush()
        db.add(
            MaterialReceiptUnit(
                stock_item_id=int(stock.id),
                received_qty=1000.0,
                remaining_qty=1000.0,
                uom="mm",
                heat_lot="A",
                received_at=datetime(2026, 1, 1),
                status="active",
            )
        )
        db.commit()

        _refresh_pila_cutting_notes_for_print_detail(db, po)

    with SessionLocal() as db:
        row = db.scalar(select(ProductionOrderOperation))
        assert row is not None
        assert row.note is not None
        assert row.note.startswith("Rezat:")
        assert "A        200 mm    2x" in row.note


def test_pila_operation_name_matches_rezani_without_diacritics():
    assert is_pila_operation_name("Rezani / pila")


def test_print_detail_refresh_uses_issued_movements_for_existing_vp_pila_note():
    SessionLocal = _session_factory()
    with SessionLocal() as db:
        db.add(Customer(id=1, code="C1", name="Customer"))
        mat = MaterialLibraryItem(
            code="0720 0814",
            name="1.4460",
            material_type="steel",
            form="bar",
            dimension="D10",
            unit="mm",
            is_active=True,
        )
        portfolio = PortfolioItem(
            id=1,
            customer_id=1,
            gpn="GPN-1",
            name="Part",
            logistic_mode="vyroba_zakaznik",
            is_active=True,
        )
        db.add_all([mat, portfolio])
        db.flush()

        tpl = PortfolioTechnologyTemplate(
            portfolio_item_id=int(portfolio.id),
            name="TP",
            version="A",
            is_active=True,
        )
        db.add(tpl)
        db.flush()
        db.add_all(
            [
                PortfolioTechnologyTemplateOperation(
                    template_id=int(tpl.id),
                    operation_no=10,
                    operation_name="Řezání",
                    workplace="Pila",
                    note="Template cutting text",
                ),
                PortfolioTechnologyTemplateMaterial(
                    template_id=int(tpl.id),
                    input_type="material",
                    material_library_item_id=int(mat.id),
                    consumption_per_piece=100.0,
                    scrap_allowance=3.0,
                    na_upnuti_mm=10.0,
                    vyrabet_max_po_ks=3,
                    povolit_deleni_polotovaru=True,
                ),
            ]
        )

        job = Job(zak_code="ZAK-1")
        db.add(job)
        db.flush()
        ji = JobItem(job_id=int(job.id), line_no=1, gpn="GPN-1", qty=10)
        db.add(ji)
        db.flush()
        db.execute(
            text("UPDATE job_items SET portfolio_item_id = :pid WHERE id = :id"),
            {"pid": int(portfolio.id), "id": int(ji.id)},
        )

        po = ProductionOrder(
            vp_code="VP-1",
            job_item_id=int(ji.id),
            portfolio_item_id=None,
            quantity=10,
            status="planned",
        )
        db.add(po)
        db.flush()
        db.add(
            ProductionOrderOperation(
                production_order_id=int(po.id),
                operation_no=10,
                operation_name="Řezání",
                workplace_name="Pila",
                note=None,
            )
        )
        stock = MaterialStockItem(
            material_library_item_id=int(mat.id),
            current_qty=0.0,
            unit="mm",
            is_active=True,
        )
        db.add(stock)
        db.flush()
        db.add_all(
            [
                MaterialStockMovement(
                    stock_item_id=int(stock.id),
                    movement_type="vydej",
                    qty=939.0,
                    movement_date=datetime(2026, 1, 1, 8, 0, 0),
                    reference="VP-1",
                    heat_lot="A",
                    production_order_id=int(po.id),
                    job_item_id=int(ji.id),
                    certificate_no="CERT-A",
                    delivery_note_no="DL-A",
                ),
                MaterialStockMovement(
                    stock_item_id=int(stock.id),
                    movement_type="vydej_zbytek",
                    qty=113.0,
                    movement_date=datetime(2026, 1, 1, 8, 5, 0),
                    reference="VP-1",
                    heat_lot="B",
                    production_order_id=int(po.id),
                    job_item_id=int(ji.id),
                    certificate_no="CERT-B",
                    delivery_note_no="DL-B",
                ),
            ]
        )
        db.commit()

        _refresh_pila_cutting_notes_for_print_detail(db, po)

    with SessionLocal() as db:
        row = db.scalar(select(ProductionOrderOperation))
        assert row is not None
        assert row.note == (
            "Rezat:\n"
            "0720 0814 - 1.4460\n"
            "\n"
            "ATEST    Rozmer    Pocet\n"
            "A        313 mm    3x\n"
            "B        113 mm    1x"
        )
