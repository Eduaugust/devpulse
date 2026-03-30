import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { listen } from "@tauri-apps/api/event";
import { isPermissionGranted, requestPermission } from "@tauri-apps/plugin-notification";
import { useEventStore } from "@/stores/eventStore";
import { useBackgroundTaskStore } from "@/stores/backgroundTaskStore";
import { useGithubDataStore } from "@/stores/githubDataStore";
import { runReview, postReview, fetchReviewComments } from "@/lib/reviewRunner";
import { runDescription } from "@/lib/descriptionRunner";
import { findLocalRepo, releaseLocalRepo, checkoutPrBranch, buildFixPrompt } from "@/lib/fixRunner";
import { startMonitor, isMonitorRunning, getMonitoredRepos, openClaudeTerminal } from "@/lib/tauri";
import { openUrl } from "@tauri-apps/plugin-opener";
import { detectUsername, editPrBody, fetchPrBranch } from "@/lib/gitProvider";
import type { GitProvider } from "@/lib/types";

// Cache username per provider once per app session
const cachedLogins: Record<string, string | null> = {};
async function getMyLogin(provider: GitProvider): Promise<string> {
  if (cachedLogins[provider] !== undefined) return cachedLogins[provider] ?? "";
  const login = await detectUsername(provider);
  cachedLogins[provider] = login;
  return login;
}

