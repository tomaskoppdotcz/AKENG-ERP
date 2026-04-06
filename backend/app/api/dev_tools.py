from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.services.cleanup_operational_data import preview_counts, run_cleanup_operational_data

dev_tools_router = APIRouter()


@dev_tools_router.post("/reset-orders")
def reset_orders(
    db: Session = Depends(get_db),
    apply: bool = Query(
        True,
        description="If false, preview counts only (no deletes). Default true preserves legacy wipe behavior.",
    ),
):
    """
    Legacy endpoint: full operational cleanup. Use ?apply=false for dry-run preview.
    Prefer POST /dev/cleanup-operational-data for explicit apply=false default.
    """
    if not apply:
        return {"status": "preview", "preview": preview_counts(db)}
    out = run_cleanup_operational_data(db, apply=True)
    return {"status": "ok", **out}


@dev_tools_router.post("/cleanup-operational-data")
def cleanup_operational_data(
    db: Session = Depends(get_db),
    apply: bool = Query(False, description="Execute deletes. Default false = preview only."),
):
    """Dev-only: wipe orders, VP, planning, reservations, transactional stock history; keep master data."""
    if not apply:
        return {"status": "preview", "dry_run": True, "preview": preview_counts(db)}
    try:
        out = run_cleanup_operational_data(db, apply=True)
        return {"status": "ok", **out}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e
