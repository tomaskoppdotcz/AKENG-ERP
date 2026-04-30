"""Shared queries for material requirements (by material and by VP)."""

from __future__ import annotations

import logging
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from typing import Any

from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from app.models.material_library import MaterialLibraryItem
from app.models.material_stock import (
    MaterialRemnantStockItem,
    MaterialReservation,
    MaterialStockItem,
    MaterialStockMovement,
)
from app.services.material_issue_allocation_engine import (
    ReceiptUnitSnapshot,
    RemnantStockSnapshot,
    _issue_length_allowed,
    _take_is_residue_valid,
)
from app.services.material_receipt_unit_service import (
    load_fifo_receipt_units_for_material,
    receipt_unit_rows_to_engine_snapshots,
)
from app.models.orders import CustomerOrder, Job, JobItem, ProductionOrder
from app.models.planning import PlanningOperation
from app.services.material_reservation_rebuild import _resolve_template_row_for_reservation, _select_active_template_id
from app.services.business_workflow import workflow_active_sql
from app.services.material_readiness import (
    evaluate_production_order_material_covered,
    evaluate_production_order_material_released,
)
from app.services.material_reservation_sync import (
    MATERIAL_RESERVATION_ACTIVE_STATUSES,
    sum_eligible_reserved_qty_for_material,
)

logger = logging.getLogger(__name__)
_EPS = 1e-6
_ISSUED_MATERIAL_MOVEMENT_TYPES = ("vydej", "vydej_zbytek")
_STARTED_OPERATION_STATUSES = ("bezi", "paused", "hotovo")


def _sort_dt_key(value):
    if value is None:
        return datetime.min
    if value.tzinfo is not None:
        return value.astimezone(timezone.utc).replace(tzinfo=None)
    return value


@dataclass(frozen=True)
class _CutPlanLine:
    cut_length_mm: float
    cut_count: int
    finished_pieces_per_cut: int

    @property
    def total_finished_pieces(self) -> int:
        return int(self.cut_count) * int(self.finished_pieces_per_cut)


def _cutting_required_qty(
    *,
    requested_piece_count: int | float | None,
    delka_na_kus_mm: float | None,
    vyrabeno_po: int | None,
    na_upnuti_mm: float | None,
    prorez_mm: float | None,
) -> float | None:
    """Calculate total cut length using the same batch demand formula as material issue allocation."""
    qty = int(requested_piece_count or 0)
    delka = float(delka_na_kus_mm or 0.0)
    if vyrabeno_po is None:
        return None
    vpo = int(vyrabeno_po)
    upnuti = max(float(na_upnuti_mm or 0.0), 0.0)
    prorez = max(float(prorez_mm or 0.0), 0.0)
    if qty < 0 or delka <= 0 or vpo < 1:
        return None

    full_batches = qty // vpo
    remainder = qty % vpo
    full_cut_length = vpo * delka + upnuti + prorez
    remainder_cut_length = remainder * delka + upnuti + prorez
    return float(full_batches * full_cut_length + (remainder_cut_length if remainder > 0 else 0.0))


def _cutting_cut_plan(
    *,
    requested_piece_count: int | float | None,
    delka_na_kus_mm: float | None,
    vyrabeno_po: int | None,
    na_upnuti_mm: float | None,
    prorez_mm: float | None,
) -> list[_CutPlanLine] | None:
    """Build the required whole-cut plan: full batches first, then one remainder cut."""
    qty = int(requested_piece_count or 0)
    delka = float(delka_na_kus_mm or 0.0)
    if vyrabeno_po is None:
        return None
    vpo = int(vyrabeno_po)
    upnuti = max(float(na_upnuti_mm or 0.0), 0.0)
    prorez = max(float(prorez_mm or 0.0), 0.0)
    if qty < 0 or delka <= 0 or vpo < 1:
        return None

    full_batches = qty // vpo
    remainder = qty % vpo
    out: list[_CutPlanLine] = []
    if full_batches > 0:
        out.append(
            _CutPlanLine(
                cut_length_mm=float(vpo * delka + upnuti + prorez),
                cut_count=int(full_batches),
                finished_pieces_per_cut=int(vpo),
            )
        )
    if remainder > 0:
        out.append(
            _CutPlanLine(
                cut_length_mm=float(remainder * delka + upnuti + prorez),
                cut_count=1,
                finished_pieces_per_cut=int(remainder),
            )
        )
    return out


def _serialize_cut_plan(lines: list[_CutPlanLine]) -> list[dict[str, float | int]]:
    return [
        {
            "cut_length_mm": float(ln.cut_length_mm),
            "cut_count": int(ln.cut_count),
            "finished_pieces_per_cut": int(ln.finished_pieces_per_cut),
            "total_finished_pieces": int(ln.total_finished_pieces),
        }
        for ln in lines
    ]


def _group_cut_plan(lines: list[_CutPlanLine]) -> list[_CutPlanLine]:
    grouped: dict[tuple[float, int], _CutPlanLine] = {}
    for ln in lines:
        key = (round(float(ln.cut_length_mm), 6), int(ln.finished_pieces_per_cut))
        prev = grouped.get(key)
        if prev is None:
            grouped[key] = _CutPlanLine(
                cut_length_mm=key[0],
                cut_count=int(ln.cut_count),
                finished_pieces_per_cut=key[1],
            )
        else:
            grouped[key] = _CutPlanLine(
                cut_length_mm=prev.cut_length_mm,
                cut_count=int(prev.cut_count) + int(ln.cut_count),
                finished_pieces_per_cut=prev.finished_pieces_per_cut,
            )
    return sorted(grouped.values(), key=lambda ln: (-float(ln.cut_length_mm), -int(ln.finished_pieces_per_cut)))


MREQ_PURCHASE_HEAT_LOT = "__material_req_purchase_plan__"


def _flatten_ordered_atomic_cuts(plan: list[_CutPlanLine]) -> list[tuple[float, int]]:
    """TP order: whole polotovar cuts first, then remainder cut."""
    out: list[tuple[float, int]] = []
    for ln in plan:
        for _ in range(int(ln.cut_count)):
            out.append((float(ln.cut_length_mm), int(ln.finished_pieces_per_cut)))
    return out


def _atoms_to_cut_lines(atoms: list[tuple[float, int]]) -> list[_CutPlanLine]:
    piece_lines: list[_CutPlanLine] = []
    for cut_len_mm, pcs in atoms:
        piece_lines.append(_CutPlanLine(cut_length_mm=cut_len_mm, cut_count=1, finished_pieces_per_cut=max(1, int(pcs))))
    return _group_cut_plan(piece_lines)


