import { Command } from "@tauri-apps/plugin-shell";
import { getCredential } from "./credentials";
import * as tauri from "./tauri";
import type { GitProvider } from "./types";

/** Returns the CLI command name for the given provider */
export function providerCli(provider: GitProvider): string {
  if (provider === "gitlab") return "glab";
  if (provider === "azure") return "az";
  if (provider === "bitbucket") return "bb-api"; // no CLI, uses HTTP via Rust
  return "gh";
}

/** Returns the PR/MR terminology for the given provider */
export function prLabel(provider: GitProvider): string {
  if (provider === "gitlab") return "MR";
  return "PR";
}

/** Returns the PR/MR prefix for titles (e.g. "#42" or "!42") */
export function prPrefix(provider: GitProvider): string {
  if (provider === "gitlab") return "!";
  return "#";
}

/** Detect current user login for the given provider */
export async function detectUsername(provider: GitProvider): Promise<string> {
  if (provider === "bitbucket") {
    // Bitbucket username is stored as a credential, not detectable via CLI
    return "";
  }
  if (provider === "gitlab") {
    const cmd = Command.create("glab", ["api", "/user", "--jq", ".username"]);
    const out = await cmd.execute();
    return out.code === 0 ? out.stdout.trim() : "";
  }
  if (provider === "azure") {
    // Azure CLI: get the signed-in user's display name
    const cmd = Command.create("az", [
      "account", "show", "--query", "user.name", "-o", "tsv",
    ]);
    const out = await cmd.execute();
    return out.code === 0 ? out.stdout.trim() : "";
  }
  const cmd = Command.create("gh", ["api", "/user", "--jq", ".login"]);
  const out = await cmd.execute();
  return out.code === 0 ? out.stdout.trim() : "";
}

/** Fetch list of repos the user has access to */
export async function fetchRepoList(provider: GitProvider, azureOrg?: string): Promise<string[]> {
  if (provider === "bitbucket") {
    const username = await getCredential("bb_username");
    const appPassword = await getCredential("bb_app_password");
    if (!username || !appPassword) return [];
    const workspace = (await getCredential("bb_workspace")) || username;
    try {
      return await tauri.fetchBbRepos(username, appPassword, workspace);
    } catch {
      return [];
    }
  }

  if (provider === "gitlab") {
    const cmd = Command.create("glab", [
      "api", "/projects?membership=true&per_page=100&order_by=last_activity_at",
      "--method", "GET",
    ]);
    const out = await cmd.execute();
    if (out.code !== 0 || !out.stdout.trim()) return [];
    try {
      const projects = JSON.parse(out.stdout) as Array<{ path_with_namespace: string }>;
      return projects.map((p) => p.path_with_namespace).sort();
    } catch {
      return [];
    }
  }

  if (provider === "azure") {
    // Azure: list all repos across all projects in the org
    const orgArgs = azureOrg ? ["--organization", azureOrg] : [];
    // First get projects
    const projCmd = Command.create("az", [
      "devops", "project", "list",
      ...orgArgs,
      "--query", "value[].name", "-o", "json",
    ]);
    const projOut = await projCmd.execute();
    if (projOut.code !== 0 || !projOut.stdout.trim()) return [];
    let projects: string[];
    try {
      projects = JSON.parse(projOut.stdout) as string[];
    } catch {
      return [];
    }

    const repos: string[] = [];
    for (const project of projects) {
      const repoCmd = Command.create("az", [
        "repos", "list",
        "--project", project,
        ...orgArgs,
        "--query", "[].name", "-o", "json",
      ]);
      const repoOut = await repoCmd.execute();
      if (repoOut.code === 0 && repoOut.stdout.trim()) {
        try {
          const names = JSON.parse(repoOut.stdout) as string[];
          repos.push(...names.map((n) => `${project}/${n}`));
        } catch { /* skip */ }
      }
    }
    return repos.sort();
  }

  // GitHub: list user repos + org repos
  const repos: string[] = [];
  const cmd = Command.create("gh", [
    "repo", "list", "--limit", "200",
    "--json", "nameWithOwner", "--jq", ".[].nameWithOwner",
  ]);
  const out = await cmd.execute();
  if (out.code === 0 && out.stdout.trim()) {
    repos.push(...out.stdout.trim().split("\n").filter(Boolean));
  }
  const orgCmd = Command.create("gh", [
    "api", "/user/orgs", "--jq", ".[].login",
  ]);
  const orgOut = await orgCmd.execute();
  if (orgOut.code === 0 && orgOut.stdout.trim()) {
    const orgs = orgOut.stdout.trim().split("\n").filter(Boolean);
    for (const org of orgs) {
      const orgRepoCmd = Command.create("gh", [
        "repo", "list", org, "--limit", "200",
        "--json", "nameWithOwner", "--jq", ".[].nameWithOwner",
      ]);
      const orgRepoOut = await orgRepoCmd.execute();
      if (orgRepoOut.code === 0 && orgRepoOut.stdout.trim()) {
        repos.push(...orgRepoOut.stdout.trim().split("\n").filter(Boolean));
      }
    }
  }
  return [...new Set(repos)].sort();
}

