from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.services.vp_operation_generator import (
    generate_operations_from_vp,
    regenerate_operations_from_tp,
)
from app.services.planning_engine import PlanningEngineService
from datetime import date

router = APIRouter()


@router.post("/from-vp")
def generate_ops(db: Session = Depends(get_db)):
    created = generate_operations_from_vp(db)
    return {
        "operations_created": len(created),
        "sample": created[:20]
    }


@router.post("/regenerate-from-tp")
def regenerate_ops_from_tp(db: Session = Depends(get_db)):
    changed = regenerate_operations_from_tp(db)

    planner = PlanningEngineService(db)
    planner_result = planner.rebuild_all(date.today())

    return {
        "operations_regenerated": len(changed),
        "sample": changed[:20],
        "planner": planner_result,
    }
