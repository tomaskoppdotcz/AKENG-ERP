from sqlalchemy import Column, String
from app.models.planning import PlanningOperation

# pokud model ještě nemá sloupec work_order_no
if not hasattr(PlanningOperation, "work_order_no"):
    PlanningOperation.work_order_no = Column(String(50))
