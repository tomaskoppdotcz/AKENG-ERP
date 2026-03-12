import React, { useEffect, useState } from "react";
import PlannerBoardPage from "./pages/PlannerBoardPage";
import PlannerPage from "./pages/PlannerPage";
import PortfolioGpnTpPage from "./pages/PortfolioGpnTpPage";

type ViewKey = "planner" | "portfolio" | "gantt";

function detectViewFromPath(): ViewKey {
  const path = window.location.pathname.toLowerCase();
  if (path.includes("portfolio")) return "portfolio";
  if (path.includes("gantt")) return "gantt";
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
        : next === "gantt"
        ? "/gantt"
        : "/planner";

    window.history.pushState({}, "", path);
    setView(next);
  }

  const navButtonStyle = (active: boolean): React.CSSProperties => ({
    border: active ? "1px solid #0f172a" : "1px solid #cbd5e1",
    background: active ? "#0f172a" : "#fff",
    color: active ? "#fff" : "#0f172a",
    borderRadius: 10,
    padding: "10px 14px",
    cursor: "pointer",
    fontWeight: 700,
  });

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

        <button onClick={() => navigate("planner")} style={navButtonStyle(view === "planner")}>
          Planner
        </button>

        <button onClick={() => navigate("gantt")} style={navButtonStyle(view === "gantt")}>
          Planner Gantt
        </button>

        <button onClick={() => navigate("portfolio")} style={navButtonStyle(view === "portfolio")}>
          Portfolio GPN + TP
        </button>
      </div>

      {view === "portfolio" ? (
        <PortfolioGpnTpPage />
      ) : view === "gantt" ? (
        <PlannerPage />
      ) : (
        <PlannerBoardPage />
      )}
    </div>
  );
}
