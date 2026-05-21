# Planner Audit — 2026-05-16

## 1. Data models

### PlanningOperation
- File: `backend/app/models/planning.py`
- Fields (name, type, nullable, default):
  - `id` — `Integer`, nullable=False (PK)
  - `order_item_id` — `Integer`, nullable=True
  - `product_group_id` — `Integer`, nullable=True
  - `work_order_no` — `String(50)`, nullable=True
  - `gpn` — `String(50)`, nullable=False
  - `operation_name` — `String(100)`, nullable=False
  - `operation_no` — `Integer`, nullable=False
  - `machine_id` — `Integer`, FK `machines.id`, nullable=True
  - `workplace_library_item_id` — `Integer`, FK `workplace_library_items.id`, nullable=True
  - `qty` — `Integer`, nullable=False, default=0
  - `input_diameter_mm` — `Float`, nullable=True
  - `setup_time_min` — `Float`, nullable=False, default=0
  - `total_labor_time_min` — `Float`, nullable=False, default=0
  - `total_operation_time_min` — `Float`, nullable=False, default=0
  - `expedition_date` — `String(20)`, nullable=True
  - `planned_start` — `DateTime`, nullable=True
  - `planned_end` — `DateTime`, nullable=True
  - `actual_start` — `DateTime`, nullable=True
  - `actual_end` — `DateTime`, nullable=True
  - `qty_ok` — `Integer`, nullable=True
  - `qty_nok` — `Integer`, nullable=True
  - `released_at` — `DateTime`, nullable=True
  - `latest_start` — `DateTime`, nullable=True
  - `buffer_after_min` — `Integer`, nullable=True, default=20
  - `queue_position` — `Integer`, nullable=True
  - `material_ready` — `Boolean`, nullable=False, default=True
  - `status` — `String(20)`, nullable=False, default=`"planned"`
  - `planning_status` — `String(32)`, nullable=False, default=`"unscheduled"`
  - `planning_mode` — `String(20)`, nullable=True, default=`"auto"`
  - `is_locked` — `Boolean`, nullable=False, default=False (comment: logically NOT NULL; legacy NULL coerced in API migrations)
  - `priority` — `Integer`, nullable=False, default=50
  - `material_code` — `String(64)`, nullable=True
  - `material_name` — `String(255)`, nullable=True
  - `part_group` — `String(64)`, nullable=True
  - `blocking_reason` — `String(255)`, nullable=True
  - `predecessor_op_id` — `Integer`, nullable=True
  - `last_planned_at` — `DateTime`, nullable=True
  - `is_cooperation` — `Boolean`, nullable=False, default=False
  - `cooperation_status` — `String(30)`, nullable=True
  - `cooperation_category` — `String(80)`, nullable=True
  - `preferred_supplier_id` — `Integer`, FK `customers.id`, nullable=True
  - `cooperation_supplier_purchase_order_id` — `Integer`, FK `supplier_purchase_orders.id`, nullable=True
  - `cooperation_sent_at` — `DateTime`, nullable=True
  - `cooperation_received_at` — `DateTime`, nullable=True
  - `cooperation_note` — `Text`, nullable=True
- Relationships: SQLAlchemy `ForeignKey` only (no `relationship()` declarations in this file): `machine_id` → `machines`, `workplace_library_item_id` → `workplace_library_items`, `preferred_supplier_id` → `customers`, `cooperation_supplier_purchase_order_id` → `supplier_purchase_orders`
- Notes / unusual things:
  - `expedition_date` stored as `String(20)`, not `Date`
  - Docstring on `is_locked` notes SQLite legacy NULL values
  - `planning_status` is separate from shopfloor `status`; engine writes `planning_status` in `_apply_planning_status_and_blocking`
  - No SQLAlchemy relationships defined on the model class

### MachineCalendar
- File: `backend/app/models/planning.py`
- Fields (name, type, nullable, default):
  - `id` — `Integer`, nullable=False (PK)
  - `machine_id` — `Integer`, FK `machines.id`, nullable=False
  - `calendar_date` — `Date`, nullable=False
  - `available_minutes` — `Integer`, nullable=False, default=0
  - `shift_start_minutes` — `Integer`, nullable=True (comment: NULL = default 06:00 in planner)
  - `planned_minutes` — `Integer`, nullable=False, default=0
  - `maintenance_minutes` — `Integer`, nullable=False, default=0
  - `reserved_minutes` — `Integer`, nullable=False, default=0
  - `is_working_day` — `Boolean`, nullable=False, default=True
  - `is_machine_available` — `Boolean`, nullable=False, default=True
  - `note` — `Text`, nullable=True
