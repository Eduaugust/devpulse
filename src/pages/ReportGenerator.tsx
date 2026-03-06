import { useState, useCallback, useEffect, useRef } from "react";
import * as commands from "@/lib/tauri";
import { openClaudeTerminal } from "@/lib/tauri";
import { fetchKimaiTimesheets, ensureKimaiMcp } from "@/lib/tauri";
import { useSettingsStore } from "@/stores/settingsStore";
import { useBackgroundTaskStore } from "@/stores/backgroundTaskStore";
import { useReportStore } from "@/stores/reportStore";
import { getCredential } from "@/lib/credentials";
import { Command } from "@tauri-apps/plugin-shell";
import type { SavedReport } from "@/lib/types";
import {
  FileText,
  Copy,
  Bot,
  Loader2,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  Trash2,
  Terminal,
} from "lucide-react";

async function runGit(args: string[], cwd: string): Promise<string> {
  try {
    const cmd = Command.create("git", args, { cwd });
    const out = await cmd.execute();
    return out.code === 0 ? out.stdout.trim() : "";
  } catch {
    return "";
  }
}

async function runGh(args: string[]): Promise<string> {
  try {
    const cmd = Command.create("gh", args);
    const out = await cmd.execute();
    return out.code === 0 ? out.stdout.trim() : "";
  } catch {
    return "";
  }
}

