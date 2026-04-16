Milestone: Manual completion stable

Stabilized areas:
- planner same-day scheduling
- kiosk + shopfloor unified work-report flow
- pause reasons
- manual work report CRUD
- delete report rollback reopens operation
- manual report can be used as operation completion
- stock receipt on "Příjem sklad" uses product_stock_items.current_qty
- production order status recompute from planning chain
- cleanup includes work reports
- material stock cleanup/recompute improved
- datetime policy unified to naive UTC in planner/runtime/manual completion

Known remaining work:
- aggregates into orders / items / VP
- final visual standard across pages
- per-user saved table layouts
- more E2E scenarios (internal stock, stock_customer, production_customer)
