from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, model_validator
from sqlalchemy import inspect as sa_inspect, select, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from app.api.deps import require_action
from app.core.database import get_db
from app.models.master_data import Machine
from app.models.technology_library import TechnologyTemplate, TechnologyTemplateOperation
from app.services.workplace_scheduling_anchor import get_or_create_scheduling_machine_for_workplace

router = APIRouter()


def ensure_technology_sqlite_schema(engine_: Engine) -> None:
    try:
        url = str(engine_.url)
    except Exception:
        return
    insp = sa_inspect(engine_)
    if "technology_template_operations" not in insp.get_table_names():
        return
    cols = {c["name"] for c in insp.get_columns("technology_template_operations")}

    # FÁZE A: additive schema changes (idempotent)
    stmts: list[str] = []
    if "workplace_library_item_id" not in cols:
        if url.startswith("sqlite"):
            stmts.append("ALTER TABLE technology_template_operations ADD COLUMN workplace_library_item_id INTEGER")
        else:
            stmts.append("ALTER TABLE technology_template_operations ADD COLUMN workplace_library_item_id INTEGER NULL")
    if "is_cooperation" not in cols:
        stmts.append("ALTER TABLE technology_template_operations ADD COLUMN is_cooperation BOOLEAN NOT NULL DEFAULT 0")
    if "default_cooperation_status" not in cols:
        stmts.append("ALTER TABLE technology_template_operations ADD COLUMN default_cooperation_status VARCHAR(30)")
    if "cooperation_category" not in cols:
        stmts.append("ALTER TABLE technology_template_operations ADD COLUMN cooperation_category VARCHAR(80)")
    if "preferred_supplier_id" not in cols:
        stmts.append("ALTER TABLE technology_template_operations ADD COLUMN preferred_supplier_id INTEGER")
    if "cooperation_note" not in cols:
        stmts.append("ALTER TABLE technology_template_operations ADD COLUMN cooperation_note VARCHAR")

    with engine_.begin() as conn:
        for stmt in stmts:
            conn.execute(text(stmt))

        # FÁZE B: backfills
        conn.execute(
            text(
                "UPDATE technology_template_operations "
                "SET is_cooperation = 0 WHERE is_cooperation IS NULL"
            )
        )
        conn.execute(
            text(
                "UPDATE technology_template_operations "
                "SET setup_time_min = 0 WHERE setup_time_min IS NULL"
            )
        )
        conn.execute(
            text(
                "UPDATE technology_template_operations "
                "SET labor_time_per_piece_min = 0 WHERE labor_time_per_piece_min IS NULL"
            )
        )
        conn.execute(
            text(
                "UPDATE technology_template_operations "
                "SET buffer_after_min = 20 WHERE buffer_after_min IS NULL"
            )
        )

        # FÁZE C: indexes
        conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_technology_template_operations_workplace_library_item_id "
                "ON technology_template_operations (workplace_library_item_id)"
            )
        )
        conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_technology_template_operations_preferred_supplier_id "
                "ON technology_template_operations (preferred_supplier_id)"
            )
        )


class TechnologyTemplateCreate(BaseModel):
    gpn: str
    name: str | None = None
    revision: str | None = None
    material: str | None = None
    product_group: str | None = None


class TechnologyTemplateOperationCreate(BaseModel):
    operation_no: int
    operation_name: str
    workplace_library_item_id: int | None = None
    machine_code: str | None = None
    setup_time_min: float = 0
    labor_time_per_piece_min: float = 0
    buffer_after_min: int = 20
    note: str | None = None

    @model_validator(mode="after")
    def require_workplace_or_legacy_machine(self):
        wid = self.workplace_library_item_id
        mc = (self.machine_code or "").strip()
        if wid is None and not mc:
            raise ValueError("Zadejte workplace_library_item_id (pracoviště) nebo legacy machine_code.")
        return self


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


def _materialize_tp_operation_row(db: Session, payload: TechnologyTemplateOperationCreate) -> dict:
    """Vrátí dict pro TechnologyTemplateOperation: machine_code, machine_name, workplace_library_item_id."""
    wid = payload.workplace_library_item_id
    if wid is not None:
        m = get_or_create_scheduling_machine_for_workplace(db, int(wid))
        if m is None:
            raise HTTPException(status_code=404, detail="Pracoviště (workplace_library_item_id) nebylo nalezeno.")
        return {
            "machine_code": m.machine_code,
            "machine_name": m.name,
            "workplace_library_item_id": int(wid),
        }
    mc = (payload.machine_code or "").strip()
    m = db.scalar(select(Machine).where(Machine.machine_code == mc))
    if m is None:
        raise HTTPException(status_code=400, detail=f"Legacy stroj s kódem {mc!r} neexistuje.")
    w = m.workplace_library_item_id
    return {
        "machine_code": m.machine_code,
        "machine_name": m.name,
        "workplace_library_item_id": int(w) if w is not None else None,
    }


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
                "workplace_library_item_id": getattr(op, "workplace_library_item_id", None),
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
                "workplace_library_item_id": getattr(op, "workplace_library_item_id", None),
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
def create_template(
    payload: TechnologyTemplateCreate,
    db: Session = Depends(get_db),
    _rbac: None = Depends(require_action("technology.write")),
):
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
    _rbac: None = Depends(require_action("technology.write")),
):
    template = db.scalar(
        select(TechnologyTemplate).where(TechnologyTemplate.id == template_id)
    )
    if not template:
        raise HTTPException(status_code=404, detail="Technology template not found")

    res = _materialize_tp_operation_row(db, payload)

    row = TechnologyTemplateOperation(
        template_id=template_id,
        operation_no=payload.operation_no,
        operation_name=payload.operation_name,
        workplace_library_item_id=res["workplace_library_item_id"],
        machine_code=res["machine_code"],
        machine_name=res["machine_name"],
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
def create_full_template(
    payload: TechnologyTemplateFullCreate,
    db: Session = Depends(get_db),
    _rbac: None = Depends(require_action("technology.write")),
):
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
        res = _materialize_tp_operation_row(db, op)

        row = TechnologyTemplateOperation(
            template_id=template.id,
            operation_no=op.operation_no,
            operation_name=op.operation_name,
            workplace_library_item_id=res["workplace_library_item_id"],
            machine_code=res["machine_code"],
            machine_name=res["machine_name"],
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
                "machine_code": res["machine_code"],
                "workplace_library_item_id": res["workplace_library_item_id"],
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
def update_template(
    template_id: int,
    payload: TechnologyTemplateUpdate,
    db: Session = Depends(get_db),
    _rbac: None = Depends(require_action("technology.write")),
):
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
        res = _materialize_tp_operation_row(db, op)

        row = TechnologyTemplateOperation(
            template_id=template.id,
            operation_no=op.operation_no,
            operation_name=op.operation_name,
            workplace_library_item_id=res["workplace_library_item_id"],
            machine_code=res["machine_code"],
            machine_name=res["machine_name"],
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
                "machine_code": res["machine_code"],
                "workplace_library_item_id": res["workplace_library_item_id"],
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
def seed_sample_templates(
    db: Session = Depends(get_db),
    _rbac: None = Depends(require_action("technology.write")),
):
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
            wp_id = (
                int(machine.workplace_library_item_id)
                if machine is not None and machine.workplace_library_item_id is not None
                else None
            )

            db.add(
                TechnologyTemplateOperation(
                    template_id=template.id,
                    operation_no=op["operation_no"],
                    operation_name=op["operation_name"],
                    workplace_library_item_id=wp_id,
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
