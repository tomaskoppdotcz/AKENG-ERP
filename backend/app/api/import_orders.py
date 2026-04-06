from fastapi import APIRouter, UploadFile, File, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session
import pdfplumber
import datetime
import re

from app.core.database import get_db
from app.models.orders import CustomerOrder, Job, JobItem, ProductionOrder
from app.services.business_numbering import next_vp_code, next_zak_code
from app.services.vp_operation_generator import ensure_planning_operations_for_production_order

router = APIRouter()


def _parse_qty_token(qty_raw: str) -> int:
    """
    Parse quantity tokens like '3,00', '3.00', '300', '3 000,00' robustly.
    - If there is a comma, treat it as decimal separator and dots as thousands.
    - If there is no comma, treat '.' as decimal separator, not thousands.
    """
    token = qty_raw.replace(" ", "")

    if "," in token:
        integer_part = token.split(",")[0].replace(".", "")
        try:
            return int(integer_part)
        except Exception:
            pass

    token2 = token.replace(",", ".")
    try:
        return int(round(float(token2)))
    except Exception:
        return 0


def _parse_price_token(value_raw: str) -> float:
    """
    Parse price tokens like '2.849,00' or '8547,00' into float.
    """
    token = value_raw.replace(" ", "")
    if "," in token:
        token = token.replace(".", "").replace(",", ".")
    return float(token or 0)


def _job_items_have_price_column(db: Session) -> bool:
    rows = db.execute(text("PRAGMA table_info(job_items)")).fetchall()
    return any(row[1] == "sales_price_per_unit" for row in rows)


@router.post("/customer-order-pdf")
async def import_customer_order_pdf(file: UploadFile = File(...), db: Session = Depends(get_db)):
    text = ""

    with pdfplumber.open(file.file) as pdf:
        for page in pdf.pages:
            page_text = page.extract_text() or ""
            text += page_text + "\n"

    lines = text.splitlines()

    # objednávka zákazníka
    po_match = re.search(r"\b(\d{10})\b", text)
    customer_po_no = po_match.group(1) if po_match else file.filename

    # datum objednávky
    date_match = re.search(r"\b(\d{2}\.\d{2}\.\d{4})\b", text)
    order_date = None
    if date_match:
        try:
            order_date = datetime.datetime.strptime(date_match.group(1), "%d.%m.%Y").date()
        except Exception:
            order_date = datetime.date.today()
    else:
        order_date = datetime.date.today()

    parsed_rows = []

    # očekávaný řádek:
    # 10 89578150 Mtg Rng 120mm 329 S.S.(0720) 24.04.2026 3,00 KS 2.849,00 / KS 8.547,00
    row_pattern = re.compile(
        r"^(\d+)\s+(\d{6,})\s+(.+?)\s+(\d{2}\.\d{2}\.\d{4})\s+([\d\.,]+)\s+KS\b"
    )

    for raw_line in lines:
        line = " ".join(raw_line.split())
        if not line:
            continue

        m = row_pattern.match(line)
        if not m:
            continue

        line_no = int(m.group(1))
        gpn = m.group(2)
        description = m.group(3).strip()
        due_date_raw = m.group(4)
        qty_raw = m.group(5)

        try:
            due_date = datetime.datetime.strptime(due_date_raw, "%d.%m.%Y").date()
        except Exception:
            due_date = None

        qty = _parse_qty_token(qty_raw)

        # Try to extract prices from the tail of the line, e.g.
        # "3,00 KS 2.849,00 / KS 8.547,00"
        sales_price_per_unit = None
        sales_price_total = None
        price_match = re.search(r"([\d\.,]+)\s*/\s*KS\s+([\d\.,]+)", line)
        if price_match:
            try:
                sales_price_per_unit = _parse_price_token(price_match.group(1))
                sales_price_total = _parse_price_token(price_match.group(2))
            except Exception:
                sales_price_per_unit = None
                sales_price_total = None

        parsed_rows.append(
            {
                "line_no": line_no,
                "gpn": gpn,
                "description": description,
                "due_date": due_date.isoformat() if due_date else None,
                "qty": qty,
                "sales_price_per_unit": sales_price_per_unit,
                "sales_price_total": sales_price_total,
                "source_line": line,
            }
        )

    # 1) customer order
    customer_order = CustomerOrder(
        customer_po_no=customer_po_no,
        customer_name="John Crane",
        order_date=order_date,
    )
    db.add(customer_order)
    db.flush()

    # 2) ZAK (monotonic; never reuse after deletes)
    zak_code = next_zak_code(db)
    job = Job(
        zak_code=zak_code,
        customer_order_id=customer_order.id,
    )
    db.add(job)
    db.flush()

    # 3) line items + VP (monotonic VP-######)
    created_items = []
    have_price = _job_items_have_price_column(db)

    for row in parsed_rows:
        job_item = JobItem(
            job_id=job.id,
            line_no=row["line_no"],
            gpn=row["gpn"],
            qty=row["qty"],
            due_date=datetime.datetime.strptime(row["due_date"], "%Y-%m-%d").date() if row["due_date"] else None,
        )
        db.add(job_item)
        db.flush()

        # Persist sales_price_per_unit if the column exists in DB.
        if have_price and row.get("sales_price_per_unit") is not None:
            try:
                db.execute(
                    text(
                        "UPDATE job_items "
                        "SET sales_price_per_unit = :price "
                        "WHERE id = :id"
                    ),
                    {
                        "price": float(row["sales_price_per_unit"] or 0),
                        "id": job_item.id,
                    },
                )
            except Exception:
                # Best-effort; ignore pricing persistence failures.
                pass

        db.flush()
        vp_code = next_vp_code(db)
        vp = ProductionOrder(
            vp_code=vp_code,
            job_item_id=job_item.id,
        )
        db.add(vp)
        db.flush()
        ensure_planning_operations_for_production_order(db, vp)

        created_items.append(
            {
                "line_no": row["line_no"],
                "gpn": row["gpn"],
                "description": row["description"],
                "due_date": row["due_date"],
                "qty": row["qty"],
                "sales_price_per_unit": row.get("sales_price_per_unit"),
                "sales_price_total": row.get("sales_price_total"),
                "vp": vp_code,
            }
        )

    db.commit()

    # Debug log to verify structure creation
    print("IMPORT DEBUG:")
    print("CustomerOrder:", customer_order.id)
    print("Job:", job.id)
    print("JobItems count:", len(parsed_rows))

    return {
        "status": "ok",
        "customer_order_id": customer_order.id,
        "zak": zak_code,
        "items_created": len(parsed_rows),
    }
