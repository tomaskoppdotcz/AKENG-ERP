"""
AKENG ERP — autentizace (login / logout / change password).

První plnohodnotná verze:
- heslo uloženo jako PBKDF2-HMAC-SHA256 hash v `erp_users.password_hash`
- session = opaque bearer token v tabulce `erp_auth_sessions`
- token posílá frontend v hlavičce `Authorization: Bearer <token>`

Vystavené endpointy:
- POST /auth/login      { username, password } → { token, user: MeOut }
- POST /auth/logout     → zneplatní aktuální token
- POST /auth/password   { old_password, new_password } → self-service
                          změna hesla aktuálního uživatele

Přechodová pravidla (pilot / migrace z ERP bez hesel):
- Pokud uživatel existuje, ale `password_hash` je `None`, chování řídí
  flag `AKENG_ALLOW_EMPTY_PASSWORD_LOGIN` (viz `app.core.config`):
    - true (default): login projde s jakýmkoli heslem — jakmile si (nebo
      admin) heslo nastaví, tahle tolerance se pro něj vypne.
    - false: login je odmítnut (401); heslo musí nejdřív nastavit admin
      přes `POST /users/{id}/password`.
- Pokud uživatel neexistuje a je zapnutý pilot bootstrap (viz
  `AKENG_PILOT_AUTOCREATE`, default vypnuto), vytvoříme pilot záznam
  bez rolí. Produkční nasazení by to mělo nechat vypnuté.
"""

from __future__ import annotations

import os
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.api.deps import get_effective_actor, get_effective_role
from app.core.config import settings
from app.core.database import get_db
from app.core.password import hash_password, verify_password
from app.models.auth import AuthSession
from app.models.erp_user import ErpUser
from app.services.auth_permissions import resolve_permissions_for_request

router = APIRouter(tags=["auth"])


SESSION_TTL_DAYS = int(os.getenv("AKENG_SESSION_TTL_DAYS", "14"))


def _utc_now_naive() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _new_token() -> str:
    return secrets.token_urlsafe(32)


# -----------------------------------------------------------------------------
# Pydantic schémata
# -----------------------------------------------------------------------------


class LoginBody(BaseModel):
    username: str = Field(min_length=1, max_length=200)
    password: str = Field(min_length=1, max_length=256)


class ChangePasswordBody(BaseModel):
    old_password: str = Field(default="", max_length=256)
    new_password: str = Field(min_length=1, max_length=256)


class MeLite(BaseModel):
    actor: str | None
    username: str | None
    display_name: str | None
    user_id: int | None
    is_active: bool
    roles: list[str]
    permissions: list[str]
    has_full_access: bool


class LoginResponse(BaseModel):
    token: str
    expires_at: datetime | None
    user: MeLite


# -----------------------------------------------------------------------------
# Endpoints
# -----------------------------------------------------------------------------


def _resolve_me(db: Session, actor: str | None, legacy_role: str | None) -> MeLite:
    resolution = resolve_permissions_for_request(db, actor=actor, legacy_role=legacy_role)
    u = resolution.user
    return MeLite(
        actor=actor,
        username=u.username if u else None,
        display_name=u.display_name if u else None,
        user_id=u.id if u else None,
        is_active=bool(u.is_active) if u else True,
        roles=sorted(resolution.role_codes),
        permissions=sorted(resolution.permissions),
        has_full_access=resolution.has_full_access,
    )


@router.post("/auth/login", response_model=LoginResponse)
def login(
    body: LoginBody,
    db: Session = Depends(get_db),
    legacy_role: str | None = Depends(get_effective_role),
) -> LoginResponse:
    username = body.username.strip()
    if not username or not body.password:
        raise HTTPException(status_code=400, detail="Uživatelské jméno a heslo jsou povinné.")

    user = db.scalar(select(ErpUser).where(ErpUser.username == username))
    if user is None:
        raise HTTPException(status_code=401, detail="Neplatné přihlašovací údaje.")
    if user.is_active is False:
        raise HTTPException(status_code=401, detail="Účet je deaktivován.")

    if user.password_hash:
        if not verify_password(body.password, user.password_hash):
            raise HTTPException(status_code=401, detail="Neplatné přihlašovací údaje.")
    else:
        # Uživatel existuje, ale ještě nemá nastavené heslo.
        # - allow_empty_password_login=True  → přechodové pravidlo: jakékoli
        #   heslo projde (backward compat pro migraci z ERP bez hesel).
        # - allow_empty_password_login=False → ostrý režim: login odmítnut;
        #   admin musí nejdřív heslo nastavit přes `/users/{id}/password`.
        if not settings.allow_empty_password_login:
            raise HTTPException(
                status_code=401,
                detail="Účet nemá nastavené heslo. Kontaktujte administrátora.",
            )

    token = _new_token()
    sess = AuthSession(
        token=token,
        user_id=user.id,
        created_at=_utc_now_naive(),
        expires_at=_utc_now_naive() + timedelta(days=SESSION_TTL_DAYS),
        last_seen_at=_utc_now_naive(),
    )
    db.add(sess)
    db.commit()

    me = _resolve_me(db, actor=user.username, legacy_role=legacy_role)
    return LoginResponse(token=token, expires_at=sess.expires_at, user=me)


