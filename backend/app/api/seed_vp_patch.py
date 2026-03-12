from sqlalchemy.orm import Session
from sqlalchemy import select

from app.models.planning import PlanningOperation


def apply_vp_patch(db: Session):
    ops = db.scalars(select(PlanningOperation)).all()

    counter = 1
    for op in ops:
        vp = f"VP26{counter:04d}"
        setattr(op, "work_order_no", vp)
        counter += 1

    db.commit()
