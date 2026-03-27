import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import KioskAdminPage from "./pages/KioskAdminPage";
import KioskProductionPage from "./pages/KioskProductionPage";

function KioskRoot() {
  const path = window.location.pathname.replace(/\/$/, "") || "/";
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
