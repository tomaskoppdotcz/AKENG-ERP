import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import KioskAdminPage from "./pages/KioskAdminPage";
import KioskProductionPage from "./pages/KioskProductionPage";

function KioskRoot() {
  const path = window.location.pathname.replace(/\/$/, "") || "/";
  if (
    path === "/planning/machine-shifts" ||
    path.endsWith("/planning/machine-shifts") ||
    path === "/planning/workplace-shifts" ||
    path.endsWith("/planning/workplace-shifts")
  ) {
    try {
      sessionStorage.setItem(
        "akeng_pending_module",
        JSON.stringify({ moduleKey: "Plán směny pracovišť", title: "Směny pracovišť" })
      );
    } catch {
      /* ignore */
    }
    window.history.replaceState({}, "", "/");
  }
  if (path === "/employees") {
    try {
      sessionStorage.setItem(
        "akeng_pending_module",
        JSON.stringify({ moduleKey: "Zaměstnanci", title: "Zaměstnanci" })
      );
    } catch {
      /* ignore */
    }
    window.history.replaceState({}, "", "/");
  }
  if (path === "/work-reports/new" || path.endsWith("/work-reports/new")) {
    try {
      sessionStorage.setItem("akeng_pending_work_report_new", "1");
    } catch {
      /* ignore */
    }
    window.history.replaceState({}, "", "/");
  }
  const workReportPath = path.match(/^\/work-reports\/(\d+)$/);
  if (workReportPath) {
    const workReportId = Number(workReportPath[1]);
    if (Number.isFinite(workReportId) && workReportId > 0) {
      try {
        sessionStorage.setItem("akeng_pending_work_report", JSON.stringify({ workReportId }));
      } catch {
        /* ignore */
      }
      window.history.replaceState({}, "", "/");
    }
  }
  const workReportEditPath = path.match(/^\/work-reports\/(\d+)\/edit$/);
  if (workReportEditPath) {
    const workReportId = Number(workReportEditPath[1]);
    if (Number.isFinite(workReportId) && workReportId > 0) {
      try {
        sessionStorage.setItem("akeng_pending_work_report_edit", JSON.stringify({ workReportId }));
      } catch {
        /* ignore */
      }
      window.history.replaceState({}, "", "/");
    }
  }
  const params = new URLSearchParams(window.location.search);
  const machine = params.get("machine") || "";
  if (path === "/kiosk/admin" || path.endsWith("/kiosk/admin")) {
    return <KioskAdminPage machineCode={machine} />;
  }
  if (path === "/kiosk/production" || path.endsWith("/kiosk/production")) {
    return <KioskProductionPage machineCode={machine} />;
  }
  return <App />;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <KioskRoot />
  </React.StrictMode>
);
