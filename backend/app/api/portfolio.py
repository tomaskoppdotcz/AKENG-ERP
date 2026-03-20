from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.master_data import Customer
from app.models.portfolio import (
    PortfolioGroup,
    PortfolioItem,
    PortfolioTechnologyTemplate,
    PortfolioTechnologyTemplateOperation,
)

router = APIRouter()


class PortfolioOperationUpsert(BaseModel):
    operation_name: str
    machine_code: str | None = None
    setup_time_min: float = 0
    labor_time_per_piece_min: float = 0
    control_required: bool = False
    outsourcing: bool = False
    note: str | None = None


class PortfolioOperationUpdate(BaseModel):
    operation_no: int | None = None
    operation_name: str | None = None
    machine_code: str | None = None
    setup_time_min: float | None = None
    labor_time_per_piece_min: float | None = None
    control_required: bool | None = None
    outsourcing: bool | None = None
    note: str | None = None


def _operation_to_payload(op: PortfolioTechnologyTemplateOperation) -> dict:
    return {
        "id": op.id,
        "operation_no": op.operation_no,
        "operation_name": op.operation_name,
        "machine_code": op.workplace,
        "setup_time_min": op.setup_min,
        "labor_time_per_piece_min": op.run_min_per_piece,
        "control_required": op.control_required,
        "outsourcing": op.outsourcing,
        "note": op.note,
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

    row = PortfolioTechnologyTemplateOperation(
        template_id=template_id,
        operation_no=next_operation_no,
        operation_name=payload.operation_name,
        workplace=payload.machine_code,
        setup_min=payload.setup_time_min,
        run_min_per_piece=payload.labor_time_per_piece_min,
        control_required=payload.control_required,
        outsourcing=payload.outsourcing,
        note=payload.note,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _operation_to_payload(row)


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

    if "operation_name" in data:
        row.operation_name = data["operation_name"]
    if "machine_code" in data:
        row.workplace = data["machine_code"]
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

