import { useState, useCallback, useEffect, useRef } from "react";
import * as commands from "@/lib/tauri";
import { openClaudeTerminal, getCommandBySlug } from "@/lib/tauri";
import { fetchKimaiTimesheets, setupKimaiMcp } from "@/lib/tauri";
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
  X,
} from "lucide-react";
import { toLocalDateString, getCurrentTimezoneOffset } from "@/lib/timezone";
import { ActivityMapper } from "@/components/ActivityMapper";

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
  const today = toLocalDateString();
  const [dateFrom, setDateFrom] = useState(today);
  const [dateTo, setDateTo] = useState(today);
  const [copied, setCopied] = useState(false);

  const { getSetting } = useSettingsStore();
  const connOn = (key: string) => getSetting(`conn_${key}`, "true") === "true";

  const gitEnabled = connOn("github") || connOn("gitlab") || connOn("azure") || connOn("bitbucket");
  const kimaiEnabled = connOn("kimai");
  const calendarEnabled = connOn("calendar");

  const [includeGit, setIncludeGit] = useState(true);
  const [includeGitHub, setIncludeGitHub] = useState(true);
  const [includeKimai, setIncludeKimai] = useState(true);
  const [includeCalendar, setIncludeCalendar] = useState(true);

  // Persistent state via Zustand (survives tab switches)
  const {
    generatedPrompt, aiResult, gathering, generating,
    setGeneratedPrompt, setAiResult, setGathering, setGenerating,
  } = useReportStore();

  // Fill timesheet dialog
  const [fillDialog, setFillDialog] = useState<{ content: string; dateRange?: string } | null>(null);
  const [fillNote, setFillNote] = useState("");

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

    const tzOffset = getCurrentTimezoneOffset();
    const afterDate = dateFrom;
    // Add one day for --before (git uses exclusive end)
    const beforeDate = new Date(new Date(dateTo).getTime() + 86400000)
      .toISOString()
      .split("T")[0];

    const dateRange = dateFrom === dateTo ? dateFrom : `${dateFrom} to ${dateTo}`;

    // Helper to format Kimai entry fields
    const fmtKimai = (entry: { project: Record<string, unknown> | null; activity: Record<string, unknown> | null; duration: number | null; description: string | null; begin: string; end: string | null }, includeEnd = true) => {
      const pName = typeof entry.project === "object" && entry.project
        ? (entry.project as Record<string, unknown>).name ?? `ID:${(entry.project as Record<string, unknown>).id ?? "?"}`
        : entry.project != null ? `ID:${entry.project}` : "No project";
      const aName = typeof entry.activity === "object" && entry.activity
        ? (entry.activity as Record<string, unknown>).name ?? `ID:${(entry.activity as Record<string, unknown>).id ?? "?"}`
        : entry.activity != null ? `ID:${entry.activity}` : "No activity";
      const hours = entry.duration ? (entry.duration / 3600).toFixed(1) : "?";
      const desc = entry.description || "(no description)";
      const time = includeEnd ? `${entry.begin} → ${entry.end ?? "running"}` : entry.begin;
      return `- [${time}] ${pName} / ${aName} (${hours}h) — ${desc}\n`;
    };

    try {
      // ── Gather all sources in parallel ──
      const gatherGit = async (): Promise<string> => {
        if (!includeGit) return "";
        try {
          const repos = await commands.getLocalRepos();
          if (repos.length === 0) return "";
          const results = await Promise.all(repos.map(async (repo) => {
            // Use the repo's own git user.name — github_username is a GitHub handle, not a commit author
            const repoAuthor = await runGit(["config", "user.name"], repo.path);
            const logArgs = [
              "log", "--all",
              `--after=${afterDate}`, `--before=${beforeDate}`,
              "--format=%h|%ai|%s", "--shortstat",
            ];
            if (repoAuthor) logArgs.push(`--author=${repoAuthor}`);
            const log = await runGit(logArgs, repo.path);
            return log ? `## ${repo.name}\n\`\`\`\n${log}\n\`\`\`\n\n` : "";
          }));
          const content = results.join("");
          return content ? `# Git Local Activity\n\n${content}` : "";
        } catch {
          return "# Git Local Activity\nFailed to gather git data.\n\n";
        }
      };

      const gatherGitHub = async (): Promise<string> => {
        if (!includeGitHub) return "";
        try {
          const monitoredRepos = await commands.getMonitoredRepos();
          const repoResults = await Promise.all(monitoredRepos.map(async (r) => {
            const repoName = r.full_name;
            const [prsJson, reviewsJson] = await Promise.all([
              runGh([
                "pr", "list", "--repo", repoName, "--author", "@me",
                "--state", "all",
                "--search", `updated:${afterDate}..${beforeDate}`,
                "--json", "number,title,state,headRefName,additions,deletions,createdAt,updatedAt,mergedAt",
                "--limit", "10",
              ]),
              runGh([
                "pr", "list", "--repo", repoName,
                "--state", "all",
                "--search", `reviewed-by:@me updated:${afterDate}..${beforeDate}`,
                "--json", "number,title,state,author,createdAt,updatedAt,mergedAt",
                "--limit", "5",
              ]),
            ]);
            let section = "";
            const fmtDate = (iso: string | null) => iso ? iso.split("T")[0] : "";
            if (prsJson) {
              try {
                const prs = JSON.parse(prsJson);
                if (prs.length > 0) {
                  section += `### My PRs\n`;
                  for (const pr of prs) {
                    const merged = pr.mergedAt ? `merged ${fmtDate(pr.mergedAt)}` : "";
                    const created = `created ${fmtDate(pr.createdAt)}`;
                    const dates = merged || created;
                    section += `- #${pr.number}: ${pr.title} [${pr.state}] (${pr.headRefName}, +${pr.additions}/-${pr.deletions}) — ${dates}\n`;
                  }
                  section += "\n";
                }
              } catch { /* parse error */ }
            }
            if (reviewsJson) {
              try {
                const reviews = JSON.parse(reviewsJson);
                if (reviews.length > 0) {
                  section += `### Reviews\n`;
                  for (const rev of reviews) {
                    const merged = rev.mergedAt ? `merged ${fmtDate(rev.mergedAt)}` : `updated ${fmtDate(rev.updatedAt)}`;
                    section += `- #${rev.number}: ${rev.title} [${rev.state}] by ${rev.author?.login ?? "?"} — ${merged}\n`;
                  }
                  section += "\n";
                }
              } catch { /* parse error */ }
            }
            return section ? `## ${repoName}\n${section}` : "";
          }));
          const content = repoResults.join("");
          return content ? `# GitHub Activity\n\n${content}` : "# GitHub Activity\n\n";
        } catch {
          return "# GitHub Activity\n\nFailed to gather GitHub data.\n\n";
        }
      };

      const gatherKimai = async (): Promise<string> => {
        if (!includeKimai) return "";
        try {
          const [kimaiUrl, kimaiToken] = await Promise.all([
            getCredential("kimai_url"),
            getCredential("kimai_token"),
          ]);
          if (!kimaiUrl || !kimaiToken) return "# Kimai Time Entries\n\nKimai not configured.\n\n";

          const kimaiBegin = `${afterDate}T00:00:00${tzOffset}`;
          const kimaiEnd = `${beforeDate}T00:00:00${tzOffset}`;
          const historyStart = new Date(new Date(afterDate).getTime() - 30 * 86400000);
          const historyBegin = `${historyStart.toISOString().split("T")[0]}T00:00:00${tzOffset}`;

          const [entries, recentEntries] = await Promise.all([
            fetchKimaiTimesheets(kimaiUrl, kimaiToken, kimaiBegin, kimaiEnd).catch((e) => { console.warn("Kimai fetch (current) failed:", e); return []; }),
            fetchKimaiTimesheets(kimaiUrl, kimaiToken, historyBegin, kimaiBegin).catch((e) => { console.warn("Kimai fetch (history) failed:", e); return []; }),
          ]);

          let result = "# Kimai Time Entries\n\n";
          if (entries.length > 0) {
            result += `## Current Period (${entries.length} entries)\n\n`;
            for (const entry of entries) result += fmtKimai(entry);
            result += "\n";
          } else {
            result += "## Current Period\nNo time entries found for this period.\n\n";
          }
          const last10 = recentEntries.slice(0, 10);
          if (last10.length > 0) {
            result += `## Last ${last10.length} Entries (reference for format/style)\n\n`;
            result += "Use these entries as a reference for how to write descriptions, which projects and activities to use, and the typical format:\n\n";
            for (const entry of last10) result += fmtKimai(entry, false);
            result += "\n";
          }
          return result;
        } catch {
          return "# Kimai Time Entries\n\nKimai not configured.\n\n";
        }
      };

      const gatherCalendar = async (): Promise<string> => {
        if (!includeCalendar) return "";
        try {
          const [calendarCreds, calEmail] = await Promise.all([
            getCredential("calendar_credentials"),
            getCredential("calendar_email"),
          ]);
          if (!calendarCreds) return "# Google Calendar\n\nCalendar not configured.\n\n";
          const events = await commands.fetchCalendarEvents(calendarCreds, afterDate, dateTo, calEmail || undefined, tzOffset);
          if (events.length === 0) return "# Google Calendar\n\nNo calendar events in this period.\n\n";
          let result = "# Google Calendar\n\n";
          for (const ev of events) {
            if (ev.all_day) {
              result += `- [All day] ${ev.summary}`;
            } else {
              const start = ev.start.replace(/T/, " ").replace(/:\d{2}[-+].*/, "");
              const end = ev.end.replace(/T/, " ").replace(/:\d{2}[-+].*/, "");
              result += `- [${start} → ${end}] ${ev.summary}`;
            }
            if (ev.attendees > 1) result += ` (${ev.attendees} attendees)`;
            if (ev.status === "declined") result += " [DECLINED]";
            result += "\n";
          }
          return result + "\n";
        } catch (e) {
          return `# Google Calendar\n\nFailed to fetch calendar events: ${e}\n\n`;
        }
      };

      // Run all data sources + template fetch in parallel
      const [gitData, ghData, kimaiData, calData, templateCmd] = await Promise.all([
        gatherGit(),
        gatherGitHub(),
        gatherKimai(),
        gatherCalendar(),
        getCommandBySlug("generate-report").catch(() => null),
      ]);

      const gatheredData = gitData + ghData + kimaiData + calData;

      let promptTemplate = `Generate a detailed daily development activity report for {{date_range}}.\n\nBelow is the raw data gathered from multiple sources. Analyze it and produce a structured report with:\n- Key accomplishments\n- Work in progress\n- Time estimates per activity (based on commit timestamps)\n- PRs and code reviews\n- Meetings (if any)\n- Blockers\n\n{{gathered_data}}\n\n---\n\nBased on all the data above, generate a structured daily activity report for {{date_range}}. Group activities by project/repo. Use calendar events as the primary source for time allocation (meetings, focus blocks). Use commit timestamps to understand what was worked on and when. Format it as a clean, professional report suitable for timesheet entry. Do NOT invent activities or meetings that aren't in the data.`;
      if (templateCmd?.prompt_template) promptTemplate = templateCmd.prompt_template;

      const prompt = promptTemplate
        .replace(/\{\{date_range\}\}/g, dateRange)
        .replace(/\{\{gathered_data\}\}/g, gatheredData);

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

  const openFillDialog = (content: string, dateRange?: string) => {
    setFillNote("");
    setFillDialog({ content, dateRange });
  };

  const fillTimesheetWithClaude = async (reportContent: string, reportDateRange?: string, note?: string) => {
    // Ensure Kimai MCP is configured for Claude Code
    try {
      const kimaiUrl = await getCredential("kimai_url");
      const kimaiToken = await getCredential("kimai_token");
      if (kimaiUrl && kimaiToken) {
        await setupKimaiMcp(kimaiUrl, kimaiToken);
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
        const tz = getCurrentTimezoneOffset();
        const begin = `${dateRange.split(" to ")[0] || dateRange}T00:00:00${tz}`;
        const endDate = dateRange.split(" to ")[1] || dateRange;
        const endNext = new Date(new Date(endDate).getTime() + 86400000).toISOString().split("T")[0];
        const entries = await fetchKimaiTimesheets(kimaiUrl, kimaiToken, begin, `${endNext}T00:00:00${tz}`);
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

    // Load activity mappings for context
    let mappingsContext = "";
    try {
      const allMappings = await commands.getActivityMappings();
      const enabled = allMappings.filter((m) => m.enabled);
      if (enabled.length > 0) {
        mappingsContext = "\n\nActivity Mappings (use these to match calendar events to Kimai projects/activities — include tags when specified):\n";
        for (const m of enabled) {
          mappingsContext += `- Pattern "${m.pattern}" (${m.pattern_type}) → Project: ${m.kimai_project_name} / Activity: ${m.kimai_activity_name}`;
          if (m.kimai_tags) mappingsContext += ` (tags: ${m.kimai_tags})`;
          if (m.description) mappingsContext += ` — ${m.description}`;
          mappingsContext += "\n";
        }
      }
    } catch { /* non-blocking */ }

    // Load template from DB (fallback to inline)
    let promptTemplate = `I have a daily activity report for {{date_range}}. Based on this report, please propose Kimai timesheet entries using the Kimai MCP tools.\n\nIMPORTANT: Before creating ANY entry, show me what you plan to create and ask for my explicit confirmation. Do NOT create entries without my approval.\n\nHere is the report:\n---\n{{report_content}}\n---\n{{existing_entries}}{{activity_mappings}}\n\nSteps:\n1. Check the existing Kimai entries above — do NOT create duplicates\n2. Use the Activity Mappings to match events to projects/activities — include tags when specified\n3. Propose timesheet entries with project, activity, start/end times, tags, and descriptions\n4. List them all first, then wait for my confirmation before creating each one`;
    try {
      const cmd = await getCommandBySlug("fill-timesheet");
      if (cmd?.prompt_template) promptTemplate = cmd.prompt_template;
    } catch { /* fallback */ }

    let initialPrompt = promptTemplate
      .replace(/\{\{date_range\}\}/g, dateRange)
      .replace(/\{\{report_content\}\}/g, reportContent)
      .replace(/\{\{existing_entries\}\}/g, existingEntries)
      .replace(/\{\{activity_mappings\}\}/g, mappingsContext);

    if (note?.trim()) {
      initialPrompt += `\n\nAdditional notes from the user:\n${note.trim()}`;
    }

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
          {gitEnabled && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={includeGitHub}
                onChange={(e) => setIncludeGitHub(e.target.checked)}
                className="rounded"
              />
              PRs & reviews
            </label>
          )}
          {kimaiEnabled && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={includeKimai}
                onChange={(e) => setIncludeKimai(e.target.checked)}
                className="rounded"
              />
              Kimai (last 10 entries)
            </label>
          )}
          {calendarEnabled && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={includeCalendar}
                onChange={(e) => setIncludeCalendar(e.target.checked)}
                className="rounded"
              />
              Google Calendar
            </label>
          )}
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
                  onClick={() => openFillDialog(aiResult)}
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

      {/* Fill Timesheet Dialog */}
      {fillDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setFillDialog(null)}>
          <div className="bg-card border rounded-lg shadow-xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b">
              <h3 className="font-semibold text-sm">Fill Timesheet</h3>
              <button onClick={() => setFillDialog(null)} className="p-1 hover:bg-muted rounded">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <div>
                <label className="text-xs text-muted-foreground block mb-1">
                  Additional notes (optional)
                </label>
                <textarea
                  value={fillNote}
                  onChange={(e) => setFillNote(e.target.value)}
                  placeholder="E.g.: round entries to 30min blocks, skip meetings, use project X for code review..."
                  className="w-full px-2 py-1.5 text-xs rounded border bg-background h-20 resize-none focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setFillDialog(null)}
                  className="px-3 py-1.5 text-xs rounded-md border hover:bg-secondary transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    const { content, dateRange } = fillDialog;
                    setFillDialog(null);
                    fillTimesheetWithClaude(content, dateRange, fillNote);
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-green-600 text-white hover:bg-green-700 transition-colors"
                >
                  <Terminal className="h-3.5 w-3.5" />
                  Fill Timesheet
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Activity Mappings */}
      <ActivityMapper />

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
                        onClick={() => openFillDialog(report.content, report.dateRange)}
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
