"""
Populate production_order_operations.note for VP Rezani/Pila (FIFO cutting text).
Invoked when VP operations are created or rebuilt. No stock writes.
"""

from __future__ import annotations

import logging

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.material_library import MaterialLibraryItem
from app.models.orders import JobItem, ProductionOrder, ProductionOrderOperation
from app.models.portfolio import (
    PortfolioItem,
    PortfolioTechnologyTemplate,
    PortfolioTechnologyTemplateMaterial,
)
from app.services.cutting_instructions_service import build_cutting_instructions_for_pila
from app.services.material_issue_proposal import propose_material_issue_source
from app.services.material_receipt_unit_service import (
    load_fifo_receipt_units,
    receipt_unit_rows_to_engine_snapshots,
)

logger = logging.getLogger(__name__)


def is_pila_operation_name(operation_name: str | None) -> bool:
    n = operation_name or ""
    if "\u0158ez\u00e1n\u00ed" in n:
        return True
    if "Pila" in n or "pila" in n:
        return True
    return False


def _select_active_portfolio_tp_local(db: Session, portfolio_item_id: int) -> PortfolioTechnologyTemplate | None:
    tpl = db.scalars(
        select(PortfolioTechnologyTemplate)
        .where(
            PortfolioTechnologyTemplate.portfolio_item_id == int(portfolio_item_id),
            PortfolioTechnologyTemplate.is_active.is_(True),
        )
        .order_by(PortfolioTechnologyTemplate.id.asc())
    ).first()
    if tpl is None:
        tpl = db.scalars(
            select(PortfolioTechnologyTemplate)
            .where(PortfolioTechnologyTemplate.portfolio_item_id == int(portfolio_item_id))
            .order_by(PortfolioTechnologyTemplate.id.asc())
        ).first()
    return tpl


def _select_first_tp_material_for_cutting(
    db: Session, template_id: int
) -> PortfolioTechnologyTemplateMaterial | None:
    rows = db.scalars(
        select(PortfolioTechnologyTemplateMaterial)
        .where(PortfolioTechnologyTemplateMaterial.template_id == int(template_id))
        .order_by(PortfolioTechnologyTemplateMaterial.id.asc())
    ).all()
    for row in rows:
        it = str(row.input_type or "material").strip().lower()
        if it not in {"", "material"}:
            continue
        if row.material_library_item_id is None:
            continue
        return row
    return None


def _planning_qty_for_vp(po: ProductionOrder, job_item: JobItem | None) -> int:
    q = int(po.quantity or 0)
    if q <= 0 and job_item is not None:
        q = int(job_item.qty or 0)
    return max(q, 0)


def apply_pila_cutting_notes_to_vp_operations(
    db: Session,
    *,
    po: ProductionOrder,
    job_item: JobItem | None = None,
) -> None:
    try:
        _apply_pila_cutting_notes_to_vp_operations_impl(db, po=po, job_item=job_item)
    except Exception:
        logger.exception(
            "apply_pila_cutting_notes: unexpected failure (left notes unchanged) vp_id=%s",
            getattr(po, "id", None),
        )


def _apply_pila_cutting_notes_to_vp_operations_impl(
    db: Session,
    *,
    po: ProductionOrder,
    job_item: JobItem | None,
) -> None:
    ji = job_item if job_item is not None else (db.get(JobItem, int(po.job_item_id)) if po.job_item_id else None)
    if ji is None:
        return

    pid = int(po.portfolio_item_id) if po.portfolio_item_id is not None else None
    if pid is None:
        _clear_pila_notes(db, po)
        return

    tpl = _select_active_portfolio_tp_local(db, int(pid))
    if tpl is None:
        _clear_pila_notes(db, po)
        return

    mat_row = _select_first_tp_material_for_cutting(db, int(tpl.id))
    if mat_row is None or mat_row.material_library_item_id is None:
        _clear_pila_notes(db, po)
        return

    mid = int(mat_row.material_library_item_id)
    delka = float(mat_row.consumption_per_piece or 0.0)
    if delka <= 0:
        _clear_pila_notes(db, po)
        return

    vraw = mat_row.vyrabet_max_po_ks
    if vraw is None or int(vraw) < 1:
        _clear_pila_notes(db, po)
        return
    vyrabeno_po = int(vraw)

    prorez = max(float(mat_row.scrap_allowance or 0.0), 0.0)
    upnuti = max(float(mat_row.na_upnuti_mm or 0.0), 0.0)
    povolit = bool(mat_row.povolit_deleni_polotovaru)

    qty = _planning_qty_for_vp(po, ji)
    if qty <= 0:
        _clear_pila_notes(db, po)
        return

    demand_for_pick = max(float(qty) * delka, 1.0)
    proposal = propose_material_issue_source(
        db, mid, demand_for_pick, exclude_job_item_id=int(po.job_item_id) if po.job_item_id else None
    )
    if proposal is None:
        _clear_pila_notes(db, po)
        return
    stock_item_id = int(proposal["stock_item_id"])
    raw_units = load_fifo_receipt_units(db, stock_item_id)
    snapshots = receipt_unit_rows_to_engine_snapshots(raw_units)
    if not snapshots:
        _clear_pila_notes(db, po)
        return

    mlib = db.get(MaterialLibraryItem, int(mid))
    mat_label = None
    if mlib is not None:
        code = (mlib.code or "").strip()
        name = (mlib.name or "").strip()
        if code and name:
            mat_label = f"{code} - {name}"
        elif name:
            mat_label = name
        elif code:
            mat_label = code

    portfolio = db.get(PortfolioItem, int(pid))
    draw_ref: str | None = None
    if portfolio is not None:
        parts: list[str] = []
        if portfolio.drawing_no and str(portfolio.drawing_no).strip():
            parts.append(str(portfolio.drawing_no).strip())
        if portfolio.revision and str(portfolio.revision).strip():
            parts.append("rev. " + str(portfolio.revision).strip())
        if parts:
            draw_ref = " ".join(parts)
    order_ref = (po.vp_code or "").strip() or None

    res = build_cutting_instructions_for_pila(
        requested_piece_count=int(qty),
        delka_na_kus_mm=float(delka),
        vyrabeno_po=int(vyrabeno_po),
        na_upnuti_mm=float(upnuti),
        prorez_mm=float(prorez),
        povolit_deleni_polotovaru=bool(povolit),
        receipt_units=snapshots,
        material_label=mat_label,
        drawing_or_order_ref=draw_ref or order_ref,
    )

    pila_rows = db.scalars(
        select(ProductionOrderOperation).where(ProductionOrderOperation.production_order_id == int(po.id))
    ).all()
    for row in pila_rows:
        if not is_pila_operation_name(row.operation_name):
            continue
        if res.ok and (res.text or "").strip():
            row.note = res.text
        else:
            row.note = None


def _clear_pila_notes(db: Session, po: ProductionOrder) -> None:
    rows = db.scalars(
        select(ProductionOrderOperation).where(ProductionOrderOperation.production_order_id == int(po.id))
    ).all()
    for row in rows:
        if is_pila_operation_name(row.operation_name):
            row.note = None
