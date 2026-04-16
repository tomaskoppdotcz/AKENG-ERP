Milestone: Runtime flow stable (2026-04-16_12-47)

Stabilní části:
- planner (same-day scheduling OK)
- shopfloor kiosk + PC kiosk sjednocené
- START / PAUZA / RESUME / HOTOVO
- work_reports (auto + manual)
- pauzy + důvody pauz
- operation_events (start/pause/resume/done)
- správné actual_start / actual_end (lokální čas)
- operátor (employee_id + operator_display)
- čistý čas (duration_min bez pauz)
- Příjem sklad → správná karta (portfolio_item_id fix)
- rollback po smazání výkazu
- manual completion (náhrada HOTOVO)
- regenerate VP z TP (per VP)
- cleanup (operational + material stock)

Ověřeno:
- shopfloor kiosk
- PC kiosk
- pauzy
- operator tracking
- planner návaznosti
- sklad výrobků
- rollback + re-completion

Další kroky:
- agregace (zakázka / položka / VP)
- náklady
- výkonnost
- hotovo %
- UI standard + layouty
