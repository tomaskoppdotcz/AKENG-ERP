"""Globální UI nastavení (fáze 1: pořadí položek postranní navigace)."""

from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.app_setting import AppSetting

router = APIRouter()

NAV_SIDEBAR_ORDER_KEY = "nav_sidebar_order"


class NavSidebarOrderBody(BaseModel):
    """`order[group_id]` = seřazené `moduleKey` řetězce."""

    order: dict[str, list[str]] = Field(default_factory=dict)


def _parse_order(raw: str | None) -> dict[str, list[str]]:
    if not raw or not raw.strip():
        return {}
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    if not isinstance(data, dict):
        return {}
    out: dict[str, list[str]] = {}
    for k, v in data.items():
        if not isinstance(k, str):
            continue
        if not isinstance(v, list):
            continue
        keys: list[str] = []
        for x in v:
            if isinstance(x, str) and x.strip():
                keys.append(x)
        out[k] = keys
    return out


def _validate_order_payload(order: dict[str, Any]) -> dict[str, list[str]]:
    if not isinstance(order, dict):
        raise HTTPException(status_code=422, detail="order must be an object")
    out: dict[str, list[str]] = {}
    for gid, arr in order.items():
        if not isinstance(gid, str) or not gid.strip():
            continue
        if not isinstance(arr, list):
            raise HTTPException(status_code=422, detail=f"order[{gid!r}] must be an array of strings")
        keys: list[str] = []
        for x in arr:
            if not isinstance(x, str):
                raise HTTPException(status_code=422, detail="module keys must be strings")
            if x.strip():
                keys.append(x)
        out[gid] = keys
    return out


@router.get("/nav-sidebar-order")
def get_nav_sidebar_order(db: Session = Depends(get_db)):
    row = db.get(AppSetting, NAV_SIDEBAR_ORDER_KEY)
    if row is None:
        return {"order": {}}
    return {"order": _parse_order(row.value_json)}


@router.put("/nav-sidebar-order")
def put_nav_sidebar_order(body: NavSidebarOrderBody, db: Session = Depends(get_db)):
    clean = _validate_order_payload(body.order)
    payload = json.dumps(clean, ensure_ascii=False)
    row = db.get(AppSetting, NAV_SIDEBAR_ORDER_KEY)
    if row is None:
        row = AppSetting(key=NAV_SIDEBAR_ORDER_KEY, value_json=payload)
        db.add(row)
    else:
        row.value_json = payload
    db.commit()
    return {"ok": True, "order": clean}