/** Get PR/MR diff for review */
export async function fetchPrDiff(
  provider: GitProvider,
  repo: string,
  prNumber: number,
): Promise<string> {
  if (provider === "bitbucket") {
    const username = await getCredential("bb_username");
    const appPassword = await getCredential("bb_app_password");
    if (!username || !appPassword) throw new Error("Bitbucket credentials not configured");
    const parts = repo.split("/");
    return await tauri.fetchBbPrDiff(username, appPassword, parts[0], parts[1], prNumber);
  }

  if (provider === "gitlab") {
    const encoded = repo.replace("/", "%2F");
    const cmd = Command.create("glab", [
      "api", `/projects/${encoded}/merge_requests/${prNumber}/changes`,
      "--method", "GET",
    ]);
    const out = await cmd.execute();
    if (out.code !== 0) throw new Error("Failed to get MR diff: " + out.stderr);
    const data = JSON.parse(out.stdout);
    const changes = data.changes as Array<{ old_path: string; new_path: string; diff: string }>;
    return changes.map((c) => c.diff).join("\n");
  }

  if (provider === "azure") {
    // Azure: use `az repos pr show` to get source/target refs, then use git diff
    const showCmd = Command.create("az", [
      "repos", "pr", "show",
      "--id", String(prNumber),
      "--query", "{source:sourceRefName,target:targetRefName}",
      "-o", "json",
    ]);
    const showOut = await showCmd.execute();
    if (showOut.code !== 0) throw new Error("Failed to get PR info: " + showOut.stderr);
    // Fallback: return a message since az CLI doesn't have a native diff command
    // The review runner will use the local git repo's diff instead
    return `[Azure DevOps PR #${prNumber} — use local git diff for review]`;
  }

  const cmd = Command.create("gh", [
    "pr", "diff", "--repo", repo, String(prNumber),
  ]);
  const out = await cmd.execute();
  if (out.code !== 0) throw new Error("Failed to get PR diff: " + out.stderr);
  return out.stdout;
}

/** Get PR/MR branch name */
export async function fetchPrBranch(
  provider: GitProvider,
  repo: string,
  prNumber: number,
): Promise<string> {
  if (provider === "bitbucket") {
    const username = await getCredential("bb_username");
    const appPassword = await getCredential("bb_app_password");
    if (!username || !appPassword) throw new Error("Bitbucket credentials not configured");
    const parts = repo.split("/");
    const prs = await tauri.fetchBbPrs(username, appPassword, parts[0], parts[1]);
    const pr = prs.find((p) => p.number === prNumber);
    if (!pr) throw new Error(`PR #${prNumber} not found`);
    // State format from Rust: "STATE|source_branch|author"
    const branch = pr.state.split("|")[1] ?? "";
    if (!branch) throw new Error("Could not determine PR branch");
    return branch;
  }

  if (provider === "gitlab") {
    const encoded = repo.replace("/", "%2F");
    const cmd = Command.create("glab", [
      "api", `/projects/${encoded}/merge_requests/${prNumber}`,
      "--method", "GET", "--jq", ".source_branch",
    ]);
    const out = await cmd.execute();
    if (out.code !== 0) throw new Error("Failed to get MR branch");
    return out.stdout.trim();
  }

  if (provider === "azure") {
    const cmd = Command.create("az", [
      "repos", "pr", "show",
      "--id", String(prNumber),
      "--query", "sourceRefName",
      "-o", "tsv",
    ]);
    const out = await cmd.execute();
    if (out.code !== 0) throw new Error("Failed to get PR branch");
    // Azure returns full ref like "refs/heads/feature/branch" — strip prefix
    return out.stdout.trim().replace("refs/heads/", "");
  }

  const cmd = Command.create("gh", [
    "pr", "view", "--repo", repo, String(prNumber),
    "--json", "headRefName", "--jq", ".headRefName",
  ]);
  const out = await cmd.execute();
  if (out.code !== 0) throw new Error("Failed to get PR branch");
  return out.stdout.trim();
}

/** Edit PR/MR description */
export async function editPrBody(
  provider: GitProvider,
  repo: string,
  prNumber: number,
  body: string,
): Promise<void> {
  if (provider === "bitbucket") {
    const username = await getCredential("bb_username");
    const appPassword = await getCredential("bb_app_password");
    if (!username || !appPassword) throw new Error("Bitbucket credentials not configured");
    const parts = repo.split("/");
    await tauri.editBbPrBody(username, appPassword, parts[0], parts[1], prNumber, body);
    return;
  }

  if (provider === "gitlab") {
    const cmd = Command.create("glab", [
      "mr", "update", "-R", repo, String(prNumber),
      "--description", body,
    ]);
    const out = await cmd.execute();
    if (out.code !== 0) throw new Error("Failed to update MR description: " + out.stderr);
    return;
  }

  if (provider === "azure") {
    const cmd = Command.create("az", [
      "repos", "pr", "update",
      "--id", String(prNumber),
      "--description", body,
      "-o", "json",
    ]);
    const out = await cmd.execute();
    if (out.code !== 0) throw new Error("Failed to update PR description: " + out.stderr);
    return;
  }

  const cmd = Command.create("gh", [
    "pr", "edit", "--repo", repo, String(prNumber),
    "--body", body,
  ]);
  const out = await cmd.execute();
  if (out.code !== 0) throw new Error("Failed to post description: " + out.stderr);
}
