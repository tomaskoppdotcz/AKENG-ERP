from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.orders import CustomerOrder, Job, JobItem
from app.services.business_workflow import workflow_record_active
from app.models.planning import PlanningOperation
from app.models.portfolio import PortfolioItem
from app.models.production import OperationLog

router = APIRouter()


def _job_items_have_portfolio_fk(db: Session) -> bool:
  rows = db.execute(text("PRAGMA table_info(job_items)")).fetchall()
  cols = {row[1] for row in rows}
  return "portfolio_item_id" in cols


def _order_type_value(co: CustomerOrder) -> str:
  v = getattr(co, "order_type", None)
  if v is None or str(v).strip() == "":
    return "customer"
  return str(v).strip().lower()


@router.get("/orders-overview/list")
def get_orders_overview(
  order_type: str = Query("customer", description="customer | internal | all"),
  workflow_filter: str = Query("active", description="active | cancelled | all"),
  db: Session = Depends(get_db),
):
  ot = (order_type or "customer").strip().lower()
  if ot not in ("customer", "internal", "all"):
    ot = "customer"
  wf = (workflow_filter or "active").strip().lower()
  if wf not in ("active", "cancelled", "all"):
    wf = "active"

  jobs = db.scalars(select(Job).order_by(Job.id.desc())).all()

  if not jobs:
    return {"orders": []}

  # preload customer orders
  customer_ids = {job.customer_order_id for job in jobs if job.customer_order_id is not None}
  customer_map: dict[int, CustomerOrder] = {}
  if customer_ids:
    customer_rows = db.scalars(
      select(CustomerOrder).where(CustomerOrder.id.in_(customer_ids))
    ).all()
    full_map = {row.id: row for row in customer_rows}
    if ot == "customer":
      customer_map = {k: v for k, v in full_map.items() if _order_type_value(v) != "internal"}
    elif ot == "internal":
      customer_map = {k: v for k, v in full_map.items() if _order_type_value(v) == "internal"}
    else:
      customer_map = full_map

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
  active_template_id_by_portfolio_id: dict[int, int | None] = {}
  if portfolio_id_by_item:
    pids = {int(pid) for pid in portfolio_id_by_item.values() if pid is not None}
    if pids:
      p_rows = db.scalars(select(PortfolioItem).where(PortfolioItem.id.in_(pids))).all()
      portfolio_sale_price_by_id = {
        int(p.id): (float(p.sale_price_per_piece) if p.sale_price_per_piece is not None else None)
        for p in p_rows
      }
      # Sloupec active_template_id je zajištěn v ensure_portfolio_items_sqlite_schema (startup).
      if pids:
        in_list = ",".join(str(int(pid)) for pid in sorted(pids))
        raw_active = db.execute(
          text(f"SELECT id, active_template_id FROM portfolio_items WHERE id IN ({in_list})")
        ).fetchall()
        active_template_id_by_portfolio_id = {int(r[0]): (int(r[1]) if r[1] is not None else None) for r in raw_active}

  # Fallback pro starší data bez active_template_id: vezmi první aktivní šablonu nebo poslední podle id.
  template_id_by_portfolio_id: dict[int, int | None] = dict(active_template_id_by_portfolio_id)
  if portfolio_id_by_item:
    pids = {int(pid) for pid in portfolio_id_by_item.values() if pid is not None}
    missing_pids = [pid for pid in pids if template_id_by_portfolio_id.get(pid) is None]
    if missing_pids:
      in_list = ",".join(str(int(pid)) for pid in sorted(missing_pids))
      raw_tpl = db.execute(
        text(
          "SELECT id, portfolio_item_id, is_active "
          f"FROM portfolio_technology_templates WHERE portfolio_item_id IN ({in_list}) "
          "ORDER BY portfolio_item_id ASC, is_active DESC, id DESC"
        )
      ).fetchall()
      for r in raw_tpl:
        pid = int(r[1])
        if template_id_by_portfolio_id.get(pid) is None:
          template_id_by_portfolio_id[pid] = int(r[0])

  # Vykázané minuty: operation_logs přes planning_operations.order_item_id (job_item_id).
  reported_min_by_item_id: dict[int, float] = {}
  if job_ids:
    item_ids = [it.id for it in items]
    if item_ids:
      p_ops = db.scalars(
        select(PlanningOperation).where(PlanningOperation.order_item_id.in_(item_ids))
      ).all()
      planning_op_by_id = {int(po.id): po for po in p_ops}
      if planning_op_by_id:
        logs = db.scalars(
          select(OperationLog).where(OperationLog.planning_operation_id.in_(planning_op_by_id.keys()))
        ).all()
        now_utc = datetime.now(timezone.utc)
        for lg in logs:
          po = planning_op_by_id.get(int(lg.planning_operation_id))
          if po is None or po.order_item_id is None:
            continue
          minutes = float(lg.duration_min) if lg.duration_min is not None else 0.0
          if minutes <= 0 and lg.started_at is not None and lg.ended_at is None:
            started = lg.started_at
            if started.tzinfo is None:
              started = started.replace(tzinfo=timezone.utc)
            minutes = max((now_utc - started).total_seconds() / 60.0, 0.0)
          reported_min_by_item_id[int(po.order_item_id)] = reported_min_by_item_id.get(int(po.order_item_id), 0.0) + max(minutes, 0.0)

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

  def planned_min_for_item(it: JobItem) -> float:
    pid = portfolio_id_by_item.get(it.id)
    if pid is None:
      return 0.0
    tpl_id = template_id_by_portfolio_id.get(int(pid))
    if tpl_id is None:
      return 0.0
    # setup + (run/ks * qty)
    # run_min_per_piece součtově odpovídá 1 ks, proto násobíme qty.
    # setup_min je jednorázově na položku.
    # Zde máme ops_sum = setup_sum + run_sum_per_piece.
    # Přesnější rozklad: potřebujeme setup_sum + run_sum_per_piece * qty.
    # Proto čteme setup a run zvlášť:
    raw = db.execute(
      text(
        "SELECT SUM(COALESCE(setup_min,0)), SUM(COALESCE(run_min_per_piece,0)) "
        "FROM portfolio_technology_template_operations WHERE template_id = :tid"
      ),
      {"tid": int(tpl_id)},
    ).fetchone()
    if not raw:
      return 0.0
    setup_sum = float(raw[0] or 0.0)
    run_per_piece_sum = float(raw[1] or 0.0)
    qty = int(it.qty or 0)
    return setup_sum + (run_per_piece_sum * qty)

  result = []

  for job in jobs:
    co = customer_map.get(job.customer_order_id)
    if co is None:
      continue
    co_active = workflow_record_active(co)
    if wf == "active" and not co_active:
      continue
    if wf == "cancelled" and co_active:
      continue
    job_items = items_by_job.get(job.id, [])

    termin = None
    if job_items:
      latest = max((it.due_date for it in job_items if it.due_date is not None), default=None)
      termin = latest.isoformat() if latest else None

    vykresy = len(job_items)
    kusy_celkem = sum(int(it.qty or 0) for it in job_items)
    # Stejná logika jako order-detail summary.total_sales_price (portfolio sale_price_per_piece)
    prodejni_cena = portfolio_sales_total_for_job(job_items)
    planned_min = sum(planned_min_for_item(it) for it in job_items)
    reported_min = sum(float(reported_min_by_item_id.get(int(it.id), 0.0)) for it in job_items)
    remaining_min = max(planned_min - reported_min, 0.0)
    vykazany_hod = reported_min / 60.0
    remaining_hod = remaining_min / 60.0
    hotovo = 0.0
    if planned_min > 0:
      hotovo = min(max((reported_min / planned_min) * 100.0, 0.0), 100.0)

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
        "vykazany_cas": vykazany_hod,
        "zbyvajici_hodiny": remaining_hod,
        "planovane_hodiny": planned_min / 60.0,
        "vykonnost": 0,
        "hotovo": hotovo,
        "customer_order_id": co.id if co else None,
        "job_id": job.id,
        "workflow_status": getattr(co, "workflow_status", None),
      }
    )

  return {"orders": result}