def _receipt_cut_source(snapshot: ReceiptUnitSnapshot) -> str:
    if getattr(snapshot, "heat_lot", None) == MREQ_PURCHASE_HEAT_LOT:
        return "planned_purchase"
    return "receipt_unit"


def _simulate_sequential_cuts_for_planning(
    remnants: list[RemnantStockSnapshot],
    receipt_units: list[ReceiptUnitSnapshot],
    atomic_cuts: list[tuple[float, int]],
    *,
    minimalni_zbytek_mm: float,
    minimalni_vydavana_mm: float,
) -> tuple[list[tuple[float, int, str]], list[tuple[float, int]]]:
    """
    Place whole cuts sequentially; one receipt/remnant can serve several cuts until remaining falls short.

    Order: remnant stock (shortest-fit first, same slack tie-break as issue), then receipt units FIFO by received_at,id.
    """
    rem_remaining: dict[int, float] = {
        int(r.id): float(r.qty or 0.0) for r in remnants if float(r.qty or 0.0) > _EPS
    }
    ru_remaining: dict[int, float] = {
        int(u.id): float(u.remaining_qty or 0.0) for u in receipt_units if float(u.remaining_qty or 0.0) > _EPS
    }
    rem_ordered = sorted(
        remnants,
        key=lambda r: (
            float(r.qty or 0.0),
            _sort_dt_key(r.received_at),
            _sort_dt_key(r.created_at),
            int(r.id),
        ),
    )
    ru_ordered = sorted(receipt_units, key=lambda u: (_sort_dt_key(u.received_at), int(u.id)))

    covered: list[tuple[float, int, str]] = []
    uncovered: list[tuple[float, int]] = []

    for cut_len, fpc in atomic_cuts:
        cl = float(cut_len)
        if not _issue_length_allowed(cl, minimalni_vydavana_mm):
            uncovered.append((cl, int(fpc)))
            continue

        picked_rem: int | None = None
        best_key_rem: tuple | None = None
        for r in rem_ordered:
            rid = int(r.id)
            avail = float(rem_remaining.get(rid, 0.0))
            if avail + _EPS < cl:
                continue
            if not _take_is_residue_valid(avail, cl, minimalni_zbytek_mm):
                continue
            slack = avail - cl
            key = (slack, _sort_dt_key(r.received_at), _sort_dt_key(r.created_at), rid)
            if best_key_rem is None or key < best_key_rem:
                best_key_rem = key
                picked_rem = rid

        if picked_rem is not None:
            rem_remaining[picked_rem] = max(0.0, float(rem_remaining[picked_rem]) - cl)
            covered.append((cl, int(fpc), "remnant"))
            continue

        placed_ru = False
        for u in ru_ordered:
            uid = int(u.id)
            avail = float(ru_remaining.get(uid, 0.0))
            if avail + _EPS < cl:
                continue
            if not _take_is_residue_valid(avail, cl, minimalni_zbytek_mm):
                continue
            ru_remaining[uid] = max(0.0, avail - cl)
            covered.append((cl, int(fpc), _receipt_cut_source(u)))
            placed_ru = True
            break

        if not placed_ru:
            uncovered.append((cl, int(fpc)))

    return covered, uncovered


def _simulate_sequential_cover_with_synth_stock(
    *,
    base_receipts: list[ReceiptUnitSnapshot],
    remnant_snapshots: list[RemnantStockSnapshot],
    synth_bar_lengths_mm: list[float],
    atomic_cuts: list[tuple[float, int]],
    minimalni_zbytek_mm: float,
    minimalni_vydavana_mm: float,
    synth_anchor: datetime | None,
) -> tuple[list[tuple[float, int, str]], list[tuple[float, int]]]:
    anchor = synth_anchor if synth_anchor is not None else _purchase_anchor_received_at(base_receipts)
    synth_snaps = _extras_to_snapshots(synth_bar_lengths_mm, anchor)
    merged = sorted(
        base_receipts + synth_snaps,
        key=lambda u: (_sort_dt_key(u.received_at), abs(u.id) if u.id < 0 else u.id),
    )
    return _simulate_sequential_cuts_for_planning(
        remnants=remnant_snapshots,
        receipt_units=merged,
        atomic_cuts=list(atomic_cuts),
        minimalni_zbytek_mm=minimalni_zbytek_mm,
        minimalni_vydavana_mm=minimalni_vydavana_mm,
    )


def _build_minimal_purchase_lengths(
    *,
    base_receipt_snapshots: list[ReceiptUnitSnapshot],
    remnant_snapshots: list[RemnantStockSnapshot],
    required_plan_lines: list[_CutPlanLine],
    allocation_params: dict[str, Any],
) -> list[float]:
    ap = allocation_params
    min_z = float(ap["minimalni_zbytek_pouzitelny_mm"])
    min_v = float(ap["minimalni_vydavana_delka_mm"])
    atoms = _flatten_ordered_atomic_cuts(required_plan_lines)
    qty = max(0, int(ap["requested_piece_count"]))
    vpo = max(1, int(ap["vyrabeno_po"]))
    pol = (
        float(ap["delka_na_kus_mm"]) * float(vpo) + float(ap["na_upnuti_mm"]) + float(ap["prorez_mm"])
    )
    rp = qty % vpo
    partial_need = (
        float(rp) * float(ap["delka_na_kus_mm"]) + float(ap["na_upnuti_mm"]) + float(ap["prorez_mm"])
        if rp > 0
        else 0.0
    )
    full_batches = qty // vpo
    anchor = _purchase_anchor_received_at(base_receipt_snapshots)

    _, stock_miss = _simulate_sequential_cuts_for_planning(
        remnants=list(remnant_snapshots),
        receipt_units=list(base_receipt_snapshots),
        atomic_cuts=list(atoms),
        minimalni_zbytek_mm=min_z,
        minimalni_vydavana_mm=min_v,
    )
    extras: list[float] = [float(mm) for mm, _pc in stock_miss]

    def all_covered(extra_lengths: list[float]) -> bool:
        _, mm = _simulate_sequential_cover_with_synth_stock(
            base_receipts=base_receipt_snapshots,
            remnant_snapshots=remnant_snapshots,
            synth_bar_lengths_mm=extra_lengths,
            atomic_cuts=list(atoms),
            minimalni_zbytek_mm=min_z,
            minimalni_vydavana_mm=min_v,
            synth_anchor=anchor,
        )
        return len(mm) == 0

    guard = 0
    while not all_covered(extras) and guard < 96:
        guard += 1
        if full_batches > 0:
            extras.append(float(pol))
        elif rp > 0 and partial_need > _EPS:
            extras.append(float(partial_need))
        else:
            break

    while len(extras) > 0 and all_covered(extras[:-1]):
        extras.pop()

    return extras


