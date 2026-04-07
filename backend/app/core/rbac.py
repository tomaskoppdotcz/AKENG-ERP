"""
Simple role-based access for AKENG ERP.

- Missing / unknown role header → allow all (pilot / backward compatible).
- CEO and Administrativa → full access when a valid role is supplied.
"""

from __future__ import annotations

import unicodedata

from fastapi import HTTPException


def _fold_ascii(s: str) -> str:
    return "".join(
        c for c in unicodedata.normalize("NFD", s.lower()) if unicodedata.category(c) != "Mn"
    )

# Canonical labels (UI / header), Czech diacritics as in product spec.
ROLES: tuple[str, ...] = (
    "CEO",
    "Obchod",
    "Plánování",
    "Výroba",
    "Sklad",
    "Kvalita",
    "Technologie",
    "Administrativa",
)

_ROLE_ALIASES: dict[str, str] = {
    "ceo": "CEO",
    "obchod": "Obchod",
    "planovani": "Plánování",
    "planning": "Plánování",
    "vyroba": "Výroba",
    "production": "Výroba",
    "sklad": "Sklad",
    "warehouse": "Sklad",
    "kvalita": "Kvalita",
    "quality": "Kvalita",
    "technologie": "Technologie",
    "technology": "Technologie",
    "administrativa": "Administrativa",
    "admin": "Administrativa",
}

# Nav group ids — must match frontend `erpNavConfig` `ErpNavGroup.id`.
_NAV_BY_ROLE: dict[str, frozenset[str]] = {
    "Obchod": frozenset({"dashboard", "orders", "purchase", "master_data"}),
    "Plánování": frozenset({"dashboard", "orders", "planning", "production", "warehouse", "master_data"}),
    "Výroba": frozenset({"dashboard", "orders", "production", "master_data"}),
    "Sklad": frozenset({"dashboard", "orders", "warehouse", "master_data"}),
    "Kvalita": frozenset({"dashboard", "orders", "production", "warehouse", "quality", "master_data"}),
    "Technologie": frozenset({"dashboard", "orders", "production", "technology", "master_data"}),
}

# Action → roles allowed (CEO / Administrativa handled separately).
_ACTION_ROLES: dict[str, frozenset[str]] = {
    "orders.write": frozenset({"Obchod"}),
    "orders.storno": frozenset({}),  # CEO / Administrativa only
    "planning.write": frozenset({"Plánování"}),
    "production.execute": frozenset({"Plánování", "Výroba"}),
    "production.storno": frozenset({"Plánování"}),
    "stock.mutate": frozenset({"Sklad"}),
    "technology.write": frozenset({"Technologie"}),
    "quality.write": frozenset({"Kvalita"}),
    "purchase.write": frozenset({"Obchod"}),
}


def normalize_role(raw: str | None) -> str | None:
    if raw is None:
        return None
    s = str(raw).strip()
    if not s:
        return None
    if s in ROLES:
        return s
    return _ROLE_ALIASES.get(_fold_ascii(s))


def is_full_access_role(role: str | None) -> bool:
    return role in ("CEO", "Administrativa")


def can_see_nav_group(role: str | None, group_id: str) -> bool:
    if role is None or is_full_access_role(role):
        return True
    allowed = _NAV_BY_ROLE.get(role)
    if allowed is None:
        return True
    return group_id in allowed


def can_perform_action(role: str | None, action: str) -> bool:
    if role is None:
        return True
    if is_full_access_role(role):
        return True
    allowed_roles = _ACTION_ROLES.get(action)
    if allowed_roles is None:
        return True
    return role in allowed_roles


def assert_can(role: str | None, action: str) -> None:
    if can_perform_action(role, action):
        return
    raise HTTPException(status_code=403, detail="Nedostatečná oprávnění pro tuto akci.")
