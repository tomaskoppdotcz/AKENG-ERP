from fastapi import APIRouter, Depends
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.orders import CustomerOrder, Job, JobItem

router = APIRouter()


def _job_items_have_price_column(db: Session) -> bool:
  rows = db.execute(text("PRAGMA table_info(job_items)")).fetchall()
  return any(row[1] == "sales_price_per_unit" for row in rows)


@router.get("/orders-overview/list")
def get_orders_overview(db: Session = Depends(get_db)):
  jobs = db.scalars(select(Job).order_by(Job.id.desc())).all()

  if not jobs:
    return {"orders": []}

  # preload customer orders
  customer_ids = {job.customer_order_id for job in jobs if job.customer_order_id is not None}
  customer_map = {}
  if customer_ids:
    customer_rows = db.scalars(
      select(CustomerOrder).where(CustomerOrder.id.in_(customer_ids))
    ).all()
    customer_map = {row.id: row for row in customer_rows}

  # preload items per job
  job_ids = [job.id for job in jobs]
  items = db.scalars(
    select(JobItem).where(JobItem.job_id.in_(job_ids))
  ).all()
  items_by_job: dict[int, list[JobItem]] = {}
  for it in items:
    items_by_job.setdefault(it.job_id, []).append(it)

  have_price = _job_items_have_price_column(db)

  price_by_job: dict[int, float] = {}
  if have_price:
    rows = db.execute(
      text(
        "SELECT job_id, SUM(COALESCE(qty,0) * COALESCE(sales_price_per_unit,0)) "
        "FROM job_items GROUP BY job_id"
      )
    ).fetchall()
    price_by_job = {int(r[0]): float(r[1] or 0) for r in rows}

  result = []

  for job in jobs:
    co = customer_map.get(job.customer_order_id)
    job_items = items_by_job.get(job.id, [])

    termin = None
    if job_items:
      latest = max((it.due_date for it in job_items if it.due_date is not None), default=None)
      termin = latest.isoformat() if latest else None

    vykresy = len(job_items)
    kusy_celkem = sum(int(it.qty or 0) for it in job_items)
    prodejni_cena = price_by_job.get(job.id, 0.0)

    result.append(
      {
        "zakazka": job.zak_code,
        "zakaznik": co.customer_name if co else None,
        "objednavka": co.customer_po_no if co else None,
        "datum": co.order_date.isoformat() if co and co.order_date else None,
        "termin": termin,
        "vykresy": vykresy,
        "kusy_celkem": kusy_celkem,
        "prodejni_cena": prodejni_cena,
        "naklad": 0,
        "vykazany_cas": 0,
        "vykonnost": 0,
        "hotovo": 0,
        "customer_order_id": co.id if co else None,
        "job_id": job.id,
      }
    )

  return {"orders": result}

