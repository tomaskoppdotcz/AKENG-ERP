import logging
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta

from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from app.models.planning import PlanningOperation, MachineCalendar, MachineSchedule, PlanningScheduleSegment
from app.models.orders import ProductionOrder
from app.models.technology_library import TechnologyTemplate
from app.services.planning_operation_status import (
    normalize_planning_operation_status,
    planning_operation_status_is_terminal,
)
from app.services.vp_operation_generator import normalize_planning_queue_statuses_for_vp_code


logger = logging.getLogger(__name__)

PRODUCT_GROUP_PRIORITY = {
    "krouzek": 1,
    "pouzdro": 2,
    "priruba": 3,
    "adapter": 4,
}

# Minuty mezi koncem předchozí a začátkem následující operace téhož VP (přesun / předání).
VP_INTER_OPERATION_BUFFER_MIN = 15

# Nové placementy nesmí začínat v minulosti (od „teď“ + malý buffer; u dnešního dne navíc min. začátek směny).
SCHEDULING_NOW_BUFFER_MIN = 5

# expedice zákazníka (expedition_date) ≠ konec výroby: výroba musí skončit dříve, rezerva na expedici / logistiku.
MANUFACTURING_BUFFER_DAYS_BEFORE_EXPEDITION = 2

# Operace v této „rezervě“ smějí končit nejpozději v den expedition_date (ne jen do manufacturing_deadline).
_RESERVE_WINDOW_NAME_KEYS = (
    "exped",
    "expedition",
    "balen",
    "balení",
    "logist",
    "přeprav",
    "preprav",
    "shipping",
    "pack",
    "odesl",
    "sklad",  # příprava k expedici na skladě
    "manipul",
)

# Nelze automaticky vložit do kapacity před manufacturing_deadline / expedition — další běh plánovače zkusí znovu.
SCHEDULING_LATE_STATUS = "scheduling_late"


def _chain_terminal_completed(status: str | None) -> bool:
    return planning_operation_status_is_terminal(status)


def _shopfloor_active(status: str | None) -> bool:
    return normalize_planning_operation_status(status) == "bezi"


@dataclass
class _VPScheduleUnit:
    woo: str
    ops: list[PlanningOperation]
    target_finish_dt: datetime
    remaining_chain_min: int
    product_group: str
    group_priority: int
    diameter_bucket: float
    safe_for_grouping: bool
    production_order_id: int | None


