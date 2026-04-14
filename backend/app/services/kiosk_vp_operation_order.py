"""
Kiosk: pořadí operací ve stejném VP (work_order_no) podle operation_no.
Shoda s planner _chain_terminal_completed — dokončené stavy.
"""

from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.planning import PlanningOperation

# Stejné množiny jako planning_engine._chain_terminal_completed (konec řetězce / uvolnění návaznosti).
VP_OPERATION_TERMINAL_STATUSES = frozenset(
    {
        "finished",
        "done",
        "hotovo",
        "complete",
        "completed",
        "cancelled",
    }
)

KIOSK_VP_PREVIOUS_NOT_DONE_DETAIL = (
    "Operaci nelze spustit, protože předchozí operace ve výrobním postupu ještě není dokončena."
)


def is_vp_operation_status_terminal(status: str | None) -> bool:
    return (status or "").strip().lower() in VP_OPERATION_TERMINAL_STATUSES


def assert_vp_previous_operations_finished_for_kiosk_start(db: Session, op: PlanningOperation) -> None:
    """
    START / RESUME na kiosku: všechny operace téhož VP s nižším operation_no musí být v terminálním stavu.
    """
    woo = (op.work_order_no or "").strip()
    if not woo:
        return
    cur_no = int(op.operation_no or 0)
    if cur_no <= 0:
        return
    prevs = db.scalars(
        select(PlanningOperation)
        .where(PlanningOperation.work_order_no == woo)
        .where(PlanningOperation.operation_no < cur_no)
    ).all()
    for p in prevs:
        if not is_vp_operation_status_terminal(p.status):
            raise HTTPException(status_code=400, detail=KIOSK_VP_PREVIOUS_NOT_DONE_DETAIL)
