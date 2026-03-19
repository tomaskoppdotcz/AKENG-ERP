from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.orders import CustomerOrder, Job, JobItem, ProductionOrder

router = APIRouter()


def _job_items_have_optional_columns(db: Session) -> tuple[bool, bool]:
  rows = db.execute(text("PRAGMA table_info(job_items)")).fetchall()
  cols = {row[1] for row in rows}
  return ("description" in cols, "sales_price_per_unit" in cols)


@router.get("/order-detail/{customer_order_id}")
def get_order_detail(customer_order_id: int, db: Session = Depends(get_db)):
  co = db.get(CustomerOrder, customer_order_id)
  if not co:
    raise HTTPException(status_code=404, detail="Customer order not found")

  job = db.scalars(
    select(Job)
    .where(Job.customer_order_id == customer_order_id)
    .order_by(Job.id.asc())
  ).first()

  if not job:
    return {
      "zakazka": None,
      "zakaznik": co.customer_name,
      "objednavka": co.customer_po_no,
      "datum": co.order_date.isoformat() if co.order_date else None,
      "termin": None,
      "vykresy": 0,
      "kusy_celkem": 0,
      "prodejni_cena": 0,
      "items": [],
    }

  items = db.scalars(
    select(JobItem).where(JobItem.job_id == job.id).order_by(JobItem.line_no.asc())
  ).all()

  have_description, have_price_col = _job_items_have_optional_columns(db)

  description_by_id: dict[int, str | None] = {}
  price_by_id: dict[int, float] = {}

  if (have_description or have_price_col) and items:
    for it in items:
      row = db.execute(
        text(
          "SELECT "
          + ("description, " if have_description else "")
          + ("sales_price_per_unit " if have_price_col else "")
          + "FROM job_items WHERE id = :id"
        ),
        {"id": it.id},
      ).fetchone()

      if not row:
        continue

      idx = 0
      if have_description:
        description_by_id[it.id] = row[idx]
        idx += 1
      if have_price_col:
        price_by_id[it.id] = float(row[idx] or 0)

  vp_rows = db.scalars(
    select(ProductionOrder)
    .where(ProductionOrder.job_item_id.in_([it.id for it in items]))
  ).all()
  vp_by_item: dict[int, str] = {}
  for vp in vp_rows:
    vp_by_item.setdefault(vp.job_item_id, vp.vp_code)

  termin = None
  if items:
    latest = max((it.due_date for it in items if it.due_date is not None), default=None)
    termin = latest.isoformat() if latest else None

  prodejni_cena = sum(
    float(price_by_id.get(it.id, 0.0)) * int(it.qty or 0) for it in items
  )
  vykresy = len(items)
  kusy_celkem = sum(int(it.qty or 0) for it in items)

  return {
    "zakazka": job.zak_code,
    "zakaznik": co.customer_name,
    "objednavka": co.customer_po_no,
    "datum": co.order_date.isoformat() if co.order_date else None,
    "termin": termin,
    "vykresy": vykresy,
    "kusy_celkem": kusy_celkem,
    "prodejni_cena": prodejni_cena,
    "items": [
      {
        "job_item_id": it.id,
        "line_no": it.line_no,
        "gpn": it.gpn,
        "description": description_by_id.get(it.id) if have_description else None,
        "qty": it.qty,
        "due_date": it.due_date.isoformat() if it.due_date else None,
        "sales_price_per_unit": price_by_id.get(it.id) if have_price_col else None,
        "vp_code": vp_by_item.get(it.id),
      }
      for it in items
    ],
  }

