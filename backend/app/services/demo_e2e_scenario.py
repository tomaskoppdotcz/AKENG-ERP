"""
Repeatable demo for real portfolio GPN 81724091.

Uses real existing portfolio variants + their active technology templates
so VP PDF gets real drawing, revision, and operations.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Any

from sqlalchemy import delete, func, select, text
from sqlalchemy.orm import Session

from app.api.orders import (
    _next_line_no,
    _validate_portfolio_item_gpn,
    create_production_orders_from_allocation,
)
from app.services.business_numbering import next_zak_code as _next_zak_code
from app.core.scan_code import (
    customer_order_scan_code_for_id,
    material_library_scan_code_for_id,
    material_stock_scan_code_for_id,
    order_item_scan_code_for_id,
    production_order_operation_scan_code_for_id,
    production_order_scan_code_for_id,
    product_stock_scan_code_for_id,
)
from app.models.kiosk import Kiosk, OperationEvent
from app.models.master_data import Customer, Machine
from app.models.material_library import MaterialLibraryItem
from app.models.material_stock import MaterialStockItem, MaterialStockMovement, MaterialStockReservation
from app.models.orders import (
    CustomerOrder,
    Job,
    JobItem,
    JobItemCoverage,
    ProductionOrder,
    ProductionOrderOperation,
    ProductionOrderOperationLog,
)
from app.models.planning import MachineSchedule, PlanningOperation, PlanningScheduleSegment
from app.models.portfolio import PortfolioItem, PortfolioTechnologyTemplate, PortfolioTechnologyTemplateOperation
from app.models.product_stock import ProductStockItem, ProductStockMovement, ProductStockReceipt
from app.services.planning_engine import PlanningEngineService

DEMO_CUSTOMER_CODE = "DEMO_TEST_81724091"
DEMO_CUSTOMER_NAME = "DEMO TEST 81724091"
DEMO_ORDER_PO = "TEST-DEMO-81724091-PO-001"
DEMO_SEED_NOTE = "DEMO_SEED_E2E"
DEMO_GPN = "81724091"
DEMO_HEAT_LOT = "TEST-TAVBA-81724091-A"
DEMO_MATERIAL_CODE = "DEMO-TEST-MAT-81724091"


def _get_or_create_machine(db: Session, machine_code: str, name: str, machine_type: str = "WORKCENTER") -> Machine:
    m = db.scalar(select(Machine).where(Machine.machine_code == machine_code))
    if not m:
        m = Machine(machine_code=machine_code, name=name, machine_type=machine_type)
        db.add(m)
        db.flush()
    return m


def _ensure_kiosk_for_machine(db: Session, kiosk_code: str, kiosk_name: str, machine_code: str) -> None:
    machine = db.scalar(select(Machine).where(Machine.machine_code == machine_code))
    if not machine:
        return
    exists = db.scalar(select(Kiosk).where(Kiosk.kiosk_code == kiosk_code))
    if exists:
        return
    db.add(Kiosk(kiosk_code=kiosk_code, name=kiosk_name, machine_id=int(machine.id), is_active=True))
    db.flush()


def _get_or_create_demo_customer(db: Session) -> Customer:
    row = db.scalar(select(Customer).where(Customer.code == DEMO_CUSTOMER_CODE))
    if row:
        return row
    row = Customer(
        code=DEMO_CUSTOMER_CODE,
        name=DEMO_CUSTOMER_NAME,
        is_active=True,
        note="Demo E2E 81724091 - lze mazat/seedovat pres /seed/demo-e2e",
    )
    db.add(row)
    db.flush()
    return row


def _pick_real_portfolio_variant(db: Session, logistic_mode: str) -> PortfolioItem:
    rows = db.scalars(
        select(PortfolioItem).where(
            func.lower(func.trim(PortfolioItem.gpn)) == DEMO_GPN.lower(),
            PortfolioItem.logistic_mode == logistic_mode,
        )
    ).all()
    if not rows:
        raise RuntimeError(
            f"Chybí reálná portfolio položka pro GPN {DEMO_GPN} a logistic_mode '{logistic_mode}'."
        )
    ranked = sorted(
        rows,
        key=lambda p: (
            0 if bool(getattr(p, "is_active", False)) else 1,
            0 if getattr(p, "active_template_id", None) is not None else 1,
            int(p.id),
        ),
    )
    chosen = ranked[0]
    tpl = db.scalar(
        select(PortfolioTechnologyTemplate).where(
            PortfolioTechnologyTemplate.portfolio_item_id == int(chosen.id),
            PortfolioTechnologyTemplate.is_active.is_(True),
        )
    )
    if tpl is None:
        raise RuntimeError(
            f"Portfolio item id={chosen.id} (mode={logistic_mode}) nemá aktivní TP. "
            "Nastavte active technology template."
        )
    op_count = db.scalar(
        select(func.count())
        .select_from(PortfolioTechnologyTemplateOperation)
        .where(PortfolioTechnologyTemplateOperation.template_id == int(tpl.id))
    ) or 0
    if int(op_count) <= 0:
        raise RuntimeError(f"Aktivní TP id={tpl.id} pro portfolio id={chosen.id} nemá operace.")
    return chosen


def _resolve_real_portfolio_variants(db: Session) -> dict[str, int]:
    v = _pick_real_portfolio_variant(db, "vyroba_zakaznik")
    sz = _pick_real_portfolio_variant(db, "sklad_zakaznik")
    s = _pick_real_portfolio_variant(db, "sklad")
    return {"vyroba_zakaznik_id": int(v.id), "sklad_zakaznik_id": int(sz.id), "sklad_id": int(s.id)}


def _ensure_product_stock_baseline(db: Session, portfolio: dict[str, int]) -> None:
    for pid, cur, min_q, loc in (
        (int(portfolio["sklad_zakaznik_id"]), 15.0, 0.0, "DEMO-SKLAD-A1"),
        (int(portfolio["sklad_id"]), 0.0, 12.0, "DEMO-SKLAD-A2"),
    ):
        existing = db.scalar(select(ProductStockItem).where(ProductStockItem.portfolio_item_id == pid))
        if existing:
            existing.current_qty = cur
            existing.min_qty = min_q
            existing.unit = "ks"
            existing.location = loc
            existing.is_active = True
            existing.note = f"{DEMO_SEED_NOTE}; heat_lot={DEMO_HEAT_LOT}"
            if not (existing.scan_code and str(existing.scan_code).strip()):
                existing.scan_code = product_stock_scan_code_for_id(int(existing.id))
        else:
            row = ProductStockItem(
                portfolio_item_id=pid,
                location=loc,
                current_qty=cur,
                min_qty=min_q,
                unit="ks",
                is_active=True,
                note=f"{DEMO_SEED_NOTE}; heat_lot={DEMO_HEAT_LOT}",
            )
            db.add(row)
            db.flush()
            row.scan_code = product_stock_scan_code_for_id(int(row.id))
    db.flush()


def _ensure_demo_material_traceability(db: Session) -> dict[str, Any]:
    mat = db.scalar(select(MaterialLibraryItem).where(MaterialLibraryItem.code == DEMO_MATERIAL_CODE))
    if not mat:
        mat = MaterialLibraryItem(
            code=DEMO_MATERIAL_CODE,
            name="DEMO TEST Material 42CrMo4 +QT",
            material_type="Ocel",
            form="Tyc",
            dimension="D42 x 3000 mm",
            unit="kg",
            density=7.85,
            is_active=True,
        )
        db.add(mat)
        db.flush()
        mat.scan_code = material_library_scan_code_for_id(int(mat.id))
    stock = db.scalar(select(MaterialStockItem).where(MaterialStockItem.material_library_item_id == int(mat.id)))
    if not stock:
        stock = MaterialStockItem(
            material_library_item_id=int(mat.id),
            location="DEMO-MAT-RACK-01",
            current_qty=100.0,
            min_qty=20.0,
            unit="kg",
            note=f"{DEMO_SEED_NOTE}; {DEMO_HEAT_LOT}",
            is_active=True,
        )
        db.add(stock)
        db.flush()
        stock.scan_code = material_stock_scan_code_for_id(int(stock.id))
    else:
        stock.location = "DEMO-MAT-RACK-01"
        stock.current_qty = max(float(stock.current_qty or 0.0), 100.0)
        stock.min_qty = 20.0
        stock.unit = "kg"
        stock.note = f"{DEMO_SEED_NOTE}; {DEMO_HEAT_LOT}"
        if not (stock.scan_code and str(stock.scan_code).strip()):
            stock.scan_code = material_stock_scan_code_for_id(int(stock.id))
    mv = MaterialStockMovement(
        stock_item_id=int(stock.id),
        movement_type="prijem",
        qty=100.0,
        movement_date=datetime.utcnow(),
        scan_code=f"TEST-MAT-MOV-{int(stock.id):06d}",
        reference=f"TEST-RECEIPT-{DEMO_GPN}",
        heat_lot=DEMO_HEAT_LOT,
        length_per_piece_mm=120.0,
        weight_per_piece_kg=1.18,
        note=f"{DEMO_SEED_NOTE}; heat_lot={DEMO_HEAT_LOT}",
    )
    db.add(mv)
    db.flush()
    return {
        "material_library_item_id": int(mat.id),
        "material_stock_item_id": int(stock.id),
        "material_stock_scan_code": stock.scan_code,
        "material_movement_id": int(mv.id),
        "material_movement_scan_code": mv.scan_code,
        "heat_lot": DEMO_HEAT_LOT,
    }


def _create_demo_customer_order_and_job_items(db: Session, customer_id: int, portfolio: dict[str, int]) -> dict[str, Any]:
    existing = db.scalar(select(CustomerOrder).where(CustomerOrder.customer_po_no == DEMO_ORDER_PO))
    if existing:
        raise RuntimeError("Demo order already exists - run cleanup first.")
    cust = db.get(Customer, int(customer_id))
    if not cust:
        raise RuntimeError("Demo customer missing.")
    co = CustomerOrder(
        customer_po_no=DEMO_ORDER_PO,
        customer_name=cust.name,
        order_date=date.today(),
        order_type="customer",
    )
    setattr(co, "customer_id", int(customer_id))
    setattr(co, "requested_ship_date", None)
    setattr(co, "note", DEMO_SEED_NOTE)
    db.add(co)
    db.flush()
    co.scan_code = customer_order_scan_code_for_id(int(co.id))
    job = Job(zak_code=_next_zak_code(db), customer_order_id=int(co.id))
    db.add(job)
    db.flush()

    def add_line(qty: int, portfolio_key: str) -> int:
        pid = int(portfolio[portfolio_key])
        _validate_portfolio_item_gpn(db, DEMO_GPN, pid)
        line_no = _next_line_no(db, int(job.id))
        row = JobItem(job_id=int(job.id), line_no=line_no, gpn=DEMO_GPN, qty=int(qty), due_date=date.today())
        db.add(row)
        db.flush()
        row.scan_code = order_item_scan_code_for_id(int(row.id))
        cols = {r[1] for r in db.execute(text("PRAGMA table_info(job_items)")).fetchall()}
        if "description" in cols:
            db.execute(
                text("UPDATE job_items SET description = :description WHERE id = :id"),
                {"description": f"DEMO TEST {DEMO_GPN} ({portfolio_key})", "id": int(row.id)},
            )
        if "portfolio_item_id" in cols:
            db.execute(
                text("UPDATE job_items SET portfolio_item_id = :pid WHERE id = :id"),
                {"pid": pid, "id": int(row.id)},
            )
        db.flush()
        return int(row.id)

    i_v = add_line(10, "vyroba_zakaznik_id")
    i_sz = add_line(8, "sklad_zakaznik_id")
    i_s = add_line(6, "sklad_id")
    db.commit()
    return {"customer_order_id": int(co.id), "job_id": int(job.id), "job_item_ids": {"vyroba": i_v, "sklad_zakaznik": i_sz, "sklad": i_s}}


def _ensure_po_linkage_and_operations(db: Session, portfolio: dict[str, int]) -> int:
    rows = db.scalars(select(ProductionOrder).where(ProductionOrder.gpn == DEMO_GPN)).all()
    created_scan_rows = 0
    mode_by_source = {
        "order_allocation": "vyroba_zakaznik_id",
        "stock_allocation": "sklad_zakaznik_id",
        "restock_allocation": "sklad_id",
    }
    for po in rows:
        key = mode_by_source.get(str(po.source_type or "").strip().lower())
        if key:
            po.portfolio_item_id = int(portfolio[key])
        if not (po.scan_code and str(po.scan_code).strip()):
            po.scan_code = production_order_scan_code_for_id(int(po.id))
        tpl = db.scalar(
            select(PortfolioTechnologyTemplate).where(
                PortfolioTechnologyTemplate.portfolio_item_id == int(po.portfolio_item_id),
                PortfolioTechnologyTemplate.is_active.is_(True),
            )
        )
        if not tpl:
            continue
        tpl_ops = db.scalars(
            select(PortfolioTechnologyTemplateOperation)
            .where(PortfolioTechnologyTemplateOperation.template_id == int(tpl.id))
            .order_by(PortfolioTechnologyTemplateOperation.operation_no.asc(), PortfolioTechnologyTemplateOperation.id.asc())
        ).all()
        for op in tpl_ops:
            ex = db.scalar(
                select(ProductionOrderOperation).where(
                    ProductionOrderOperation.production_order_id == int(po.id),
                    ProductionOrderOperation.operation_no == int(op.operation_no),
                )
            )
            if ex is None:
                row = ProductionOrderOperation(
                    production_order_id=int(po.id),
                    operation_no=int(op.operation_no),
                    operation_name=op.operation_name,
                    workplace_name=op.workplace,
                )
                db.add(row)
                db.flush()
                row.scan_code = production_order_operation_scan_code_for_id(int(row.id))
                created_scan_rows += 1
    db.flush()
    return created_scan_rows


def _ensure_source_vp_receipt_for_sklad_zakaznik(db: Session, sklad_zakaznik_portfolio_item_id: int) -> dict[str, Any]:
    source_po = db.scalar(
        select(ProductionOrder)
        .where(ProductionOrder.gpn == DEMO_GPN, ProductionOrder.source_type == "order_allocation")
        .order_by(ProductionOrder.id.asc())
    )
    if not source_po:
        source_po = db.scalar(select(ProductionOrder).where(ProductionOrder.gpn == DEMO_GPN).order_by(ProductionOrder.id.asc()))
    if not source_po:
        return {"source_production_order_id": None, "source_vp_code": None, "source_vp_scan": None}
    if not getattr(source_po, "scan_code", None):
        source_po.scan_code = production_order_scan_code_for_id(int(source_po.id))
    psi = db.scalar(select(ProductStockItem).where(ProductStockItem.portfolio_item_id == int(sklad_zakaznik_portfolio_item_id)))
    if not psi:
        return {"source_production_order_id": int(source_po.id), "source_vp_code": source_po.vp_code, "source_vp_scan": source_po.scan_code}
    if not (psi.scan_code and str(psi.scan_code).strip()):
        psi.scan_code = product_stock_scan_code_for_id(int(psi.id))
    rec = ProductStockReceipt(
        product_stock_item_id=int(psi.id),
        production_order_id=int(source_po.id),
        qty_received=8.0,
        received_at=datetime.utcnow(),
        note=DEMO_HEAT_LOT,
    )
    db.add(rec)
    db.flush()
    return {
        "source_production_order_id": int(source_po.id),
        "source_vp_code": source_po.vp_code,
        "source_vp_scan": source_po.scan_code,
        "product_stock_item_scan": psi.scan_code,
    }


def _attach_material_movement_to_created_pos(db: Session, material_stock_item_id: int) -> int:
    rows = db.scalars(select(ProductionOrder).where(ProductionOrder.gpn == DEMO_GPN)).all()
    count = 0
    for po in rows:
        db.add(
            MaterialStockMovement(
                stock_item_id=int(material_stock_item_id),
                movement_type="vydej",
                qty=12.0,
                movement_date=datetime.utcnow(),
                scan_code=f"TEST-MAT-CONS-{int(po.id):06d}",
                reference=f"{po.vp_code}",
                heat_lot=DEMO_HEAT_LOT,
                length_per_piece_mm=120.0,
                weight_per_piece_kg=1.18,
                production_order_id=int(po.id),
                job_item_id=int(po.job_item_id) if po.job_item_id is not None else None,
                note=f"{DEMO_SEED_NOTE}; {DEMO_HEAT_LOT}",
            )
        )
        count += 1
    db.flush()
    return count


def cleanup_demo_e2e(db: Session) -> dict[str, Any]:
    removed: dict[str, Any] = {"planning_operations": 0, "production_orders": 0, "job_items": 0}
    co = db.scalar(select(CustomerOrder).where(CustomerOrder.customer_po_no == DEMO_ORDER_PO))
    if co is not None:
        jobs = db.scalars(select(Job).where(Job.customer_order_id == int(co.id))).all()
        job_ids = [int(j.id) for j in jobs]
        item_ids = [int(i) for i in db.scalars(select(JobItem.id).where(JobItem.job_id.in_(job_ids))).all()] if job_ids else []
        po_rows = (
            db.scalars(select(ProductionOrder).where(ProductionOrder.customer_order_id == int(co.id))).all()
        )
        po_ids = [int(p.id) for p in po_rows]
        vp_codes = [str(p.vp_code) for p in po_rows if p.vp_code]
        if po_ids:
            op_ids = [
                int(x)
                for x in db.scalars(select(PlanningOperation.id).where(PlanningOperation.work_order_no.in_(vp_codes))).all()
            ]
            if op_ids:
                db.execute(delete(OperationEvent).where(OperationEvent.planning_operation_id.in_(op_ids)))
                db.execute(delete(PlanningScheduleSegment).where(PlanningScheduleSegment.planning_operation_id.in_(op_ids)))
                db.execute(delete(MachineSchedule).where(MachineSchedule.planning_operation_id.in_(op_ids)))
                removed["planning_operations"] = db.execute(
                    delete(PlanningOperation).where(PlanningOperation.id.in_(op_ids))
                ).rowcount or len(op_ids)
            db.execute(delete(ProductStockReceipt).where(ProductStockReceipt.production_order_id.in_(po_ids)))
            db.execute(delete(ProductionOrderOperationLog).where(ProductionOrderOperationLog.production_order_id.in_(po_ids)))
            db.execute(delete(ProductionOrderOperation).where(ProductionOrderOperation.production_order_id.in_(po_ids)))
            removed["production_orders"] = db.execute(delete(ProductionOrder).where(ProductionOrder.id.in_(po_ids))).rowcount or len(po_ids)
        if item_ids:
            db.execute(delete(JobItemCoverage).where(JobItemCoverage.job_item_id.in_(item_ids)))
            db.execute(delete(MaterialStockReservation).where(MaterialStockReservation.job_item_id.in_(item_ids)))
            removed["job_items"] = db.execute(delete(JobItem).where(JobItem.id.in_(item_ids))).rowcount or len(item_ids)
        for j in jobs:
            db.delete(j)
        db.delete(co)
        removed["customer_order_id"] = int(co.id)
    ms_ids = [
        int(x)
        for x in db.scalars(
            select(MaterialStockItem.id).join(MaterialLibraryItem).where(MaterialLibraryItem.code == DEMO_MATERIAL_CODE)
        ).all()
    ]
    if ms_ids:
        db.execute(delete(MaterialStockReservation).where(MaterialStockReservation.stock_item_id.in_(ms_ids)))
        db.execute(delete(MaterialStockMovement).where(MaterialStockMovement.stock_item_id.in_(ms_ids)))
        db.execute(delete(MaterialStockItem).where(MaterialStockItem.id.in_(ms_ids)))
    db.execute(delete(MaterialLibraryItem).where(MaterialLibraryItem.code == DEMO_MATERIAL_CODE))
    db.commit()
    return {"status": "ok", "removed": removed}


def run_demo_e2e_seed(db: Session) -> dict[str, Any]:
    cleanup_demo_e2e(db)
    for code, name in (
        ("PILA", "Pila"),
        ("HAAS_ST40", "HAAS ST40"),
        ("MEZIOPERACNI_KONTROLA", "Mezioperacni kontrola"),
        ("BALENI", "Baleni"),
    ):
        _get_or_create_machine(db, code, name)
    _ensure_kiosk_for_machine(db, "KIOSK_HAAS_ST40", "Kiosk HAAS ST40", "HAAS_ST40")
    customer = _get_or_create_demo_customer(db)
    real_portfolio = _resolve_real_portfolio_variants(db)
    _ensure_product_stock_baseline(db, real_portfolio)
    material_trace = _ensure_demo_material_traceability(db)
    db.commit()

    order_info = _create_demo_customer_order_and_job_items(db, int(customer.id), real_portfolio)
    po_result = create_production_orders_from_allocation(int(order_info["customer_order_id"]), db)
    created_scan_rows = _ensure_po_linkage_and_operations(db, real_portfolio)
    movement_links = _attach_material_movement_to_created_pos(db, material_trace["material_stock_item_id"])
    stock_trace = _ensure_source_vp_receipt_for_sklad_zakaznik(db, real_portfolio["sklad_zakaznik_id"])
    planner = PlanningEngineService(db)
    plan_result = planner.rebuild_all(date.today())
    db.commit()

    return {
        "status": "ok",
        "customer_id": int(customer.id),
        "real_portfolio_ids": real_portfolio,
        "material_traceability": material_trace,
        "stock_traceability": stock_trace,
        "order": order_info,
        "production_orders_from_allocation": po_result,
        "production_order_operation_rows_created": created_scan_rows,
        "material_movement_links_created": movement_links,
        "planner": plan_result,
        "kiosk_hint": "Use /kiosk/production?machine=HAAS_ST40 after login on admin screen; scan WOO from demo VP.",
    }
