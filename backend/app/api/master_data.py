from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.models.master_data import Machine
router = APIRouter()

@router.get('/machines')
def list_machines(db: Session = Depends(get_db)):
    return list(db.scalars(select(Machine).order_by(Machine.id)).all())