def _load_remnant_snapshots(db: Session, material_library_item_id: int) -> list[RemnantStockSnapshot]:
    rows = list(
        db.scalars(
            select(MaterialRemnantStockItem)
            .where(
                MaterialRemnantStockItem.material_library_item_id == int(material_library_item_id),
                MaterialRemnantStockItem.status == "active",
                MaterialRemnantStockItem.qty > 1e-9,
            )
            .order_by(
                MaterialRemnantStockItem.qty.asc(),
                MaterialRemnantStockItem.received_at.asc(),
                MaterialRemnantStockItem.created_at.asc(),
                MaterialRemnantStockItem.id.asc(),
            )
        ).all()
    )
    out: list[RemnantStockSnapshot] = []
    for r in rows:
        out.append(
            RemnantStockSnapshot(
                id=int(r.id),
                qty=float(r.qty or 0.0),
                source_receipt_unit_id=int(r.source_receipt_unit_id),
                source_stock_item_id=int(r.source_stock_item_id),
                received_at=r.received_at,
                created_at=r.created_at,
                heat_lot=r.heat_lot,
                certificate_no=r.certificate_no,
                delivery_note_no=r.delivery_note_no,
            )
        )
    return out


def _purchase_anchor_received_at(base_receipts: list[ReceiptUnitSnapshot]) -> datetime:
    """Synthetic purchase receipts sort after all physically received FIFO units."""
    if not base_receipts:
        return datetime(1970, 1, 1, tzinfo=timezone.utc)
    ts = []
    for u in base_receipts:
        t = u.received_at
        if t.tzinfo is None:
            t = t.replace(tzinfo=timezone.utc)
        ts.append(t)
    mx = max(ts)
    return mx + timedelta(days=366 * 200)


def _extras_to_snapshots(extra_lengths_mm: list[float], anchor_base: datetime) -> list[ReceiptUnitSnapshot]:
    out: list[ReceiptUnitSnapshot] = []
    for i, lng in enumerate(extra_lengths_mm):
        out.append(
            ReceiptUnitSnapshot(
                id=-(i + 1),
                remaining_qty=float(lng),
                received_at=anchor_base + timedelta(microseconds=i + 1),
                heat_lot=MREQ_PURCHASE_HEAT_LOT,
            )
        )
    return out


def _allocation_params_from_cut_dict(cutting_params: dict[str, Any]) -> dict[str, Any]:
    return {
        "requested_piece_count": int(cutting_params.get("requested_piece_count") or 0),
        "delka_na_kus_mm": float(cutting_params.get("delka_na_kus_mm") or 0.0),
        "vyrabeno_po": int(cutting_params.get("vyrabeno_po") or 1),
        "na_upnuti_mm": max(float(cutting_params.get("na_upnuti_mm") or 0.0), 0.0),
        "prorez_mm": max(float(cutting_params.get("prorez_mm") or 0.0), 0.0),
        "povolit_deleni_polotovaru": bool(cutting_params.get("povolit_deleni_polotovaru")),
        "minimalni_zbytek_pouzitelny_mm": float(cutting_params.get("minimalni_zbytek_pouzitelny_mm") or 0.0),
        "minimalni_vydavana_delka_mm": float(cutting_params.get("minimalni_vydavana_delka_mm") or 0.0),
    }


def _shortage_estimate_pooled_mm(
    *,
    requested_piece_count: int | float | None,
    delka_na_kus_mm: float | None,
    vyrabeno_po: int | None,
    na_upnuti_mm: float | None,
    prorez_mm: float | None,
    available_qty_mm: float | None,
) -> dict[str, Any] | None:
    """Legacy pooled-mm estimate (fallback only — does not model issue allocation)."""
    required_plan = _cutting_cut_plan(
        requested_piece_count=requested_piece_count,
        delka_na_kus_mm=delka_na_kus_mm,
        vyrabeno_po=vyrabeno_po,
        na_upnuti_mm=na_upnuti_mm,
        prorez_mm=prorez_mm,
    )
    if required_plan is None:
        return None

    remaining_available = max(float(available_qty_mm or 0.0), 0.0)
    missing: list[_CutPlanLine] = []
    covered_piece_count = 0
    usable_reserved_qty_mm = 0.0
    for plan_line in required_plan:
        missed_count = 0
        for _ in range(int(plan_line.cut_count)):
            if remaining_available + _EPS >= float(plan_line.cut_length_mm):
                remaining_available -= float(plan_line.cut_length_mm)
                covered_piece_count += int(plan_line.finished_pieces_per_cut)
                usable_reserved_qty_mm += float(plan_line.cut_length_mm)
            else:
                missed_count += 1
        if missed_count > 0:
            missing.append(
                _CutPlanLine(
                    cut_length_mm=float(plan_line.cut_length_mm),
                    cut_count=missed_count,
                    finished_pieces_per_cut=int(plan_line.finished_pieces_per_cut),
                )
            )

    purchase_plan = _group_cut_plan(missing)
    purchase_required_qty_mm = sum(float(ln.cut_length_mm) * int(ln.cut_count) for ln in purchase_plan)
    missing_piece_count = sum(int(ln.total_finished_pieces) for ln in purchase_plan)
    required_qty_total_mm = sum(float(ln.cut_length_mm) * int(ln.cut_count) for ln in required_plan)
    available = max(float(available_qty_mm or 0.0), 0.0)
    return {
        "required_qty_total_mm": float(required_qty_total_mm),
        "required_cut_plan": _serialize_cut_plan(required_plan),
        "current_usable_cut_plan": [],
        "available_qty_mm": float(available),
        "raw_available_qty_mm": float(available),
        "usable_reserved_qty_mm": float(usable_reserved_qty_mm),
        "raw_shortage_mm": max(float(required_qty_total_mm) - available, 0.0),
        "unusable_leftover_mm": max(0.0, available - float(usable_reserved_qty_mm)),
        "covered_piece_count": int(covered_piece_count),
        "missing_piece_count": int(missing_piece_count),
        "purchase_required_qty_mm": float(purchase_required_qty_mm),
        "purchase_cut_plan": _serialize_cut_plan(purchase_plan),
        "purchase_feasibility_validated": False,
    }