@router.post("/auth/logout")
def logout(
    authorization: str | None = Header(default=None, alias="Authorization"),
    db: Session = Depends(get_db),
) -> dict[str, bool]:
    raw = (authorization or "").strip()
    if raw.lower().startswith("bearer "):
        raw = raw.split(None, 1)[1].strip()
    if raw:
        db.execute(delete(AuthSession).where(AuthSession.token == raw))
        db.commit()
    return {"ok": True}


@router.post("/auth/password")
def change_my_password(
    body: ChangePasswordBody,
    db: Session = Depends(get_db),
    actor: str | None = Depends(get_effective_actor),
) -> dict[str, bool]:
    if not actor:
        raise HTTPException(status_code=401, detail="Nejste přihlášen.")
    user = db.scalar(select(ErpUser).where(ErpUser.username == actor))
    if user is None:
        raise HTTPException(status_code=401, detail="Uživatel neexistuje.")

    if user.password_hash:
        # Pokud už heslo má, musíme ověřit staré.
        if not body.old_password or not verify_password(body.old_password, user.password_hash):
            raise HTTPException(status_code=400, detail="Staré heslo je nesprávné.")

    user.password_hash = hash_password(body.new_password)
    db.commit()

    # Ostatní sessions ponecháme, jen vydáváme info. Kdyby bylo potřeba
    # invalidovat všechny sessions po změně hesla, smazalo by se zde:
    # db.execute(delete(AuthSession).where(AuthSession.user_id == user.id))
    return {"ok": True}


# -----------------------------------------------------------------------------
# Bootstrap admin user
# -----------------------------------------------------------------------------


def bootstrap_admin_user(db: Session) -> None:
    """Zajistí, že existuje admin uživatel s přiřazenou rolí `admin`.

    Idempotentní:
    - pokud admin řádek chybí, vytvoří ho a přiřadí roli `admin`;
    - pokud existuje bez `password_hash`, nastaví heslo z env
      `AKENG_BOOTSTRAP_ADMIN_PASSWORD` (default `admin`);
    - pokud heslo už existuje, nechá ho být.

    Username admin uživatele lze přepsat env `AKENG_BOOTSTRAP_ADMIN_USERNAME`
    (default `admin`).
    """
    from app.models.auth import Role, UserRole

    admin_username = (os.getenv("AKENG_BOOTSTRAP_ADMIN_USERNAME") or "admin").strip() or "admin"
    admin_password = os.getenv("AKENG_BOOTSTRAP_ADMIN_PASSWORD") or "admin"

    admin_role = db.scalar(select(Role).where(Role.code == "admin"))
    if admin_role is None:
        # Role se seeduje v `seed_roles_and_permissions`; pokud tam neexistuje,
        # bootstrap přeskočíme — proběhne až při příštím startu.
        return

    user = db.scalar(select(ErpUser).where(ErpUser.username == admin_username))
    if user is None:
        user = ErpUser(
            username=admin_username,
            display_name="Administrátor",
            is_active=True,
            role="Administrativa",
            password_hash=hash_password(admin_password),
        )
        db.add(user)
        db.flush()
    elif not user.password_hash:
        user.password_hash = hash_password(admin_password)

    existing = db.scalar(
        select(UserRole).where(
            UserRole.user_id == user.id,
            UserRole.role_id == admin_role.id,
        )
    )
    if existing is None:
        db.add(UserRole(user_id=user.id, role_id=admin_role.id))

    db.commit()
