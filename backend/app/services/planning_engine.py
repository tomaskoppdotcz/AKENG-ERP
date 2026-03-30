from datetime import date, datetime, time, timedelta
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.models.planning import PlanningOperation, MachineCalendar, MachineSchedule
from app.models.orders import JobItem
from app.models.technology_library import TechnologyTemplate


PRODUCT_GROUP_PRIORITY = {
    "krouzek": 1,
    "pouzdro": 2,
    "priruba": 3,
    "adapter": 4,
}


class PlanningEngineService:
    def __init__(self, db: Session):
        self.db = db

    def _combine_shift_start(self, d: date) -> datetime:
        return datetime.combine(d, time(hour=6, minute=0))

    def _get_machine_days(self, machine_id: int, from_date: date):
        return self.db.scalars(
            select(MachineCalendar)
            .where(MachineCalendar.machine_id == machine_id)
            .where(MachineCalendar.calendar_date >= from_date)
            .order_by(MachineCalendar.calendar_date.asc())
        ).all()

    def _get_product_group(self, op: PlanningOperation):
        template = self.db.scalar(
            select(TechnologyTemplate).where(TechnologyTemplate.gpn == op.gpn)
        )
        if not template or not template.product_group:
            return "nezarazeno"
        return template.product_group.strip()

    def _get_due_date(self, op: PlanningOperation):
        raw = op.expedition_date
        if not raw:
            return date.max
        if isinstance(raw, date):
            return raw
        if isinstance(raw, datetime):
            return raw.date()
        try:
            return date.fromisoformat(str(raw))
        except Exception:
            return date.max

    def _group_priority(self, product_group: str):
        key = (product_group or "").strip().lower()
        return PRODUCT_GROUP_PRIORITY.get(key, 99)

    def _smart_sort_key(self, op: PlanningOperation):
        due = self._get_due_date(op)
        group = self._get_product_group(op)
        group_priority = self._group_priority(group)

        diameter = op.input_diameter_mm if op.input_diameter_mm is not None else 999999
        diameter_bucket = round(float(diameter), 1) if diameter != 999999 else 999999

        return (
            due,
            group_priority,
            group.lower(),
            diameter_bucket,
            op.operation_no or 9999,
            op.work_order_no or "",
            op.id,
        )

    def _get_ready_ops(self, machine_id: int):
        ops = self.db.scalars(
            select(PlanningOperation)
            .where(PlanningOperation.machine_id == machine_id)
            .where(PlanningOperation.status.in_(["ready", "planned"]))
        ).all()

        # 1) Operace s explicitnim queue_position ber jako uzivatelsky urcene poradi
        queued_ops = [op for op in ops if op.queue_position is not None]
        queued_ops_sorted = sorted(
            queued_ops,
            key=lambda op: (
                op.queue_position,
                op.id,
            ),
        )

        # 2) Operace bez queue_position dopln za ne podle smart planner logiky
        unqueued_ops = [op for op in ops if op.queue_position is None]
        unqueued_ops_sorted = sorted(unqueued_ops, key=self._smart_sort_key)

        return queued_ops_sorted + unqueued_ops_sorted

    def rebuild_machine_schedule(self, machine_id: int, from_date: date):
        self.db.execute(
            delete(MachineSchedule).where(MachineSchedule.machine_id == machine_id)
        )

        days = self._get_machine_days(machine_id, from_date)

        for day in days:
            day.planned_minutes = 0

        ops = self._get_ready_ops(machine_id)
        ops = [op for op in ops if op.material_ready]
        if not ops:
            self.db.commit()
            return []

        queue_position = 1
        created = []

        day_index = 0
        current_pointer = None

        for op in ops:
            total_time = int(round(float(op.total_operation_time_min or 0)))
            if total_time <= 0:
                total_time = int(round(float(op.setup_time_min or 0) + float(op.total_labor_time_min or 0)))

            placed = False

            while not placed:
                if day_index >= len(days):
                    last_day = days[-1].calendar_date if days else from_date
                    new_day_date = last_day + timedelta(days=1)

                    new_day = MachineCalendar(
                        machine_id=machine_id,
                        calendar_date=new_day_date,
                        available_minutes=450,
                        planned_minutes=0,
                        maintenance_minutes=0,
                        reserved_minutes=0,
                        is_working_day=True,
                        is_machine_available=True,
                        note=None,
                    )
                    self.db.add(new_day)
                    self.db.flush()
                    days.append(new_day)

                day = days[day_index]

                if not day.is_working_day or not day.is_machine_available:
                    day_index += 1
                    current_pointer = None
                    continue

                available = int(day.available_minutes or 0)
                planned = int(day.planned_minutes or 0)
                maintenance = int(day.maintenance_minutes or 0)
                reserved = int(day.reserved_minutes or 0)

                free = available - planned - maintenance - reserved
                if free <= 0:
                    day_index += 1
                    current_pointer = None
                    continue

                if total_time > free:
                    day_index += 1
                    current_pointer = None
                    continue

                if current_pointer is None:
                    current_pointer = self._combine_shift_start(day.calendar_date) + timedelta(minutes=planned)

                planned_start = current_pointer
                planned_end = planned_start + timedelta(minutes=total_time)

                op.queue_position = queue_position
                op.planned_start = planned_start
                op.planned_end = planned_end
                op.status = "planned"

                sched = MachineSchedule(
                    machine_id=machine_id,
                    planning_operation_id=op.id,
                    queue_position=queue_position,
                    planned_start=planned_start,
                    planned_end=planned_end,
                    setup_time_min=float(op.setup_time_min or 0),
                    labor_time_total_min=float(op.total_labor_time_min or 0),
                    total_time_min=float(total_time),
                    status="planned",
                )
                self.db.add(sched)

                day.planned_minutes = planned + total_time
                current_pointer = planned_end
                queue_position += 1
                placed = True
                created.append(sched)

        self.db.commit()
        return created

    def rebuild_all(self, from_date: date):
        machine_ids = self.db.scalars(
            select(PlanningOperation.machine_id).distinct()
        ).all()

        result = []
        for machine_id in machine_ids:
            if machine_id is None:
                continue
            rows = self.rebuild_machine_schedule(machine_id, from_date)
            result.append(
                {
                    "machine_id": machine_id,
                    "scheduled_rows": len(rows),
                }
            )
        return result
