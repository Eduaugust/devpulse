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

        // Fetch all repos in parallel — each returns { review, other } PRs
        const repoResults = await Promise.all(repos.map(async (repo) => {
          const review: PrWithRepo[] = [];
          const other: PrWithRepo[] = [];
          const localReviewSet = new Set<string>();

          if (repo.provider === "gitlab") {
            const [reviewOut, allOut] = await Promise.all([
              Command.create("glab", ["mr", "list", "-R", repo.full_name, "--reviewer=@me", "-F", "json"]).execute().catch(() => null),
              Command.create("glab", ["mr", "list", "-R", repo.full_name, "-F", "json"]).execute().catch(() => null),
            ]);
            if (reviewOut?.code === 0) {
              try {
                for (const p of JSON.parse(reviewOut.stdout) as Array<Record<string, unknown>>) {
                  const pr = parseGitlabMr(p, repo.full_name, true);
                  localReviewSet.add(`${repo.full_name}#${pr.number}`);
                  review.push(pr);
                }
              } catch { /* parse error */ }
            }
            if (allOut?.code === 0) {
              try {
                for (const p of JSON.parse(allOut.stdout) as Array<Record<string, unknown>>) {
                  const pr = parseGitlabMr(p, repo.full_name, false);
                  if (!localReviewSet.has(`${repo.full_name}#${pr.number}`)) other.push(pr);
                }
              } catch { /* parse error */ }
            }
          } else if (repo.provider === "azure") {
            const parts = repo.full_name.split("/");
            const project = parts.slice(0, -1).join("/");
            const repoName = parts[parts.length - 1];
            const baseArgs = ["repos", "pr", "list", "--repository", repoName, "--project", project, "--status", "active", "-o", "json"];
            const [reviewOut, allOut] = await Promise.all([
              Command.create("az", [...baseArgs, "--reviewer", ""]).execute().catch(() => null),
              Command.create("az", baseArgs).execute().catch(() => null),
            ]);
            if (reviewOut?.code === 0) {
              try {
                for (const p of JSON.parse(reviewOut.stdout) as Array<Record<string, unknown>>) {
                  const pr = parseAzurePr(p, repo.full_name, true);
                  localReviewSet.add(`${repo.full_name}#${pr.number}`);
                  review.push(pr);
                }
              } catch { /* parse error */ }
            }
            if (allOut?.code === 0) {
              try {
                for (const p of JSON.parse(allOut.stdout) as Array<Record<string, unknown>>) {
                  const pr = parseAzurePr(p, repo.full_name, false);
                  if (!localReviewSet.has(`${repo.full_name}#${pr.number}`)) other.push(pr);
                }
              } catch { /* parse error */ }
            }
          } else if (repo.provider === "bitbucket") {
            try {
              const { getCredential } = await import("@/lib/credentials");
              const [bbUser, bbPass] = await Promise.all([getCredential("bb_username"), getCredential("bb_app_password")]);
              if (bbUser && bbPass) {
                const parts = repo.full_name.split("/");
                const prs = await tauri.fetchBbPrs(bbUser, bbPass, parts[0], parts[1]);
                for (const p of prs) other.push(parseBitbucketPr(p, repo.full_name, false));
              }
            } catch { /* skip */ }
          } else {
            // GitHub: fetch both in parallel
            const ghFields = "number,title,url,state,headRefName,baseRefName,additions,deletions,changedFiles,author,commits";
            const [reviewOut, allOut] = await Promise.all([
              Command.create("gh", ["pr", "list", "--repo", repo.full_name, "--search", "review-requested:@me", "--json", ghFields, "--limit", "10"]).execute().catch(() => null),
              Command.create("gh", ["pr", "list", "--repo", repo.full_name, "--json", ghFields, "--limit", "20"]).execute().catch(() => null),
            ]);
            if (reviewOut?.code === 0) {
              try {
                for (const p of JSON.parse(reviewOut.stdout) as Array<Record<string, unknown>>) {
                  localReviewSet.add(`${repo.full_name}#${p.number}`);
                  review.push(parsePr(p, repo.full_name, true));
                }
              } catch { /* parse error */ }
            }
            if (allOut?.code === 0) {
              try {
                for (const p of JSON.parse(allOut.stdout) as Array<Record<string, unknown>>) {
                  if (!localReviewSet.has(`${repo.full_name}#${p.number}`)) other.push(parsePr(p, repo.full_name, false));
                }
              } catch { /* parse error */ }
            }
          }

          return { review, other };
        }));

        const reviewPrs = repoResults.flatMap(r => r.review);
        const otherPrs = repoResults.flatMap(r => r.other);
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
