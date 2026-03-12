import express from "express";
import cors from "cors";
import plannerRoutes from "./routes/planner.routes";

const app = express();

app.use(cors());
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.use("/api/planner", plannerRoutes);

const port = Number(process.env.PORT || 4000);

app.listen(port, () => {
  console.log(`AKENG ERP backend bezi na portu ${port}`);
});
