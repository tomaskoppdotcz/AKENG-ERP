"""Clean master libraries API (operations, workplaces)."""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import inspect as sa_inspect, select, text, update
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.master_libraries import OperationLibraryItem, WorkplaceLibraryItem
from app.models.orders import ProductionOrderOperation
from app.services.workplace_scheduling_anchor import (
    get_or_create_scheduling_machine_for_workplace,
    sync_synthetic_anchor_machine_names_for_workplace,
)

router = APIRouter()


def ensure_master_libraries_sqlite_schema(engine: Engine) -> None:
    """Add missing columns when create_all does not alter existing tables."""
    try:
        url = str(engine.url)
    except Exception:
        return

    insp = sa_inspect(engine)
    if "workplace_library_items" not in insp.get_table_names():
        return

    col_names = {c["name"] for c in insp.get_columns("workplace_library_items")}

    with engine.begin() as conn:
        if "daily_capacity_hours" not in col_names:
            if url.startswith("sqlite"):
                conn.execute(text("ALTER TABLE workplace_library_items ADD COLUMN daily_capacity_hours FLOAT"))
            else:
                conn.execute(text("ALTER TABLE workplace_library_items ADD COLUMN daily_capacity_hours DOUBLE PRECISION"))

    col_names = {c["name"] for c in sa_inspect(engine).get_columns("workplace_library_items")}
    with engine.begin() as conn:
        if "is_plannable" not in col_names:
            if url.startswith("sqlite"):
                conn.execute(
                    text("ALTER TABLE workplace_library_items ADD COLUMN is_plannable INTEGER NOT NULL DEFAULT 1")
                )
            else:
                conn.execute(
                    text(
                        "ALTER TABLE workplace_library_items ADD COLUMN is_plannable BOOLEAN NOT NULL DEFAULT TRUE"
                    )
                )


def _op_to_dict(r: OperationLibraryItem) -> dict:
    return {
        "id": r.id,
        "code": r.code,
        "name": r.name,
        "description": r.description,
        "is_active": r.is_active,
    }


def _wp_to_dict(r: WorkplaceLibraryItem) -> dict:
    return {
        "id": r.id,
        "code": r.code,
        "name": r.name,
        "workplace_type": r.workplace_type,
        "hourly_rate": r.hourly_rate,
        "daily_capacity_hours": r.daily_capacity_hours,
        "is_active": r.is_active,
        "is_plannable": bool(getattr(r, "is_plannable", True)),
    }


def _blank_to_none(v: str | None) -> str | None:
    if v is None:
        return None
    s = v.strip()
    return s if s else None


class OperationLibraryPayload(BaseModel):
    code: str | None = None
    name: str = Field(..., min_length=1)
    description: str | None = None
    is_active: bool = True

    @field_validator("name")
    @classmethod
    def name_stripped(cls, v: str) -> str:
        s = v.strip()
        if not s:
            raise ValueError("Jméno operace je povinné.")
        return s


class WorkplaceLibraryPayload(BaseModel):
    code: str | None = None
    name: str = Field(..., min_length=1)
    workplace_type: str | None = None
    hourly_rate: float | None = None
    daily_capacity_hours: float | None = None
    is_active: bool = True
    is_plannable: bool = True

    @field_validator("name")
    @classmethod
    def name_stripped(cls, v: str) -> str:
        s = v.strip()
        if not s:
            raise ValueError("Název pracoviště je povinný.")
        return s

    @field_validator("hourly_rate", "daily_capacity_hours")
    @classmethod
    def numeric_reasonable(cls, v: float | None) -> float | None:
        if v is None:
            return None
        if v < 0:
            raise ValueError("Číselné hodnoty nesmí být záporné.")
        return v


def seed_master_libraries_demo_data(db: Session) -> None:
    """Idempotent demo seed: fills each table only when it is empty."""
    seeded = False

    if db.scalar(select(OperationLibraryItem.id).limit(1)) is None:
        db.add_all(
            [
                OperationLibraryItem(
                    code="REZ",
                    name="Řezání",
                    description="Řezání polotovaru na výrobní rozměr.",
                    is_active=True,
                ),
                OperationLibraryItem(
                    code="SOU",
                    name="Soustružení",
                    description="Obrábění rotačních ploch na soustruhu.",
                    is_active=True,
                ),
                OperationLibraryItem(
                    code="FRE",
                    name="Frézování",
                    description="Frézování ploch, drážek a tvarů.",
                    is_active=True,
                ),
                OperationLibraryItem(
                    code="BRO",
                    name="Broušení",
                    description="Dokončovací broušení a úprava tolerancí.",
                    is_active=True,
                ),
                OperationLibraryItem(
                    code="VRT",
                    name="Vrtání",
                    description="Vrtání otvorů včetně závitů.",
                    is_active=True,
                ),
                OperationLibraryItem(
                    code="KTR",
                    name="Kontrola",
                    description="Měření a kontrola jakosti.",
                    is_active=True,
                ),
                OperationLibraryItem(
                    code="BAL",
                    name="Balení",
                    description="Ochrana výrobku a příprava k expedici.",
                    is_active=True,
                ),
                OperationLibraryItem(
                    code="ZIN",
                    name="Zinkování",
                    description="Povrchová úprava zinkováním (kooperace / externě).",
                    is_active=True,
                ),
            ]
        )
        seeded = True

    if db.scalar(select(WorkplaceLibraryItem.id).limit(1)) is None:
        db.add_all(
            [
                WorkplaceLibraryItem(
                    code="PILA-01",
                    name="Pila",
                    workplace_type="řezání",
                    hourly_rate=420.0,
                    daily_capacity_hours=8.0,
                    is_active=True,
                ),
                WorkplaceLibraryItem(
                    code="CLX450",
                    name="CLX 450 TC",
                    workplace_type="soustruh",
                    hourly_rate=950.0,
                    daily_capacity_hours=8.0,
                    is_active=True,
                ),
                WorkplaceLibraryItem(
                    code="CTX800",
                    name="CTX Beta 800",
                    workplace_type="soustruh",
                    hourly_rate=1020.0,
                    daily_capacity_hours=8.0,
                    is_active=True,
                ),
                WorkplaceLibraryItem(
                    code="CMX600",
                    name="CMX 600 V",
                    workplace_type="frézka",
                    hourly_rate=880.0,
                    daily_capacity_hours=8.0,
                    is_active=True,
                ),
                WorkplaceLibraryItem(
                    code="NEF400",
                    name="NEF 400",
                    workplace_type="frézka",
                    hourly_rate=760.0,
                    daily_capacity_hours=8.0,
                    is_active=True,
                ),
                WorkplaceLibraryItem(
                    code="KTRL-01",
                    name="Kontrola",
                    workplace_type="kontrola",
                    hourly_rate=680.0,
                    daily_capacity_hours=8.0,
                    is_active=True,
                    is_plannable=False,
                ),
                WorkplaceLibraryItem(
                    code="KOOP-01",
                    name="Kooperace",
                    workplace_type="kooperace",
                    hourly_rate=550.0,
                    daily_capacity_hours=8.0,
                    is_active=True,
                    is_plannable=False,
                ),
            ]
        )
        seeded = True

    if seeded:
        db.commit()