- Relationships: FK `machine_id` → `machines.id`
- Notes / unusual things:
  - Czech comment on `shift_start_minutes`: legacy default 06:00 when NULL
  - `planning_engine._place_one_operation` uses `available_minutes - planned_minutes - maintenance_minutes - reserved_minutes` as free capacity

### MachineSchedule
- File: `backend/app/models/planning.py`
- Fields (name, type, nullable, default):
  - `id` — `Integer`, nullable=False (PK)
  - `machine_id` — `Integer`, FK `machines.id`, nullable=False
  - `planning_operation_id` — `Integer`, FK `planning_operations.id`, nullable=False, **unique**
  - `queue_position` — `Integer`, nullable=False
  - `planned_start` — `DateTime`, nullable=True
  - `planned_end` — `DateTime`, nullable=True
  - `setup_time_min` — `Float`, nullable=False, default=0
  - `labor_time_total_min` — `Float`, nullable=False, default=0
  - `total_time_min` — `Float`, nullable=False, default=0
  - `status` — `String(20)`, nullable=False, default=`"planned"`
- Relationships: FK `machine_id`, FK `planning_operation_id` (one schedule row per operation)
- Notes / unusual things:
  - Class doc on `PlanningScheduleSegment` states `machine_schedule` is one row per operation (first/last time); segments hold Gantt truth

### Other planner-related models found
- **`PlanningScheduleSegment`** — `backend/app/models/planning.py` — calendar segments per operation (`planning_operation_id`, `machine_id`, `segment_index`, `segment_start`, `segment_end`, `duration_min`)
- **`PlanningRun`** — `backend/app/models/planning.py` — audit log of rebuild runs (`trigger_reason`, `operations_affected`, `operations_locked_skipped`, `duration_ms`, `status` default `"success"`, `error_message`, `notes`)
- **`OperationMachineAlternative`** — `backend/app/models/planning.py` — TP operation → machine alternatives (`tp_operation_id`, `machine_id`, `is_primary`, `setup_time_min`, `cycle_time_min`, `preference_order`, `is_active`); no physical FK to TP operations per comment
- **`MachineShiftTemplate`** — `backend/app/models/machine_shift_template.py` — shift templates (`machine_id`, `workplace_library_item_id`, `weekday` 0–6, `start_minutes`, `end_minutes`, `label`, `is_active`); used by `planning.py` calendar regeneration, not by `planning_engine.py` directly

---

## 2. Status values

### `status` on `PlanningOperation`
- Status field name: `status` on `PlanningOperation` (also `status` on `MachineSchedule`, default `"planned"`)
- All distinct status string values found in code (assignments, comparisons, sets):
  - `"planned"` — `backend/app/models/planning.py:53` (default); `planning_engine.py:1033-1034,1163,1180`; `planner_gantt.py:44-45`; cooperation workflow `cooperation_operations.py:99,127`
  - `"ready"` — `planning_engine.py:1034,1268,1322`; `vp_operation_generator.py:141`; tests
  - `"waiting_release"` — `planning_engine.py:371,1268,1322`; `vp_operation_generator.py:153`; cooperation `cooperation_operations.py:99-100,127-128`
  - `"scheduling_late"` — constant `SCHEDULING_LATE_STATUS` in `planning_engine.py:67,1145`; canonical set in `planning_operation_status.py:39`
  - `"bezi"` — `planning_engine.py:150,155,840`; `planning_operation_status.py:36`; `planner_gantt.py:36-37`
  - `"paused"` — `planning_engine.py:155,840`; `planning_operation_status.py:35`
  - `"hotovo"` — `planning_operation_status.py:37`; `planner_gantt.py:34-35`; `cooperation_operations.py:155`
  - `"blokovano"` — `planning_operation_status.py:38`; `planner_gantt.py:38-39`; `cooperation_operations.py:179`
  - `"ceka"` — `planning_operation_status.py:34`; `planner_gantt.py:40-41`; cooperation defaults `cooperation_operations.py:99`
  - `"naplanovano"` — `planning_operation_status.py:33`; `planner_gantt.py:44-45`
  - `"cancelled"` — `planning_operation_status.py:40,53`
  - Legacy normalized to canonical (not written by new code per docstring): `"finished"`, `"done"`, `"complete"`, `"completed"`, `"running"`, `"in_progress"`, `"started"` — `planning_operation_status.py:18-26,85-97`
  - Gantt-only input aliases in `normalize_status`: `"blocked"`, `"queued"`, `"in_progress"`, `""` — `planner_gantt.py:32-46`
  - Diagnostic pool in `_scheduling_candidate_diag_rows`: `"in_progress"`, `"started"`, `"running"` — `planning_engine.py:1336` (comparison only)
