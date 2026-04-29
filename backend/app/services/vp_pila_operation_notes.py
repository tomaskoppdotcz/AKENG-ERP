"""
Populate production_order_operations.note for VP Rezani/Pila (FIFO cutting text).
Invoked when VP operations are created or rebuilt. No stock writes.
"""

from __future__ import annotations

import logging
import unicodedata

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.models.material_library import MaterialLibraryItem
from app.models.material_stock import MaterialStockMovement
from app.models.orders import JobItem, ProductionOrder, ProductionOrderOperation
from app.models.portfolio import (
    PortfolioTechnologyTemplate,
    PortfolioTechnologyTemplateMaterial,
)
from app.services.cutting_instructions_service import (
    CuttingInstructionLine,
    CuttingInstructionsResult,
    build_cutting_instructions_for_pila,
    _render_cutting_text,
)
from app.services.material_issue_proposal import propose_material_issue_source
from app.services.material_receipt_unit_service import (
    load_fifo_receipt_units,
    receipt_unit_rows_to_engine_snapshots,
)

logger = logging.getLogger(__name__)
_EPS = 1e-6


def is_pila_operation_name(operation_name: str | None) -> bool:
    normalized = unicodedata.normalize("NFKD", operation_name or "")
    plain = "".join(ch for ch in normalized if not unicodedata.combining(ch)).lower()
    return "rezani" in plain or "pila" in plain


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


def _job_item_portfolio_item_id(db: Session, job_item_id: int | None) -> int | None:
    if job_item_id is None:
        return None
    cols = {r[1] for r in db.execute(text("PRAGMA table_info(job_items)")).fetchall()}
    if "portfolio_item_id" not in cols:
        return None
    row = db.execute(
        text("SELECT portfolio_item_id FROM job_items WHERE id = :id"),
        {"id": int(job_item_id)},
    ).fetchone()
    if row is None or row[0] is None:
        return None
    return int(row[0])


def _log_skip(po: ProductionOrder, reason: str) -> None:
    logger.info(
        "[vp_pila_notes] skipped po_id=%s reason=%s",
        getattr(po, "id", None),
        reason,
    )


def _planning_qty_for_vp(po: ProductionOrder, job_item: JobItem | None) -> int:
    q = int(po.quantity or 0)
    if q <= 0 and job_item is not None:
        q = int(job_item.qty or 0)
    return max(q, 0)


def _material_label(db: Session, material_library_item_id: int) -> str | None:
    mlib = db.get(MaterialLibraryItem, int(material_library_item_id))
    if mlib is None:
        return None
    code = (mlib.code or "").strip()
    name = (mlib.name or "").strip()
    if code and name:
        return f"{code} - {name}"
    if name:
        return name
    if code:
        return code
    return None


def _issued_movements_for_vp(
    db: Session,
    *,
    po: ProductionOrder,
    job_item: JobItem | None,
) -> list[MaterialStockMovement]:
    if po.id is not None:
        po_rows = db.scalars(
            select(MaterialStockMovement)
            .where(
                MaterialStockMovement.movement_type.in_(("vydej", "vydej_zbytek")),
                MaterialStockMovement.production_order_id == int(po.id),
            )
            .order_by(MaterialStockMovement.movement_date.asc(), MaterialStockMovement.id.asc())
        ).all()
        if po_rows:
            return po_rows

    job_item_id = po.job_item_id if po.job_item_id is not None else getattr(job_item, "id", None)
    if job_item_id is None:
        return []
    return db.scalars(
        select(MaterialStockMovement)
        .where(
            MaterialStockMovement.movement_type.in_(("vydej", "vydej_zbytek")),
            MaterialStockMovement.job_item_id == int(job_item_id),
        )
        .order_by(MaterialStockMovement.movement_date.asc(), MaterialStockMovement.id.asc())
    ).all()


def _infer_cut_from_issued_qty(
    *,
    issued_qty: float,
    planned_piece_count: int,
    delka_na_kus_mm: float,
    vyrabeno_po: int,
    na_upnuti_mm: float,
    prorez_mm: float,
) -> tuple[float, int]:
    qty = float(issued_qty)
    full_cut_length = (
        float(vyrabeno_po) * float(delka_na_kus_mm)
        + float(na_upnuti_mm)
        + float(prorez_mm)
    )
    if full_cut_length > 0:
        full_count = qty / full_cut_length
        rounded_full_count = int(round(full_count))
        if rounded_full_count > 0 and abs(full_count - rounded_full_count) <= _EPS:
            return round(full_cut_length, 6), rounded_full_count

    remainder_pieces = int(planned_piece_count) % int(vyrabeno_po)
    if remainder_pieces > 0:
        remainder_cut_length = (
            float(remainder_pieces) * float(delka_na_kus_mm)
            + float(na_upnuti_mm)
            + float(prorez_mm)
        )
        if abs(qty - remainder_cut_length) <= _EPS:
            return round(remainder_cut_length, 6), 1

    return round(qty, 6), 1


