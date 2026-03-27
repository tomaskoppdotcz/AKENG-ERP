"""API: umístění skladu (master data)."""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import inspect as sa_inspect, select, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.storage_location import StorageLocation

router = APIRouter()

ALLOWED_TYPES = {"material", "product", "both"}


def ensure_storage_locations_sqlite_schema(engine: Engine) -> None:
    try:
        url = str(engine.url)
    except Exception:
        return
    if not url.startswith("sqlite"):
        return

    insp = sa_inspect(engine)
    if "storage_locations" in insp.get_table_names():
        return

    with engine.begin() as conn:
        conn.execute(
            text(
                """
                CREATE TABLE storage_locations (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    code VARCHAR(80) NOT NULL,
                    name VARCHAR(255) NOT NULL,
                    location_type VARCHAR(20) NOT NULL,
                    is_active BOOLEAN NOT NULL DEFAULT 1
                )
                """
            )
        )
        conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS uq_storage_locations_code ON storage_locations (code)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_storage_locations_name ON storage_locations (name)"))


class StorageLocationCreatePayload(BaseModel):
    code: str = Field(..., min_length=1)
    name: str = Field(..., min_length=1)
    location_type: str
    is_active: bool = True

    @field_validator("code", "name")
    @classmethod
    def _strip_required(cls, v: str) -> str:
        s = v.strip()
        if not s:
            raise ValueError("Pole je povinné.")
        return s

    @field_validator("location_type")
    @classmethod
    def _validate_type(cls, v: str) -> str:
        t = str(v).strip().lower()
        if t not in ALLOWED_TYPES:
            raise ValueError("location_type musí být material / product / both")
        return t


class StorageLocationUpdatePayload(BaseModel):
    code: str | None = None
    name: str | None = None
    location_type: str | None = None
    is_active: bool | None = None

    @field_validator("code", "name")
    @classmethod
    def _strip_optional(cls, v: str | None) -> str | None:
        if v is None:
            return None
        s = str(v).strip()
        if not s:
            raise ValueError("Pole nesmí být prázdné.")
        return s

    @field_validator("location_type")
    @classmethod
    def _validate_optional_type(cls, v: str | None) -> str | None:
        if v is None:
            return None
        t = str(v).strip().lower()
        if t not in ALLOWED_TYPES:
            raise ValueError("location_type musí být material / product / both")
        return t


def _to_dict(row: StorageLocation) -> dict:
    return {
        "id": row.id,
        "code": row.code,
        "name": row.name,
        "location_type": row.location_type,
        "is_active": row.is_active,
    }


@router.get("")
def list_storage_locations(db: Session = Depends(get_db)):
    rows = db.scalars(select(StorageLocation).order_by(StorageLocation.name.asc())).all()
    return [_to_dict(r) for r in rows]


@router.post("")
def create_storage_location(payload: StorageLocationCreatePayload, db: Session = Depends(get_db)):
    dup = db.scalar(select(StorageLocation.id).where(StorageLocation.code == payload.code))
    if dup is not None:
        raise HTTPException(status_code=409, detail="Umístění s tímto kódem již existuje.")
    row = StorageLocation(
        code=payload.code,
        name=payload.name,
        location_type=payload.location_type,
        is_active=payload.is_active,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _to_dict(row)


@router.put("/{location_id}")
def update_storage_location(location_id: int, payload: StorageLocationUpdatePayload, db: Session = Depends(get_db)):
    row = db.scalar(select(StorageLocation).where(StorageLocation.id == location_id))
    if row is None:
        raise HTTPException(status_code=404, detail="Umístění nebylo nalezeno.")
    data = payload.model_dump(exclude_unset=True)
    if "code" in data and data["code"] is not None and data["code"] != row.code:
        dup = db.scalar(select(StorageLocation.id).where(StorageLocation.code == data["code"]))
        if dup is not None:
            raise HTTPException(status_code=409, detail="Umístění s tímto kódem již existuje.")
    if "code" in data and data["code"] is not None:
        row.code = data["code"]
    if "name" in data and data["name"] is not None:
        row.name = data["name"]
    if "location_type" in data and data["location_type"] is not None:
        row.location_type = data["location_type"]
    if "is_active" in data and data["is_active"] is not None:
        row.is_active = bool(data["is_active"])
    db.commit()
    db.refresh(row)
    return _to_dict(row)


@router.delete("/{location_id}")
def delete_storage_location(location_id: int, db: Session = Depends(get_db)):
    row = db.scalar(select(StorageLocation).where(StorageLocation.id == location_id))
    if row is None:
        raise HTTPException(status_code=404, detail="Umístění nebylo nalezeno.")
    db.delete(row)
    db.commit()
    return {"status": "ok"}
