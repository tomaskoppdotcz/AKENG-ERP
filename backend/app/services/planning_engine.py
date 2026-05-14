import logging
import time
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta

from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from app.models.master_data import Machine
from app.models.orders import JobItem, ProductionOrder
from app.models.planning import (
    MachineCalendar,
    MachineSchedule,
    PlanningOperation,
    PlanningRun,
    PlanningScheduleSegment,
)
from app.models.technology_library import TechnologyTemplate
from app.services.planning_operation_status import (
    normalize_planning_operation_status,
    planning_operation_status_is_terminal,
)
from app.services.cooperation_operations import (
    cooperation_blocks_successors,
    cooperation_operation_exclusion_reason,
    normalize_cooperation_status,
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

# Okno machine_calendar, které musí existovat, aby _place_one_operation nezačínalo až „prvním existujícím“ dnem v DB.
PLANNING_CALENDAR_HORIZON_DAYS = 420
_DEFAULT_CALENDAR_SHIFT_START_MINUTES = 6 * 60


def ensure_machine_calendar_horizon_for_planning(
    db: Session,
    *,
    from_date: date,
    machine_ids: set[int],
    horizon_days: int = PLANNING_CALENDAR_HORIZON_DAYS,
) -> int:
    """
    Doplní chybějící řádky machine_calendar pro [from_date, from_date+horizon] u daných strojů.

    Bez toho _get_machine_days vrací první řádek až za dírou (např. až zítra) a plánovač začíná
    další den v 06:00 i při volné kapacitě dnes — uživatel musel ručně přegenerovat kalendář.

    Existující řádky se NEPŘEPISUJÍ (available_minutes / shift_start zůstávají; šablony řeší
    apply_shift_templates_to_calendar_window při změně kapacity).
    """
    if not machine_ids:
        return 0
    mid_list = sorted(int(x) for x in machine_ids)
    to_date = from_date + timedelta(days=max(0, int(horizon_days)))
    machines = {
        int(m.id): m
        for m in db.scalars(select(Machine).where(Machine.id.in_(mid_list))).all()
    }
    existing: set = set()
    for mid, cal_d in db.execute(
        select(MachineCalendar.machine_id, MachineCalendar.calendar_date).where(
            MachineCalendar.machine_id.in_(mid_list),
            MachineCalendar.calendar_date >= from_date,
            MachineCalendar.calendar_date <= to_date,
        )
    ).all():
        existing.add((int(mid), cal_d))

    added = 0
    d = from_date
    while d <= to_date:
        for mid in mid_list:
            if (mid, d) in existing:
                continue
            m = machines.get(mid)
            avail_default = int(getattr(m, "default_shift_minutes", None) or 450) if m is not None else 450
            db.add(
                MachineCalendar(
                    machine_id=mid,
                    calendar_date=d,
                    available_minutes=avail_default,
                    shift_start_minutes=_DEFAULT_CALENDAR_SHIFT_START_MINUTES,
                    planned_minutes=0,
                    maintenance_minutes=0,
                    reserved_minutes=0,
                    is_working_day=bool(avail_default > 0),
                    is_machine_available=True,
                    note=None,
                )
            )
            existing.add((mid, d))
            added += 1
        d += timedelta(days=1)
    if added:
        db.flush()
        logger.info(
            "[planning_engine] ensure_machine_calendar_horizon added=%s window=%s..%s machines=%s",
            added,
            from_date.isoformat(),
            to_date.isoformat(),
            len(mid_list),
        )
    return added


def _chain_terminal_completed(status: str | None) -> bool:
    return planning_operation_status_is_terminal(status)


def _shopfloor_active(status: str | None) -> bool:
    return normalize_planning_operation_status(status) == "bezi"


def _planner_paused_or_running(status: str | None) -> bool:
    st = normalize_planning_operation_status(status)
    return st in ("bezi", "paused")


def _planner_op_protected_from_replan(op: PlanningOperation) -> bool:
    """Locked, shopfloor running/paused, or terminal — nesmí se mazat / přepisovat plán."""
    if bool(getattr(op, "is_locked", False)):
        return True
    if _planner_paused_or_running(op.status):
        return True
    if _chain_terminal_completed(op.status):
        return True
    return False


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
    Deterministický rule-based plánovač v1: rozvrh po machine_id + machine_calendar.

    Plánuje interní operace dopředu (forecast kapacity) pro všechny VP s operacemi, nejen po vydání materiálu.
    Uvolnění do kiosku řídí planning_status / material_ready / předchůdce / kooperace (forecast ≠ released).

    Kooperace nezabírá strojní kapacitu; locked / běžící / pozastavené / hotové řádky se nepřepisují.
    """

    def __init__(self, db: Session):
        self.db = db

    def _combine_shift_start(self, d: date) -> datetime:
        return datetime.combine(d, time(hour=6, minute=0))

    @staticmethod
    def _normalize_runtime_dt(value: datetime | None) -> datetime | None:
        """
        Canonical planner/runtime datetime: local naive wall-clock.
        Accept both timezone-aware and naive values and normalize before comparisons.
        """
        if value is None:
            return None
        if value.tzinfo is None or value.tzinfo.utcoffset(value) is None:
            return value
        return value.replace(tzinfo=None)

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
            if bool(getattr(o, "is_cooperation", False)):
                if cooperation_blocks_successors(o):
                    break
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
        end = self._normalize_runtime_dt(op.actual_end or op.planned_end)
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
            end = self._normalize_runtime_dt(op.actual_end or op.planned_end)
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
            qpf = cache.get("__qp_floor__") or {}
            qp0 = int(qpf.get(int(machine_id), 0))
            cache[machine_id] = {
                "days": list(self._get_machine_days(machine_id, from_date)),
                "day_index": 0,
                "current_pointer": None,
                "queue_position": qp0,
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
            earliest_inside_shift = shift_start <= earliest_start < shift_end
            if not op_has_started:
                current_pointer = max(current_pointer, earliest_start)
            wc_floor = self._earliest_wall_clock_floor_for_calendar_day(day.calendar_date, day)
            # Stejnodenní zbytek směny po návaznosti (jiný stroj / WP): nesmíme nechat „teď“ vyhodit
            # celý den, když earliest_start je ještě uvnitř [shift_start, shift_end) toho kalendářního dne
            # (typicky večer / přepočet: wc_floor >= shift_end → jinak by se přeskočilo na další den 06:00).
            if (
                wc_floor is not None
                and shift_end > shift_start
                and earliest_inside_shift
                and wc_floor >= shift_end
            ):
                wc_floor = None
            if wc_floor is not None:
                current_pointer = max(current_pointer, wc_floor)
            if current_pointer.date() > day.calendar_date:
                day_index += 1
                current_pointer = None
                continue

            # Pokud earliest_start leží uvnitř směny, nesmí nás wall-clock floor vytlačit za konec směny
            # a způsobit přeskočení dne při dostupné dnešní kapacitě.
            if current_pointer >= shift_end and not op_has_started and earliest_inside_shift:
                current_pointer = max(shift_start, earliest_start)
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
        """Diagnostika uvolnění do kiosku; forecast plánování nevyřazuje podle released."""
        _ = released
        out: dict[int, str | None] = {}
        chain_blocked: str | None = None
        for o in ordered:
            oid = int(o.id)
            if _chain_terminal_completed(o.status):
                out[oid] = "operation_completed"
                continue
            coop_reason = cooperation_operation_exclusion_reason(o)
            if coop_reason is not None:
                out[oid] = coop_reason
                if cooperation_blocks_successors(o):
                    chain_blocked = "blocked_after_cooperation"
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

    def _resolve_direct_predecessor_op(
        self, op: PlanningOperation, same_vp_ops: list[PlanningOperation]
    ) -> PlanningOperation | None:
        by_id = {int(o.id): o for o in same_vp_ops}
        raw_pid = getattr(op, "predecessor_op_id", None)
        if raw_pid is not None:
            pred = by_id.get(int(raw_pid))
            if pred is not None and int(pred.id) != int(op.id):
                return pred
        cur_no = int(op.operation_no or 0)
        candidates = [x for x in same_vp_ops if int(x.operation_no or 0) < cur_no]
        if not candidates:
            return None
        return max(candidates, key=lambda x: (int(x.operation_no or 0), int(x.id)))

    def _expedition_sort_part(self, op: PlanningOperation) -> tuple[int, date]:
        d = self._get_due_date(op)
        if d == date.max:
            return (1, date.max)
        return (0, d)

    def _machine_op_sort_key(self, op: PlanningOperation) -> tuple:
        mc_raw = (getattr(op, "material_code", None) or "").strip()
        pg_raw = (getattr(op, "part_group", None) or "").strip()
        mat_key = (0, mc_raw.lower()) if mc_raw else (1, "")
        part_key = (0, pg_raw.lower()) if pg_raw else (1, "")
        diam = op.input_diameter_mm
        diam_key = (0, float(diam)) if diam is not None else (1, 0.0)
        return (
            -int(op.priority or 50),
            self._expedition_sort_part(op),
            mat_key,
            diam_key,
            part_key,
            int(op.operation_no or 0),
            int(op.id),
        )

    def _build_predecessor_map_for_vp(self, lst: list[PlanningOperation]) -> dict[int, PlanningOperation | None]:
        lst_sorted = sorted(lst, key=lambda o: (int(o.operation_no or 0), int(o.id)))
        return {int(o.id): self._resolve_direct_predecessor_op(o, lst_sorted) for o in lst_sorted}

    def _cooperation_blocks_chain_to_op(
        self, op: PlanningOperation, pred_by_id: dict[int, PlanningOperation | None]
    ) -> bool:
        seen: set[int] = set()
        cur: PlanningOperation | None = pred_by_id.get(int(op.id))
        while cur is not None and int(cur.id) not in seen:
            seen.add(int(cur.id))
            if bool(getattr(cur, "is_cooperation", False)) and cooperation_blocks_successors(cur):
                return True
            cur = pred_by_id.get(int(cur.id))
        return False

    def _pred_end_for_chain(
        self, pred: PlanningOperation | None, op_end_times: dict[int, datetime], floor: datetime, buf: timedelta
    ) -> datetime | None:
        if pred is None:
            return None
        if bool(getattr(pred, "is_cooperation", False)):
            if cooperation_blocks_successors(pred):
                return None
            if _chain_terminal_completed(pred.status):
                end = self._normalize_runtime_dt(pred.actual_end or pred.planned_end)
                return end + buf if end is not None else None
            e = op_end_times.get(int(pred.id))
            if e is not None:
                return e + buf
            return None
        if _chain_terminal_completed(pred.status):
            end = self._normalize_runtime_dt(pred.actual_end or pred.planned_end)
            return end + buf if end is not None else None
        e = op_end_times.get(int(pred.id))
        if e is not None:
            return e + buf
        return None

    def _predecessor_ready_for_schedule(
        self,
        op: PlanningOperation,
        pred_by_id: dict[int, PlanningOperation | None],
        op_end_times: dict[int, datetime],
    ) -> bool:
        p = pred_by_id.get(int(op.id))
        if p is None:
            return True
        if bool(getattr(p, "is_cooperation", False)):
            if cooperation_blocks_successors(p):
                return False
            return _chain_terminal_completed(p.status) or int(p.id) in op_end_times
        return _chain_terminal_completed(p.status) or int(p.id) in op_end_times

    def _apply_planning_status_and_blocking(
        self,
        op: PlanningOperation,
        *,
        pred_by_id: dict[int, PlanningOperation | None],
    ) -> None:
        if bool(getattr(op, "is_locked", False)):
            op.planning_status = "locked"
            op.blocking_reason = "Operace je uzamčena."
            return
        if _chain_terminal_completed(op.status):
            op.planning_status = "unscheduled"
            op.blocking_reason = None
            return
        stn = normalize_planning_operation_status(op.status)
        if stn in ("bezi", "paused"):
            if op.planned_start is not None and op.planned_end is not None:
                op.planning_status = "scheduled"
            else:
                op.planning_status = "unscheduled"
            op.blocking_reason = None
            return
        if bool(getattr(op, "is_cooperation", False)):
            cr = cooperation_operation_exclusion_reason(op)
            if cr is not None:
                op.planning_status = "blocked_cooperation"
                op.blocking_reason = "Kooperace (externí operace)."
                return
        if self._cooperation_blocks_chain_to_op(op, pred_by_id):
            op.planning_status = "blocked_cooperation"
            op.blocking_reason = "Blokováno nedokončenou kooperací v řetězci."
            return
        pred = pred_by_id.get(int(op.id))
        if pred is not None and not _chain_terminal_completed(pred.status):
            op.planning_status = "blocked_previous_op"
            op.blocking_reason = "Předcházející operace není dokončena."
            return
        if not bool(getattr(op, "material_ready", False)):
            op.planning_status = "blocked_material"
            op.blocking_reason = "Materiál není připraven."
            return
        if op.planned_start is not None and op.planned_end is not None:
            op.planning_status = "scheduled"
            op.blocking_reason = None
            return
        op.planning_status = "unscheduled"
        op.blocking_reason = None

    def _refresh_production_order_forecast_fields(self, po: ProductionOrder, woo_ops: list[PlanningOperation]) -> None:
        internal_ends: list[datetime] = []
        for o in woo_ops:
            if bool(getattr(o, "is_cooperation", False)):
                continue
            pe = self._normalize_runtime_dt(o.planned_end)
            if pe is not None:
                internal_ends.append(pe)
        pred_dt = max(internal_ends) if internal_ends else None

        uncertain = False
        for o in woo_ops:
            if not bool(getattr(o, "is_cooperation", False)):
                continue
            stc = normalize_cooperation_status(getattr(o, "cooperation_status", None), is_cooperation=True)
            if stc in ("pending_send", "sent"):
                uncertain = True
                break

        dates: list[date] = []
        for o in woo_ops:
            d = self._get_due_date(o)
            if d != date.max:
                dates.append(d)
        ji = self.db.get(JobItem, int(po.job_item_id)) if getattr(po, "job_item_id", None) else None
        if ji is not None and ji.due_date is not None:
            dates.append(ji.due_date)
        E = min(dates) if dates else None

        now_utc = datetime.utcnow()
        po.predicted_completion_at = pred_dt
        po.last_completion_calc_at = now_utc
        po.predicted_completion_uncertain = bool(uncertain)

        if pred_dt is None or E is None:
            po.deadline_risk_level = None
            po.predicted_delay_days = None
            return

        D = pred_dt.date() if isinstance(pred_dt, datetime) else pred_dt
        if not isinstance(D, date):
            D = pred_dt.date()
        mfg_target = E - timedelta(days=MANUFACTURING_BUFFER_DAYS_BEFORE_EXPEDITION)
        po.predicted_delay_days = int((D - E).days)

        if D > E:
            po.deadline_risk_level = "overdue"
        elif D > mfg_target:
            po.deadline_risk_level = "at_risk"
        elif mfg_target - timedelta(days=1) < D <= mfg_target:
            po.deadline_risk_level = "tight"
        else:
            po.deadline_risk_level = "ok"

    def rebuild_global_schedules(self, from_date: date, *, trigger_reason: str = "other") -> list[MachineSchedule]:
        t0 = time.perf_counter()
        triggered_at = datetime.utcnow()
        reason = (trigger_reason or "other")[:64]
        warnings: list[str] = []
        try:
            created = self._rebuild_global_schedules_body(from_date, warnings)
            duration_ms = int((time.perf_counter() - t0) * 1000)
            st = "partial" if warnings else "success"
            self.db.add(
                PlanningRun(
                    triggered_by_user_id=None,
                    created_at=triggered_at,
                    triggered_at=triggered_at,
                    trigger_reason=reason,
                    operations_affected=getattr(self, "_last_run_operations_affected", None),
                    operations_locked_skipped=getattr(self, "_last_run_operations_locked_skipped", None),
                    duration_ms=duration_ms,
                    status=st,
                    error_message=None,
                    notes=("; ".join(warnings))[:1000] if warnings else None,
                )
            )
            self.db.flush()
            self.db.commit()
            return created
        except Exception as e:
            self.db.rollback()
            duration_ms = int((time.perf_counter() - t0) * 1000)
            try:
                self.db.add(
                    PlanningRun(
                        triggered_by_user_id=None,
                        created_at=triggered_at,
                        triggered_at=triggered_at,
                        trigger_reason=reason,
                        operations_affected=None,
                        operations_locked_skipped=None,
                        duration_ms=duration_ms,
                        status="failed",
                        error_message=str(e)[:2000],
                        notes=None,
                    )
                )
                self.db.commit()
            except Exception:
                logger.exception("[planning_engine] planning_runs failed log")
            raise

    def _rebuild_global_schedules_body(self, from_date: date, warnings: list[str]) -> list[MachineSchedule]:
        shift_floor = self._combine_shift_start(from_date)
        wc_floor_from = self._earliest_wall_clock_floor_for_calendar_day(from_date)
        floor = max(shift_floor, wc_floor_from) if wc_floor_from is not None else shift_floor
        all_ops = self.db.scalars(
            select(PlanningOperation).where(PlanningOperation.machine_id.isnot(None))
        ).all()
        op_by_id: dict[int, PlanningOperation] = {int(o.id): o for o in all_ops}

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

        pred_maps: dict[str, dict[int, PlanningOperation | None]] = {
            woo: self._build_predecessor_map_for_vp(lst) for woo, lst in by_woo.items()
        }

        protect_ids = [int(o.id) for o in all_ops if _planner_op_protected_from_replan(o)]
        locked_skip = int(sum(1 for o in all_ops if bool(getattr(o, "is_locked", False))))

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
            if _planner_op_protected_from_replan(op):
                continue
            if _chain_terminal_completed(op.status):
                continue
            st = (op.status or "").strip().lower()
            op.planned_start = None
            op.planned_end = None
            op.queue_position = None
            op.latest_start = None
            if st == "planned":
                op.status = "ready"
        self.db.flush()

        machine_ids_for_calendar = {int(o.machine_id) for o in all_ops if o.machine_id is not None}
        ensure_machine_calendar_horizon_for_planning(
            self.db, from_date=from_date, machine_ids=machine_ids_for_calendar
        )

        op_end_times: dict[int, datetime] = {}
        for op in all_ops:
            if not _chain_terminal_completed(op.status) and not _planner_op_protected_from_replan(op):
                continue
            end = self._normalize_runtime_dt(op.actual_end or op.planned_end)
            if end is not None:
                op_end_times[int(op.id)] = end

        machine_next: dict[int, datetime] = defaultdict(lambda: floor)
        for op in all_ops:
            if not _planner_op_protected_from_replan(op) or op.machine_id is None:
                continue
            end = self._normalize_runtime_dt(op.actual_end or op.planned_end)
            if end is None:
                continue
            mid = int(op.machine_id)
            machine_next[mid] = max(machine_next[mid], end)

        vp_next: dict[str, datetime] = {}
        for woo, lst in by_woo.items():
            r = self._vp_resume_after_completed_ops(sorted(lst, key=lambda o: (o.operation_no or 9999, o.id)))
            if r is not None:
                vp_next[woo] = max(vp_next.get(woo, floor), r)

        qp_floor: dict[int, int] = defaultdict(int)
        for row in self.db.scalars(select(MachineSchedule)).all():
            qp_floor[int(row.machine_id)] = max(qp_floor[int(row.machine_id)], int(row.queue_position or 0))

        state: dict = {"__qp_floor__": dict(qp_floor)}
        created: list[MachineSchedule] = []
        buf = self._vp_chain_buffer()
        scheduling_late_count = 0

        pending: set[int] = set()
        for op in all_ops:
            if not op.machine_id:
                continue
            if bool(getattr(op, "is_cooperation", False)):
                continue
            if _planner_op_protected_from_replan(op):
                continue
            if _chain_terminal_completed(op.status):
                continue
            if not self._schedulable_status(op.status):
                continue
            pending.add(int(op.id))

        stall_guard = 0
        while pending:
            stall_guard += 1
            if stall_guard > 50000:
                warnings.append("planner_stall_guard")
                break
            candidates: list[int] = []
            for oid in pending:
                op = op_by_id[oid]
                woo = (op.work_order_no or "").strip()
                pred_map = pred_maps.get(woo, {})
                if not self._predecessor_ready_for_schedule(op, pred_map, op_end_times):
                    continue
                candidates.append(oid)
            if not candidates:
                break
            candidates.sort(key=lambda i: self._machine_op_sort_key(op_by_id[i]))
            oid = candidates[0]
            op = op_by_id[oid]
            woo = (op.work_order_no or "").strip()
            pred_map = pred_maps.get(woo, {})
            pred = pred_map.get(int(op.id))
            ordered = sorted(by_woo.get(woo, []), key=lambda o: (int(o.operation_no or 0), int(o.id)))
            m_deadline = self._manufacturing_deadline_dt(ordered)
            exp_latest = self._expedition_latest_end_dt(ordered)

            pred_floor_t = self._pred_end_for_chain(pred, op_end_times, floor, buf)
            chain_base = vp_next.get(woo, floor)
            if pred is None:
                pred_floor = chain_base
            else:
                if pred_floor_t is None:
                    warnings.append(f"missing_pred_floor_op_{oid}")
                    pending.discard(oid)
                    continue
                pred_floor = pred_floor_t
            earliest_pred = max(floor, pred_floor)
            mid = int(op.machine_id)
            earliest = max(earliest_pred, machine_next[mid])

            total_time = self._operation_duration_min(op)
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
                warnings.append(f"scheduling_late_op_{oid}")
                pending.discard(oid)
                cur_no = int(op.operation_no or 0)
                for o2 in ordered:
                    if int(o2.operation_no or 0) > cur_no:
                        pending.discard(int(o2.id))
                continue

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
            op_end_times[int(op.id)] = planned_end
            pending.discard(oid)

        for woo, lst in by_woo.items():
            ordered = sorted(lst, key=lambda o: (int(o.operation_no or 0), int(o.id)))
            pred_map = pred_maps.get(woo, {})
            for op in ordered:
                if bool(getattr(op, "is_cooperation", False)):
                    op.planned_start = None
                    op.planned_end = None
                    op.queue_position = None
                    op.latest_start = None

        deadline_violations = 0
        for woo, lst in by_woo.items():
            ordered = sorted(lst, key=lambda o: (int(o.operation_no or 0), int(o.id)))
            m_deadline_u = self._manufacturing_deadline_dt(ordered)
            for o in ordered:
                if o.planned_end is None:
                    continue
                if self._operation_in_reserve_logistics_window(o):
                    if o.planned_end > self._expedition_latest_end_dt(ordered):
                        deadline_violations += 1
                        break
                elif o.planned_end > m_deadline_u:
                    deadline_violations += 1
                    break
        if deadline_violations:
            warnings.append(f"deadline_violations_{deadline_violations}")

        woo_norm = sorted({(op.work_order_no or "").strip() for op in all_ops if (op.work_order_no or "").strip()})
        for w in woo_norm:
            normalize_planning_queue_statuses_for_vp_code(self.db, w)

        for op in all_ops:
            woo = (op.work_order_no or "").strip()
            pred_map = pred_maps.get(woo, {})
            self._apply_planning_status_and_blocking(op, pred_by_id=pred_map)

        for woo, po in po_by_vp.items():
            lst = by_woo.get(woo, [])
            if lst:
                self._refresh_production_order_forecast_fields(po, lst)

        touched = len(all_ops)
        self._last_run_operations_affected = touched
        self._last_run_operations_locked_skipped = locked_skip

        self.db.flush()

        logger.info(
            "[planning_engine] rebuild_global scheduled_rows=%s scheduling_late=%s deadline_violations=%s",
            len(created),
            scheduling_late_count,
            deadline_violations,
        )
        print(
            "[PLANNER_DIAG] rebuild_global_schedules DONE "
            f"scheduled_rows={len(created)} scheduling_late={scheduling_late_count} "
            f"deadline_violations={deadline_violations} protected_ops={len(protect_ids)}",
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

    def rebuild_machine_schedule(self, machine_id: int, from_date: date, *, trigger_reason: str = "other"):
        """Přegeneruje celý rozvrh a vrátí řádky machine_schedule pro zadaný stroj (kompatibilní API)."""
        created_all = self.rebuild_global_schedules(from_date, trigger_reason=trigger_reason)
        mine = [s for s in created_all if int(s.machine_id) == int(machine_id)]
        print(
            "[PLANNER_DIAG] rebuild_machine_schedule "
            f"machine_id={machine_id} picked_count={len(mine)} "
            f"scheduled_rows_on_machine={len(mine)} global_scheduled_rows={len(created_all)}",
            flush=True,
        )
        return mine

    def rebuild_all(self, from_date: date, *, trigger_reason: str = "other"):
        created_all = self.rebuild_global_schedules(from_date, trigger_reason=trigger_reason)
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