def _cutting_purchase_feasibility(
    db: Session,
    *,
    material_library_item_id: int,
    cutting_params: dict[str, Any],
    raw_available_qty_mm: float,
    effective_available_qty_mm: float,
) -> dict[str, Any] | None:
    """
    Sequential cutting plan: remnants first (shortest-fit), then receipt FIFO. One bar can absorb several
    whole cuts in order; uncovered cuts drive minimal synthetic receipts until validated.
    """
    required_plan = _cutting_cut_plan(
        requested_piece_count=cutting_params.get("requested_piece_count"),
        delka_na_kus_mm=cutting_params.get("delka_na_kus_mm"),
        vyrabeno_po=cutting_params.get("vyrabeno_po"),
        na_upnuti_mm=cutting_params.get("na_upnuti_mm"),
        prorez_mm=cutting_params.get("prorez_mm"),
    )
    if required_plan is None:
        return None

    ru_rows = load_fifo_receipt_units_for_material(db, int(material_library_item_id))
    base_snapshots = receipt_unit_rows_to_engine_snapshots(ru_rows)
    remn_snap = _load_remnant_snapshots(db, int(material_library_item_id))
    allocation_params = _allocation_params_from_cut_dict(cutting_params)
    required_qty_total_mm = sum(float(ln.cut_length_mm) * int(ln.cut_count) for ln in required_plan)
    raw_avail = max(float(raw_available_qty_mm), 0.0)
    atoms = _flatten_ordered_atomic_cuts(required_plan)
    min_z = float(allocation_params["minimalni_zbytek_pouzitelny_mm"])
    min_v = float(allocation_params["minimalni_vydavana_delka_mm"])

    cov_stock, _ = _simulate_sequential_cuts_for_planning(
        remnants=list(remn_snap),
        receipt_units=list(base_snapshots),
        atomic_cuts=list(atoms),
        minimalni_zbytek_mm=min_z,
        minimalni_vydavana_mm=min_v,
    )

    extras = _build_minimal_purchase_lengths(
        base_receipt_snapshots=base_snapshots,
        remnant_snapshots=remn_snap,
        required_plan_lines=required_plan,
        allocation_params=allocation_params,
    )
    synth_anchor_fin = _purchase_anchor_received_at(base_snapshots)
    cov_fin, miss_fin = _simulate_sequential_cover_with_synth_stock(
        base_receipts=base_snapshots,
        remnant_snapshots=remn_snap,
        synth_bar_lengths_mm=list(extras),
        atomic_cuts=list(atoms),
        minimalni_zbytek_mm=min_z,
        minimalni_vydavana_mm=min_v,
        synth_anchor=synth_anchor_fin,
    )

    if miss_fin:
        logger.warning(
            "[material_requirements] Sequential feasibility synthesis failed mid=%s; falling back to pooled-mm estimate.",
            material_library_item_id,
        )
        pooled = _shortage_estimate_pooled_mm(
            requested_piece_count=cutting_params.get("requested_piece_count"),
            delka_na_kus_mm=cutting_params.get("delka_na_kus_mm"),
            vyrabeno_po=cutting_params.get("vyrabeno_po"),
            na_upnuti_mm=cutting_params.get("na_upnuti_mm"),
            prorez_mm=cutting_params.get("prorez_mm"),
            available_qty_mm=float(effective_available_qty_mm),
        )
        if pooled is None:
            return None
        pooled.setdefault("required_cut_plan", _serialize_cut_plan(required_plan))
        pooled.setdefault("current_usable_cut_plan", [])
        pooled.setdefault("unusable_leftover_mm", float(max(0.0, raw_avail)))
        pooled["purchase_feasibility_validated"] = False
        pooled["available_qty_mm"] = float(effective_available_qty_mm)
        pooled["raw_available_qty_mm"] = float(raw_avail)
        return pooled

    usable_lines = _atoms_to_cut_lines(
        [(float(a), int(b)) for (a, b, src) in cov_stock if src in ("remnant", "receipt_unit")]
    )
    planned_atoms = [(float(a), int(b)) for (a, b, src) in cov_fin if src == "planned_purchase"]
    purchase_lines_grouped = _atoms_to_cut_lines(planned_atoms)
    usable_mm_total = sum(float(a) for (a, _b, src) in cov_stock if src in ("remnant", "receipt_unit"))
    covered_piece_count = sum(int(b) for (a, b, src) in cov_stock if src in ("remnant", "receipt_unit"))
    missing_piece_count = sum(int(b) for (a, b) in planned_atoms)
    purchase_required_qty_mm = sum(float(mm) * 1 for (mm, _pcs) in planned_atoms)

    unusable_mm = max(0.0, raw_avail - float(usable_mm_total))
    return {
        "required_qty_total_mm": float(required_qty_total_mm),
        "required_cut_plan": _serialize_cut_plan(required_plan),
        "current_usable_cut_plan": _serialize_cut_plan(usable_lines),
        "available_qty_mm": float(effective_available_qty_mm),
        "raw_available_qty_mm": float(raw_avail),
        "usable_reserved_qty_mm": float(usable_mm_total),
        "raw_shortage_mm": max(required_qty_total_mm - raw_avail, 0.0),
        "unusable_leftover_mm": float(unusable_mm),
        "covered_piece_count": int(covered_piece_count),
        "missing_piece_count": int(missing_piece_count),
        "purchase_required_qty_mm": float(purchase_required_qty_mm),
        "purchase_cut_plan": _serialize_cut_plan(purchase_lines_grouped),
        "purchase_feasibility_validated": True,
    }


