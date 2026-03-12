from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.technology_library import TechnologyTemplate, TechnologyTemplateOperation
from app.models.master_data import Machine

router = APIRouter()


class TechnologyTemplateCreate(BaseModel):
    gpn: str
    name: str | None = None
    revision: str | None = None
    material: str | None = None
    product_group: str | None = None


class TechnologyTemplateOperationCreate(BaseModel):
    operation_no: int
    operation_name: str
    machine_code: str
    setup_time_min: float = 0
    labor_time_per_piece_min: float = 0
    buffer_after_min: int = 20
    note: str | None = None


class TechnologyTemplateFullCreate(BaseModel):
    gpn: str
    name: str | None = None
    revision: str | None = None
    material: str | None = None
    product_group: str | None = None
    operations: list[TechnologyTemplateOperationCreate]


class TechnologyTemplateUpdate(BaseModel):
    gpn: str
    name: str | None = None
    revision: str | None = None
    material: str | None = None
    product_group: str | None = None
    operations: list[TechnologyTemplateOperationCreate]


@router.get("/templates")
def get_templates(db: Session = Depends(get_db)):
    rows = db.scalars(
        select(TechnologyTemplate).order_by(TechnologyTemplate.gpn.asc())
    ).all()

    result = []
    for row in rows:
        result.append(
            {
                "id": row.id,
                "gpn": row.gpn,
                "name": row.name,
                "revision": row.revision,
                "material": row.material,
                "product_group": row.product_group,
                "is_active": row.is_active,
                "operations_count": len(row.operations),
            }
        )
    return result


@router.get("/templates/{template_id}")
def get_template_detail(template_id: int, db: Session = Depends(get_db)):
    row = db.scalar(
        select(TechnologyTemplate).where(TechnologyTemplate.id == template_id)
    )
    if not row:
        raise HTTPException(status_code=404, detail="Technology template not found")

    return {
        "id": row.id,
        "gpn": row.gpn,
        "name": row.name,
        "revision": row.revision,
        "material": row.material,
        "product_group": row.product_group,
        "is_active": row.is_active,
        "operations": [
            {
                "id": op.id,
                "operation_no": op.operation_no,
                "operation_name": op.operation_name,
                "machine_code": op.machine_code,
                "machine_name": op.machine_name,
                "setup_time_min": op.setup_time_min,
                "labor_time_per_piece_min": op.labor_time_per_piece_min,
                "buffer_after_min": op.buffer_after_min,
                "note": op.note,
            }
            for op in row.operations
        ],
    }


@router.get("/templates/by-gpn/{gpn}")
def get_template_by_gpn(gpn: str, db: Session = Depends(get_db)):
    row = db.scalar(
        select(TechnologyTemplate).where(TechnologyTemplate.gpn == gpn)
    )
    if not row:
        raise HTTPException(status_code=404, detail="Technology template not found for GPN")

    return {
        "id": row.id,
        "gpn": row.gpn,
        "name": row.name,
        "revision": row.revision,
        "material": row.material,
        "product_group": row.product_group,
        "is_active": row.is_active,
        "operations": [
            {
                "id": op.id,
                "operation_no": op.operation_no,
                "operation_name": op.operation_name,
                "machine_code": op.machine_code,
                "machine_name": op.machine_name,
                "setup_time_min": op.setup_time_min,
                "labor_time_per_piece_min": op.labor_time_per_piece_min,
                "buffer_after_min": op.buffer_after_min,
                "note": op.note,
            }
            for op in row.operations
        ],
    }


@router.post("/templates")
def create_template(payload: TechnologyTemplateCreate, db: Session = Depends(get_db)):
    exists = db.scalar(
        select(TechnologyTemplate).where(TechnologyTemplate.gpn == payload.gpn)
    )
    if exists:
        raise HTTPException(status_code=400, detail="Technology template for this GPN already exists")

    row = TechnologyTemplate(
        gpn=payload.gpn,
        name=payload.name,
        revision=payload.revision,
        material=payload.material,
        product_group=payload.product_group,
        is_active=True,
    )
    db.add(row)
    db.commit()
    db.refresh(row)

    return {
        "status": "ok",
        "template_id": row.id,
        "gpn": row.gpn,
    }


