from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.material_stock import MaterialStockItem
from app.models.orders import CustomerOrder, Job, JobItem, ProductionOrder, ProductionOrderOperation
from app.models.portfolio import PortfolioItem
from app.models.product_stock import ProductStockItem

router = APIRouter()


class ScanLookupPayload(BaseModel):
    scan_code: str = Field(..., min_length=1)


@router.post("")
def scan_lookup(payload: ScanLookupPayload, db: Session = Depends(get_db)):
    code = payload.scan_code.strip()
    if not code:
        raise HTTPException(status_code=422, detail="scan_code je povinný.")

    co = db.scalar(select(CustomerOrder).where(CustomerOrder.scan_code == code))
    if co is not None:
        job = db.scalars(select(Job).where(Job.customer_order_id == int(co.id)).order_by(Job.id.asc())).first()
        return {
            "entity_type": "customer_order",
            "entity_id": int(co.id),
            "scan_code": code,
            "label": f"Objednávka {co.customer_po_no}",
            "target_page": "orders",
            "target_params": {"customer_order_id": int(co.id), "job_id": int(job.id) if job is not None else None},
        }

    ji = db.scalar(select(JobItem).where(JobItem.scan_code == code))
    if ji is not None:
        job = db.get(Job, int(ji.job_id)) if ji.job_id is not None else None
        return {
            "entity_type": "order_item",
            "entity_id": int(ji.id),
            "scan_code": code,
            "label": f"Položka {ji.gpn}",
            "target_page": "order_item",
            "target_params": {"job_item_id": int(ji.id), "job_id": int(job.id) if job is not None else None},
        }

    po = db.scalar(select(ProductionOrder).where(ProductionOrder.scan_code == code))
    if po is not None:
        return {
            "entity_type": "production_order",
            "entity_id": int(po.id),
            "scan_code": code,
            "label": f"Výrobní příkaz {po.vp_code}",
            "target_page": "production_order",
            "target_params": {"production_order_id": int(po.id)},
        }

    po_op = db.scalar(select(ProductionOrderOperation).where(ProductionOrderOperation.scan_code == code))
    if po_op is not None:
        po2 = db.get(ProductionOrder, int(po_op.production_order_id))
        return {
            "entity_type": "production_order_operation",
            "entity_id": int(po_op.id),
            "scan_code": code,
            "label": (
                f"Operace VP {po2.vp_code} / č. {po_op.operation_no}"
                if po2 is not None
                else f"Operace č. {po_op.operation_no}"
            ),
            "target_page": "production_order_operation",
            "target_params": {
                "production_order_id": int(po_op.production_order_id),
                "operation_no": int(po_op.operation_no),
            },
        }

    pi = db.scalar(select(PortfolioItem).where(PortfolioItem.scan_code == code))
    if pi is not None:
        return {
            "entity_type": "portfolio_item",
            "entity_id": int(pi.id),
            "scan_code": code,
            "label": f"Portfolio {pi.gpn}",
            "target_page": "portfolio",
            "target_params": {"portfolio_item_id": int(pi.id)},
        }

    pi_gpn = db.scalar(select(PortfolioItem).where(func.lower(PortfolioItem.gpn) == code.lower()))
    if pi_gpn is not None:
        return {
            "entity_type": "portfolio_item",
            "entity_id": int(pi_gpn.id),
            "scan_code": code,
            "label": f"Portfolio {pi_gpn.gpn}",
            "target_page": "portfolio",
            "target_params": {"portfolio_item_id": int(pi_gpn.id)},
        }

    msi = db.scalar(select(MaterialStockItem).where(MaterialStockItem.scan_code == code))
    if msi is not None:
        return {
            "entity_type": "material_stock_item",
            "entity_id": int(msi.id),
            "scan_code": code,
            "label": f"Sklad materiálu #{msi.id}",
            "target_page": "material_stock",
            "target_params": {"material_stock_item_id": int(msi.id)},
        }

    psi = db.scalar(select(ProductStockItem).where(ProductStockItem.scan_code == code))
    if psi is not None:
        return {
            "entity_type": "product_stock_item",
            "entity_id": int(psi.id),
            "scan_code": code,
            "label": f"Sklad výrobků #{psi.id}",
            "target_page": "product_stock",
            "target_params": {"product_stock_item_id": int(psi.id)},
        }

    raise HTTPException(status_code=404, detail="Kód nenalezen")
