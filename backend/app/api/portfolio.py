from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func, inspect as sa_inspect, select, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, selectinload

from app.core.database import get_db
from app.models.master_data import Customer
from app.models.master_libraries import OperationLibraryItem, WorkplaceLibraryItem
from app.models.material_library import MaterialLibraryItem
from app.models.material_stock import MaterialStockItem, MaterialStockReservation
from app.models.portfolio import (
    PortfolioGroup,
    PortfolioItem,
    PortfolioTechnologyTemplate,
    PortfolioTechnologyTemplateMaterial,
    PortfolioTechnologyTemplateOperation,
)

router = APIRouter()


def ensure_portfolio_technology_operation_library_fks(engine: Engine) -> None:
    """SQLite: add FK columns to template operations if missing (create_all does not migrate)."""
    try:
        url = str(engine.url)
    except Exception:
        return
    if not url.startswith("sqlite"):
        return

    insp = sa_inspect(engine)
    if "portfolio_technology_template_operations" not in insp.get_table_names():
        return

    cols = {c["name"] for c in insp.get_columns("portfolio_technology_template_operations")}
    stmts: list[str] = []
    if "operation_library_item_id" not in cols:
        stmts.append(
            "ALTER TABLE portfolio_technology_template_operations ADD COLUMN operation_library_item_id INTEGER"
        )
    if "workplace_library_item_id" not in cols:
        stmts.append(
            "ALTER TABLE portfolio_technology_template_operations ADD COLUMN workplace_library_item_id INTEGER"
        )
    if not stmts:
        return

    with engine.begin() as conn:
        for stmt in stmts:
            conn.execute(text(stmt))


class PortfolioOperationUpsert(BaseModel):
    operation_library_item_id: int | None = None
    workplace_library_item_id: int | None = None
    setup_time_min: float = 0
    labor_time_per_piece_min: float = 0
    control_required: bool = False
    outsourcing: bool = False
    note: str | None = None


class ReorderOperationsBody(BaseModel):
    ordered_operation_ids: list[int]


class PortfolioOperationUpdate(BaseModel):
    operation_no: int | None = None
    operation_library_item_id: int | None = None
    workplace_library_item_id: int | None = None
    setup_time_min: float | None = None
    labor_time_per_piece_min: float | None = None
    control_required: bool | None = None
    outsourcing: bool | None = None
    note: str | None = None


class PortfolioTechnologyMaterialUpsert(BaseModel):
    material_library_item_id: int
    consumption_per_piece: float | None = None
    consumption_unit: str | None = None
    scrap_allowance: float | None = None
    note: str | None = None


class PortfolioTechnologyMaterialUpdate(BaseModel):
    material_library_item_id: int | None = None
    consumption_per_piece: float | None = None
    consumption_unit: str | None = None
    scrap_allowance: float | None = None
    note: str | None = None


def _operation_to_payload(op: PortfolioTechnologyTemplateOperation) -> dict:
    op_name = op.operation_name
    if op.operation_library_item_id is not None and op.operation_library_item is not None:
        op_name = op.operation_library_item.name
    machine = op.workplace
    if op.workplace_library_item_id is not None and op.workplace_library_item is not None:
        machine = op.workplace_library_item.name
    return {
        "id": op.id,
        "operation_no": op.operation_no,
        "operation_name": op_name,
        "machine_code": machine,
        "operation_library_item_id": op.operation_library_item_id,
        "workplace_library_item_id": op.workplace_library_item_id,
        "setup_time_min": op.setup_min,
        "labor_time_per_piece_min": op.run_min_per_piece,
        "control_required": op.control_required,
        "outsourcing": op.outsourcing,
        "note": op.note,
    }


