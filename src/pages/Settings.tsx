import { useEffect, useState, useCallback, useRef } from "react";
import { useSettingsStore } from "@/stores/settingsStore";
import type { MonitoredRepo, LocalRepo, GitProvider, AutofillRun } from "@/lib/types";
import * as commands from "@/lib/tauri";
import { fetchRepoList, detectUsername } from "@/lib/gitProvider";
import { basename } from "@tauri-apps/api/path";
import { isPermissionGranted, requestPermission } from "@tauri-apps/plugin-notification";
import { openUrl } from "@tauri-apps/plugin-opener";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Trash2, Plus, FolderOpen, RefreshCw, Eye, EyeOff, Bell, GripVertical, Loader2, GitPullRequestArrow, Play, Clock, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { getPlatform } from "@/lib/platform";
import { ToggleSwitch } from "@/components/ToggleSwitch";
import { useSidebarOrder } from "@/hooks/useSidebarOrder";
import { getTimezoneOptions, getSystemTimezone } from "@/lib/timezone";

function providerTag(provider: GitProvider) {
  const map: Record<GitProvider, { label: string; cls: string }> = {
    github: { label: "GH", cls: "bg-green-500/10 text-green-500" },
    gitlab: { label: "GL", cls: "bg-orange-500/10 text-orange-500" },
    azure: { label: "AZ", cls: "bg-blue-500/10 text-blue-500" },
    bitbucket: { label: "BB", cls: "bg-sky-500/10 text-sky-500" },
  };
  const { label, cls } = map[provider] ?? map.github;
  return (
    <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded-full shrink-0 ${cls}`}>
      {label}
    </span>
  );
}

function highlightMatch(text: string, query: string) {
  if (!query) return <>{text}</>;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <span className="font-semibold">{text.slice(idx, idx + query.length)}</span>
      {text.slice(idx + query.length)}
    </>
  );
}

const defaultSidebarItems = [
  { route: "/reports", label: "Reports" },
  { route: "/invoices", label: "Invoices" },
  { route: "/connections", label: "Connections" },
  { route: "/dashboard", label: "Dashboard" },
  { route: "/history", label: "History" },
  { route: "/claude-code", label: "Claude Code" },
  { route: "/pr-review", label: "PR Review" },
  { route: "/commands", label: "Commands" },
  { route: "/git-activity", label: "Git Activity" },
];

const betaRoutes = new Set(["/dashboard", "/history", "/claude-code", "/pr-review", "/commands", "/git-activity"]);

function SidebarSection({
  getSetting,
  updateSetting,
}: {
  getSetting: (key: string, fallback: string) => string;
  updateSetting: (key: string, value: string) => void;
}) {
  const { orderItems } = useSidebarOrder();
  const betaEnabled = Array.from(betaRoutes).some(
    (route) => getSetting(`sidebar_visible_${route}`, "true") === "true",
  );
  const filteredItems = betaEnabled
    ? defaultSidebarItems
    : defaultSidebarItems.filter((i) => !betaRoutes.has(i.route));
  const items = orderItems(filteredItems, (i) => i.route);

  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);

  const saveOrder = (newItems: typeof items) => {
    updateSetting("sidebar_order", JSON.stringify(newItems.map((i) => i.route)));
  };

  const handlePointerDown = (e: React.PointerEvent, idx: number) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setDragIdx(idx);
    setOverIdx(idx);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (dragIdx === null) return;
    for (let i = 0; i < rowRefs.current.length; i++) {
      const el = rowRefs.current[i];
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      if (e.clientY >= rect.top && e.clientY < rect.bottom) {
        setOverIdx(i);
        return;
      }
    }
  };

  const handlePointerUp = () => {
    if (dragIdx !== null && overIdx !== null && dragIdx !== overIdx) {
      const newItems = [...items];
      const [moved] = newItems.splice(dragIdx, 1);
      newItems.splice(overIdx, 0, moved);
      saveOrder(newItems);
    }
    setDragIdx(null);
    setOverIdx(null);
  };

  return (
    <section className="space-y-3">
      <h3 className="text-sm font-medium">Sidebar</h3>
      <div className="rounded-lg border bg-card p-4 space-y-0.5">
        {items.map(({ route, label }, idx) => {
          const settingKey = `sidebar_visible_${route}`;
          const visible = getSetting(settingKey, "true") === "true";
          const isDragging = dragIdx === idx;
          const isOver = overIdx === idx && dragIdx !== null && dragIdx !== idx;
          return (
            <div
              key={route}
              ref={(el) => { rowRefs.current[idx] = el; }}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              className={`flex items-center justify-between py-1.5 px-2 rounded-md transition-colors select-none ${
                isDragging ? "opacity-40" : ""
              } ${isOver ? "bg-accent/50" : ""}`}
            >
              <div className="flex items-center gap-2">
                <GripVertical
                  className="h-3.5 w-3.5 text-muted-foreground cursor-grab active:cursor-grabbing"
                  onPointerDown={(e) => handlePointerDown(e, idx)}
                />
                <p className="text-sm">{label}</p>
              </div>
              <button
                onClick={() => updateSetting(settingKey, visible ? "false" : "true")}
                className="p-1 rounded-md hover:bg-secondary transition-colors"
                title={visible ? "Hide from sidebar" : "Show in sidebar"}
              >
                {visible ? (
                  <Eye className="h-4 w-4 text-foreground" />
                ) : (
                  <EyeOff className="h-4 w-4 text-muted-foreground" />
                )}
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}


export function Settings() {
  const { settings, fetchSettings, updateSetting, getSetting } =
    useSettingsStore();
  const [monitoredRepos, setMonitoredRepos] = useState<MonitoredRepo[]>([]);
  const [localRepos, setLocalRepos] = useState<LocalRepo[]>([]);
  const [newRepo, setNewRepo] = useState("");

  const [detectingUser, setDetectingUser] = useState(false);
  const [notifPermission, setNotifPermission] = useState<"granted" | "denied" | "unknown">("unknown");
  const [notifTestResult, setNotifTestResult] = useState<string | undefined>();

  // Auto-fill state
  const [autofillRuns, setAutofillRuns] = useState<AutofillRun[]>([]);
  const [autofillRunning, setAutofillRunning] = useState(false);
  const [expandedRunId, setExpandedRunId] = useState<number | null>(null);

  const checkNotifPermission = useCallback(async () => {
    try {
      const granted = await isPermissionGranted();
      setNotifPermission(granted ? "granted" : "denied");
    } catch {
      setNotifPermission("unknown");
    }
  }, []);

  const handleRequestPermission = useCallback(async () => {
    try {
      const result = await requestPermission();
      setNotifPermission(result === "granted" ? "granted" : "denied");
    } catch {
      // If request fails, try opening System Settings
      const os = await getPlatform();
      if (os === "macos") {
        openUrl("x-apple.systempreferences:com.apple.preference.notifications").catch(() => {});
      } else if (os === "windows") {
        openUrl("ms-settings:notifications").catch(() => {});
      }
      // Linux: no universal settings URL — do nothing
    }
  }, []);

  const loadRepos = useCallback(async () => {
    try {
      const repos = await commands.getMonitoredRepos();
      setMonitoredRepos(repos);
    } catch (e) {
      console.error("Failed to load monitored repos:", e);
    }
  }, []);

  const loadLocalRepos = useCallback(async () => {
    try {
      const repos = await commands.getLocalRepos();
      setLocalRepos(repos);
    } catch (e) {
      console.error("Failed to load local repos:", e);
    }
  }, []);

  const addLocalRepo = async () => {
    const selected = await openDialog({
      directory: true,
      multiple: false,
      title: "Select a local repository",
    });
    if (selected) {
      const path = selected as string;
      const name = await basename(path);
      await commands.addLocalRepo(path, name);
      await loadLocalRepos();
    }
  };

  const removeLocalRepo = async (id: number) => {
    await commands.removeLocalRepo(id);
    await loadLocalRepos();
  };

  const detectGitHubUsername = useCallback(async () => {
    setDetectingUser(true);
    try {
      const login = await detectUsername("github");
      if (login) await updateSetting("github_username", login);
    } catch {
      // gh not authed or not installed
    } finally {
      setDetectingUser(false);
    }
  }, [updateSetting]);

  const loadAutofillRuns = useCallback(async () => {
    try {
      const runs = await commands.getAutofillRuns(5);
      setAutofillRuns(runs);
    } catch { /* ignore */ }
  }, []);

  const getLastWorkday = () => {
    const now = new Date();
    const day = now.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
    const daysBack = day === 1 ? 3 : day === 0 ? 2 : 1; // Mon→Fri, Sun→Fri, else→yesterday
    return new Date(Date.now() - daysBack * 86400000).toISOString().slice(0, 10);
  };

  const handleRunAutofill = useCallback(async () => {
    setAutofillRunning(true);
    try {
      const target = getLastWorkday();
      await commands.runAutofill(target);
      await loadAutofillRuns();
    } catch (e) {
      console.error("Auto-fill failed:", e);
    } finally {
      setAutofillRunning(false);
    }
  }, [loadAutofillRuns]);

  useEffect(() => {
    fetchSettings();
    loadRepos();
    loadLocalRepos();
    checkNotifPermission();
    loadAutofillRuns();
  }, [fetchSettings, loadRepos, loadLocalRepos, checkNotifPermission, loadAutofillRuns]);

  // Auto-detect GitHub username if empty on first load
  useEffect(() => {
    if (settings.github_username === undefined || settings.github_username === "") {
      detectGitHubUsername();
    }
  }, [settings.github_username, detectGitHubUsername]);

  const [allGhRepos, setAllGhRepos] = useState<string[]>([]);
  const [loadingGhRepos, setLoadingGhRepos] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [repoProvider, setRepoProvider] = useState<GitProvider>("github");

  const fetchAllGhRepos = useCallback(async () => {
    setLoadingGhRepos(true);
    try {
      const azOrg = repoProvider === "azure" ? getSetting("azure_org", "") : undefined;
      const repos = await fetchRepoList(repoProvider, azOrg || undefined);
      setAllGhRepos(repos);
    } catch {
      // CLI not available
    } finally {
      setLoadingGhRepos(false);
    }
  }, [repoProvider, getSetting]);

  // Load repos when provider changes or on mount
  useEffect(() => {
    fetchAllGhRepos();
  }, [fetchAllGhRepos]);

  const filteredSuggestions = (() => {
    if (!newRepo) return allGhRepos.slice(0, 10);
    const q = newRepo.toLowerCase();
    const existing = new Set(monitoredRepos.map((r) => r.full_name));
    return allGhRepos
      .filter((r) => r.toLowerCase().includes(q) && !existing.has(r))
      .slice(0, 10);
  })();

  const selectSuggestion = async (fullName: string) => {
    const parts = fullName.split("/");
    if (parts.length >= 2) {
      // For Azure, store org URL as owner; for others, store the namespace/owner
      const owner = repoProvider === "azure"
        ? getSetting("azure_org", "")
        : parts.slice(0, -1).join("/");
      const name = parts[parts.length - 1];
      await commands.addMonitoredRepo(owner, name, repoProvider);
      await loadRepos();
    }
    setNewRepo("");
    setShowSuggestions(false);
  };

  const addMonitoredRepo = async () => {
    const parts = newRepo.split("/");
    if (parts.length < 2) return;
    const owner = repoProvider === "azure"
      ? getSetting("azure_org", "")
      : parts.slice(0, -1).join("/");
    const name = parts[parts.length - 1];
    await commands.addMonitoredRepo(owner, name, repoProvider);
    setNewRepo("");
    setShowSuggestions(false);
    await loadRepos();
  };

  const removeRepo = async (id: number) => {
    await commands.removeMonitoredRepo(id);
    await loadRepos();
  };

  const handleThemeChange = (theme: string) => {
    updateSetting("theme", theme);
    document.documentElement.classList.remove("dark", "light");
    if (theme === "dark") {
      document.documentElement.classList.add("dark");
    } else if (theme === "light") {
      document.documentElement.classList.remove("dark");
    } else {
      // system
      if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
        document.documentElement.classList.add("dark");
      }
    }
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h2 className="text-lg font-semibold mb-1">Settings</h2>
        <p className="text-sm text-muted-foreground">
          Configure DevPulse behavior
        </p>
      </div>

      <section className="space-y-3">
        <h3 className="text-sm font-medium">General</h3>
        <div className="space-y-3 rounded-lg border bg-card p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm">Polling Interval</p>
              <p className="text-xs text-muted-foreground">
                How often to check for new events
              </p>
            </div>
            <select
              value={getSetting("polling_interval", "60")}
              onChange={(e) => updateSetting("polling_interval", e.target.value)}
              className="text-sm rounded-md border bg-background px-2 py-1"
            >
              <option value="30">30 seconds</option>
              <option value="60">1 minute</option>
              <option value="120">2 minutes</option>
              <option value="300">5 minutes</option>
              <option value="600">10 minutes</option>
              <option value="900">15 minutes</option>
            </select>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm">Theme</p>
              <p className="text-xs text-muted-foreground">App appearance</p>
            </div>
            <select
              value={getSetting("theme", "dark")}
              onChange={(e) => handleThemeChange(e.target.value)}
              className="text-sm rounded-md border bg-background px-2 py-1"
            >
              <option value="dark">Dark</option>
              <option value="light">Light</option>
              <option value="system">System</option>
            </select>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm">GitHub Username</p>
              <p className="text-xs text-muted-foreground">
                Used for filtering activity
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                value={getSetting("github_username", "")}
                onChange={(e) =>
                  updateSetting("github_username", e.target.value)
                }
                placeholder="username"
                className="text-sm rounded-md border bg-background px-2 py-1 w-40"
              />
              <button
                onClick={detectGitHubUsername}
                disabled={detectingUser}
                className="p-1 rounded-md border bg-background hover:bg-secondary transition-colors disabled:opacity-50"
                title="Detect from gh CLI"
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 ${detectingUser ? "animate-spin" : ""}`}
                />
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm">Azure DevOps Organization</p>
              <p className="text-xs text-muted-foreground">
                Full org URL (e.g., https://dev.azure.com/myorg)
              </p>
            </div>
            <input
              type="text"
              value={getSetting("azure_org", "")}
              onChange={(e) => updateSetting("azure_org", e.target.value)}
              placeholder="https://dev.azure.com/..."
              className="text-sm rounded-md border bg-background px-2 py-1 w-56"
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm">AI Provider</p>
              <p className="text-xs text-muted-foreground">
                How to run AI generation (Reports)
              </p>
            </div>
            <select
              value={getSetting("ai_provider", "claude-cli")}
              onChange={(e) => updateSetting("ai_provider", e.target.value)}
              className="text-sm rounded-md border bg-background px-2 py-1"
            >
              <option value="claude-cli">Claude CLI</option>
              <option value="api">Claude API (key required)</option>
            </select>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm">Timezone</p>
              <p className="text-xs text-muted-foreground">
                Used for API calls (Kimai, Calendar)
              </p>
            </div>
            <select
              value={getSetting("timezone", "")}
              onChange={(e) => updateSetting("timezone", e.target.value)}
              className="text-sm rounded-md border bg-background px-2 py-1 max-w-[220px]"
            >
              <option value="">Auto ({getSystemTimezone().split("/").pop()?.replace(/_/g, " ")})</option>
              {getTimezoneOptions().map((tz) => (
                <option key={tz.value} value={tz.value}>{tz.label}</option>
              ))}
            </select>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm">Beta Features</p>
              <p className="text-xs text-muted-foreground">
                Show Dashboard, History, Claude Code, PR Review, and Commands
              </p>
            </div>
            <ToggleSwitch
              enabled={Array.from(betaRoutes).some(
                (route) => getSetting(`sidebar_visible_${route}`, "true") === "true",
              )}
              onToggle={() => {
                const anyVisible = Array.from(betaRoutes).some(
                  (route) => getSetting(`sidebar_visible_${route}`, "true") === "true",
                );
                const newVal = anyVisible ? "false" : "true";
                for (const route of betaRoutes) {
                  updateSetting(`sidebar_visible_${route}`, newVal);
                }
              }}
            />
          </div>
        </div>
      </section>

      {Array.from(betaRoutes).some(
        (route) => getSetting(`sidebar_visible_${route}`, "true") === "true",
      ) && <section className="space-y-3">
        <h3 className="text-sm font-medium">Notifications</h3>
        <div className="space-y-3 rounded-lg border bg-card p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Bell className="h-3.5 w-3.5 text-muted-foreground" />
              <div>
                <p className="text-sm">System Permission</p>
                <p className="text-xs text-muted-foreground">
                  System notification permission
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span
                className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                  notifPermission === "granted"
                    ? "bg-green-500/10 text-green-500"
                    : notifPermission === "denied"
                      ? "bg-destructive/10 text-destructive"
                      : "bg-muted text-muted-foreground"
                }`}
              >
                {notifPermission === "granted"
                  ? "Granted"
                  : notifPermission === "denied"
                    ? "Denied"
                    : "Unknown"}
              </span>
              {notifPermission !== "granted" && (
                <button
                  onClick={
                    notifPermission === "denied"
                      ? async () => {
                          const os = await getPlatform();
                          if (os === "macos") openUrl("x-apple.systempreferences:com.apple.preference.notifications").catch(() => {});
                          else if (os === "windows") openUrl("ms-settings:notifications").catch(() => {});
                        }
                      : handleRequestPermission
                  }
                  className="text-xs px-2 py-0.5 rounded-md border bg-background hover:bg-secondary transition-colors"
                >
                  {notifPermission === "denied" ? "Open Settings" : "Request"}
                </button>
              )}
            </div>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm">Test Notification</p>
              <p className="text-xs text-muted-foreground">
                {notifTestResult || "Send a test notification to verify it works"}
              </p>
            </div>
            <button
              onClick={async () => {
                setNotifTestResult(undefined);
                try {
                  const result = await commands.sendTestNotification();
                  setNotifTestResult(result);
                } catch (e) {
                  setNotifTestResult(`Error: ${e}`);
                }
              }}
              className="text-xs px-3 py-1 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              Send Test
            </button>
          </div>
          <div className="border-t" />
          {[
            { key: "notifications_enabled", label: "Enable notifications" },
            { key: "notify_prs", label: "PR notifications" },
            { key: "notify_reviews", label: "Review request notifications" },
            { key: "notify_mentions", label: "Mention notifications" },
          ].map(({ key, label }) => (
            <div key={key} className="flex items-center justify-between">
              <p className="text-sm">{label}</p>
              <ToggleSwitch
                enabled={settings[key] === "true"}
                onToggle={() => updateSetting(key, settings[key] === "true" ? "false" : "true")}
              />
            </div>
          ))}
        </div>
      </section>}

      {Array.from(betaRoutes).some(
        (route) => getSetting(`sidebar_visible_${route}`, "true") === "true",
      ) && <section className="space-y-3">
        <h3 className="text-sm font-medium">Automation</h3>
        <div className="space-y-3 rounded-lg border bg-card p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm">Auto-Review PRs</p>
              <p className="text-xs text-muted-foreground">
                Automatically run AI review when a new review is requested
              </p>
            </div>
            <ToggleSwitch
              enabled={settings.auto_review_enabled === "true"}
              onToggle={() => updateSetting("auto_review_enabled", settings.auto_review_enabled === "true" ? "false" : "true")}
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm">Auto-Post Reviews</p>
              <p className="text-xs text-muted-foreground">
                Also post the review to GitHub as a pending review
              </p>
            </div>
            <ToggleSwitch
              enabled={settings.auto_review_post === "true"}
              onToggle={() => updateSetting("auto_review_post", settings.auto_review_post === "true" ? "false" : "true")}
              disabled={settings.auto_review_enabled !== "true"}
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm">Auto-Describe PRs</p>
              <p className="text-xs text-muted-foreground">
                Automatically generate PR description when you create a PR with an empty body
              </p>
            </div>
            <ToggleSwitch
              enabled={getSetting("auto_description_enabled", "false") === "true"}
              onToggle={() => updateSetting("auto_description_enabled", getSetting("auto_description_enabled", "false") === "true" ? "false" : "true")}
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm">Auto-Fix PRs</p>
              <p className="text-xs text-muted-foreground">
                Automatically open Claude to fix review comments when changes are requested
              </p>
            </div>
            <ToggleSwitch
              enabled={getSetting("auto_fixes_enabled", "false") === "true"}
              onToggle={() => updateSetting("auto_fixes_enabled", getSetting("auto_fixes_enabled", "false") === "true" ? "false" : "true")}
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm">Include Review Comments</p>
              <p className="text-xs text-muted-foreground">
                Also trigger auto-fix on review comments (e.g. Copilot), not just changes requested
              </p>
            </div>
            <ToggleSwitch
              enabled={getSetting("auto_fixes_comments", "false") === "true"}
              onToggle={() => updateSetting("auto_fixes_comments", getSetting("auto_fixes_comments", "false") === "true" ? "false" : "true")}
              disabled={getSetting("auto_fixes_enabled", "false") !== "true"}
            />
          </div>
        </div>
      </section>}

      {/* Auto-Fill Timesheet */}
      <section className="space-y-3">
        <h3 className="text-sm font-medium">Auto-Fill Timesheet</h3>
        <div className="space-y-3 rounded-lg border bg-card p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm">Enable Auto-Fill</p>
              <p className="text-xs text-muted-foreground">
                Automatically fill Kimai timesheet for the previous day
              </p>
            </div>
            <ToggleSwitch
              enabled={settings.autofill_enabled === "true"}
              onToggle={() => updateSetting("autofill_enabled", settings.autofill_enabled === "true" ? "false" : "true")}
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm">Schedule Time</p>
              <p className="text-xs text-muted-foreground">
                Time of day to run auto-fill
              </p>
            </div>
            <input
              type="time"
              value={settings.autofill_time || "09:00"}
              onChange={(e) => updateSetting("autofill_time", e.target.value)}
              disabled={settings.autofill_enabled !== "true"}
              className="text-sm rounded-md border bg-background px-2 py-1 disabled:opacity-50"
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm">Context Days</p>
              <p className="text-xs text-muted-foreground">
                Days of Kimai history for context
              </p>
            </div>
            <input
              type="number"
              min={1}
              max={60}
              value={settings.autofill_context_days || "14"}
              onChange={(e) => updateSetting("autofill_context_days", e.target.value)}
              disabled={settings.autofill_enabled !== "true"}
              className="w-16 text-sm rounded-md border bg-background px-2 py-1 disabled:opacity-50"
            />
          </div>

          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={handleRunAutofill}
              disabled={autofillRunning}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {autofillRunning ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play className="h-3.5 w-3.5" />
              )}
              {autofillRunning ? "Running..." : `Run Now (${getLastWorkday()})`}
            </button>
          </div>

          {autofillRuns.length > 0 && (
            <div className="pt-2 border-t border-border space-y-1">
              <p className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                <Clock className="h-3 w-3" /> Recent Runs
              </p>
              {autofillRuns.map((run) => (
                <div key={run.id}>
                  <button
                    onClick={() => setExpandedRunId(expandedRunId === run.id ? null : run.id)}
                    className="flex w-full items-center justify-between text-xs py-1 hover:bg-accent/50 rounded px-1 -mx-1"
                  >
                    <span className="flex items-center gap-1">
                      <ChevronRight className={cn("h-3 w-3 transition-transform", expandedRunId === run.id && "rotate-90")} />
                      {run.target_date}
                    </span>
                    <span className={
                      run.status === "completed" ? "text-green-500" :
                      run.status === "error" ? "text-red-500" :
                      "text-yellow-500"
                    }>
                      {run.status} {run.entries_created > 0 && `(${run.entries_created} entries)`}
                    </span>
                  </button>
                  {expandedRunId === run.id && (
                    <div className="ml-4 mt-1 mb-2">
                      {run.result_text ? (
                        <pre className="text-xs text-muted-foreground whitespace-pre-wrap bg-accent/20 rounded p-2 max-h-48 overflow-y-auto">
                          {run.result_text}
                        </pre>
                      ) : run.error_text ? (
                        <pre className="text-xs text-red-400 whitespace-pre-wrap bg-accent/20 rounded p-2 max-h-48 overflow-y-auto">
                          {run.error_text}
                        </pre>
                      ) : (
                        <p className="text-xs text-muted-foreground italic">No details available.</p>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-medium">Connections</h3>
        <div className="rounded-lg border bg-card p-4 space-y-0.5">
          {[
            { key: "github", label: "GitHub CLI" },
            { key: "gitlab", label: "GitLab CLI" },
            { key: "azure", label: "Azure DevOps" },
            { key: "bitbucket", label: "Bitbucket" },
            { key: "kimai", label: "Kimai" },
            { key: "calendar", label: "Google Calendar" },
            { key: "claude_cli", label: "Claude CLI" },
            // Beta-only connections
            ...( Array.from(betaRoutes).some(r => getSetting(`sidebar_visible_${r}`, "true") === "true")
              ? [{ key: "claude", label: "Claude API" }]
              : []
            ),
          ].map(({ key, label }) => {
            const settingKey = `connection_visible_${key}`;
            const visible = getSetting(settingKey, "true") === "true";
            return (
              <div
                key={key}
                className="flex items-center justify-between py-1.5 px-2 rounded-md"
              >
                <p className="text-sm">{label}</p>
                <button
                  onClick={() => updateSetting(settingKey, visible ? "false" : "true")}
                  className="p-1 rounded-md hover:bg-secondary transition-colors"
                  title={visible ? "Hide from Connections" : "Show in Connections"}
                >
                  {visible ? (
                    <Eye className="h-4 w-4 text-foreground" />
                  ) : (
                    <EyeOff className="h-4 w-4 text-muted-foreground" />
                  )}
                </button>
              </div>
            );
          })}
        </div>
      </section>

      <SidebarSection getSetting={getSetting} updateSetting={updateSetting} />

      <section className="space-y-3">
        <h3 className="text-sm font-medium">Local Repositories</h3>
        <p className="text-xs text-muted-foreground -mt-1">
          Used for git log analysis in Reports and VS Code integration in PR Review
        </p>
        <div className="rounded-lg border bg-card p-4 space-y-3">
          <button
            onClick={addLocalRepo}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border bg-background hover:bg-secondary transition-colors w-full justify-center"
          >
            <FolderOpen className="h-3.5 w-3.5" />
            Add local repository...
          </button>
          {localRepos.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-2">
              No local repositories configured
            </p>
          ) : (
            <div className="space-y-1">
              {localRepos.map((repo) => (
                <div
                  key={repo.id}
                  className="flex items-center justify-between px-2 py-1.5 rounded bg-secondary"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium truncate">{repo.name}</p>
                    <p className="text-[10px] text-muted-foreground font-mono truncate">
                      {repo.path}
                    </p>
                  </div>
                  <button
                    onClick={() => repo.id !== null && removeLocalRepo(repo.id)}
                    className="text-muted-foreground hover:text-destructive transition-colors shrink-0 ml-2"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">Monitored Repositories</h3>
          <button
            onClick={fetchAllGhRepos}
            disabled={loadingGhRepos}
            className="p-1 rounded-md border bg-background hover:bg-secondary transition-colors disabled:opacity-50"
            title={`Refresh repo list from ${repoProvider === "gitlab" ? "GitLab" : "GitHub"}`}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loadingGhRepos ? "animate-spin" : ""}`} />
          </button>
        </div>
        <div className="rounded-lg border bg-card p-4 space-y-3">
          <div className="relative">
            <div className="flex gap-2">
              <select
                value={repoProvider}
                onChange={(e) => {
                  setRepoProvider(e.target.value as GitProvider);
                  setAllGhRepos([]);
                }}
                className="text-xs rounded-md border bg-background px-2 py-1 w-24 shrink-0"
              >
                <option value="github">GitHub</option>
                <option value="gitlab">GitLab</option>
                <option value="azure">Azure DevOps</option>
                <option value="bitbucket">Bitbucket</option>
              </select>
              <div className="flex-1 relative">
                <input
                  type="text"
                  placeholder={loadingGhRepos ? "Loading repos..." : "Search repos..."}
                  value={newRepo}
                  onChange={(e) => setNewRepo(e.target.value)}
                  onFocus={() => setShowSuggestions(true)}
                  onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") addMonitoredRepo();
                    if (e.key === "Escape") setShowSuggestions(false);
                  }}
                  className="w-full text-sm rounded-md border bg-background px-2 py-1 pr-7"
                />
                {loadingGhRepos && (
                  <Loader2 className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin text-muted-foreground" />
                )}
              </div>
              <button
                onClick={addMonitoredRepo}
                disabled={!newRepo.includes("/")}
                className="flex items-center gap-1 px-2 py-1 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                <Plus className="h-3 w-3" />
                Add
              </button>
            </div>
            {showSuggestions && filteredSuggestions.length > 0 && (
              <div className="absolute z-10 top-full left-0 right-12 mt-1 rounded-md border bg-popover shadow-md overflow-hidden max-h-48 overflow-y-auto">
                {filteredSuggestions.map((name) => (
                  <button
                    key={name}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => selectSuggestion(name)}
                    className="w-full text-left px-3 py-1.5 text-xs font-mono hover:bg-accent transition-colors flex items-center gap-2"
                  >
                    {providerTag(repoProvider)}
                    {highlightMatch(name, newRepo)}
                  </button>
                ))}
              </div>
            )}
          </div>
          {monitoredRepos.length === 0 ? (
            <div className="flex flex-col items-center py-6 gap-2 text-muted-foreground">
              <GitPullRequestArrow className="h-8 w-8" />
              <p className="text-sm font-medium">No monitored repositories</p>
              <p className="text-xs">Add repos to track PRs, reviews, and notifications</p>
            </div>
          ) : (
            <div className="space-y-2">
              {monitoredRepos.map((repo) => (
                <div
                  key={repo.id}
                  className="rounded-lg bg-secondary px-3 py-2 space-y-1.5"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 min-w-0">
                      {providerTag(repo.provider ?? "github")}
                      <span className="text-xs font-mono truncate">{repo.full_name}</span>
                    </div>
                    <button
                      onClick={() => repo.id !== null && removeRepo(repo.id)}
                      className="text-muted-foreground hover:text-destructive transition-colors shrink-0"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-muted-foreground shrink-0">Compare against:</span>
                    <input
                      type="text"
                      value={repo.base_branch}
                      placeholder="development"
                      onChange={(e) => {
                        const val = e.target.value;
                        if (repo.id !== null) {
                          commands.updateMonitoredRepoBaseBranch(repo.id, val).catch(console.error);
                          setMonitoredRepos((prev) =>
                            prev.map((r) => r.id === repo.id ? { ...r, base_branch: val } : r),
                          );
                        }
                      }}
                      className="text-[10px] font-mono w-40 rounded border bg-background px-1.5 py-0.5"
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
