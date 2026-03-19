from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import text

from app.core.database import get_db

dev_tools_router = APIRouter()


@dev_tools_router.post("/reset-orders")
def reset_orders(db: Session = Depends(get_db)):
    # mazat v poradi podle vazeb
    db.execute(text("DELETE FROM planning_operations"))
    db.execute(text("DELETE FROM machine_schedule"))
    db.execute(text("DELETE FROM operation_events"))
    db.execute(text("DELETE FROM production_orders"))
    db.execute(text("DELETE FROM job_items"))
    db.execute(text("DELETE FROM jobs"))
    db.execute(text("DELETE FROM customer_orders"))

    db.commit()

    return {
        "status": "ok",
        "message": "Orders and production data cleared"
    }
