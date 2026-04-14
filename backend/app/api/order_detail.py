from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.orders import CustomerOrder, Job, JobItem, JobItemCoverage, ProductionOrder
from app.models.portfolio import PortfolioItem
from app.models.product_stock import ProductStockItem

router = APIRouter()


def _customer_order_detail_dict(co: CustomerOrder) -> dict:
  rs = getattr(co, "requested_ship_date", None)
  ot = getattr(co, "order_type", None)
  if ot is None or str(ot).strip() == "":
    ot = "customer"
  return {
    "id": co.id,
    "zakaznik": co.customer_name,
    "objednavka": co.customer_po_no,
    "datum": co.order_date.isoformat() if co.order_date else None,
    "customer_id": getattr(co, "customer_id", None),
    "requested_ship_date": rs.isoformat() if rs else None,
    "note": getattr(co, "note", None),
    "order_type": str(ot).strip().lower(),
    "workflow_status": getattr(co, "workflow_status", None),
  }


def _job_items_have_optional_columns(db: Session) -> tuple[bool, bool, bool]:
  rows = db.execute(text("PRAGMA table_info(job_items)")).fetchall()
  cols = {row[1] for row in rows}
  return ("description" in cols, "sales_price_per_unit" in cols, "portfolio_item_id" in cols)


def _customer_coverage_rows(vp_list: list[dict]) -> list[dict]:
  """Řádky pokrytí zakázky: jen stock_allocation a order_allocation (ne restock / interní doplnění)."""
  rows: list[dict] = []
  for po in vp_list:
    st = po.get("source_type")
    if st == "stock_allocation":
      label = "Ze skladu"
    elif st == "order_allocation":
      label = "Výroba pro zakázku"
    else:
      continue
    rows.append(
      {
        "source_type": st,
        "source_label": label,
        "quantity": int(po.get("quantity") or 0),
        "vp_code": po.get("vp_code"),
        "logistic_mode": po.get("logistic_mode"),
      }
    )
  return rows


def _pick_effective_logistic_mode(coverage_rows: list[dict], vp_rows: list[dict]) -> str | None:
  """Priorita pro TP variantu: sklad_zakaznik, jinak vyroba_zakaznik."""
  has_stock = any(
    str(r.get("coverage_type") or "").strip().lower() == "stock"
    for r in coverage_rows
  ) or any(
    str(v.get("source_type") or "").strip().lower() == "stock_allocation"
    for v in vp_rows
  )
  if has_stock:
    return "sklad_zakaznik"
  has_order = any(
    str(r.get("coverage_type") or "").strip().lower() == "new_production"
    for r in coverage_rows
  ) or any(
    str(v.get("source_type") or "").strip().lower() == "order_allocation"
    for v in vp_rows
  )
  if has_order:
    return "vyroba_zakaznik"
  return None


