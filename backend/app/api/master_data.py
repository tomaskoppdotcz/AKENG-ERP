from __future__ import annotations

import logging
import secrets
from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, field_validator, model_validator
from sqlalchemy import func, or_, select, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session
from sqlalchemy import inspect as sa_inspect

from app.core.database import get_db, engine
from app.models.kiosk import Employee, KioskActivityLog, KioskSession, OperationEvent
from app.models.work_report import WorkReport
from app.models.master_data import EmployeeSubgroup, Machine
from app.services.cz_card_reader_normalize import normalize_czech_keyboard_reader_numeric
from app.services.employee_credential import NO_PHYSICAL_CARD_PREFIX, find_employee_by_credential
from app.services.employee_pin import hash_pin

router = APIRouter()
logger = logging.getLogger(__name__)

DEFAULT_SUBGROUPS: list[tuple[str, int]] = [
    ("Operátor", 10),
    ("Seřizovač", 20),
    ("Kontrola", 30),
    ("Expedice", 40),
    ("Administrativa", 50),
    ("Vedoucí výroby", 60),
]


def ensure_employees_sqlite_schema(engine_: Engine) -> None:
    """Migrace employee_subgroups + rozšíření employees (SQLite i ostatní drivery)."""
    try:
        url = str(engine_.url)
    except Exception:
        return
    is_sqlite = url.startswith("sqlite")
    insp = sa_inspect(engine_)
    tables = insp.get_table_names()

    with engine_.begin() as conn:
        if "employee_subgroups" not in tables and is_sqlite:
            conn.execute(
                text(
                    """
                    CREATE TABLE employee_subgroups (
                        id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
                        name VARCHAR(100) NOT NULL UNIQUE,
                        sort_order INTEGER NOT NULL DEFAULT 0,
                        is_active BOOLEAN NOT NULL DEFAULT 1
                    )
                    """
                )
            )
            conn.execute(text("CREATE INDEX ix_employee_subgroups_name ON employee_subgroups (name)"))

        if "employees" not in tables:
            return

        bool_def = "INTEGER NOT NULL DEFAULT 1" if is_sqlite else "BOOLEAN NOT NULL DEFAULT TRUE"
        float_type = "FLOAT" if is_sqlite else "DOUBLE PRECISION"

        cols = {c["name"] for c in sa_inspect(engine_).get_columns("employees")}
        alters: list[tuple[str, str]] = [
            ("first_name", "ALTER TABLE employees ADD COLUMN first_name VARCHAR(100)"),
            ("last_name", "ALTER TABLE employees ADD COLUMN last_name VARCHAR(100)"),
            ("employee_subgroup_id", "ALTER TABLE employees ADD COLUMN employee_subgroup_id INTEGER"),
            ("chip_card_uid", "ALTER TABLE employees ADD COLUMN chip_card_uid VARCHAR(100)"),
            ("pin_hash", "ALTER TABLE employees ADD COLUMN pin_hash VARCHAR(255)"),
            ("scan_code", "ALTER TABLE employees ADD COLUMN scan_code VARCHAR(64)"),
            ("phone", "ALTER TABLE employees ADD COLUMN phone VARCHAR(40)"),
            ("email", "ALTER TABLE employees ADD COLUMN email VARCHAR(255)"),
            ("street", "ALTER TABLE employees ADD COLUMN street VARCHAR(255)"),
            ("city", "ALTER TABLE employees ADD COLUMN city VARCHAR(120)"),
            ("postal_code", "ALTER TABLE employees ADD COLUMN postal_code VARCHAR(20)"),
            ("country", "ALTER TABLE employees ADD COLUMN country VARCHAR(80)"),
            ("birth_date", "ALTER TABLE employees ADD COLUMN birth_date DATE"),
            ("job_title", "ALTER TABLE employees ADD COLUMN job_title VARCHAR(120)"),
            ("can_use_kiosk", f"ALTER TABLE employees ADD COLUMN can_use_kiosk {bool_def}"),
            ("cost_rate_per_hour", f"ALTER TABLE employees ADD COLUMN cost_rate_per_hour {float_type}"),
            ("note", "ALTER TABLE employees ADD COLUMN note TEXT"),
        ]
        for colname, stmt in alters:
            if colname in cols:
                continue
            try:
                conn.execute(text(stmt))
                cols.add(colname)
            except Exception:
                logger.exception("ensure_employees_schema: add column %s", colname)

        try:
            conn.execute(
                text(
                    """
                    UPDATE employees SET chip_card_uid = card_uid
                    WHERE chip_card_uid IS NULL AND card_uid IS NOT NULL
                    AND card_uid NOT LIKE :sentinel
                    """
                ),
                {"sentinel": f"{NO_PHYSICAL_CARD_PREFIX}%"},
            )
        except Exception:
            logger.exception("backfill chip_card_uid")

        for idx_sql in (
            "CREATE INDEX IF NOT EXISTS ix_employees_employee_subgroup_id ON employees (employee_subgroup_id)",
            "CREATE UNIQUE INDEX IF NOT EXISTS ix_employees_chip_card_uid ON employees (chip_card_uid)",
            "CREATE UNIQUE INDEX IF NOT EXISTS ix_employees_scan_code ON employees (scan_code)",
        ):
            try:
                conn.execute(text(idx_sql))
            except Exception:
                logger.debug("index employees skip: %s", idx_sql, exc_info=True)


