"""Clean master libraries API (operations, workplaces)."""

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.master_libraries import OperationLibraryItem, WorkplaceLibraryItem

router = APIRouter()


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
                    is_active=True,
                ),
                WorkplaceLibraryItem(
                    code="CLX450",
                    name="CLX 450 TC",
                    workplace_type="soustruh",
                    hourly_rate=950.0,
                    is_active=True,
                ),
                WorkplaceLibraryItem(
                    code="CTX800",
                    name="CTX Beta 800",
                    workplace_type="soustruh",
                    hourly_rate=1020.0,
                    is_active=True,
                ),
                WorkplaceLibraryItem(
                    code="CMX600",
                    name="CMX 600 V",
                    workplace_type="frézka",
                    hourly_rate=880.0,
                    is_active=True,
                ),
                WorkplaceLibraryItem(
                    code="NEF400",
                    name="NEF 400",
                    workplace_type="frézka",
                    hourly_rate=760.0,
                    is_active=True,
                ),
                WorkplaceLibraryItem(
                    code="KTRL-01",
                    name="Kontrola",
                    workplace_type="kontrola",
                    hourly_rate=680.0,
                    is_active=True,
                ),
                WorkplaceLibraryItem(
                    code="KOOP-01",
                    name="Kooperace",
                    workplace_type="kooperace",
                    hourly_rate=550.0,
                    is_active=True,
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
    return [
        {
            "id": r.id,
            "code": r.code,
            "name": r.name,
            "description": r.description,
            "is_active": r.is_active,
        }
        for r in rows
    ]


@router.get("/workplaces")
def list_workplace_library_items(db: Session = Depends(get_db)):
    seed_master_libraries_demo_data(db)
    rows = db.scalars(select(WorkplaceLibraryItem).order_by(WorkplaceLibraryItem.name.asc())).all()
    return [
        {
            "id": r.id,
            "code": r.code,
            "name": r.name,
            "workplace_type": r.workplace_type,
            "hourly_rate": r.hourly_rate,
            "is_active": r.is_active,
        }
        for r in rows
    ]
