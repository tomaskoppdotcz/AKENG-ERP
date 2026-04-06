from __future__ import annotations

import logging
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session
from sqlalchemy import inspect as sa_inspect

from app.core.database import get_db, engine
from app.models.kiosk import Employee
from app.models.master_data import EmployeeSubgroup, Machine

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
    """SQLite: tabulka employee_subgroups + nové sloupce employees."""
    try:
        url = str(engine_.url)
    except Exception:
        return
    if not url.startswith("sqlite"):
        return

    insp = sa_inspect(engine_)
    tables = insp.get_table_names()

    with engine_.begin() as conn:
        if "employee_subgroups" not in tables:
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

        if "employees" in tables:
            cols = {c["name"] for c in insp.get_columns("employees")}
            if "first_name" not in cols:
                conn.execute(text("ALTER TABLE employees ADD COLUMN first_name VARCHAR(100)"))
            if "last_name" not in cols:
                conn.execute(text("ALTER TABLE employees ADD COLUMN last_name VARCHAR(100)"))
            if "employee_subgroup_id" not in cols:
                conn.execute(text("ALTER TABLE employees ADD COLUMN employee_subgroup_id INTEGER"))
                conn.execute(
                    text(
                        "CREATE INDEX IF NOT EXISTS ix_employees_employee_subgroup_id "
                        "ON employees (employee_subgroup_id)"
                    )
                )


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
class EmployeePayload(BaseModel):
    first_name: str = Field(..., min_length=1, max_length=100)
    last_name: str = Field(..., min_length=1, max_length=100)
    employee_code: str = Field(..., min_length=1, max_length=50)
    card_uid: str = Field(..., min_length=1, max_length=100)
    employee_subgroup_id: int | None = None
    is_active: bool = True


class EmployeeOut(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    first_name: str | None
    last_name: str | None
    name: str
    employee_code: str
    card_uid: str
    employee_subgroup_id: int | None
    subgroup_name: str | None
    is_active: bool


@router.get("/employees", response_model=list[EmployeeOut])
def list_employees(db: Session = Depends(get_db)):
    rows = db.scalars(select(Employee).order_by(Employee.id.asc())).all()
    out: list[EmployeeOut] = []
    for r in rows:
        sg_name = None
        if r.employee_subgroup_id is not None:
            sg = db.get(EmployeeSubgroup, int(r.employee_subgroup_id))
            sg_name = sg.name if sg else None
        out.append(
            EmployeeOut(
                id=int(r.id),
                first_name=r.first_name,
                last_name=r.last_name,
                name=r.name,
                employee_code=r.employee_code,
                card_uid=r.card_uid,
                employee_subgroup_id=r.employee_subgroup_id,
                subgroup_name=sg_name,
                is_active=bool(r.is_active),
            )
        )
    return out


@router.post("/employees", response_model=EmployeeOut)
def create_employee(payload: EmployeePayload, db: Session = Depends(get_db)):
    code = payload.employee_code.strip()
    card = payload.card_uid.strip()
    ex1 = db.scalar(select(Employee).where(Employee.employee_code == code))
    if ex1:
        raise HTTPException(status_code=409, detail="Kód zaměstnance už existuje.")
    ex2 = db.scalar(select(Employee).where(Employee.card_uid == card))
    if ex2:
        raise HTTPException(status_code=409, detail="UID karty už existuje.")
    if payload.employee_subgroup_id is not None:
        sg = db.get(EmployeeSubgroup, int(payload.employee_subgroup_id))
        if not sg:
            raise HTTPException(status_code=422, detail="Neplatná role (subgroup).")

    display = _full_name(payload.first_name, payload.last_name, "")
    row = Employee(
        employee_code=code,
        card_uid=card,
        first_name=payload.first_name.strip(),
        last_name=payload.last_name.strip(),
        name=display,
        employee_subgroup_id=payload.employee_subgroup_id,
        is_active=payload.is_active,
        updated_at=datetime.utcnow(),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    sg_name = None
    if row.employee_subgroup_id is not None:
        sg = db.get(EmployeeSubgroup, int(row.employee_subgroup_id))
        sg_name = sg.name if sg else None
    return EmployeeOut(
        id=int(row.id),
        first_name=row.first_name,
        last_name=row.last_name,
        name=row.name,
        employee_code=row.employee_code,
        card_uid=row.card_uid,
        employee_subgroup_id=row.employee_subgroup_id,
        subgroup_name=sg_name,
        is_active=bool(row.is_active),
    )


@router.put("/employees/{employee_id}", response_model=EmployeeOut)
def update_employee(employee_id: int, payload: EmployeePayload, db: Session = Depends(get_db)):
    row = db.get(Employee, employee_id)
    if not row:
        raise HTTPException(status_code=404, detail="Zaměstnanec nebyl nalezen.")
    code = payload.employee_code.strip()
    card = payload.card_uid.strip()
    ex1 = db.scalar(select(Employee).where(Employee.employee_code == code))
    if ex1 and int(ex1.id) != int(employee_id):
        raise HTTPException(status_code=409, detail="Kód zaměstnance už existuje.")
    ex2 = db.scalar(select(Employee).where(Employee.card_uid == card))
    if ex2 and int(ex2.id) != int(employee_id):
        raise HTTPException(status_code=409, detail="UID karty už existuje.")
    if payload.employee_subgroup_id is not None:
        sg = db.get(EmployeeSubgroup, int(payload.employee_subgroup_id))
        if not sg:
            raise HTTPException(status_code=422, detail="Neplatná role (subgroup).")

    row.first_name = payload.first_name.strip()
    row.last_name = payload.last_name.strip()
    row.name = _full_name(row.first_name, row.last_name, row.name)
    row.employee_code = code
    row.card_uid = card
    row.employee_subgroup_id = payload.employee_subgroup_id
    row.is_active = payload.is_active
    row.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(row)
    sg_name = None
    if row.employee_subgroup_id is not None:
        sg = db.get(EmployeeSubgroup, int(row.employee_subgroup_id))
        sg_name = sg.name if sg else None
    return EmployeeOut(
        id=int(row.id),
        first_name=row.first_name,
        last_name=row.last_name,
        name=row.name,
        employee_code=row.employee_code,
        card_uid=row.card_uid,
        employee_subgroup_id=row.employee_subgroup_id,
        subgroup_name=sg_name,
        is_active=bool(row.is_active),
    )


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
