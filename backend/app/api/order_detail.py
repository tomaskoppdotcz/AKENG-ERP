from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.orders import CustomerOrder, Job, JobItem, ProductionOrder
from app.models.portfolio import PortfolioItem
from app.models.product_stock import ProductStockItem

router = APIRouter()


def _customer_order_detail_dict(co: CustomerOrder) -> dict:
  rs = getattr(co, "requested_ship_date", None)
  return {
    "id": co.id,
    "zakaznik": co.customer_name,
    "objednavka": co.customer_po_no,
    "datum": co.order_date.isoformat() if co.order_date else None,
    "customer_id": getattr(co, "customer_id", None),
    "requested_ship_date": rs.isoformat() if rs else None,
    "note": getattr(co, "note", None),
  }


def _job_items_have_optional_columns(db: Session) -> tuple[bool, bool, bool]:
  rows = db.execute(text("PRAGMA table_info(job_items)")).fetchall()
  cols = {row[1] for row in rows}
  return ("description" in cols, "sales_price_per_unit" in cols, "portfolio_item_id" in cols)


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
      "job": None,
      "customer_order": _customer_order_detail_dict(co),
      "summary": {
        "termin": None,
        "vykresy": 0,
        "kusy_celkem": 0,
        "prodejni_cena": 0,
      },
      "items": [],
    }

  items = db.scalars(
    select(JobItem).where(JobItem.job_id == job.id).order_by(JobItem.line_no.asc())
  ).all()

  have_description, have_price_col, have_portfolio_fk = _job_items_have_optional_columns(db)

  description_by_id: dict[int, str | None] = {}
  price_by_id: dict[int, float] = {}
  portfolio_item_id_by_item: dict[int, int | None] = {}

  if (have_description or have_price_col or have_portfolio_fk) and items:
    for it in items:
      select_cols: list[str] = []
      if have_description:
        select_cols.append("description")
      if have_price_col:
        select_cols.append("sales_price_per_unit")
      if have_portfolio_fk:
        select_cols.append("portfolio_item_id")
      row = db.execute(
        text(
          "SELECT " + ", ".join(select_cols) + " FROM job_items WHERE id = :id"
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
        idx += 1
      if have_portfolio_fk:
        portfolio_item_id_by_item[it.id] = row[idx]

  portfolio_name_by_id: dict[int, str | None] = {}
  if portfolio_item_id_by_item:
    pids = sorted({int(pid) for pid in portfolio_item_id_by_item.values() if pid is not None})
    if pids:
      p_rows = db.scalars(select(PortfolioItem).where(PortfolioItem.id.in_(pids))).all()
      portfolio_name_by_id = {int(p.id): p.name for p in p_rows}

  stock_qty_by_portfolio_id: dict[int, float] = {}
  min_qty_by_portfolio_id: dict[int, float] = {}
  if portfolio_item_id_by_item:
    stock_pids = sorted({int(pid) for pid in portfolio_item_id_by_item.values() if pid is not None})
    if stock_pids:
      stock_rows = db.scalars(select(ProductStockItem).where(ProductStockItem.portfolio_item_id.in_(stock_pids))).all()
      for row in stock_rows:
        pid = int(row.portfolio_item_id)
        stock_qty_by_portfolio_id[pid] = stock_qty_by_portfolio_id.get(pid, 0.0) + float(row.current_qty or 0.0)
        min_qty_by_portfolio_id[pid] = min_qty_by_portfolio_id.get(pid, 0.0) + float(row.min_qty or 0.0)

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

  def _allocation_payload(it: JobItem) -> dict[str, float]:
    required_qty = float(it.qty or 0.0)
    pid = portfolio_item_id_by_item.get(it.id)
    if pid is None:
      return {
        "required_qty": required_qty,
        "stock_qty": 0.0,
        "from_stock_qty": 0.0,
        "to_production_qty": required_qty,
        "restock_qty": 0.0,
      }

    stock_qty = stock_qty_by_portfolio_id.get(int(pid), 0.0)
    min_qty = min_qty_by_portfolio_id.get(int(pid), 0.0)
    from_stock_qty = min(required_qty, stock_qty)
    to_production_qty = max(required_qty - stock_qty, 0.0)
    remaining_after_allocation = stock_qty - from_stock_qty
    restock_qty = max(min_qty - remaining_after_allocation, 0.0)
    return {
      "required_qty": required_qty,
      "stock_qty": stock_qty,
      "from_stock_qty": from_stock_qty,
      "to_production_qty": to_production_qty,
      "restock_qty": restock_qty,
    }

  return {
    "job": {
      "id": job.id,
      "zakazka": job.zak_code,
      "customer_order_id": job.customer_order_id,
    },
    "customer_order": _customer_order_detail_dict(co),
    "summary": {
      "termin": termin,
      "vykresy": vykresy,
      "kusy_celkem": kusy_celkem,
      "prodejni_cena": prodejni_cena,
    },
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
        "portfolio_item_id": portfolio_item_id_by_item.get(it.id) if have_portfolio_fk else None,
        "portfolio_item_name": (
          portfolio_name_by_id.get(int(portfolio_item_id_by_item.get(it.id)))
          if portfolio_item_id_by_item.get(it.id) is not None
          else None
        ),
        **_allocation_payload(it),
      }
      for it in items
    ],
  }

