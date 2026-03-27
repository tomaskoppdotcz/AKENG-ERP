"""CRUD API pro zákazníky (master data)."""

import re

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, inspect as sa_inspect, select, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.master_data import Customer
from app.models.portfolio import PortfolioGroup, PortfolioItem

router = APIRouter(prefix="/customers", tags=["customers"])


def ensure_customers_sqlite_schema(engine: Engine) -> None:
    """Bezpečné doplnění sloupců u existující SQLite tabulky customers."""
    try:
        url = str(engine.url)
    except Exception:
        return
    if not url.startswith("sqlite"):
        return

    insp = sa_inspect(engine)
    if "customers" not in insp.get_table_names():
        return

    cols = {c["name"] for c in insp.get_columns("customers")}
    stmts: list[str] = []
    for col, sql_type in (
        ("ico", "VARCHAR(32)"),
        ("dic", "VARCHAR(32)"),
        ("billing_address", "VARCHAR(500)"),
        ("delivery_address", "VARCHAR(500)"),
        ("contact_person", "VARCHAR(255)"),
        ("email", "VARCHAR(255)"),
        ("phone", "VARCHAR(64)"),
        ("note", "TEXT"),
    ):
        if col not in cols:
            stmts.append(f"ALTER TABLE customers ADD COLUMN {col} {sql_type}")
    if not stmts:
        return

    with engine.begin() as conn:
        for stmt in stmts:
            conn.execute(text(stmt))


def _gen_unique_code(db: Session, base: str) -> str:
    slug = re.sub(r"[^A-Z0-9]+", "_", base.upper().strip())[:40] or "ZAK"
    code = slug
    n = 0
    while db.scalar(select(Customer.id).where(Customer.code == code)) is not None:
        n += 1
        code = f"{slug[:35]}_{n}"
    return code


def _optional_str(v: str | None) -> str | None:
    if v is None:
        return None
    s = str(v).strip()
    return s if s else None


class CustomerCreatePayload(BaseModel):
    name: str = Field(..., min_length=1)
    is_active: bool = True
    ico: str | None = None
    dic: str | None = None
    billing_address: str | None = None
    delivery_address: str | None = None
    contact_person: str | None = None
    email: str | None = None
    phone: str | None = None
    note: str | None = None


class CustomerUpdatePayload(BaseModel):
    name: str | None = None
    is_active: bool | None = None
    ico: str | None = None
    dic: str | None = None
    billing_address: str | None = None
    delivery_address: str | None = None
    contact_person: str | None = None
    email: str | None = None
    phone: str | None = None
    note: str | None = None


def _customer_to_dict(c: Customer) -> dict:
    return {
        "id": c.id,
        "code": c.code,
        "name": c.name,
        "ico": c.ico,
        "dic": c.dic,
        "billing_address": c.billing_address,
        "delivery_address": c.delivery_address,
        "contact_person": c.contact_person,
        "email": c.email,
        "phone": c.phone,
        "note": c.note,
        "is_active": c.is_active,
    }


@router.get("")
def list_customers(db: Session = Depends(get_db)):
    rows = db.scalars(select(Customer).order_by(Customer.name.asc())).all()
    return [_customer_to_dict(c) for c in rows]


@router.post("")
def create_customer(payload: CustomerCreatePayload, db: Session = Depends(get_db)):
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="Název je povinný.")
    code = _gen_unique_code(db, name)
    row = Customer(
        code=code,
        name=name,
        is_active=payload.is_active,
        ico=_optional_str(payload.ico),
        dic=_optional_str(payload.dic),
        billing_address=_optional_str(payload.billing_address),
        delivery_address=_optional_str(payload.delivery_address),
        contact_person=_optional_str(payload.contact_person),
        email=_optional_str(payload.email),
        phone=_optional_str(payload.phone),
        note=_optional_str(payload.note),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _customer_to_dict(row)


@router.put("/{customer_id}")
def update_customer(customer_id: int, payload: CustomerUpdatePayload, db: Session = Depends(get_db)):
    row = db.scalar(select(Customer).where(Customer.id == customer_id))
    if row is None:
        raise HTTPException(status_code=404, detail="Zákazník nebyl nalezen.")
    data = payload.model_dump(exclude_unset=True)
    if "name" in data and data["name"] is not None:
        nm = str(data["name"]).strip()
        if not nm:
            raise HTTPException(status_code=422, detail="Název nesmí být prázdný.")
        row.name = nm
    if "is_active" in data and data["is_active"] is not None:
        row.is_active = bool(data["is_active"])
    for key in (
        "ico",
        "dic",
        "billing_address",
        "delivery_address",
        "contact_person",
        "email",
        "phone",
        "note",
    ):
        if key in data:
            setattr(row, key, _optional_str(data[key]))
    db.commit()
    db.refresh(row)
    return _customer_to_dict(row)


@router.delete("/{customer_id}")
def delete_customer(customer_id: int, db: Session = Depends(get_db)):
    row = db.scalar(select(Customer).where(Customer.id == customer_id))
    if row is None:
        raise HTTPException(status_code=404, detail="Zákazník nebyl nalezen.")
    n_items = db.scalar(select(func.count()).select_from(PortfolioItem).where(PortfolioItem.customer_id == customer_id)) or 0
    n_groups = db.scalar(select(func.count()).select_from(PortfolioGroup).where(PortfolioGroup.customer_id == customer_id)) or 0
    if n_items > 0 or n_groups > 0:
        raise HTTPException(
            status_code=409,
            detail="Zákazník nelze smazat — existují k němu portfolio položky nebo skupiny portfolia.",
        )
    db.delete(row)
    db.commit()
    return {"status": "ok"}
