from sqlalchemy import Column, String
from app.models.planning import PlanningOperation

if not hasattr(PlanningOperation, "work_order_no"):
    PlanningOperation.work_order_no = Column(String(50))
