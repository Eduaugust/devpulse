import { create } from "zustand";
import { Command } from "@tauri-apps/plugin-shell";
import * as tauri from "@/lib/tauri";
import { fetchPrsNeedingFixes, fetchReviewComments } from "@/lib/reviewRunner";
import type { GhPr, PrDetail, PrWithReviewStatus, ReviewComment, MonitoredRepo } from "@/lib/types";

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
          if (repo.provider === "gitlab") {
            // GitLab: fetch MRs where user is reviewer
            try {
              const cmd = Command.create("glab", [
                "mr", "list", "-R", repo.full_name,
                "--reviewer=@me", "-F", "json",
              ]);
              const out = await cmd.execute();
              if (out.code === 0) {
                const parsed = JSON.parse(out.stdout) as Array<Record<string, unknown>>;
                for (const p of parsed) {
                  const pr = parseGitlabMr(p, repo.full_name, true);
                  reviewSet.add(`${repo.full_name}#${pr.number}`);
                  reviewPrs.push(pr);
                }
              }
            } catch { /* skip */ }

            // GitLab: fetch all open MRs
            try {
              const cmd = Command.create("glab", [
                "mr", "list", "-R", repo.full_name, "-F", "json",
              ]);
              const out = await cmd.execute();
              if (out.code === 0) {
                const parsed = JSON.parse(out.stdout) as Array<Record<string, unknown>>;
                for (const p of parsed) {
                  const pr = parseGitlabMr(p, repo.full_name, false);
                  if (!reviewSet.has(`${repo.full_name}#${pr.number}`)) {
                    otherPrs.push(pr);
                  }
                }
              }
            } catch { /* skip */ }
          } else if (repo.provider === "azure") {
            // Azure DevOps: fetch review-requested PRs
            try {
              const parts = repo.full_name.split("/");
              const project = parts.slice(0, -1).join("/");
              const repoName = parts[parts.length - 1];
              const cmd = Command.create("az", [
                "repos", "pr", "list",
                "--repository", repoName,
                "--project", project,
                "--reviewer", "",
                "--status", "active",
                "-o", "json",
              ]);
              const out = await cmd.execute();
              if (out.code === 0) {
                const parsed = JSON.parse(out.stdout) as Array<Record<string, unknown>>;
                for (const p of parsed) {
                  const pr = parseAzurePr(p, repo.full_name, true);
                  reviewSet.add(`${repo.full_name}#${pr.number}`);
                  reviewPrs.push(pr);
                }
              }
            } catch { /* skip */ }

            // Azure DevOps: fetch all active PRs
            try {
              const parts = repo.full_name.split("/");
              const project = parts.slice(0, -1).join("/");
              const repoName = parts[parts.length - 1];
              const cmd = Command.create("az", [
                "repos", "pr", "list",
                "--repository", repoName,
                "--project", project,
                "--status", "active",
                "-o", "json",
              ]);
              const out = await cmd.execute();
              if (out.code === 0) {
                const parsed = JSON.parse(out.stdout) as Array<Record<string, unknown>>;
                for (const p of parsed) {
                  const pr = parseAzurePr(p, repo.full_name, false);
                  if (!reviewSet.has(`${repo.full_name}#${pr.number}`)) {
                    otherPrs.push(pr);
                  }
                }
              }
            } catch { /* skip */ }
          } else if (repo.provider === "bitbucket") {
            // Bitbucket: fetch open PRs via REST API
            try {
              const { getCredential } = await import("@/lib/credentials");
              const bbUser = await getCredential("bb_username");
              const bbPass = await getCredential("bb_app_password");
              if (bbUser && bbPass) {
                const parts = repo.full_name.split("/");
                const prs = await tauri.fetchBbPrs(bbUser, bbPass, parts[0], parts[1]);
                for (const p of prs) {
                  const pr = parseBitbucketPr(p, repo.full_name, false);
                  otherPrs.push(pr);
                }
              }
            } catch { /* skip */ }
          } else {
            // GitHub: fetch review-requested PRs
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

            // GitHub: fetch all open PRs
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

function parseAzurePr(p: Record<string, unknown>, repo: string, isReviewRequested: boolean): PrWithRepo {
  const createdBy = p.createdBy as Record<string, unknown> | undefined;
  const repository = p.repository as Record<string, unknown> | undefined;
  const prId = (p.pullRequestId as number) ?? 0;
  const webUrl = (repository?.webUrl as string) ?? "";
  return {
    number: prId,
    title: (p.title as string) ?? "",
    url: webUrl ? `${webUrl}/pullrequest/${prId}` : "",
    state: (p.status as string) ?? "",
    headRefName: ((p.sourceRefName as string) ?? "").replace("refs/heads/", ""),
    baseRefName: ((p.targetRefName as string) ?? "").replace("refs/heads/", ""),
    additions: 0,
    deletions: 0,
    changedFiles: 0,
    author: { login: (createdBy?.displayName as string) ?? (createdBy?.uniqueName as string) ?? "" },
    commits: { totalCount: 0 },
    repo,
    isReviewRequested,
  };
}

function parseGitlabMr(p: Record<string, unknown>, repo: string, isReviewRequested: boolean): PrWithRepo {
  const author = p.author as Record<string, unknown> | undefined;
  return {
    number: (p.iid as number) ?? 0,
    title: (p.title as string) ?? "",
    url: (p.web_url as string) ?? "",
    state: (p.state as string) ?? "",
    headRefName: (p.source_branch as string) ?? "",
    baseRefName: (p.target_branch as string) ?? "",
    additions: 0,
    deletions: 0,
    changedFiles: 0,
    author: { login: (author?.username as string) ?? "" },
    commits: { totalCount: 0 },
    repo,
    isReviewRequested,
  };
}

function parseBitbucketPr(p: GhPr, repo: string, isReviewRequested: boolean): PrWithRepo {
  // State format from Rust: "STATE|source_branch|author"
  const parts = p.state.split("|");
  const state = parts[0] ?? "";
  const sourceBranch = parts[1] ?? "";
  const author = parts[2] ?? "";
  return {
    number: p.number,
    title: p.title,
    url: p.url,
    state,
    headRefName: sourceBranch,
    baseRefName: "",
    additions: 0,
    deletions: 0,
    changedFiles: 0,
    author: { login: author },
    commits: { totalCount: 0 },
    repo,
    isReviewRequested,
  };
}
