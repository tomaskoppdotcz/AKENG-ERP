"""API knihovny materiálů."""

import math
import re

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, inspect as sa_inspect, select, text, update
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, joinedload

from app.core.database import get_db
from app.core.scan_code import material_library_scan_code_for_id
from app.models.material_library import MaterialGroup, MaterialLibraryItem

router = APIRouter()

ROUND_BAR_FORM = "Tyč kruhová"
DEMO_MATERIAL_GROUPS = ("Nerez", "Ocel", "Hliník", "Plast", "Ostatní")
GROUP_NAME_NEREZ = "Nerez"
GROUP_NAME_NEREZ_DUPLEX = "Nerez duplex"


def ensure_material_library_sqlite_schema(engine: Engine) -> None:
    try:
        url = str(engine.url)
    except Exception:
        return
    if not url.startswith("sqlite"):
        return

    insp = sa_inspect(engine)
    tables = set(insp.get_table_names())

    with engine.begin() as conn:
        if "material_groups" not in tables:
            conn.execute(
                text(
                    """
                    CREATE TABLE material_groups (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        code VARCHAR(120),
                        name VARCHAR(255) NOT NULL,
                        is_active BOOLEAN NOT NULL DEFAULT 1
                    )
                    """
                )
            )
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_material_groups_name ON material_groups (name)"))

        if "material_library_items" in tables:
            col_names = {c["name"] for c in insp.get_columns("material_library_items")}
            if "material_group_id" not in col_names:
                conn.execute(text("ALTER TABLE material_library_items ADD COLUMN material_group_id INTEGER"))
            if "scan_code" not in col_names:
                conn.execute(text("ALTER TABLE material_library_items ADD COLUMN scan_code VARCHAR(32)"))
            conn.execute(
                text(
                    "CREATE UNIQUE INDEX IF NOT EXISTS uq_material_library_items_scan_code ON material_library_items (scan_code)"
                )
            )


def seed_material_groups(db: Session) -> None:
    if db.scalar(select(MaterialGroup.id).limit(1)) is not None:
        return
    db.add_all([MaterialGroup(name=name, is_active=True) for name in DEMO_MATERIAL_GROUPS])
    db.commit()


def normalize_nerez_material_groups(db: Session) -> None:
    """Sloučí „Nerez duplex“ do „Nerez“ (idempotentní, bezpečné opakované spuštění)."""
    duplex = db.scalar(select(MaterialGroup).where(MaterialGroup.name == GROUP_NAME_NEREZ_DUPLEX))
    nerez = db.scalar(select(MaterialGroup).where(MaterialGroup.name == GROUP_NAME_NEREZ))
    if duplex is not None:
        if nerez is not None:
            db.execute(
                update(MaterialLibraryItem)
                .where(MaterialLibraryItem.material_group_id == duplex.id)
                .values(material_group_id=nerez.id)
            )
            db.delete(duplex)
        else:
            duplex.name = GROUP_NAME_NEREZ
            nerez = duplex

    if nerez is None:
        return

    # Seedované materiály 1.4460 bez skupiny nastavíme do "Nerez", ale
    # existující explicitně vyplněné skupiny nikdy nepřepisujeme.
    db.execute(
        update(MaterialLibraryItem)
        .where(
            MaterialLibraryItem.material_group_id.is_(None),
            (MaterialLibraryItem.name == "1.4460") | (MaterialLibraryItem.code.like("%1.4460%")),
        )
        .values(material_group_id=nerez.id)
    )
    db.commit()


def _validate_material_group_id(db: Session, material_group_id: int | None) -> int | None:
    if material_group_id is None:
        return None
    exists = db.scalar(select(MaterialGroup.id).where(MaterialGroup.id == material_group_id))
    if exists is None:
        raise HTTPException(status_code=404, detail="Skupina materiálu nenalezena")
    return material_group_id


def _parse_dimension_d_mm(dimension: str) -> float | None:
    """Vytáhne první číslo z řetězce rozměru (např. '81,4 mm' -> 81.4)."""
    if not dimension or not str(dimension).strip():
        return None
    m = re.match(r"^\s*([\d]+(?:[.,]\d+)?)", str(dimension).strip().replace(" ", ""))
    if not m:
        return None
    try:
        d = float(m.group(1).replace(",", "."))
    except ValueError:
        return None
    return d if d > 0 and math.isfinite(d) else None


def _round_bar_kg_price_per_mm(row: MaterialLibraryItem) -> tuple[float | None, float | None]:
    if row.form != ROUND_BAR_FORM or row.density is None:
        return None, None
    d = _parse_dimension_d_mm(row.dimension)
    if d is None:
        return None, None
    d_m = d / 1000
    length_m = 1 / 1000
    kg_per_mm = math.pi * (d_m**2) / 4 * length_m * row.density
    if row.price_per_kg is not None:
        price_per_mm = kg_per_mm * row.price_per_kg
    else:
        price_per_mm = None
    return kg_per_mm, price_per_mm


