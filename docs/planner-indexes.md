# Planner DB Indexes (F1.5)

Added in F1.5 (May 2026) via `backend/scripts/add_planner_indexes.py`.

These indexes target the hottest query paths in the planner module: pending set
construction, per-machine rebuild scoping (F4), Gantt timeline rendering,
predecessor chain lookup, and material-readiness filtering.

Idempotent: created with `CREATE INDEX IF NOT EXISTS`.

## Indexes

| Index | Table | Columns | Purpose |
|---|---|---|---|
| `ix_planning_operations_woo_opno` | `planning_operations` | `work_order_no, operation_no` | Predecessor map / VP chain ordering |
| `ix_planning_operations_machine_status` | `planning_operations` | `machine_id, status` | Per-machine pending set (F4) |
| `ix_planning_operations_expedition_date` | `planning_operations` | `expedition_date` | Sort key in scheduling loop |
| `ix_planning_operations_matready_status` | `planning_operations` | `material_ready, status` | F2 material_ready guard + Gantt filter |
| `ix_planning_operations_planned_start` | `planning_operations` | `planned_start` | Gantt window scans |
| `ix_machine_schedule_machine_planned` | `machine_schedule` | `machine_id, planned_start` | Gantt timeline render |
| `ix_machine_schedule_op_id` | `machine_schedule` | `planning_operation_id` | Cross-reference and delete |
| `ix_planning_segments_machine_segment_start` | `planning_schedule_segments` | `machine_id, segment_start` | Gantt segment timeline (model has segment_start, not planned_start) |
| `ix_planning_segments_op_id` | `planning_schedule_segments` | `planning_operation_id` | Cross-reference and delete |
| `ix_machine_calendar_machine_date` | `machine_calendar` | `machine_id, calendar_date` | Calendar lookup per day |

## When to revisit

When migrating to PostgreSQL (planned at ~50k VP total), move these into an
Alembic migration. Also consider:
- Partial index on `planning_operations(status)` if status is highly skewed
- BRIN index on `machine_schedule(planned_start)` for very large schedule tables
- Index on `production_orders(vp_code)` if not already covered

## How to re-run

```
cd backend && .venv/bin/python -m scripts.add_planner_indexes
```
