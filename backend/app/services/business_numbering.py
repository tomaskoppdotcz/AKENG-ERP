"""
Monotonic business codes (ZAK / INT / VP).

New codes always advance past the highest numeric suffix ever used, including
cancelled or inactive rows — never reuse a number because a row was storno'd.
"""

from __future__ import annotations

import re
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.orders import CustomerOrder, Job, ProductionOrder

_ZAK_NUM = re.compile(r"^ZAK-(\d+)$", re.IGNORECASE)
_ZAK_LEGACY = re.compile(r"^ZAK(\d{6,})$", re.IGNORECASE)
_INT_NUM = re.compile(r"^INT-(\d+)$", re.IGNORECASE)
_VP_STD = re.compile(r"^VP-(\d+)$", re.IGNORECASE)
_VP_COMPACT = re.compile(r"^VP(\d+)$", re.IGNORECASE)


def _max_zak_suffix(db: Session) -> int:
    rows = db.scalars(select(Job.zak_code)).all()
    max_n = 0
    for raw in rows:
        s = (raw or "").strip()
        if not s.upper().startswith("ZAK"):
            continue
        m = _ZAK_NUM.match(s)
        if m:
            max_n = max(max_n, int(m.group(1)))
            continue
        m = _ZAK_LEGACY.match(s)
        if m:
            max_n = max(max_n, int(m.group(1)))
    return max_n


def next_zak_code(db: Session) -> str:
    return f"ZAK-{_max_zak_suffix(db) + 1:06d}"


def _max_int_suffix(db: Session) -> int:
    max_n = 0
    for raw in db.scalars(select(Job.zak_code).where(Job.zak_code.like("INT-%"))).all():
        s = (raw or "").strip()
        m = _INT_NUM.match(s)
        if m:
            max_n = max(max_n, int(m.group(1)))
    q_co = select(CustomerOrder.customer_po_no).where(
        getattr(CustomerOrder, "order_type") == "internal",
        CustomerOrder.customer_po_no.like("INT-%"),
    )
    for raw in db.scalars(q_co).all():
        s = (raw or "").strip()
        m = _INT_NUM.match(s)
        if m:
            max_n = max(max_n, int(m.group(1)))
    return max_n


def next_internal_code(db: Session) -> str:
    return f"INT-{_max_int_suffix(db) + 1:06d}"


def _max_vp_suffix(db: Session) -> int:
    max_n = 0
    for raw in db.scalars(select(ProductionOrder.vp_code)).all():
        s = (raw or "").strip()
        if not s.upper().startswith("VP"):
            continue
        m = _VP_STD.match(s)
        if m:
            max_n = max(max_n, int(m.group(1)))
            continue
        m = _VP_COMPACT.match(s)
        if m and "-" not in s[2:]:
            max_n = max(max_n, int(m.group(1)))
    return max_n


def next_vp_code(db: Session) -> str:
    return f"VP-{_max_vp_suffix(db) + 1:06d}"
