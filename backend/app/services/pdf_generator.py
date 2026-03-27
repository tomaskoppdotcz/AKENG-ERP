from __future__ import annotations

import io
import math
import os
import re
from datetime import date, datetime

from reportlab.graphics.barcode import code128
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from sqlalchemy import select, text

from app.core.database import SessionLocal
from app.core.scan_code import production_order_operation_scan_code_for_id
from app.models.orders import CustomerOrder, Job, JobItem, ProductionOrder, ProductionOrderOperation
from app.models.portfolio import PortfolioItem, PortfolioTechnologyTemplate, PortfolioTechnologyTemplateOperation

AKENG_TEXT_DARK = "#0F2A30"
AKENG_BORDER_SOFT = "#A8C7CC"
AKENG_HEADER_FILL = "#E8F5F6"
AKENG_TRACE_FILL = "#F5FAFA"
AKENG_OPERATION_FILL = "#E1F2F4"


def _optional_job_item_fields(db, job_item_id: int) -> tuple[str | None, int | None]:
    cols = {r[1] for r in db.execute(text("PRAGMA table_info(job_items)")).fetchall()}
    has_desc = "description" in cols
    has_portfolio = "portfolio_item_id" in cols
    if not has_desc and not has_portfolio:
        return (None, None)
    sel = []
    if has_desc:
        sel.append("description")
    if has_portfolio:
        sel.append("portfolio_item_id")
    row = db.execute(
        text("SELECT " + ", ".join(sel) + " FROM job_items WHERE id = :id"),
        {"id": int(job_item_id)},
    ).fetchone()
    if not row:
        return (None, None)
    idx = 0
    desc = None
    pid = None
    if has_desc:
        desc = row[idx]
        idx += 1
    if has_portfolio:
        pid = row[idx]
    return (desc, int(pid) if pid is not None else None)


def _format_date(d: date | None) -> str:
    return d.isoformat() if d is not None else "—"