- Is there an Enum class? **No** for `PlanningOperation.status`. Canonical vocabulary is documented in `backend/app/services/planning_operation_status.py` as `CANONICAL_PLANNING_OPERATION_STATUSES` frozenset (not a Python `Enum`).
- CZ ↔ EN mapping if any exists in code:
  - `planner_gantt.normalize_status`: EN/legacy → CZ display tokens (`hotovo`, `bezi`, `blokovano`, `ceka`, `naplanovano`) — `backend/app/api/planner_gantt.py:32-46`
  - `normalize_planning_operation_status`: legacy EN → canonical (`finished`→`hotovo`, `running`→`bezi`, etc.) — `backend/app/services/planning_operation_status.py:18-49`
  - Frontend labels: `frontend/src/utils/plannerGanttStatus.ts` (`plannerGanttStatusLabel`)

### `planning_status` on `PlanningOperation`
- Values assigned in `planning_engine._apply_planning_status_and_blocking` (`planning_engine.py:832-870`):
  - `"locked"`, `"unscheduled"`, `"scheduled"`, `"blocked_cooperation"`, `"blocked_previous_op"`, `"blocked_material"`
- Default in model: `"unscheduled"` — `planning.py:54`; migration backfill `planning.py:77-78`

### `cooperation_status` on `PlanningOperation`
- Set: `COOPERATION_STATUSES` = `none`, `pending_send`, `sent`, `received`, `cancelled` — `cooperation_operations.py:11`
- Default when cooperation detected: `"pending_send"` — `planning.py:105`, `planning.py:724`, `cooperation_operations.py:31`

### `PlanningRun.status`
- `"success"`, `"partial"`, `"failed"` — `planning_engine.py:935-966`; model default `"success"` — `planning.py:144`

### `production_orders.deadline_risk_level` (written by planner)
- `"overdue"`, `"at_risk"`, `"tight"`, `"ok"`, or `None` — `planning_engine.py:908-925`

---

## 3. API endpoints

Router prefix for both modules: `/planning` (`backend/app/main.py:178-179`).

### `GET /planning/operations`
- Function: `get_planning_operations` at `backend/app/api/planning.py:363`
- Input: query `machine_id: int`
- Output shape: JSON array of objects, **snake_case** keys: `id`, `order_item_id`, `work_order_no`, `gpn`, `operation_name`, `operation_no`, `qty`, `input_diameter_mm`, `setup_time_min`, `total_labor_time_min`, `total_operation_time_min`, `expedition_date`, `planned_start`, `planned_end` (ISO strings or null), `queue_position`, `status`, `material_ready`, `is_locked`, `planned_schedule_segments` (array with `segment_index`, `machine_id`, `segment_start`, `segment_end`, `duration_min`)
- What it does: Loads operations for one machine ordered by `queue_position`, `operation_no`, `id`; attaches `PlanningScheduleSegment` rows per operation.
- Calls into services: None (direct SQLAlchemy queries only).

### `GET /planning/machine-calendar`
- Function: `get_machine_calendar` at `backend/app/api/planning.py:417`
- Input: query `machine_id: int`
- Output: array, snake_case: `id`, `machine_id`, `calendar_date` (ISO date), `available_minutes`, `shift_start_minutes`, `planned_minutes`, `maintenance_minutes`, `reserved_minutes`, `is_working_day`, `is_machine_available`
- What it does: Returns all `MachineCalendar` rows for the machine, ascending by date.
- Calls into services: None.

