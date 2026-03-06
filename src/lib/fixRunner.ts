import { Command } from "@tauri-apps/plugin-shell";
import { basename } from "@tauri-apps/api/path";
import { getLocalRepos } from "@/lib/tauri";
import type { ReviewComment } from "@/lib/types";

export interface LocalRepoMatch {
  path: string;
  needsCheckout: boolean;
}

// Track which local repos are already in use by a fix session so we don't
// assign two concurrent fixes to the same clone.
const inUseRepoPaths = new Set<string>();

export function releaseLocalRepo(path: string) {
  inUseRepoPaths.delete(path);
}

export async function findLocalRepo(
  repoFullName: string,
  prBranch: string,
  _baseBranch: string,
): Promise<LocalRepoMatch | null> {
  const localRepos = await getLocalRepos();
  const repoName = repoFullName.split("/")[1];

  // Match "enlite", "enlite-1", "enlite-2", etc. — any clone of the same repo
  const nameRegex = new RegExp(`^${escapeRegex(repoName)}(-\\d+)?$`);
  const reposWithBasename = await Promise.all(
    localRepos.map(async (r) => ({ ...r, dirName: await basename(r.path) })),
  );
  const candidates = reposWithBasename.filter(
    (r) => nameRegex.test(r.name) || nameRegex.test(r.dirName),
  );

  // Priority 1: Already on the PR branch (and not in use by another fix)
  for (const repo of candidates) {
    if (inUseRepoPaths.has(repo.path)) continue;
    try {
      const cmd = Command.create("git", ["-C", repo.path, "rev-parse", "--abbrev-ref", "HEAD"]);
      const out = await cmd.execute();
      if (out.code === 0 && out.stdout.trim() === prBranch) {
        inUseRepoPaths.add(repo.path);
        return { path: repo.path, needsCheckout: false };
      }
    } catch {
      // skip
    }
  }

  // Priority 2: Clean working tree (and not in use)
  for (const repo of candidates) {
    if (inUseRepoPaths.has(repo.path)) continue;
    try {
      const cmd = Command.create("git", ["-C", repo.path, "status", "--porcelain"]);
      const out = await cmd.execute();
      if (out.code === 0 && out.stdout.trim() === "") {
        inUseRepoPaths.add(repo.path);
        return { path: repo.path, needsCheckout: true };
      }
    } catch {
      // skip
    }
  }

  return null;
}

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function checkoutPrBranch(
  repoPath: string,
  prBranch: string,
): Promise<void> {
  // Fetch the branch from origin
  const fetchCmd = Command.create("git", ["-C", repoPath, "fetch", "origin", prBranch]);
  await fetchCmd.execute();

  // Try checkout, fallback to creating tracking branch
  const checkoutCmd = Command.create("git", ["-C", repoPath, "checkout", prBranch]);
  const checkoutOut = await checkoutCmd.execute();

  if (checkoutOut.code !== 0) {
    const createCmd = Command.create("git", [
      "-C", repoPath, "checkout", "-b", prBranch, `origin/${prBranch}`,
    ]);
    const createOut = await createCmd.execute();
    if (createOut.code !== 0) {
      throw new Error(`Failed to checkout branch ${prBranch}: ${createOut.stderr}`);
    }
  }

  // Pull latest (non-critical)
  const pullCmd = Command.create("git", ["-C", repoPath, "pull", "--ff-only"]);
  await pullCmd.execute().catch(() => {});
}

export function buildFixPrompt(
  repo: string,
  prNumber: number,
  prBranch: string,
  comments: ReviewComment[],
): string {
  const commentsList = comments
    .map(
      (c, i) =>
        `### Comment ${i + 1}\n- **File**: \`${c.path}${c.line ? `:${c.line}` : ""}\`\n- **Author**: ${c.user.login}\n- **Comment**: ${c.body}\n- **Diff context**:\n\`\`\`\n${c.diff_hunk}\n\`\`\``,
    )
    .join("\n\n");

  return `You are fixing review comments on PR #${prNumber} (branch: ${prBranch}) in the ${repo} repository.

## Review Comments to Fix

${commentsList}

## Instructions

1. Read each review comment carefully
2. Open and fix the relevant files based on the reviewer's feedback
3. Do NOT commit anything — only make file changes
4. After fixing all comments, create a file called \`.pr-fixes-log.md\` in the repository root documenting:
   - Each comment you addressed
   - What you changed and why
   - The file and line reference

Be thorough but conservative — only change what the reviewer asked for. Do not refactor or make unrelated changes.`;
}

export function buildLogContent(
  repo: string,
  prNumber: number,
  prBranch: string,
  comments: ReviewComment[],
): string {
  const now = new Date().toISOString().split("T")[0];
  const commentEntries = comments
    .map(
      (c, i) =>
        `### ${i + 1}. ${c.path}${c.line ? `:${c.line}` : ""}
- **Reviewer**: ${c.user.login}
- **Comment**: ${c.body}
- **Status**: Pending`,
    )
    .join("\n\n");

  return `# PR Fixes Log

- **Repository**: ${repo}
- **PR**: #${prNumber}
- **Branch**: ${prBranch}
- **Date**: ${now}

## Comments Addressed

${commentEntries}
`;
}
