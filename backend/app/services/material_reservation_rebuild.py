"""Recalculate material reservation required_qty from current TP data (additive kerf)."""

from __future__ import annotations

import logging
import math
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.material_library import MaterialLibraryItem
from app.models.material_stock import MaterialReservation, MaterialStockItem
from app.models.orders import ProductionOrder
from app.models.portfolio import PortfolioTechnologyTemplate, PortfolioTechnologyTemplateMaterial

from app.services.material_consumption import log_material_consumption_debug, total_material_consumption
from app.services.material_reservation_sync import (
    MATERIAL_RESERVATION_ACTIVE_STATUSES,
    enforce_material_reservation_stock_ceiling,
    sum_eligible_reserved_qty_for_material,
)

logger = logging.getLogger(__name__)


def _select_active_template_id(db: Session, portfolio_item_id: int | None) -> int | None:
    if portfolio_item_id is None:
        return None
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
    return int(tpl.id) if tpl is not None else None


def _available_qty_excluding_reservation(
    db: Session,
    material_library_item_id: int,
    exclude_reservation_id: int,
) -> float:
    on_stock = db.scalar(
        select(func.coalesce(func.sum(MaterialStockItem.current_qty), 0.0)).where(
            MaterialStockItem.material_library_item_id == int(material_library_item_id)
        )
    )
    reserved = sum_eligible_reserved_qty_for_material(
        db,
        int(material_library_item_id),
        exclude_reservation_id=int(exclude_reservation_id),
    )
    return max(float(on_stock or 0.0) - reserved, 0.0)


def _material_template_rows(
    db: Session,
    template_id: int,
    material_library_item_id: int,
) -> list[PortfolioTechnologyTemplateMaterial]:
    rows = db.scalars(
        select(PortfolioTechnologyTemplateMaterial)
        .where(
            PortfolioTechnologyTemplateMaterial.template_id == int(template_id),
            PortfolioTechnologyTemplateMaterial.material_library_item_id == int(material_library_item_id),
        )
        .order_by(PortfolioTechnologyTemplateMaterial.id.asc())
    ).all()
    out: list[PortfolioTechnologyTemplateMaterial] = []
    for r in rows:
        it = str(r.input_type or "material").strip().lower()
        if it in {"", "material"}:
            out.append(r)
    return out


def _resolve_template_row_for_reservation(
    db: Session,
    *,
    reservation: MaterialReservation,
    po: ProductionOrder,
    template_id: int,
) -> PortfolioTechnologyTemplateMaterial | None:
    mat_rows = _material_template_rows(db, template_id, int(reservation.material_library_item_id))
    if not mat_rows:
        return None
    siblings = db.scalars(
        select(MaterialReservation)
        .where(
            MaterialReservation.production_order_id == int(po.id),
            MaterialReservation.material_library_item_id == int(reservation.material_library_item_id),
            MaterialReservation.status.in_(tuple(MATERIAL_RESERVATION_ACTIVE_STATUSES)),
            MaterialReservation.is_active.is_(True),
        )
        .order_by(MaterialReservation.id.asc())
    ).all()
    idx = None
    for i, s in enumerate(siblings):
        if int(s.id) == int(reservation.id):
            idx = i
            break
    if idx is None or idx >= len(mat_rows):
        return None
    return mat_rows[idx]