@router.post("/templates/{template_id}/operations")
def add_template_operation(
    template_id: int,
    payload: TechnologyTemplateOperationCreate,
    db: Session = Depends(get_db),
):
    template = db.scalar(
        select(TechnologyTemplate).where(TechnologyTemplate.id == template_id)
    )
    if not template:
        raise HTTPException(status_code=404, detail="Technology template not found")

    machine = db.scalar(
        select(Machine).where(Machine.machine_code == payload.machine_code)
    )
    machine_name = machine.name if machine else None

    row = TechnologyTemplateOperation(
        template_id=template_id,
        operation_no=payload.operation_no,
        operation_name=payload.operation_name,
        machine_code=payload.machine_code,
        machine_name=machine_name,
        setup_time_min=payload.setup_time_min,
        labor_time_per_piece_min=payload.labor_time_per_piece_min,
        buffer_after_min=payload.buffer_after_min,
        note=payload.note,
    )
    db.add(row)
    db.commit()
    db.refresh(row)

    return {
        "status": "ok",
        "operation_id": row.id,
        "template_id": template_id,
    }


@router.post("/templates/full")
def create_full_template(payload: TechnologyTemplateFullCreate, db: Session = Depends(get_db)):
    exists = db.scalar(
        select(TechnologyTemplate).where(TechnologyTemplate.gpn == payload.gpn)
    )
    if exists:
        raise HTTPException(status_code=400, detail="Technology template for this GPN already exists")

    template = TechnologyTemplate(
        gpn=payload.gpn,
        name=payload.name,
        revision=payload.revision,
        material=payload.material,
        product_group=payload.product_group,
        is_active=True,
    )
    db.add(template)
    db.flush()

    created_ops = []

    for op in payload.operations:
        machine = db.scalar(
            select(Machine).where(Machine.machine_code == op.machine_code)
        )
        machine_name = machine.name if machine else None

        row = TechnologyTemplateOperation(
            template_id=template.id,
            operation_no=op.operation_no,
            operation_name=op.operation_name,
            machine_code=op.machine_code,
            machine_name=machine_name,
            setup_time_min=op.setup_time_min,
            labor_time_per_piece_min=op.labor_time_per_piece_min,
            buffer_after_min=op.buffer_after_min,
            note=op.note,
        )
        db.add(row)
        created_ops.append(
            {
                "operation_no": op.operation_no,
                "operation_name": op.operation_name,
                "machine_code": op.machine_code,
            }
        )

    db.commit()
    db.refresh(template)

    return {
        "status": "ok",
        "template_id": template.id,
        "gpn": template.gpn,
        "operations_created": created_ops,
    }


@router.put("/templates/{template_id}")
def update_template(template_id: int, payload: TechnologyTemplateUpdate, db: Session = Depends(get_db)):
    template = db.scalar(
        select(TechnologyTemplate).where(TechnologyTemplate.id == template_id)
    )
    if not template:
        raise HTTPException(status_code=404, detail="Technology template not found")

    duplicate = db.scalar(
        select(TechnologyTemplate)
        .where(TechnologyTemplate.gpn == payload.gpn)
        .where(TechnologyTemplate.id != template_id)
    )
    if duplicate:
        raise HTTPException(status_code=400, detail="Jine GPN uz tuto TP sablonu pouziva")

    template.gpn = payload.gpn
    template.name = payload.name
    template.revision = payload.revision
    template.material = payload.material
    template.product_group = payload.product_group

    for old_op in list(template.operations):
        db.delete(old_op)

    db.flush()

    created_ops = []

    for op in payload.operations:
        machine = db.scalar(
            select(Machine).where(Machine.machine_code == op.machine_code)
        )
        machine_name = machine.name if machine else None

        row = TechnologyTemplateOperation(
            template_id=template.id,
            operation_no=op.operation_no,
            operation_name=op.operation_name,
            machine_code=op.machine_code,
            machine_name=machine_name,
            setup_time_min=op.setup_time_min,
            labor_time_per_piece_min=op.labor_time_per_piece_min,
            buffer_after_min=op.buffer_after_min,
            note=op.note,
        )
        db.add(row)
        created_ops.append(
            {
                "operation_no": op.operation_no,
                "operation_name": op.operation_name,
                "machine_code": op.machine_code,
            }
        )

    db.commit()
    db.refresh(template)

    return {
        "status": "ok",
        "template_id": template.id,
        "gpn": template.gpn,
        "operations_updated": created_ops,
    }