_DEFAULT_NON_PLANNABLE_MACHINE_CODES = (
    "PRACKA",
    "MEZIOPERACNI_KONTROLA",
    "VYSTUPNI_KONTROLA",
    "EXPEDICE",
    "BALENI",
    "PRIJEM_SKLAD",
    "VYDEJ_SKLAD",
)


def ensure_machines_planner_visibility_schema(engine_: Engine) -> None:
    """Přidá sloupec is_plannable na machines (Planner Gantt řádky)."""
    try:
        url = str(engine_.url)
    except Exception:
        return
    insp = sa_inspect(engine_)
    if "machines" not in insp.get_table_names():
        return
    cols = {c["name"] for c in insp.get_columns("machines")}
    if "is_plannable" in cols:
        return
    with engine_.begin() as conn:
        if url.startswith("sqlite"):
            conn.execute(
                text("ALTER TABLE machines ADD COLUMN is_plannable INTEGER NOT NULL DEFAULT 1")
            )
        else:
            conn.execute(
                text("ALTER TABLE machines ADD COLUMN is_plannable BOOLEAN NOT NULL DEFAULT TRUE")
            )
        placeholders = ", ".join(f":c{i}" for i in range(len(_DEFAULT_NON_PLANNABLE_MACHINE_CODES)))
        params = {f"c{i}": code for i, code in enumerate(_DEFAULT_NON_PLANNABLE_MACHINE_CODES)}
        conn.execute(
            text(
                f"UPDATE machines SET is_plannable = 0 "
                f"WHERE UPPER(TRIM(machine_code)) IN ({placeholders})"
            ),
            params,
        )


def ensure_machines_workplace_library_fk_schema(engine_: Engine) -> None:
    """Sloupec machines.workplace_library_item_id → kanonické pracoviště z knihovny."""
    try:
        url = str(engine_.url)
    except Exception:
        return
    insp = sa_inspect(engine_)
    if "machines" not in insp.get_table_names():
        return
    cols = {c["name"] for c in insp.get_columns("machines")}
    if "workplace_library_item_id" in cols:
        return
    with engine_.begin() as conn:
        if url.startswith("sqlite"):
            conn.execute(text("ALTER TABLE machines ADD COLUMN workplace_library_item_id INTEGER"))
        else:
            conn.execute(text("ALTER TABLE machines ADD COLUMN workplace_library_item_id INTEGER NULL"))


