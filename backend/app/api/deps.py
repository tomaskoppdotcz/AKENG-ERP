"""
AKENG ERP — FastAPI dependencies pro identitu / RBAC.

Vrstvy identity (v pořadí priority; každá vyšší vrstva přepíše nižší):

1. `Authorization: Bearer <token>` — opaque session token z `/auth/login`.
   Pokud je token validní, `actor` = username přihlášeného `erp_users`
   řádku (ignoruje se `X-AKENG-Actor` header).
2. `X-AKENG-Actor` header — legacy/pilot identifikátor (free-form string,
   typicky username). Používá se pro audit a pro resolution proti
   `erp_users` (viz `app.services.auth_permissions`).
3. `X-AKENG-Role` header — legacy role (CZ diacritics), slouží jako
   fallback pokud actor neodpovídá žádnému `erp_users` řádku.

Pokud není k dispozici ani jedno → pilot režim (full access, viz
`resolve_permissions_for_request`).
"""

from typing import Annotated

from fastapi import Depends, Header, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.rbac import assert_can, normalize_role
from app.models.auth import AuthSession
from app.models.erp_user import ErpUser
from app.services.auth_permissions import resolve_permissions_for_request


def _strip_bearer(raw: str | None) -> str | None:
    if not raw:
        return None
    s = raw.strip()
    if not s:
        return None
    # Accept "Bearer xxx" (case-insensitive) nebo holý token.
    if s.lower().startswith("bearer "):
        return s.split(None, 1)[1].strip() or None
    return s


def _resolve_session_username(db: Session, token: str | None) -> str | None:
    """Najde aktivní session + vrátí username. Tichá tolerance chyb."""
    if not token:
        return None
    try:
        sess = db.scalar(select(AuthSession).where(AuthSession.token == token))
    except Exception:
        return None
    if sess is None:
        return None
    # Optional expiry check.
    from datetime import datetime, timezone
    if sess.expires_at is not None:
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        if sess.expires_at < now:
            return None
    user = db.get(ErpUser, sess.user_id)
    if user is None or user.is_active is False:
        return None
    return user.username


def get_effective_role(
    x_akeng_role: Annotated[str | None, Header(alias="X-AKENG-Role")] = None,
) -> str | None:
    return normalize_role(x_akeng_role)


def get_effective_actor(
    authorization: Annotated[str | None, Header(alias="Authorization")] = None,
    x_akeng_actor: Annotated[str | None, Header(alias="X-AKENG-Actor")] = None,
    db: Session = Depends(get_db),
) -> str | None:
    """Actor pro RBAC a audit.

    Bearer token má přednost před `X-AKENG-Actor`. Pokud je token, ale už
    neplatí (vypršel / smazán), padneme zpět na header — uživatelé tak
    nepřijdou o pilot režim jen proto, že se jim vyprázdnil token.
    """
    token = _strip_bearer(authorization)
    username = _resolve_session_username(db, token)
    if username:
        return username
    a = (x_akeng_actor or "").strip()
    return a or None


def require_action(action: str):
    """Legacy action-based gating (diacritic role → action whitelist).

    Kompatibilní s `app.core.rbac._ACTION_ROLES`. Pokud actor odpovídá DB
    uživateli a má permission code `action`, také projde (nové permission
    codes jsou nadmnožinou legacy action names).
    """

    def _dep(
        role: str | None = Depends(get_effective_role),
        actor: str | None = Depends(get_effective_actor),
        db: Session = Depends(get_db),
    ) -> None:
        resolution = resolve_permissions_for_request(db, actor=actor, legacy_role=role)
        if resolution.has_full_access:
            return
        if action in resolution.permissions:
            return
        assert_can(role, action)

    return _dep


def require_permission(permission_code: str):
    """Gating na základě DB permission code (nová cesta)."""

    def _dep(
        role: str | None = Depends(get_effective_role),
        actor: str | None = Depends(get_effective_actor),
        db: Session = Depends(get_db),
    ) -> None:
        resolution = resolve_permissions_for_request(db, actor=actor, legacy_role=role)
        if resolution.has_full_access:
            return
        if permission_code in resolution.permissions:
            return
        raise HTTPException(status_code=403, detail="Nedostatečná oprávnění pro tuto akci.")

    return _dep