@router.post("/templates/seed-sample")
def seed_sample_templates(db: Session = Depends(get_db)):
    samples = [
        {
            "gpn": "89578150",
            "name": "Mtg Rng 120mm 329 S.S.(0720)",
            "material": "1.4460 / 329",
            "product_group": "Krouzek",
            "operations": [
                {"operation_no": 10, "operation_name": "Rezani", "machine_code": "PILA", "setup_time_min": 6, "labor_time_per_piece_min": 2},
                {"operation_no": 20, "operation_name": "Soustruzeni", "machine_code": "CTX_BETA_800", "setup_time_min": 20, "labor_time_per_piece_min": 6},
                {"operation_no": 30, "operation_name": "Mezioperacni kontrola", "machine_code": "MEZIOPERACNI_KONTROLA", "setup_time_min": 3, "labor_time_per_piece_min": 1},
                {"operation_no": 40, "operation_name": "Vystupni kontrola", "machine_code": "VYSTUPNI_KONTROLA", "setup_time_min": 3, "labor_time_per_piece_min": 1},
                {"operation_no": 50, "operation_name": "Baleni", "machine_code": "BALENI", "setup_time_min": 2, "labor_time_per_piece_min": 0.5},
            ],
        },
        {
            "gpn": "81722615",
            "name": "Rng, Pistn 58mm 329 S.S.(0720)",
            "material": "1.4460 / 329",
            "product_group": "Krouzek",
            "operations": [
                {"operation_no": 10, "operation_name": "Rezani", "machine_code": "PILA", "setup_time_min": 5, "labor_time_per_piece_min": 1.5},
                {"operation_no": 20, "operation_name": "Soustruzeni", "machine_code": "CTX_BETA_800", "setup_time_min": 18, "labor_time_per_piece_min": 5},
                {"operation_no": 30, "operation_name": "Vystupni kontrola", "machine_code": "VYSTUPNI_KONTROLA", "setup_time_min": 3, "labor_time_per_piece_min": 1},
            ],
        },
        {
            "gpn": "89022925",
            "name": "Adpter, Mtg Rng 30mm 329 S.S.(0720)",
            "material": "1.4460 / 329",
            "product_group": "Adapter",
            "operations": [
                {"operation_no": 10, "operation_name": "Rezani", "machine_code": "PILA", "setup_time_min": 5, "labor_time_per_piece_min": 1},
                {"operation_no": 20, "operation_name": "Soustruzeni", "machine_code": "CLX_450_TC", "setup_time_min": 15, "labor_time_per_piece_min": 4},
                {"operation_no": 30, "operation_name": "Frezovani", "machine_code": "CMX_600_V", "setup_time_min": 12, "labor_time_per_piece_min": 3},
                {"operation_no": 40, "operation_name": "Vystupni kontrola", "machine_code": "VYSTUPNI_KONTROLA", "setup_time_min": 3, "labor_time_per_piece_min": 1},
            ],
        },
    ]

    created = []

    for sample in samples:
        exists = db.scalar(
            select(TechnologyTemplate).where(TechnologyTemplate.gpn == sample["gpn"])
        )
        if exists:
            continue

        template = TechnologyTemplate(
            gpn=sample["gpn"],
            name=sample["name"],
            revision=None,
            material=sample["material"],
            product_group=sample["product_group"],
            is_active=True,
        )
        db.add(template)
        db.flush()

        for op in sample["operations"]:
            machine = db.scalar(select(Machine).where(Machine.machine_code == op["machine_code"]))
            machine_name = machine.name if machine else None

            db.add(
                TechnologyTemplateOperation(
                    template_id=template.id,
                    operation_no=op["operation_no"],
                    operation_name=op["operation_name"],
                    machine_code=op["machine_code"],
                    machine_name=machine_name,
                    setup_time_min=op["setup_time_min"],
                    labor_time_per_piece_min=op["labor_time_per_piece_min"],
                    buffer_after_min=20,
                    note=None,
                )
            )

        created.append(sample["gpn"])

    db.commit()

    return {
        "status": "ok",
        "templates_created": created,
    }