def _cutting_purchase_shortage(
    *,
    requested_piece_count: int | float | None,
    delka_na_kus_mm: float | None,
    vyrabeno_po: int | None,
    na_upnuti_mm: float | None,
    prorez_mm: float | None,
    receipt_unit_snapshots: list[ReceiptUnitSnapshot],
    remnant_snapshots: list[RemnantStockSnapshot],
    cutting_extra_params: dict[str, Any] | None,
    available_qty_mm_fallback: float | None,
) -> dict[str, Any] | None:
    """
    Feasibility-based purchase plan (deterministic engine). Intended for tests and direct calls.
    """
    merged_params: dict[str, Any] = {
        "requested_piece_count": requested_piece_count,
        "delka_na_kus_mm": delka_na_kus_mm,
        "vyrabeno_po": vyrabeno_po,
        "na_upnuti_mm": na_upnuti_mm,
        "prorez_mm": prorez_mm,
        "povolit_deleni_polotovaru": True,
        "minimalni_zbytek_pouzitelny_mm": 0.0,
        "minimalni_vydavana_delka_mm": 0.0,
    }
    if cutting_extra_params:
        merged_params.update(cutting_extra_params)
    ap = _allocation_params_from_cut_dict(merged_params)
    required_plan = _cutting_cut_plan(
        requested_piece_count=merged_params.get("requested_piece_count"),
        delka_na_kus_mm=merged_params.get("delka_na_kus_mm"),
        vyrabeno_po=merged_params.get("vyrabeno_po"),
        na_upnuti_mm=merged_params.get("na_upnuti_mm"),
        prorez_mm=merged_params.get("prorez_mm"),
    )
    if required_plan is None:
        return None

    atoms = _flatten_ordered_atomic_cuts(required_plan)
    min_z = float(ap["minimalni_zbytek_pouzitelny_mm"])
    min_v = float(ap["minimalni_vydavana_delka_mm"])

    cov_stock, _ = _simulate_sequential_cuts_for_planning(
        remnants=list(remnant_snapshots),
        receipt_units=list(receipt_unit_snapshots),
        atomic_cuts=list(atoms),
        minimalni_zbytek_mm=min_z,
        minimalni_vydavana_mm=min_v,
    )
    extras = _build_minimal_purchase_lengths(
        base_receipt_snapshots=list(receipt_unit_snapshots),
        remnant_snapshots=list(remnant_snapshots),
        required_plan_lines=required_plan,
        allocation_params=ap,
    )
    synth_anchor = _purchase_anchor_received_at(list(receipt_unit_snapshots))
    cov_fin, miss_fin = _simulate_sequential_cover_with_synth_stock(
        base_receipts=list(receipt_unit_snapshots),
        remnant_snapshots=list(remnant_snapshots),
        synth_bar_lengths_mm=list(extras),
        atomic_cuts=list(atoms),
        minimalni_zbytek_mm=min_z,
        minimalni_vydavana_mm=min_v,
        synth_anchor=synth_anchor,
    )

    required_qty_total_mm = sum(float(ln.cut_length_mm) * int(ln.cut_count) for ln in required_plan)
    avail_ref = sum(float(u.remaining_qty) for u in receipt_unit_snapshots) + sum(float(r.qty or 0) for r in remnant_snapshots)
    avail_ref = float(available_qty_mm_fallback) if available_qty_mm_fallback is not None else avail_ref

    if miss_fin:
        pooled = _shortage_estimate_pooled_mm(
            requested_piece_count=requested_piece_count,
            delka_na_kus_mm=delka_na_kus_mm,
            vyrabeno_po=vyrabeno_po,
            na_upnuti_mm=na_upnuti_mm,
            prorez_mm=prorez_mm,
            available_qty_mm=available_qty_mm_fallback,
        )
        if pooled is not None:
            pooled.setdefault("required_cut_plan", _serialize_cut_plan(required_plan))
        return pooled

    usable_lines = _atoms_to_cut_lines(
        [(float(a), int(b)) for (a, b, src) in cov_stock if src in ("remnant", "receipt_unit")]
    )
    planned_atoms = [(float(mm), int(pcs)) for (mm, pcs, src) in cov_fin if src == "planned_purchase"]
    purchase_plan = _atoms_to_cut_lines(planned_atoms)
    purchase_required_qty_mm = sum(float(a) * 1.0 for (a, _b) in planned_atoms)
    usable_mm_total = sum(float(mm) for (mm, _b, src) in cov_stock if src in ("remnant", "receipt_unit"))
    covered_piece_count = sum(int(pcs) for (_mm, pcs, src) in cov_stock if src in ("remnant", "receipt_unit"))
    missing_piece_count = sum(int(pcs) for (_mm, pcs) in planned_atoms)
    unusable_mm = max(0.0, avail_ref - float(usable_mm_total))
    return {
        "required_qty_total_mm": float(required_qty_total_mm),
        "required_cut_plan": _serialize_cut_plan(required_plan),
        "current_usable_cut_plan": _serialize_cut_plan(usable_lines),
        "available_qty_mm": float(avail_ref),
        "raw_available_qty_mm": float(avail_ref),
        "usable_reserved_qty_mm": float(usable_mm_total),
        "raw_shortage_mm": max(float(required_qty_total_mm) - avail_ref, 0.0),
        "unusable_leftover_mm": float(unusable_mm),
        "covered_piece_count": int(covered_piece_count),
        "missing_piece_count": int(missing_piece_count),
        "purchase_required_qty_mm": float(purchase_required_qty_mm),
        "purchase_cut_plan": _serialize_cut_plan(purchase_plan),
        "purchase_feasibility_validated": True,
    }


def _cutting_required_qty_for_reservation(
    db: Session,
    *,
    reservation: MaterialReservation,
    production_order: ProductionOrder,
) -> float | None:
    if production_order.portfolio_item_id is None:
        return None
    template_id = _select_active_template_id(db, int(production_order.portfolio_item_id))
    if template_id is None:
        return None
    tm_row = _resolve_template_row_for_reservation(
        db,
        reservation=reservation,
        po=production_order,
        template_id=int(template_id),
    )
    if tm_row is None:
        return None
    return _cutting_required_qty(
        requested_piece_count=int(production_order.quantity or 0),
        delka_na_kus_mm=float(tm_row.consumption_per_piece or 0.0),
        vyrabeno_po=tm_row.vyrabet_max_po_ks,
        na_upnuti_mm=float(tm_row.na_upnuti_mm or 0.0),
        prorez_mm=float(tm_row.scrap_allowance or 0.0),
    )


def _dummy_receipt_snapshot_for_tests(remaining_mm: float, *, unit_id: int = 1) -> ReceiptUnitSnapshot:
    return ReceiptUnitSnapshot(
        id=int(unit_id),
        remaining_qty=float(remaining_mm),
        received_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
        heat_lot=None,
        certificate_no=None,
        delivery_note_no=None,
    )


def _issue_allocation_params_for_reservation(
    db: Session,
    *,
    reservation: MaterialReservation,
    production_order: ProductionOrder,
) -> dict[str, Any] | None:
    """Expose TP cutting inputs so the frontend can preview backend allocation."""
    if production_order.portfolio_item_id is None:
        return None
    template_id = _select_active_template_id(db, int(production_order.portfolio_item_id))
    if template_id is None:
        return None
    tm_row = _resolve_template_row_for_reservation(
        db,
        reservation=reservation,
        po=production_order,
        template_id=int(template_id),
    )
    if tm_row is None:
        return None
    delka_na_kus = float(tm_row.consumption_per_piece or 0.0)
    vyrabeno_po = tm_row.vyrabet_max_po_ks
    if delka_na_kus <= 0 or vyrabeno_po is None or int(vyrabeno_po) < 1:
        return None
    return {
        "requested_piece_count": int(production_order.quantity or 0),
        "delka_na_kus_mm": delka_na_kus,
        "vyrabeno_po": int(vyrabeno_po),
        "na_upnuti_mm": max(float(tm_row.na_upnuti_mm or 0.0), 0.0),
        "prorez_mm": max(float(tm_row.scrap_allowance or 0.0), 0.0),
        "povolit_deleni_polotovaru": bool(tm_row.povolit_deleni_polotovaru),
        "minimalni_zbytek_pouzitelny_mm": 0.0,
        "minimalni_vydavana_delka_mm": 0.0,
    }


