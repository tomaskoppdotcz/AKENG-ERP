import { pool } from "../database/db";

type DbRow = {
  operation_id: number;
  order_id: number | null;
  order_number: string | null;
  portfolio_id: number | null;
  gpn: string | null;
  tp_code: string | null;
  operation_name: string;
  machine_id: number;
  machine_name: string;
  status: "ceka" | "naplanovano" | "bezi" | "hotovo" | "blokovano";
  planned_start: string;
  planned_end: string;
  setup_min: number | null;
  cycle_min: number | null;
  qty: number | null;
  total_min: number | null;
};

function buildDays(from: string, to: string): string[] {
  const result: string[] = [];
  const start = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);

  const x = new Date(start);
  while (x <= end) {
    const y = x.getFullYear();
    const m = `${x.getMonth() + 1}`.padStart(2, "0");
    const d = `${x.getDate()}`.padStart(2, "0");
    result.push(`${y}-${m}-${d}`);
    x.setDate(x.getDate() + 1);
  }

  return result;
}

export async function getPlannerGantt(from: string, to: string) {
  const days = buildDays(from, to);

  const sql = `
    SELECT
      o.id AS operation_id,
      o.order_id,
      ord.order_number,
      o.portfolio_id,
      p.gpn,
      p.tp_code,
      o.name AS operation_name,
      o.machine_id,
      m.name AS machine_name,
      COALESCE(o.status, 'naplanovano') AS status,
      o.planned_start,
      o.planned_end,
      COALESCE(o.setup_min, 0) AS setup_min,
      COALESCE(o.cycle_min, 0) AS cycle_min,
      COALESCE(o.qty, 1) AS qty,
      COALESCE(o.total_min, ((COALESCE(o.setup_min, 0) + (COALESCE(o.cycle_min, 0) * COALESCE(o.qty, 1)))), 0) AS total_min
    FROM operations o
    INNER JOIN machines m ON m.id = o.machine_id
    LEFT JOIN orders ord ON ord.id = o.order_id
    LEFT JOIN portfolio p ON p.id = o.portfolio_id
    WHERE
      o.planned_start IS NOT NULL
      AND o.planned_end IS NOT NULL
      AND o.planned_end >= $1::timestamp
      AND o.planned_start <= ($2::date + interval '1 day' - interval '1 second')
    ORDER BY
      m.name ASC,
      o.planned_start ASC,
      o.id ASC
  `;

  const { rows } = await pool.query<DbRow>(sql, [from, to]);

  const machineMap = new Map<
    number,
    {
      machineId: number;
      machineName: string;
      items: Array<{
        operationId: number;
        orderId: number | null;
        orderNumber: string | null;
        portfolioId: number | null;
        gpn: string | null;
        tpCode: string | null;
        operationName: string;
        machineId: number;
        machineName: string;
        status: "ceka" | "naplanovano" | "bezi" | "hotovo" | "blokovano";
        plannedStart: string;
        plannedEnd: string;
        setupMin: number;
        cycleMin: number;
        qty: number;
        totalMin: number;
      }>;
    }
  >();

  for (const row of rows) {
    if (!machineMap.has(row.machine_id)) {
      machineMap.set(row.machine_id, {
        machineId: row.machine_id,
        machineName: row.machine_name,
        items: [],
      });
    }

    machineMap.get(row.machine_id)!.items.push({
      operationId: row.operation_id,
      orderId: row.order_id,
      orderNumber: row.order_number,
      portfolioId: row.portfolio_id,
      gpn: row.gpn,
      tpCode: row.tp_code,
      operationName: row.operation_name,
      machineId: row.machine_id,
      machineName: row.machine_name,
      status: row.status,
      plannedStart: new Date(row.planned_start).toISOString(),
      plannedEnd: new Date(row.planned_end).toISOString(),
      setupMin: Number(row.setup_min || 0),
      cycleMin: Number(row.cycle_min || 0),
      qty: Number(row.qty || 1),
      totalMin: Number(row.total_min || 0),
    });
  }

  const machines = Array.from(machineMap.values());

  return {
    from,
    to,
    days,
    machines,
  };
}
