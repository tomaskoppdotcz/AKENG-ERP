from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, inspect as sa_inspect, select, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, selectinload

from app.core.database import get_db
from app.core.scan_code import portfolio_scan_code_for_id
from app.models.master_data import Customer
from app.models.master_libraries import OperationLibraryItem, WorkplaceLibraryItem
from app.models.material_library import MaterialLibraryItem
from app.models.material_stock import MaterialStockItem, MaterialStockReservation
from app.models.product_stock import ProductStockItem
from app.models.portfolio import (
    PortfolioGroup,
    PortfolioItem,
    PortfolioTechnologyTemplate,
    PortfolioTechnologyTemplateMaterial,
    PortfolioTechnologyTemplateOperation,
)

router = APIRouter()


def ensure_portfolio_technology_operation_library_fks(engine: Engine) -> None:
    """SQLite: add FK columns to template operations if missing (create_all does not migrate)."""
    try:
        url = str(engine.url)
    except Exception:
        return
    if not url.startswith("sqlite"):
        return

    insp = sa_inspect(engine)
    if "portfolio_technology_template_operations" not in insp.get_table_names():
        return

    cols = {c["name"] for c in insp.get_columns("portfolio_technology_template_operations")}
    stmts: list[str] = []
    if "operation_library_item_id" not in cols:
        stmts.append(
            "ALTER TABLE portfolio_technology_template_operations ADD COLUMN operation_library_item_id INTEGER"
        )
    if "workplace_library_item_id" not in cols:
        stmts.append(
            "ALTER TABLE portfolio_technology_template_operations ADD COLUMN workplace_library_item_id INTEGER"
        )
    if not stmts:
        return

    with engine.begin() as conn:
        for stmt in stmts:
            conn.execute(text(stmt))


