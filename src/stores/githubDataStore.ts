import { create } from "zustand";
import { Command } from "@tauri-apps/plugin-shell";
import * as tauri from "@/lib/tauri";
import { fetchPrsNeedingFixes, fetchReviewComments } from "@/lib/reviewRunner";
import type { PrDetail, PrWithReviewStatus, ReviewComment, MonitoredRepo } from "@/lib/types";

interface PrWithRepo extends PrDetail {
  repo: string;
  isReviewRequested: boolean;
}

interface GithubDataStore {
  // Data
  monitoredRepos: MonitoredRepo[];
  reviewRequestedPrs: PrWithRepo[];
  allOpenPrs: PrWithRepo[];
  fixPrs: PrWithReviewStatus[];
  prComments: Record<string, ReviewComment[]>; // key: "repo#number"

  // State
  lastFetchedAt: number | null;
  fetching: boolean;

  // Actions
  refresh: () => Promise<void>;
  fetchPrComments: (repo: string, prNumber: number) => Promise<ReviewComment[]>;
}

// Prevent concurrent refreshes
let refreshPromise: Promise<void> | null = null;

export const useGithubDataStore = create<GithubDataStore>((set, get) => ({
  monitoredRepos: [],
  reviewRequestedPrs: [],
  allOpenPrs: [],
  fixPrs: [],
  prComments: {},
  lastFetchedAt: null,
  fetching: false,

  refresh: async () => {
    // Deduplicate concurrent calls
    if (refreshPromise) return refreshPromise;

    const doRefresh = async () => {
      set({ fetching: true });
      try {
        const repos = await tauri.getMonitoredRepos();
        set({ monitoredRepos: repos });

        const reviewSet = new Set<string>();
        const reviewPrs: PrWithRepo[] = [];
        const otherPrs: PrWithRepo[] = [];

        for (const repo of repos) {
          // Fetch review-requested PRs
          try {
            const cmd = Command.create("gh", [
              "pr", "list", "--repo", repo.full_name,
              "--search", "review-requested:@me",
              "--json", "number,title,url,state,headRefName,baseRefName,additions,deletions,changedFiles,author,commits",
              "--limit", "10",
            ]);
            const out = await cmd.execute();
            if (out.code === 0) {
              const parsed = JSON.parse(out.stdout) as Array<Record<string, unknown>>;
              for (const p of parsed) {
                reviewSet.add(`${repo.full_name}#${p.number}`);
                reviewPrs.push(parsePr(p, repo.full_name, true));
              }
            }
          } catch { /* skip */ }

          // Fetch all open PRs
          try {
            const cmd = Command.create("gh", [
              "pr", "list", "--repo", repo.full_name,
              "--json", "number,title,url,state,headRefName,baseRefName,additions,deletions,changedFiles,author,commits",
              "--limit", "20",
            ]);
            const out = await cmd.execute();
            if (out.code === 0) {
              const parsed = JSON.parse(out.stdout) as Array<Record<string, unknown>>;
              for (const p of parsed) {
                if (!reviewSet.has(`${repo.full_name}#${p.number}`)) {
                  otherPrs.push(parsePr(p, repo.full_name, false));
                }
              }
            }
          } catch { /* skip */ }
        }

        set({ reviewRequestedPrs: reviewPrs, allOpenPrs: otherPrs });

        // Fetch PRs needing fixes (background, non-blocking for initial render)
        const repoNames = repos.map((r) => r.full_name);
        fetchPrsNeedingFixes(repoNames)
          .then((fixPrs) => set({ fixPrs }))
          .catch(() => {});

        set({ lastFetchedAt: Date.now(), fetching: false });
      } catch (e) {
        console.error("Github data refresh failed:", e);
        set({ fetching: false });
      }
    };

    refreshPromise = doRefresh();
    try {
      await refreshPromise;
    } finally {
      refreshPromise = null;
    }
  },

  fetchPrComments: async (repo: string, prNumber: number) => {
    const key = `${repo}#${prNumber}`;
    const cached = get().prComments[key];
    if (cached) return cached;

    const comments = await fetchReviewComments(repo, prNumber);
    set((state) => ({
      prComments: { ...state.prComments, [key]: comments },
    }));
    return comments;
  },
}));

function parsePr(p: Record<string, unknown>, repo: string, isReviewRequested: boolean): PrWithRepo {
  return {
    number: p.number as number,
    title: p.title as string,
    url: p.url as string,
    state: p.state as string,
    headRefName: (p.headRefName as string) ?? "",
    baseRefName: (p.baseRefName as string) ?? "",
    additions: (p.additions as number) ?? 0,
    deletions: (p.deletions as number) ?? 0,
    changedFiles: (p.changedFiles as number) ?? 0,
    author: (p.author as { login: string }) ?? { login: "" },
    commits: (p.commits as { totalCount: number }) ?? { totalCount: 0 },
    repo,
    isReviewRequested,
  };
}