### `GET /planning/machine-schedule`
- Function: `get_machine_schedule` at `backend/app/api/planning.py:442`
- Input: query `machine_id: int`
- Output: array, snake_case: `id`, `machine_id`, `planning_operation_id`, `queue_position`, `planned_start`, `planned_end`, `setup_time_min`, `labor_time_total_min`, `total_time_min`, `status`
- What it does: Returns `MachineSchedule` rows for the machine ordered by `queue_position`.
- Calls into services: None.

### `POST /planning/build-schedule`
- Function: `build_schedule` at `backend/app/api/planning.py:467`
- Input body (`BuildScheduleRequest`): `machine_id: int`, `from_date: str` (ISO date)
- Output: `{ "status": "ok", "machine_id": <int> }`
- What it does: Instantiates `PlanningEngineService`, calls `rebuild_machine_schedule(machine_id, date.fromisoformat(from_date), trigger_reason="manual")`. RBAC: `planning.write`.
- Calls into services: `PlanningEngineService.rebuild_machine_schedule` → `rebuild_global_schedules`.

### `POST /planning/rebuild-all`
- Function: `rebuild_all` at `backend/app/api/planning.py:480`
- Input: none
- Output: `{ "status": "ok", "machines": <result list> }` where each element is `{ "machine_id", "scheduled_rows" }` from engine
- What it does: `PlanningEngineService.rebuild_all(date.today(), trigger_reason="manual")`. RBAC: `planning.write`.
- Calls into services: `PlanningEngineService.rebuild_all`.

### `GET /planning/machine-shift-templates`
- Function: `list_machine_shift_templates` at `backend/app/api/planning.py:493`
- Input: optional query `machine_id`, `workplace_library_item_id`
- Output: array snake_case: `id`, `machine_id`, `workplace_library_item_id`, `weekday`, `start_minutes`, `end_minutes`, `label`, `is_active`
- What it does: Lists shift templates; if `workplace_library_item_id` set, ensures scheduling machine via `get_or_create_scheduling_machine_for_workplace` and dedupes templates.
- Calls into services: `dedupe_shift_templates_for_workplace`, `get_or_create_scheduling_machine_for_workplace`.

### `PUT /planning/machine-shift-templates`
- Function: `upsert_machine_shift_template` at `backend/app/api/planning.py:526`
- Input body (`MachineShiftTemplateUpsert`): `machine_id` OR `workplace_library_item_id`, `weekday` (0–6), `start_minutes`, `end_minutes`, `label`, `is_active`
- Output: `{ "status": "ok", "id": <int> }`
- What it does: Upserts one template per `(machine_id, weekday)`; validates `end_minutes > start_minutes`. RBAC: `planning.write`.
- Calls into services: `_anchor_machine_id_for_workplace` when workplace id provided.

### `POST /planning/machine-calendar/regenerate-from-shifts`
- Function: `regenerate_calendar_from_shifts` at `backend/app/api/planning.py:576`
- Input body: `from_date`, `to_date`, optional `machine_id`, optional `workplace_library_item_id`
- Output: `{ "status": "ok", **out }` from calendar service
- What it does: Regenerates `machine_calendar` from shift templates for window; commits DB.
- Calls into services: `apply_shift_templates_to_calendar_window`.

### `POST /planning/move`
- Function: `move_operation` at `backend/app/api/planning.py:601`
- Input body: `machine_id`, `planning_operation_id`, `direction` (`"up"` | `"down"` inferred from comparisons)
- Output: `{ "status": "ok", "planning_operation_id": <int> }`
- What it does: Swaps `queue_position` with neighbor on same machine if direction valid; commits; rebuilds schedule from `date.today()`.
- Calls into services: `PlanningEngineService.rebuild_machine_schedule`.

### `POST /planning/move-gantt`
- Function: `move_gantt_operation` at `backend/app/api/planning.py:635`
- Input body: `planning_operation_id`, `target_machine_id`, optional `target_queue_position`
- Output: `{ "status", "planning_operation_id", "source_machine_id", "target_machine_id", "target_queue_position", "moved", "reordered_same_machine" }`
- What it does: Reorders within machine or moves op to another machine (updates `machine_id`, `workplace_library_item_id`), normalizes queues, rebuilds affected machine(s) from `date.today()`.
- Calls into services: `get_machine_ops`, `normalize_machine_queue`, `reorder_ops_with_target`, `PlanningEngineService.rebuild_machine_schedule`.

