import React, { Suspense, useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate, Outlet } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import { TrayPanel } from "@/components/TrayPanel";
import { ThemeProvider } from "@/components/ThemeProvider";
import { useMonitorListener } from "@/hooks/useMonitorListener";
import { useSettingsStore } from "@/stores/settingsStore";
import "./index.css";

const Dashboard = React.lazy(() => import("@/pages/Dashboard").then(m => ({ default: m.Dashboard })));
const History = React.lazy(() => import("@/pages/History").then(m => ({ default: m.History })));
const Connections = React.lazy(() => import("@/pages/Connections").then(m => ({ default: m.Connections })));
const Settings = React.lazy(() => import("@/pages/Settings").then(m => ({ default: m.Settings })));
const ReportGenerator = React.lazy(() => import("@/pages/ReportGenerator").then(m => ({ default: m.ReportGenerator })));
const ClaudeCode = React.lazy(() => import("@/pages/ClaudeCode").then(m => ({ default: m.ClaudeCode })));
const PrReview = React.lazy(() => import("@/pages/PrReview").then(m => ({ default: m.PrReview })));
const Commands = React.lazy(() => import("@/pages/Commands").then(m => ({ default: m.Commands })));
const Invoices = React.lazy(() => import("@/pages/Invoices").then(m => ({ default: m.Invoices })));
const Onboarding = React.lazy(() => import("@/pages/Onboarding").then(m => ({ default: m.Onboarding })));
const GitActivity = React.lazy(() => import("@/pages/GitActivity").then(m => ({ default: m.GitActivity })));

function MonitorListener() {
  useMonitorListener();
  return null;
}

function OnboardingGuard() {
  const { fetchSettings, getSetting } = useSettingsStore();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    fetchSettings().then(() => setReady(true));
  }, [fetchSettings]);

  if (!ready) return null;

  if (getSetting("onboarding_completed") !== "true") {
    return <Navigate to="/onboarding" replace />;
  }

  return <Outlet />;
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ThemeProvider>
      <BrowserRouter>
        <MonitorListener />
        <Routes>
          <Route path="/tray" element={<TrayPanel />} />
          <Route path="/onboarding" element={<Suspense><Onboarding /></Suspense>} />
          <Route element={<OnboardingGuard />}>
            <Route element={<AppShell />}>
              <Route index element={<Navigate to="/reports" replace />} />
              <Route path="/history" element={<History />} />
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/claude-code" element={<ClaudeCode />} />
              <Route path="/pr-review" element={<PrReview />} />
              <Route path="/commands" element={<Commands />} />
              <Route path="/connections" element={<Connections />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/reports" element={<ReportGenerator />} />
              <Route path="/invoices" element={<Invoices />} />
              <Route path="/git-activity" element={<GitActivity />} />
            </Route>
          </Route>
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  </React.StrictMode>,
);
