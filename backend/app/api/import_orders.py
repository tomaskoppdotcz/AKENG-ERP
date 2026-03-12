from fastapi import APIRouter, UploadFile, File, Depends
from sqlalchemy.orm import Session
import pdfplumber
import datetime
import re

from app.core.database import get_db
from app.models.orders import CustomerOrder, Job, JobItem, ProductionOrder

router = APIRouter()


def generate_zak(db: Session) -> str:
    year = datetime.datetime.now().year % 100
    count = db.query(Job).count() + 1
    return f"ZAK{year}{count:04d}"


def generate_vp(year: int, counter: int) -> str:
    return f"VP{year}{counter:04d}"


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

        qty_clean = qty_raw.replace(".", "").replace(",", ".")
        try:
            qty = int(round(float(qty_clean)))
        except Exception:
            qty = 0

        parsed_rows.append(
            {
                "line_no": line_no,
                "gpn": gpn,
                "description": description,
                "due_date": due_date.isoformat() if due_date else None,
                "qty": qty,
                "source_line": line,
            }
        )

    if not parsed_rows:
        return {
            "status": "no_items_found",
            "customer_po_no": customer_po_no,
            "sample": lines[:40],
        }

    # 1) customer order
    customer_order = CustomerOrder(
        customer_po_no=customer_po_no,
        customer_name="John Crane",
        order_date=order_date,
    )
    db.add(customer_order)
    db.flush()

    # 2) ZAK
    zak_code = generate_zak(db)
    job = Job(
        zak_code=zak_code,
        customer_order_id=customer_order.id,
    )
    db.add(job)
    db.flush()

    # 3) line items + VP
    year = datetime.datetime.now().year % 100
    vp_counter = 1
    created_items = []

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

        vp_code = generate_vp(year, vp_counter)

        vp = ProductionOrder(
            vp_code=vp_code,
            job_item_id=job_item.id,
        )
        db.add(vp)

        created_items.append(
            {
                "line_no": row["line_no"],
                "gpn": row["gpn"],
                "description": row["description"],
                "due_date": row["due_date"],
                "qty": row["qty"],
                "vp": vp_code,
            }
        )

        vp_counter += 1

    db.commit()

    return {
        "status": "ok",
        "customer_po_no": customer_po_no,
        "zak": zak_code,
        "items_created": created_items,
    }