### `POST /planning/update-operation`
- Function: `update_operation` at `backend/app/api/planning.py:702`
- Input body (`UpdatePlanningOperationRequest`): `planning_operation_id`, optional `status`, `material_ready`, `is_locked`, `is_cooperation`, `cooperation_status`, `cooperation_note`
- Output: `{ "status": "ok", "planning_operation_id", "operation": { snake_case fields } }`
- What it does: Patches operation fields; if `is_cooperation` set true without status, sets `cooperation_status = "pending_send"`; commits; rebuilds machine schedule.
- Calls into services: `PlanningEngineService.rebuild_machine_schedule`.

### `POST /planning/build-demo-schedules`
- Function: `build_demo_schedules` at `backend/app/api/planning.py:760`
- Input: none
- Output: `{ "status": "ok", "scheduled_rows": <int>, "machines": <code list> }`
- What it does: Rebuilds schedule for hardcoded machine codes: `PILA`, `CTX_BETA_800`, `CMX_600_V`, `MEZIOPERACNI_KONTROLA`, `VYSTUPNI_KONTROLA`, `BALENI`.
- Calls into services: `PlanningEngineService.rebuild_machine_schedule`.

### Material / planning-adjacent endpoints in `planning.py` (not used by `PlannerPage.tsx`)
- `POST /planning/material-reservations/rebuild` — `rebuild_material_reservations` — `run_material_reservation_rebuild`
- `POST /planning/material-reservations/cleanup-orphans` — `cleanup_material_reservation_orphans`
- `POST /planning/material-reservations/rebuild-all` — TP + consumption rebuild
- `POST /planning/material-reservations/rebuild-for-job-item/{job_item_id}`
- `POST /planning/material-reservations/rebuild-for-template/{template_id}`
- `GET /planning/material/requirements` — `build_standard_material_requirements`
- `GET /planning/material/requirements-by-vp` — `build_vp_material_requirements`

### `GET /planning/gantt`
- Function: `get_planner_gantt` at `backend/app/api/planner_gantt.py:293`
- Input: query `from_date`, `to_date` (`YYYY-MM-DD`; validated, Czech error messages on bad format)
- Output: **camelCase** top-level and item keys:
  - `{ from, to, days, machines[], unscheduledItems[] }`
  - Each machine: `machineId`, `machineName`, `workplaceId`, `workplaceCode`, `items[]`
  - Each item via `map_operation_row`: `operationId`, `orderItemId`, `productionOrderId`, `workOrderNo`, `gpn`, `operationName`, `operationNo`, `machineId`, `machineName`, `workplaceCode`, `nextWorkplaceCode`, `status` (normalized CZ tokens), `plannedStart`, `plannedEnd`, `setupTimeMin`, `laborTimeTotalMin`, `totalOperationTimeMin`, `qty`, `expeditionDate`, `queuePosition`, `materialReady`, cooperation fields, optional `scheduleSegments` (`segmentIndex`, `machineId`, `plannedStart`, `plannedEnd`, `durationMin`), optional `blockedByCooperation`, `cooperationBlocker`
- What it does: Builds workplace rows from `workplace_library_items` (plannable + active + has machines); loads scheduled ops overlapping date window and unscheduled ops (null planned times); excludes cooperation from scheduled query; requires `material_ready = 1` in SQL; enriches next workplace and cooperation blockers; does **not** trigger rebuild (log/print says so).
- Calls into services: None (raw SQL + segment batch load).

---

## 4. Planning engine (`planning_engine.py`)

### Public functions (module-level and class methods used externally)

| Name | Signature (summary) | What it actually does |
|------|---------------------|------------------------|
| `ensure_machine_calendar_horizon_for_planning` | `(db, *, from_date, machine_ids, horizon_days=420) -> int` | Inserts missing `MachineCalendar` rows for date window using machine `default_shift_minutes` or 450, `shift_start_minutes=360`, does not overwrite existing rows |
| `PlanningEngineService.__init__` | `(self, db: Session)` | Stores session |
| `PlanningEngineService.rebuild_global_schedules` | `(self, from_date: date, *, trigger_reason="other") -> list[MachineSchedule]` | Runs `_rebuild_global_schedules_body`, logs `PlanningRun`, commits or rolls back on error |
| `PlanningEngineService.rebuild_machine_schedule` | `(self, machine_id, from_date, *, trigger_reason="other")` | Calls `rebuild_global_schedules`, returns created rows filtered to `machine_id` |
| `PlanningEngineService.rebuild_all` | `(self, from_date, *, trigger_reason="other")` | Same global rebuild; returns per-machine `{machine_id, scheduled_rows}` counts |