def _material_to_payload(
    row: PortfolioTechnologyTemplateMaterial,
    stock_by_material_id: dict[int, MaterialStockItem] | None = None,
    reserved_by_stock_id: dict[int, float] | None = None,
) -> dict:
    stock_row = None
    if stock_by_material_id is not None:
        stock_row = stock_by_material_id.get(row.material_library_item_id)

    if stock_row is None:
        stock_status = "neni_skladova_karta"
        stock_reserved_qty = None
        stock_available_qty = None
    else:
        rsum = float(reserved_by_stock_id.get(stock_row.id, 0.0)) if reserved_by_stock_id is not None else 0.0
        stock_reserved_qty = rsum
        stock_available_qty = stock_row.current_qty - rsum
        if stock_row.min_qty is not None and stock_row.current_qty < stock_row.min_qty:
            stock_status = "pod_minimem"
        else:
            stock_status = "skladem"

    return {
        "id": row.id,
        "material_library_item_id": row.material_library_item_id,
        "material_name": row.material_library_item.name if row.material_library_item else "",
        "material_code": row.material_library_item.code if row.material_library_item else None,
        "consumption_per_piece": row.consumption_per_piece,
        "consumption_unit": row.consumption_unit,
        "scrap_allowance": row.scrap_allowance,
        "note": row.note,
        "stock_item_id": stock_row.id if stock_row else None,
        "stock_location": stock_row.location if stock_row else None,
        "stock_current_qty": stock_row.current_qty if stock_row else None,
        "stock_min_qty": stock_row.min_qty if stock_row else None,
        "stock_reserved_qty": stock_reserved_qty,
        "stock_available_qty": stock_available_qty,
        "stock_status": stock_status,
    }


def seed_portfolio_demo_data(db: Session) -> None:
    # Safe seed: only for brand-new clean portfolio tables.
    already_seeded = db.scalar(select(PortfolioItem.id).limit(1))
    if already_seeded is not None:
        return

    customers = db.scalars(select(Customer).order_by(Customer.id.asc()).limit(2)).all()
    if len(customers) < 2:
        demo_customer_specs = [
            ("DEMO-CUST-001", "John Crane"),
            ("DEMO-CUST-002", "EXCALIBUR ARMY spol. s r.o."),
        ]
        for code, name in demo_customer_specs:
            existing = db.scalar(select(Customer).where(Customer.code == code))
            if existing is None:
                db.add(Customer(code=code, name=name, is_active=True))
        db.flush()
        customers = db.scalars(select(Customer).order_by(Customer.id.asc()).limit(2)).all()
        if len(customers) < 2:
            return

    c1, c2 = customers[0], customers[1]

    g1 = PortfolioGroup(customer_id=c1.id, name="Přesné obrábění", code="PG-OBR", is_active=True)
    g2 = PortfolioGroup(customer_id=c2.id, name="Svařence a montáž", code="PG-SVA", is_active=True)
    db.add_all([g1, g2])
    db.flush()

    items = [
        PortfolioItem(
            customer_id=c1.id,
            portfolio_group_id=g1.id,
            gpn="102-045-772",
            name="Převlečná objímka (duplex)",
            drawing_no="DWG-102045772",
            revision="A",
            material_default="Ocel 11 353.1",
            logistic_mode="vyroba_zakaznik",
            is_active=True,
        ),
        PortfolioItem(
            customer_id=c1.id,
            portfolio_group_id=g1.id,
            gpn="107-118-504",
            name="Distanční kroužek (ring)",
            drawing_no="DWG-107118504",
            revision="B",
            material_default="Legovaná ocel",
            logistic_mode="sklad_zakaznik",
            is_active=True,
        ),
        PortfolioItem(
            customer_id=c1.id,
            portfolio_group_id=g1.id,
            gpn="114-030-919",
            name="Těleso spojky (sleeve)",
            drawing_no="DWG-114030919",
            revision="A",
            material_default="Ocel 16 111",
            logistic_mode="vyroba_zakaznik",
            is_active=True,
        ),
        PortfolioItem(
            customer_id=c2.id,
            portfolio_group_id=g2.id,
            gpn="121-090-281",
            name="Spojovací pouzdro",
            drawing_no="DWG-121090281",
            revision="C",
            material_default="Ocel 11 460",
            logistic_mode="sklad",
            is_active=True,
        ),
        PortfolioItem(
            customer_id=c2.id,
            portfolio_group_id=g2.id,
            gpn="136-002-441",
            name="Výztuha rámu",
            drawing_no="DWG-136002441",
            revision="A",
            material_default="Ocel S355",
            logistic_mode="vyroba_zakaznik",
            is_active=True,
        ),
    ]
    db.add_all(items)
    db.flush()

    t1 = PortfolioTechnologyTemplate(portfolio_item_id=items[0].id, name="TP - Převlečná objímka", version="A", is_active=True)
    t2 = PortfolioTechnologyTemplate(portfolio_item_id=items[1].id, name="TP - Distanční kroužek", version="A", is_active=True)
    t4 = PortfolioTechnologyTemplate(portfolio_item_id=items[3].id, name="TP - Spojovací pouzdro", version="B", is_active=True)
    db.add_all([t1, t2, t4])
    db.flush()

    db.add_all(
        [
            PortfolioTechnologyTemplateOperation(
                template_id=t1.id,
                operation_no=10,
                operation_name="Řezání polotovaru",
                workplace="PILA-01",
                setup_min=12,
                run_min_per_piece=0.7,
                control_required=False,
                outsourcing=False,
                note="Řez na délku + odjehlení",
            ),
            PortfolioTechnologyTemplateOperation(
                template_id=t1.id,
                operation_no=20,
                operation_name="Soustružení",
                workplace="CNC-SOU-03",
                setup_min=18,
                run_min_per_piece=2.4,
                control_required=True,
                outsourcing=False,
                note=None,
            ),
            PortfolioTechnologyTemplateOperation(
                template_id=t1.id,
                operation_no=30,
                operation_name="Zinkování",
                workplace="KOOP-ZN",
                setup_min=0,
                run_min_per_piece=3.2,
                control_required=False,
                outsourcing=True,
                note="Kooperace externě",
            ),
            PortfolioTechnologyTemplateOperation(
                template_id=t1.id,
                operation_no=40,
                operation_name="Výstupní kontrola",
                workplace="KONTROLA-01",
                setup_min=8,
                run_min_per_piece=0.9,
                control_required=True,
                outsourcing=False,
                note=None,
            ),
            PortfolioTechnologyTemplateOperation(
                template_id=t2.id,
                operation_no=10,
                operation_name="Broušení",
                workplace="BRUSKA-02",
                setup_min=10,
                run_min_per_piece=1.6,
                control_required=True,
                outsourcing=False,
                note=None,
            ),
            PortfolioTechnologyTemplateOperation(
                template_id=t4.id,
                operation_no=10,
                operation_name="Finální kontrola",
                workplace="KONTROLA-02",
                setup_min=6,
                run_min_per_piece=0.8,
                control_required=True,
                outsourcing=False,
                note=None,
            ),
        ]
    )
    db.commit()


