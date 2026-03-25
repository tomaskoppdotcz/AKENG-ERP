from fastapi import APIRouter, Depends
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.orders import CustomerOrder, Job, JobItem
from app.models.portfolio import PortfolioItem

router = APIRouter()


def _job_items_have_portfolio_fk(db: Session) -> bool:
  rows = db.execute(text("PRAGMA table_info(job_items)")).fetchall()
  cols = {row[1] for row in rows}
  return "portfolio_item_id" in cols


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

  have_portfolio = _job_items_have_portfolio_fk(db)

  portfolio_id_by_item: dict[int, int | None] = {}
  if have_portfolio and job_ids:
    in_list = ",".join(str(int(j)) for j in job_ids)
    raw_pf = db.execute(
      text(f"SELECT id, portfolio_item_id FROM job_items WHERE job_id IN ({in_list})")
    ).fetchall()
    portfolio_id_by_item = {int(r[0]): r[1] for r in raw_pf}

  portfolio_sale_price_by_id: dict[int, float | None] = {}
  if portfolio_id_by_item:
    pids = {int(pid) for pid in portfolio_id_by_item.values() if pid is not None}
    if pids:
      p_rows = db.scalars(select(PortfolioItem).where(PortfolioItem.id.in_(pids))).all()
      portfolio_sale_price_by_id = {
        int(p.id): (float(p.sale_price_per_piece) if p.sale_price_per_piece is not None else None)
        for p in p_rows
      }

  def portfolio_sales_total_for_job(job_items: list[JobItem]) -> float:
    total = 0.0
    for it in job_items:
      pid = portfolio_id_by_item.get(it.id)
      if pid is None:
        continue
      spp = portfolio_sale_price_by_id.get(int(pid))
      if spp is None:
        continue
      total += float(spp) * int(it.qty or 0)
    return total

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
    # Stejná logika jako order-detail summary.total_sales_price (portfolio sale_price_per_piece)
    prodejni_cena = portfolio_sales_total_for_job(job_items)

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