### Algorithm currently implemented — step by step (`_rebuild_global_schedules_body`)

1. Compute scheduling `floor` = max(shift start on `from_date` at 06:00, wall-clock floor for today if applicable).
2. Load all `PlanningOperation` with non-null `machine_id`; group by `work_order_no`; load `ProductionOrder` by `vp_code`.
3. Build predecessor map per VP (`predecessor_op_id` or previous `operation_no`).
4. Delete `MachineSchedule` and `PlanningScheduleSegment` for operations **not** in protected set (`is_locked`, status `bezi`/`paused`, terminal `hotovo`/`cancelled`).
5. `_realign_machine_calendar_planned_minutes_from_schedules`: zero all `planned_minutes`, then sum `machine_schedule.total_time_min` per machine/day.
6. For non-protected, non-terminal ops: clear `planned_start`, `planned_end`, `queue_position`, `latest_start`; if `status == "planned"` set `status = "ready"`.
7. `ensure_machine_calendar_horizon_for_planning` for all machines seen.
8. Seed `op_end_times` from protected/terminal ops' `actual_end` or `planned_end`; seed `machine_next` and `vp_next` from completed chains.
9. Build `pending` set: machined, non-cooperation, non-protected, non-terminal, `_schedulable_status` (`ready`, `planned`, `waiting_release`, `scheduling_late`).
10. Loop until `pending` empty or stall guard (50000) or no candidates:
    - Candidates = pending ops whose direct predecessor is completed or already placed (`op_end_times`).
    - Sort candidates by `_machine_op_sort_key` (priority desc, expedition date, material_code, diameter, part_group, operation_no, id).
    - Pick first candidate; compute `earliest_start` from global floor, VP chain, predecessor end + 15 min buffer, machine tail.
    - `latest_end` = manufacturing deadline (expedition − 2 days end-of-day) or expedition end-of-day for reserve-window operation names.
    - `_place_one_operation` into shift windows; on failure set `status = scheduling_late`, clear plan fields, remove later VP ops from pending.
    - On success: write `planned_*`, `queue_position`, `MachineSchedule`, `PlanningScheduleSegment` rows, update machine/VP cursors, set `status = "planned"`.
11. Clear plan fields on cooperation ops.
12. Count deadline violations (post-check only, warning string).
13. For each VP code: `normalize_planning_queue_statuses_for_vp_code` (head `ready`, siblings `waiting_release`).
14. For every op: `_apply_planning_status_and_blocking` (sets `planning_status`, `blocking_reason`).
15. Refresh `ProductionOrder` forecast fields (`predicted_completion_at`, `deadline_risk_level`, etc.).
16. Flush and return created `MachineSchedule` list.

`rebuild_machine_schedule` / `rebuild_all` always invoke the **global** algorithm (not per-machine isolated).

### Factor handling (implemented / partial / not implemented)

| Factor | Assessment | Evidence |
|--------|------------|----------|
| Expedition date priority | **implemented** | Sort key `_expedition_sort_part` in `_machine_op_sort_key` (`planning_engine.py:748-768`); deadlines `_manufacturing_deadline_dt` / `_expedition_latest_end_dt` (`271-286`, `1112-1130`); `MANUFACTURING_BUFFER_DAYS_BEFORE_EXPEDITION = 2` (`48`) |
| Input diameter grouping | **partial** | Diameter in `_machine_op_sort_key` (`759-760`); legacy `_smart_sort_key` / `_apply_safe_grouping_reorder` / `_VPScheduleUnit` exist but are **not called** by `_rebuild_global_schedules_body` |
| Setup time (per batch) | **partial** | Duration uses `total_operation_time_min`, else `setup_time_min + total_labor_time_min` (`373-377`); setup not modeled as separate batch once per diameter group — single combined minutes per operation |
| Labor time (per piece) | **partial** | Included only via `total_operation_time_min` or fallback sum with setup (`373-377`); no `qty * cycle` in engine |
| Machine capacity per shift | **implemented** | `_place_one_operation` uses `available_minutes - planned - maintenance - reserved`, shift start/end (`597-679`) |
| `is_locked` operations | **implemented** | `_planner_op_protected_from_replan` skips delete/replan (`158-166`, `1005-1025`); `planning_status = "locked"` (`831-834`) |
| `material_ready` blocking | **partial** | Sets `planning_status = "blocked_material"` when false (`862-865`); **does not** exclude from `pending` scheduling set (`1075-1087`); Gantt SQL requires `material_ready = 1` (`planner_gantt.py:367,420`) |
| Operation status transitions | **implemented** | Clear plan → `ready` if was `planned` (`1028-1034`); success → `planned` (`1163`); failure → `scheduling_late` (`1145`); post-pass `normalize_planning_queue_statuses_for_vp_code` (`1227-1229`); kiosk protection for `bezi`/`paused` (`153-166`) |

