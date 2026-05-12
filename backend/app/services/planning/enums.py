from enum import Enum


class PlanningStatus(str, Enum):
    UNSCHEDULED = "unscheduled"
    SCHEDULED = "scheduled"
    BLOCKED_MATERIAL = "blocked_material"
    BLOCKED_PREVIOUS_OP = "blocked_previous_op"
    BLOCKED_COOPERATION = "blocked_cooperation"
    LOCKED = "locked"


class PriorityLabel(str, Enum):
    LOW = "low"
    NORMAL = "normal"
    HIGH = "high"
    URGENT = "urgent"


class PlanningRunTriggerReason(str, Enum):
    MANUAL = "manual"
    ORDER_CHANGE = "order_change"
    MATERIAL_RECEIVED = "material_received"
    COOPERATION_RECEIVED = "cooperation_received"
    OPERATION_COMPLETED = "operation_completed"
    PRIORITY_CHANGE = "priority_change"
    OTHER = "other"


class PlanningRunStatus(str, Enum):
    SUCCESS = "success"
    FAILED = "failed"
    PARTIAL = "partial"


class DeadlineRiskLevel(str, Enum):
    # Rezerva > 1 pracovní den před expedicí
    OK = "ok"
    # Rezerva 0-1 pracovní den
    TIGHT = "tight"
    # Výroba doběhne v expedičním bufferu (2 prac. dny před expedicí)
    AT_RISK = "at_risk"
    # Výroba doběhne po datu expedice
    OVERDUE = "overdue"
