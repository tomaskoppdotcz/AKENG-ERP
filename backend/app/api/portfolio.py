from fastapi import APIRouter, Depends, HTTPException
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
        return None

    return {
        "template_id": template.id,
        "template_name": template.name,
        "operations": [
            {
                "id": op.id,
                "operation_no": op.operation_no,
                "operation_name": op.operation_name,
                "machine_code": op.workplace,
                "setup_time_min": op.setup_min,
                "labor_time_per_piece_min": op.run_min_per_piece,
            }
            for op in template.operations
        ],
    }

