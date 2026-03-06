import { invoke } from "@tauri-apps/api/core";
import type {
  DevEvent,
  LocalRepo,
  MonitoredRepo,
  Setting,
  EventFilters,
  KimaiConnectionResult,
  KimaiTimesheet,
  CalendarConnectionResult,
  CalendarEvent,
  ClaudeConnectionResult,
  AiGenerationResult,
  GhPr,
  GhNotification,
  ClaudeSession,
  CommandDef,
  CommandRun,
} from "./types";

// DB commands
export const getEvents = (filters: EventFilters = {}) =>
  invoke<DevEvent[]>("get_events", {
    eventType: filters.event_type ?? null,
    repo: filters.repo ?? null,
    search: filters.search ?? null,
    limit: filters.limit ?? 50,
    offset: filters.offset ?? 0,
  });

export const getRecentEvents = () => invoke<DevEvent[]>("get_recent_events");

export const getLocalRepos = () => invoke<LocalRepo[]>("get_local_repos");

export const addLocalRepo = (path: string, name: string) =>
  invoke<number>("add_local_repo", { path, name });

export const removeLocalRepo = (id: number) =>
  invoke<void>("remove_local_repo", { id });

export const getMonitoredRepos = () =>
  invoke<MonitoredRepo[]>("get_monitored_repos");

export const addMonitoredRepo = (owner: string, name: string) =>
  invoke<number>("add_monitored_repo", { owner, name });

export const removeMonitoredRepo = (id: number) =>
  invoke<void>("remove_monitored_repo", { id });

export const updateMonitoredRepoBaseBranch = (id: number, baseBranch: string) =>
  invoke<void>("update_monitored_repo_base_branch", { id, baseBranch });

export const getSettings = () => invoke<Setting[]>("get_settings");

export const updateSetting = (key: string, value: string) =>
  invoke<void>("update_setting", { key, value });

// GitHub commands
export const checkGhAuth = () => invoke<boolean>("check_gh_auth");

export const fetchMyPrs = (repo: string) =>
  invoke<GhPr[]>("fetch_my_prs", { repo });

export const fetchMyReviews = (repo: string) =>
  invoke<GhPr[]>("fetch_my_reviews", { repo });

export const fetchNotifications = () =>
  invoke<GhNotification[]>("fetch_notifications");

export const postGhReview = (repo: string, prNumber: number, payloadJson: string) =>
  invoke<string>("post_gh_review", { repo, prNumber, payloadJson });

// Integration commands
export const testKimaiConnection = (url: string, apiToken: string) =>
  invoke<KimaiConnectionResult>("test_kimai_connection", { url, apiToken });

export const fetchKimaiTimesheets = (url: string, apiToken: string, begin: string, end: string) =>
  invoke<KimaiTimesheet[]>("fetch_kimai_timesheets", { url, apiToken, begin, end });

export const ensureKimaiMcp = (kimaiUrl: string, kimaiToken: string) =>
  invoke<void>("ensure_kimai_mcp", { kimaiUrl, kimaiToken });

export const testCalendarConnection = (credentialsJson: string) =>
  invoke<CalendarConnectionResult>("test_calendar_connection", {
    credentialsJson,
  });

export const authorizeCalendar = (clientConfigJson: string) =>
  invoke<string>("authorize_calendar", { clientConfigJson });

export const cancelCalendarAuth = () =>
  invoke<void>("cancel_calendar_auth");

export const fetchCalendarEvents = (credentialsJson: string, timeMin: string, timeMax: string) =>
  invoke<CalendarEvent[]>("fetch_calendar_events", { credentialsJson, timeMin, timeMax });

export const testClaudeConnection = (apiKey: string) =>
  invoke<ClaudeConnectionResult>("test_claude_connection", { apiKey });

export const generateWithAi = (apiKey: string, prompt: string) =>
  invoke<AiGenerationResult>("generate_with_ai", { apiKey, prompt });

export const runClaudeCli = (prompt: string) =>
  invoke<string>("run_claude_cli", { prompt });

// Terminal commands
export const openClaudeTerminal = (opts: {
  cwd?: string | null;
  args?: string[] | null;
  initialPrompt?: string | null;
  terminal?: string | null;
}) =>
  invoke<void>("open_claude_terminal", {
    cwd: opts.cwd ?? null,
    args: opts.args ?? null,
    initialPrompt: opts.initialPrompt ?? null,
    terminal: opts.terminal ?? null,
  });

// System commands
export const checkCommandAvailable = (command: string) =>
  invoke<boolean>("check_command_available", { command });

export const sendTestNotification = () =>
  invoke<string>("send_test_notification");

// Monitor commands
export const startMonitor = () => invoke<void>("start_monitor");
export const stopMonitor = () => invoke<void>("stop_monitor");
export const isMonitorRunning = () => invoke<boolean>("is_monitor_running");

// Claude session commands
export const createClaudeSession = (
  prompt: string,
  workingDirectory: string,
  model: string,
  permissionMode: string,
  maxBudget: number | null,
) =>
  invoke<number>("create_claude_session", {
    prompt,
    workingDirectory,
    model,
    permissionMode,
    maxBudget,
  });

export const updateClaudeSession = (
  id: number,
  status: string,
  resultText: string,
  costUsd: number | null,
  durationMs: number | null,
) =>
  invoke<void>("update_claude_session", {
    id,
    status,
    resultText,
    costUsd,
    durationMs,
  });

export const getClaudeSessions = (limit?: number) =>
  invoke<ClaudeSession[]>("get_claude_sessions", { limit: limit ?? 50 });

export const deleteClaudeSession = (id: number) =>
  invoke<void>("delete_claude_session", { id });

// Command system
export const getCommands = () => invoke<CommandDef[]>("get_commands");

export const getCommandBySlug = (slug: string) =>
  invoke<CommandDef | null>("get_command_by_slug", { slug });

export const saveCommand = (command: CommandDef) =>
  invoke<number>("save_command", { command });

export const deleteCommand = (id: number) =>
  invoke<void>("delete_command", { id });

export const resetBuiltinCommands = () =>
  invoke<void>("reset_builtin_commands");

export const createCommandRun = (commandId: number, parametersJson: string) =>
  invoke<number>("create_command_run", { commandId, parametersJson });

export const updateCommandRun = (
  id: number,
  status: string,
  resultText: string,
  errorText: string,
  durationMs: number | null,
) =>
  invoke<void>("update_command_run", { id, status, resultText, errorText, durationMs });

export const deleteCommandRun = (id: number) =>
  invoke<void>("delete_command_run", { id });

export const getCommandRuns = (commandId?: number, limit?: number) =>
  invoke<CommandRun[]>("get_command_runs", { commandId: commandId ?? null, limit: limit ?? 50 });