### TODO / FIXME / commented-out code blocks
- No `TODO` or `FIXME` strings in `planning_engine.py`.
- Unused / dead code paths (defined, no callers in rebuild flow): `_VPScheduleUnit`, `_apply_safe_grouping_reorder`, `_vp_target_finish_dt`, `_ideal_earliest_finish`, `_per_op_schedule_gate`, `_sequential_predecessor_earliest_start`, `_get_ready_ops` (only used if called externally — not from `planning.py` API), `_scheduling_candidate_diag_rows`.
- Diagnostic `print` statements: `[PLANNER_DIAG]` in `rebuild_global_schedules`, `rebuild_machine_schedule`, `rebuild_all`; `planner_gantt.py:513-518`.

---

## 5. Frontend PlannerPage

- File: `frontend/src/pages/PlannerPage.tsx`

### Top-level layout
- `PageContainer` with optional right padding when detail panel open
- `PageHeader`: title “Planner Gantt”, subtitle, date range + machine filter + action buttons
- KPI `PageSection`: grid of 5 summary tiles (utilization %, risk VP count, blocked ops, delayed orders, cooperation waiting return) when data loaded
- Legend `PageSection`: status color chips + “Čeká na materiál” hint
- Main Gantt `PageSection`: `DndContext` + scrollable grid (sticky header with days, workplace rows, day columns via `PlannerGanttDayColumn`)
- Bottom card: table “Nenaplanovane operace” (`unscheduledItems`)
- Fixed right `OperationDetailPanel` (380px) when operation selected — not a modal

### API calls made (endpoint + when triggered)
| Call | Endpoint | When |
|------|----------|------|
| `getPlannerGantt(fromDate, toDate)` | `GET /planning/gantt?from_date&to_date` | On mount and when `fromDate`/`toDate` change (`useEffect` → `loadData`); after drag-move, rebuild, detail save |
| `rebuildPlanningAll()` | `POST /planning/rebuild-all` | “Přepočítat plán” button (`rebuildPlan`) |
| `moveGanttOperation(...)` | `POST /planning/move-gantt` | `handleDragEnd` on drop to queue slot |
| `updatePlanningOperation(...)` | `POST /planning/update-operation` | Detail panel “Ulozit zmeny” |

`PlannerPage` does **not** call `GET /planning/operations`, `build-schedule`, `move` (up/down), or shift-template endpoints.

### User actions available
- Change `from` / `to` date inputs (triggers reload via `loadData` dependency)
- Filter workplaces by text (`machineFilter`)
- “Obnovit data” → `loadData`
- “Přepočítat plán” → `rebuildPlanningAll` (requires `planning.write`)
- Drag-and-drop operation blocks between queue slots / machines → `moveGanttOperation`
- Click Gantt block or unscheduled table row → open detail panel
- Detail panel: edit `status` select, `materialReady`, `isLocked` checkboxes, save → `updatePlanningOperation`
- Optional props: “Otevřít výrobní příkaz”, “Požadavky materiálu” buttons when callbacks provided

### Uses workspace tab system?
- **No** — no imports or references to workspace/tab APIs; uses `PageContainer` / `PageHeader` / `PageSection` only.

### Uses shared `ui.ts` tokens?
- **Yes** — `import { ERP_COLORS, UI } from "../styles/ui"` (`line 26`); uses `UI.statLabel`, `UI.pageTitle`, `UI.sectionSubtitle`, `UI.buttons.primary`, `UI.inputs.base`, `UI.summaryTile`, `UI.summaryTileLabel`, `UI.summaryTileValue`, `UI.summaryTileSubValue`; extensive `ERP_COLORS.*` for layout/colors.