def ensure_planning_operations_workplace_library_fk_schema(engine_: Engine) -> None:
    """Sloupec planning_operations.workplace_library_item_id (denormalizace pro plánovač)."""
    try:
        url = str(engine_.url)
    except Exception:
        return
    insp = sa_inspect(engine_)
    if "planning_operations" not in insp.get_table_names():
        return
    cols = {c["name"] for c in insp.get_columns("planning_operations")}
    if "workplace_library_item_id" in cols:
        return
    with engine_.begin() as conn:
        if url.startswith("sqlite"):
            conn.execute(text("ALTER TABLE planning_operations ADD COLUMN workplace_library_item_id INTEGER"))
        else:
            conn.execute(text("ALTER TABLE planning_operations ADD COLUMN workplace_library_item_id INTEGER NULL"))


def backfill_planner_resource_links(db: Session) -> None:
    """Migrace FK pracovišť + kotvy strojů (viz planner_resource_migration)."""
    from app.services.planner_resource_migration import run_planner_resource_migrations

    try:
        run_planner_resource_migrations(db)
        db.commit()
    except Exception:
        logger.exception("run_planner_resource_migrations")
        db.rollback()


def seed_employee_subgroups_if_empty(db: Session) -> None:
    cnt = db.scalar(select(func.count()).select_from(EmployeeSubgroup)) or 0
    if int(cnt) > 0:
        return
    for name, so in DEFAULT_SUBGROUPS:
        db.add(EmployeeSubgroup(name=name, sort_order=so, is_active=True))
    db.commit()


def _full_name(first: str | None, last: str | None, fallback: str) -> str:
    fn = (first or "").strip()
    ln = (last or "").strip()
    if fn or ln:
        return f"{fn} {ln}".strip()
    return (fallback or "").strip() or "Neznámý"