def _material_to_dict(row: MaterialLibraryItem) -> dict:
    kg_per_mm, price_per_mm = _round_bar_kg_price_per_mm(row)
    group = row.material_group
    return {
        "id": row.id,
        "scan_code": row.scan_code,
        "code": row.code,
        "name": row.name,
        "material_type": row.material_type,
        "form": row.form,
        "dimension": row.dimension,
        "unit": row.unit,
        "density": row.density,
        "price_per_kg": row.price_per_kg,
        "price_per_unit": row.price_per_unit,
        "material_group_id": row.material_group_id,
        "material_group_name": group.name if group else None,
        "is_active": row.is_active,
        "kg_per_mm": kg_per_mm,
        "price_per_mm": price_per_mm,
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
    material_group_id: int | None = None
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


class MaterialGroupCreatePayload(BaseModel):
    name: str = Field(..., min_length=1)
    code: str | None = None
    is_active: bool = True

    @field_validator("name")
    @classmethod
    def name_strip(cls, v: str) -> str:
        s = v.strip()
        if not s:
            raise ValueError("Název je povinný")
        return s


class MaterialGroupUpdatePayload(BaseModel):
    name: str | None = None
    code: str | None = None
    is_active: bool | None = None


def _material_group_dict(r: MaterialGroup) -> dict:
    return {"id": r.id, "code": r.code, "name": r.name, "is_active": r.is_active}


@router.get("/")
def list_materials(db: Session = Depends(get_db)):
    rows = db.scalars(
        select(MaterialLibraryItem)
        .options(joinedload(MaterialLibraryItem.material_group))
        .order_by(MaterialLibraryItem.name.asc())
    ).all()
    return [_material_to_dict(r) for r in rows]


@router.get("/groups")
def list_material_groups(db: Session = Depends(get_db)):
    rows = db.scalars(select(MaterialGroup).order_by(MaterialGroup.name.asc())).all()
    return [_material_group_dict(r) for r in rows]


@router.post("/groups")
def create_material_group(payload: MaterialGroupCreatePayload, db: Session = Depends(get_db)):
    code = payload.code.strip() if payload.code else None
    row = MaterialGroup(name=payload.name.strip(), code=code or None, is_active=payload.is_active)
    db.add(row)
    db.commit()
    db.refresh(row)
    return _material_group_dict(row)


@router.put("/groups/{group_id}")
def update_material_group(group_id: int, payload: MaterialGroupUpdatePayload, db: Session = Depends(get_db)):
    row = db.scalar(select(MaterialGroup).where(MaterialGroup.id == group_id))
    if row is None:
        raise HTTPException(status_code=404, detail="Skupina materiálu nenalezena")
    data = payload.model_dump(exclude_unset=True)
    if "name" in data and data["name"] is not None:
        nm = str(data["name"]).strip()
        if not nm:
            raise HTTPException(status_code=422, detail="Název nesmí být prázdný.")
        row.name = nm
    if "code" in data:
        row.code = data["code"].strip() if data["code"] else None
    if "is_active" in data and data["is_active"] is not None:
        row.is_active = bool(data["is_active"])
    db.commit()
    db.refresh(row)
    return _material_group_dict(row)


@router.delete("/groups/{group_id}")
def delete_material_group(group_id: int, db: Session = Depends(get_db)):
    row = db.scalar(select(MaterialGroup).where(MaterialGroup.id == group_id))
    if row is None:
        raise HTTPException(status_code=404, detail="Skupina materiálu nenalezena")
    n_refs = (
        db.scalar(
            select(func.count()).select_from(MaterialLibraryItem).where(MaterialLibraryItem.material_group_id == group_id)
        )
        or 0
    )
    if n_refs > 0:
        raise HTTPException(
            status_code=409,
            detail="Skupinu nelze smazat — jsou k ní přiřazené materiály.",
        )
    db.delete(row)
    db.commit()
    return {"status": "ok"}


@router.post("/")
def create_material(payload: MaterialLibraryPayload, db: Session = Depends(get_db)):
    dup = db.scalar(select(MaterialLibraryItem).where(MaterialLibraryItem.code == payload.code))
    if dup:
        raise HTTPException(status_code=400, detail="Material with this code already exists")

    validated_group_id = _validate_material_group_id(db, payload.material_group_id)
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
        material_group_id=validated_group_id,
        is_active=payload.is_active,
    )
    db.add(row)
    db.flush()
    if not (row.scan_code and str(row.scan_code).strip()):
        row.scan_code = material_library_scan_code_for_id(row.id)
    db.commit()
    row = db.scalar(
        select(MaterialLibraryItem)
        .where(MaterialLibraryItem.id == row.id)
        .options(joinedload(MaterialLibraryItem.material_group))
    )
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

    validated_group_id = _validate_material_group_id(db, payload.material_group_id)
    row.code = payload.code
    row.name = payload.name
    row.material_type = payload.material_type
    row.form = payload.form
    row.dimension = payload.dimension
    row.unit = payload.unit
    row.density = payload.density
    row.price_per_kg = payload.price_per_kg
    row.price_per_unit = payload.price_per_unit
    row.material_group_id = validated_group_id
    row.is_active = payload.is_active
    db.commit()
    row = db.scalar(
        select(MaterialLibraryItem)
        .where(MaterialLibraryItem.id == row.id)
        .options(joinedload(MaterialLibraryItem.material_group))
    )
    return _material_to_dict(row)


@router.delete("/{material_id}")
def delete_material(material_id: int, db: Session = Depends(get_db)):
    row = db.scalar(select(MaterialLibraryItem).where(MaterialLibraryItem.id == material_id))
    if not row:
        raise HTTPException(status_code=404, detail="Material not found")
    db.delete(row)
    db.commit()
    return {"status": "ok"}