export function ReportGenerator() {
  const today = new Date().toISOString().split("T")[0];
  const [dateFrom, setDateFrom] = useState(today);
  const [dateTo, setDateTo] = useState(today);
  const [copied, setCopied] = useState(false);

  const [includeGit, setIncludeGit] = useState(true);
  const [includeGitHub, setIncludeGitHub] = useState(true);
  const [includeKimai, setIncludeKimai] = useState(false);
  const [includeCalendar, setIncludeCalendar] = useState(true);

  // Persistent state via Zustand (survives tab switches)
  const {
    generatedPrompt, aiResult, gathering, generating,
    setGeneratedPrompt, setAiResult, setGathering, setGenerating,
  } = useReportStore();

  // Report history
  const [savedReports, setSavedReports] = useState<SavedReport[]>([]);
  const [expandedReport, setExpandedReport] = useState<number | null>(null);

  const { addTask, updateTask } = useBackgroundTaskStore();
  const didAutoExpand = useRef(false);

  // Load saved reports from command_runs
  const loadReports = useCallback(async () => {
    try {
      const runs = await commands.getCommandRuns(undefined, 50);
      const reports: SavedReport[] = runs
        .filter((r) => r.status === "completed" && r.result_text)
        .map((r) => {
          let dateRange = "";
          try {
            const params = JSON.parse(r.parameters_json);
            dateRange = params.dateRange || "";
          } catch { /* */ }
          return {
            id: r.id!,
            date: r.created_at,
            dateRange,
            content: r.result_text,
          };
        });
      setSavedReports(reports);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    loadReports();
  }, [loadReports]);

  // Auto-expand most recent report on first load
  useEffect(() => {
    if (!didAutoExpand.current && savedReports.length > 0 && expandedReport === null) {
      didAutoExpand.current = true;
      setExpandedReport(savedReports[0].id);
    }
  }, [savedReports, expandedReport]);

  const generatePrompt = useCallback(async () => {
    setGathering(true);
    setGeneratedPrompt("");

    const taskId = addTask("report-generation", `Gathering data for ${dateFrom}`, {});

    const { getSetting } = useSettingsStore.getState();
    const author = getSetting("github_username", "");
    const afterDate = dateFrom;
    // Add one day for --before (git uses exclusive end)
    const beforeDate = new Date(new Date(dateTo).getTime() + 86400000)
      .toISOString()
      .split("T")[0];

    let prompt = `Generate a detailed daily development activity report for ${dateFrom}`;
    if (dateFrom !== dateTo) prompt += ` to ${dateTo}`;
    prompt += `.\n\nBelow is the raw data gathered from multiple sources. Analyze it and produce a structured report with:\n- Key accomplishments\n- Work in progress\n- Time estimates per activity (based on commit timestamps)\n- PRs and code reviews\n- Meetings (if any)\n- Blockers\n\n`;

    try {
      // ── Git Local ──
      if (includeGit) {
        try {
          const repos = await commands.getLocalRepos();
          // Resolve author: use setting, fallback to git config user.name
          let gitAuthor = author;
          if (!gitAuthor && repos.length > 0) {
            gitAuthor = await runGit(["config", "user.name"], repos[0].path);
          }
          if (repos.length > 0) {
            prompt += "# Git Local Activity\n\n";
            for (const repo of repos) {
              const logArgs = [
                "log",
                "--all",
                `--after=${afterDate}`,
                `--before=${beforeDate}`,
                "--format=%h|%ai|%s",
                "--shortstat",
              ];
              // Always filter by author to avoid pulling everyone's commits
              if (gitAuthor) logArgs.push(`--author=${gitAuthor}`);
              const log = await runGit(logArgs, repo.path);
              if (log) {
                prompt += `## ${repo.name}\n\`\`\`\n${log}\n\`\`\`\n\n`;
              }
            }
          }
        } catch {
          prompt += "# Git Local Activity\nFailed to gather git data.\n\n";
        }
      }

      // ── GitHub ──
      if (includeGitHub) {
        prompt += "# GitHub Activity\n\n";
        try {
          const monitoredRepos = await commands.getMonitoredRepos();
          const repoNames = monitoredRepos.map((r) => r.full_name);

          for (const repoName of repoNames) {
            let repoSection = "";

            // My PRs with activity in the date range
            const prsJson = await runGh([
              "pr", "list", "--repo", repoName, "--author", "@me",
              "--state", "all",
              "--search", `updated:${afterDate}..${beforeDate}`,
              "--json", "number,title,state,headRefName,additions,deletions",
              "--limit", "10",
            ]);
            if (prsJson) {
              try {
                const prs = JSON.parse(prsJson);
                if (prs.length > 0) {
                  repoSection += `### My PRs\n`;
                  for (const pr of prs) {
                    repoSection += `- #${pr.number}: ${pr.title} [${pr.state}] (${pr.headRefName}, +${pr.additions}/-${pr.deletions})\n`;
                  }
                  repoSection += "\n";
                }
              } catch { /* parse error */ }
            }

            // PRs I reviewed in the date range
            const reviewsJson = await runGh([
              "pr", "list", "--repo", repoName,
              "--state", "all",
              "--search", `reviewed-by:@me updated:${afterDate}..${beforeDate}`,
              "--json", "number,title,state,author",
              "--limit", "5",
            ]);
            if (reviewsJson) {
              try {
                const reviews = JSON.parse(reviewsJson);
                if (reviews.length > 0) {
                  repoSection += `### Reviews\n`;
                  for (const r of reviews) {
                    repoSection += `- #${r.number}: ${r.title} [${r.state}] by ${r.author?.login ?? "?"}\n`;
                  }
                  repoSection += "\n";
                }
              } catch { /* parse error */ }
            }

            // Only add repo header if it has relevant data
            if (repoSection) {
              prompt += `## ${repoName}\n${repoSection}`;
            }
          }
        } catch {
          prompt += "Failed to gather GitHub data.\n\n";
        }
      }

      // ── Kimai ──
      if (includeKimai) {
        prompt += "# Kimai Time Entries\n\n";
        try {
          const kimaiUrl = await getCredential("kimai_url");
          const kimaiToken = await getCredential("kimai_token");
          if (kimaiUrl && kimaiToken) {
            const kimaiBegin = `${afterDate}T00:00:00`;
            const kimaiEnd = `${beforeDate}T00:00:00`;

            // Fetch current period entries
            try {
              const entries = await fetchKimaiTimesheets(kimaiUrl, kimaiToken, kimaiBegin, kimaiEnd);
              if (entries.length > 0) {
                prompt += `## Current Period (${entries.length} entries)\n\n`;
                for (const entry of entries) {
                  const pName = typeof entry.project === "object" && entry.project
                    ? (entry.project as Record<string, unknown>).name ?? `ID:${(entry.project as Record<string, unknown>).id ?? "?"}`
                    : entry.project != null ? `ID:${entry.project}` : "No project";
                  const aName = typeof entry.activity === "object" && entry.activity
                    ? (entry.activity as Record<string, unknown>).name ?? `ID:${(entry.activity as Record<string, unknown>).id ?? "?"}`
                    : entry.activity != null ? `ID:${entry.activity}` : "No activity";
                  const hours = entry.duration ? (entry.duration / 3600).toFixed(1) : "?";
                  const desc = entry.description || "(no description)";
                  prompt += `- [${entry.begin} → ${entry.end ?? "running"}] ${pName} / ${aName} (${hours}h) — ${desc}\n`;
                }
                prompt += "\n";
              } else {
                prompt += "## Current Period\nNo time entries found for this period.\n\n";
              }
            } catch (e) {
              prompt += `Failed to fetch timesheets: ${e}\n\n`;
            }

            // Fetch recent history (past 7 days) for project/activity context
            try {
              const historyStart = new Date(new Date(afterDate).getTime() - 7 * 86400000);
              const historyBegin = `${historyStart.toISOString().split("T")[0]}T00:00:00`;
              const recentEntries = await fetchKimaiTimesheets(kimaiUrl, kimaiToken, historyBegin, kimaiBegin);
              if (recentEntries.length > 0) {
                // Collect unique projects and activities for context
                const projects = new Map<string, number>();
                const activities = new Map<string, number>();
                for (const entry of recentEntries) {
                  const pName = typeof entry.project === "object" && entry.project
                    ? String((entry.project as Record<string, unknown>).name ?? "")
                    : "";
                  const aName = typeof entry.activity === "object" && entry.activity
                    ? String((entry.activity as Record<string, unknown>).name ?? "")
                    : "";
                  if (pName) projects.set(pName, (projects.get(pName) ?? 0) + (entry.duration ?? 0));
                  if (aName) activities.set(aName, (activities.get(aName) ?? 0) + (entry.duration ?? 0));
                }
                prompt += `## Recent History (past 7 days — ${recentEntries.length} entries)\n\n`;
                prompt += "Available projects (by recent usage):\n";
                for (const [name, secs] of [...projects.entries()].sort((a, b) => b[1] - a[1])) {
                  prompt += `- ${name} (${(secs / 3600).toFixed(1)}h)\n`;
                }
                prompt += "\nAvailable activities (by recent usage):\n";
                for (const [name, secs] of [...activities.entries()].sort((a, b) => b[1] - a[1])) {
                  prompt += `- ${name} (${(secs / 3600).toFixed(1)}h)\n`;
                }
                prompt += "\n";
              }
            } catch {
              // Non-critical — recent history is just for context
            }
          } else {
            prompt += "Kimai not configured.\n\n";
          }
        } catch {
          prompt += "Kimai not configured.\n\n";
        }
      }

      // ── Google Calendar ──
      if (includeCalendar) {
        prompt += "# Google Calendar\n\n";
        try {
          const calendarCreds = await getCredential("calendar_credentials");
          if (calendarCreds) {
            const events = await commands.fetchCalendarEvents(calendarCreds, afterDate, dateTo);
            if (events.length > 0) {
              for (const ev of events) {
                if (ev.all_day) {
                  prompt += `- [All day] ${ev.summary}`;
                } else {
                  const start = ev.start.replace(/T/, " ").replace(/:\d{2}[-+].*/, "");
                  const end = ev.end.replace(/T/, " ").replace(/:\d{2}[-+].*/, "");
                  prompt += `- [${start} → ${end}] ${ev.summary}`;
                }
                if (ev.attendees > 1) prompt += ` (${ev.attendees} attendees)`;
                if (ev.status === "declined") prompt += " [DECLINED]";
                prompt += "\n";
              }
              prompt += "\n";
            } else {
              prompt += "No calendar events in this period.\n\n";
            }
          } else {
            prompt += "Calendar not configured.\n\n";
          }
        } catch (e) {
          prompt += `Failed to fetch calendar events: ${e}\n\n`;
        }
      }

      prompt += `\n---\n\nBased on all the data above, generate a structured daily activity report for ${dateFrom}`;
      if (dateFrom !== dateTo) prompt += ` to ${dateTo}`;
      prompt += `. Group activities by project/repo. Use calendar events as the primary source for time allocation (meetings, focus blocks). Use commit timestamps to understand what was worked on and when. Format it as a clean, professional report suitable for timesheet entry. Do NOT invent activities or meetings that aren't in the data.`;

      setGeneratedPrompt(prompt);
      const sources = [includeGit && "Git", includeGitHub && "GitHub", includeKimai && "Kimai", includeCalendar && "Calendar"].filter(Boolean).join(", ");
      updateTask(taskId, { status: "completed", result: `Data gathered from ${sources} (${(prompt.length / 1024).toFixed(1)}KB)`, finishedAt: Date.now() });
    } catch (e) {
      updateTask(taskId, { status: "error", error: String(e), finishedAt: Date.now() });
    } finally {
      setGathering(false);
    }
  }, [dateFrom, dateTo, includeGit, includeGitHub, includeKimai, includeCalendar, addTask, updateTask, setGathering, setGeneratedPrompt]);

  const copyPrompt = async () => {
    await navigator.clipboard.writeText(generatedPrompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const generateWithAi = async (promptText?: string) => {
    const inputPrompt = promptText || generatedPrompt;
    if (!inputPrompt) return;

    setGenerating(true);
    setAiResult("");

    const taskId = addTask("report-generation", `Generating AI report`, {});

    const { getSetting } = useSettingsStore.getState();
    const provider = getSetting("ai_provider", "claude-cli");

    try {
      let resultText = "";

      if (provider === "claude-cli") {
        try {
          resultText = await commands.runClaudeCli(inputPrompt);
        } catch (cliErr) {
          // If CLI fails (e.g. prompt too long), fall back to API
          const apiKey = await getCredential("claude_api_key");
          if (apiKey) {
            console.warn("Claude CLI failed, falling back to API:", cliErr);
            const result = await commands.generateWithAi(apiKey, inputPrompt);
            resultText = result.text;
          } else {
            throw cliErr;
          }
        }
      } else {
        const apiKey = await getCredential("claude_api_key");
        if (!apiKey) {
          throw new Error("Claude API key not configured. Go to Connections to set it up.");
        }
        const result = await commands.generateWithAi(apiKey, inputPrompt);
        resultText = result.text;
      }

      setAiResult(resultText);
      const preview = resultText.slice(0, 100).replace(/\n/g, " ") + (resultText.length > 100 ? "…" : "");
      updateTask(taskId, { status: "completed", result: preview, finishedAt: Date.now() });

      // Save to command_runs for history
      try {
        const dateRange = dateFrom === dateTo ? dateFrom : `${dateFrom} to ${dateTo}`;
        const cmds = await commands.getCommands();
        const reportCmd = cmds.find((c) => c.slug === "generate-report");
        if (reportCmd?.id) {
          const runId = await commands.createCommandRun(
            reportCmd.id,
            JSON.stringify({ dateRange }),
          );
          await commands.updateCommandRun(
            runId,
            "completed",
            resultText,
            "",
            null,
          );
          loadReports();
        }
      } catch {
        // saving history is non-critical
      }
    } catch (e) {
      const errMsg = String(e);
      setAiResult(`Error: ${errMsg}`);
      updateTask(taskId, { status: "error", error: errMsg, finishedAt: Date.now() });
    } finally {
      setGenerating(false);
    }
  };

  const fillTimesheetWithClaude = async (reportContent: string, reportDateRange?: string) => {
    // Ensure Kimai MCP is configured for Claude Code
    try {
      const kimaiUrl = await getCredential("kimai_url");
      const kimaiToken = await getCredential("kimai_token");
      if (kimaiUrl && kimaiToken) {
        await ensureKimaiMcp(kimaiUrl, kimaiToken);
      }
    } catch {
      // Non-blocking — Claude can still work without MCP
    }

    const dateRange = reportDateRange || (dateFrom === dateTo ? dateFrom : `${dateFrom} to ${dateTo}`);

    // Fetch existing Kimai entries for context so Claude doesn't create duplicates
    let existingEntries = "";
    try {
      const kimaiUrl = await getCredential("kimai_url");
      const kimaiToken = await getCredential("kimai_token");
      if (kimaiUrl && kimaiToken) {
        const begin = `${dateRange.split(" to ")[0] || dateRange}T00:00:00`;
        const endDate = dateRange.split(" to ")[1] || dateRange;
        const endNext = new Date(new Date(endDate).getTime() + 86400000).toISOString().split("T")[0];
        const entries = await fetchKimaiTimesheets(kimaiUrl, kimaiToken, begin, `${endNext}T00:00:00`);
        if (entries.length > 0) {
          existingEntries = "\n\nEXISTING Kimai entries (do NOT duplicate these):\n";
          for (const entry of entries) {
            const pName = typeof entry.project === "object" && entry.project
              ? (entry.project as Record<string, unknown>).name ?? "?"
              : "?";
            const aName = typeof entry.activity === "object" && entry.activity
              ? (entry.activity as Record<string, unknown>).name ?? "?"
              : "?";
            const hours = entry.duration ? (entry.duration / 3600).toFixed(1) : "?";
            existingEntries += `- [${entry.begin} → ${entry.end ?? "running"}] ${pName} / ${aName} (${hours}h) — ${entry.description || "(no description)"}\n`;
          }
        }
      }
    } catch { /* non-blocking */ }

    const initialPrompt = [
      `I have a daily activity report for ${dateRange}. Based on this report, please propose Kimai timesheet entries using the Kimai MCP tools.`,
      "",
      "IMPORTANT: Before creating ANY entry, show me what you plan to create and ask for my explicit confirmation. Do NOT create entries without my approval.",
      "",
      "Here is the report:",
      "---",
      reportContent,
      "---",
      existingEntries,
      "",
      "Steps:",
      "1. Check the existing Kimai entries above — do NOT create duplicates",
      "2. Propose timesheet entries with project, activity, start/end times, and descriptions",
      "3. List them all first, then wait for my confirmation before creating each one",
    ].join("\n");

    const { getSetting } = useSettingsStore.getState();
    const cwd = getSetting("default_working_directory", "") || null;
    const terminal = getSetting("preferred_terminal", "") || null;

    try {
      await openClaudeTerminal({
        cwd,
        args: null,
        initialPrompt,
        terminal,
      });
    } catch (e) {
      console.error("Failed to open Claude terminal:", e);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold mb-1">Report Generator</h2>
        <p className="text-sm text-muted-foreground">
          Gather dev activity and generate timesheet reports
        </p>
      </div>

      <div className="rounded-lg border bg-card p-4 space-y-3">
        <div className="flex gap-4">
          <div>
            <label className="text-xs text-muted-foreground block mb-1">
              From
            </label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="text-sm rounded-md border bg-background px-2 py-1"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">
              To
            </label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="text-sm rounded-md border bg-background px-2 py-1"
            />
          </div>
          <button
            onClick={() => {
              setDateFrom(today);
              setDateTo(today);
            }}
            className="self-end px-2 py-1 text-xs rounded-md border bg-background hover:bg-secondary transition-colors"
          >
            Today
          </button>
        </div>

        <div className="flex gap-4 flex-wrap">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={includeGit}
              onChange={(e) => setIncludeGit(e.target.checked)}
              className="rounded"
            />
            Git (local repos)
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={includeGitHub}
              onChange={(e) => setIncludeGitHub(e.target.checked)}
              className="rounded"
            />
            GitHub (PRs, reviews)
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={includeKimai}
              onChange={(e) => setIncludeKimai(e.target.checked)}
              className="rounded"
            />
            Kimai
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={includeCalendar}
              onChange={(e) => setIncludeCalendar(e.target.checked)}
              className="rounded"
            />
            Google Calendar
          </label>
        </div>

        <button
          onClick={generatePrompt}
          disabled={gathering}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          {gathering ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <FileText className="h-3.5 w-3.5" />
          )}
          {gathering ? "Gathering data..." : "Gather & Generate Prompt"}
        </button>
      </div>

      {generatedPrompt && (
        <div className="space-y-3">
          <div className="rounded-lg border bg-card p-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium">
                Generated Prompt
                <span className="ml-2 text-[10px] text-muted-foreground font-normal">
                  {generatedPrompt.split("\n").length} lines · {(generatedPrompt.length / 1024).toFixed(1)}KB
                </span>
              </h3>
              <div className="flex gap-2">
                <button
                  onClick={copyPrompt}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  {copied ? (
                    <Check className="h-3.5 w-3.5 text-green-500" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                  {copied ? "Copied" : "Copy"}
                </button>
                <button
                  onClick={() => generateWithAi()}
                  disabled={generating}
                  className="flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
                >
                  {generating ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Bot className="h-3.5 w-3.5" />
                  )}
                  {generating ? "Generating..." : "Generate with AI"}
                </button>
              </div>
            </div>
            <textarea
              value={generatedPrompt}
              onChange={(e) => setGeneratedPrompt(e.target.value)}
              className="text-xs font-mono bg-secondary p-3 rounded w-full h-96 resize-y border-0 focus:outline-none focus:ring-1 focus:ring-ring"
              spellCheck={false}
            />
          </div>

          {aiResult && (
            <div className="rounded-lg border bg-card p-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-medium">AI Report</h3>
                <button
                  onClick={() => fillTimesheetWithClaude(aiResult)}
                  className="flex items-center gap-1.5 px-2 py-1 text-xs font-medium rounded-md bg-green-600 text-white hover:bg-green-700 transition-colors"
                >
                  <Terminal className="h-3.5 w-3.5" />
                  Fill Timesheet with Claude
                </button>
              </div>
              <textarea
                value={aiResult}
                onChange={(e) => setAiResult(e.target.value)}
                className="text-xs font-mono bg-secondary p-3 rounded w-full h-96 resize-y border-0 focus:outline-none focus:ring-1 focus:ring-ring"
                spellCheck={false}
              />
            </div>
          )}
        </div>
      )}

      {/* Report History */}
      {savedReports.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-medium">Report History</h3>
            <span className="text-[10px] text-muted-foreground">
              ({savedReports.length})
            </span>
          </div>
          <div className="space-y-1">
            {savedReports.map((report) => (
              <div key={report.id} className="rounded-lg border bg-card">
                <div className="flex items-center gap-2 p-3 hover:bg-secondary/30 transition-colors">
                  <button
                    onClick={() =>
                      setExpandedReport(
                        expandedReport === report.id ? null : report.id,
                      )
                    }
                    className="flex items-center gap-2 flex-1 text-left min-w-0"
                  >
                    {expandedReport === report.id ? (
                      <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    )}
                    <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="text-xs font-medium flex-1 truncate">
                      {report.dateRange || "Report"}
                    </span>
                    <span className="text-[10px] text-muted-foreground shrink-0">
                      {new Date(report.date).toLocaleString()}
                    </span>
                  </button>
                  <button
                    onClick={async () => {
                      try {
                        await commands.deleteCommandRun(report.id);
                        setSavedReports((prev) => prev.filter((r) => r.id !== report.id));
                        if (expandedReport === report.id) setExpandedReport(null);
                      } catch { /* */ }
                    }}
                    className="text-muted-foreground hover:text-destructive transition-colors shrink-0"
                    title="Delete"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                {expandedReport === report.id && (
                  <div className="border-t px-4 py-3">
                    <div className="flex justify-end gap-2 mb-2">
                      <button
                        onClick={async () => {
                          await navigator.clipboard.writeText(report.content);
                        }}
                        className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                      >
                        <Copy className="h-3 w-3" />
                        Copy
                      </button>
                      <button
                        onClick={() => fillTimesheetWithClaude(report.content, report.dateRange)}
                        className="flex items-center gap-1 text-[10px] font-medium text-green-600 hover:text-green-700 transition-colors"
                      >
                        <Terminal className="h-3 w-3" />
                        Fill Timesheet
                      </button>
                    </div>
                    <textarea
                      value={report.content}
                      onChange={(e) => {
                        const newContent = e.target.value;
                        setSavedReports((prev) =>
                          prev.map((r) =>
                            r.id === report.id ? { ...r, content: newContent } : r,
                          ),
                        );
                        // Debounced autosave
                        clearTimeout((window as unknown as Record<string, ReturnType<typeof setTimeout>>)[`_save_${report.id}`]);
                        (window as unknown as Record<string, ReturnType<typeof setTimeout>>)[`_save_${report.id}`] = setTimeout(() => {
                          commands.updateCommandRun(report.id, "completed", newContent, "", null).catch(() => {});
                        }, 800);
                      }}
                      className="text-xs font-mono bg-secondary p-3 rounded w-full h-64 resize-y border-0 focus:outline-none focus:ring-1 focus:ring-ring"
                      spellCheck={false}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
