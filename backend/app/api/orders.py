from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.orders import CustomerOrder, Job, JobItem, ProductionOrder

router = APIRouter()


@router.get("/customer-orders")
def get_customer_orders(db: Session = Depends(get_db)):
    rows = db.scalars(select(CustomerOrder).order_by(CustomerOrder.id.desc())).all()
    return [
        {
            "id": row.id,
            "customer_po_no": row.customer_po_no,
            "customer_name": row.customer_name,
            "order_date": row.order_date.isoformat() if row.order_date else None,
        }
        for row in rows
    ]


@router.get("/jobs")
def get_jobs(db: Session = Depends(get_db)):
    rows = db.scalars(select(Job).order_by(Job.id.desc())).all()
    return [
        {
            "id": row.id,
            "zak_code": row.zak_code,
            "customer_order_id": row.customer_order_id,
        }
        for row in rows
    ]


@router.get("/job-items")
def get_job_items(db: Session = Depends(get_db)):
    rows = db.scalars(select(JobItem).order_by(JobItem.id.asc())).all()
    return [
        {
            "id": row.id,
            "job_id": row.job_id,
            "line_no": row.line_no,
            "gpn": row.gpn,
            "qty": row.qty,
            "due_date": row.due_date.isoformat() if row.due_date else None,
        }
        for row in rows
    ]


@router.get("/production-orders")
def get_production_orders(db: Session = Depends(get_db)):
    rows = db.scalars(select(ProductionOrder).order_by(ProductionOrder.id.asc())).all()
    return [
        {
            "id": row.id,
            "vp_code": row.vp_code,
            "job_item_id": row.job_item_id,
        }
        for row in rows
    ]
