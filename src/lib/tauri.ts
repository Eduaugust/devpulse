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
  InvoiceProfile,
  Invoice,
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

export const addMonitoredRepo = (owner: string, name: string, provider?: string) =>
  invoke<number>("add_monitored_repo", { owner, name, provider: provider ?? "github" });

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

// GitLab commands
export const checkGlabAuth = () => invoke<boolean>("check_glab_auth");

export const fetchMyMrs = (repo: string) =>
  invoke<GhPr[]>("fetch_my_mrs", { repo });

export const fetchMyMrReviews = (repo: string) =>
  invoke<GhPr[]>("fetch_my_mr_reviews", { repo });

export const fetchGitlabTodos = () =>
  invoke<GhNotification[]>("fetch_gitlab_todos");

export const postGlabReview = (repo: string, mrNumber: number, body: string) =>
  invoke<string>("post_glab_review", { repo, mrNumber, body });

// Azure DevOps commands
export const checkAzAuth = () => invoke<boolean>("check_az_auth");

export const fetchAzMyPrs = (org: string, project: string, repo: string) =>
  invoke<GhPr[]>("fetch_az_my_prs", { org, project, repo });

export const fetchAzMyReviews = (org: string, project: string, repo: string) =>
  invoke<GhPr[]>("fetch_az_my_reviews", { org, project, repo });

export const azPrSetVote = (org: string, project: string, prId: number, vote: string) =>
  invoke<string>("az_pr_set_vote", { org, project, prId, vote });

export const postAzReviewComment = (org: string, project: string, repoId: string, prId: number, body: string) =>
  invoke<string>("post_az_review_comment", { org, project, repoId, prId, body });

// Bitbucket commands
export const checkBbAuth = (username: string, appPassword: string) =>
  invoke<{ username: string; display_name: string }>("check_bb_auth", { username, appPassword });

export const fetchBbRepos = (username: string, appPassword: string, workspace: string) =>
  invoke<string[]>("fetch_bb_repos", { username, appPassword, workspace });

export const fetchBbPrs = (username: string, appPassword: string, workspace: string, repoSlug: string) =>
  invoke<GhPr[]>("fetch_bb_prs", { username, appPassword, workspace, repoSlug });

export const postBbComment = (username: string, appPassword: string, workspace: string, repoSlug: string, prId: number, body: string) =>
  invoke<string>("post_bb_comment", { username, appPassword, workspace, repoSlug, prId, body });

export const fetchBbPrDiff = (username: string, appPassword: string, workspace: string, repoSlug: string, prId: number) =>
  invoke<string>("fetch_bb_pr_diff", { username, appPassword, workspace, repoSlug, prId });

export const approveBbPr = (username: string, appPassword: string, workspace: string, repoSlug: string, prId: number) =>
  invoke<string>("approve_bb_pr", { username, appPassword, workspace, repoSlug, prId });

export const editBbPrBody = (username: string, appPassword: string, workspace: string, repoSlug: string, prId: number, body: string) =>
  invoke<string>("edit_bb_pr_body", { username, appPassword, workspace, repoSlug, prId, body });

// Integration commands
export const testKimaiConnection = (url: string, apiToken: string) =>
  invoke<KimaiConnectionResult>("test_kimai_connection", { url, apiToken });

export const fetchKimaiTimesheets = (url: string, apiToken: string, begin: string, end: string) =>
  invoke<KimaiTimesheet[]>("fetch_kimai_timesheets", { url, apiToken, begin, end });

export const ensureKimaiMcp = (kimaiUrl: string, kimaiToken: string) =>
  invoke<void>("ensure_kimai_mcp", { kimaiUrl, kimaiToken });

export const testCalendarConnection = (credentialsJson: string, calendarId?: string) =>
  invoke<CalendarConnectionResult>("test_calendar_connection", {
    credentialsJson,
    calendarId: calendarId ?? null,
  });

export const authorizeCalendar = (clientConfigJson: string) =>
  invoke<string>("authorize_calendar", { clientConfigJson });

export const cancelCalendarAuth = () =>
  invoke<void>("cancel_calendar_auth");

export const fetchCalendarEvents = (credentialsJson: string, timeMin: string, timeMax: string, calendarId?: string, timezone?: string) =>
  invoke<CalendarEvent[]>("fetch_calendar_events", { credentialsJson, timeMin, timeMax, calendarId: calendarId ?? null, timezone: timezone ?? null });

export const testClaudeConnection = (apiKey: string) =>
  invoke<ClaudeConnectionResult>("test_claude_connection", { apiKey });

export const testClaudeCli = () =>
  invoke<ClaudeConnectionResult>("test_claude_cli");

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

// PTY commands
export const spawnPty = (command: string, args: string[], cwd: string | null, cols: number, rows: number) =>
  invoke<string>("spawn_pty", { command, args, cwd, cols, rows });

export const writePty = (sessionId: string, data: string) =>
  invoke<void>("write_pty", { sessionId, data });

export const resizePty = (sessionId: string, cols: number, rows: number) =>
  invoke<void>("resize_pty", { sessionId, cols, rows });

export const killPty = (sessionId: string) =>
  invoke<void>("kill_pty", { sessionId });

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

// Invoice commands
export const getInvoiceProfiles = (profileType?: string) =>
  invoke<InvoiceProfile[]>("get_invoice_profiles", { profileType: profileType ?? null });

export const saveInvoiceProfile = (profile: InvoiceProfile) =>
  invoke<number>("save_invoice_profile", { profile });

export const deleteInvoiceProfile = (id: number) =>
  invoke<void>("delete_invoice_profile", { id });

export const getInvoices = (limit?: number) =>
  invoke<Invoice[]>("get_invoices", { limit: limit ?? 50 });

export const getInvoice = (id: number) =>
  invoke<Invoice | null>("get_invoice", { id });

export const saveInvoice = (invoice: Invoice) =>
  invoke<number>("save_invoice", { invoice });

export const deleteInvoice = (id: number) =>
  invoke<void>("delete_invoice", { id });