def _requirement_purchase_fields(
    db: Session,
    *,
    material_library_item_id: int,
    required_qty: float,
    effective_available_mm: float,
    raw_stock_mm: float,
    cutting_params: dict[str, Any] | None,
    material_unit: str | None = None,
) -> dict[str, Any]:
    raw_shortage = max(float(required_qty or 0.0) - max(float(effective_available_mm or 0.0), 0.0), 0.0)
    unit = (material_unit or "").strip().lower()
    if cutting_params is not None and unit == "mm":
        cutting = _cutting_purchase_feasibility(
            db,
            material_library_item_id=int(material_library_item_id),
            cutting_params=cutting_params,
            raw_available_qty_mm=float(raw_stock_mm),
            effective_available_qty_mm=float(effective_available_mm),
        )
        if cutting is not None:
            return cutting
    raw_lim = max(float(raw_stock_mm or 0.0), 0.0)
    eff_lim = max(float(effective_available_mm or 0.0), 0.0)
    return {
        "required_qty_total_mm": float(required_qty or 0.0),
        "required_cut_plan": [],
        "current_usable_cut_plan": [],
        "available_qty_mm": eff_lim,
        "raw_available_qty_mm": raw_lim,
        "usable_reserved_qty_mm": min(float(required_qty or 0.0), eff_lim),
        "raw_shortage_mm": raw_shortage,
        "unusable_leftover_mm": max(0.0, raw_lim - min(float(required_qty or 0.0), eff_lim)),
        "covered_piece_count": None,
        "missing_piece_count": None,
        "purchase_required_qty_mm": raw_shortage,
        "purchase_cut_plan": [],
        "purchase_feasibility_validated": None,
    }


def _free_unreserved_material_qty(db: Session, material_library_item_id: int) -> float:
    """Fyzický stav minus eligible rezervace — shodně jako orders._available_material_qty."""
    on_stock = db.scalar(
        select(func.coalesce(func.sum(MaterialStockItem.current_qty), 0.0)).where(
            MaterialStockItem.material_library_item_id == int(material_library_item_id)
        )
    )
    reserved = sum_eligible_reserved_qty_for_material(db, int(material_library_item_id))
    return max(float(on_stock or 0.0) - reserved, 0.0)


def _production_order_needs_material_condition():
    has_issued_material = (
        select(1)
        .select_from(MaterialStockMovement)
        .where(
            MaterialStockMovement.production_order_id == ProductionOrder.id,
            MaterialStockMovement.movement_type.in_(_ISSUED_MATERIAL_MOVEMENT_TYPES),
        )
        .exists()
    )
    has_started_operation = (
        select(1)
        .select_from(PlanningOperation)
        .where(
            func.lower(func.trim(PlanningOperation.work_order_no)) == func.lower(func.trim(ProductionOrder.vp_code)),
            or_(
                PlanningOperation.actual_start.isnot(None),
                PlanningOperation.status.in_(_STARTED_OPERATION_STATUSES),
            ),
        )
        .exists()
    )
    return ~or_(has_issued_material, has_started_operation)


