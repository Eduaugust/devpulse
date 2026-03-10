export interface DevEvent {
  id: number | null;
  event_type: string;
  title: string;
  description: string;
  repo: string;
  url: string;
  created_at: string;
  read: boolean;
}

export interface LocalRepo {
  id: number | null;
  path: string;
  name: string;
  added_at: string;
}

export type GitProvider = "github" | "gitlab" | "azure" | "bitbucket";

export interface MonitoredRepo {
  id: number | null;
  owner: string;
  name: string;
  full_name: string;
  added_at: string;
  base_branch: string;
  provider: GitProvider;
}

export interface Setting {
  key: string;
  value: string;
}

export interface ConnectionStatus {
  status: "connected" | "disconnected" | "checking";
  message?: string;
}

export interface EventFilters {
  event_type?: string;
  repo?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface GhPr {
  number: number;
  title: string;
  url: string;
  state: string;
  repo: string;
  created_at: string;
  updated_at: string;
}

export interface GhNotification {
  id: string;
  title: string;
  reason: string;
  repo: string;
  url: string;
  updated_at: string;
}

export interface KimaiConnectionResult {
  connected: boolean;
  message: string;
  username?: string;
}

export interface KimaiTimesheet {
  id: number;
  begin: string;
  end: string | null;
  duration: number | null;
  description: string | null;
  project: Record<string, unknown> | null;
  activity: Record<string, unknown> | null;
}

export interface CalendarConnectionResult {
  connected: boolean;
  message: string;
}

export interface CalendarEvent {
  summary: string;
  start: string;
  end: string;
  all_day: boolean;
  attendees: number;
  status: string;
}

export interface ClaudeConnectionResult {
  connected: boolean;
  message: string;
}

export interface AiGenerationResult {
  text: string;
  model: string;
}

// Claude Code session types

export interface ClaudeSession {
  id: number | null;
  prompt: string;
  working_directory: string;
  model: string;
  permission_mode: string;
  max_budget: number | null;
  status: "running" | "completed" | "aborted" | "error";
  result_text: string;
  cost_usd: number | null;
  duration_ms: number | null;
  created_at: string;
  finished_at: string | null;
}

// NDJSON stream event types from `claude --output-format stream-json`

export interface ClaudeStreamSystem {
  type: "system";
  subtype: "init";
  session_id: string;
  tools: unknown[];
  model: string;
}

export interface ClaudeStreamAssistant {
  type: "assistant";
  message: {
    id: string;
    type: "message";
    role: "assistant";
    content: ClaudeContentBlock[];
    model: string;
    stop_reason: string | null;
    usage: { input_tokens: number; output_tokens: number };
  };
  session_id: string;
}

export interface ClaudeStreamResult {
  type: "result";
  subtype: string;
  cost_usd: number;
  duration_ms: number;
  duration_api_ms: number;
  is_error: boolean;
  num_turns: number;
  session_id: string;
}

export interface ClaudeContentBlock {
  type: "text" | "tool_use" | "tool_result";
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  content?: string;
}

export interface StreamedBlock {
  type: "text" | "tool_use" | "tool_result";
  text: string;
  toolName?: string;
  toolInput?: string;
  complete: boolean;
}

// Command system types

export interface CommandParam {
  key: string;
  label: string;
  type: "text" | "textarea" | "select_monitored_repo" | "select_pr" | "date" | "boolean";
  required: boolean;
  default?: string;
  depends_on?: string;
}

export interface CommandDef {
  id: number | null;
  slug: string;
  name: string;
  description: string;
  category: string;
  prompt_template: string;
  execution_method: string;
  parameters_json: string;
  is_builtin: boolean;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface CommandRun {
  id: number | null;
  command_id: number;
  parameters_json: string;
  status: string;
  result_text: string;
  error_text: string;
  duration_ms: number | null;
  created_at: string;
  finished_at: string | null;
}

// PR Review types

export interface ReviewFinding {
  category: "critical" | "warning" | "suggestion" | "positive";
  file: string;
  line: number;
  title: string;
  description: string;
  suggestion?: string;
}

export interface ReviewResult {
  rawMarkdown: string;
  findings: ReviewFinding[];
  verdict: "approve" | "request_changes" | "comment";
  summary: string;
}

// Background task types

export type BackgroundTaskType = "pr-review" | "post-review" | "report-generation" | "pr-description" | "pr-fixes";
export type BackgroundTaskStatus = "running" | "completed" | "error";

export interface BackgroundTask {
  id: string;
  type: BackgroundTaskType;
  label: string;
  status: BackgroundTaskStatus;
  repo?: string;
  prNumber?: number;
  result?: string;
  error?: string;
  startedAt: number;
  finishedAt?: number;
}

// Saved report/review types

export interface SavedReport {
  id: number;
  date: string;
  dateRange: string;
  content: string;
}

export interface SavedReview {
  id: number;
  date: string;
  label: string;
  content: string;
  repo?: string;
  prNumber?: number;
  prTitle?: string;
}

// PR Fix types

export interface ReviewComment {
  id: number;
  path: string;
  line: number | null;
  body: string;
  user: { login: string };
  created_at: string;
  diff_hunk: string;
  isResolved?: boolean;
}

export interface FixSuggestion {
  commentId: number;
  file: string;
  line: number | null;
  originalComment: string;
  suggestedFix: string;
  loading: boolean;
  error?: string;
}

export interface PrWithReviewStatus {
  number: number;
  title: string;
  url: string;
  repo: string;
  headRefName: string;
  author: { login: string };
  commentCount: number;
}

// Invoice types

export interface InvoiceProfile {
  id: number | null;
  profile_type: "sender" | "recipient";
  name: string;
  tax_number: string;
  address_line1: string;
  address_line2: string;
  city: string;
  state: string;
  country: string;
  postal_code: string;
  bank_details_json: string;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface InvoiceLineItem {
  description: string;
  quantity: number;
  rate: number;
  amount: number;
}

export interface Invoice {
  id: number | null;
  invoice_number: string;
  sender_profile_id: number;
  recipient_profile_id: number;
  invoice_date: string;
  due_date: string;
  currency: string;
  line_items_json: string;
  subtotal: number;
  tax_rate: number;
  tax_amount: number;
  total: number;
  notes: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface PrDetail {
  number: number;
  title: string;
  url: string;
  state: string;
  headRefName: string;
  baseRefName: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  author: { login: string };
  commits: { totalCount: number };
}
