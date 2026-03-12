from datetime import date
from pydantic import BaseModel

class MoveScheduleItemRequest(BaseModel):
    machine_id: int
    planning_operation_id: int
    direction: str

class ScheduleBuildRequest(BaseModel):
    machine_id: int
    from_date: date
