from __future__ import annotations

from sqlalchemy.orm import Session


def rollback_material_issue_movements_for_cancelled_production_order(
    db: Session,
    po,
) -> int:
    return 0
