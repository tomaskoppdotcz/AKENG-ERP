"""
AKENG ERP — vyhodnocení oprávnění pro aktuální request.

Actor → user → role → permissions.

Zdroje identity (v pořadí priority):
1) `X-AKENG-Actor` header → `erp_users.username` (exact match) nebo `chip_code`.
   Pokud se najde aktivní uživatel, použijí se role přiřazené v `erp_user_roles`.
2) `X-AKENG-Role` header (legacy) → mapování diacritic roles (CEO, Obchod, …)
   na nový role code (viz `LEGACY_ROLE_CODE_MAP`).

Pilot režim (backward compatibility):
- Pokud actor nezrezonuje na žádného uživatele v `erp_users` *a zároveň*
  není k dispozici legacy role, vrátíme `has_full_access=True`. Jde o
  záměrný fallback pro situace, kdy knihovna uživatelů ještě nebyla
  naplněna (fresh instalace / pilot): samotný `X-AKENG-Actor` string je
  jen audit label, bez DB mapování nemá žádnou autoritu. Jakmile admin
  uživatele v knihovně založí (i bez rolí), fallback pro jeho username
  přestane platit a gating zafunguje podle `erp_user_roles` /
  `role_permissions`.
- Admin role (`role_codes` obsahuje `admin`) nebo permission `admin_access`
  dávají plný přístup i pro známé uživatele.

Souvisí s:
- `app.core.rbac` — action-based legacy check (nepřímo volaný z `require_action`).
- `app.api.users_auth` — DB modely.
"""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.auth import Permission, Role, RolePermission, UserRole
from app.models.erp_user import ErpUser

# Mapování starých (diacritic) rolí na nové role codes.
LEGACY_ROLE_CODE_MAP: dict[str, str] = {
    "CEO": "admin",
    "Administrativa": "admin",
    "Obchod": "obchod",
    "Plánování": "planovani",
    "Výroba": "vyroba",
    "Sklad": "sklad",
    "Kvalita": "kvalita",
    "Technologie": "vyroba",  # nejbližší role (nemáme vlastní technologii ve 7-role setu)
}


@dataclass
class PermissionResolution:
    user: ErpUser | None
    role_codes: set[str]
    permissions: set[str]
    has_full_access: bool


def _find_user(db: Session, actor: str | None) -> ErpUser | None:
    if not actor:
        return None
    raw = str(actor).strip()
    if not raw:
        return None
    u = db.scalar(select(ErpUser).where(ErpUser.username == raw))
    if u is None:
        u = db.scalar(select(ErpUser).where(ErpUser.chip_code == raw))
    if u is None:
        return None
    if u.is_active is False:
        return u
    return u


def _collect_permissions(db: Session, role_codes: set[str]) -> set[str]:
    if not role_codes:
        return set()
    rows = db.execute(
        select(Permission.code)
        .join(RolePermission, RolePermission.permission_id == Permission.id)
        .join(Role, Role.id == RolePermission.role_id)
        .where(Role.code.in_(role_codes))
    ).all()
    return {r[0] for r in rows}


def resolve_permissions_for_request(
    db: Session,
    *,
    actor: str | None,
    legacy_role: str | None,
) -> PermissionResolution:
    """Vrátí množinu role_codes + permissions pro aktuální actor/role kombinaci."""
    user = _find_user(db, actor)

    role_codes: set[str] = set()

    if user is not None and user.is_active:
        rows = db.execute(
            select(Role.code)
            .join(UserRole, UserRole.role_id == Role.id)
            .where(UserRole.user_id == user.id)
        ).all()
        role_codes |= {r[0] for r in rows}

    if not role_codes and legacy_role:
        mapped = LEGACY_ROLE_CODE_MAP.get(legacy_role)
        if mapped:
            role_codes.add(mapped)

    permissions = _collect_permissions(db, role_codes)

    has_full_access = (
        "admin_access" in permissions
        or "admin" in role_codes
        or (legacy_role in ("CEO", "Administrativa") and not role_codes)
        # Pilot fallback: actor header sice může být nastavený (frontend ho
        # posílá vždy — username / "default"), ale pokud jsme nenašli
        # odpovídajícího uživatele v `erp_users` a není k dispozici legacy
        # role, chováme se jako pilot / backward compatibility a povolíme
        # vše. Jakmile je uživatel v knihovně založen (byť bez rolí), tento
        # fallback se neuplatní a gating jede striktně podle DB.
        or (user is None and not role_codes and not legacy_role)
    )

    return PermissionResolution(
        user=user,
        role_codes=role_codes,
        permissions=permissions,
        has_full_access=has_full_access,
    )


def has_permission(resolution: PermissionResolution, code: str) -> bool:
    if resolution.has_full_access:
        return True
    return code in resolution.permissions