def _pick_unicode_font_paths() -> tuple[str, str]:
    regular_candidates = [
        "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
        "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/Library/Fonts/Arial Unicode.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ]
    bold_candidates = [
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
        "/Library/Fonts/Arial Bold.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    ]
    reg = next((p for p in regular_candidates if os.path.exists(p)), "")
    if not reg:
        raise ValueError("Chybí Unicode TTF font pro PDF (nelze korektně vykreslit české znaky).")
    bold = next((p for p in bold_candidates if os.path.exists(p)), reg)
    return reg, bold


def _ensure_pdf_fonts() -> tuple[str, str]:
    regular_name = "AKENGSans"
    bold_name = "AKENGSansBold"
    reg_path, bold_path = _pick_unicode_font_paths()
    registered = set(pdfmetrics.getRegisteredFontNames())
    if regular_name not in registered:
        pdfmetrics.registerFont(TTFont(regular_name, reg_path))
    if bold_name not in registered:
        pdfmetrics.registerFont(TTFont(bold_name, bold_path))
    return regular_name, bold_name


def _draw_barcode(c: canvas.Canvas, value: str, x: float, y: float, width: float = 55 * mm, height: float = 12 * mm):
    if not value:
        return
    bc = code128.Code128(value, barHeight=height, barWidth=0.35)
    scale = width / max(bc.width, 1)
    c.saveState()
    c.translate(x, y)
    c.scale(scale, 1.0)
    bc.drawOn(c, 0, 0)
    c.restoreState()


def _wrap_text_lines(text: str, max_chars: int) -> list[str]:
    raw = (text or "").replace("\r\n", "\n").replace("\r", "\n")
    if not raw.strip():
        return ["—"]
    out: list[str] = []
    for paragraph in raw.split("\n"):
        line = paragraph.rstrip()
        if not line:
            out.append("")
            continue
        words = line.split(" ")
        cur = ""
        for word in words:
            candidate = word if not cur else f"{cur} {word}"
            if len(candidate) <= max_chars:
                cur = candidate
            else:
                if cur:
                    out.append(cur)
                if len(word) <= max_chars:
                    cur = word
                else:
                    for i in range(0, len(word), max_chars):
                        chunk = word[i : i + max_chars]
                        if i + max_chars < len(word):
                            out.append(chunk)
                        else:
                            cur = chunk
        if cur:
            out.append(cur)
    return out if out else ["—"]


def _first_non_empty(*values: str | None) -> str | None:
    for v in values:
        if v is not None and str(v).strip():
            return str(v).strip()
    return None


def _parse_dimension_mm(dimension: str | None) -> float | None:
    if dimension is None:
        return None
    raw = str(dimension).strip()
    if not raw:
        return None
    m = re.match(r"^\s*([\d]+(?:[.,]\d+)?)", raw.replace(" ", ""))
    if not m:
        return None
    try:
        value = float(m.group(1).replace(",", "."))
    except Exception:
        return None
    return value if value > 0 and math.isfinite(value) else None


def _kg_per_mm_from_density(density: float | None, dimension: str | None) -> float | None:
    if density is None:
        return None
    d_mm = _parse_dimension_mm(dimension)
    if d_mm is None:
        return None
    # round bar approximation: kg for 1 mm length from diameter + density
    d_m = d_mm / 1000.0
    length_m = 1.0 / 1000.0
    return math.pi * (d_m ** 2) / 4.0 * length_m * float(density)


def _resolve_logo_path() -> str | None:
    env_logo_square = os.getenv("AKENG_LOGO_SQUARE_PATH", "").strip()
    env_logo = os.getenv("AKENG_LOGO_PATH", "").strip()
    project_logo = os.path.abspath(
        os.path.join(os.path.dirname(__file__), "..", "..", "assets", "logo-akeng.png")
    )
    candidates = [
        project_logo,
        env_logo_square,
        env_logo,
        "/Users/akeng_tomaskopp/Desktop/AKENG-ERP/backend/assets/AKENG-square.png",
        "/Users/akeng_tomaskopp/Desktop/AKENG-ERP/backend/assets/akeng-square.png",
        "/Users/akeng_tomaskopp/Desktop/AKENG-ERP/backend/assets/AKENG-mark.png",
        "/Users/akeng_tomaskopp/Desktop/AKENG-ERP/backend/assets/akeng-mark.png",
        "/Users/akeng_tomaskopp/Desktop/AKENG-ERP/backend/assets/akeng-logo.png",
        "/Users/akeng_tomaskopp/Desktop/AKENG-ERP/backend/assets/AKENG-logo.png",
        "/Users/akeng_tomaskopp/Desktop/AKENG-ERP/backend/assets/logo.png",
    ]
    for p in candidates:
        if p and os.path.exists(p):
            return p
    return None


def _draw_top_logo(c: canvas.Canvas, x: float, y_top: float, max_w: float, max_h: float) -> None:
    logo = _resolve_logo_path()
    if logo:
        try:
            from PIL import Image

            with Image.open(logo) as img:
                iw, ih = img.size
            if iw > 0 and ih > 0:
                ratio = min(max_w / float(iw), max_h / float(ih))
                draw_w = float(iw) * ratio
                draw_h = float(ih) * ratio
                c.drawImage(
                    logo,
                    x,
                    y_top - draw_h,
                    width=draw_w,
                    height=draw_h,
                    preserveAspectRatio=True,
                    mask="auto",
                )
                return
        except Exception:
            pass
    return


def _table_columns(db, table_name: str) -> set[str]:
    try:
        return {r[1] for r in db.execute(text(f"PRAGMA table_info({table_name})")).fetchall()}
    except Exception:
        return set()


def _load_product_traceability(db, portfolio: PortfolioItem | None) -> dict:
    gpn = getattr(portfolio, "gpn", None) if portfolio is not None else None
    name = getattr(portfolio, "name", None) if portfolio is not None else None
    location = "—"
    stock_scan = "—"
    source_vp = "—"
    source_vp_scan = None
    heat_lot = "—"

    if portfolio is not None and _table_columns(db, "product_stock_items"):
        row = db.execute(
            text(
                "SELECT i.location, i.scan_code, r.note, po.vp_code, po.scan_code "
                "FROM product_stock_items i "
                "LEFT JOIN product_stock_receipts r ON r.product_stock_item_id = i.id "
                "LEFT JOIN production_orders po ON po.id = r.production_order_id "
                "WHERE i.portfolio_item_id = :pid "
                "ORDER BY r.received_at DESC, r.id DESC, i.id DESC "
                "LIMIT 1"
            ),
            {"pid": int(portfolio.id)},
        ).fetchone()
        if row:
            location = _first_non_empty(str(row[0]) if row[0] is not None else None, "—") or "—"
            stock_scan = _first_non_empty(str(row[1]) if row[1] is not None else None, "—") or "—"
            heat_lot = _first_non_empty(str(row[2]) if row[2] is not None else None, "—") or "—"
            source_vp = _first_non_empty(str(row[3]) if row[3] is not None else None, "—") or "—"
            source_vp_scan = _first_non_empty(str(row[4]) if row[4] is not None else None, None)

    rows = [
        ("GPN", _first_non_empty(str(gpn) if gpn is not None else None, "—") or "—"),
        ("Název", _first_non_empty(str(name) if name is not None else None, "—") or "—"),
        ("Lokace", location),
        ("Scan kód skladové karty", stock_scan),
        ("Původní VP", source_vp),
        ("Šarže / tavba", heat_lot),
    ]
    return {"rows": rows, "source_vp_scan": source_vp_scan}


def _load_material_traceability(db, po: ProductionOrder, portfolio: PortfolioItem | None) -> dict:
    out = {
        "material_code": "—",
        "material_name": "—",
        "material_dimension": "—",
        "length_per_piece_mm": "—",
        "weight_per_piece_kg": "—",
        "heat_lot": "—",
        "material_move_scan_code": "—",
    }
    if portfolio is not None:
        out["material_name"] = _first_non_empty(
            getattr(portfolio, "material_default", None),
            getattr(portfolio, "name", None),
            out["material_name"],
        ) or "—"

    tpl = db.scalars(
        select(PortfolioTechnologyTemplate)
        .where(
            PortfolioTechnologyTemplate.portfolio_item_id == int(portfolio.id) if portfolio is not None else -1,
            PortfolioTechnologyTemplate.is_active.is_(True),
        )
        .order_by(PortfolioTechnologyTemplate.id.asc())
    ).first() if portfolio is not None else None
    if tpl is None and portfolio is not None:
        tpl = db.scalars(
            select(PortfolioTechnologyTemplate)
            .where(PortfolioTechnologyTemplate.portfolio_item_id == int(portfolio.id))
            .order_by(PortfolioTechnologyTemplate.id.asc())
        ).first()

    kg_per_mm_value: float | None = None

    if tpl is not None:
        mat_rows = db.execute(
            text(
                "SELECT material_library_item_id, consumption_per_piece, consumption_unit "
                "FROM portfolio_technology_template_materials "
                "WHERE template_id = :tid AND input_type = 'material' "
                "ORDER BY id ASC LIMIT 1"
            ),
            {"tid": int(tpl.id)},
        ).fetchone()
        if mat_rows and mat_rows[0] is not None:
            mat_lib_id = int(mat_rows[0])
            cons_per_piece = float(mat_rows[1] or 0) if len(mat_rows) > 1 and mat_rows[1] is not None else None
            cons_unit = str(mat_rows[2] or "").strip().lower() if len(mat_rows) > 2 and mat_rows[2] is not None else ""
            if cons_per_piece is not None and cons_per_piece > 0:
                if "mm" in cons_unit:
                    out["length_per_piece_mm"] = f"{cons_per_piece:g}"
                elif "kg" in cons_unit:
                    out["weight_per_piece_kg"] = f"{cons_per_piece:g}"
            if _table_columns(db, "material_library_items"):
                ml_cols = _table_columns(db, "material_library_items")
                kg_col_expr = (
                    "kg_per_mm AS kg_per_mm_val"
                    if "kg_per_mm" in ml_cols
                    else ("kg_mm AS kg_per_mm_val" if "kg_mm" in ml_cols else "NULL AS kg_per_mm_val")
                )
                ml = db.execute(
                    text(
                        "SELECT code, name, dimension, density, "
                        + kg_col_expr
                        + " FROM material_library_items WHERE id = :id"
                    ),
                    {"id": mat_lib_id},
                ).fetchone()
                if ml:
                    out["material_code"] = _first_non_empty(str(ml[0]) if ml[0] is not None else None, out["material_code"]) or "—"
                    out["material_name"] = _first_non_empty(str(ml[1]) if ml[1] is not None else None, out["material_name"]) or "—"
                    out["material_dimension"] = _first_non_empty(str(ml[2]) if ml[2] is not None else None, out["material_dimension"]) or "—"
                    try:
                        kg_per_mm_value = float(ml[4]) if ml[4] is not None else None
                    except Exception:
                        kg_per_mm_value = None
                    if kg_per_mm_value is None:
                        try:
                            density_val = float(ml[3]) if ml[3] is not None else None
                        except Exception:
                            density_val = None
                        kg_per_mm_value = _kg_per_mm_from_density(density_val, str(ml[2]) if ml[2] is not None else None)

            if _table_columns(db, "material_stock_items"):
                ms_cols = _table_columns(db, "material_stock_items")
                mv_cols = _table_columns(db, "material_stock_movements")

                def _movement_candidates_from_stock_item(stock_item_id: int) -> list[dict]:
                    if stock_item_id <= 0 or not mv_cols:
                        return []
                    select_parts = [
                        "m.id",
                        "m.reference",
                        "m.note",
                        "m.movement_date",
                    ]
                    if "scan_code" in mv_cols:
                        select_parts.append("m.scan_code")
                    else:
                        select_parts.append("NULL AS scan_code")
                    if "heat_lot" in mv_cols:
                        select_parts.append("m.heat_lot")
                    elif "lot_code" in mv_cols:
                        select_parts.append("m.lot_code AS heat_lot")
                    else:
                        select_parts.append("NULL AS heat_lot")
                    if "length_per_piece_mm" in mv_cols:
                        select_parts.append("m.length_per_piece_mm")
                    else:
                        select_parts.append("NULL AS length_per_piece_mm")
                    if "weight_per_piece_kg" in mv_cols:
                        select_parts.append("m.weight_per_piece_kg")
                    else:
                        select_parts.append("NULL AS weight_per_piece_kg")
                    query = (
                        "SELECT "
                        + ", ".join(select_parts)
                        + " FROM material_stock_movements m "
                        + "WHERE m.stock_item_id = :sid "
                    )
                    params: dict[str, object] = {"sid": int(stock_item_id)}
                    if "production_order_id" in mv_cols:
                        query += "AND m.production_order_id = :poid "
                        params["poid"] = int(po.id)
                    elif "job_item_id" in mv_cols and po.job_item_id is not None:
                        query += "AND m.job_item_id = :jiid "
                        params["jiid"] = int(po.job_item_id)
                    elif po.vp_code:
                        query += "AND (COALESCE(m.reference,'') LIKE :vp OR COALESCE(m.note,'') LIKE :vp) "
                        params["vp"] = f"%{str(po.vp_code)}%"
                    query += "ORDER BY m.movement_date DESC, m.id DESC LIMIT 1"
                    row = db.execute(text(query), params).fetchone()
                    if not row:
                        return []
                    return [
                        {
                            "reference": row[1],
                            "note": row[2],
                            "scan_code": row[4],
                            "heat_lot": row[5],
                            "length_per_piece_mm": row[6],
                            "weight_per_piece_kg": row[7],
                        }
                    ]

                def _apply_movement_to_out(mv: dict) -> None:
                    out["heat_lot"] = _first_non_empty(
                        str(mv.get("heat_lot")) if mv.get("heat_lot") is not None else None,
                        str(mv.get("reference")) if mv.get("reference") is not None else None,
                        str(mv.get("note")) if mv.get("note") is not None else None,
                        out["heat_lot"],
                    ) or "—"
                    out["material_move_scan_code"] = _first_non_empty(
                        str(mv.get("scan_code")) if mv.get("scan_code") is not None else None,
                        out["material_move_scan_code"],
                    ) or "—"
                    if mv.get("length_per_piece_mm") is not None:
                        try:
                            out["length_per_piece_mm"] = f"{float(mv['length_per_piece_mm']):g}"
                        except Exception:
                            pass
                    if mv.get("weight_per_piece_kg") is not None:
                        try:
                            out["weight_per_piece_kg"] = f"{float(mv['weight_per_piece_kg']):g}"
                        except Exception:
                            pass

                movement_applied = False

                # Prefer movement tied to VP (via reservation stock_item when available).
                if _table_columns(db, "material_stock_reservations") and po.job_item_id is not None:
                    res = db.execute(
                        text(
                            "SELECT stock_item_id FROM material_stock_reservations "
                            "WHERE job_item_id = :jiid ORDER BY created_at DESC, id DESC LIMIT 1"
                        ),
                        {"jiid": int(po.job_item_id)},
                    ).fetchone()
                    if res and res[0] is not None:
                        mv_list = _movement_candidates_from_stock_item(int(res[0]))
                        if mv_list:
                            _apply_movement_to_out(mv_list[0])
                            movement_applied = True

                ms = db.execute(
                    text(
                        "SELECT id, location FROM material_stock_items "
                        "WHERE material_library_item_id = :mid ORDER BY id DESC LIMIT 1"
                    ),
                    {"mid": mat_lib_id},
                ).fetchone()
                if ms:
                    if out["material_dimension"] == "—" and ms[1] is not None:
                        out["material_dimension"] = str(ms[1]).strip() or "—"
                    # If no exact VP-linked movement found, fallback to best available movement on latest stock item.
                    if not movement_applied and mv_cols:
                        fallback_mv = db.execute(
                            text(
                                "SELECT m.reference, m.note, "
                                + ("m.scan_code" if "scan_code" in mv_cols else "NULL")
                                + ", "
                                + (
                                    "m.heat_lot"
                                    if "heat_lot" in mv_cols
                                    else ("m.lot_code" if "lot_code" in mv_cols else "NULL")
                                )
                                + ", "
                                + ("m.length_per_piece_mm" if "length_per_piece_mm" in mv_cols else "NULL")
                                + ", "
                                + ("m.weight_per_piece_kg" if "weight_per_piece_kg" in mv_cols else "NULL")
                                + " FROM material_stock_movements m "
                                + "WHERE m.stock_item_id = :sid "
                                + "ORDER BY m.movement_date DESC, m.id DESC LIMIT 1"
                            ),
                            {"sid": int(ms[0])},
                        ).fetchone()
                        if fallback_mv:
                            _apply_movement_to_out(
                                {
                                    "reference": fallback_mv[0],
                                    "note": fallback_mv[1],
                                    "scan_code": fallback_mv[2],
                                    "heat_lot": fallback_mv[3],
                                    "length_per_piece_mm": fallback_mv[4],
                                    "weight_per_piece_kg": fallback_mv[5],
                                }
                            )

    if out["heat_lot"] == "—":
        out["heat_lot"] = _first_non_empty(
            getattr(po, "heat_lot_scan_code", None),
            getattr(po, "heat_lot_code", None),
            getattr(po, "lot_scan_code", None),
            out["heat_lot"],
        ) or "—"

    # Prefer deterministic calculation from material-library kg/mm and known length per piece.
    if kg_per_mm_value is not None:
        try:
            length_mm = float(str(out.get("length_per_piece_mm", "—")).replace(",", "."))
        except Exception:
            length_mm = None
        if length_mm is not None:
            computed = round(length_mm * float(kg_per_mm_value), 3)
            out["weight_per_piece_kg"] = f"{computed:.3f}"

    return {"rows": [
        ("Kód materiálu", out["material_code"]),
        ("Materiál", out["material_name"]),
        ("Rozměr", out["material_dimension"]),
        ("Tavba / šarže", out["heat_lot"]),
        ("Délka na kus (mm)", out["length_per_piece_mm"]),
        ("Váha na kus (kg)", out["weight_per_piece_kg"]),
        ("Scan kód pohybu materiálu", out["material_move_scan_code"]),
    ], "source_vp_scan": None}


def _load_traceability_data(db, po: ProductionOrder, portfolio: PortfolioItem | None) -> dict:
    mode = str(getattr(po, "logistic_mode", "") or "").strip().lower()
    if mode == "sklad_zakaznik":
        return _load_product_traceability(db, portfolio)
    return _load_material_traceability(db, po, portfolio)


class FooterCanvas(canvas.Canvas):
    def __init__(self, *args, footer_created_at: str, **kwargs):
        super().__init__(*args, **kwargs)
        self._saved_page_states: list[dict] = []
        self._footer_created_at = footer_created_at

    def showPage(self):
        self._saved_page_states.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        total_pages = len(self._saved_page_states)
        for i, state in enumerate(self._saved_page_states, start=1):
            self.__dict__.update(state)
            self._draw_footer(i, total_pages)
            super().showPage()
        super().save()

    def _draw_footer(self, page_no: int, total_pages: int) -> None:
        w, _h = self._pagesize
        margin_x = 12 * mm
        y = 8 * mm
        self.saveState()
        self.setStrokeColor(colors.HexColor(AKENG_BORDER_SOFT))
        self.line(margin_x, y + 4 * mm, w - margin_x, y + 4 * mm)
        self.setFont("AKENGSans", 8)
        self.setFillColor(colors.HexColor(AKENG_TEXT_DARK))
        self.drawString(margin_x, y, f"Datum vytvoření: {self._footer_created_at}")
        self.drawRightString(w - margin_x, y, f"Strana {page_no} / {total_pages}")
        self.restoreState()


def generate_production_order_pdf(production_order_id: int) -> bytes:
    db = SessionLocal()
    try:
        font_regular, font_bold = _ensure_pdf_fonts()
        po = db.get(ProductionOrder, int(production_order_id))
        if po is None:
            raise ValueError("Výrobní příkaz nebyl nalezen.")

        job = db.get(Job, int(po.job_id)) if po.job_id is not None else None
        co = db.get(CustomerOrder, int(po.customer_order_id)) if po.customer_order_id is not None else None
        ji = db.get(JobItem, int(po.job_item_id)) if po.job_item_id is not None else None
        ji_desc, ji_portfolio_id = _optional_job_item_fields(db, int(ji.id)) if ji is not None else (None, None)
        portfolio_item_id = int(po.portfolio_item_id) if po.portfolio_item_id is not None else ji_portfolio_id
        portfolio = db.get(PortfolioItem, int(portfolio_item_id)) if portfolio_item_id is not None else None

        tpl = None
        if portfolio is not None:
            tpl = db.scalars(
                select(PortfolioTechnologyTemplate)
                .where(
                    PortfolioTechnologyTemplate.portfolio_item_id == int(portfolio.id),
                    PortfolioTechnologyTemplate.is_active.is_(True),
                )
                .order_by(PortfolioTechnologyTemplate.id.asc())
            ).first()
            if tpl is None:
                tpl = db.scalars(
                    select(PortfolioTechnologyTemplate)
                    .where(PortfolioTechnologyTemplate.portfolio_item_id == int(portfolio.id))
                    .order_by(PortfolioTechnologyTemplate.id.asc())
                ).first()

        tpl_ops: dict[int, PortfolioTechnologyTemplateOperation] = {}
        if tpl is not None:
            for op in db.scalars(
                select(PortfolioTechnologyTemplateOperation)
                .where(PortfolioTechnologyTemplateOperation.template_id == int(tpl.id))
                .order_by(PortfolioTechnologyTemplateOperation.operation_no.asc(), PortfolioTechnologyTemplateOperation.id.asc())
            ).all():
                tpl_ops[int(op.operation_no)] = op

        mapped_ops = db.scalars(
            select(ProductionOrderOperation)
            .where(ProductionOrderOperation.production_order_id == int(po.id))
            .order_by(ProductionOrderOperation.operation_no.asc(), ProductionOrderOperation.id.asc())
        ).all()
        if not mapped_ops and tpl_ops:
            for no in sorted(tpl_ops.keys()):
                op = tpl_ops[no]
                row = ProductionOrderOperation(
                    production_order_id=int(po.id),
                    operation_no=int(op.operation_no),
                    operation_name=op.operation_name,
                    workplace_name=op.workplace,
                )
                db.add(row)
                db.flush()
                row.scan_code = production_order_operation_scan_code_for_id(int(row.id))
                mapped_ops.append(row)
            db.commit()
            mapped_ops = db.scalars(
                select(ProductionOrderOperation)
                .where(ProductionOrderOperation.production_order_id == int(po.id))
                .order_by(ProductionOrderOperation.operation_no.asc(), ProductionOrderOperation.id.asc())
            ).all()

        created_at_text = datetime.now().strftime("%Y-%m-%d %H:%M")
        buf = io.BytesIO()
        c = FooterCanvas(buf, pagesize=A4, footer_created_at=created_at_text)
        w, h = A4
        margin_x = 12 * mm

        TOP_TITLE_Y = h - 14 * mm
        LOGO_TOP_OFFSET = 26 * mm
        LOGO_MAX_W = 185 * mm
        LOGO_MAX_H = 52 * mm
        NEXT_PAGE_CONTENT_Y = h - 18 * mm

        def draw_top_row(y_pos: float) -> None:
            _draw_top_logo(
                c,
                margin_x,
                y_pos + LOGO_TOP_OFFSET,
                max_w=LOGO_MAX_W,
                max_h=LOGO_MAX_H,
            )
            c.setFillColor(colors.HexColor(AKENG_TEXT_DARK))
            c.setFont(font_bold, 14)
            c.drawRightString(w - margin_x, y_pos, f"Výrobní příkaz: {po.vp_code or '—'}")

        title_y = TOP_TITLE_Y
        draw_top_row(title_y)

        header_top = title_y - 4 * mm
        block_h = 62 * mm
        c.setStrokeColor(colors.HexColor(AKENG_BORDER_SOFT))
        c.setFillColor(colors.HexColor(AKENG_HEADER_FILL))
        c.roundRect(margin_x, header_top - block_h, w - 2 * margin_x, block_h, 4, fill=1, stroke=1)
        c.setFillColor(colors.HexColor(AKENG_TEXT_DARK))

        order_label = "Interní zakázka" if str(getattr(co, "order_type", "customer") or "customer") == "internal" else "Zakázka"
        customer_name = (co.customer_name if co is not None and getattr(co, "customer_name", None) else "—")
        drawing_no = (portfolio.drawing_no if portfolio is not None and getattr(portfolio, "drawing_no", None) else "—")
        revision = (portfolio.revision if portfolio is not None and getattr(portfolio, "revision", None) else "—")

        left_x = margin_x + 4 * mm
        right_x = margin_x + 92 * mm
        row_y = header_top - 6 * mm

        order_no = None
        if co is not None:
            order_no = getattr(co, "customer_po_no", None)
        if not order_no and job is not None:
            order_no = getattr(job, "zak_code", None)

        left_rows = [
            ("Objednávka", order_no or "—"),
            (order_label, job.zak_code if job is not None else "—"),
            ("Zákazník", customer_name),
        ]
        for i, (k, v) in enumerate(left_rows):
            y_row = row_y - (i * 6.3 * mm)
            c.setFont(font_bold, 9)
            c.drawString(left_x, y_row, f"{k}:")
            c.setFont(font_regular, 9)
            c.drawString(left_x + 30 * mm, y_row, str(v))

        c.setFont(font_bold, 9)
        c.drawString(right_x, row_y, "Řádek:")
        c.setFont(font_regular, 9)
        c.drawString(right_x + 30 * mm, row_y, str(ji.line_no) if ji is not None and ji.line_no is not None else "—")

        right_rows = [
            ("GPN", po.gpn or (ji.gpn if ji is not None else "—")),
            ("Výkres", drawing_no),
            ("Název", po.description or ji_desc or "—"),
            ("Revize", revision),
        ]
        for i, (k, v) in enumerate(right_rows):
            y_row = row_y - ((i + 1) * 6.3 * mm)
            c.setFont(font_bold, 9.6 if k == "Výkres" else 9)
            c.drawString(right_x, y_row, f"{k}:")
            c.setFont(font_bold if k == "Výkres" else font_regular, 9.6 if k == "Výkres" else 9)
            c.drawString(right_x + 30 * mm, y_row, str(v))

        below_y = row_y - (5 * 6.3 * mm)
        below_rows = [
            ("Množství", f"{int(po.quantity or 0)} ks"),
            ("Termín", _format_date(ji.due_date if ji is not None else None)),
            ("Materiál", portfolio.material_default if portfolio is not None and portfolio.material_default else "—"),
            ("Logistický režim", po.logistic_mode or "—"),
        ]
        for k, v in below_rows:
            c.setFont(font_bold, 9)
            c.drawString(left_x, below_y, f"{k}:")
            c.setFont(font_regular, 9)
            c.drawString(left_x + 30 * mm, below_y, str(v))
            below_y -= 5.7 * mm

        barcode_w_main = 48 * mm
        barcode_h_main = 11 * mm
        barcode_x = w - margin_x - barcode_w_main - 2 * mm
        barcode_y = (header_top - block_h) + 4 * mm
        c.setFillColor(colors.white)
        c.roundRect(barcode_x - 2.5 * mm, barcode_y - 3 * mm, barcode_w_main + 5 * mm, barcode_h_main + 11 * mm, 3, fill=1, stroke=1)
        c.setFillColor(colors.HexColor(AKENG_TEXT_DARK))
        c.setFont(font_bold, 8)
        c.drawString(barcode_x + 2.4 * mm, barcode_y + barcode_h_main + 4.9 * mm, "Scan kód VP")
        c.setFont(font_regular, 8)
        c.drawString(barcode_x + 2.4 * mm, barcode_y + barcode_h_main + 1.7 * mm, po.scan_code or "—")
        _draw_barcode(c, po.scan_code or "", barcode_x + 1.2 * mm, barcode_y + 0.8 * mm, width=barcode_w_main - 2.4 * mm, height=barcode_h_main - 1.6 * mm)

        y = header_top - block_h - 8 * mm
        trace_h = 34 * mm
        c.setFillColor(colors.HexColor(AKENG_TRACE_FILL))
        c.setStrokeColor(colors.HexColor(AKENG_BORDER_SOFT))
        c.roundRect(margin_x, y - trace_h, w - 2 * margin_x, trace_h, 3, fill=1, stroke=1)
        c.setFillColor(colors.HexColor(AKENG_TEXT_DARK))
        c.setFont(font_bold, 10)
        c.drawString(margin_x + 3 * mm, y - 5 * mm, "Materiál / dohledatelnost")

        trace_payload = _load_traceability_data(db, po, portfolio)
        trace_rows = trace_payload.get("rows", [])
        source_vp_scan = trace_payload.get("source_vp_scan")
        left_block_x = margin_x + 3 * mm
        right_block_x = margin_x + (w - 2 * margin_x) / 2 + 2 * mm
        block_y_top = y - 12 * mm
        c.setFont(font_bold, 8.7)
        split = (len(trace_rows) + 1) // 2
        left_rows = trace_rows[:split]
        right_rows = trace_rows[split:]
        yy = block_y_top
        for k, v in left_rows:
            c.drawString(left_block_x, yy, f"{k}: {v or '—'}")
            yy -= 5.6 * mm
        row_step = 5.6 * mm
        yy = block_y_top
        for k, v in right_rows:
            c.drawString(right_block_x, yy, f"{k}: {v or '—'}")
            yy -= row_step
        if source_vp_scan:
            c.setFont(font_regular, 7.8)
            c.drawString(right_block_x, y - trace_h + 11.8 * mm, f"Zdroj VP scan: {source_vp_scan}")
            _draw_barcode(c, str(source_vp_scan), right_block_x, y - trace_h + 3.4 * mm, width=58 * mm, height=7 * mm)

        y -= trace_h + 6 * mm
        c.setFont(font_bold, 12)
        c.drawString(margin_x, y, "Operace VP")
        y -= 5 * mm

        rows_for_pdf: list[dict] = []
        if mapped_ops:
            by_no = {int(r.operation_no): r for r in mapped_ops}
            all_nos = sorted(set(by_no.keys()) | set(tpl_ops.keys()))
            for no in all_nos:
                m = by_no.get(no)
                t = tpl_ops.get(no)
                rows_for_pdf.append(
                    {
                        "operation_no": no,
                        "operation_name": (m.operation_name if m is not None else None) or (t.operation_name if t is not None else "—"),
                        "workplace_name": (m.workplace_name if m is not None else None) or (t.workplace if t is not None else "—"),
                        "setup_min": float(t.setup_min or 0) if t is not None else 0.0,
                        "run_min_per_piece": float(t.run_min_per_piece or 0) if t is not None else 0.0,
                        "note": (t.note if t is not None and t.note else "—"),
                        "scan_code": m.scan_code if m is not None else "",
                    }
                )
        else:
            for no in sorted(tpl_ops.keys()):
                t = tpl_ops[no]
                rows_for_pdf.append(
                    {
                        "operation_no": no,
                        "operation_name": t.operation_name,
                        "workplace_name": t.workplace or "—",
                        "setup_min": float(t.setup_min or 0),
                        "run_min_per_piece": float(t.run_min_per_piece or 0),
                        "note": (t.note or "—"),
                        "scan_code": "",
                    }
                )

        if not rows_for_pdf:
            c.setFont(font_regular, 9)
            c.drawString(margin_x, y, "Pro tento VP nejsou dostupné operace.")
        else:
            def draw_operation_block(cur_y: float, row: dict) -> float:
                block_w = w - 2 * margin_x
                head_h = 16 * mm
                instruction_title_h = 6 * mm
                line_h = 5.2 * mm
                note_title_h = 6 * mm
                note_box_h = 20 * mm
                margin_in = 3 * mm
                gap_after = 5 * mm

                lines = _wrap_text_lines(str(row.get("note") or ""), 84)
                instruction_h = max(14 * mm, len(lines) * line_h + 3 * mm)
                block_h_total = head_h + instruction_title_h + instruction_h + note_title_h + note_box_h + 2 * mm

                if cur_y - block_h_total < 12 * mm:
                    c.showPage()
                    draw_top_row(TOP_TITLE_Y)
                    cur_y = NEXT_PAGE_CONTENT_Y

                top = cur_y
                bottom = cur_y - block_h_total
                c.setStrokeColor(colors.HexColor(AKENG_BORDER_SOFT))
                c.setFillColor(colors.white)
                c.roundRect(margin_x, bottom, block_w, block_h_total, 3, fill=1, stroke=1)

                c.setFillColor(colors.HexColor(AKENG_OPERATION_FILL))
                c.roundRect(margin_x, top - head_h, block_w, head_h, 3, fill=1, stroke=0)
                c.setFillColor(colors.HexColor(AKENG_TEXT_DARK))
                page_width = w
                right_margin = margin_x
                scan_block_w = 88 * mm
                scan_block_gap = 4 * mm
                scan_block_x = page_width - right_margin - scan_block_w
                text_zone_right_x = scan_block_x - scan_block_gap

                c.setFont(font_bold, 10.6)
                op_title = f"[{row['operation_no']}] {row['operation_name']}"
                max_title_w = max(text_zone_right_x - (margin_x + margin_in), 10 * mm)
                while pdfmetrics.stringWidth(op_title, font_bold, 10.6) > max_title_w and len(op_title) > 4:
                    op_title = op_title[:-4] + "..."
                c.drawString(margin_x + margin_in, top - 5.6 * mm, op_title)
                c.setFont(font_regular, 8.8)
                norma_text = f"Norma: setup {float(row['setup_min']):g} min, čas / ks {float(row['run_min_per_piece']):g} min"
                max_norma_w = max(text_zone_right_x - (margin_x + margin_in), 10 * mm)
                while pdfmetrics.stringWidth(norma_text, font_regular, 8.8) > max_norma_w and len(norma_text) > 4:
                    norma_text = norma_text[:-4] + "..."
                c.drawString(margin_x + margin_in, top - 10.8 * mm, norma_text)

                barcode_w = 80 * mm
                barcode_h = 7 * mm

                scan_value = row["scan_code"] or ""
                bc = code128.Code128(scan_value, barHeight=barcode_h, barWidth=0.35)
                scale = barcode_w / max(bc.width, 1)
                scaled_width = bc.width * scale

                barcode_x = scan_block_x + (scan_block_w - scaled_width) / 2
                barcode_center_x = scan_block_x + (scan_block_w / 2)

                scan_text_y = top - 4.2 * mm
                barcode_y = scan_text_y - 2.3 * mm - barcode_h

                c.setFont(font_regular, 7.6)
                c.drawCentredString(barcode_center_x, scan_text_y, scan_value or "—")

                if scan_value:
                    c.saveState()
                    c.translate(barcode_x, barcode_y)
                    c.scale(scale, 1.0)
                    bc.drawOn(c, 0, 0)
                    c.restoreState()

                text_top = top - head_h - 2 * mm
                c.setFont(font_bold, 9.8)
                c.drawString(margin_x + margin_in, text_top - 2.8 * mm, "POSTUP OPERACE")
                c.setFont(font_regular, 9.6)
                cursor_y = text_top - 7.2 * mm
                for ln in lines:
                    c.drawString(margin_x + margin_in, cursor_y, ln if ln else " ")
                    cursor_y -= line_h

                c.setFont(font_bold, 8.7)
                c.drawString(margin_x + margin_in + 1.2 * mm, bottom + note_box_h - 2.5 * mm, "POZNÁMKA OBSLUHY")
                c.setStrokeColor(colors.HexColor(AKENG_BORDER_SOFT))
                c.line(
                    margin_x + margin_in,
                    bottom + note_box_h - 4.2 * mm,
                    margin_x + block_w - margin_in,
                    bottom + note_box_h - 4.2 * mm,
                )
                operator_text = "Operátor: ____________"
                c.setFont(font_bold, 9)
                op_text_w = pdfmetrics.stringWidth(operator_text, font_bold, 9)
                note_box_left = margin_x + margin_in
                note_box_bottom = bottom + 2.5 * mm
                note_box_w = block_w - 2 * margin_in
                op_x = note_box_left + note_box_w - op_text_w - 7 * mm
                op_y = note_box_bottom + 7 * mm
                c.drawString(op_x, op_y, operator_text)

                return bottom - gap_after

            for row in rows_for_pdf:
                y = draw_operation_block(y, row)

        c.showPage()
        c.save()
        return buf.getvalue()
    finally:
        db.close()

