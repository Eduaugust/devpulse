import { useState, useEffect, useCallback } from "react";
import { usePrReviewStore } from "@/stores/prReviewStore";
import { useBackgroundTaskStore } from "@/stores/backgroundTaskStore";
import { useGithubDataStore } from "@/stores/githubDataStore";
import { Command, open as shellOpen } from "@tauri-apps/plugin-shell";
import * as tauri from "@/lib/tauri";
import {
  runReview,
  postReview,
  parseMarkdownReview,
  generateFix,
} from "@/lib/reviewRunner";
import {
  findLocalRepo,
  releaseLocalRepo,
  checkoutPrBranch,
  buildFixPrompt,
} from "@/lib/fixRunner";
import { openClaudeTerminal } from "@/lib/tauri";
import { join as pathJoin } from "@tauri-apps/api/path";
import { pathEndsWith } from "@/lib/platform";
import type {
  ReviewFinding,
  ReviewComment,
  FixSuggestion,
  PrWithReviewStatus,
  PrDetail,
  SavedReview,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  GitPullRequestArrow,
  Bot,
  Loader2,
  AlertOctagon,
  AlertTriangle,
  Lightbulb,
  ThumbsUp,
  CheckCircle2,
  Copy,
  ExternalLink,
  ArrowLeft,
  RotateCcw,
  Send,
  FileText,
  ChevronDown,
  ChevronRight,
  Clock,
  Code,
  SquareCheckBig,
  Square,
  Trash2,
  Eye,
  Wrench,
  MessageSquare,
  Sparkles,
  RefreshCw,
} from "lucide-react";

// ── Tab Bar ──

const tabs = [
  { key: "review" as const, label: "Review", icon: Eye },
  { key: "fixes" as const, label: "Fixes", icon: Wrench },
];

function TabBar() {
  const { activeTab, setActiveTab } = usePrReviewStore();

  return (
    <div className="flex items-center gap-1 border-b mb-4">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = activeTab === tab.key;
        return (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 transition-colors -mb-px",
              isActive
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground hover:border-border",
            )}
          >
            <Icon className="h-4 w-4" />
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

// ── Main Component ──

export function PrReview() {
  const store = usePrReviewStore();

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold mb-1">PR Review</h2>
        <p className="text-sm text-muted-foreground">
          AI-powered code review workflow
        </p>
      </div>

      <TabBar />

      {store.activeTab === "review" && <ReviewTab />}
      {store.activeTab === "fixes" && <FixesTab />}
    </div>
  );
}

// ── Review Tab (existing workflow) ──

function ReviewTab() {
  const store = usePrReviewStore();

  const isSelectStep = store.step === "select-repo" || store.step === "select-pr";
  const stepIndex = isSelectStep ? 0 : store.step === "reviewing" ? 1 : 2;
  const stepLabels = ["Select PR", "Review", "Results"];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-6">
        {stepLabels.map((label, i) => (
          <div key={label} className="flex items-center gap-2">
            <div
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-colors",
                i < stepIndex
                  ? "bg-primary/10 text-primary"
                  : i === stepIndex
                    ? "bg-primary text-primary-foreground"
                    : "bg-secondary text-muted-foreground",
              )}
            >
              <span className="w-4 h-4 flex items-center justify-center rounded-full text-[10px] bg-current/10">
                {i < stepIndex ? "\u2713" : i + 1}
              </span>
              {label}
            </div>
            {i < stepLabels.length - 1 && <div className="w-6 h-px bg-border" />}
          </div>
        ))}
      </div>

      {isSelectStep && <SelectPrUnified />}
      {store.step === "reviewing" && <Reviewing />}
      {store.step === "results" && <Results />}
      {store.step === "posting" && <Posting />}
      {store.step === "posted" && <Posted />}

      {store.error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
          <p className="text-xs text-destructive">{store.error}</p>
          <button
            onClick={() => {
              store.setError("");
              store.setStep("select-repo");
            }}
            className="mt-2 text-xs text-primary hover:underline"
          >
            Start over
          </button>
        </div>
      )}

      <ReviewHistory />
    </div>
  );
}

// ── Fixes Tab ──