@router.get("/operations")
def list_operation_library_items(db: Session = Depends(get_db)):
    seed_master_libraries_demo_data(db)
    rows = db.scalars(select(OperationLibraryItem).order_by(OperationLibraryItem.name.asc())).all()
    return [_op_to_dict(r) for r in rows]


@router.post("/operations")
def create_operation_library_item(payload: OperationLibraryPayload, db: Session = Depends(get_db)):
    row = OperationLibraryItem(
        code=_blank_to_none(payload.code),
        name=payload.name,
        description=_blank_to_none(payload.description),
        is_active=payload.is_active,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _op_to_dict(row)


@router.put("/operations/{operation_id}")
def update_operation_library_item(
    operation_id: int,
    payload: OperationLibraryPayload,
    db: Session = Depends(get_db),
):
    row = db.scalar(select(OperationLibraryItem).where(OperationLibraryItem.id == operation_id))
    if not row:
        raise HTTPException(status_code=404, detail="Operation library item not found")
    row.code = _blank_to_none(payload.code)
    row.name = payload.name
    row.description = _blank_to_none(payload.description)
    row.is_active = payload.is_active
    db.commit()
    db.refresh(row)
    return _op_to_dict(row)


@router.delete("/operations/{operation_id}")
def delete_operation_library_item(operation_id: int, db: Session = Depends(get_db)):
    row = db.scalar(select(OperationLibraryItem).where(OperationLibraryItem.id == operation_id))
    if not row:
        raise HTTPException(status_code=404, detail="Operation library item not found")
    db.delete(row)
    db.commit()
    return {"status": "ok"}


@router.get("/workplaces")
def list_workplace_library_items(db: Session = Depends(get_db)):
    seed_master_libraries_demo_data(db)
    rows = db.scalars(select(WorkplaceLibraryItem).order_by(WorkplaceLibraryItem.name.asc())).all()
    return [_wp_to_dict(r) for r in rows]


@router.post("/workplaces")
def create_workplace_library_item(payload: WorkplaceLibraryPayload, db: Session = Depends(get_db)):
    row = WorkplaceLibraryItem(
        code=_blank_to_none(payload.code),
        name=payload.name,
        workplace_type=_blank_to_none(payload.workplace_type),
        hourly_rate=payload.hourly_rate,
        daily_capacity_hours=payload.daily_capacity_hours,
        is_active=payload.is_active,
        is_plannable=payload.is_plannable,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    get_or_create_scheduling_machine_for_workplace(db, int(row.id))
    db.commit()
    return _wp_to_dict(row)


@router.put("/workplaces/{workplace_id}")
def update_workplace_library_item(
    workplace_id: int,
    payload: WorkplaceLibraryPayload,
    db: Session = Depends(get_db),
):
    row = db.scalar(select(WorkplaceLibraryItem).where(WorkplaceLibraryItem.id == workplace_id))
    if not row:
        raise HTTPException(status_code=404, detail="Workplace library item not found")
    row.code = _blank_to_none(payload.code)
    row.name = payload.name
    row.workplace_type = _blank_to_none(payload.workplace_type)
    row.hourly_rate = payload.hourly_rate
    row.daily_capacity_hours = payload.daily_capacity_hours
    row.is_active = payload.is_active
    row.is_plannable = payload.is_plannable
    db.commit()
    db.refresh(row)
    sync_synthetic_anchor_machine_names_for_workplace(db, int(row.id))
    db.execute(
        update(ProductionOrderOperation)
        .where(ProductionOrderOperation.workplace_library_item_id == int(row.id))
        .values(workplace_name=row.name)
    )
    db.commit()
    return _wp_to_dict(row)


@router.delete("/workplaces/{workplace_id}")
def delete_workplace_library_item(workplace_id: int, db: Session = Depends(get_db)):
    row = db.scalar(select(WorkplaceLibraryItem).where(WorkplaceLibraryItem.id == workplace_id))
    if not row:
        raise HTTPException(status_code=404, detail="Workplace library item not found")
    db.delete(row)
    db.commit()
    return {"status": "ok"}
