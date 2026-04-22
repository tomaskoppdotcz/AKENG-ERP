"""
AKENG ERP — uživatelé / role / oprávnění (API + migrace + seed).

Vystavuje:
- `GET  /users`                — seznam uživatelů (+ přiřazené role)
- `POST /users`                — vytvoření uživatele
- `PUT  /users/{user_id}`      — úprava uživatele (display_name / is_active / note / chip)
- `PUT  /users/{user_id}/roles`— přepsání přiřazených rolí
- `DELETE /users/{user_id}`    — smazání uživatele
- `GET  /roles`                — seznam rolí (+ oprávnění)
- `GET  /permissions`          — seznam oprávnění
- `GET  /users/me`             — info o aktuálním uživateli dle `X-AKENG-Actor`
                                  (nebo fallback z `X-AKENG-Role`); vrací seznam permission codes

Viz také `app.services.auth_permissions` pro in-process vyhodnocení.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import delete, inspect as sa_inspect, select, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from app.api.deps import get_effective_actor, get_effective_role, require_action
from app.core.database import get_db
from app.core.password import hash_password
from app.models.auth import Permission, Role, RolePermission, UserRole
from app.models.erp_user import ErpUser
from app.services.auth_permissions import resolve_permissions_for_request

router = APIRouter(tags=["users-auth"])


# -----------------------------------------------------------------------------
# Migrace (SQLite) + seed
# -----------------------------------------------------------------------------


def ensure_auth_sqlite_schema(engine: Engine) -> None:
    """Rozšíří `erp_users` o nové sloupce a založí tabulky rolí / oprávnění.

    Tabulka `erp_auth_sessions` se vytvoří přes `Base.metadata.create_all`
    (v `main.py`), tady doplňujeme jen ALTER TABLE pro existující SQLite
    databáze bez odpovídajících sloupců.
    """
    try:
        url = str(engine.url)
    except Exception:
        return
    if not url.startswith("sqlite"):
        return

    insp = sa_inspect(engine)

    if "erp_users" in insp.get_table_names():
        cols = {c["name"] for c in insp.get_columns("erp_users")}
        stmts: list[str] = []
        for col, sql_type, default_sql in (
            ("display_name", "VARCHAR(256)", None),
            ("is_active", "BOOLEAN", "DEFAULT 1"),
            ("password_hash", "VARCHAR(256)", None),
            ("chip_code", "VARCHAR(128)", None),
            ("note", "VARCHAR(512)", None),
            ("created_at", "DATETIME", None),
        ):
            if col not in cols:
                suffix = f" {default_sql}" if default_sql else ""
                stmts.append(f"ALTER TABLE erp_users ADD COLUMN {col} {sql_type}{suffix}")
        if stmts:
            with engine.begin() as conn:
                for stmt in stmts:
                    conn.execute(text(stmt))


# Minimální role + oprávnění dle specifikace.
# Pozn.: oprávnění pro systémové uživatele (knihovna sys users) a pro
# zaměstnance (master-data / kiosk) jsou záměrně oddělená — admin ERP
# může mít přístup k oboumu, operativní role jen k zaměstnancům atd.
SEED_PERMISSIONS: list[tuple[str, str, str]] = [
    # (code, description, category)
    ("read_orders",              "Číst zakázky",                                 "orders"),
    ("edit_orders",              "Vytvářet / upravovat / stornovat zakázky",     "orders"),
    ("read_production_orders",   "Číst výrobní příkazy",                         "production"),
    ("create_production_orders", "Vytvářet / stornovat výrobní příkazy",         "production"),
    ("read_planner",             "Číst plán výroby",                             "planning"),
    ("edit_planner",             "Upravovat plán výroby",                        "planning"),
    ("use_kiosk",                "Používat kiosk (start / stop operací)",        "production"),
    ("manage_stock",             "Obecné skladové akce (umbrella)",              "stock"),
    ("manage_material_stock",    "Spravovat sklad materiálu",                    "stock"),
    ("manage_product_stock",     "Spravovat sklad výrobků",                      "stock"),
    ("view_metrics",             "Číst provozní metriky (KPI, náklady)",         "metrics"),
    # --- knihovna systémových uživatelů (ERP login / role / permissions) ---
    ("read_users",               "Číst knihovnu systémových uživatelů",          "sys_users"),
    ("edit_users",               "Vytvářet / upravovat systémové uživatele",     "sys_users"),
    ("delete_users",             "Mazat systémové uživatele",                    "sys_users"),
    ("manage_users",             "Kompletní správa knihovny uživatelů (umbrella)", "sys_users"),
    ("manage_roles",             "Upravovat role a jejich oprávnění",            "sys_users"),
    # --- knihovna zaměstnanců (master data / kiosk / výkazy práce) ---
    ("read_employees",           "Číst knihovnu zaměstnanců",                    "employees"),
    ("create_employees",         "Zakládat zaměstnance",                         "employees"),
    ("edit_employees",           "Upravovat zaměstnance",                        "employees"),
    ("delete_employees",         "Mazat / deaktivovat zaměstnance",              "employees"),
    ("manage_employees",         "Kompletní správa zaměstnanců (umbrella)",      "employees"),
    # --- administrativní umbrella ---
    ("admin_access",             "Administrativní přístup (plná práva)",         "admin"),
]

# Role definice: (code, name, description, permission codes).
SEED_ROLES: list[tuple[str, str, str, list[str]]] = [
    (
        "admin",
        "Admin",
        "Plný administrátorský přístup.",
        [p[0] for p in SEED_PERMISSIONS],
    ),
    (
        "vyroba",
        "Výroba",
        "Operátor výroby — kiosk, čtení VP, čtení skladu.",
        [
            "read_orders",
            "read_production_orders",
            "read_planner",
            "use_kiosk",
            "view_metrics",
            "read_employees",
        ],
    ),
    (
        "planovani",
        "Plánování",
        "Plánovač — plán výroby, VP, čtení zakázek a skladu.",
        [
            "read_orders",
            "read_production_orders",
            "create_production_orders",
            "read_planner",
            "edit_planner",
            "use_kiosk",
            "view_metrics",
            "read_employees",
        ],
    ),
    (
        "sklad",
        "Sklad",
        "Skladník — správa skladů materiálu i výrobků.",
        [
            "read_orders",
            "read_production_orders",
            "manage_stock",
            "manage_material_stock",
            "manage_product_stock",
            "view_metrics",
            "read_employees",
        ],
    ),
    (
        "kvalita",
        "Kvalita",
        "Kontrolor kvality — čtení všeho, záznamy NOK v kiosku.",
        [
            "read_orders",
            "read_production_orders",
            "read_planner",
            "use_kiosk",
            "view_metrics",
            "read_employees",
        ],
    ),
    (
        "obchod",
        "Obchod",
        "Obchodník — správa zakázek a čtení provozních metrik.",
        [
            "read_orders",
            "edit_orders",
            "read_production_orders",
            "view_metrics",
        ],
    ),
    (
        "readonly",
        "ReadOnly",
        "Pouze čtení — žádné mutace.",
        [
            "read_orders",
            "read_production_orders",
            "read_planner",
            "view_metrics",
            "read_employees",
        ],
    ),
]


def seed_roles_and_permissions(db: Session) -> None:
    """Idempotentně vytvoří / aktualizuje role + oprávnění + mapování."""
    # permissions
    existing_perms = {p.code: p for p in db.scalars(select(Permission)).all()}
    for code, description, category in SEED_PERMISSIONS:
        p = existing_perms.get(code)
        if p is None:
            db.add(Permission(code=code, description=description, category=category))
        else:
            changed = False
            if p.description != description:
                p.description = description
                changed = True
            if p.category != category:
                p.category = category
                changed = True
            if changed:
                db.add(p)
    db.flush()
    perm_by_code = {p.code: p for p in db.scalars(select(Permission)).all()}

    # roles
    existing_roles = {r.code: r for r in db.scalars(select(Role)).all()}
    for code, name, description, perm_codes in SEED_ROLES:
        r = existing_roles.get(code)
        if r is None:
            r = Role(code=code, name=name, description=description, is_system=True)
            db.add(r)
            db.flush()
        else:
            if r.name != name or r.description != description:
                r.name = name
                r.description = description
                db.add(r)

        desired = {perm_by_code[c].id for c in perm_codes if c in perm_by_code}
        current_rows = db.scalars(
            select(RolePermission).where(RolePermission.role_id == r.id)
        ).all()
        current = {row.permission_id for row in current_rows}

        for row in current_rows:
            if row.permission_id not in desired:
                db.delete(row)
        for pid in desired - current:
            db.add(RolePermission(role_id=r.id, permission_id=pid))

    db.commit()


# -----------------------------------------------------------------------------
# Pydantic schémata
# -----------------------------------------------------------------------------


class PermissionOut(BaseModel):
    id: int
    code: str
    description: str
    category: str


class RoleOut(BaseModel):
    id: int
    code: str
    name: str
    description: str | None
    is_system: bool
    permissions: list[str]


class UserOut(BaseModel):
    id: int
    username: str
    display_name: str | None
    is_active: bool
    role_legacy: str | None = Field(
        default=None,
        description="Legacy field `erp_users.role` (kompatibilita s X-AKENG-Role); nové role jsou v `roles`.",
    )
    chip_code: str | None
    note: str | None
    created_at: datetime | None
    roles: list[str]  # role codes


class UserCreate(BaseModel):
    username: str = Field(min_length=1, max_length=200)
    display_name: str | None = Field(default=None, max_length=256)
    is_active: bool = True
    chip_code: str | None = Field(default=None, max_length=128)
    note: str | None = Field(default=None, max_length=512)
    role_codes: list[str] = Field(default_factory=list)
    role_legacy: str | None = Field(default=None, max_length=64)


class UserUpdate(BaseModel):
    display_name: str | None = Field(default=None, max_length=256)
    is_active: bool | None = None
    chip_code: str | None = Field(default=None, max_length=128)
    note: str | None = Field(default=None, max_length=512)
    role_legacy: str | None = Field(default=None, max_length=64)


class UserRolesAssign(BaseModel):
    role_codes: list[str] = Field(default_factory=list)


class UserPasswordSet(BaseModel):
    password: str = Field(min_length=1, max_length=256)


class MeOut(BaseModel):
    """Info o aktuálním uživateli pro frontend (gating UI)."""

    actor: str | None
    username: str | None
    display_name: str | None
    user_id: int | None
    is_active: bool
    roles: list[str]            # role codes přiřazené přes user_roles
    legacy_role: str | None     # hodnota z `X-AKENG-Role` / `erp_users.role`
    permissions: list[str]      # výsledné kódy oprávnění (union přes role)
    has_full_access: bool       # true pokud `admin_access` je v permissions


# -----------------------------------------------------------------------------
# Helpers
# -----------------------------------------------------------------------------


def _user_to_out(db: Session, u: ErpUser) -> UserOut:
    role_rows = db.execute(
        select(Role.code)
        .join(UserRole, UserRole.role_id == Role.id)
        .where(UserRole.user_id == u.id)
    ).all()
    return UserOut(
        id=u.id,
        username=u.username,
        display_name=u.display_name,
        is_active=bool(u.is_active if u.is_active is not None else True),
        role_legacy=u.role,
        chip_code=u.chip_code,
        note=u.note,
        created_at=u.created_at,
        roles=[r[0] for r in role_rows],
    )


def _assign_roles(db: Session, user_id: int, role_codes: list[str]) -> None:
    wanted = [c.strip() for c in role_codes if c and c.strip()]
    if wanted:
        role_rows = db.scalars(select(Role).where(Role.code.in_(wanted))).all()
        found_codes = {r.code for r in role_rows}
        missing = [c for c in wanted if c not in found_codes]
        if missing:
            raise HTTPException(status_code=400, detail=f"Neznámé role: {missing}")
        role_id_by_code = {r.code: r.id for r in role_rows}
    else:
        role_id_by_code = {}

    db.execute(delete(UserRole).where(UserRole.user_id == user_id))
    for code in wanted:
        db.add(UserRole(user_id=user_id, role_id=role_id_by_code[code]))


# -----------------------------------------------------------------------------
# Endpoints
# -----------------------------------------------------------------------------


@router.get("/users/me", response_model=MeOut)
def get_me(
    db: Session = Depends(get_db),
    actor: str | None = Depends(get_effective_actor),
    role: str | None = Depends(get_effective_role),
) -> MeOut:
    """Vrací informace o aktuálním uživateli pro gating UI.

    Pravidla:
    - Pokud `X-AKENG-Actor` odpovídá `erp_users.username` → použijeme role z DB.
    - Jinak fallback na `X-AKENG-Role` (legacy).
    - Když není ani jedno, vracíme prázdný objekt — UI pak jede v „pilot" režimu
      (vše povoleno) podle `resolve_permissions_for_request`.
    """
    resolution = resolve_permissions_for_request(db, actor=actor, legacy_role=role)
    user = resolution.user
    return MeOut(
        actor=actor,
        username=user.username if user else None,
        display_name=user.display_name if user else None,
        user_id=user.id if user else None,
        is_active=bool(user.is_active) if user else True,
        roles=sorted(resolution.role_codes),
        legacy_role=role,
        permissions=sorted(resolution.permissions),
        has_full_access=resolution.has_full_access,
    )


@router.get("/users", response_model=list[UserOut])
def list_users(
    db: Session = Depends(get_db),
    _=Depends(require_action("read_users")),
) -> list[UserOut]:
    users = db.scalars(select(ErpUser).order_by(ErpUser.username)).all()
    return [_user_to_out(db, u) for u in users]


@router.post("/users", response_model=UserOut, status_code=201)
def create_user(
    payload: UserCreate,
    db: Session = Depends(get_db),
    _=Depends(require_action("edit_users")),
) -> UserOut:
    username = payload.username.strip()
    if not username:
        raise HTTPException(status_code=400, detail="Uživatelské jméno je povinné.")
    if db.scalar(select(ErpUser.id).where(ErpUser.username == username)) is not None:
        raise HTTPException(status_code=409, detail="Uživatel s tímto jménem již existuje.")
    u = ErpUser(
        username=username,
        display_name=(payload.display_name or None),
        is_active=bool(payload.is_active),
        chip_code=(payload.chip_code or None),
        note=(payload.note or None),
        role=(payload.role_legacy or "Obchod"),
    )
    db.add(u)
    db.flush()
    _assign_roles(db, u.id, payload.role_codes)
    db.commit()
    db.refresh(u)
    return _user_to_out(db, u)


@router.put("/users/{user_id}", response_model=UserOut)
def update_user(
    user_id: int,
    payload: UserUpdate,
    db: Session = Depends(get_db),
    _=Depends(require_action("edit_users")),
) -> UserOut:
    u = db.get(ErpUser, user_id)
    if u is None:
        raise HTTPException(status_code=404, detail="Uživatel nenalezen.")
    if payload.display_name is not None:
        u.display_name = payload.display_name or None
    if payload.is_active is not None:
        u.is_active = bool(payload.is_active)
    if payload.chip_code is not None:
        u.chip_code = payload.chip_code or None
    if payload.note is not None:
        u.note = payload.note or None
    if payload.role_legacy is not None:
        u.role = payload.role_legacy or u.role
    db.commit()
    db.refresh(u)
    return _user_to_out(db, u)


@router.put("/users/{user_id}/roles", response_model=UserOut)
def assign_user_roles(
    user_id: int,
    payload: UserRolesAssign,
    db: Session = Depends(get_db),
    _=Depends(require_action("edit_users")),
) -> UserOut:
    u = db.get(ErpUser, user_id)
    if u is None:
        raise HTTPException(status_code=404, detail="Uživatel nenalezen.")
    _assign_roles(db, u.id, payload.role_codes)
    db.commit()
    db.refresh(u)
    return _user_to_out(db, u)


@router.delete("/users/{user_id}", status_code=200)
def delete_user(
    user_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_action("delete_users")),
) -> dict[str, Any]:
    u = db.get(ErpUser, user_id)
    if u is None:
        raise HTTPException(status_code=404, detail="Uživatel nenalezen.")
    db.execute(delete(UserRole).where(UserRole.user_id == u.id))
    db.delete(u)
    db.commit()
    return {"ok": True, "id": user_id}


@router.post("/users/{user_id}/password", status_code=200)
def set_user_password(
    user_id: int,
    payload: UserPasswordSet,
    db: Session = Depends(get_db),
    _=Depends(require_action("edit_users")),
) -> dict[str, Any]:
    """Admin-side nastavení hesla uživatele.

    Endpoint neověřuje staré heslo (na to je `/auth/password`) a je určen
    pro správu knihovny uživatelů (reset hesla, bootstrap pro nové
    uživatele). Stávající aktivní sessions uživatele zůstávají funkční.
    """
    u = db.get(ErpUser, user_id)
    if u is None:
        raise HTTPException(status_code=404, detail="Uživatel nenalezen.")
    u.password_hash = hash_password(payload.password)
    db.commit()
    return {"ok": True, "id": user_id}


@router.get("/roles", response_model=list[RoleOut])
def list_roles(db: Session = Depends(get_db)) -> list[RoleOut]:
    roles = db.scalars(select(Role).order_by(Role.name)).all()
    out: list[RoleOut] = []
    for r in roles:
        perm_rows = db.execute(
            select(Permission.code)
            .join(RolePermission, RolePermission.permission_id == Permission.id)
            .where(RolePermission.role_id == r.id)
            .order_by(Permission.code)
        ).all()
        out.append(
            RoleOut(
                id=r.id,
                code=r.code,
                name=r.name,
                description=r.description,
                is_system=bool(r.is_system),
                permissions=[row[0] for row in perm_rows],
            )
        )
    return out


@router.get("/permissions", response_model=list[PermissionOut])
def list_permissions(db: Session = Depends(get_db)) -> list[PermissionOut]:
    perms = db.scalars(select(Permission).order_by(Permission.category, Permission.code)).all()
    return [
        PermissionOut(id=p.id, code=p.code, description=p.description, category=p.category)
        for p in perms
    ]