class PlanningEngineService:
    """
    Rozvrh po machine_id + machine_calendar (legacy tabulky).
    Pracoviště z knihovny (workplace_library_items) je kanonický zdroj řádků v Planner Gantt;
    stroj s workplace_library_item_id je plánovací kotva — později lze available_minutes
    odvozovat z WorkplaceLibraryItem.daily_capacity_hours a absencí.

    Globální přestavba rozvrhu: VP s vydaným materiálem na výrobu (production_orders) — sekvenční routing
    všech způsobilých operací, mezera VP_INTER_OPERATION_BUFFER_MIN mezi operacemi téhož VP, jedna operace
    na stroji v čase. Řádky planning_operations musí mít material_ready (Gantt / sklad).
    """

    def __init__(self, db: Session):
        self.db = db

    def _combine_shift_start(self, d: date) -> datetime:
        return datetime.combine(d, time(hour=6, minute=0))

    def _shift_start_datetime(self, day: MachineCalendar) -> datetime:
        """Začátek směny pro řádek kalendáře; NULL shift_start_minutes = legacy 06:00."""
        sm = getattr(day, "shift_start_minutes", None)
        if sm is None:
            return self._combine_shift_start(day.calendar_date)
        sm = int(sm)
        return datetime.combine(day.calendar_date, time(hour=sm // 60, minute=sm % 60))

    def _shift_end_datetime(self, day: MachineCalendar) -> datetime:
        """Konec denního okna kapacity: začátek směny + available_minutes (může přejít na další kalendářní den u noční směny)."""
        return self._shift_start_datetime(day) + timedelta(minutes=int(day.available_minutes or 0))

    def _earliest_wall_clock_floor_for_calendar_day(
        self, calendar_day: date, day_row: MachineCalendar | None = None
    ) -> datetime | None:
        """
        Pro kalendářní dny dnes a dříve: spodní hranice začátku slotu = max(začátek směny, teď + buffer).
        Pro budoucí kalendářní dny vrací None — stačí logika směny z kalendáře.
        """
        if calendar_day > date.today():
            return None
        shift = self._shift_start_datetime(day_row) if day_row is not None else self._combine_shift_start(calendar_day)
        return max(shift, datetime.now() + timedelta(minutes=SCHEDULING_NOW_BUFFER_MIN))

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
            s = str(raw).strip()
            if len(s) >= 10 and s[4] == "-" and s[7] == "-":
                return date.fromisoformat(s[:10])
            return date.fromisoformat(s)
        except Exception:
            return date.max

    def _operation_in_reserve_logistics_window(self, op: PlanningOperation) -> bool:
        """Expedice / balení / logistika — smí běžet v posledních dnech před expedition_date."""
        name = (op.operation_name or "").strip().lower()
        return any(k in name for k in _RESERVE_WINDOW_NAME_KEYS)

    def _manufacturing_deadline_dt(self, ops: list[PlanningOperation]) -> datetime:
        """Poslední okamžik ukončení výrobní fáze: konec dne (expedition_date − N dní)."""
        dues = [self._get_due_date(o) for o in ops]
        due = min(dues) if dues else date.max
        if due == date.max:
            return datetime.combine(date.max, time(23, 59, 59))
        d = due - timedelta(days=MANUFACTURING_BUFFER_DAYS_BEFORE_EXPEDITION)
        return datetime.combine(d, time(23, 59, 59))

    def _expedition_latest_end_dt(self, ops: list[PlanningOperation]) -> datetime:
        """Poslední okamžik pro operace v rezervě (expedice) — konec dne expedition_date."""
        dues = [self._get_due_date(o) for o in ops]
        due = min(dues) if dues else date.max
        if due == date.max:
            return datetime.combine(date.max, time(23, 59, 59))
        return datetime.combine(due, time(23, 59, 59))

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

    def _vp_target_finish_dt(self, ops: list[PlanningOperation]) -> datetime:
        """Stejné jako konec výrobního okna — pro řazení VP a kontrolu „vejde se řetězec“. """
        return self._manufacturing_deadline_dt(ops)

    def _remaining_vp_chain_minutes(self, ordered_ops: list[PlanningOperation]) -> int:
        total = 0
        first = True
        for o in ordered_ops:
            if _chain_terminal_completed(o.status):
                continue
            dur = self._operation_duration_min(o)
            if dur <= 0:
                dur = 1
            if not first:
                total += VP_INTER_OPERATION_BUFFER_MIN
            total += dur
            first = False
        return int(total)

    def _ideal_earliest_finish(
        self, floor: datetime, vp_resume: datetime | None, remaining_chain_min: int
    ) -> datetime:
        t0 = max(floor, vp_resume or floor)
        return t0 + timedelta(minutes=int(remaining_chain_min))

    def _apply_safe_grouping_reorder(self, units: list[_VPScheduleUnit]) -> tuple[list[_VPScheduleUnit], bool]:
        """Reorder consecutive 'safe' VPs by product group + diameter; returns (new_list, grouping_applied)."""
        if len(units) <= 1:
            return units, False
        strict_keys = [u.woo for u in units]
        out: list[_VPScheduleUnit] = []
        i = 0
        while i < len(units):
            if not units[i].safe_for_grouping:
                out.append(units[i])
                i += 1
                continue
            j = i
            while j < len(units) and units[j].safe_for_grouping:
                j += 1
            chunk = list(units[i:j])
            chunk.sort(
                key=lambda u: (
                    u.group_priority,
                    (u.product_group or "").lower(),
                    u.diameter_bucket,
                    u.target_finish_dt,
                    u.remaining_chain_min,
                    u.woo,
                )
            )
            out.extend(chunk)
            i = j
        return out, [u.woo for u in out] != strict_keys

    def _schedulable_status(self, status: str | None) -> bool:
        st = (status or "").strip().lower()
        return st in {"ready", "planned", "waiting_release", SCHEDULING_LATE_STATUS}

    def _operation_duration_min(self, op: PlanningOperation) -> int:
        total_time = int(round(float(op.total_operation_time_min or 0)))
        if total_time <= 0:
            total_time = int(round(float(op.setup_time_min or 0) + float(op.total_labor_time_min or 0)))
        return max(total_time, 0)

    def _vp_chain_buffer(self) -> timedelta:
        return timedelta(minutes=VP_INTER_OPERATION_BUFFER_MIN)

    def _bump_chain_cursor_after_op_end(
        self,
        chain_cursor: datetime,
        op: PlanningOperation,
        *,
        buf: timedelta,
    ) -> datetime:
        """Posune řetězec VP o konec operace (+ mezioperační buffer). Používá actual_end, jinak planned_end."""
        end = op.actual_end or op.planned_end
        if end is None:
            return chain_cursor
        return max(chain_cursor, end + buf)

    def _vp_resume_after_completed_ops(self, lst: list[PlanningOperation]) -> datetime | None:
        """Nejpozdější (konec + buffer) napříč již dokončenými operacemi VP."""
        buf = self._vp_chain_buffer()
        ordered = sorted(lst, key=lambda o: (o.operation_no or 9999, o.id))
        latest: datetime | None = None
        for op in ordered:
            if not _chain_terminal_completed(op.status):
                continue
            end = op.actual_end or op.planned_end
            if end is None:
                continue
            cand = end + buf
            latest = cand if latest is None else max(latest, cand)
        return latest

    def _sequential_predecessor_earliest_start(
        self,
        ordered: list[PlanningOperation],
        op: PlanningOperation,
        floor: datetime,
        buf: timedelta,
    ) -> datetime:
        """
        Spodní hranice začátku operace `op`: max(floor, všechny předchůdci v TP pořadí podle
        actual_end / planned_end + buffer). Zajistí pořadí i když chain_cursor mezistav neodpovídá.
        """
        t = floor
        for prev in ordered:
            if prev.id == op.id:
                break
            t = self._bump_chain_cursor_after_op_end(t, prev, buf=buf)
        return t

    def _machine_state(self, machine_id: int, from_date: date, cache: dict) -> dict:
        if machine_id not in cache:
            cache[machine_id] = {
                "days": list(self._get_machine_days(machine_id, from_date)),
                "day_index": 0,
                "current_pointer": None,
                "queue_position": 0,
            }
        return cache[machine_id]

    def _realign_machine_calendar_planned_minutes_from_schedules(self) -> None:
        """
        planned_minutes musí odpovídat součtu total_time_min z machine_schedule na daný den (machine_id + datum začátku).
        Po smazání řádků machine_schedule rebuildem zůstávaly staré planned_minutes → dny vypadaly plné bez záznamů v rozvrhu.
        """
        self.db.execute(update(MachineCalendar).values(planned_minutes=0))

        sched_rows = self.db.scalars(select(MachineSchedule)).all()
        totals: dict[tuple[int, date], int] = defaultdict(int)
        for s in sched_rows:
            ps = s.planned_start
            if ps is None:
                continue
            d = ps.date() if isinstance(ps, datetime) else ps
            if not isinstance(d, date):
                continue
            tm = int(round(float(s.total_time_min or 0)))
            if tm <= 0:
                tm = 1
            totals[(int(s.machine_id), d)] += tm

        for (mid, cal_date), minutes in totals.items():
            row = self.db.scalar(
                select(MachineCalendar)
                .where(MachineCalendar.machine_id == mid)
                .where(MachineCalendar.calendar_date == cal_date)
            )
            if row is None:
                row = MachineCalendar(
                    machine_id=mid,
                    calendar_date=cal_date,
                    available_minutes=450,
                    planned_minutes=0,
                    maintenance_minutes=0,
                    reserved_minutes=0,
                    is_working_day=True,
                    is_machine_available=True,
                    note=None,
                )
                self.db.add(row)
            row.planned_minutes = int(minutes)

        self.db.flush()

    def _remaining_manufacturing_tail_minutes(self, ordered: list[PlanningOperation], start_op: PlanningOperation) -> int:
        """Suma trvání + mezer od start_op do konce souvislého bloku výroby (před první rezervní operací)."""
        idx = next((i for i, o in enumerate(ordered) if o is start_op), -1)
        if idx < 0:
            return self._operation_duration_min(start_op) or 1
        total = 0
        first = True
        for o in ordered[idx:]:
            if _chain_terminal_completed(o.status):
                continue
            if self._operation_in_reserve_logistics_window(o):
                break
            dur = self._operation_duration_min(o)
            if dur <= 0:
                dur = 1
            if not first:
                total += VP_INTER_OPERATION_BUFFER_MIN
            total += dur
            first = False
        return max(int(total), 1)

    def _remaining_reserve_tail_minutes(self, ordered: list[PlanningOperation], start_op: PlanningOperation) -> int:
        """Od rezervní operace do konce řetězce (jen rezervní a následující)."""
        idx = next((i for i, o in enumerate(ordered) if o is start_op), -1)
        if idx < 0:
            return self._operation_duration_min(start_op) or 1
        if not self._operation_in_reserve_logistics_window(start_op):
            return self._remaining_manufacturing_tail_minutes(ordered, start_op)
        total = 0
        first = True
        for o in ordered[idx:]:
            if _chain_terminal_completed(o.status):
                continue
            if not self._operation_in_reserve_logistics_window(o):
                break
            dur = self._operation_duration_min(o)
            if dur <= 0:
                dur = 1
            if not first:
                total += VP_INTER_OPERATION_BUFFER_MIN
            total += dur
            first = False
        return max(int(total), 1)

    def _place_one_operation(
        self,
        *,
        machine_id: int,
        from_date: date,
        earliest_start: datetime,
        total_time: int,
        state: dict,
        latest_end: datetime | None = None,
    ) -> tuple[datetime, datetime, list[tuple[datetime, datetime, int]]] | None:
        """
        Umístí operaci do [shift_start, shift_start + available_minutes] po segmentech (konec směny =
        hranice). Vrací (začátek prvního segmentu, konec posledního segmentu).

        Důležité: práce se bere po segmentech `min(remaining, free, room[, deadline])`; mezi segmenty
        může být pauza (noc). `planning_schedule_segments` nesou skutečné úseky — wall-clock mezi
        `planned_start` a `planned_end` nesmí interpretovat jako souvislou práci. Po předchozí
        operaci na stejném stroji zůstává `current_pointer` na konci úseku, takže návazná operace
        začíná téhož dne po `earliest_start`, pokud ve směně zbývá kapacita (nepřeskakovat den).
        """
        if total_time <= 0:
            total_time = 1
        if latest_end is not None and earliest_start > latest_end:
            return None
        st = self._machine_state(machine_id, from_date, state)
        days: list = st["days"]
        day_index = st["day_index"]
        current_pointer: datetime | None = st["current_pointer"]

        remaining = int(total_time)
        first_start: datetime | None = None
        last_end: datetime | None = None
        segments: list[tuple[datetime, datetime, int]] = []
        op_has_started = False
        guard = 0

        while remaining > 0:
            guard += 1
            if guard > 5000:
                logger.warning("[planning_engine] _place_one_operation guard break machine_id=%s", machine_id)
                return None
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

            if latest_end is not None and day.calendar_date > latest_end.date():
                return None

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

            shift_end = self._shift_end_datetime(day)
            shift_start = self._shift_start_datetime(day)
            if shift_end <= shift_start:
                day_index += 1
                current_pointer = None
                continue

            if current_pointer is None:
                current_pointer = shift_start + timedelta(minutes=planned)
            if not op_has_started:
                current_pointer = max(current_pointer, earliest_start)
            wc_floor = self._earliest_wall_clock_floor_for_calendar_day(day.calendar_date, day)
            # Stejnodenní zbytek směny po návaznosti (jiný stroj / WP): nesmíme nechat „teď“ vyhodit
            # celý den, když earliest_start je ještě uvnitř [shift_start, shift_end) toho kalendářního dne
            # (typicky večer / přepočet: wc_floor >= shift_end → jinak by se přeskočilo na další den 06:00).
            if (
                wc_floor is not None
                and shift_end > shift_start
                and earliest_start.date() == day.calendar_date
                and earliest_start < shift_end
                and wc_floor >= shift_end
            ):
                wc_floor = None
            if wc_floor is not None:
                current_pointer = max(current_pointer, wc_floor)
            if current_pointer.date() > day.calendar_date:
                day_index += 1
                current_pointer = None
                continue

            if current_pointer >= shift_end:
                day_index += 1
                current_pointer = None
                continue

            room = int((shift_end - current_pointer).total_seconds() // 60)
            if room <= 0:
                day_index += 1
                current_pointer = None
                continue

            chunk_cap = min(remaining, free, room)
            if latest_end is not None:
                if current_pointer > latest_end:
                    return None
                deadline_room = int((latest_end - current_pointer).total_seconds() // 60)
                if deadline_room <= 0:
                    return None
                chunk_cap = min(chunk_cap, deadline_room)

            chunk = chunk_cap

            if chunk <= 0:
                day_index += 1
                current_pointer = None
                continue

            seg_start = current_pointer
            seg_end = seg_start + timedelta(minutes=chunk)
            if seg_end > shift_end:
                chunk = max(0, int((shift_end - seg_start).total_seconds() // 60))
                if chunk <= 0:
                    day_index += 1
                    current_pointer = None
                    continue
                seg_end = seg_start + timedelta(minutes=chunk)

            day.planned_minutes = planned + chunk
            current_pointer = seg_end
            remaining -= chunk
            op_has_started = True
            segments.append((seg_start, seg_end, int(chunk)))
            if first_start is None:
                first_start = seg_start
            last_end = seg_end

            if current_pointer >= shift_end:
                day_index += 1
                current_pointer = None

        st["day_index"] = day_index
        st["current_pointer"] = current_pointer
        if first_start is None or last_end is None:
            return None
        return first_start, last_end, segments

    def _per_op_schedule_gate(
        self, ordered: list[PlanningOperation], released: bool
    ) -> dict[int, str | None]:
        """Per-operation reason if not auto-scheduled; None = eligible in VP chain."""
        out: dict[int, str | None] = {}
        if not released:
            for o in ordered:
                out[int(o.id)] = "vp_not_material_released_to_production"
            return out
        chain_blocked: str | None = None
        for o in ordered:
            oid = int(o.id)
            if _chain_terminal_completed(o.status):
                out[oid] = "operation_completed"
                continue
            if chain_blocked:
                out[oid] = chain_blocked
                continue
            if _shopfloor_active(o.status):
                out[oid] = "shopfloor_active_not_auto_scheduled"
                chain_blocked = "blocked_after_shopfloor_active_op"
                continue
            if not bool(getattr(o, "material_ready", False)):
                out[oid] = "material_not_ready"
                chain_blocked = "blocked_after_material_not_ready"
                continue
            if not self._schedulable_status(o.status):
                out[oid] = "status_not_schedulable"
                chain_blocked = "blocked_after_non_schedulable_status"
                continue
            out[oid] = None
        return out

    def rebuild_global_schedules(self, from_date: date) -> list[MachineSchedule]:
        """
        Smaže machine_schedule (kromě běžících operací), vyčistí plánovací časy u řádků bez dokončení/obsazení,
        znovu naplánuje VP s is_material_released_to_production: celý řetězec operací vpřed, sekvenčně v rámci VP,
        bez překryvu na stroji, s prioritou target_finish (konec výroby = expedice − 2 dny rezerva expedici)
        a seskupením podle typu + průměru jen u „safe“ VP. Operace nad kapacitu před termínem: status scheduling_late.
        """
        shift_floor = self._combine_shift_start(from_date)
        wc_floor_from = self._earliest_wall_clock_floor_for_calendar_day(from_date)
        floor = max(shift_floor, wc_floor_from) if wc_floor_from is not None else shift_floor
        all_ops = self.db.scalars(
            select(PlanningOperation).where(PlanningOperation.machine_id.isnot(None))
        ).all()

        by_woo: dict[str, list[PlanningOperation]] = defaultdict(list)
        for op in all_ops:
            w = (op.work_order_no or "").strip()
            if w:
                by_woo[w].append(op)

        woo_keys = [w for w in by_woo.keys() if w]
        po_by_vp: dict[str, ProductionOrder] = {}
        if woo_keys:
            for row in self.db.scalars(
                select(ProductionOrder).where(ProductionOrder.vp_code.in_(woo_keys))
            ).all():
                k = (row.vp_code or "").strip()
                if k:
                    po_by_vp[k] = row

        group_cache: dict[str, str] = {}

        def product_group_cached(op: PlanningOperation) -> str:
            gk = (op.gpn or "").strip()
            if gk not in group_cache:
                group_cache[gk] = self._get_product_group(op)
            return group_cache[gk]

        diag_rows: list[dict] = []
        eligible: list[PlanningOperation] = []
        skipped_vps = 0
        for woo, lst in by_woo.items():
            pr = po_by_vp.get(woo)
            released = bool(pr and getattr(pr, "is_material_released_to_production", False))
            if not released:
                skipped_vps += 1
            ordered = sorted(lst, key=lambda o: (o.operation_no or 9999, o.id))
            vp_resume = self._vp_resume_after_completed_ops(ordered)
            gates = self._per_op_schedule_gate(ordered, released)
            for op in ordered:
                mat = bool(getattr(op, "material_ready", False))
                reason = gates.get(int(op.id))
                is_eligible = reason is None
                if is_eligible:
                    eligible.append(op)
                diag_rows.append(
                    {
                        "planning_operation_id": int(op.id),
                        "work_order_no": op.work_order_no,
                        "operation_no": int(op.operation_no or 0),
                        "status": op.status,
                        "material_ready": mat,
                        "vp_material_released": released,
                        "vp_resume_after_completed": vp_resume.isoformat() if vp_resume else None,
                        "eligible_for_schedule": is_eligible,
                        "exclusion_reason": reason if not is_eligible else None,
                    }
                )

        for op in all_ops:
            w = (op.work_order_no or "").strip()
            if w:
                continue
            mat = bool(getattr(op, "material_ready", False))
            diag_rows.append(
                {
                    "planning_operation_id": int(op.id),
                    "work_order_no": op.work_order_no,
                    "operation_no": int(op.operation_no or 0),
                    "status": op.status,
                    "material_ready": mat,
                    "vp_material_released": False,
                    "vp_resume_after_completed": None,
                    "eligible_for_schedule": False,
                    "exclusion_reason": "orphan_no_vp_code",
                }
            )

        exc_counts = Counter(
            str(r["exclusion_reason"])
            for r in diag_rows
            if r.get("exclusion_reason")
        )
        logger.info(
            "[planning_engine] rebuild_global_diag eligible_count=%s picked_count=%s exclusion_reason_counts=%s sample=%s",
            len(eligible),
            len(eligible),
            dict(exc_counts),
            diag_rows[:60] if len(diag_rows) > 60 else diag_rows,
        )
        print(
            "[PLANNER_DIAG] rebuild_global_schedules START "
            f"from_date={from_date.isoformat()} planning_ops_with_machine={len(all_ops)} "
            f"eligible_count={len(eligible)} picked_count={len(eligible)} "
            f"exclusion_reason_counts={dict(exc_counts)}",
            flush=True,
        )

        protect_ids = [int(o.id) for o in all_ops if _shopfloor_active(o.status)]
        if protect_ids:
            self.db.execute(
                delete(MachineSchedule).where(MachineSchedule.planning_operation_id.not_in(protect_ids))
            )
            self.db.execute(
                delete(PlanningScheduleSegment).where(
                    PlanningScheduleSegment.planning_operation_id.not_in(protect_ids)
                )
            )
        else:
            self.db.execute(delete(MachineSchedule))
            self.db.execute(delete(PlanningScheduleSegment))

        self.db.flush()
        self._realign_machine_calendar_planned_minutes_from_schedules()

        for op in all_ops:
            st = (op.status or "").strip().lower()
            if _chain_terminal_completed(op.status) or _shopfloor_active(op.status):
                continue
            op.planned_start = None
            op.planned_end = None
            op.queue_position = None
            op.latest_start = None
            if st == "planned":
                op.status = "ready"

        self.db.flush()

        machine_next: dict[int, datetime] = {}
        for op in all_ops:
            if not _shopfloor_active(op.status) or op.machine_id is None:
                continue
            end = op.actual_end or op.planned_end
            if end is None:
                continue
            mid = int(op.machine_id)
            machine_next[mid] = max(machine_next.get(mid, floor), end)

        vp_next: dict[str, datetime] = {}
        for woo, lst in by_woo.items():
            r = self._vp_resume_after_completed_ops(
                sorted(lst, key=lambda o: (o.operation_no or 9999, o.id))
            )
            if r is not None:
                vp_next[woo] = max(vp_next.get(woo, floor), r)

        vp_units: list[_VPScheduleUnit] = []
        for woo, lst in by_woo.items():
            pr = po_by_vp.get(woo)
            if not pr or not getattr(pr, "is_material_released_to_production", False):
                continue
            ordered = sorted(lst, key=lambda o: (o.operation_no or 9999, o.id))
            if all(_chain_terminal_completed(o.status) for o in ordered):
                continue
            vp_resume = self._vp_resume_after_completed_ops(ordered)
            tgt = self._vp_target_finish_dt(ordered)
            chain_min = self._remaining_vp_chain_minutes(ordered)
            ideal_fin = self._ideal_earliest_finish(floor, vp_resume, chain_min)
            safe = ideal_fin <= tgt
            rep = None
            for o in ordered:
                if not _chain_terminal_completed(o.status):
                    rep = o
                    break
            if rep is None:
                continue
            grp = product_group_cached(rep)
            gp = self._group_priority(grp)
            dmm = rep.input_diameter_mm
            d_bkt = round(float(dmm), 1) if dmm is not None else 999999.0
            vp_units.append(
                _VPScheduleUnit(
                    woo=woo,
                    ops=ordered,
                    target_finish_dt=tgt,
                    remaining_chain_min=chain_min,
                    product_group=grp,
                    group_priority=gp,
                    diameter_bucket=d_bkt,
                    safe_for_grouping=safe,
                    production_order_id=int(pr.id),
                )
            )

        vp_units_sorted = sorted(
            vp_units,
            key=lambda u: (u.target_finish_dt, u.remaining_chain_min, u.woo),
        )
        vp_units_final, grouping_applied = self._apply_safe_grouping_reorder(vp_units_sorted)

        state: dict = {}
        created: list[MachineSchedule] = []

        scheduling_late_count = 0
        for unit in vp_units_final:
            woo = unit.woo
            ordered = unit.ops
            chain_cursor = vp_next.get(woo, floor)
            buf = self._vp_chain_buffer()
            m_deadline = self._manufacturing_deadline_dt(ordered)
            exp_latest = self._expedition_latest_end_dt(ordered)

            for op in ordered:
                if _chain_terminal_completed(op.status):
                    chain_cursor = self._bump_chain_cursor_after_op_end(chain_cursor, op, buf=buf)
                    vp_next[woo] = chain_cursor
                    continue
                if _shopfloor_active(op.status):
                    end = op.actual_end or op.planned_end
                    chain_cursor = self._bump_chain_cursor_after_op_end(chain_cursor, op, buf=buf)
                    if end is not None:
                        mid_a = int(op.machine_id)
                        machine_next[mid_a] = max(machine_next.get(mid_a, floor), end)
                    vp_next[woo] = chain_cursor
                    continue
                if not bool(getattr(op, "material_ready", False)):
                    break
                if not self._schedulable_status(op.status):
                    break

                mid = int(op.machine_id)
                total_time = self._operation_duration_min(op)
                pred_floor = self._sequential_predecessor_earliest_start(ordered, op, floor, buf)
                earliest = max(pred_floor, chain_cursor, machine_next.get(mid, floor))
                latest_end = exp_latest if self._operation_in_reserve_logistics_window(op) else m_deadline

                placement = self._place_one_operation(
                    machine_id=mid,
                    from_date=from_date,
                    earliest_start=earliest,
                    total_time=total_time,
                    state=state,
                    latest_end=latest_end,
                )
                if placement is None:
                    op.planned_start = None
                    op.planned_end = None
                    op.queue_position = None
                    op.latest_start = None
                    op.status = SCHEDULING_LATE_STATUS
                    scheduling_late_count += 1
                    logger.warning(
                        "[planning_engine] scheduling_late vp=%s op_id=%s machine_id=%s latest_end=%s earliest=%s",
                        woo,
                        int(op.id),
                        mid,
                        latest_end.isoformat() if latest_end else None,
                        earliest.isoformat(),
                    )
                    break

                planned_start, planned_end, seg_rows = placement

                st_m = self._machine_state(mid, from_date, state)
                st_m["queue_position"] += 1
                qp = st_m["queue_position"]

                op.queue_position = qp
                op.planned_start = planned_start
                op.planned_end = planned_end
                op.status = "planned"
                if self._operation_in_reserve_logistics_window(op):
                    tail = self._remaining_reserve_tail_minutes(ordered, op)
                    op.latest_start = exp_latest - timedelta(minutes=tail)
                else:
                    tail = self._remaining_manufacturing_tail_minutes(ordered, op)
                    op.latest_start = m_deadline - timedelta(minutes=tail)

                sched = MachineSchedule(
                    machine_id=mid,
                    planning_operation_id=op.id,
                    queue_position=qp,
                    planned_start=planned_start,
                    planned_end=planned_end,
                    setup_time_min=float(op.setup_time_min or 0),
                    labor_time_total_min=float(op.total_labor_time_min or 0),
                    total_time_min=float(total_time),
                    status="planned",
                )
                self.db.add(sched)
                created.append(sched)
                for si, (ss, se, dm) in enumerate(seg_rows):
                    self.db.add(
                        PlanningScheduleSegment(
                            planning_operation_id=int(op.id),
                            machine_id=int(mid),
                            segment_index=int(si),
                            segment_start=ss,
                            segment_end=se,
                            duration_min=int(dm),
                        )
                    )

                machine_next[mid] = planned_end
                chain_cursor = planned_end + buf
                vp_next[woo] = chain_cursor

        deadline_violations = 0
        for unit in vp_units:
            m_deadline_u = self._manufacturing_deadline_dt(unit.ops)
            for o in unit.ops:
                if o.planned_end is None:
                    continue
                if self._operation_in_reserve_logistics_window(o):
                    if o.planned_end > self._expedition_latest_end_dt(unit.ops):
                        deadline_violations += 1
                        break
                elif o.planned_end > m_deadline_u:
                    deadline_violations += 1
                    break

        woo_norm = sorted({(op.work_order_no or "").strip() for op in all_ops if (op.work_order_no or "").strip()})
        for w in woo_norm:
            normalize_planning_queue_statuses_for_vp_code(self.db, w)

        self.db.flush()
        self.db.commit()

        vp_ids: set[int] = set()
        for s in created:
            po_row = self.db.get(PlanningOperation, int(s.planning_operation_id))
            if po_row is None:
                continue
            pox = self.db.scalar(
                select(ProductionOrder).where(ProductionOrder.vp_code == po_row.work_order_no)
            )
            if pox is not None:
                vp_ids.add(int(pox.id))
        logger.info(
            "[planning_engine] rebuild_global scheduled_rows=%s planning_operation_ids=%s vp_ids=%s",
            len(created),
            [int(s.planning_operation_id) for s in created],
            sorted(vp_ids),
        )
        print(
            "[PLANNER] "
            f"vp_count={len(vp_units)} scheduled_rows={len(created)} skipped_vps={skipped_vps} "
            f"grouping_applied={'yes' if grouping_applied else 'no'} deadline_violations={deadline_violations} "
            f"scheduling_late={scheduling_late_count}",
            flush=True,
        )
        if deadline_violations:
            logger.warning(
                "[planning_engine] deadline_violations=%s (manufacturing_end=expedition_date-%dd)",
                deadline_violations,
                MANUFACTURING_BUFFER_DAYS_BEFORE_EXPEDITION,
            )
        if scheduling_late_count:
            logger.warning("[planning_engine] scheduling_late_count=%s", scheduling_late_count)
        print(
            "[PLANNER_DIAG] rebuild_global_schedules DONE "
            f"scheduled_rows={len(created)} eligible_count={len(eligible)} "
            f"planning_operation_ids={[int(s.planning_operation_id) for s in created]} vp_ids={sorted(vp_ids)}",
            flush=True,
        )
        return created

    def _get_ready_ops(self, machine_id: int):
        """
        Legacy výběr „řady na stroji“ — pro diagnostiku; skutečný zápis rozvrhu dělá rebuild_global_schedules.
        """
        raw = self.db.scalars(
            select(PlanningOperation)
            .where(PlanningOperation.machine_id == machine_id)
            .where(PlanningOperation.status.in_(["ready", "planned", "waiting_release"]))
        ).all()

        by_woo: dict[str, list[PlanningOperation]] = defaultdict(list)
        orphans: list[PlanningOperation] = []
        for op in raw:
            w = (op.work_order_no or "").strip()
            if w:
                by_woo[w].append(op)
            else:
                orphans.append(op)

        picked: list[PlanningOperation] = []
        picked_ids: set[int] = set()

        for w in sorted(by_woo.keys()):
            lst = sorted(by_woo[w], key=lambda o: (o.operation_no or 9999, o.id))
            head = lst[0]
            if self._schedulable_status(head.status):
                picked.append(head)
                picked_ids.add(int(head.id))

        for op in raw:
            if op.queue_position is None:
                continue
            oid = int(op.id)
            if oid in picked_ids:
                continue
            if self._schedulable_status(op.status):
                picked.append(op)
                picked_ids.add(oid)

        for op in orphans:
            if self._schedulable_status(op.status):
                picked.append(op)
                picked_ids.add(int(op.id))

        queued_ops = sorted(
            [op for op in picked if op.queue_position is not None],
            key=lambda op: (op.queue_position or 0, op.id),
        )
        unqueued_ops = sorted(
            [op for op in picked if op.queue_position is None],
            key=self._smart_sort_key,
        )
        return queued_ops + unqueued_ops

    def _scheduling_candidate_diag_rows(
        self, machine_id: int, picked: list[PlanningOperation]
    ) -> list[dict]:
        picked_ids = {int(o.id) for o in picked}
        raw = self.db.scalars(
            select(PlanningOperation)
            .where(PlanningOperation.machine_id == machine_id)
            .where(PlanningOperation.status.in_(["ready", "planned", "waiting_release"]))
        ).all()
        raw_ids = {int(o.id) for o in raw}
        by_woo: dict[str, list[PlanningOperation]] = defaultdict(list)
        for op in raw:
            w = (op.work_order_no or "").strip()
            if w:
                by_woo[w].append(op)

        rows: list[dict] = []
        for op in self.db.scalars(
            select(PlanningOperation).where(PlanningOperation.machine_id == machine_id)
        ).all():
            st = (op.status or "").strip().lower()
            if st not in {"ready", "planned", "waiting_release", "in_progress", "started", "bezi", "running"}:
                continue
            oid = int(op.id)
            wp_id = getattr(op, "workplace_library_item_id", None)
            wp_fk = int(wp_id) if wp_id is not None else None
            ps_b = op.planned_start.isoformat() if op.planned_start else None
            pe_b = op.planned_end.isoformat() if op.planned_end else None
            mat = bool(getattr(op, "material_ready", False))
            reason: str | None = None
            picked_ok = oid in picked_ids

            if st not in {"ready", "planned", "waiting_release"}:
                reason = "status_not_in_scheduling_pool"
            elif oid not in raw_ids:
                reason = "status_not_in_scheduling_pool"
            elif picked_ok:
                reason = None
            else:
                w = (op.work_order_no or "").strip()
                if not w:
                    reason = "orphan_not_picked"
                elif op.queue_position is not None:
                    reason = "has_queue_position_but_not_picked_bug"
                else:
                    lst = sorted(by_woo.get(w, []), key=lambda o: (o.operation_no or 9999, o.id))
                    if not lst:
                        reason = "no_vp_group_ops"
                    else:
                        head = lst[0]
                        if int(op.id) != int(head.id):
                            reason = "not_first_operation_on_machine_for_vp"
                        else:
                            reason = "not_picked_unknown"

            rows.append(
                {
                    "planning_operation_id": oid,
                    "work_order_no": op.work_order_no,
                    "workplace_library_item_id": wp_fk,
                    "machine_id": int(op.machine_id) if op.machine_id else None,
                    "operation_no": int(op.operation_no or 0),
                    "status": op.status,
                    "material_ready": mat,
                    "planned_start_before": ps_b,
                    "planned_end_before": pe_b,
                    "picked_for_machine_schedule": picked_ok,
                    "exclusion_reason": reason,
                }
            )
        return rows

    def rebuild_machine_schedule(self, machine_id: int, from_date: date):
        """Přegeneruje celý rozvrh a vrátí řádky machine_schedule pro zadaný stroj (kompatibilní API)."""
        created_all = self.rebuild_global_schedules(from_date)
        mine = [s for s in created_all if int(s.machine_id) == int(machine_id)]
        print(
            "[PLANNER_DIAG] rebuild_machine_schedule "
            f"machine_id={machine_id} picked_count={len(mine)} "
            f"scheduled_rows_on_machine={len(mine)} global_scheduled_rows={len(created_all)}",
            flush=True,
        )
        return mine

    def rebuild_all(self, from_date: date):
        created_all = self.rebuild_global_schedules(from_date)
        by_m: dict[int, int] = defaultdict(int)
        for s in created_all:
            by_m[int(s.machine_id)] += 1
        for mid in self.db.scalars(select(PlanningOperation.machine_id).distinct()).all():
            if mid is None:
                continue
            mid_i = int(mid)
            if mid_i not in by_m:
                by_m[mid_i] = 0
        print(
            "[PLANNER_DIAG] rebuild_all "
            f"scheduled_rows={len(created_all)} machines_in_result={len(by_m)}",
            flush=True,
        )
        return [{"machine_id": mid, "scheduled_rows": int(by_m[mid])} for mid in sorted(by_m.keys())]
