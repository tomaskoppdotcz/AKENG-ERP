"""API knihovny materiálů."""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.material_library import MaterialLibraryItem

router = APIRouter()


def _material_to_dict(row: MaterialLibraryItem) -> dict:
    return {
        "id": row.id,
        "code": row.code,
        "name": row.name,
        "material_type": row.material_type,
        "form": row.form,
        "dimension": row.dimension,
        "unit": row.unit,
        "density": row.density,
        "price_per_kg": row.price_per_kg,
        "price_per_unit": row.price_per_unit,
        "is_active": row.is_active,
    }


class MaterialLibraryPayload(BaseModel):
    code: str = Field(..., min_length=1)
    name: str = Field(..., min_length=1)
    material_type: str = ""
    form: str = ""
    dimension: str = ""
    unit: str = ""
    density: float | None = None
    price_per_kg: float | None = None
    price_per_unit: float | None = None
    is_active: bool = True

    @field_validator("code", "name")
    @classmethod
    def strip_required(cls, v: str) -> str:
        s = v.strip()
        if not s:
            raise ValueError("Field is required")
        return s

    @field_validator("material_type", "form", "dimension", "unit", mode="before")
    @classmethod
    def strip_optional_str(cls, v: str | None) -> str:
        if v is None:
            return ""
        return str(v).strip()


@router.get("/")
def list_materials(db: Session = Depends(get_db)):
    rows = db.scalars(select(MaterialLibraryItem).order_by(MaterialLibraryItem.name.asc())).all()
    return [_material_to_dict(r) for r in rows]


@router.post("/")
def create_material(payload: MaterialLibraryPayload, db: Session = Depends(get_db)):
    dup = db.scalar(select(MaterialLibraryItem).where(MaterialLibraryItem.code == payload.code))
    if dup:
        raise HTTPException(status_code=400, detail="Material with this code already exists")

    row = MaterialLibraryItem(
        code=payload.code,
        name=payload.name,
        material_type=payload.material_type,
        form=payload.form,
        dimension=payload.dimension,
        unit=payload.unit,
        density=payload.density,
        price_per_kg=payload.price_per_kg,
        price_per_unit=payload.price_per_unit,
        is_active=payload.is_active,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _material_to_dict(row)


@router.put("/{material_id}")
def update_material(material_id: int, payload: MaterialLibraryPayload, db: Session = Depends(get_db)):
    row = db.scalar(select(MaterialLibraryItem).where(MaterialLibraryItem.id == material_id))
    if not row:
        raise HTTPException(status_code=404, detail="Material not found")

    if payload.code != row.code:
        dup = db.scalar(select(MaterialLibraryItem).where(MaterialLibraryItem.code == payload.code))
        if dup:
            raise HTTPException(status_code=400, detail="Material with this code already exists")

    row.code = payload.code
    row.name = payload.name
    row.material_type = payload.material_type
    row.form = payload.form
    row.dimension = payload.dimension
    row.unit = payload.unit
    row.density = payload.density
    row.price_per_kg = payload.price_per_kg
    row.price_per_unit = payload.price_per_unit
    row.is_active = payload.is_active
    db.commit()
    db.refresh(row)
    return _material_to_dict(row)


@router.delete("/{material_id}")
def delete_material(material_id: int, db: Session = Depends(get_db)):
    row = db.scalar(select(MaterialLibraryItem).where(MaterialLibraryItem.id == material_id))
    if not row:
        raise HTTPException(status_code=404, detail="Material not found")
    db.delete(row)
    db.commit()
    return {"status": "ok"}
