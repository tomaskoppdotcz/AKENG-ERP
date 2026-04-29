"""
Pure helper for saw-cutting instructions ("Rezani / Pila").

This module intentionally reuses the material allocation engine output so that
cutting instructions follow exactly the same segmentation logic.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from app.services.material_issue_allocation_engine import (
    AllocationErrorCode,
    AllocationResult,
    ReceiptUnitSnapshot,
    allocate_material_issue_by_receipt_units,
)

_EPS = 1e-6


@dataclass(frozen=True)
class CuttingInstructionLine:
    heat_lot: str | None
    certificate_no: str | None
    delivery_note_no: str | None
    length_mm: float
    count: int


@dataclass
class CuttingInstructionsResult:
    ok: bool
    text: str
    lines: list[CuttingInstructionLine] = field(default_factory=list)
    allocation: AllocationResult | None = None
    error_code: AllocationErrorCode = AllocationErrorCode.OK
    message: str = ""


def _fmt_mm(length_mm: float) -> str:
    rounded_int = int(round(float(length_mm)))
    if abs(float(length_mm) - float(rounded_int)) <= _EPS:
        return str(rounded_int)
    return f"{float(length_mm):.3f}".rstrip("0").rstrip(".")


def _render_cutting_text(
    lines: list[CuttingInstructionLine],
    *,
    material_label: str | None = None,
) -> str:
    a_col = "ATEST"
    r_col = "Rozmer"
    p_col = "Pocet"
    a_width = max(len(a_col), *(len((ln.heat_lot or "").strip() or "-") for ln in lines))
    r_values = [f"{_fmt_mm(ln.length_mm)} mm" for ln in lines]
    r_width = max(len(r_col), *(len(v) for v in r_values)) if r_values else len(r_col)

    out = ["Rezat:"]
    if material_label:
        out.append(material_label)
    if material_label:
        out.append("")

    out.append(f"{a_col:<{a_width}}    {r_col:<{r_width}}    {p_col}")
    for idx, line in enumerate(lines):
        a_val = (line.heat_lot or "").strip() or "-"
        out.append(f"{a_val:<{a_width}}    {r_values[idx]:<{r_width}}    {int(line.count)}x")
    return "\n".join(out)


def build_cutting_instructions_for_pila(
    *,
    requested_piece_count: int,
    delka_na_kus_mm: float,
    vyrabeno_po: int,
    na_upnuti_mm: float,
    prorez_mm: float,
    povolit_deleni_polotovaru: bool,
    receipt_units: list[ReceiptUnitSnapshot],
    minimalni_zbytek_pouzitelny_mm: float = 0.0,
    minimalni_vydavana_delka_mm: float = 0.0,
    material_label: str | None = None,
    drawing_or_order_ref: str | None = None,
) -> CuttingInstructionsResult:
    """
    Build grouped cutting instructions from allocation engine segments.

    Notes:
    - The allocation engine determines how many finished pieces are sourced from
      each segment. Saw-cut lengths are derived from technology parameters
      (`vyrabeno_po`, `delka_na_kus_mm`, `na_upnuti_mm`, `prorez_mm`) and not
      from `allocated_mm`.
    """
    alloc = allocate_material_issue_by_receipt_units(
        requested_finished_piece_count=int(requested_piece_count),
        delka_na_kus_mm=float(delka_na_kus_mm),
        vyrabeno_po=int(vyrabeno_po),
        na_upnuti_mm=float(na_upnuti_mm),
        prorez_mm=float(prorez_mm),
        povolit_deleni_polotovaru=bool(povolit_deleni_polotovaru),
        minimalni_zbytek_pouzitelny_mm=float(minimalni_zbytek_pouzitelny_mm),
        minimalni_vydavana_delka_mm=float(minimalni_vydavana_delka_mm),
        receipt_units=receipt_units,
    )
    if not alloc.ok:
        return CuttingInstructionsResult(
            ok=False,
            text="",
            lines=[],
            allocation=alloc,
            error_code=alloc.error_code,
            message=alloc.message,
        )

    grouped: dict[tuple[str | None, float], CuttingInstructionLine] = {}
    for segment in alloc.lines:
        cut_count = int(segment.cut_count)
        if cut_count <= 0:
            continue

        heat_lot = segment.heat_lot
        certificate_no = segment.certificate_no
        delivery_note_no = segment.delivery_note_no

        rounded_length = round(float(segment.cut_length_mm), 6)
        key = (heat_lot, rounded_length)
        prev = grouped.get(key)
        if prev is None:
            grouped[key] = CuttingInstructionLine(
                heat_lot=heat_lot,
                certificate_no=certificate_no,
                delivery_note_no=delivery_note_no,
                length_mm=rounded_length,
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
    text = _render_cutting_text(
        grouped_lines,
        material_label=material_label,
    )
    return CuttingInstructionsResult(
        ok=True,
        text=text,
        lines=grouped_lines,
        allocation=alloc,
        error_code=AllocationErrorCode.OK,
        message="",
    )