def _material_requirements_bundle(db: Session) -> dict[str, Any] | None:
    """
    Returns intermediate structures for both list endpoints, or None if no active requirements.
    """
    mr = MaterialReservation
    base_sq = (
        select(
            mr.id.label("rid"),
            mr.material_library_item_id.label("mid"),
            mr.production_order_id.label("poid"),
            mr.job_item_id.label("jiid"),
            func.max(mr.required_qty).label("rq"),
            func.max(mr.reserved_qty).label("rs"),
        )
        .select_from(mr)
        .join(ProductionOrder, ProductionOrder.id == mr.production_order_id)
        .join(
            JobItem,
            and_(
                JobItem.id == mr.job_item_id,
                JobItem.id == ProductionOrder.job_item_id,
            ),
        )
        .join(Job, Job.id == JobItem.job_id)
        .join(MaterialLibraryItem, MaterialLibraryItem.id == mr.material_library_item_id)
        .outerjoin(CustomerOrder, CustomerOrder.id == Job.customer_order_id)
        .where(
            mr.status.in_(tuple(MATERIAL_RESERVATION_ACTIVE_STATUSES)),
            mr.is_active.is_(True),
            workflow_active_sql(ProductionOrder.workflow_status),
            workflow_active_sql(JobItem.workflow_status),
            _production_order_needs_material_condition(),
            or_(
                Job.customer_order_id.is_(None),
                and_(CustomerOrder.id.isnot(None), workflow_active_sql(CustomerOrder.workflow_status)),
            ),
        )
        .group_by(mr.id, mr.material_library_item_id, mr.production_order_id, mr.job_item_id)
    ).subquery()

    seed_agg_rows = db.execute(
        select(
            base_sq.c.mid.label("material_library_item_id"),
            func.coalesce(func.sum(base_sq.c.rq), 0.0).label("required_qty"),
            func.coalesce(func.sum(base_sq.c.rs), 0.0).label("reserved_qty"),
        )
        .group_by(base_sq.c.mid)
        .order_by(base_sq.c.mid.asc())
    ).all()
    if not seed_agg_rows:
        return None

    mat_ids = [int(r.material_library_item_id) for r in seed_agg_rows]
    mats = db.scalars(select(MaterialLibraryItem).where(MaterialLibraryItem.id.in_(mat_ids))).all()
    mat_by_id = {int(m.id): m for m in mats}

    stock_rows = db.execute(
        select(
            MaterialStockItem.material_library_item_id,
            func.coalesce(func.sum(MaterialStockItem.current_qty), 0.0),
        )
        .where(MaterialStockItem.material_library_item_id.in_(mat_ids))
        .group_by(MaterialStockItem.material_library_item_id)
    ).all()
    available_by_material = {int(mid): float(q or 0.0) for mid, q in stock_rows}

    detail_rows_raw = db.execute(
        select(mr, ProductionOrder, JobItem, Job)
        .select_from(mr)
        .join(ProductionOrder, ProductionOrder.id == mr.production_order_id)
        .join(
            JobItem,
            and_(
                JobItem.id == mr.job_item_id,
                JobItem.id == ProductionOrder.job_item_id,
            ),
        )
        .join(Job, Job.id == JobItem.job_id)
        .join(MaterialLibraryItem, MaterialLibraryItem.id == mr.material_library_item_id)
        .outerjoin(CustomerOrder, CustomerOrder.id == Job.customer_order_id)
        .where(
            mr.material_library_item_id.in_(mat_ids),
            mr.status.in_(tuple(MATERIAL_RESERVATION_ACTIVE_STATUSES)),
            mr.is_active.is_(True),
            workflow_active_sql(ProductionOrder.workflow_status),
            workflow_active_sql(JobItem.workflow_status),
            _production_order_needs_material_condition(),
            or_(
                Job.customer_order_id.is_(None),
                and_(CustomerOrder.id.isnot(None), workflow_active_sql(CustomerOrder.workflow_status)),
            ),
        )
        .order_by(mr.material_library_item_id.asc(), ProductionOrder.id.asc(), mr.id.asc())
    ).all()

    seen_rid: set[int] = set()
    detail_rows: list = []
    for row in detail_rows_raw:
        rr = row[0]
        if int(rr.id) in seen_rid:
            continue
        seen_rid.add(int(rr.id))
        detail_rows.append(row)

    included_ids: set[int] = set()
    for dbg in db.execute(
        select(
            base_sq.c.rid,
            base_sq.c.mid,
            base_sq.c.poid,
            base_sq.c.jiid,
            base_sq.c.rq,
            MaterialLibraryItem.code,
        )
        .select_from(base_sq)
        .join(MaterialLibraryItem, MaterialLibraryItem.id == base_sq.c.mid)
    ).all():
        included_ids.add(int(dbg.rid))
        logger.info(
            "[material_requirements] included reservation_id=%s material_id=%s material_code=%s "
            "production_order_id=%s job_item_id=%s required_qty=%s",
            int(dbg.rid),
            int(dbg.mid),
            dbg.code,
            int(dbg.poid),
            int(dbg.jiid),
            float(dbg.rq or 0.0),
        )

    stale = db.scalars(
        select(mr).where(
            mr.is_active.is_(True),
            mr.status.in_(tuple(MATERIAL_RESERVATION_ACTIVE_STATUSES)),
        )
    ).all()
    for s in stale:
        if int(s.id) in included_ids:
            continue
        logger.info(
            "[material_requirements] excluded reservation_id=%s material_library_item_id=%s "
            "production_order_id=%s job_item_id=%s required_qty=%s (active but failed validity join)",
            int(s.id),
            int(s.material_library_item_id),
            int(s.production_order_id),
            int(s.job_item_id),
            float(s.required_qty or 0.0),
        )

    co_ids = sorted(
        {int(job.customer_order_id) for *_, job in detail_rows if job.customer_order_id is not None}
    )
    co_by_id: dict[int, CustomerOrder] = {}
    if co_ids:
        cos = db.scalars(select(CustomerOrder).where(CustomerOrder.id.in_(co_ids))).all()
        co_by_id = {int(o.id): o for o in cos}

    merged: dict[tuple[int, int], dict] = {}
    for rr, po, ji, job in detail_rows:
        mid = int(rr.material_library_item_id)
        pid = int(po.id)
        key = (mid, pid)
        co = co_by_id.get(int(job.customer_order_id)) if job.customer_order_id is not None else None
        if key not in merged:
            merged[key] = {
                "production_order_id": pid,
                "vp_code": po.vp_code,
                "job_item_id": int(po.job_item_id) if po.job_item_id is not None else None,
                "customer_order_id": int(co.id) if co is not None else None,
                "zakazka": job.zak_code,
                "gpn": ji.gpn if ji is not None else po.gpn,
                "_lines": [],
            }
        computed_required = _cutting_required_qty_for_reservation(
            db,
            reservation=rr,
            production_order=po,
        )
        line_required = float(computed_required if computed_required is not None else rr.required_qty or 0.0)
        stored_required = float(rr.required_qty or 0.0)
        stored_reserved = float(rr.reserved_qty or 0.0)
        if stored_required > 0 and stored_reserved + 1e-9 >= stored_required:
            line_reserved = line_required
        else:
            line_reserved = min(stored_reserved, line_required)
        issue_allocation_params = _issue_allocation_params_for_reservation(
            db,
            reservation=rr,
            production_order=po,
        )
        merged[key]["_lines"].append(
            {
                "reservation_id": int(rr.id),
                "required_qty": line_required,
                "reserved_qty": line_reserved,
                "status": rr.status,
                "issue_allocation_params": issue_allocation_params,
            }
        )

    totals_by_material: dict[int, dict[str, float]] = defaultdict(
        lambda: {"required_qty": 0.0, "reserved_qty": 0.0}
    )
    for (mid, _pid), payload in merged.items():
        for line in payload["_lines"]:
            totals_by_material[mid]["required_qty"] += float(line["required_qty"] or 0.0)
            totals_by_material[mid]["reserved_qty"] += float(line["reserved_qty"] or 0.0)
    agg_rows = [
        SimpleNamespace(
            material_library_item_id=mid,
            required_qty=totals["required_qty"],
            reserved_qty=totals["reserved_qty"],
        )
        for mid, totals in sorted(totals_by_material.items())
    ]

    return {
        "agg_rows": agg_rows,
        "mat_by_id": mat_by_id,
        "available_by_material": available_by_material,
        "merged": merged,
        "detail_rows": detail_rows,
        "co_by_id": co_by_id,
    }


def _merged_to_related_by_material(merged: dict[tuple[int, int], dict]) -> dict[int, list[dict]]:
    related_by_material: dict[int, list[dict]] = defaultdict(list)
    for (mid, _pid), payload in sorted(merged.items(), key=lambda kv: (kv[0][0], kv[1].get("vp_code") or "")):
        lines = sorted(payload["_lines"], key=lambda ln: int(ln["reservation_id"]))
        req_sum = sum(float(ln["required_qty"]) for ln in lines)
        res_sum = sum(float(ln["reserved_qty"]) for ln in lines)
        ids = [int(ln["reservation_id"]) for ln in lines]
        st = lines[0]["status"]
        row_out = {k: v for k, v in payload.items() if k != "_lines"}
        row_out["required_qty"] = req_sum
        row_out["reserved_qty"] = res_sum
        row_out["reservation_id"] = ids[0]
        row_out["reservation_ids"] = ids
        row_out["reservation_count"] = len(lines)
        row_out["reservation_lines"] = lines
        row_out["status"] = st
        related_by_material[mid].append(row_out)
    return related_by_material


