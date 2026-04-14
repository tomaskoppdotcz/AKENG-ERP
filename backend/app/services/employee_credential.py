"""Resolve employees by kiosk credential (kód, čip, sken)."""

from __future__ import annotations

from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from app.models.kiosk import Employee
from app.services.cz_card_reader_normalize import normalize_czech_keyboard_reader_numeric

NO_PHYSICAL_CARD_PREFIX = "__NOPHYSCARD__"


def normalize_credential(raw: str) -> str:
    return normalize_czech_keyboard_reader_numeric((raw or "").strip())


def find_employee_by_credential(
    db: Session,
    credential: str,
    *,
    require_active: bool = True,
    require_kiosk: bool = True,
) -> Employee | None:
    """Match employee_code, chip_card_uid, legacy card_uid, or scan_code (case-insensitive where sensible)."""
    c = normalize_credential(credential)
    if not c:
        return None
    ln = c.lower()
    uc = c.upper()

    conds = [
        func.lower(Employee.employee_code) == ln,
        func.upper(Employee.chip_card_uid) == uc,
        func.upper(Employee.scan_code) == uc,
        and_(
            func.upper(Employee.card_uid) == uc,
            ~Employee.card_uid.like(NO_PHYSICAL_CARD_PREFIX + "%"),
        ),
    ]

    stmt = select(Employee).where(or_(*conds))
    if require_active:
        stmt = stmt.where(Employee.is_active.is_(True))
    if require_kiosk:
        stmt = stmt.where(Employee.can_use_kiosk.is_(True))
    hit = db.scalar(stmt)
    if hit:
        return hit

    # Legacy rows: chip/scan saved as raw CZ keystrokes — compare normalized forms in Python.
    if c.isdigit() and 4 <= len(c) <= 100:
        base = select(Employee)
        if require_active:
            base = base.where(Employee.is_active.is_(True))
        if require_kiosk:
            base = base.where(Employee.can_use_kiosk.is_(True))
        for row in db.scalars(base).all():
            for raw in (row.chip_card_uid, row.scan_code):
                if raw and normalize_czech_keyboard_reader_numeric(raw) == c:
                    return row
            cu = row.card_uid
            if cu and not str(cu).startswith(NO_PHYSICAL_CARD_PREFIX):
                if normalize_czech_keyboard_reader_numeric(str(cu)) == c:
                    return row
    return None


def find_employee_by_operator_label(db: Session, raw: str | None) -> Employee | None:
    """Case-insensitive match on `Employee.name` (shopfloor free-text operator)."""
    q = (raw or "").strip()
    if not q:
        return None
    ln = q.lower()
    return db.scalars(
        select(Employee)
        .where(func.lower(Employee.name) == ln)
        .where(Employee.is_active.is_(True))
        .where(Employee.can_use_kiosk.is_(True))
        .limit(1)
    ).first()
