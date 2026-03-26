from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.orders import CustomerOrder, Job, JobItem, ProductionOrder, ProductionOrderOperation

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

    raise HTTPException(status_code=404, detail="Scan kód nebyl nalezen.")