def _cutting_params_for_lines(lines: list[dict]) -> dict[str, Any] | None:
    params = [ln.get("issue_allocation_params") for ln in lines if ln.get("issue_allocation_params")]
    if len(params) != 1:
        return None
    return params[0]


def build_standard_material_requirements(db: Session) -> list[dict]:
    b = _material_requirements_bundle(db)
    if b is None:
        return []
    agg_rows = b["agg_rows"]
    mat_by_id = b["mat_by_id"]
    available_by_material = b["available_by_material"]
    merged = b["merged"]
    related_by_material = _merged_to_related_by_material(merged)

    out: list[dict] = []
    for row in agg_rows:
        material_id = int(row.material_library_item_id)
        required = float(row.required_qty or 0.0)
        reserved_sum = float(row.reserved_qty or 0.0)
        physical = float(available_by_material.get(material_id, 0.0))
        free = _free_unreserved_material_qty(db, material_id)
        net_gap = max(required - reserved_sum, 0.0)
        effective_available = reserved_sum + free
        raw_shortage = max(net_gap - free, 0.0)
        material = mat_by_id.get(material_id)
        related_orders = related_by_material.get(material_id, [])
        purchase_fields = _requirement_purchase_fields(
            db,
            material_library_item_id=material_id,
            required_qty=required,
            effective_available_mm=effective_available,
            raw_stock_mm=physical,
            cutting_params=_cutting_params_for_lines(
                [
                    ln
                    for rel in related_orders
                    for ln in rel.get("reservation_lines", [])
                    if ln.get("status") != "issued"
                ]
            ),
            material_unit=material.unit if material else None,
        )
        if not purchase_fields.get("purchase_cut_plan"):
            purchase_fields["raw_shortage_mm"] = raw_shortage
            purchase_fields["purchase_required_qty_mm"] = raw_shortage
        out.append(
            {
                "material_library_item_id": material_id,
                "material": {
                    "code": material.code if material else None,
                    "name": material.name if material else None,
                },
                "required": required,
                "reserved": reserved_sum,
                "available": physical,
                "free_for_allocation": free,
                "shortage": float(purchase_fields["purchase_required_qty_mm"]),
                **purchase_fields,
                "related_orders": related_orders,
            }
        )
    return out


def build_vp_material_requirements(db: Session) -> list[dict]:
    b = _material_requirements_bundle(db)
    if b is None:
        return []
    agg_rows = b["agg_rows"]
    mat_by_id = b["mat_by_id"]
    available_by_material = b["available_by_material"]
    merged = b["merged"]
    detail_rows = b["detail_rows"]
    co_by_id = b["co_by_id"]

    po_header: dict[int, dict] = {}
    for _rr, po, ji, job in detail_rows:
        pid = int(po.id)
        if pid in po_header:
            continue
        co = co_by_id.get(int(job.customer_order_id)) if job.customer_order_id is not None else None
        po_header[pid] = {
            "production_order_id": pid,
            "vp_code": po.vp_code,
            "zakazka": job.zak_code,
            "customer_order_id": int(co.id) if co is not None else None,
            "order_type": str(getattr(co, "order_type", "customer") or "customer") if co is not None else None,
            "gpn": ji.gpn if ji is not None else po.gpn,
            "due_date": ji.due_date.isoformat() if ji is not None and ji.due_date is not None else None,
            "job_item_id": int(ji.id) if ji is not None else None,
            "is_material_covered": bool(evaluate_production_order_material_covered(db, po)),
            "is_material_released_to_production": bool(evaluate_production_order_material_released(db, po)),
            "is_material_ready": bool(evaluate_production_order_material_released(db, po)),
        }

    by_vp: dict[int, list[dict]] = defaultdict(list)
    for (mid, pid), payload in sorted(merged.items(), key=lambda kv: (kv[0][1], kv[0][0])):
        lines = sorted(payload["_lines"], key=lambda ln: int(ln["reservation_id"]))
        req_sum = sum(float(ln["required_qty"]) for ln in lines)
        res_sum = sum(float(ln["reserved_qty"]) for ln in lines)
        ids = [int(ln["reservation_id"]) for ln in lines]
        st = lines[0]["status"]
        mat = mat_by_id.get(mid)
        avail = float(available_by_material.get(mid, 0.0))
        free = _free_unreserved_material_qty(db, mid)
        line_gap = max(float(req_sum) - float(res_sum), 0.0)
        effective_available = float(res_sum) + free
        raw_shortage = max(line_gap - free, 0.0)
        purchase_fields = _requirement_purchase_fields(
            db,
            material_library_item_id=mid,
            required_qty=req_sum,
            effective_available_mm=effective_available,
            raw_stock_mm=avail,
            cutting_params=_cutting_params_for_lines([ln for ln in lines if ln.get("status") != "issued"]),
            material_unit=mat.unit if mat else None,
        )
        if not purchase_fields.get("purchase_cut_plan"):
            purchase_fields["raw_shortage_mm"] = raw_shortage
            purchase_fields["purchase_required_qty_mm"] = raw_shortage
        shortage = float(purchase_fields["purchase_required_qty_mm"])
        by_vp[pid].append(
            {
                "material_library_item_id": mid,
                "material": {
                    "code": mat.code if mat else None,
                    "name": mat.name if mat else None,
                    "dimension": mat.dimension if mat else None,
                    "unit": mat.unit if mat else None,
                },
                "required_qty": req_sum,
                "reserved_qty": res_sum,
                "available": avail,
                "free_for_allocation": free,
                "shortage": shortage,
                **purchase_fields,
                "status": st,
                "reservation_id": ids[0],
                "reservation_ids": ids,
                "reservation_count": len(lines),
                "reservation_lines": lines,
                "production_order_id": pid,
                "vp_code": payload.get("vp_code"),
                "zakazka": payload.get("zakazka"),
                "customer_order_id": payload.get("customer_order_id"),
                "gpn": payload.get("gpn"),
            }
        )

    out: list[dict] = []
    for pid in sorted(by_vp.keys()):
        materials = by_vp[pid]
        header = po_header.get(pid, {})
        covered = True
        if materials:
            for m in materials:
                if float(m.get("purchase_required_qty_mm") or m.get("shortage") or 0.0) > 1e-9:
                    covered = False
                    break

        out.append(
            {
                **header,
                "coverage": "covered" if (not materials or covered) else "uncovered",
                "materials": materials,
            }
        )

    def _sort_key(row: dict) -> tuple:
        d = row.get("due_date") or "9999-12-31"
        return (d, row.get("vp_code") or "")

    out.sort(key=_sort_key)
    return out