def run_material_reservation_rebuild(
    db: Session,
    *,
    production_order_id: int | None = None,
    job_item_id: int | None = None,
    material_code: str | None = None,
) -> dict[str, Any]:
    stmt = (
        select(MaterialReservation)
        .where(
            MaterialReservation.is_active.is_(True),
            MaterialReservation.status.in_(tuple(MATERIAL_RESERVATION_ACTIVE_STATUSES)),
        )
        .order_by(MaterialReservation.id.asc())
    )
    if production_order_id is not None:
        stmt = stmt.where(MaterialReservation.production_order_id == int(production_order_id))
    if job_item_id is not None:
        stmt = stmt.where(MaterialReservation.job_item_id == int(job_item_id))
    if material_code is not None and str(material_code).strip():
        mid = db.scalar(
            select(MaterialLibraryItem.id).where(MaterialLibraryItem.code == str(material_code).strip())
        )
        if mid is None:
            logger.info(
                "[material_consumption] material_reservation_rebuild | material_code=%s not found — nothing to do",
                material_code,
            )
            return {
                "rows_checked": 0,
                "rows_updated": 0,
                "rows_skipped": 0,
                "rows_unchanged": 0,
                "skip_reasons": {"unknown_material_code": 1},
            }
        stmt = stmt.where(MaterialReservation.material_library_item_id == int(mid))

    reservations = db.scalars(stmt).all()
    rows_checked = len(reservations)
    rows_updated = 0
    rows_unchanged = 0
    rows_skipped = 0
    skip_reasons: dict[str, int] = {}

    def _bump(reason: str) -> None:
        nonlocal rows_skipped
        skip_reasons[reason] = skip_reasons.get(reason, 0) + 1
        rows_skipped += 1

    for res in reservations:
        if str(res.status or "").strip().lower() == "issued":
            _bump("issued")
            continue

        po = db.get(ProductionOrder, int(res.production_order_id))
        if po is None:
            _bump("missing_production_order")
            continue
        if po.portfolio_item_id is None:
            _bump("missing_portfolio_item")
            continue

        template_id = _select_active_template_id(db, int(po.portfolio_item_id))
        if template_id is None:
            _bump("missing_template")
            continue

        tm_row = _resolve_template_row_for_reservation(db, reservation=res, po=po, template_id=template_id)
        if tm_row is None:
            _bump("missing_template_material_row")
            continue

        per_piece = float(tm_row.consumption_per_piece or 0.0)
        kerf = max(float(tm_row.scrap_allowance or 0.0), 0.0)
        qty = int(po.quantity or 0)
        new_required = total_material_consumption(per_piece, kerf, qty)

        avail = _available_qty_excluding_reservation(db, int(res.material_library_item_id), int(res.id))
        new_reserved = min(new_required, avail)
        new_status = "reserved" if new_reserved > 0 else "planned"

        log_material_consumption_debug(
            context="material_reservation_rebuild",
            vp_code=po.vp_code,
            material_library_item_id=int(res.material_library_item_id),
            template_material_id=int(tm_row.id),
            consumption_per_piece=per_piece,
            kerf_per_piece=kerf,
            quantity=float(qty),
            total=new_required,
        )

        old_rq = float(res.required_qty or 0.0)
        old_rs = float(res.reserved_qty or 0.0)
        old_st = str(res.status or "")

        if (
            math.isclose(old_rq, new_required, rel_tol=0, abs_tol=1e-6)
            and math.isclose(old_rs, new_reserved, rel_tol=0, abs_tol=1e-6)
            and old_st == new_status
        ):
            rows_unchanged += 1
            continue

        res.required_qty = new_required
        res.reserved_qty = new_reserved
        res.status = new_status
        rows_updated += 1
        db.flush()

    logger.info(
        "[material_consumption] material_reservation_rebuild | summary rows_checked=%s rows_updated=%s "
        "rows_unchanged=%s rows_skipped=%s skip_reasons=%s",
        rows_checked,
        rows_updated,
        rows_unchanged,
        rows_skipped,
        skip_reasons,
    )

    po_ids = {int(r.production_order_id) for r in reservations}
    from app.services.material_readiness import refresh_material_readiness_for_production_order_ids

    refresh_material_readiness_for_production_order_ids(db, po_ids)

    ceiling = enforce_material_reservation_stock_ceiling(db)

    return {
        "rows_checked": rows_checked,
        "rows_updated": rows_updated,
        "rows_skipped": rows_skipped,
        "rows_unchanged": rows_unchanged,
        "skip_reasons": skip_reasons,
        "stock_ceiling": ceiling,
    }
