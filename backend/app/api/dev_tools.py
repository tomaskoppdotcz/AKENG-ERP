from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.services.cleanup_operational_data import MaterialStockCleanupMode, run_cleanup_operational_data

dev_tools_router = APIRouter()


def _parse_material_stock_mode(value: str) -> MaterialStockCleanupMode:
    s = (value or "preserve").strip().lower()
    if s not in ("preserve", "reset"):
        raise HTTPException(
            status_code=422,
            detail='material_stock_mode must be "preserve" or "reset" (see cleanup_operational_data docstring).',
        )
    return s  # type: ignore[return-value]


@dev_tools_router.post("/reset-orders")
def reset_orders(
    db: Session = Depends(get_db),
    apply: bool = Query(
        True,
        description="If false, preview counts only (no deletes). Default true preserves legacy wipe behavior.",
    ),
    material_stock_mode: str = Query(
        "preserve",
        description='Material ledger: "preserve" keeps all movements and recomputes signed qty; '
        '"reset" deletes all movements and zeros stock (full test clean).',
    ),
):
    """
    Legacy endpoint: full operational cleanup. Use ?apply=false for dry-run preview.
    Prefer POST /dev/cleanup-operational-data for explicit apply=false default.
    """
    mode = _parse_material_stock_mode(material_stock_mode)
    if not apply:
        return {"status": "preview", **run_cleanup_operational_data(db, apply=False, material_stock_mode=mode)}
    out = run_cleanup_operational_data(db, apply=True, material_stock_mode=mode)
    return {"status": "ok", **out}


@dev_tools_router.post("/cleanup-operational-data")
def cleanup_operational_data(
    db: Session = Depends(get_db),
    apply: bool = Query(False, description="Execute deletes. Default false = preview only."),
    material_stock_mode: str = Query(
        "preserve",
        description='Material ledger: "preserve" (default) or "reset" — same as reset-orders.',
    ),
):
    """Dev-only: wipe orders, VP, planning, reservations, transactional stock history; keep master data."""
    mode = _parse_material_stock_mode(material_stock_mode)
    if not apply:
        return {"status": "preview", **run_cleanup_operational_data(db, apply=False, material_stock_mode=mode)}
    try:
        out = run_cleanup_operational_data(db, apply=True, material_stock_mode=mode)
        return {"status": "ok", **out}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e
