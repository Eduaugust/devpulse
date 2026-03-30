import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { cn } from "@/lib/utils";
import { ContributionHeatmap } from "@/components/ContributionHeatmap";
import {
  fetchGitLog,
  getLocalRepos,
  runClaudeCli,
  generateWithAi,
  openClaudeTerminal,
} from "@/lib/tauri";
import { getCredential } from "@/lib/credentials";
import type { GitLogEntry, LocalRepo } from "@/lib/types";
import {
  GitCommitHorizontal,
  FolderGit2,
  Flame,
  Trophy,
  Bot,
  Copy,
  Check,
  ChevronDown,
  ChevronRight,
  Terminal,
  Code2,
  Loader2,
  Settings,
} from "lucide-react";
import { useNavigate } from "react-router-dom";

function toLocalDateStr(isoDate: string): string {
  return new Date(isoDate).toLocaleDateString("sv-SE"); // YYYY-MM-DD
}

function shortHash(hash: string): string {
  return hash.slice(0, 7);
}

function formatTime(isoDate: string): string {
  return new Date(isoDate).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function GitActivity() {
  const navigate = useNavigate();
  const [repos, setRepos] = useState<LocalRepo[]>([]);
  const [commits, setCommits] = useState<GitLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRepo, setSelectedRepo] = useState("all");
  const [months, setMonths] = useState<3 | 6>(6);
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set());
  const [aiSummary, setAiSummary] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const commitListRef = useRef<HTMLDivElement>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [loadedRepos, loadedCommits] = await Promise.all([
        getLocalRepos(),
        fetchGitLog(
          (() => {
            const d = new Date();
            d.setMonth(d.getMonth() - months);
            return d.toISOString().split("T")[0];
          })(),
          new Date().toISOString().split("T")[0],
        ),
      ]);
      setRepos(loadedRepos);
      setCommits(loadedCommits);
    } catch (e) {
      console.error("Failed to load git data:", e);
    } finally {
      setLoading(false);
    }
  }, [months]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const filteredCommits = useMemo(
    () =>
      selectedRepo === "all"
        ? commits
        : commits.filter((c) => c.repo_name === selectedRepo),
    [commits, selectedRepo],
  );

  const heatmapData = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of filteredCommits) {
      const day = toLocalDateStr(c.date);
      map.set(day, (map.get(day) ?? 0) + 1);
    }
    return map;
  }, [filteredCommits]);

  const groupedByDay = useMemo(() => {
    const map = new Map<string, GitLogEntry[]>();
    for (const c of filteredCommits) {
      const day = toLocalDateStr(c.date);
      const arr = map.get(day);
      if (arr) arr.push(c);
      else map.set(day, [c]);
    }
    // Sort descending
    return new Map([...map.entries()].sort((a, b) => b[0].localeCompare(a[0])));
  }, [filteredCommits]);

  const stats = useMemo(() => {
    const repoSet = new Set(filteredCommits.map((c) => c.repo_name));
    const repoCounts = new Map<string, number>();
    for (const c of filteredCommits) {
      repoCounts.set(c.repo_name, (repoCounts.get(c.repo_name) ?? 0) + 1);
    }
    const mostActive = [...repoCounts.entries()].sort((a, b) => b[1] - a[1])[0];

    // Calculate current streak
    let streak = 0;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const cursor = new Date(today);
    while (true) {
      const dayStr = cursor.toLocaleDateString("sv-SE");
      if (heatmapData.get(dayStr)) {
        streak++;
        cursor.setDate(cursor.getDate() - 1);
      } else {
        break;
      }
    }

    return {
      total: filteredCommits.length,
      activeRepos: repoSet.size,
      mostActive: mostActive ? mostActive[0] : "-",
      streak,
    };
  }, [filteredCommits, heatmapData]);

  const repoNames = useMemo(
    () => [...new Set(commits.map((c) => c.repo_name))].sort(),
    [commits],
  );

  const repoPathMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of repos) map.set(r.name, r.path);
    return map;
  }, [repos]);

  const toggleDay = (day: string) => {
    setExpandedDays((prev) => {
      const next = new Set(prev);
      if (next.has(day)) next.delete(day);
      else next.add(day);
      return next;
    });
  };

  const handleDayClick = (date: string) => {
    setExpandedDays((prev) => new Set(prev).add(date));
    // Scroll to the commit list
    setTimeout(() => {
      const el = document.getElementById(`day-${date}`);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 50);
  };

  const summarizeCommits = async () => {
    setAiLoading(true);
    setAiSummary("");
    try {
      const today = new Date().toLocaleDateString("sv-SE");
      const todayCommits = filteredCommits.filter(
        (c) => toLocalDateStr(c.date) === today,
      );

      if (todayCommits.length === 0) {
        setAiSummary("No commits found for today.");
        return;
      }

      const commitText = todayCommits
        .map((c) => `- [${c.repo_name}] ${c.message}`)
        .join("\n");

      const prompt = `Summarize the following git commits into a concise standup/EOD report. Group by theme/project if applicable. Be brief (3-5 bullet points max). Write in the same language as the commit messages.\n\nCommits from today (${today}):\n${commitText}`;

      try {
        const result = await runClaudeCli(prompt);
        setAiSummary(result);
      } catch {
        const apiKey = await getCredential("claude_api_key");
        if (apiKey) {
          const result = await generateWithAi(apiKey, prompt);
          setAiSummary(result.text);
        } else {
          setAiSummary("Claude CLI not available and no API key configured. Set up Claude in Connections.");
        }
      }
    } catch (e) {
      setAiSummary(`Error: ${e}`);
    } finally {
      setAiLoading(false);
    }
  };

  const copyToClipboard = async () => {
    await navigator.clipboard.writeText(aiSummary);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (repos.length === 0 && !loading) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-lg font-semibold mb-1">Git Activity</h2>
          <p className="text-sm text-muted-foreground">
            Visualize your commit history across local repositories.
          </p>
        </div>
        <div className="rounded-lg border bg-card p-8 text-center space-y-3">
          <FolderGit2 className="h-8 w-8 text-muted-foreground mx-auto" />
          <p className="text-sm text-muted-foreground">
            No local repositories configured.
          </p>
          <button
            onClick={() => navigate("/settings")}
            className="inline-flex items-center gap-2 text-sm text-primary hover:underline"
          >
            <Settings className="h-3.5 w-3.5" />
            Add repos in Settings
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-lg font-semibold mb-1">Git Activity</h2>
        <p className="text-sm text-muted-foreground">
          Visualize your commit history across local repositories.
        </p>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <select
          value={selectedRepo}
          onChange={(e) => setSelectedRepo(e.target.value)}
          className="text-sm rounded-md border bg-background px-3 py-1.5 text-foreground"
        >
          <option value="all">All repos</option>
          {repoNames.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <select
          value={months}
          onChange={(e) => setMonths(Number(e.target.value) as 3 | 6)}
          className="text-sm rounded-md border bg-background px-3 py-1.5 text-foreground"
        >
          <option value={3}>Last 3 months</option>
          <option value={6}>Last 6 months</option>
        </select>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          {/* Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="rounded-lg border bg-card p-4">
              <div className="flex items-center gap-2 mb-2">
                <GitCommitHorizontal className="h-4 w-4 text-primary" />
                <span className="text-xs text-muted-foreground">Commits</span>
              </div>
              <p className="text-2xl font-bold">{stats.total}</p>
            </div>
            <div className="rounded-lg border bg-card p-4">
              <div className="flex items-center gap-2 mb-2">
                <FolderGit2 className="h-4 w-4 text-blue-500" />
                <span className="text-xs text-muted-foreground">Active Repos</span>
              </div>
              <p className="text-2xl font-bold">{stats.activeRepos}</p>
            </div>
            <div className="rounded-lg border bg-card p-4">
              <div className="flex items-center gap-2 mb-2">
                <Trophy className="h-4 w-4 text-amber-500" />
                <span className="text-xs text-muted-foreground">Most Active</span>
              </div>
              <p className="text-sm font-semibold truncate" title={stats.mostActive}>
                {stats.mostActive}
              </p>
            </div>
            <div className="rounded-lg border bg-card p-4">
              <div className="flex items-center gap-2 mb-2">
                <Flame className="h-4 w-4 text-orange-500" />
                <span className="text-xs text-muted-foreground">Streak</span>
              </div>
              <p className="text-2xl font-bold">
                {stats.streak}
                <span className="text-sm font-normal text-muted-foreground ml-1">days</span>
              </p>
            </div>
          </div>

          {/* Heatmap */}
          <div className="rounded-lg border bg-card p-4">
            <ContributionHeatmap
              data={heatmapData}
              months={months}
              onDayClick={handleDayClick}
            />
          </div>

          {/* AI Summary */}
          <div className="rounded-lg border bg-card p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium flex items-center gap-2">
                <Bot className="h-4 w-4" />
                AI Summary
              </h3>
              <button
                onClick={summarizeCommits}
                disabled={aiLoading}
                className={cn(
                  "text-xs px-3 py-1.5 rounded-md transition-colors",
                  "bg-primary text-primary-foreground hover:bg-primary/90",
                  "disabled:opacity-50 disabled:cursor-not-allowed",
                )}
              >
                {aiLoading ? (
                  <span className="flex items-center gap-1.5">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Summarizing...
                  </span>
                ) : (
                  "Summarize today"
                )}
              </button>
            </div>
            {aiSummary && (
              <div className="relative rounded-md bg-muted/50 p-3">
                <button
                  onClick={copyToClipboard}
                  className="absolute top-2 right-2 p-1 rounded hover:bg-accent text-muted-foreground"
                  title="Copy to clipboard"
                >
                  {copied ? (
                    <Check className="h-3.5 w-3.5 text-green-500" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                </button>
                <p className="text-sm text-foreground whitespace-pre-wrap pr-8">{aiSummary}</p>
              </div>
            )}
            {!aiSummary && !aiLoading && (
              <p className="text-xs text-muted-foreground">
                Generate a natural language summary of today's commits — useful for standups and timesheets.
              </p>
            )}
          </div>

          {/* Commit list */}
          <div ref={commitListRef} className="space-y-2">
            <h3 className="text-sm font-medium">Commits</h3>
            {groupedByDay.size === 0 ? (
              <div className="rounded-lg border bg-card p-6 text-center">
                <p className="text-sm text-muted-foreground">No commits in this period.</p>
              </div>
            ) : (
              [...groupedByDay.entries()].map(([day, dayCommits]) => (
                <div key={day} id={`day-${day}`} className="rounded-lg border bg-card">
                  <button
                    onClick={() => toggleDay(day)}
                    className="w-full flex items-center gap-2 px-4 py-2.5 text-sm hover:bg-accent/50 transition-colors rounded-lg"
                  >
                    {expandedDays.has(day) ? (
                      <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    )}
                    <span className="font-medium">{day}</span>
                    <span className="text-xs text-muted-foreground">
                      {dayCommits.length} commit{dayCommits.length !== 1 ? "s" : ""}
                    </span>

                    {/* Quick actions for repos in this day */}
                    <div className="ml-auto flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
                      {[...new Set(dayCommits.map((c) => c.repo_name))].map((repoName) => {
                        const path = repoPathMap.get(repoName);
                        if (!path) return null;
                        return (
                          <div key={repoName} className="flex items-center gap-0.5">
                            <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-primary/10 text-primary">
                              {repoName}
                            </span>
                            <button
                              onClick={() => openClaudeTerminal({ cwd: path })}
                              title={`Open ${repoName} in Terminal`}
                              className="p-1 rounded hover:bg-accent text-muted-foreground"
                            >
                              <Terminal className="h-3 w-3" />
                            </button>
                            <button
                              onClick={async () => {
                                const { Command } = await import("@tauri-apps/plugin-shell");
                                await Command.create("code", [path]).execute();
                              }}
                              title={`Open ${repoName} in VS Code`}
                              className="p-1 rounded hover:bg-accent text-muted-foreground"
                            >
                              <Code2 className="h-3 w-3" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </button>

                  {expandedDays.has(day) && (
                    <div className="border-t">
                      {dayCommits.map((c) => (
                        <div
                          key={c.hash}
                          className="flex items-start gap-3 px-4 py-2 text-sm border-b last:border-b-0"
                        >
                          <code className="text-xs text-primary font-mono shrink-0 mt-0.5">
                            {shortHash(c.hash)}
                          </code>
                          <span className="flex-1 text-foreground">{c.message}</span>
                          <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-blue-500/10 text-blue-500 shrink-0">
                            {c.repo_name}
                          </span>
                          <span className="text-xs text-muted-foreground shrink-0">
                            {formatTime(c.date)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