@router.get("/order-detail/{customer_order_id}")
def get_order_detail(customer_order_id: int, db: Session = Depends(get_db)):
  co = db.get(CustomerOrder, customer_order_id)
  if not co:
    raise HTTPException(status_code=404, detail="Customer order not found")

  co_detail = _customer_order_detail_dict(co)
  co_type = str(co_detail.get("order_type") or "customer").strip().lower()

  job = db.scalars(
    select(Job)
    .where(Job.customer_order_id == customer_order_id)
    .order_by(Job.id.asc())
  ).first()

  if not job:
    return {
      "job": None,
      "customer_order": co_detail,
      "summary": {
        "termin": None,
        "vykresy": 0,
        "kusy_celkem": 0,
        "prodejni_cena": 0,
        "total_sales_price": 0.0,
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
  portfolio_sale_price_by_id: dict[int, float | None] = {}
  portfolio_material_default_by_id: dict[int, str | None] = {}
  if portfolio_item_id_by_item:
    pids = sorted({int(pid) for pid in portfolio_item_id_by_item.values() if pid is not None})
    if pids:
      p_rows = db.scalars(select(PortfolioItem).where(PortfolioItem.id.in_(pids))).all()
      portfolio_name_by_id = {int(p.id): p.name for p in p_rows}
      portfolio_sale_price_by_id = {
        int(p.id): (float(p.sale_price_per_piece) if p.sale_price_per_piece is not None else None)
        for p in p_rows
      }
      portfolio_material_default_by_id = {int(p.id): p.material_default for p in p_rows}

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
    .order_by(ProductionOrder.id.asc())
  ).all()
  vp_by_item: dict[int, str] = {}
  vp_count_by_item: dict[int, int] = {}
  vp_list_by_item: dict[int, list[dict]] = {}
  for vp in vp_rows:
    vp_by_item.setdefault(vp.job_item_id, vp.vp_code)
    vp_count_by_item[vp.job_item_id] = vp_count_by_item.get(vp.job_item_id, 0) + 1
    vp_list_by_item.setdefault(vp.job_item_id, []).append(
      {
        "id": int(vp.id),
        "vp_code": vp.vp_code,
        "quantity": int(vp.quantity or 0),
        "logistic_mode": vp.logistic_mode,
        "source_type": vp.source_type,
        "status": vp.status,
        "workflow_status": getattr(vp, "workflow_status", None),
      }
    )

  coverage_rows = db.scalars(
    select(JobItemCoverage)
    .where(JobItemCoverage.job_item_id.in_([it.id for it in items]))
    .order_by(JobItemCoverage.id.asc())
  ).all()
  source_po_ids = sorted(
    {
      int(c.source_production_order_id)
      for c in coverage_rows
      if c.source_production_order_id is not None
    }
  )
  consuming_po_ids = sorted(
    {
      int(c.consuming_production_order_id)
      for c in coverage_rows
      if c.consuming_production_order_id is not None
    }
  )
  po_ids = sorted(set(source_po_ids + consuming_po_ids))
  po_by_id: dict[int, ProductionOrder] = {}
  if po_ids:
    for row in db.scalars(select(ProductionOrder).where(ProductionOrder.id.in_(po_ids))).all():
      po_by_id[int(row.id)] = row
  coverage_by_item: dict[int, list[dict]] = {}
  for c in coverage_rows:
    source_po = po_by_id.get(int(c.source_production_order_id)) if c.source_production_order_id is not None else None
    consuming_po = po_by_id.get(int(c.consuming_production_order_id)) if c.consuming_production_order_id is not None else None
    coverage_by_item.setdefault(int(c.job_item_id), []).append(
      {
        "id": int(c.id),
        "coverage_type": c.coverage_type,
        "qty": int(c.qty or 0),
        "source_production_order_code": source_po.vp_code if source_po is not None else None,
        "source_stock_receipt_id": int(c.source_stock_receipt_id) if c.source_stock_receipt_id is not None else None,
        "consuming_production_order_code": consuming_po.vp_code if consuming_po is not None else None,
        "consuming_logistic_mode": consuming_po.logistic_mode if consuming_po is not None else None,
        "note": c.note,
      }
    )

  def _coverage_rows_fallback_from_vp(job_item_id: int) -> list[dict]:
    rows: list[dict] = []
    for po in vp_list_by_item.get(job_item_id, []):
      st = po.get("source_type")
      if st not in {"stock_allocation", "order_allocation"}:
        continue
      coverage_type = "stock" if st == "stock_allocation" else "new_production"
      po_id = int(po.get("id") or 0)
      rows.append(
        {
          "id": -po_id if po_id > 0 else 0,
          "coverage_type": coverage_type,
          "qty": int(po.get("quantity") or 0),
          "source_production_order_code": None,
          "source_stock_receipt_id": None,
          "consuming_production_order_code": po.get("vp_code"),
          "consuming_logistic_mode": po.get("logistic_mode"),
          "note": "Odvozeno z navázaného VP (chybí samostatný záznam pokrytí).",
        }
      )
    return rows

  termin = None
  if items:
    latest = max((it.due_date for it in items if it.due_date is not None), default=None)
    termin = latest.isoformat() if latest else None

  prodejni_cena = sum(
    float(price_by_id.get(it.id, 0.0)) * int(it.qty or 0) for it in items
  )
  vykresy = len(items)
  kusy_celkem = sum(int(it.qty or 0) for it in items)

  def _item_sale_price_per_piece(job_item_id: int) -> float | None:
    pid = portfolio_item_id_by_item.get(job_item_id)
    if pid is None:
      return None
    spp = portfolio_sale_price_by_id.get(int(pid))
    return spp

  total_sales_price = sum(
    float(spp) * int(it.qty or 0)
    for it in items
    if (spp := _item_sale_price_per_piece(it.id)) is not None
  )

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

  def _item_allocation_and_coverage(it: JobItem) -> dict:
    vp_list = vp_list_by_item.get(it.id, [])
    if co_type == "internal":
      # Interní řádek = jen poptávka doplnění skladu; bez zákaznického plnění.
      return {
        "required_qty": None,
        "stock_qty": None,
        "from_stock_qty": None,
        "to_production_qty": None,
        "restock_qty": None,
        "customer_coverage": [],
        "coverage_rows": [],
      }
    return {
      **_allocation_payload(it),
      "customer_coverage": _customer_coverage_rows(vp_list),
      "coverage_rows": (
        coverage_by_item.get(int(it.id), [])
        if coverage_by_item.get(int(it.id), [])
        else _coverage_rows_fallback_from_vp(int(it.id))
      ),
    }

  def _effective_portfolio_variant_id(it: JobItem) -> int | None:
    base_pid = portfolio_item_id_by_item.get(it.id)
    if base_pid is None:
      return None
    cov_rows = coverage_by_item.get(int(it.id), [])
    if not cov_rows:
      cov_rows = _coverage_rows_fallback_from_vp(int(it.id))
    vp_rows_for_item = vp_list_by_item.get(int(it.id), [])
    mode = _pick_effective_logistic_mode(cov_rows, vp_rows_for_item)
    if mode is None:
      return int(base_pid)
    base_portfolio = next(
      (p for p in db.scalars(select(PortfolioItem).where(PortfolioItem.id == int(base_pid))).all()),
      None,
    )
    gpn = (base_portfolio.gpn if base_portfolio is not None else it.gpn) or ""
    if not gpn.strip():
      return int(base_pid)
    variants = db.scalars(
      select(PortfolioItem).where(
        func.lower(func.trim(PortfolioItem.gpn)) == gpn.strip().lower(),
        PortfolioItem.logistic_mode == mode,
      )
    ).all()
    if not variants:
      return int(base_pid)
    ranked = sorted(
      variants,
      key=lambda p: (
        0 if bool(getattr(p, "is_active", False)) else 1,
        0 if getattr(p, "active_template_id", None) is not None else 1,
        int(p.id),
      ),
    )
    return int(ranked[0].id)

  return {
    "job": {
      "id": job.id,
      "zakazka": job.zak_code,
      "customer_order_id": job.customer_order_id,
    },
    "customer_order": co_detail,
    "summary": {
      "termin": termin,
      "vykresy": vykresy,
      "kusy_celkem": kusy_celkem,
      "prodejni_cena": prodejni_cena,
      "total_sales_price": float(total_sales_price),
    },
    "items": [
      {
        "job_item_id": it.id,
        "line_no": it.line_no,
        "gpn": it.gpn,
        "description": description_by_id.get(it.id) if have_description else None,
        "qty": it.qty,
        "due_date": it.due_date.isoformat() if it.due_date else None,
        "workflow_status": getattr(it, "workflow_status", None),
        "sales_price_per_unit": price_by_id.get(it.id) if have_price_col else None,
        "sale_price_per_piece": _item_sale_price_per_piece(it.id),
        "vp_code": vp_by_item.get(it.id),
        "vp_count": int(vp_count_by_item.get(it.id, 0)),
        "production_orders": vp_list_by_item.get(it.id, []),
        "portfolio_item_id": portfolio_item_id_by_item.get(it.id) if have_portfolio_fk else None,
        "portfolio_item_name": (
          portfolio_name_by_id.get(int(portfolio_item_id_by_item.get(it.id)))
          if portfolio_item_id_by_item.get(it.id) is not None
          else None
        ),
        "material_default": (
          portfolio_material_default_by_id.get(int(portfolio_item_id_by_item.get(it.id)))
          if portfolio_item_id_by_item.get(it.id) is not None
          else None
        ),
        "effective_portfolio_item_id": _effective_portfolio_variant_id(it),
        **_item_allocation_and_coverage(it),
      }
      for it in items
    ],
  }