### `window.alert`, `confirm`, or modal usage
- None — no `window.alert`, `window.confirm`, or modal library; errors shown inline; detail panel is a fixed side drawer.

### Obvious dead code / commented blocks
- No large commented-out JSX blocks found.
- `OperationDetailPanel` references `item.isLocked` (`PlannerPage.tsx:237`) but `GET /planning/gantt` `map_operation_row` does not return `isLocked` — checkbox state may not reflect DB until save round-trip via `update-operation` response (response omits `is_locked` in nested `operation` object too — only lists subset at `planning.py:741-756`).

---

## 6. Risks & gaps observed

- `rebuild_machine_schedule(machine_id, from_date, ...)` ignores per-machine isolation — always runs full `rebuild_global_schedules` (`planning_engine.py:1387-1390`).
- `POST /planning/move` and `move-gantt` / `update-operation` call rebuild with `date.today()`, not the UI `from_date` (`planning.py:630,663,687,735`).
- Scheduling loop adds ops to `pending` without checking `material_ready` (`planning_engine.py:1075-1087`) while Gantt hides not-ready ops from scheduled view (`planner_gantt.py:367`) — forecast times may exist in DB but not display.
- `material_ready` default on model is `True` (`planning.py:51`) — new ops may schedule unless explicitly cleared elsewhere.
- `_smart_sort_key`, `_apply_safe_grouping_reorder`, `_VPScheduleUnit` are unused by current global rebuild — diameter/product-group grouping in docstring vs `_machine_op_sort_key` only at pick time.
- `setup_time_min` stored on `MachineSchedule` but duration placement uses combined `total_time_min` — setup not applied as separate calendar block.
- `planning_mode` column exists on model but is not read in `planning_engine.py`.
- `OperationMachineAlternative` table is created/migrated in API but not referenced by `planning_engine.py`.
- `GET /planning/gantt` does not expose `is_locked`, `planning_status`, or `blocking_reason` — frontend lock UI may not initialize from server.
- Scheduled Gantt query excludes `is_cooperation = 1` (`planner_gantt.py:366`); unscheduled query does not — cooperation ops may appear only in unscheduled table.
- `normalize_status` maps unknown statuses to themselves (`planner_gantt.py:46`) — non-canonical values pass through to UI.
- `MachineCalendar.reserved_minutes` and `maintenance_minutes` reduce capacity in engine but no planner UI to edit them in audited files.
- `build-schedule` accepts `from_date` in body but sibling endpoints use `date.today()` for rebuild after queue moves.
- Protected-operation delete uses `not_in(protect_ids)` — if `protect_ids` empty, deletes **all** schedules (`planning_engine.py:1017-1019`).
- `deadline_violations` only appends warning string; does not rollback schedule (`planning_engine.py:1210-1225`).
- `PlannerPage` KPI utilization uses rough `rows × days × 8h` vs sum of `totalOperationTimeMin` — not tied to `MachineCalendar.available_minutes`.

---

## 7. Open questions for product owner

- Should operations with `material_ready = false` receive `planned_start`/`planned_end` in the forecast, or be excluded from scheduling entirely until material is ready?
- Is the 2-day `MANUFACTURING_BUFFER_DAYS_BEFORE_EXPEDITION` before `expedition_date` the correct business rule for all product lines?
- Should setup time be applied once per diameter/material batch on a machine, or is per-operation `total_operation_time_min` (already aggregated upstream) sufficient?
- When a user drags an operation in Gantt, should the engine respect manual queue order (`queue_position`) or only the sort keys in `_machine_op_sort_key`? (Current rebuild recomputes order from keys, not from persisted queue after DnD except via `move-gantt` reorder before rebuild.)
- Should `GET /planning/gantt` include locked/cooperation/planning_status fields for the detail panel?
- Is global rebuild on every single-machine `build-schedule` call intended, or should planners expect true per-machine incremental scheduling?
- What is the intended consumer of `planning_status` vs `status` — should Planner UI show `planning_status`/`blocking_reason`?
- Should cooperation operations appear on the Gantt timeline at all, or only in a separate cooperation workflow?
- Are `reserved_minutes` / `maintenance_minutes` on `MachineCalendar` maintained by another module, and should planners see/edit them?
