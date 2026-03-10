import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import { TrayPanel } from "@/components/TrayPanel";
import { ThemeProvider } from "@/components/ThemeProvider";
import { Dashboard } from "@/pages/Dashboard";
import { History } from "@/pages/History";
import { Connections } from "@/pages/Connections";
import { Settings } from "@/pages/Settings";
import { ReportGenerator } from "@/pages/ReportGenerator";
import { ClaudeCode } from "@/pages/ClaudeCode";
import { PrReview } from "@/pages/PrReview";
import { Commands } from "@/pages/Commands";
import { Invoices } from "@/pages/Invoices";
import { useMonitorListener } from "@/hooks/useMonitorListener";
import "./index.css";

function MonitorListener() {
  useMonitorListener();
  return null;
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ThemeProvider>
      <BrowserRouter>
        <MonitorListener />
        <Routes>
          <Route path="/tray" element={<TrayPanel />} />
          <Route element={<AppShell />}>
            <Route index element={<Dashboard />} />
            <Route path="/history" element={<History />} />
            <Route path="/claude-code" element={<ClaudeCode />} />
            <Route path="/pr-review" element={<PrReview />} />
            <Route path="/commands" element={<Commands />} />
            <Route path="/connections" element={<Connections />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/reports" element={<ReportGenerator />} />
            <Route path="/invoices" element={<Invoices />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  </React.StrictMode>,
);