@router.get("/items")
def get_portfolio_items(db: Session = Depends(get_db)):
    seed_portfolio_demo_data(db)
    items = db.scalars(select(PortfolioItem).order_by(PortfolioItem.gpn.asc())).all()

    result = []
    for item in items:
        active_template_id = None
        for template in item.technology_templates:
            if template.is_active:
                active_template_id = template.id
                break

        result.append(
            {
                "id": item.id,
                "gpn": item.gpn,
                "name": item.name,
                "customer_id": item.customer_id,
                "group_id": item.portfolio_group_id,
                "active_template_id": active_template_id,
            }
        )
    return result


@router.get("/items/{item_id}")
def get_portfolio_item(item_id: int, db: Session = Depends(get_db)):
    item = db.scalar(select(PortfolioItem).where(PortfolioItem.id == item_id))
    if not item:
        raise HTTPException(status_code=404, detail="Portfolio item not found")

    return {
        "id": item.id,
        "gpn": item.gpn,
        "name": item.name,
        "customer_id": item.customer_id,
        "group_id": item.portfolio_group_id,
    }


@router.get("/items/{item_id}/technology")
def get_portfolio_item_technology(item_id: int, db: Session = Depends(get_db)):
    item = db.scalar(select(PortfolioItem).where(PortfolioItem.id == item_id))
    if not item:
        raise HTTPException(status_code=404, detail="Portfolio item not found")

    template = db.scalar(
        select(PortfolioTechnologyTemplate)
        .where(PortfolioTechnologyTemplate.portfolio_item_id == item_id, PortfolioTechnologyTemplate.is_active.is_(True))
        .options(
            selectinload(PortfolioTechnologyTemplate.operations).selectinload(
                PortfolioTechnologyTemplateOperation.operation_library_item
            ),
            selectinload(PortfolioTechnologyTemplate.operations).selectinload(
                PortfolioTechnologyTemplateOperation.workplace_library_item
            ),
        )
        .order_by(PortfolioTechnologyTemplate.id.asc())
    )

    if not template:
        return {
            "template_id": None,
            "template_name": None,
            "operations": [],
        }

    return {
        "template_id": template.id,
        "template_name": template.name,
        "operations": [_operation_to_payload(op) for op in template.operations],
    }


