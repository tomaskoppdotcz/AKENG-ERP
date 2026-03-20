from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.portfolio import PortfolioItem, PortfolioTechnologyTemplate

router = APIRouter()


@router.get("/items")
def get_portfolio_items(db: Session = Depends(get_db)):
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