export function useMonitorListener() {
  const { fetchRecentEvents } = useEventStore();
  const navigate = useNavigate();
  const lastNotifiedEvent = useRef<{ event_type: string; url: string; repo: string; title: string } | null>(null);

  // Listen for notification events and navigate on window focus
  useEffect(() => {
    const unlistenEvent = listen<{ event_type: string; url: string; repo: string; title: string }>(
      "monitor:last-notified-event",
      (event) => {
        lastNotifiedEvent.current = event.payload;
        setTimeout(() => {
          lastNotifiedEvent.current = null;
        }, 10000);
      },
    );

    const handleFocus = () => {
      const evt = lastNotifiedEvent.current;
      if (!evt) return;
      lastNotifiedEvent.current = null;

      switch (evt.event_type) {
        case "review_requested":
        case "changes_requested":
          navigate("/pr-review");
          break;
        case "pr_approved":
        case "mention":
        case "comment":
          if (evt.url) openUrl(evt.url).catch(() => {});
          break;
        default:
          navigate("/history");
          break;
      }
    };

    window.addEventListener("focus", handleFocus);
    return () => {
      window.removeEventListener("focus", handleFocus);
      unlistenEvent.then((fn) => fn());
    };
  }, [navigate]);

  useEffect(() => {
    // Auto-start monitor on app launch
    isMonitorRunning().then((running) => {
      if (!running) startMonitor().catch(() => {});
    });

    // Proactively request notification permission at startup
    isPermissionGranted().then((granted) => {
      if (!granted) {
        requestPermission().catch(() => {});
      }
    });

    // Initial data load
    useGithubDataStore.getState().refresh();

    const unlisten = listen("monitor:new-events", () => {
      fetchRecentEvents();
      useGithubDataStore.getState().refresh();
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [fetchRecentEvents]);

  // Listen for auto-review events (with frontend dedup)
  useEffect(() => {
    const reviewedPrs = new Set<string>();

    const unlisten = listen<{ repo: string; prNumber: number; autoPost: boolean }>(
      "monitor:auto-review",
      async (event) => {
        const { repo, prNumber, autoPost } = event.payload;
        const key = `${repo}#${prNumber}`;
        if (reviewedPrs.has(key)) return;
        reviewedPrs.add(key);

        const { addTask, updateTask } = useBackgroundTaskStore.getState();

        const taskId = addTask("pr-review", `Auto-review PR #${prNumber}`, {
          repo,
          prNumber,
        });

        // Resolve provider for this repo
        const monitoredRepos = await getMonitoredRepos();
        const monitoredRepo = monitoredRepos.find((r) => r.full_name === repo);
        const provider = (monitoredRepo?.provider ?? "github") as GitProvider;

        // Skip if user already has pending (unresolved) review comments on this PR
        try {
          const myLogin = await getMyLogin(provider);
          if (myLogin) {
            const comments = await fetchReviewComments(repo, prNumber);
            const myPendingComments = comments.filter((c) => c.user.login === myLogin);
            if (myPendingComments.length > 0) {
              updateTask(taskId, {
                status: "completed",
                result: `Skipped: ${myPendingComments.length} pending comments from you`,
                finishedAt: Date.now(),
              });
              return;
            }
          }
        } catch {
          // If check fails, proceed with review anyway
        }

        runReview(repo, prNumber)
          .then(async (result) => {
            const summary = `${result.verdict}: ${result.findings.length} findings`;
            updateTask(taskId, {
              status: "completed",
              result: summary,
              finishedAt: Date.now(),
            });

            if (autoPost && result.findings.length > 0) {
              const postTaskId = addTask("post-review", `Auto-post review PR #${prNumber}`, {
                repo,
                prNumber,
              });
              try {
                const postResult = await postReview(repo, prNumber, result.findings, result.rawMarkdown);
                updateTask(postTaskId, {
                  status: "completed",
                  result: `Posted ${postResult.commentCount} comments`,
                  finishedAt: Date.now(),
                });
              } catch (e) {
                updateTask(postTaskId, {
                  status: "error",
                  error: String(e),
                  finishedAt: Date.now(),
                });
              }
            }
          })
          .catch((e) => {
            updateTask(taskId, {
              status: "error",
              error: String(e),
              finishedAt: Date.now(),
            });
          });
      },
    );

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // Listen for auto-description events
  useEffect(() => {
    const describedPrs = new Set<string>();

    const unlisten = listen<{ repo: string; prNumber: number }>(
      "monitor:auto-description",
      async (event) => {
        const { repo, prNumber } = event.payload;
        const key = `${repo}#${prNumber}`;
        if (describedPrs.has(key)) return;
        describedPrs.add(key);

        const { addTask, updateTask } = useBackgroundTaskStore.getState();

        const taskId = addTask("pr-description", `Auto-describe PR #${prNumber}`, {
          repo,
          prNumber,
        });

        // Resolve provider
        const allRepos = await getMonitoredRepos();
        const matched = allRepos.find((r) => r.full_name === repo);
        const descProvider = (matched?.provider ?? "github") as GitProvider;

        runDescription(repo, prNumber)
          .then(async (description) => {
            await editPrBody(descProvider, repo, prNumber, description);
            updateTask(taskId, {
              status: "completed",
              result: "Description posted",
              finishedAt: Date.now(),
            });
          })
          .catch((e) => {
            updateTask(taskId, {
              status: "error",
              error: String(e),
              finishedAt: Date.now(),
            });
          });
      },
    );

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // Listen for auto-fixes events
  useEffect(() => {
    const fixedPrs = new Set<string>();

    const unlisten = listen<{ repo: string; prNumber: number }>(
      "monitor:auto-fixes",
      async (event) => {
        const { repo, prNumber } = event.payload;
        const key = `${repo}#${prNumber}`;
        if (fixedPrs.has(key)) return;
        fixedPrs.add(key);

        const { addTask, updateTask } = useBackgroundTaskStore.getState();

        const taskId = addTask("pr-fixes", `Auto-fix PR #${prNumber}`, {
          repo,
          prNumber,
        });

        try {
          const fixRepos = await getMonitoredRepos();
          const fixMatched = fixRepos.find((r) => r.full_name === repo);
          const fixProvider = (fixMatched?.provider ?? "github") as GitProvider;

          const prBranch = await fetchPrBranch(fixProvider, repo, prNumber);

          const monitoredRepos = fixRepos;
          const monitoredRepo = monitoredRepos.find((r) => r.full_name === repo);
          const baseBranch = monitoredRepo?.base_branch || "development";

          const localRepo = await findLocalRepo(repo, prBranch, baseBranch);
          if (!localRepo) throw new Error("No local clone found for " + repo);

          if (localRepo.needsCheckout) {
            await checkoutPrBranch(localRepo.path, prBranch);
          }

          const comments = await fetchReviewComments(repo, prNumber);
          if (comments.length === 0) throw new Error("No review comments found");

          const prompt = buildFixPrompt(repo, prNumber, prBranch, comments);
          await openClaudeTerminal({
            cwd: localRepo.path,
            initialPrompt: prompt,
          });

          setTimeout(() => releaseLocalRepo(localRepo.path), 5000);

          updateTask(taskId, {
            status: "completed",
            result: `Opened Claude terminal for ${comments.length} comments`,
            finishedAt: Date.now(),
          });
        } catch (e) {
          updateTask(taskId, {
            status: "error",
            error: String(e),
            finishedAt: Date.now(),
          });
        }
      },
    );

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);
}
