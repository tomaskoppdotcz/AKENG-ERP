import React, { useEffect, useState } from "react";
import PlannerPage from "./pages/PlannerPage";
import PortfolioGpnTpPage from "./pages/PortfolioGpnTpPage";
import CapacityDashboardPage from "./pages/CapacityDashboardPage";
import AutoPlannerPage from "./pages/AutoPlannerPage";
import ShopfloorKioskPage from "./pages/ShopfloorKioskPage";

type ViewKey = "planner" | "portfolio" | "capacity" | "auto-planner" | "kiosk";

function detectViewFromPath(): ViewKey {
  const path = window.location.pathname.toLowerCase();
  if (path.includes("portfolio")) return "portfolio";
  if (path.includes("capacity")) return "capacity";
  if (path.includes("auto-planner")) return "auto-planner";
  if (path.includes("kiosk")) return "kiosk";
  return "planner";
}

export default function App() {
  const [view, setView] = useState<ViewKey>(detectViewFromPath());

  useEffect(() => {
    const onPopState = () => setView(detectViewFromPath());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  function navigate(next: ViewKey) {
    const path =
      next === "portfolio"
        ? "/portfolio"
        : next === "capacity"
        ? "/capacity"
        : next === "auto-planner"
        ? "/auto-planner"
        : next === "kiosk"
        ? "/kiosk"
        : "/gantt";

    window.history.pushState({}, "", path);
    setView(next);
  }

  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc", fontFamily: "Arial, sans-serif" }}>
      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 20,
          background: "#fff",
          borderBottom: "1px solid #dbe2ea",
          padding: 12,
          display: "flex",
          gap: 10,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <div style={{ fontWeight: 900, fontSize: 18, marginRight: 12 }}>AKENG ERP</div>

        <button
          onClick={() => navigate("planner")}
          style={{
            border: view === "planner" ? "1px solid #0f172a" : "1px solid #cbd5e1",
            background: view === "planner" ? "#0f172a" : "#fff",
            color: view === "planner" ? "#fff" : "#0f172a",
            borderRadius: 10,
            padding: "10px 14px",
            cursor: "pointer",
            fontWeight: 700,
          }}
        >
          Planner Gantt
        </button>

        <button
          onClick={() => navigate("capacity")}
          style={{
            border: view === "capacity" ? "1px solid #0f172a" : "1px solid #cbd5e1",
            background: view === "capacity" ? "#0f172a" : "#fff",
            color: view === "capacity" ? "#fff" : "#0f172a",
            borderRadius: 10,
            padding: "10px 14px",
            cursor: "pointer",
            fontWeight: 700,
          }}
        >
          Capacity Dashboard
        </button>

        <button
          onClick={() => navigate("auto-planner")}
          style={{
            border: view === "auto-planner" ? "1px solid #0f172a" : "1px solid #cbd5e1",
            background: view === "auto-planner" ? "#0f172a" : "#fff",
            color: view === "auto-planner" ? "#fff" : "#0f172a",
            borderRadius: 10,
            padding: "10px 14px",
            cursor: "pointer",
            fontWeight: 700,
          }}
        >
          Auto Planner
        </button>

        <button
          onClick={() => navigate("kiosk")}
          style={{
            border: view === "kiosk" ? "1px solid #0f172a" : "1px solid #cbd5e1",
            background: view === "kiosk" ? "#0f172a" : "#fff",
            color: view === "kiosk" ? "#fff" : "#0f172a",
            borderRadius: 10,
            padding: "10px 14px",
            cursor: "pointer",
            fontWeight: 700,
          }}
        >
          Shopfloor Kiosk
        </button>

        <button
          onClick={() => navigate("portfolio")}
          style={{
            border: view === "portfolio" ? "1px solid #0f172a" : "1px solid #cbd5e1",
            background: view === "portfolio" ? "#0f172a" : "#fff",
            color: view === "portfolio" ? "#fff" : "#0f172a",
            borderRadius: 10,
            padding: "10px 14px",
            cursor: "pointer",
            fontWeight: 700,
          }}
        >
          Portfolio GPN + TP
        </button>
      </div>

      {view === "portfolio" ? (
        <PortfolioGpnTpPage />
      ) : view === "capacity" ? (
        <CapacityDashboardPage />
      ) : view === "auto-planner" ? (
        <AutoPlannerPage />
      ) : view === "kiosk" ? (
        <ShopfloorKioskPage />
      ) : (
        <PlannerPage />
      )}
    </div>
  );
}
