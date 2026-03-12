import { Router } from "express";
import { getPlannerGanttHandler } from "../controllers/planner.controller";

const router = Router();

router.get("/gantt", getPlannerGanttHandler);

export default router;
