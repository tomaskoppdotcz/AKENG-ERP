from datetime import date, timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.master_data import Machine
from app.models.planning import MachineCalendar, PlanningOperation

router = APIRouter()


def normalize_status(value: str | None) -> str:
    s = (value or "").lower()

    if s == "bezi":
        return "bezi"
    if s == "hotovo":
        return "hotovo"
    if s == "blokovano":
        return "blokovano"
    if s == "ceka":
        return "ceka"
    if s == "naplanovano":
        return "naplanovano"

    if s == "planned":
        return "naplanovano"
    if s == "ready":
        return "ceka"
    if s == "waiting_release":
        return "ceka"

    return "naplanovano"


@router.get("/overview")
def get_capacity_overview(days: int = 14, db: Session = Depends(get_db)):
    if days < 1:
        days = 1
    if days > 90:
        days = 90

    from_date = date.today()
    to_date = from_date + timedelta(days=days - 1)

    machines = db.scalars(
        select(Machine)
        .where(Machine.is_active == True)
        .where(Machine.planning_enabled == True)
        .order_by(Machine.name.asc())
    ).all()

    result = []

    for machine in machines:
        calendar_rows = db.scalars(
            select(MachineCalendar)
            .where(MachineCalendar.machine_id == machine.id)
            .where(MachineCalendar.calendar_date >= from_date)
            .where(MachineCalendar.calendar_date <= to_date)
        ).all()

        available_minutes = sum(
            int(row.available_minutes or 0)
            for row in calendar_rows
            if row.is_working_day and row.is_machine_available
        )
        planned_minutes = sum(
            int(row.planned_minutes or 0)
            for row in calendar_rows
            if row.is_working_day and row.is_machine_available
        )
        free_minutes = max(0, available_minutes - planned_minutes)

        machine_ops = db.scalars(
            select(PlanningOperation)
            .where(PlanningOperation.machine_id == machine.id)
        ).all()

        scheduled_operations = sum(
            1 for op in machine_ops if op.planned_start is not None and op.planned_end is not None
        )

        status_counts = {
            "bezi": 0,
            "hotovo": 0,
            "ceka": 0,
            "blokovano": 0,
            "naplanovano": 0,
        }

        for op in machine_ops:
            normalized = normalize_status(op.status)
            if normalized in status_counts:
                status_counts[normalized] += 1
            else:
                status_counts["naplanovano"] += 1

        utilization_percent = 0
        if available_minutes > 0:
            utilization_percent = round((planned_minutes / available_minutes) * 100, 1)

        result.append(
            {
                "machine_id": machine.id,
                "machine_name": machine.name,
                "machine_code": machine.machine_code,
                "days": days,
                "from_date": from_date.isoformat(),
                "to_date": to_date.isoformat(),
                "available_minutes": available_minutes,
                "planned_minutes": planned_minutes,
                "free_minutes": free_minutes,
                "utilization_percent": utilization_percent,
                "scheduled_operations": scheduled_operations,
                "live_status": status_counts,
            }
        )

    total_live_status = {
        "bezi": sum(x["live_status"]["bezi"] for x in result),
        "hotovo": sum(x["live_status"]["hotovo"] for x in result),
        "ceka": sum(x["live_status"]["ceka"] for x in result),
        "blokovano": sum(x["live_status"]["blokovano"] for x in result),
        "naplanovano": sum(x["live_status"]["naplanovano"] for x in result),
    }

    return {
        "days": days,
        "from_date": from_date.isoformat(),
        "to_date": to_date.isoformat(),
        "machines": result,
        "live_status": total_live_status,
    }
