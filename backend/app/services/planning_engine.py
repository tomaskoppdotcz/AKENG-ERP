import logging
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.models.planning import PlanningOperation, MachineCalendar, MachineSchedule
from app.models.orders import ProductionOrder
from app.models.technology_library import TechnologyTemplate
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


def _chain_terminal_completed(status: str | None) -> bool:
    s = (status or "").strip().lower()
    return s in {"finished", "done", "hotovo", "complete", "completed", "cancelled"}


def _shopfloor_active(status: str | None) -> bool:
    s = (status or "").strip().lower()
    return s in {"in_progress", "started", "running", "bezi"}


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

    def _vp_target_finish_dt(self, ops: list[PlanningOperation]) -> datetime:
        dues = [self._get_due_date(o) for o in ops]
        due = min(dues) if dues else date.max
        if due == date.max:
            return datetime.combine(date.max, time(23, 59, 59))
        tf = due - timedelta(days=3)
        return datetime.combine(tf, time(23, 59, 59))

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
        return st in {"ready", "planned", "waiting_release"}

    def _operation_duration_min(self, op: PlanningOperation) -> int:
        total_time = int(round(float(op.total_operation_time_min or 0)))
        if total_time <= 0:
            total_time = int(round(float(op.setup_time_min or 0) + float(op.total_labor_time_min or 0)))
        return max(total_time, 0)

    def _vp_resume_after_completed_ops(self, lst: list[PlanningOperation]) -> datetime | None:
        """Nejpozdější (konec + buffer) napříč již dokončenými operacemi VP."""
        buf = timedelta(minutes=VP_INTER_OPERATION_BUFFER_MIN)
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

    def _machine_state(self, machine_id: int, from_date: date, cache: dict) -> dict:
        if machine_id not in cache:
            cache[machine_id] = {
                "days": list(self._get_machine_days(machine_id, from_date)),
                "day_index": 0,
                "current_pointer": None,
                "queue_position": 0,
            }
        return cache[machine_id]

    def _place_one_operation(
        self,
        *,
        machine_id: int,
        from_date: date,
        earliest_start: datetime,
        total_time: int,
        state: dict,
    ) -> tuple[datetime, datetime] | None:
        if total_time <= 0:
            total_time = 1
        st = self._machine_state(machine_id, from_date, state)
        days: list = st["days"]
        day_index = st["day_index"]
        current_pointer: datetime | None = st["current_pointer"]

        placed = False
        planned_start = planned_end = None

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
            current_pointer = max(current_pointer, earliest_start)
            if current_pointer.date() > day.calendar_date:
                day_index += 1
                current_pointer = None
                continue

            planned_start = current_pointer
            planned_end = planned_start + timedelta(minutes=total_time)

            day.planned_minutes = planned + total_time
            current_pointer = planned_end
            placed = True

        st["day_index"] = day_index
        st["current_pointer"] = current_pointer
        assert planned_start is not None and planned_end is not None
        return planned_start, planned_end

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
        bez překryvu na stroji, s prioritou target_finish (expedice − 3 dny) a seskupením podle typu + průměru jen u „safe“ VP.
        """
        floor = self._combine_shift_start(from_date)
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
        else:
            self.db.execute(delete(MachineSchedule))

        for op in all_ops:
            st = (op.status or "").strip().lower()
            if _chain_terminal_completed(op.status) or _shopfloor_active(op.status):
                continue
            op.planned_start = None
            op.planned_end = None
            op.queue_position = None
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

        for unit in vp_units_final:
            woo = unit.woo
            ordered = unit.ops
            chain_cursor = vp_next.get(woo, floor)
            buf = timedelta(minutes=VP_INTER_OPERATION_BUFFER_MIN)

            for op in ordered:
                if _chain_terminal_completed(op.status):
                    continue
                if _shopfloor_active(op.status):
                    end = op.actual_end or op.planned_end
                    if end is not None:
                        chain_cursor = max(chain_cursor, end + buf)
                        mid_a = int(op.machine_id)
                        machine_next[mid_a] = max(machine_next.get(mid_a, floor), end)
                    continue
                if not bool(getattr(op, "material_ready", False)):
                    break
                if not self._schedulable_status(op.status):
                    break

                mid = int(op.machine_id)
                total_time = self._operation_duration_min(op)
                earliest = max(floor, chain_cursor, machine_next.get(mid, floor))

                pair = self._place_one_operation(
                    machine_id=mid,
                    from_date=from_date,
                    earliest_start=earliest,
                    total_time=total_time,
                    state=state,
                )
                planned_start, planned_end = pair

                st_m = self._machine_state(mid, from_date, state)
                st_m["queue_position"] += 1
                qp = st_m["queue_position"]

                op.queue_position = qp
                op.planned_start = planned_start
                op.planned_end = planned_end
                op.status = "planned"

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

                machine_next[mid] = planned_end
                chain_cursor = planned_end + buf
                vp_next[woo] = chain_cursor

        deadline_violations = 0
        for unit in vp_units:
            pe = [o.planned_end for o in unit.ops if o.planned_end is not None]
            if not pe:
                continue
            if max(pe) > unit.target_finish_dt:
                deadline_violations += 1

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
            f"grouping_applied={'yes' if grouping_applied else 'no'} deadline_violations={deadline_violations}",
            flush=True,
        )
        if deadline_violations:
            logger.warning(
                "[planning_engine] deadline_violations=%s (target_finish=expedition_date-3d)",
                deadline_violations,
            )
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
            if st not in {"ready", "planned", "waiting_release", "in_progress", "started"}:
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
