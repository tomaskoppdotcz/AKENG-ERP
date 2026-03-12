import { Request, Response } from "express";
import { getPlannerGantt } from "../services/planner.service";

function isValidDateString(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export async function getPlannerGanttHandler(req: Request, res: Response) {
  try {
    const from = String(req.query.from || "");
    const to = String(req.query.to || "");

    if (!from || !to) {
      return res.status(400).json({
        error: "Parametry from a to jsou povinne ve formatu YYYY-MM-DD.",
      });
    }

    if (!isValidDateString(from) || !isValidDateString(to)) {
      return res.status(400).json({
        error: "Neplatny format data. Pouzij YYYY-MM-DD.",
      });
    }

    const result = await getPlannerGantt(from, to);

    return res.json(result);
  } catch (error: any) {
    console.error("getPlannerGanttHandler error:", error);
    return res.status(500).json({
      error: error?.message || "Nepodarilo se nacist planner gantt.",
    });
  }
}