@router.post("/items/{item_id}/technology-template")
def create_item_technology_template(item_id: int, db: Session = Depends(get_db)):
    item = db.scalar(select(PortfolioItem).where(PortfolioItem.id == item_id))
    if not item:
        raise HTTPException(status_code=404, detail="Portfolio item not found")

    existing = db.scalar(
        select(PortfolioTechnologyTemplate)
        .where(
            PortfolioTechnologyTemplate.portfolio_item_id == item_id,
            PortfolioTechnologyTemplate.is_active.is_(True),
        )
        .order_by(PortfolioTechnologyTemplate.id.asc())
    )
    if existing:
        return {
            "template_id": existing.id,
            "template_name": existing.name,
            "created": False,
        }

    template = PortfolioTechnologyTemplate(
        portfolio_item_id=item_id,
        name=f"TP - {item.name}",
        version="A",
        is_active=True,
    )
    db.add(template)
    db.commit()
    db.refresh(template)
    return {
        "template_id": template.id,
        "template_name": template.name,
        "created": True,
    }


@router.post("/templates/{template_id}/operations")
def create_template_operation(
    template_id: int,
    payload: PortfolioOperationUpsert,
    db: Session = Depends(get_db),
):
    template = db.scalar(select(PortfolioTechnologyTemplate).where(PortfolioTechnologyTemplate.id == template_id))
    if not template:
        raise HTTPException(status_code=404, detail="Technology template not found")

    last_operation = db.scalar(
        select(PortfolioTechnologyTemplateOperation)
        .where(PortfolioTechnologyTemplateOperation.template_id == template_id)
        .order_by(PortfolioTechnologyTemplateOperation.operation_no.desc())
        .limit(1)
    )
    next_operation_no = (last_operation.operation_no + 10) if last_operation else 10

    if payload.operation_library_item_id is None:
        raise HTTPException(status_code=422, detail="operation_library_item_id is required")

    op_lib = db.scalar(
        select(OperationLibraryItem).where(OperationLibraryItem.id == payload.operation_library_item_id)
    )
    if not op_lib:
        raise HTTPException(status_code=404, detail="Operation library item not found")

    wp_lib: WorkplaceLibraryItem | None = None
    if payload.workplace_library_item_id is not None:
        wp_lib = db.scalar(
            select(WorkplaceLibraryItem).where(WorkplaceLibraryItem.id == payload.workplace_library_item_id)
        )
        if not wp_lib:
            raise HTTPException(status_code=404, detail="Workplace library item not found")

    row = PortfolioTechnologyTemplateOperation(
        template_id=template_id,
        operation_no=next_operation_no,
        operation_name=op_lib.name,
        workplace=wp_lib.name if wp_lib else None,
        operation_library_item_id=op_lib.id,
        workplace_library_item_id=wp_lib.id if wp_lib else None,
        setup_min=payload.setup_time_min,
        run_min_per_piece=payload.labor_time_per_piece_min,
        control_required=payload.control_required,
        outsourcing=payload.outsourcing,
        note=payload.note,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    row = db.scalar(
        select(PortfolioTechnologyTemplateOperation)
        .where(PortfolioTechnologyTemplateOperation.id == row.id)
        .options(
            selectinload(PortfolioTechnologyTemplateOperation.operation_library_item),
            selectinload(PortfolioTechnologyTemplateOperation.workplace_library_item),
        )
    )
    return _operation_to_payload(row)


@router.get("/items/{item_id}/technology-material")
def get_portfolio_item_technology_material(item_id: int, db: Session = Depends(get_db)):
    item = db.scalar(select(PortfolioItem).where(PortfolioItem.id == item_id))
    if not item:
        raise HTTPException(status_code=404, detail="Portfolio item not found")

    template = db.scalar(
        select(PortfolioTechnologyTemplate)
        .where(PortfolioTechnologyTemplate.portfolio_item_id == item_id, PortfolioTechnologyTemplate.is_active.is_(True))
        .order_by(PortfolioTechnologyTemplate.id.asc())
    )

    if not template:
        return {"template_id": None, "materials": []}

    materials = db.scalars(
        select(PortfolioTechnologyTemplateMaterial)
        .where(PortfolioTechnologyTemplateMaterial.template_id == template.id)
        .options(selectinload(PortfolioTechnologyTemplateMaterial.material_library_item))
        .order_by(PortfolioTechnologyTemplateMaterial.id.asc())
    ).all()

    material_ids = sorted({m.material_library_item_id for m in materials})
    stock_rows = db.scalars(
        select(MaterialStockItem)
        .where(MaterialStockItem.material_library_item_id.in_(material_ids))
        .order_by(
            MaterialStockItem.material_library_item_id.asc(),
            MaterialStockItem.id.asc(),
        )
    ).all() if material_ids else []
    stock_by_material_id: dict[int, MaterialStockItem] = {}
    for stock in stock_rows:
        if stock.material_library_item_id not in stock_by_material_id:
            stock_by_material_id[stock.material_library_item_id] = stock

    stock_ids = [s.id for s in stock_by_material_id.values()]
    reserved_by_stock_id: dict[int, float] = {}
    if stock_ids:
        sums = db.execute(
            select(
                MaterialStockReservation.stock_item_id,
                func.coalesce(func.sum(MaterialStockReservation.reserved_qty), 0.0),
            )
            .where(MaterialStockReservation.stock_item_id.in_(stock_ids))
            .group_by(MaterialStockReservation.stock_item_id)
        ).all()
        reserved_by_stock_id = {int(sid): float(total) for sid, total in sums}

    return {
        "template_id": template.id,
        "materials": [_material_to_payload(row, stock_by_material_id, reserved_by_stock_id) for row in materials],
    }


@router.post("/templates/{template_id}/technology-material")
def create_template_technology_material(
    template_id: int,
    payload: PortfolioTechnologyMaterialUpsert,
    db: Session = Depends(get_db),
):
    template = db.scalar(select(PortfolioTechnologyTemplate).where(PortfolioTechnologyTemplate.id == template_id))
    if not template:
        raise HTTPException(status_code=404, detail="Technology template not found")

    material = db.scalar(select(MaterialLibraryItem).where(MaterialLibraryItem.id == payload.material_library_item_id))
    if not material:
        raise HTTPException(status_code=404, detail="Material library item not found")

    row = PortfolioTechnologyTemplateMaterial(
        template_id=template_id,
        material_library_item_id=payload.material_library_item_id,
        consumption_per_piece=payload.consumption_per_piece,
        consumption_unit=payload.consumption_unit,
        scrap_allowance=payload.scrap_allowance,
        note=payload.note,
    )
    db.add(row)
    db.commit()
    db.refresh(row)

    row = db.scalar(
        select(PortfolioTechnologyTemplateMaterial)
        .where(PortfolioTechnologyTemplateMaterial.id == row.id)
        .options(selectinload(PortfolioTechnologyTemplateMaterial.material_library_item))
    )
    return _material_to_payload(row)


@router.put("/technology-material/{material_id}")
def update_template_technology_material(
    material_id: int,
    payload: PortfolioTechnologyMaterialUpdate,
    db: Session = Depends(get_db),
):
    row = db.scalar(
        select(PortfolioTechnologyTemplateMaterial).where(PortfolioTechnologyTemplateMaterial.id == material_id)
    )
    if not row:
        raise HTTPException(status_code=404, detail="Technology template material not found")

    data = payload.model_dump(exclude_unset=True)

    if "material_library_item_id" in data:
        mid = data["material_library_item_id"]
        if mid is None:
            raise HTTPException(status_code=422, detail="material_library_item_id cannot be null")
        material = db.scalar(select(MaterialLibraryItem).where(MaterialLibraryItem.id == mid))
        if not material:
            raise HTTPException(status_code=404, detail="Material library item not found")
        row.material_library_item_id = mid

    if "consumption_per_piece" in data:
        row.consumption_per_piece = data["consumption_per_piece"]
    if "consumption_unit" in data:
        row.consumption_unit = data["consumption_unit"]
    if "scrap_allowance" in data:
        row.scrap_allowance = data["scrap_allowance"]
    if "note" in data:
        row.note = data["note"]

    db.commit()
    db.refresh(row)
    row = db.scalar(
        select(PortfolioTechnologyTemplateMaterial)
        .where(PortfolioTechnologyTemplateMaterial.id == row.id)
        .options(selectinload(PortfolioTechnologyTemplateMaterial.material_library_item))
    )
    return _material_to_payload(row)


@router.delete("/technology-material/{material_id}")
def delete_template_technology_material(material_id: int, db: Session = Depends(get_db)):
    row = db.scalar(
        select(PortfolioTechnologyTemplateMaterial).where(PortfolioTechnologyTemplateMaterial.id == material_id)
    )
    if not row:
        raise HTTPException(status_code=404, detail="Technology template material not found")
    db.delete(row)
    db.commit()
    return {"status": "ok"}


@router.post("/templates/{template_id}/operations/reorder")
def reorder_template_operations(
    template_id: int,
    payload: ReorderOperationsBody,
    db: Session = Depends(get_db),
):
    template = db.scalar(select(PortfolioTechnologyTemplate).where(PortfolioTechnologyTemplate.id == template_id))
    if not template:
        raise HTTPException(status_code=404, detail="Technology template not found")

    operations = db.scalars(
        select(PortfolioTechnologyTemplateOperation)
        .where(PortfolioTechnologyTemplateOperation.template_id == template_id)
        .order_by(
            PortfolioTechnologyTemplateOperation.operation_no.asc(),
            PortfolioTechnologyTemplateOperation.id.asc(),
        )
    ).all()

    existing_ids = {op.id for op in operations}
    ordered = payload.ordered_operation_ids

    if len(ordered) != len(existing_ids):
        raise HTTPException(
            status_code=400,
            detail="ordered_operation_ids must contain exactly all operations for this template",
        )
    if set(ordered) != existing_ids:
        raise HTTPException(
            status_code=400,
            detail="ordered_operation_ids must match template operations exactly",
        )

    id_to_op = {op.id: op for op in operations}
    for idx, op_id in enumerate(ordered):
        id_to_op[op_id].operation_no = (idx + 1) * 10

    db.commit()
    return {"status": "ok"}


@router.put("/template-operations/{operation_id}")
def update_template_operation(
    operation_id: int,
    payload: PortfolioOperationUpdate,
    db: Session = Depends(get_db),
):
    row = db.scalar(
        select(PortfolioTechnologyTemplateOperation).where(PortfolioTechnologyTemplateOperation.id == operation_id)
    )
    if not row:
        raise HTTPException(status_code=404, detail="Technology template operation not found")

    data = payload.model_dump(exclude_unset=True)

    if "operation_no" in data and data["operation_no"] is not None and data["operation_no"] <= 0:
        raise HTTPException(status_code=422, detail="operation_no must be integer > 0")

    if "operation_library_item_id" in data:
        oid = data["operation_library_item_id"]
        if oid is None:
            row.operation_library_item_id = None
        else:
            op_lib = db.scalar(select(OperationLibraryItem).where(OperationLibraryItem.id == oid))
            if not op_lib:
                raise HTTPException(status_code=404, detail="Operation library item not found")
            row.operation_library_item_id = oid
            row.operation_name = op_lib.name

    if "workplace_library_item_id" in data:
        wid = data["workplace_library_item_id"]
        if wid is None:
            row.workplace_library_item_id = None
        else:
            wp_lib = db.scalar(select(WorkplaceLibraryItem).where(WorkplaceLibraryItem.id == wid))
            if not wp_lib:
                raise HTTPException(status_code=404, detail="Workplace library item not found")
            row.workplace_library_item_id = wid
            row.workplace = wp_lib.name

    if "setup_time_min" in data:
        row.setup_min = data["setup_time_min"]
    if "labor_time_per_piece_min" in data:
        row.run_min_per_piece = data["labor_time_per_piece_min"]
    if "control_required" in data:
        row.control_required = data["control_required"]
    if "outsourcing" in data:
        row.outsourcing = data["outsourcing"]
    if "note" in data:
        row.note = data["note"]
    if "operation_no" in data and data["operation_no"] is not None:
        row.operation_no = data["operation_no"]

    if "operation_no" in data and data["operation_no"] is not None:
        operations_in_template = db.scalars(
            select(PortfolioTechnologyTemplateOperation)
            .where(PortfolioTechnologyTemplateOperation.template_id == row.template_id)
            .order_by(
                PortfolioTechnologyTemplateOperation.operation_no.asc(),
                PortfolioTechnologyTemplateOperation.id.asc(),
            )
        ).all()
        for idx, op in enumerate(operations_in_template):
            op.operation_no = (idx + 1) * 10

    db.commit()
    db.refresh(row)
    row = db.scalar(
        select(PortfolioTechnologyTemplateOperation)
        .where(PortfolioTechnologyTemplateOperation.id == row.id)
        .options(
            selectinload(PortfolioTechnologyTemplateOperation.operation_library_item),
            selectinload(PortfolioTechnologyTemplateOperation.workplace_library_item),
        )
    )
    return _operation_to_payload(row)


@router.delete("/template-operations/{operation_id}")
def delete_template_operation(operation_id: int, db: Session = Depends(get_db)):
    row = db.scalar(
        select(PortfolioTechnologyTemplateOperation).where(PortfolioTechnologyTemplateOperation.id == operation_id)
    )
    if not row:
        raise HTTPException(status_code=404, detail="Technology template operation not found")

    db.delete(row)
    db.commit()
    return {"status": "ok"}