def _build_cutting_instructions_from_issued_movements(
    *,
    movements: list[MaterialStockMovement],
    planned_piece_count: int,
    delka_na_kus_mm: float,
    vyrabeno_po: int,
    na_upnuti_mm: float,
    prorez_mm: float,
    material_label: str | None,
) -> CuttingInstructionsResult:
    grouped: dict[tuple[str | None, float], CuttingInstructionLine] = {}
    for movement in movements:
        cut_length, cut_count = _infer_cut_from_issued_qty(
            issued_qty=float(movement.qty or 0.0),
            planned_piece_count=int(planned_piece_count),
            delka_na_kus_mm=float(delka_na_kus_mm),
            vyrabeno_po=int(vyrabeno_po),
            na_upnuti_mm=float(na_upnuti_mm),
            prorez_mm=float(prorez_mm),
        )
        if cut_count <= 0:
            continue

        heat_lot = movement.heat_lot
        key = (heat_lot, cut_length)
        prev = grouped.get(key)
        if prev is None:
            grouped[key] = CuttingInstructionLine(
                heat_lot=heat_lot,
                certificate_no=movement.certificate_no,
                delivery_note_no=movement.delivery_note_no,
                length_mm=cut_length,
                count=cut_count,
            )
        else:
            grouped[key] = CuttingInstructionLine(
                heat_lot=prev.heat_lot,
                certificate_no=prev.certificate_no,
                delivery_note_no=prev.delivery_note_no,
                length_mm=prev.length_mm,
                count=prev.count + cut_count,
            )

    grouped_lines = sorted(
        grouped.values(),
        key=lambda ln: ((ln.heat_lot or "~"), -ln.length_mm),
    )
    text_value = _render_cutting_text(grouped_lines, material_label=material_label) if grouped_lines else ""
    return CuttingInstructionsResult(ok=bool(grouped_lines), text=text_value, lines=grouped_lines)


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
        _log_skip(po, "missing_job_item")
        return

    pid = int(po.portfolio_item_id) if po.portfolio_item_id is not None else None
    if pid is None:
        pid = _job_item_portfolio_item_id(db, int(po.job_item_id) if po.job_item_id is not None else None)
    if pid is None:
        _log_skip(po, "missing_portfolio_item")
        _clear_pila_notes(db, po)
        return

    tpl = _select_active_portfolio_tp_local(db, int(pid))
    if tpl is None:
        _log_skip(po, "missing_tp_template")
        _clear_pila_notes(db, po)
        return

    mat_row = _select_first_tp_material_for_cutting(db, int(tpl.id))
    if mat_row is None or mat_row.material_library_item_id is None:
        _log_skip(po, "missing_tp_material")
        _clear_pila_notes(db, po)
        return

    mid = int(mat_row.material_library_item_id)
    delka = float(mat_row.consumption_per_piece or 0.0)
    if delka <= 0:
        _log_skip(po, "missing_tp_material_length")
        _clear_pila_notes(db, po)
        return

    vraw = mat_row.vyrabet_max_po_ks
    if vraw is None or int(vraw) < 1:
        _log_skip(po, "missing_tp_material_vyrabet_max_po_ks")
        _clear_pila_notes(db, po)
        return
    vyrabeno_po = int(vraw)

    prorez = max(float(mat_row.scrap_allowance or 0.0), 0.0)
    upnuti = max(float(mat_row.na_upnuti_mm or 0.0), 0.0)
    povolit = bool(mat_row.povolit_deleni_polotovaru)

    qty = _planning_qty_for_vp(po, ji)
    if qty <= 0:
        _log_skip(po, "missing_planning_qty")
        _clear_pila_notes(db, po)
        return

    mat_label = _material_label(db, int(mid))
    issued_movements = _issued_movements_for_vp(db, po=po, job_item=ji)
    if issued_movements:
        logger.info(
            "[vp_pila_notes] source=issued_movements po_id=%s movements=%s",
            getattr(po, "id", None),
            len(issued_movements),
        )
        res = _build_cutting_instructions_from_issued_movements(
            movements=issued_movements,
            planned_piece_count=int(qty),
            delka_na_kus_mm=float(delka),
            vyrabeno_po=int(vyrabeno_po),
            na_upnuti_mm=float(upnuti),
            prorez_mm=float(prorez),
            material_label=mat_label,
        )
        _store_pila_note_result(db, po, res)
        return

    logger.info(
        "[vp_pila_notes] source=allocation_preview po_id=%s",
        getattr(po, "id", None),
    )
    demand_for_pick = max(float(qty) * delka, 1.0)
    proposal = propose_material_issue_source(
        db, mid, demand_for_pick, exclude_job_item_id=int(po.job_item_id) if po.job_item_id else None
    )
    if proposal is None:
        _log_skip(po, "missing_stock_item")
        _clear_pila_notes(db, po)
        return
    stock_item_id = int(proposal["stock_item_id"])
    raw_units = load_fifo_receipt_units(db, stock_item_id)
    snapshots = receipt_unit_rows_to_engine_snapshots(raw_units)
    if not snapshots:
        _log_skip(po, "missing_receipt_units")
        _clear_pila_notes(db, po)
        return

    res = build_cutting_instructions_for_pila(
        requested_piece_count=int(qty),
        delka_na_kus_mm=float(delka),
        vyrabeno_po=int(vyrabeno_po),
        na_upnuti_mm=float(upnuti),
        prorez_mm=float(prorez),
        povolit_deleni_polotovaru=bool(povolit),
        receipt_units=snapshots,
        material_label=mat_label,
    )

    _store_pila_note_result(db, po, res)


def _store_pila_note_result(
    db: Session,
    po: ProductionOrder,
    res: CuttingInstructionsResult,
) -> None:
    pila_rows = db.scalars(
        select(ProductionOrderOperation).where(ProductionOrderOperation.production_order_id == int(po.id))
    ).all()
    matched = False
    for row in pila_rows:
        if not is_pila_operation_name(row.operation_name):
            continue
        matched = True
        if res.ok and (res.text or "").strip():
            row.note = res.text
        else:
            row.note = None
    if not matched:
        _log_skip(po, "missing_operation_match")


def _clear_pila_notes(db: Session, po: ProductionOrder) -> None:
    rows = db.scalars(
        select(ProductionOrderOperation).where(ProductionOrderOperation.production_order_id == int(po.id))
    ).all()
    for row in rows:
        if is_pila_operation_name(row.operation_name):
            row.note = None
