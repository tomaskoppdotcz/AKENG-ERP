"""Uložené rozložení tabulek (sloupce, řazení) per uživatel a stránka."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_effective_actor
from app.core.database import get_db
from app.models.user_table_layout import UserTableLayout

router = APIRouter()

ALLOWED_PAGE_KEYS = frozenset(
    {
        "production_orders_table",
        "orders_table",
        "job_items_table",
        "drawings_table",
        "product_stock_table",
        "portfolio_table",
        "order_card_items",
    }
)


def _utc_now_naive() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _normalize_user_identifier(actor: str | None) -> str:
    a = (actor or "").strip().lower()
    if not a:
        return "default"
    return a[:256]


def _parse_layout_json(raw: str | None) -> dict[str, Any]:
    if not raw or not str(raw).strip():
        return {}
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    return data if isinstance(data, dict) else {}


class LayoutColumnModel(BaseModel):
    key: str = Field(min_length=1, max_length=128)
    visible: bool = True
    width: float | None = None
    order: int = Field(ge=0, le=10_000)


class TableLayoutBody(BaseModel):
    """Odpovídá `layout_json` v DB (bez obalu)."""

    columns: list[LayoutColumnModel] = Field(default_factory=list)
    sort: dict[str, Any] | None = None
    density: str | None = Field(default=None, max_length=32)
    pinned_column_keys: list[str] | None = None


class TableLayoutPutRequest(BaseModel):
    layout: TableLayoutBody


def _validate_layout_body(body: TableLayoutBody) -> TableLayoutBody:
    if len(body.columns) > 80:
        raise HTTPException(status_code=422, detail="Too many columns")
    seen: set[str] = set()
    for c in body.columns:
        k = c.key.strip()
        if not k:
            raise HTTPException(status_code=422, detail="Empty column key")
        if k in seen:
            raise HTTPException(status_code=422, detail=f"Duplicate column key: {k}")
        seen.add(k)
        if c.width is not None:
            if not isinstance(c.width, (int, float)) or c.width < 24 or c.width > 900:
                raise HTTPException(status_code=422, detail=f"Invalid width for {k}")
    if body.sort is not None:
        if not isinstance(body.sort, dict):
            raise HTTPException(status_code=422, detail="sort must be an object or null")
        col = body.sort.get("columnKey")
        direction = body.sort.get("direction")
        if col is not None and (not isinstance(col, str) or not col.strip()):
            raise HTTPException(status_code=422, detail="sort.columnKey invalid")
        if direction is not None and str(direction).lower() not in ("asc", "desc"):
            raise HTTPException(status_code=422, detail="sort.direction must be asc or desc")
    if body.pinned_column_keys is not None:
        if not isinstance(body.pinned_column_keys, list):
            raise HTTPException(status_code=422, detail="pinned_column_keys must be an array")
        for x in body.pinned_column_keys:
            if not isinstance(x, str) or not x.strip():
                raise HTTPException(status_code=422, detail="pinned keys must be non-empty strings")
    if body.density is not None and str(body.density).lower() not in ("comfortable", "compact"):
        raise HTTPException(status_code=422, detail="density must be comfortable or compact")
    return body


def _layout_to_json(body: TableLayoutBody) -> str:
    payload = body.model_dump()
    return json.dumps(payload, ensure_ascii=False)


@router.get("/table-layouts/{page_key}")
def get_table_layout(
    page_key: str,
    db: Session = Depends(get_db),
    actor: str | None = Depends(get_effective_actor),
):
    pk = (page_key or "").strip()
    if pk not in ALLOWED_PAGE_KEYS:
        raise HTTPException(status_code=404, detail="Unknown page_key")
    uid = _normalize_user_identifier(actor)
    row = db.scalar(
        select(UserTableLayout).where(
            UserTableLayout.user_identifier == uid,
            UserTableLayout.page_key == pk,
        )
    )
    if row is None:
        return {"page_key": pk, "user_identifier": uid, "layout": None}
    return {
        "page_key": pk,
        "user_identifier": uid,
        "layout": _parse_layout_json(row.layout_json),
    }


@router.put("/table-layouts/{page_key}")
def put_table_layout(
    page_key: str,
    body: TableLayoutPutRequest,
    db: Session = Depends(get_db),
    actor: str | None = Depends(get_effective_actor),
):
    pk = (page_key or "").strip()
    if pk not in ALLOWED_PAGE_KEYS:
        raise HTTPException(status_code=404, detail="Unknown page_key")
    uid = _normalize_user_identifier(actor)
    clean = _validate_layout_body(body.layout)
    now = _utc_now_naive()
    payload = _layout_to_json(clean)

    row = db.scalar(
        select(UserTableLayout).where(
            UserTableLayout.user_identifier == uid,
            UserTableLayout.page_key == pk,
        )
    )
    if row is None:
        db.add(
            UserTableLayout(
                user_identifier=uid,
                page_key=pk,
                layout_json=payload,
                created_at=now,
                updated_at=now,
            )
        )
    else:
        row.layout_json = payload
        row.updated_at = now
    db.commit()
    return {"ok": True, "page_key": pk, "user_identifier": uid, "layout": clean.model_dump()}