def ensure_portfolio_technology_material_inputs_sqlite_schema(engine: Engine) -> None:
    """SQLite: rozšíření TP materiálů na obecné vstupy (material/product_stock).

    Pozn.: původní tabulka měla material_library_item_id NOT NULL. Pro product_stock vstupy je potřeba sloupec znepovinnit,
    proto u SQLite bezpečně rebuildneme tabulku se zachováním dat.
    """
    try:
        url = str(engine.url)
    except Exception:
        return
    if not url.startswith("sqlite"):
        return

    insp = sa_inspect(engine)
    if "portfolio_technology_template_materials" not in insp.get_table_names():
        return

    cols = insp.get_columns("portfolio_technology_template_materials")
    col_names = {c["name"] for c in cols}
    notnull_by_name = {c["name"]: bool(c.get("nullable") is False) for c in cols}

    # Nejprve doplníme nové sloupce, pokud chybí.
    stmts: list[str] = []
    if "input_type" not in col_names:
        stmts.append("ALTER TABLE portfolio_technology_template_materials ADD COLUMN input_type VARCHAR(20)")
    if "portfolio_item_id" not in col_names:
        stmts.append("ALTER TABLE portfolio_technology_template_materials ADD COLUMN portfolio_item_id INTEGER")
    if stmts:
        with engine.begin() as conn:
            for stmt in stmts:
                conn.execute(text(stmt))

    # Pokud je material_library_item_id stále NOT NULL, rebuildneme tabulku, aby šel uložit product_stock vstup.
    # (SQLite neumí ALTER COLUMN DROP NOT NULL.)
    insp = sa_inspect(engine)  # refresh inspector cache after ALTER TABLE
    cols_after = insp.get_columns("portfolio_technology_template_materials")
    col_names_after = {c["name"] for c in cols_after}
    ml_col = next((c for c in cols_after if c["name"] == "material_library_item_id"), None)
    material_notnull = bool(ml_col and ml_col.get("nullable") is False)
    if not material_notnull:
        return

    with engine.begin() as conn:
        conn.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS portfolio_technology_template_materials__new (
                    id INTEGER PRIMARY KEY,
                    template_id INTEGER NOT NULL,
                    input_type VARCHAR(20),
                    material_library_item_id INTEGER,
                    portfolio_item_id INTEGER,
                    consumption_per_piece FLOAT,
                    consumption_unit VARCHAR(120),
                    scrap_allowance FLOAT,
                    note VARCHAR(500)
                )
                """
            )
        )
        # Přeneseme data (input_type/portfolio_item_id mohou být NULL u legacy řádků).
        conn.execute(
            text(
                """
                INSERT INTO portfolio_technology_template_materials__new (
                    id, template_id, input_type, material_library_item_id, portfolio_item_id,
                    consumption_per_piece, consumption_unit, scrap_allowance, note
                )
                SELECT
                    id, template_id,
                    CASE WHEN input_type IS NULL OR TRIM(input_type) = '' THEN NULL ELSE input_type END,
                    material_library_item_id,
                    portfolio_item_id,
                    consumption_per_piece, consumption_unit, scrap_allowance, note
                FROM portfolio_technology_template_materials
                """
            )
        )
        conn.execute(text("DROP TABLE portfolio_technology_template_materials"))
        conn.execute(
            text("ALTER TABLE portfolio_technology_template_materials__new RENAME TO portfolio_technology_template_materials")
        )
        # Recreate indexes (idempotentní).
        conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_portfolio_technology_template_materials_template_id ON portfolio_technology_template_materials (template_id)"
            )
        )
        conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_portfolio_technology_template_materials_material_library_item_id ON portfolio_technology_template_materials (material_library_item_id)"
            )
        )
        conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_portfolio_technology_template_materials_portfolio_item_id ON portfolio_technology_template_materials (portfolio_item_id)"
            )
        )


def ensure_portfolio_items_sqlite_schema(engine: Engine) -> None:
    """SQLite: doplnění sloupců u portfolio_items (create_all nemigruje existující tabulku)."""
    try:
        url = str(engine.url)
    except Exception:
        return
    if not url.startswith("sqlite"):
        return

    insp = sa_inspect(engine)
    if "portfolio_items" not in insp.get_table_names():
        return

    cols = {c["name"] for c in insp.get_columns("portfolio_items")}
    stmts: list[str] = []
    if "sale_price_per_piece" not in cols:
        stmts.append("ALTER TABLE portfolio_items ADD COLUMN sale_price_per_piece FLOAT")
    if "scan_code" not in cols:
        stmts.append("ALTER TABLE portfolio_items ADD COLUMN scan_code VARCHAR(32)")
    if stmts:
        with engine.begin() as conn:
            for stmt in stmts:
                conn.execute(text(stmt))
    # Unikátní scan kód (NULL hodnoty SQLite u UNIQUE ignoruje)
    with engine.begin() as conn:
        conn.execute(
            text("CREATE UNIQUE INDEX IF NOT EXISTS uq_portfolio_items_scan_code ON portfolio_items (scan_code)")
        )


class PortfolioOperationUpsert(BaseModel):
    operation_library_item_id: int | None = None
    workplace_library_item_id: int | None = None
    setup_time_min: float = 0
    labor_time_per_piece_min: float = 0
    control_required: bool = False
    outsourcing: bool = False
    note: str | None = None


class ReorderOperationsBody(BaseModel):
    ordered_operation_ids: list[int]


class PortfolioOperationUpdate(BaseModel):
    operation_no: int | None = None
    operation_library_item_id: int | None = None
    workplace_library_item_id: int | None = None
    setup_time_min: float | None = None
    labor_time_per_piece_min: float | None = None
    control_required: bool | None = None
    outsourcing: bool | None = None
    note: str | None = None


class PortfolioTechnologyMaterialUpsert(BaseModel):
    input_type: str = Field(..., min_length=1)
    material_library_item_id: int | None = None
    portfolio_item_id: int | None = None
    consumption_per_piece: float | None = None
    consumption_unit: str | None = None
    scrap_allowance: float | None = None
    note: str | None = None


class PortfolioTechnologyMaterialUpdate(BaseModel):
    input_type: str | None = None
    material_library_item_id: int | None = None
    portfolio_item_id: int | None = None
    consumption_per_piece: float | None = None
    consumption_unit: str | None = None
    scrap_allowance: float | None = None
    note: str | None = None


class PortfolioItemCreatePayload(BaseModel):
    gpn: str = Field(..., min_length=1)
    name: str = Field(..., min_length=1)
    customer_id: int
    portfolio_group_id: int | None = None
    drawing_no: str | None = None
    revision: str | None = None
    material_default: str | None = None
    logistic_mode: str = "vyroba_zakaznik"
    sale_price_per_piece: float | None = None
    is_active: bool = True

    @field_validator("gpn", "name")
    @classmethod
    def required_trimmed(cls, v: str) -> str:
        s = v.strip()
        if not s:
            raise ValueError("Pole je povinné.")
        return s


class PortfolioItemUpdatePayload(BaseModel):
    gpn: str | None = None
    name: str | None = None
    customer_id: int | None = None
    portfolio_group_id: int | None = None
    drawing_no: str | None = None
    revision: str | None = None
    material_default: str | None = None
    logistic_mode: str | None = None
    sale_price_per_piece: float | None = None
    is_active: bool | None = None


class PortfolioGroupCreatePayload(BaseModel):
    name: str = Field(..., min_length=1)
    customer_id: int
    code: str | None = None
    is_active: bool = True

    @field_validator("name")
    @classmethod
    def name_trim(cls, v: str) -> str:
        s = v.strip()
        if not s:
            raise ValueError("Název je povinný.")
        return s


class PortfolioGroupUpdatePayload(BaseModel):
    name: str | None = None
    customer_id: int | None = None
    code: str | None = None
    is_active: bool | None = None


def _portfolio_group_dict(r: PortfolioGroup) -> dict:
    return {
        "id": r.id,
        "name": r.name,
        "code": r.code,
        "customer_id": r.customer_id,
        "is_active": r.is_active,
    }


def _operation_to_payload(op: PortfolioTechnologyTemplateOperation) -> dict:
    op_name = op.operation_name
    if op.operation_library_item_id is not None and op.operation_library_item is not None:
        op_name = op.operation_library_item.name
    machine = op.workplace
    if op.workplace_library_item_id is not None and op.workplace_library_item is not None:
        machine = op.workplace_library_item.name
    return {
        "id": op.id,
        "operation_no": op.operation_no,
        "operation_name": op_name,
        "machine_code": machine,
        "operation_library_item_id": op.operation_library_item_id,
        "workplace_library_item_id": op.workplace_library_item_id,
        "setup_time_min": op.setup_min,
        "labor_time_per_piece_min": op.run_min_per_piece,
        "control_required": op.control_required,
        "outsourcing": op.outsourcing,
        "note": op.note,
    }


def _material_to_payload(
    row: PortfolioTechnologyTemplateMaterial,
    stock_by_material_id: dict[int, MaterialStockItem] | None = None,
    reserved_by_stock_id: dict[int, float] | None = None,
) -> dict:
    stock_row = None
    if stock_by_material_id is not None:
        stock_row = stock_by_material_id.get(row.material_library_item_id)

    if stock_row is None:
        stock_status = "neni_skladova_karta"
        stock_reserved_qty = None
        stock_available_qty = None
    else:
        rsum = float(reserved_by_stock_id.get(stock_row.id, 0.0)) if reserved_by_stock_id is not None else 0.0
        stock_reserved_qty = rsum
        stock_available_qty = stock_row.current_qty - rsum
        if stock_row.min_qty is not None and stock_row.current_qty < stock_row.min_qty:
            stock_status = "pod_minimem"
        else:
            stock_status = "skladem"

    input_type = (row.input_type or "").strip() or "material"
    return {
        "id": row.id,
        "input_type": input_type,
        "material_library_item_id": row.material_library_item_id,
        "material_name": row.material_library_item.name if row.material_library_item else "",
        "material_code": row.material_library_item.code if row.material_library_item else None,
        "portfolio_item_id": row.portfolio_item_id,
        "portfolio_item_gpn": None,
        "portfolio_item_name": None,
        "consumption_per_piece": row.consumption_per_piece,
        "consumption_unit": row.consumption_unit,
        "scrap_allowance": row.scrap_allowance,
        "note": row.note,
        "stock_item_id": stock_row.id if stock_row else None,
        "stock_location": stock_row.location if stock_row else None,
        "stock_current_qty": stock_row.current_qty if stock_row else None,
        "stock_min_qty": stock_row.min_qty if stock_row else None,
        "stock_reserved_qty": stock_reserved_qty,
        "stock_available_qty": stock_available_qty,
        "stock_status": stock_status,
    }


def _product_input_to_payload(
    row: PortfolioTechnologyTemplateMaterial,
    stock_by_portfolio_id: dict[int, ProductStockItem] | None = None,
) -> dict:
    """Payload pro vstup typu product_stock (výrobek ze skladu)."""
    p = row.portfolio_item
    stock_row = None
    if stock_by_portfolio_id is not None and row.portfolio_item_id is not None:
        stock_row = stock_by_portfolio_id.get(row.portfolio_item_id)

    if stock_row is None:
        stock_status = "neni_skladova_karta"
        stock_reserved_qty = None
        stock_available_qty = None
    else:
        stock_reserved_qty = None
        stock_available_qty = None
        if stock_row.min_qty is not None and stock_row.current_qty < stock_row.min_qty:
            stock_status = "pod_minimem"
        else:
            stock_status = "skladem"

    return {
        "id": row.id,
        "input_type": "product_stock",
        "material_library_item_id": row.material_library_item_id,
        "material_name": "",
        "material_code": None,
        "portfolio_item_id": row.portfolio_item_id,
        "portfolio_item_gpn": p.gpn if p else None,
        "portfolio_item_name": p.name if p else None,
        "consumption_per_piece": row.consumption_per_piece,
        "consumption_unit": row.consumption_unit,
        "scrap_allowance": row.scrap_allowance,
        "note": row.note,
        "stock_item_id": stock_row.id if stock_row else None,
        "stock_location": stock_row.location if stock_row else None,
        "stock_current_qty": stock_row.current_qty if stock_row else None,
        "stock_min_qty": stock_row.min_qty if stock_row else None,
        "stock_reserved_qty": stock_reserved_qty,
        "stock_available_qty": stock_available_qty,
        "stock_status": stock_status,
    }


def _portfolio_item_payload(item: PortfolioItem) -> dict:
    active_template_id = None
    for template in item.technology_templates:
        if template.is_active:
            active_template_id = template.id
            break
    customer_name = item.customer.name if item.customer is not None else None
    group_name = item.group.name if item.group is not None else None
    return {
        "id": item.id,
        "gpn": item.gpn,
        "scan_code": item.scan_code,
        "name": item.name,
        "customer_id": item.customer_id,
        "customer_name": customer_name,
        "group_id": item.portfolio_group_id,
        "group_name": group_name,
        "portfolio_group_id": item.portfolio_group_id,
        "drawing_no": item.drawing_no,
        "revision": item.revision,
        "material_default": item.material_default,
        "logistic_mode": item.logistic_mode,
        "sale_price_per_piece": item.sale_price_per_piece,
        "is_active": item.is_active,
        "active_template_id": active_template_id,
    }


def _load_portfolio_item_for_payload(db: Session, item_id: int) -> PortfolioItem | None:
    return db.scalar(
        select(PortfolioItem)
        .where(PortfolioItem.id == item_id)
        .options(
            selectinload(PortfolioItem.customer),
            selectinload(PortfolioItem.group),
            selectinload(PortfolioItem.technology_templates),
        )
    )


def _validate_portfolio_refs(db: Session, customer_id: int, portfolio_group_id: int | None) -> None:
    customer = db.scalar(select(Customer).where(Customer.id == customer_id))
    if customer is None:
        raise HTTPException(status_code=404, detail="Zákazník nebyl nalezen.")
    if portfolio_group_id is not None:
        grp = db.scalar(select(PortfolioGroup).where(PortfolioGroup.id == portfolio_group_id))
        if grp is None:
            raise HTTPException(status_code=404, detail="Portfolio skupina nebyla nalezena.")


@router.get("/groups")
def list_portfolio_groups(
    customer_id: int | None = Query(
        default=None,
        description="Volitelně vrátí jen skupiny daného zákazníka (stejné customer_id jako u položky portfolia).",
    ),
    db: Session = Depends(get_db),
):
    stmt = select(PortfolioGroup).order_by(PortfolioGroup.name.asc())
    if customer_id is not None:
        stmt = stmt.where(PortfolioGroup.customer_id == customer_id)
    rows = db.scalars(stmt).all()
    return [_portfolio_group_dict(r) for r in rows]


@router.post("/groups")
def create_portfolio_group(payload: PortfolioGroupCreatePayload, db: Session = Depends(get_db)):
    cust = db.scalar(select(Customer).where(Customer.id == payload.customer_id))
    if cust is None:
        raise HTTPException(status_code=404, detail="Zákazník nebyl nalezen.")
    code = payload.code.strip() if payload.code else None
    row = PortfolioGroup(
        customer_id=payload.customer_id,
        name=payload.name.strip(),
        code=code or None,
        is_active=payload.is_active,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _portfolio_group_dict(row)


@router.put("/groups/{group_id}")
def update_portfolio_group(group_id: int, payload: PortfolioGroupUpdatePayload, db: Session = Depends(get_db)):
    row = db.scalar(select(PortfolioGroup).where(PortfolioGroup.id == group_id))
    if row is None:
        raise HTTPException(status_code=404, detail="Skupina portfolia nebyla nalezena.")
    data = payload.model_dump(exclude_unset=True)
    if "customer_id" in data and data["customer_id"] is not None:
        cust = db.scalar(select(Customer).where(Customer.id == data["customer_id"]))
        if cust is None:
            raise HTTPException(status_code=404, detail="Zákazník nebyl nalezen.")
        row.customer_id = data["customer_id"]
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
    return _portfolio_group_dict(row)


@router.delete("/groups/{group_id}")
def delete_portfolio_group(group_id: int, db: Session = Depends(get_db)):
    row = db.scalar(select(PortfolioGroup).where(PortfolioGroup.id == group_id))
    if row is None:
        raise HTTPException(status_code=404, detail="Skupina portfolia nebyla nalezena.")
    n_refs = db.scalar(select(func.count()).select_from(PortfolioItem).where(PortfolioItem.portfolio_group_id == group_id)) or 0
    if n_refs > 0:
        raise HTTPException(
            status_code=409,
            detail="Skupinu nelze smazat — jsou k ní přiřazené portfolio položky.",
        )
    db.delete(row)
    db.commit()
    return {"status": "ok"}


@router.get("/items")
def get_portfolio_items(db: Session = Depends(get_db)):
    items = db.scalars(
        select(PortfolioItem)
        .options(
            selectinload(PortfolioItem.customer),
            selectinload(PortfolioItem.group),
            selectinload(PortfolioItem.technology_templates),
        )
        .order_by(PortfolioItem.gpn.asc())
    ).all()
    return [_portfolio_item_payload(item) for item in items]


@router.post("/items")
def create_portfolio_item(payload: PortfolioItemCreatePayload, db: Session = Depends(get_db)):
    _validate_portfolio_refs(db, payload.customer_id, payload.portfolio_group_id)
    row = PortfolioItem(
        gpn=payload.gpn,
        name=payload.name,
        customer_id=payload.customer_id,
        portfolio_group_id=payload.portfolio_group_id,
        drawing_no=payload.drawing_no.strip() if payload.drawing_no else None,
        revision=payload.revision.strip() if payload.revision else None,
        material_default=payload.material_default.strip() if payload.material_default else None,
        logistic_mode=(payload.logistic_mode or "vyroba_zakaznik").strip() or "vyroba_zakaznik",
        sale_price_per_piece=payload.sale_price_per_piece,
        is_active=payload.is_active,
    )
    db.add(row)
    db.flush()
    if not (row.scan_code and str(row.scan_code).strip()):
        row.scan_code = portfolio_scan_code_for_id(row.id)
    db.commit()
    loaded = _load_portfolio_item_for_payload(db, row.id)
    if loaded is None:
        raise HTTPException(status_code=500, detail="Nepodařilo se načíst vytvořenou položku.")
    return _portfolio_item_payload(loaded)


@router.post("/items/{item_id}/copy")
def copy_portfolio_item(item_id: int, payload: PortfolioItemCreatePayload, db: Session = Depends(get_db)):
    src = db.scalar(
        select(PortfolioItem)
        .where(PortfolioItem.id == item_id)
        .options(
            selectinload(PortfolioItem.technology_templates).selectinload(PortfolioTechnologyTemplate.operations),
            selectinload(PortfolioItem.technology_templates).selectinload(PortfolioTechnologyTemplate.materials),
        )
    )
    if src is None:
        raise HTTPException(status_code=404, detail="Portfolio item not found")

    gpn = payload.gpn.strip()
    dup = db.scalar(select(PortfolioItem.id).where(PortfolioItem.gpn == gpn))
    if dup is not None:
        raise HTTPException(status_code=400, detail="Položka s tímto GPN již existuje.")

    _validate_portfolio_refs(db, payload.customer_id, payload.portfolio_group_id)

    new_item = PortfolioItem(
        gpn=payload.gpn,
        name=payload.name,
        customer_id=payload.customer_id,
        portfolio_group_id=payload.portfolio_group_id,
        drawing_no=payload.drawing_no.strip() if payload.drawing_no else None,
        revision=payload.revision.strip() if payload.revision else None,
        material_default=payload.material_default.strip() if payload.material_default else None,
        logistic_mode=(payload.logistic_mode or "vyroba_zakaznik").strip() or "vyroba_zakaznik",
        sale_price_per_piece=payload.sale_price_per_piece,
        is_active=payload.is_active,
    )
    db.add(new_item)
    db.flush()
    if not (new_item.scan_code and str(new_item.scan_code).strip()):
        new_item.scan_code = portfolio_scan_code_for_id(new_item.id)

    templates = sorted(src.technology_templates, key=lambda t: t.id)
    for tmpl in templates:
        new_tmpl = PortfolioTechnologyTemplate(
            portfolio_item_id=new_item.id,
            name=tmpl.name,
            version=tmpl.version,
            is_active=tmpl.is_active,
        )
        db.add(new_tmpl)
        db.flush()
        for op in sorted(tmpl.operations, key=lambda o: (o.operation_no, o.id)):
            db.add(
                PortfolioTechnologyTemplateOperation(
                    template_id=new_tmpl.id,
                    operation_no=op.operation_no,
                    operation_name=op.operation_name,
                    workplace=op.workplace,
                    operation_library_item_id=op.operation_library_item_id,
                    workplace_library_item_id=op.workplace_library_item_id,
                    setup_min=op.setup_min,
                    run_min_per_piece=op.run_min_per_piece,
                    control_required=op.control_required,
                    outsourcing=op.outsourcing,
                    note=op.note,
                )
            )
        for mat in tmpl.materials:
            db.add(
                PortfolioTechnologyTemplateMaterial(
                    template_id=new_tmpl.id,
                    material_library_item_id=mat.material_library_item_id,
                    consumption_per_piece=mat.consumption_per_piece,
                    consumption_unit=mat.consumption_unit,
                    scrap_allowance=mat.scrap_allowance,
                    note=mat.note,
                )
            )

    db.commit()
    loaded = _load_portfolio_item_for_payload(db, new_item.id)
    if loaded is None:
        raise HTTPException(status_code=500, detail="Nepodařilo se načíst zkopírovanou položku.")
    return _portfolio_item_payload(loaded)


@router.get("/items/{item_id}")
def get_portfolio_item(item_id: int, db: Session = Depends(get_db)):
    item = _load_portfolio_item_for_payload(db, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Portfolio item not found")

    return {
        **_portfolio_item_payload(item),
    }


@router.put("/items/{item_id}")
def update_portfolio_item(item_id: int, payload: PortfolioItemUpdatePayload, db: Session = Depends(get_db)):
    row = db.scalar(select(PortfolioItem).where(PortfolioItem.id == item_id))
    if not row:
        raise HTTPException(status_code=404, detail="Portfolio item not found")

    data = payload.model_dump(exclude_unset=True)
    if "customer_id" in data and data["customer_id"] is not None:
        _validate_portfolio_refs(db, data["customer_id"], data.get("portfolio_group_id", row.portfolio_group_id))
    elif "portfolio_group_id" in data:
        _validate_portfolio_refs(db, row.customer_id, data["portfolio_group_id"])

    if "gpn" in data and data["gpn"] is not None:
        gpn = str(data["gpn"]).strip()
        if not gpn:
            raise HTTPException(status_code=422, detail="gpn je povinné pole")
        row.gpn = gpn
    if "name" in data and data["name"] is not None:
        name = str(data["name"]).strip()
        if not name:
            raise HTTPException(status_code=422, detail="name je povinné pole")
        row.name = name
    if "customer_id" in data and data["customer_id"] is not None:
        row.customer_id = data["customer_id"]
    if "portfolio_group_id" in data:
        row.portfolio_group_id = data["portfolio_group_id"]
    if "drawing_no" in data:
        row.drawing_no = data["drawing_no"].strip() if data["drawing_no"] else None
    if "revision" in data:
        row.revision = data["revision"].strip() if data["revision"] else None
    if "material_default" in data:
        row.material_default = data["material_default"].strip() if data["material_default"] else None
    if "logistic_mode" in data and data["logistic_mode"] is not None:
        mode = str(data["logistic_mode"]).strip()
        row.logistic_mode = mode or row.logistic_mode
    if "sale_price_per_piece" in data:
        row.sale_price_per_piece = data["sale_price_per_piece"]
    if "is_active" in data and data["is_active"] is not None:
        row.is_active = bool(data["is_active"])

    db.commit()
    loaded = _load_portfolio_item_for_payload(db, row.id)
    if loaded is None:
        raise HTTPException(status_code=500, detail="Nepodařilo se načíst upravenou položku.")
    return _portfolio_item_payload(loaded)


@router.delete("/items/{item_id}")
def delete_portfolio_item(item_id: int, db: Session = Depends(get_db)):
    row = db.scalar(select(PortfolioItem).where(PortfolioItem.id == item_id))
    if not row:
        raise HTTPException(status_code=404, detail="Portfolio item not found")
    db.delete(row)
    db.commit()
    return {"status": "ok"}


@router.get("/items/{item_id}/technology")
def get_portfolio_item_technology(item_id: int, db: Session = Depends(get_db)):
    item = db.scalar(select(PortfolioItem).where(PortfolioItem.id == item_id))
    if not item:
        raise HTTPException(status_code=404, detail="Portfolio item not found")

    template = db.scalar(
        select(PortfolioTechnologyTemplate)
        .where(PortfolioTechnologyTemplate.portfolio_item_id == item_id, PortfolioTechnologyTemplate.is_active.is_(True))
        .options(
            selectinload(PortfolioTechnologyTemplate.operations).selectinload(
                PortfolioTechnologyTemplateOperation.operation_library_item
            ),
            selectinload(PortfolioTechnologyTemplate.operations).selectinload(
                PortfolioTechnologyTemplateOperation.workplace_library_item
            ),
        )
        .order_by(PortfolioTechnologyTemplate.id.asc())
    )

    if not template:
        return {
            "template_id": None,
            "template_name": None,
            "operations": [],
        }

    return {
        "template_id": template.id,
        "template_name": template.name,
        "operations": [_operation_to_payload(op) for op in template.operations],
    }


@router.post("/items/{item_id}/technology-template")
def create_item_technology_template(item_id: int, db: Session = Depends(get_db)):
    item = db.scalar(select(PortfolioItem).where(PortfolioItem.id == item_id))
    if not item:
        raise HTTPException(status_code=404, detail="Portfolio item not found")

    existing = db.scalar(
        select(PortfolioTechnologyTemplate)
        .where(
            PortfolioTechnologyTemplate.portfolio_item_id == item_id,
            PortfolioTechnologyTemplate.is_active.is_(True),
        )
        .order_by(PortfolioTechnologyTemplate.id.asc())
    )
    if existing:
        return {
            "template_id": existing.id,
            "template_name": existing.name,
            "created": False,
        }

    template = PortfolioTechnologyTemplate(
        portfolio_item_id=item_id,
        name=f"TP - {item.name}",
        version="A",
        is_active=True,
    )
    db.add(template)
    db.commit()
    db.refresh(template)
    return {
        "template_id": template.id,
        "template_name": template.name,
        "created": True,
    }


@router.post("/templates/{template_id}/operations")
def create_template_operation(
    template_id: int,
    payload: PortfolioOperationUpsert,
    db: Session = Depends(get_db),
):
    template = db.scalar(select(PortfolioTechnologyTemplate).where(PortfolioTechnologyTemplate.id == template_id))
    if not template:
        raise HTTPException(status_code=404, detail="Technology template not found")

    last_operation = db.scalar(
        select(PortfolioTechnologyTemplateOperation)
        .where(PortfolioTechnologyTemplateOperation.template_id == template_id)
        .order_by(PortfolioTechnologyTemplateOperation.operation_no.desc())
        .limit(1)
    )
    next_operation_no = (last_operation.operation_no + 10) if last_operation else 10

    if payload.operation_library_item_id is None:
        raise HTTPException(status_code=422, detail="operation_library_item_id is required")

    op_lib = db.scalar(
        select(OperationLibraryItem).where(OperationLibraryItem.id == payload.operation_library_item_id)
    )
    if not op_lib:
        raise HTTPException(status_code=404, detail="Operation library item not found")

    wp_lib: WorkplaceLibraryItem | None = None
    if payload.workplace_library_item_id is not None:
        wp_lib = db.scalar(
            select(WorkplaceLibraryItem).where(WorkplaceLibraryItem.id == payload.workplace_library_item_id)
        )
        if not wp_lib:
            raise HTTPException(status_code=404, detail="Workplace library item not found")

    row = PortfolioTechnologyTemplateOperation(
        template_id=template_id,
        operation_no=next_operation_no,
        operation_name=op_lib.name,
        workplace=wp_lib.name if wp_lib else None,
        operation_library_item_id=op_lib.id,
        workplace_library_item_id=wp_lib.id if wp_lib else None,
        setup_min=payload.setup_time_min,
        run_min_per_piece=payload.labor_time_per_piece_min,
        control_required=payload.control_required,
        outsourcing=payload.outsourcing,
        note=payload.note,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    row = db.scalar(
        select(PortfolioTechnologyTemplateOperation)
        .where(PortfolioTechnologyTemplateOperation.id == row.id)
        .options(
            selectinload(PortfolioTechnologyTemplateOperation.operation_library_item),
            selectinload(PortfolioTechnologyTemplateOperation.workplace_library_item),
        )
    )
    return _operation_to_payload(row)


@router.get("/items/{item_id}/technology-material")
def get_portfolio_item_technology_material(item_id: int, db: Session = Depends(get_db)):
    item = db.scalar(select(PortfolioItem).where(PortfolioItem.id == item_id))
    if not item:
        raise HTTPException(status_code=404, detail="Portfolio item not found")

    template = db.scalar(
        select(PortfolioTechnologyTemplate)
        .where(PortfolioTechnologyTemplate.portfolio_item_id == item_id, PortfolioTechnologyTemplate.is_active.is_(True))
        .order_by(PortfolioTechnologyTemplate.id.asc())
    )

    if not template:
        return {"template_id": None, "materials": []}

    materials = db.scalars(
        select(PortfolioTechnologyTemplateMaterial)
        .where(PortfolioTechnologyTemplateMaterial.template_id == template.id)
        .options(
            selectinload(PortfolioTechnologyTemplateMaterial.material_library_item),
            selectinload(PortfolioTechnologyTemplateMaterial.portfolio_item),
        )
        .order_by(PortfolioTechnologyTemplateMaterial.id.asc())
    ).all()

    # Legacy řádky bez input_type bereme jako "material".
    material_rows = [
        m
        for m in materials
        if ((m.input_type or "").strip() or "material") == "material"
    ]
    product_rows = [
        m
        for m in materials
        if ((m.input_type or "").strip()) == "product_stock"
    ]

    material_ids = sorted({m.material_library_item_id for m in material_rows if m.material_library_item_id is not None})
    stock_rows = db.scalars(
        select(MaterialStockItem)
        .where(MaterialStockItem.material_library_item_id.in_(material_ids))
        .order_by(
            MaterialStockItem.material_library_item_id.asc(),
            MaterialStockItem.id.asc(),
        )
    ).all() if material_ids else []
    stock_by_material_id: dict[int, MaterialStockItem] = {}
    for stock in stock_rows:
        if stock.material_library_item_id not in stock_by_material_id:
            stock_by_material_id[stock.material_library_item_id] = stock

    stock_ids = [s.id for s in stock_by_material_id.values()]
    reserved_by_stock_id: dict[int, float] = {}
    if stock_ids:
        sums = db.execute(
            select(
                MaterialStockReservation.stock_item_id,
                func.coalesce(func.sum(MaterialStockReservation.reserved_qty), 0.0),
            )
            .where(MaterialStockReservation.stock_item_id.in_(stock_ids))
            .group_by(MaterialStockReservation.stock_item_id)
        ).all()
        reserved_by_stock_id = {int(sid): float(total) for sid, total in sums}

    portfolio_ids = sorted({m.portfolio_item_id for m in product_rows if m.portfolio_item_id is not None})
    product_stock_rows = (
        db.scalars(
            select(ProductStockItem)
            .where(ProductStockItem.portfolio_item_id.in_(portfolio_ids))
            .order_by(ProductStockItem.portfolio_item_id.asc(), ProductStockItem.id.asc())
        ).all()
        if portfolio_ids
        else []
    )
    stock_by_portfolio_id: dict[int, ProductStockItem] = {}
    for s in product_stock_rows:
        if s.portfolio_item_id not in stock_by_portfolio_id:
            stock_by_portfolio_id[s.portfolio_item_id] = s

    return {
        "template_id": template.id,
        "materials": [
            (
                _material_to_payload(row, stock_by_material_id, reserved_by_stock_id)
                if ((row.input_type or "").strip() or "material") == "material"
                else _product_input_to_payload(row, stock_by_portfolio_id)
            )
            for row in materials
        ],
    }


@router.post("/templates/{template_id}/technology-material")
def create_template_technology_material(
    template_id: int,
    payload: PortfolioTechnologyMaterialUpsert,
    db: Session = Depends(get_db),
):
    template = db.scalar(select(PortfolioTechnologyTemplate).where(PortfolioTechnologyTemplate.id == template_id))
    if not template:
        raise HTTPException(status_code=404, detail="Technology template not found")

    input_type = (payload.input_type or "").strip().lower()
    if input_type not in {"material", "product_stock"}:
        raise HTTPException(status_code=422, detail="input_type must be: material / product_stock")

    material_id = payload.material_library_item_id
    portfolio_item_id = payload.portfolio_item_id
    if input_type == "material":
        if material_id is None:
            raise HTTPException(status_code=422, detail="material_library_item_id je povinné pro typ vstupu materiál")
        material = db.scalar(select(MaterialLibraryItem).where(MaterialLibraryItem.id == material_id))
        if not material:
            raise HTTPException(status_code=404, detail="Material library item not found")
        portfolio_item_id = None
    else:
        if portfolio_item_id is None:
            raise HTTPException(status_code=422, detail="portfolio_item_id je povinné pro typ vstupu výrobek ze skladu")
        pitem = db.scalar(select(PortfolioItem).where(PortfolioItem.id == portfolio_item_id))
        if not pitem:
            raise HTTPException(status_code=404, detail="Portfolio item not found")
        if (pitem.logistic_mode or "").strip() != "sklad_zakaznik":
            raise HTTPException(status_code=422, detail="Pro výrobek ze skladu lze vybrat jen položky s režimem sklad_zakaznik")
        material_id = None

    row = PortfolioTechnologyTemplateMaterial(
        template_id=template_id,
        input_type=input_type,
        material_library_item_id=material_id,
        portfolio_item_id=portfolio_item_id,
        consumption_per_piece=payload.consumption_per_piece,
        consumption_unit=payload.consumption_unit,
        scrap_allowance=payload.scrap_allowance,
        note=payload.note,
    )
    db.add(row)
    db.commit()
    db.refresh(row)

    row = db.scalar(
        select(PortfolioTechnologyTemplateMaterial)
        .where(PortfolioTechnologyTemplateMaterial.id == row.id)
        .options(
            selectinload(PortfolioTechnologyTemplateMaterial.material_library_item),
            selectinload(PortfolioTechnologyTemplateMaterial.portfolio_item),
        )
    )
    if ((row.input_type or "").strip() or "material") == "material":
        return _material_to_payload(row)
    return _product_input_to_payload(row)


@router.put("/technology-material/{material_id}")
def update_template_technology_material(
    material_id: int,
    payload: PortfolioTechnologyMaterialUpdate,
    db: Session = Depends(get_db),
):
    row = db.scalar(
        select(PortfolioTechnologyTemplateMaterial).where(PortfolioTechnologyTemplateMaterial.id == material_id)
    )
    if not row:
        raise HTTPException(status_code=404, detail="Technology template material not found")

    data = payload.model_dump(exclude_unset=True)

    # Determine target input_type for validation.
    target_input_type = (row.input_type or "").strip() or "material"
    if "input_type" in data and data["input_type"] is not None:
        t = str(data["input_type"]).strip().lower()
        if t not in {"material", "product_stock"}:
            raise HTTPException(status_code=422, detail="input_type must be: material / product_stock")
        target_input_type = t

    if "material_library_item_id" in data:
        mid = data["material_library_item_id"]
        if target_input_type == "material":
            if mid is None:
                raise HTTPException(status_code=422, detail="material_library_item_id je povinné pro typ vstupu materiál")
            material = db.scalar(select(MaterialLibraryItem).where(MaterialLibraryItem.id == mid))
            if not material:
                raise HTTPException(status_code=404, detail="Material library item not found")
            row.material_library_item_id = mid
        else:
            # product_stock: ignorujeme / vynulujeme materiál
            row.material_library_item_id = None

    if "portfolio_item_id" in data:
        pid = data["portfolio_item_id"]
        if target_input_type == "product_stock":
            if pid is None:
                raise HTTPException(status_code=422, detail="portfolio_item_id je povinné pro typ vstupu výrobek ze skladu")
            pitem = db.scalar(select(PortfolioItem).where(PortfolioItem.id == pid))
            if not pitem:
                raise HTTPException(status_code=404, detail="Portfolio item not found")
            if (pitem.logistic_mode or "").strip() != "sklad_zakaznik":
                raise HTTPException(status_code=422, detail="Pro výrobek ze skladu lze vybrat jen položky s režimem sklad_zakaznik")
            row.portfolio_item_id = pid
        else:
            row.portfolio_item_id = None

    # Apply input_type last (after we potentially nulled incompatible fields).
    row.input_type = target_input_type

    if "consumption_per_piece" in data:
        row.consumption_per_piece = data["consumption_per_piece"]
    if "consumption_unit" in data:
        row.consumption_unit = data["consumption_unit"]
    if "scrap_allowance" in data:
        row.scrap_allowance = data["scrap_allowance"]
    if "note" in data:
        row.note = data["note"]

    db.commit()
    db.refresh(row)
    row = db.scalar(
        select(PortfolioTechnologyTemplateMaterial)
        .where(PortfolioTechnologyTemplateMaterial.id == row.id)
        .options(
            selectinload(PortfolioTechnologyTemplateMaterial.material_library_item),
            selectinload(PortfolioTechnologyTemplateMaterial.portfolio_item),
        )
    )
    if ((row.input_type or "").strip() or "material") == "material":
        return _material_to_payload(row)
    return _product_input_to_payload(row)


@router.delete("/technology-material/{material_id}")
def delete_template_technology_material(material_id: int, db: Session = Depends(get_db)):
    row = db.scalar(
        select(PortfolioTechnologyTemplateMaterial).where(PortfolioTechnologyTemplateMaterial.id == material_id)
    )
    if not row:
        raise HTTPException(status_code=404, detail="Technology template material not found")
    db.delete(row)
    db.commit()
    return {"status": "ok"}


@router.post("/templates/{template_id}/operations/reorder")
def reorder_template_operations(
    template_id: int,
    payload: ReorderOperationsBody,
    db: Session = Depends(get_db),
):
    template = db.scalar(select(PortfolioTechnologyTemplate).where(PortfolioTechnologyTemplate.id == template_id))
    if not template:
        raise HTTPException(status_code=404, detail="Technology template not found")

    operations = db.scalars(
        select(PortfolioTechnologyTemplateOperation)
        .where(PortfolioTechnologyTemplateOperation.template_id == template_id)
        .order_by(
            PortfolioTechnologyTemplateOperation.operation_no.asc(),
            PortfolioTechnologyTemplateOperation.id.asc(),
        )
    ).all()

    existing_ids = {op.id for op in operations}
    ordered = payload.ordered_operation_ids

    if len(ordered) != len(existing_ids):
        raise HTTPException(
            status_code=400,
            detail="ordered_operation_ids must contain exactly all operations for this template",
        )
    if set(ordered) != existing_ids:
        raise HTTPException(
            status_code=400,
            detail="ordered_operation_ids must match template operations exactly",
        )

    id_to_op = {op.id: op for op in operations}
    for idx, op_id in enumerate(ordered):
        id_to_op[op_id].operation_no = (idx + 1) * 10

    db.commit()
    return {"status": "ok"}


@router.put("/template-operations/{operation_id}")
def update_template_operation(
    operation_id: int,
    payload: PortfolioOperationUpdate,
    db: Session = Depends(get_db),
):
    row = db.scalar(
        select(PortfolioTechnologyTemplateOperation).where(PortfolioTechnologyTemplateOperation.id == operation_id)
    )
    if not row:
        raise HTTPException(status_code=404, detail="Technology template operation not found")

    data = payload.model_dump(exclude_unset=True)

    if "operation_no" in data and data["operation_no"] is not None and data["operation_no"] <= 0:
        raise HTTPException(status_code=422, detail="operation_no must be integer > 0")

    if "operation_library_item_id" in data:
        oid = data["operation_library_item_id"]
        if oid is None:
            row.operation_library_item_id = None
        else:
            op_lib = db.scalar(select(OperationLibraryItem).where(OperationLibraryItem.id == oid))
            if not op_lib:
                raise HTTPException(status_code=404, detail="Operation library item not found")
            row.operation_library_item_id = oid
            row.operation_name = op_lib.name

    if "workplace_library_item_id" in data:
        wid = data["workplace_library_item_id"]
        if wid is None:
            row.workplace_library_item_id = None
        else:
            wp_lib = db.scalar(select(WorkplaceLibraryItem).where(WorkplaceLibraryItem.id == wid))
            if not wp_lib:
                raise HTTPException(status_code=404, detail="Workplace library item not found")
            row.workplace_library_item_id = wid
            row.workplace = wp_lib.name

    if "setup_time_min" in data:
        row.setup_min = data["setup_time_min"]
    if "labor_time_per_piece_min" in data:
        row.run_min_per_piece = data["labor_time_per_piece_min"]
    if "control_required" in data:
        row.control_required = data["control_required"]
    if "outsourcing" in data:
        row.outsourcing = data["outsourcing"]
    if "note" in data:
        row.note = data["note"]
    if "operation_no" in data and data["operation_no"] is not None:
        row.operation_no = data["operation_no"]

    if "operation_no" in data and data["operation_no"] is not None:
        operations_in_template = db.scalars(
            select(PortfolioTechnologyTemplateOperation)
            .where(PortfolioTechnologyTemplateOperation.template_id == row.template_id)
            .order_by(
                PortfolioTechnologyTemplateOperation.operation_no.asc(),
                PortfolioTechnologyTemplateOperation.id.asc(),
            )
        ).all()
        for idx, op in enumerate(operations_in_template):
            op.operation_no = (idx + 1) * 10

    db.commit()
    db.refresh(row)
    row = db.scalar(
        select(PortfolioTechnologyTemplateOperation)
        .where(PortfolioTechnologyTemplateOperation.id == row.id)
        .options(
            selectinload(PortfolioTechnologyTemplateOperation.operation_library_item),
            selectinload(PortfolioTechnologyTemplateOperation.workplace_library_item),
        )
    )
    return _operation_to_payload(row)


@router.delete("/template-operations/{operation_id}")
def delete_template_operation(operation_id: int, db: Session = Depends(get_db)):
    row = db.scalar(
        select(PortfolioTechnologyTemplateOperation).where(PortfolioTechnologyTemplateOperation.id == operation_id)
    )
    if not row:
        raise HTTPException(status_code=404, detail="Technology template operation not found")

    db.delete(row)
    db.commit()
    return {"status": "ok"}