function FixesTab() {
  const { fixPrs: prs, fetching, refresh } = useGithubDataStore();
  const [error, setError] = useState("");
  const [selectedPr, setSelectedPr] = useState<PrWithReviewStatus | null>(null);

  // Trigger refresh if no data yet
  useEffect(() => {
    if (prs.length === 0 && !fetching) {
      refresh().catch((e) => setError(`Failed to load PRs: ${e}`));
    }
  }, []);

  const loading = fetching && prs.length === 0;

  const handleRefresh = () => {
    setError("");
    refresh().catch((e) => setError(`Failed to load PRs: ${e}`));
  };

  if (selectedPr) {
    return (
      <FixesDetail
        pr={selectedPr}
        onBack={() => setSelectedPr(null)}
      />
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        <span className="ml-2 text-sm text-muted-foreground">
          Scanning for PRs needing fixes...
        </span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
        <p className="text-xs text-destructive">{error}</p>
        <button
          onClick={handleRefresh}
          className="mt-2 text-xs text-primary hover:underline"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {prs.length === 0
            ? "No PRs with pending review comments"
            : `${prs.length} PR(s) with changes requested`}
        </p>
        <button
          onClick={handleRefresh}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <RefreshCw className="h-3 w-3" />
          Refresh
        </button>
      </div>

      {prs.length === 0 ? (
        <div className="rounded-lg border bg-card p-6 text-center">
          <CheckCircle2 className="h-8 w-8 text-green-500 mx-auto mb-2" />
          <p className="text-sm font-medium">All clear!</p>
          <p className="text-xs text-muted-foreground mt-1">
            None of your PRs have pending review comments
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {prs.map((pr) => (
            <button
              key={`${pr.repo}#${pr.number}`}
              onClick={() => setSelectedPr(pr)}
              className="w-full rounded-lg border bg-card p-4 hover:bg-secondary/50 transition-colors text-left"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <GitPullRequestArrow className="h-4 w-4 text-amber-500 shrink-0" />
                  <span className="text-xs font-mono text-muted-foreground">
                    #{pr.number}
                  </span>
                  <span className="text-sm font-medium">{pr.title}</span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <MessageSquare className="h-3 w-3 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">
                    {pr.commentCount}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-3 mt-1.5">
                <span className="text-xs text-muted-foreground">
                  {pr.repo}
                </span>
                <span className="text-xs text-muted-foreground font-mono">
                  {pr.headRefName}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Fixes Detail: shows review comments for a PR + fix generation ──

function FixesDetail({
  pr,
  onBack,
}: {
  pr: PrWithReviewStatus;
  onBack: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [comments, setComments] = useState<ReviewComment[]>([]);
  const [fixes, setFixes] = useState<Map<number, FixSuggestion>>(new Map());
  const [error, setError] = useState("");
  const [localRepoPath, setLocalRepoPath] = useState<string | null>(null);
  const [fixingAll, setFixingAll] = useState(false);

  useEffect(() => {
    useGithubDataStore.getState().fetchPrComments(pr.repo, pr.number)
      .then(setComments)
      .catch((e) => setError(`Failed to load comments: ${e}`))
      .finally(() => setLoading(false));
  }, [pr.repo, pr.number]);

  // Try to find local repo path for VS Code integration
  useEffect(() => {
    const repoName = pr.repo.split("/")[1];
    tauri.getLocalRepos().then((locals) => {
      const match = locals.find(
        (l) => l.name === repoName || pathEndsWith(l.path, repoName),
      );
      if (match) setLocalRepoPath(match.path);
    }).catch(() => {});
  }, [pr.repo]);

  const openInVsCode = async (file: string, line: number | null) => {
    if (!localRepoPath || !file) return;
    const fullPath = await pathJoin(localRepoPath, file);
    const arg = line && line > 0 ? `${fullPath}:${line}` : fullPath;
    Command.create("code", ["--goto", arg]).execute().catch(console.error);
  };

  const handleGenerateFix = async (comment: ReviewComment) => {
    setFixes((prev) => {
      const next = new Map(prev);
      next.set(comment.id, {
        commentId: comment.id,
        file: comment.path,
        line: comment.line,
        originalComment: comment.body,
        suggestedFix: "",
        loading: true,
      });
      return next;
    });

    try {
      const fix = await generateFix(pr.repo, pr.number, comment);
      setFixes((prev) => {
        const next = new Map(prev);
        next.set(comment.id, {
          commentId: comment.id,
          file: comment.path,
          line: comment.line,
          originalComment: comment.body,
          suggestedFix: fix,
          loading: false,
        });
        return next;
      });
    } catch (e) {
      setFixes((prev) => {
        const next = new Map(prev);
        next.set(comment.id, {
          commentId: comment.id,
          file: comment.path,
          line: comment.line,
          originalComment: comment.body,
          suggestedFix: "",
          loading: false,
          error: String(e),
        });
        return next;
      });
    }
  };

  const handleFixAll = async () => {
    setFixingAll(true);
    setError("");
    try {
      const { monitoredRepos } = useGithubDataStore.getState();
      const monitoredRepo = monitoredRepos.find((r) => r.full_name === pr.repo);
      const baseBranch = monitoredRepo?.base_branch || "development";

      const localRepo = await findLocalRepo(pr.repo, pr.headRefName, baseBranch);
      if (!localRepo) {
        setError(
          `No local clone found for "${pr.repo}". Add it in Settings → Local Repositories, then try again.`,
        );
        return;
      }

      if (localRepo.needsCheckout) {
        await checkoutPrBranch(localRepo.path, pr.headRefName);
      }

      // Open VS Code at the repo on the correct branch
      Command.create("code", [localRepo.path]).execute().catch(() => {});

      // Open Claude terminal with fix prompt
      const prompt = buildFixPrompt(pr.repo, pr.number, pr.headRefName, comments);
      await openClaudeTerminal({
        cwd: localRepo.path,
        initialPrompt: prompt,
      });

      // Release after a short delay so a second Fix All can use another clone
      setTimeout(() => releaseLocalRepo(localRepo.path), 5000);
    } catch (e) {
      setError(String(e));
    } finally {
      setFixingAll(false);
    }
  };

  const copyFix = async (text: string) => {
    await navigator.clipboard.writeText(text);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        <span className="ml-2 text-sm text-muted-foreground">
          Loading review comments...
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <button
          onClick={onBack}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3 w-3" />
          Back to list
        </button>
        <button
          onClick={() => shellOpen(pr.url).catch(console.error)}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ExternalLink className="h-3 w-3" />
          Open PR
        </button>
      </div>

      <div className="rounded-lg border bg-card p-4">
        <div className="flex items-center gap-2">
          <GitPullRequestArrow className="h-4 w-4 text-amber-500" />
          <span className="text-xs font-mono text-muted-foreground">
            {pr.repo} #{pr.number}
          </span>
        </div>
        <p className="text-sm font-medium mt-1">{pr.title}</p>
        <p className="text-xs text-muted-foreground mt-1">
          {comments.length} review comment(s)
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
          <p className="text-xs text-destructive">{error}</p>
        </div>
      )}

      {/* Fix All button */}
      {comments.length > 0 && (
        <div className="flex items-center gap-2">
          <button
            onClick={handleFixAll}
            disabled={fixingAll}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {fixingAll ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
            Fix All ({comments.length})
          </button>
        </div>
      )}

      {/* Comments */}
      <div className="space-y-3">
        {comments.map((comment) => {
          const fix = fixes.get(comment.id);
          return (
            <div
              key={comment.id}
              className="rounded-lg border bg-card overflow-hidden"
            >
              {/* Comment header */}
              <div className="p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono text-muted-foreground truncate">
                      {comment.path}
                      {comment.line ? `:${comment.line}` : ""}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {localRepoPath && comment.path && (
                      <button
                        onClick={() => openInVsCode(comment.path, comment.line)}
                        className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                        title="Open in VS Code"
                      >
                        <Code className="h-3 w-3" />
                      </button>
                    )}
                    <span className="text-[10px] text-muted-foreground">
                      {comment.user.login}
                    </span>
                  </div>
                </div>

                {/* Diff hunk context */}
                {comment.diff_hunk && (
                  <pre className="text-[10px] font-mono bg-secondary/50 rounded p-2 overflow-x-auto max-h-24 text-muted-foreground">
                    {comment.diff_hunk}
                  </pre>
                )}

                {/* Comment body */}
                <div className="text-xs text-foreground whitespace-pre-wrap">
                  {comment.body}
                </div>

                {/* Generate Fix button */}
                {!fix && (
                  <button
                    onClick={() => handleGenerateFix(comment)}
                    className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md border hover:bg-secondary transition-colors"
                  >
                    <Sparkles className="h-3 w-3" />
                    Generate Fix
                  </button>
                )}
              </div>

              {/* Fix suggestion */}
              {fix && (
                <div className="border-t bg-green-500/5 p-3 space-y-2">
                  {fix.loading ? (
                    <div className="flex items-center gap-2 py-2">
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                      <span className="text-xs text-muted-foreground">
                        Generating fix...
                      </span>
                    </div>
                  ) : fix.error ? (
                    <div className="space-y-1">
                      <p className="text-xs text-destructive">{fix.error}</p>
                      <button
                        onClick={() => handleGenerateFix(comment)}
                        className="text-xs text-primary hover:underline"
                      >
                        Retry
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-green-600">
                          Suggested Fix
                        </span>
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => copyFix(fix.suggestedFix)}
                            className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                            title="Copy fix"
                          >
                            <Copy className="h-3 w-3" />
                            Copy
                          </button>
                          {localRepoPath && fix.file && (
                            <button
                              onClick={() => openInVsCode(fix.file, fix.line)}
                              className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                              title="Open in VS Code"
                            >
                              <Code className="h-3 w-3" />
                              VS Code
                            </button>
                          )}
                        </div>
                      </div>
                      <pre className="text-xs font-mono bg-background/50 rounded p-2 overflow-x-auto whitespace-pre-wrap">
                        {fix.suggestedFix}
                      </pre>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {comments.length === 0 && (
        <div className="rounded-lg border bg-card p-6 text-center">
          <CheckCircle2 className="h-8 w-8 text-green-500 mx-auto mb-2" />
          <p className="text-sm font-medium">No review comments</p>
          <p className="text-xs text-muted-foreground mt-1">
            This PR has no inline review comments to address
          </p>
        </div>
      )}
    </div>
  );
}

// ── Step 1: Select Repo ──

interface PrWithContext extends PrDetail {
  repo: string;
  isReviewRequested: boolean;
}

function SelectPrUnified() {
  const { setSelectedRepo, setSelectedPr, setOpenPrs, setStep } =
    usePrReviewStore();
  const { reviewRequestedPrs, allOpenPrs, monitoredRepos, fetching, refresh } = useGithubDataStore();
  const [showOther, setShowOther] = useState(false);

  // Trigger a refresh when component mounts (data may already be cached)
  useEffect(() => {
    if (reviewRequestedPrs.length === 0 && allOpenPrs.length === 0 && !fetching) {
      refresh();
    }
  }, []);

  const reviewPrs: PrWithContext[] = reviewRequestedPrs;
  const otherPrs: PrWithContext[] = allOpenPrs;
  const loading = fetching && reviewPrs.length === 0 && otherPrs.length === 0;

  const selectPr = (pr: PrWithContext) => {
    const repo = monitoredRepos.find((r) => r.full_name === pr.repo);
    if (repo) setSelectedRepo(repo);
    setSelectedPr(pr);
    setOpenPrs([pr]);
    setStep("reviewing");
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        <span className="ml-2 text-sm text-muted-foreground">Loading PRs...</span>
      </div>
    );
  }

  if (reviewPrs.length === 0 && otherPrs.length === 0) {
    return (
      <div className="rounded-lg border bg-card p-6 text-center">
        <p className="text-sm text-muted-foreground mb-2">
          No open PRs found across your monitored repos
        </p>
        <a href="/settings" className="text-xs text-primary hover:underline">
          Go to Settings to add repos
        </a>
      </div>
    );
  }

  const renderPrCard = (pr: PrWithContext) => (
    <button
      key={`${pr.repo}#${pr.number}`}
      onClick={() => selectPr(pr)}
      className="w-full rounded-lg border bg-card p-4 hover:bg-secondary/50 transition-colors text-left"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <GitPullRequestArrow className={cn("h-4 w-4 shrink-0", pr.isReviewRequested ? "text-primary" : "text-muted-foreground")} />
          <span className="text-xs font-mono text-muted-foreground shrink-0">#{pr.number}</span>
          <span className="text-sm font-medium truncate">{pr.title}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {pr.isReviewRequested && (
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-primary/10 text-primary">
              Your review
            </span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-3 mt-1.5 flex-wrap">
        <span className="text-[10px] text-muted-foreground">{pr.repo}</span>
        <span className="text-[10px] text-muted-foreground font-mono">
          {pr.headRefName} → {pr.baseRefName}
        </span>
        <span className="text-[10px] text-muted-foreground">by {pr.author.login}</span>
        <span className="text-[10px] text-green-500">+{pr.additions}</span>
        <span className="text-[10px] text-red-500">-{pr.deletions}</span>
        <span className="text-[10px] text-muted-foreground">{pr.changedFiles} files</span>
      </div>
    </button>
  );

  return (
    <div className="space-y-4">
      {/* PRs awaiting your review */}
      {reviewPrs.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-primary">
            Awaiting your review ({reviewPrs.length})
          </p>
          {reviewPrs.map(renderPrCard)}
        </div>
      )}

      {/* Other open PRs */}
      {otherPrs.length > 0 && (
        <div className="space-y-2">
          <button
            onClick={() => setShowOther(!showOther)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {showOther ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            Other open PRs ({otherPrs.length})
          </button>
          {showOther && otherPrs.map(renderPrCard)}
        </div>
      )}
    </div>
  );
}

// ── Step 3: Reviewing (with background task tracking) ──

// Module-level set prevents duplicate reviews across StrictMode double-mount and navigation re-mounts
const activeReviewKeys = new Set<string>();

function Reviewing() {
  const { selectedRepo, selectedPr, setReviewResult, setStep, setError } =
    usePrReviewStore();
  const [phase, setPhase] = useState("Fetching diff...");

  useEffect(() => {
    if (!selectedRepo || !selectedPr) return;

    const key = `${selectedRepo.full_name}#${selectedPr.number}`;
    if (activeReviewKeys.has(key)) return;
    activeReviewKeys.add(key);

    const { addTask, updateTask } = useBackgroundTaskStore.getState();

    const taskId = addTask("pr-review", `Review PR #${selectedPr.number} — ${selectedPr.title}`, {
      repo: selectedRepo.full_name,
      prNumber: selectedPr.number,
    });

    runReview(selectedRepo.full_name, selectedPr.number, setPhase)
      .then(async (result) => {
        setReviewResult(result);
        updateTask(taskId, {
          status: "completed",
          result: `${result.verdict}: ${result.findings.length} findings`,
          finishedAt: Date.now(),
        });

        // Save to history
        try {
          const cmds = await tauri.getCommands();
          const prCmd = cmds.find((c) => c.slug === "pr-review");
          if (prCmd?.id) {
            const runId = await tauri.createCommandRun(
              prCmd.id,
              JSON.stringify({ repo: selectedRepo.full_name, prNumber: selectedPr.number, prTitle: selectedPr.title }),
            );
            await tauri.updateCommandRun(runId, "completed", result.rawMarkdown, "", null);
          }
        } catch {
          // non-critical
        }

        setStep("results");
      })
      .catch((e) => {
        updateTask(taskId, {
          status: "error",
          error: String(e),
          finishedAt: Date.now(),
        });
        setError(`Review failed: ${e}`);
      })
      .finally(() => {
        activeReviewKeys.delete(key);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex flex-col items-center justify-center py-16 space-y-4">
      <Bot className="h-10 w-10 text-primary animate-pulse" />
      <p className="text-sm font-medium">
        Analyzing PR #{selectedPr?.number}...
      </p>
      <p className="text-xs text-muted-foreground">{phase}</p>
    </div>
  );
}

// ── Step 4: Results ──

const findingConfig = {
  critical: {
    icon: AlertOctagon,
    border: "border-l-red-500",
    bg: "bg-red-500/5",
    label: "Critical",
    labelColor: "text-red-500",
  },
  warning: {
    icon: AlertTriangle,
    border: "border-l-amber-500",
    bg: "bg-amber-500/5",
    label: "Warning",
    labelColor: "text-amber-500",
  },
  suggestion: {
    icon: Lightbulb,
    border: "border-l-blue-500",
    bg: "bg-blue-500/5",
    label: "Suggestion",
    labelColor: "text-blue-500",
  },
  positive: {
    icon: ThumbsUp,
    border: "border-l-green-500",
    bg: "bg-green-500/5",
    label: "Positive",
    labelColor: "text-green-500",
  },
};

const verdictConfig = {
  approve: { color: "bg-green-500/10 text-green-500 border-green-500/30", label: "Ready to Merge" },
  request_changes: { color: "bg-amber-500/10 text-amber-500 border-amber-500/30", label: "Needs Changes" },
  comment: { color: "bg-blue-500/10 text-blue-500 border-blue-500/30", label: "Comments" },
};

function Results() {
  const { reviewResult, selectedPr, selectedRepo, reset } =
    usePrReviewStore();
  const { addTask, updateTask } = useBackgroundTaskStore();
  const [showMarkdown, setShowMarkdown] = useState(false);
  const [postingInline, setPostingInline] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [localRepoPath, setLocalRepoPath] = useState<string | null>(null);

  // Initialize: all non-positive findings selected by default
  useEffect(() => {
    if (!reviewResult) return;
    const initial = new Set<number>();
    reviewResult.findings.forEach((f, i) => {
      if (f.category !== "positive") initial.add(i);
    });
    setSelected(initial);
  }, [reviewResult]);

  // Try to find a local repo path for VS Code integration
  useEffect(() => {
    if (!selectedRepo) return;
    tauri.getLocalRepos().then((locals) => {
      const match = locals.find(
        (l) => l.name === selectedRepo.name || pathEndsWith(l.path, selectedRepo.name),
      );
      if (match) setLocalRepoPath(match.path);
    }).catch(() => {});
  }, [selectedRepo]);

  if (!reviewResult) return null;

  // Build index map: category → global indices
  const indexMap: Record<string, number[]> = {};
  reviewResult.findings.forEach((f, i) => {
    (indexMap[f.category] ||= []).push(i);
  });

  const grouped = reviewResult.findings.reduce(
    (acc, f) => {
      (acc[f.category] ||= []).push(f);
      return acc;
    },
    {} as Record<string, ReviewFinding[]>,
  );

  const verdict = verdictConfig[reviewResult.verdict] || verdictConfig.comment;
  const selectedCount = selected.size;

  const toggleFinding = (index: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const toggleCategory = (indices: number[]) => {
    setSelected((prev) => {
      const next = new Set(prev);
      const allChecked = indices.every((i) => next.has(i));
      if (allChecked) {
        indices.forEach((i) => next.delete(i));
      } else {
        indices.forEach((i) => next.add(i));
      }
      return next;
    });
  };

  const openInVsCode = async (file: string, line: number) => {
    if (!localRepoPath || !file) return;
    const fullPath = await pathJoin(localRepoPath, file);
    const arg = line > 0 ? `${fullPath}:${line}` : fullPath;
    Command.create("code", ["--goto", arg]).execute().catch(console.error);
  };

  const openPrInBrowser = () => {
    if (!selectedPr?.url) return;
    shellOpen(selectedPr.url).catch(console.error);
  };

  const copyResults = async () => {
    await navigator.clipboard.writeText(reviewResult.rawMarkdown);
  };

  const startPost = async () => {
    if (!selectedRepo || !selectedPr) return;

    const findingsToPost = reviewResult.findings.filter((_, i) => selected.has(i));
    if (findingsToPost.length === 0) {
      usePrReviewStore.getState().setError("No findings selected to post");
      return;
    }

    setPostingInline(true);
    const taskId = addTask("post-review", `Post review to PR #${selectedPr.number}`, {
      repo: selectedRepo.full_name,
      prNumber: selectedPr.number,
    });

    try {
      const result = await postReview(
        selectedRepo.full_name,
        selectedPr.number,
        findingsToPost,
        reviewResult.rawMarkdown,
      );
      updateTask(taskId, {
        status: "completed",
        result: `Posted ${result.commentCount} comments`,
        finishedAt: Date.now(),
      });
      usePrReviewStore.getState().setPostResult(
        `${result.commentCount} comments posted to ${result.prUrl}\n\nFiles:\n${result.filesWithComments.map((f) => `- ${f}`).join("\n")}`,
      );
      usePrReviewStore.getState().setStep("posted");
    } catch (e) {
      updateTask(taskId, {
        status: "error",
        error: String(e),
        finishedAt: Date.now(),
      });
      usePrReviewStore.getState().setError(`Failed to post review: ${e}`);
    } finally {
      setPostingInline(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Verdict banner */}
      <div className={cn("rounded-lg border p-4", verdict.color)}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5" />
            <span className="text-sm font-semibold">{verdict.label}</span>
          </div>
          {selectedPr?.url && (
            <button
              onClick={openPrInBrowser}
              className="flex items-center gap-1 text-xs opacity-80 hover:opacity-100 transition-opacity"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Open PR
            </button>
          )}
        </div>
        <p className="text-xs mt-1 opacity-80">{reviewResult.summary}</p>
      </div>

      {/* Raw markdown toggle */}
      <button
        onClick={() => setShowMarkdown(!showMarkdown)}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        {showMarkdown ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        <FileText className="h-3 w-3" />
        {showMarkdown ? "Hide" : "Show"} raw markdown
      </button>

      {showMarkdown && (
        <div className="rounded-lg border bg-secondary/30 p-4 overflow-x-auto">
          <pre className="text-xs whitespace-pre-wrap font-mono text-muted-foreground">
            {reviewResult.rawMarkdown}
          </pre>
        </div>
      )}

      {/* Findings grouped by category */}
      {(["critical", "warning", "suggestion", "positive"] as const).map((cat) => {
        const findings = grouped[cat];
        if (!findings?.length) return null;
        const config = findingConfig[cat];
        const Icon = config.icon;
        const indices = indexMap[cat] || [];
        const isPostable = cat !== "positive";
        const allChecked = isPostable && indices.every((i) => selected.has(i));
        const someChecked = isPostable && indices.some((i) => selected.has(i));

        return (
          <div key={cat} className="space-y-2">
            <div className="flex items-center gap-1.5">
              {isPostable && (
                <button
                  onClick={() => toggleCategory(indices)}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  {allChecked ? (
                    <SquareCheckBig className="h-3.5 w-3.5 text-primary" />
                  ) : someChecked ? (
                    <SquareCheckBig className="h-3.5 w-3.5 text-muted-foreground/50" />
                  ) : (
                    <Square className="h-3.5 w-3.5" />
                  )}
                </button>
              )}
              <Icon className={cn("h-4 w-4", config.labelColor)} />
              <span className={cn("text-xs font-semibold", config.labelColor)}>
                {config.label} ({findings.length})
              </span>
            </div>
            {findings.map((f, localIdx) => {
              const globalIdx = indices[localIdx];
              const isSelected = selected.has(globalIdx);

              return (
                <div
                  key={localIdx}
                  className={cn(
                    "rounded-lg border border-l-4 p-3 space-y-1 transition-opacity",
                    config.border,
                    config.bg,
                    isPostable && !isSelected && "opacity-40",
                  )}
                >
                  <div className="flex items-center gap-2">
                    {isPostable && (
                      <button
                        onClick={() => toggleFinding(globalIdx)}
                        className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
                      >
                        {isSelected ? (
                          <SquareCheckBig className="h-3.5 w-3.5 text-primary" />
                        ) : (
                          <Square className="h-3.5 w-3.5" />
                        )}
                      </button>
                    )}
                    <span className="text-xs font-mono text-muted-foreground flex-1 truncate">
                      {f.file}{f.line > 0 ? `:${f.line}` : ""}
                    </span>
                    {localRepoPath && f.file && (
                      <button
                        onClick={() => openInVsCode(f.file, f.line)}
                        className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors shrink-0"
                        title="Open in VS Code"
                      >
                        <Code className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                  <p className="text-sm font-medium">{f.title}</p>
                  <p className="text-xs text-muted-foreground">{f.description}</p>
                  {f.suggestion && (
                    <div className="text-xs bg-background/50 rounded p-2 font-mono mt-1">
                      {f.suggestion}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}

      {/* Action bar */}
      <div className="flex items-center gap-2 pt-2 border-t">
        <button
          onClick={startPost}
          disabled={postingInline || selectedCount === 0}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {postingInline ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Send className="h-3.5 w-3.5" />
          )}
          Post to GitHub ({selectedCount})
        </button>
        <button
          onClick={copyResults}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border hover:bg-secondary transition-colors"
        >
          <Copy className="h-3.5 w-3.5" />
          Copy
        </button>
        <button
          onClick={() => {
            usePrReviewStore.getState().setReviewResult(null);
            usePrReviewStore.getState().setStep("reviewing");
          }}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border hover:bg-secondary transition-colors"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Review Again
        </button>
        {selectedPr?.url && (
          <button
            onClick={openPrInBrowser}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border hover:bg-secondary transition-colors"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Open PR
          </button>
        )}
        <button
          onClick={reset}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border hover:bg-secondary transition-colors ml-auto"
        >
          New Review
        </button>
      </div>
    </div>
  );
}

// ── Step 5: Posting (legacy fallback — now handled inline in Results) ──

function Posting() {
  const { selectedRepo, selectedPr, reviewResult, setPostResult, setStep, setError } =
    usePrReviewStore();

  useEffect(() => {
    const post = async () => {
      if (!selectedRepo || !selectedPr || !reviewResult) return;

      try {
        const result = await postReview(
          selectedRepo.full_name,
          selectedPr.number,
          reviewResult.findings,
          reviewResult.rawMarkdown,
        );
        setPostResult(
          `${result.commentCount} comments posted to ${result.prUrl}\n\nFiles:\n${result.filesWithComments.map((f) => `- ${f}`).join("\n")}`,
        );
        setStep("posted");
      } catch (e) {
        setError(`Failed to post review: ${e}`);
        setStep("results");
      }
    };
    post();
  }, [selectedRepo, selectedPr, reviewResult, setPostResult, setStep, setError]);

  return (
    <div className="flex flex-col items-center justify-center py-16 space-y-4">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
      <p className="text-sm font-medium">Posting review to GitHub...</p>
    </div>
  );
}

// ── Step 6: Posted ──

function Posted() {
  const { selectedPr, postResult, reset } = usePrReviewStore();

  return (
    <div className="rounded-lg border border-green-500/30 bg-green-500/5 p-6 text-center space-y-3">
      <CheckCircle2 className="h-10 w-10 text-green-500 mx-auto" />
      <p className="text-sm font-semibold text-green-500">
        Review posted successfully
      </p>
      <p className="text-xs text-muted-foreground">
        Review posted as PENDING — submit it on GitHub to finalize
      </p>
      {postResult && (
        <pre className="text-[10px] text-muted-foreground bg-secondary/50 rounded p-2 mx-auto max-w-sm text-left whitespace-pre-wrap">
          {postResult}
        </pre>
      )}
      <div className="flex items-center justify-center gap-2 pt-2">
        {selectedPr?.url && (
          <a
            href={selectedPr.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            View on GitHub
          </a>
        )}
        <button
          onClick={reset}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border hover:bg-secondary transition-colors"
        >
          New Review
        </button>
      </div>
    </div>
  );
}

// ── Review History ──

function ReviewHistory() {
  const [reviews, setReviews] = useState<SavedReview[]>([]);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const { setReviewResult, setStep, setSelectedRepo, setSelectedPr } = usePrReviewStore();

  const loadReviews = useCallback(async () => {
    try {
      const cmds = await tauri.getCommands();
      const prCmd = cmds.find((c) => c.slug === "pr-review");
      if (!prCmd?.id) return;
      const runs = await tauri.getCommandRuns(prCmd.id, 30);
      setReviews(
        runs
          .filter((r) => r.status === "completed" && r.result_text)
          .map((r) => {
            let label = "PR Review";
            let repo: string | undefined;
            let prNumber: number | undefined;
            let prTitle: string | undefined;
            try {
              const params = JSON.parse(r.parameters_json);
              repo = params.repo;
              prNumber = params.prNumber;
              prTitle = params.prTitle;
              label = `${params.repo} #${params.prNumber}${params.prTitle ? ` — ${params.prTitle}` : ""}`;
            } catch { /* */ }
            return {
              id: r.id!,
              date: r.created_at,
              label,
              content: r.result_text,
              repo,
              prNumber,
              prTitle,
            };
          }),
      );
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    loadReviews();
  }, [loadReviews]);

  const deleteReview = async (id: number) => {
    try {
      await tauri.deleteCommandRun(id);
      setReviews((prev) => prev.filter((r) => r.id !== id));
      if (expandedId === id) setExpandedId(null);
    } catch {
      // ignore
    }
  };

  const viewReview = (review: SavedReview) => {
    const result = parseMarkdownReview(review.content.trim());
    setReviewResult(result);

    // Set repo/PR context if available so "Post to GitHub" works
    if (review.repo) {
      const [owner, name] = review.repo.split("/");
      setSelectedRepo({ id: null, owner, name, full_name: review.repo, added_at: "", base_branch: "development", provider: "github" });
    }
    if (review.prNumber) {
      setSelectedPr({
        number: review.prNumber,
        title: review.prTitle || "",
        url: review.repo ? `https://github.com/${review.repo}/pull/${review.prNumber}` : "",
        state: "OPEN",
        headRefName: "",
        baseRefName: "",
        additions: 0,
        deletions: 0,
        changedFiles: 0,
        author: { login: "" },
        commits: { totalCount: 0 },
      });
    }

    setStep("results");
  };

  if (reviews.length === 0) return null;

  return (
    <div className="space-y-2 pt-4 border-t">
      <div className="flex items-center gap-2">
        <Clock className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-medium">Review History</h3>
        <span className="text-[10px] text-muted-foreground">
          ({reviews.length})
        </span>
      </div>
      <div className="space-y-1">
        {reviews.map((review) => (
          <div key={review.id} className="rounded-lg border bg-card">
            <div className="flex items-center gap-2 p-3 hover:bg-secondary/30 transition-colors">
              <button
                onClick={() =>
                  setExpandedId(expandedId === review.id ? null : review.id)
                }
                className="flex items-center gap-2 flex-1 text-left min-w-0"
              >
                {expandedId === review.id ? (
                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                )}
                <GitPullRequestArrow className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span className="text-xs font-medium flex-1 truncate">
                  {review.label}
                </span>
                <span className="text-[10px] text-muted-foreground shrink-0">
                  {new Date(review.date).toLocaleString()}
                </span>
              </button>
              <button
                onClick={() => viewReview(review)}
                className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
                title="View & Post"
              >
                <Eye className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => deleteReview(review.id)}
                className="text-muted-foreground hover:text-destructive transition-colors shrink-0"
                title="Delete"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
            {expandedId === review.id && (
              <div className="border-t px-4 py-3">
                <div className="flex justify-end gap-2 mb-2">
                  <button
                    onClick={() => viewReview(review)}
                    className="flex items-center gap-1 text-[10px] text-primary hover:text-primary/80 transition-colors"
                  >
                    <Eye className="h-3 w-3" />
                    View & Post
                  </button>
                  <button
                    onClick={async () => {
                      await navigator.clipboard.writeText(review.content);
                    }}
                    className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <Copy className="h-3 w-3" />
                    Copy
                  </button>
                </div>
                <pre className="text-xs bg-secondary p-3 rounded max-h-64 overflow-y-auto whitespace-pre-wrap">
                  {review.content}
                </pre>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