# --- Employee subgroups (knihovna Zaměstnanci / role) ---------------------------
class EmployeeSubgroupPayload(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    sort_order: int = 0
    is_active: bool = True


class EmployeeSubgroupOut(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    name: str
    sort_order: int
    is_active: bool


@router.get("/employee-subgroups", response_model=list[EmployeeSubgroupOut])
def list_employee_subgroups(db: Session = Depends(get_db)):
    rows = db.scalars(
        select(EmployeeSubgroup).order_by(EmployeeSubgroup.sort_order.asc(), EmployeeSubgroup.id.asc())
    ).all()
    return rows


@router.post("/employee-subgroups", response_model=EmployeeSubgroupOut)
def create_employee_subgroup(payload: EmployeeSubgroupPayload, db: Session = Depends(get_db)):
    ex = db.scalar(select(EmployeeSubgroup).where(EmployeeSubgroup.name == payload.name.strip()))
    if ex:
        raise HTTPException(status_code=409, detail="Role se stejným názvem už existuje.")
    row = EmployeeSubgroup(
        name=payload.name.strip(),
        sort_order=int(payload.sort_order),
        is_active=payload.is_active,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.put("/employee-subgroups/{subgroup_id}", response_model=EmployeeSubgroupOut)
def update_employee_subgroup(subgroup_id: int, payload: EmployeeSubgroupPayload, db: Session = Depends(get_db)):
    row = db.get(EmployeeSubgroup, subgroup_id)
    if not row:
        raise HTTPException(status_code=404, detail="Role nebyla nalezena.")
    name = payload.name.strip()
    if name != row.name:
        ex = db.scalar(select(EmployeeSubgroup).where(EmployeeSubgroup.name == name))
        if ex and int(ex.id) != int(subgroup_id):
            raise HTTPException(status_code=409, detail="Role se stejným názvem už existuje.")
    row.name = name
    row.sort_order = int(payload.sort_order)
    row.is_active = payload.is_active
    db.commit()
    db.refresh(row)
    return row


# --- Employees ----------------------------------------------------------------
def _strip_opt(v: str | None, max_len: int | None = None) -> str | None:
    if v is None:
        return None
    s = v.strip()
    if not s:
        return None
    if max_len is not None:
        s = s[:max_len]
    return s


def _normalize_reader_token(v: str | None, max_len: int | None = None) -> str | None:
    """Čip / sken z čtečky: nejdřív CZ mapování číslic, pak ořez."""
    if v is None:
        return None
    s = v.strip()
    if not s:
        return None
    n = normalize_czech_keyboard_reader_numeric(s)
    if max_len is not None and len(n) > max_len:
        return n[:max_len]
    return n


def _login_token_conflict(db: Session, token: str, *, exclude_id: int | None) -> bool:
    """Kiosk tokens (čip / karta / sken) nesmí kolidovat napříč sloupci."""
    if not token:
        return False
    uc = token.upper()
    stmt = select(Employee.id).where(
        or_(
            func.upper(Employee.chip_card_uid) == uc,
            func.upper(Employee.scan_code) == uc,
            func.upper(Employee.card_uid) == uc,
        )
    )
    if exclude_id is not None:
        stmt = stmt.where(Employee.id != exclude_id)
    return db.scalar(stmt) is not None


def _employee_has_references(db: Session, employee_id: int) -> bool:
    for model, col in (
        (OperationEvent, OperationEvent.employee_id),
        (KioskSession, KioskSession.employee_id),
        (KioskActivityLog, KioskActivityLog.employee_id),
        (WorkReport, WorkReport.employee_id),
    ):
        n = db.scalar(select(func.count()).select_from(model).where(col == employee_id)) or 0
        if int(n) > 0:
            return True
    return False


def _subgroup_name(db: Session, subgroup_id: int | None) -> str | None:
    if subgroup_id is None:
        return None
    sg = db.get(EmployeeSubgroup, int(subgroup_id))
    return sg.name if sg else None


def _employee_login_flags(row: Employee) -> tuple[bool, bool, bool]:
    has_chip = bool(row.chip_card_uid) or (
        bool(row.card_uid) and not str(row.card_uid).startswith(NO_PHYSICAL_CARD_PREFIX)
    )
    has_pin = bool(row.pin_hash)
    has_scan = bool(row.scan_code)
    return has_chip, has_pin, has_scan


def _card_uid_public(row: Employee) -> str | None:
    if row.card_uid and not str(row.card_uid).startswith(NO_PHYSICAL_CARD_PREFIX):
        return row.card_uid
    return None


def _employee_to_out(db: Session, row: Employee) -> "EmployeeOut":
    fn = _full_name(row.first_name, row.last_name, row.name)
    has_chip, has_pin, has_scan = _employee_login_flags(row)
    return EmployeeOut(
        id=int(row.id),
        employee_code=row.employee_code,
        first_name=row.first_name,
        last_name=row.last_name,
        full_name=fn,
        name=fn,
        phone=row.phone,
        email=row.email,
        street=row.street,
        city=row.city,
        postal_code=row.postal_code,
        country=row.country,
        birth_date=row.birth_date,
        job_title=row.job_title,
        is_active=bool(row.is_active),
        can_use_kiosk=bool(row.can_use_kiosk),
        cost_rate_per_hour=row.cost_rate_per_hour,
        note=row.note,
        chip_card_uid=row.chip_card_uid,
        card_uid=_card_uid_public(row),
        scan_code=row.scan_code,
        pin_is_set=bool(row.pin_hash),
        has_chip_login=has_chip,
        has_pin_login=has_pin,
        has_scan_login=has_scan,
        employee_subgroup_id=row.employee_subgroup_id,
        subgroup_name=_subgroup_name(db, row.employee_subgroup_id),
    )


def _effective_chip(payload: "EmployeePayload") -> str | None:
    return _normalize_reader_token(payload.chip_card_uid, 100) or _normalize_reader_token(
        payload.card_uid, 100
    )


class EmployeePayload(BaseModel):
    first_name: str = Field(..., min_length=1, max_length=100)
    last_name: str = Field(..., min_length=1, max_length=100)
    employee_code: str = Field(..., min_length=1, max_length=50)
    chip_card_uid: str | None = Field(None, max_length=100)
    card_uid: str | None = Field(None, max_length=100, description="Zastaralé — mapuje se na chip_card_uid.")
    scan_code: str | None = Field(None, max_length=64)
    pin_code: str | None = Field(None, min_length=4, max_length=20)
    clear_pin: bool = False
    phone: str | None = Field(None, max_length=40)
    email: str | None = Field(None, max_length=255)
    street: str | None = Field(None, max_length=255)
    city: str | None = Field(None, max_length=120)
    postal_code: str | None = Field(None, max_length=20)
    country: str | None = Field(None, max_length=80)
    birth_date: date | None = None
    job_title: str | None = Field(None, max_length=120)
    employee_subgroup_id: int | None = None
    is_active: bool = True
    can_use_kiosk: bool = True
    cost_rate_per_hour: float | None = None
    note: str | None = None

    @field_validator(
        "chip_card_uid",
        "card_uid",
        "scan_code",
        "phone",
        "email",
        "street",
        "city",
        "postal_code",
        "country",
        "job_title",
        "note",
        mode="before",
    )
    @classmethod
    def _blank_to_none(cls, v: object) -> object:
        if v is None:
            return None
        if isinstance(v, str) and not v.strip():
            return None
        return v

    @field_validator("pin_code", mode="before")
    @classmethod
    def _pin_blank(cls, v: object) -> object:
        if v is None or (isinstance(v, str) and not str(v).strip()):
            return None
        return v

    @model_validator(mode="after")
    def _normalize_reader_fields(self):
        """Čip / sken: vždy do DB jako normalizované číslice (CZ klávesnice čtečky)."""

        def norm(val: str | None, max_len: int) -> str | None:
            if val is None:
                return None
            s = val.strip()
            if not s:
                return None
            n = normalize_czech_keyboard_reader_numeric(s)
            if len(n) > max_len:
                n = n[:max_len]
            return n or None

        return self.model_copy(
            update={
                "chip_card_uid": norm(self.chip_card_uid, 100),
                "card_uid": norm(self.card_uid, 100),
                "scan_code": norm(self.scan_code, 64),
            }
        )


class EmployeeOut(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    employee_code: str
    first_name: str | None
    last_name: str | None
    full_name: str
    name: str
    phone: str | None
    email: str | None
    street: str | None
    city: str | None
    postal_code: str | None
    country: str | None
    birth_date: date | None
    job_title: str | None
    is_active: bool
    can_use_kiosk: bool
    cost_rate_per_hour: float | None
    note: str | None
    chip_card_uid: str | None
    card_uid: str | None
    scan_code: str | None
    pin_is_set: bool
    has_chip_login: bool
    has_pin_login: bool
    has_scan_login: bool
    employee_subgroup_id: int | None
    subgroup_name: str | None


class EmployeeActivePayload(BaseModel):
    is_active: bool


@router.get("/employees/lookup", response_model=EmployeeOut)
def lookup_employee_for_kiosk(
    chip_uid: str | None = None,
    scan_code: str | None = None,
    employee_code: str | None = None,
    db: Session = Depends(get_db),
):
    """Vyhledání aktivního zaměstnance podle přihlašovacího tokenu (příprava pro kiosk)."""
    cred = _strip_opt(chip_uid) or _strip_opt(scan_code) or _strip_opt(employee_code)
    if not cred:
        raise HTTPException(status_code=422, detail="Zadejte chip_uid, scan_code nebo employee_code.")
    row = find_employee_by_credential(db, cred, require_active=True, require_kiosk=True)
    if not row:
        raise HTTPException(status_code=404, detail="Zaměstnanec nebyl nalezen.")
    return _employee_to_out(db, row)


@router.get("/employees", response_model=list[EmployeeOut])
def list_employees(
    active_filter: str | None = Query(
        default=None,
        alias="active",
        description="active | inactive — bez parametru všechny záznamy",
    ),
    db: Session = Depends(get_db),
):
    stmt = select(Employee).order_by(Employee.id.asc())
    if active_filter == "active":
        stmt = stmt.where(Employee.is_active.is_(True))
    elif active_filter == "inactive":
        stmt = stmt.where(Employee.is_active.is_(False))
    rows = db.scalars(stmt).all()
    return [_employee_to_out(db, r) for r in rows]


@router.get("/employees/{employee_id}", response_model=EmployeeOut)
def get_employee(employee_id: int, db: Session = Depends(get_db)):
    row = db.get(Employee, employee_id)
    if not row:
        raise HTTPException(status_code=404, detail="Zaměstnanec nebyl nalezen.")
    return _employee_to_out(db, row)


@router.post("/employees", response_model=EmployeeOut)
def create_employee(payload: EmployeePayload, db: Session = Depends(get_db)):
    code = payload.employee_code.strip()
    if db.scalar(select(Employee).where(func.lower(Employee.employee_code) == code.lower())):
        raise HTTPException(status_code=409, detail="Kód zaměstnance už existuje.")
    if payload.employee_subgroup_id is not None:
        if not db.get(EmployeeSubgroup, int(payload.employee_subgroup_id)):
            raise HTTPException(status_code=422, detail="Neplatná role (subgroup).")

    chip = _effective_chip(payload)
    scan = _normalize_reader_token(payload.scan_code, 64)
    if chip and _login_token_conflict(db, chip, exclude_id=None):
        raise HTTPException(status_code=409, detail="Hodnota čipu/karty už je použita u jiného zaměstnance.")
    if scan and _login_token_conflict(db, scan, exclude_id=None):
        raise HTTPException(status_code=409, detail="Skenovací kód už je použit u jiného zaměstnance.")

    display = _full_name(payload.first_name, payload.last_name, "")
    row = Employee(
        employee_code=code,
        first_name=payload.first_name.strip(),
        last_name=payload.last_name.strip(),
        name=display,
        phone=_strip_opt(payload.phone, 40),
        email=_strip_opt(payload.email, 255),
        street=_strip_opt(payload.street, 255),
        city=_strip_opt(payload.city, 120),
        postal_code=_strip_opt(payload.postal_code, 20),
        country=_strip_opt(payload.country, 80),
        birth_date=payload.birth_date,
        job_title=_strip_opt(payload.job_title, 120),
        employee_subgroup_id=payload.employee_subgroup_id,
        is_active=payload.is_active,
        can_use_kiosk=payload.can_use_kiosk,
        cost_rate_per_hour=payload.cost_rate_per_hour,
        note=_strip_opt(payload.note),
        updated_at=datetime.utcnow(),
    )
    if payload.clear_pin and payload.pin_code:
        raise HTTPException(status_code=422, detail="Nelze současně nastavit PIN a smazat PIN.")
    if payload.clear_pin:
        row.pin_hash = None
    elif payload.pin_code:
        row.pin_hash = hash_pin(payload.pin_code)
    else:
        row.pin_hash = None

    if chip:
        row.chip_card_uid = chip
        row.card_uid = chip
    else:
        row.chip_card_uid = None
        row.card_uid = f"{NO_PHYSICAL_CARD_PREFIX}{secrets.token_hex(10)}"

    row.scan_code = scan
    db.add(row)
    db.commit()
    db.refresh(row)
    return _employee_to_out(db, row)


@router.put("/employees/{employee_id}", response_model=EmployeeOut)
def update_employee(employee_id: int, payload: EmployeePayload, db: Session = Depends(get_db)):
    row = db.get(Employee, employee_id)
    if not row:
        raise HTTPException(status_code=404, detail="Zaměstnanec nebyl nalezen.")

    code = payload.employee_code.strip()
    ex1 = db.scalar(
        select(Employee).where(func.lower(Employee.employee_code) == code.lower()).where(Employee.id != employee_id)
    )
    if ex1:
        raise HTTPException(status_code=409, detail="Kód zaměstnance už existuje.")
    if payload.employee_subgroup_id is not None:
        if not db.get(EmployeeSubgroup, int(payload.employee_subgroup_id)):
            raise HTTPException(status_code=422, detail="Neplatná role (subgroup).")

    chip = _effective_chip(payload)
    scan = _normalize_reader_token(payload.scan_code, 64)
    if chip and _login_token_conflict(db, chip, exclude_id=employee_id):
        raise HTTPException(status_code=409, detail="Hodnota čipu/karty už je použita u jiného zaměstnance.")
    if scan and _login_token_conflict(db, scan, exclude_id=employee_id):
        raise HTTPException(status_code=409, detail="Skenovací kód už je použit u jiného zaměstnance.")

    if payload.clear_pin and payload.pin_code:
        raise HTTPException(status_code=422, detail="Nelze současně nastavit PIN a smazat PIN.")
    if payload.clear_pin:
        row.pin_hash = None
    elif payload.pin_code:
        row.pin_hash = hash_pin(payload.pin_code)

    if chip:
        row.chip_card_uid = chip
        row.card_uid = chip
    else:
        row.chip_card_uid = None
        row.card_uid = f"{NO_PHYSICAL_CARD_PREFIX}{secrets.token_hex(10)}"

    row.scan_code = scan
    row.first_name = payload.first_name.strip()
    row.last_name = payload.last_name.strip()
    row.name = _full_name(row.first_name, row.last_name, row.name)
    row.employee_code = code
    row.phone = _strip_opt(payload.phone, 40)
    row.email = _strip_opt(payload.email, 255)
    row.street = _strip_opt(payload.street, 255)
    row.city = _strip_opt(payload.city, 120)
    row.postal_code = _strip_opt(payload.postal_code, 20)
    row.country = _strip_opt(payload.country, 80)
    row.birth_date = payload.birth_date
    row.job_title = _strip_opt(payload.job_title, 120)
    row.employee_subgroup_id = payload.employee_subgroup_id
    row.is_active = payload.is_active
    row.can_use_kiosk = payload.can_use_kiosk
    row.cost_rate_per_hour = payload.cost_rate_per_hour
    row.note = _strip_opt(payload.note)
    row.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(row)
    return _employee_to_out(db, row)


@router.patch("/employees/{employee_id}/active", response_model=EmployeeOut)
def patch_employee_active(employee_id: int, payload: EmployeeActivePayload, db: Session = Depends(get_db)):
    row = db.get(Employee, employee_id)
    if not row:
        raise HTTPException(status_code=404, detail="Zaměstnanec nebyl nalezen.")
    row.is_active = bool(payload.is_active)
    row.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(row)
    return _employee_to_out(db, row)


@router.delete("/employees/{employee_id}")
def delete_employee(employee_id: int, db: Session = Depends(get_db)):
    row = db.get(Employee, employee_id)
    if not row:
        raise HTTPException(status_code=404, detail="Zaměstnanec nebyl nalezen.")
    if _employee_has_references(db, employee_id):
        row.is_active = False
        row.updated_at = datetime.utcnow()
        db.commit()
        return {
            "status": "soft_deleted",
            "detail": "Zaměstnanec má vazby v historii — pouze deaktivace.",
        }
    db.delete(row)
    db.commit()
    return {"status": "deleted"}


@router.get("/machines")
def list_machines(db: Session = Depends(get_db)):
    return list(db.scalars(select(Machine).order_by(Machine.id)).all())


class MachinePlannerVisibilityPayload(BaseModel):
    is_plannable: bool


@router.patch("/machines/{machine_id}/planner-visibility")
def patch_machine_planner_visibility(
    machine_id: int, payload: MachinePlannerVisibilityPayload, db: Session = Depends(get_db)
):
    row = db.get(Machine, machine_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Stroj nenalezen.")
    row.is_plannable = bool(payload.is_plannable)
    db.commit()
    db.refresh(row)
    return row


def run_master_data_startup(db: Session) -> None:
    ensure_employees_sqlite_schema(engine)
    ensure_machines_planner_visibility_schema(engine)
    ensure_machines_workplace_library_fk_schema(engine)
    ensure_planning_operations_workplace_library_fk_schema(engine)
    seed_employee_subgroups_if_empty(db)
    try:
        backfill_planner_resource_links(db)
    except Exception:
        logger.exception("backfill_planner_resource_links")
