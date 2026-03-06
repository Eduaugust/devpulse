import { Command } from "@tauri-apps/plugin-shell";
import { getCommandBySlug, runClaudeCli } from "./tauri";

export async function runDescription(
  repo: string,
  prNumber: number,
  onPhase?: (phase: string) => void,
): Promise<string> {
  // 1. Fetch PR details (branch names)
  onPhase?.("Fetching PR details...");
  const detailCmd = Command.create("gh", [
    "pr", "view", "--repo", repo, String(prNumber),
    "--json", "headRefName,baseRefName",
  ]);
  const detailOut = await detailCmd.execute();
  if (detailOut.code !== 0) {
    throw new Error("Failed to fetch PR details: " + detailOut.stderr);
  }
  const detail = JSON.parse(detailOut.stdout);
  const branch = detail.headRefName as string;
  const base = detail.baseRefName as string;

  // 2. Fetch diff
  onPhase?.("Fetching diff...");
  const diffCmd = Command.create("gh", [
    "pr", "diff", "--repo", repo, String(prNumber),
  ]);
  const diffOut = await diffCmd.execute();
  if (diffOut.code !== 0) {
    throw new Error("Failed to fetch diff: " + diffOut.stderr);
  }
  const diff = diffOut.stdout;

  // 3. Fetch commits
  onPhase?.("Fetching commits...");
  const commitsCmd = Command.create("gh", [
    "pr", "view", "--repo", repo, String(prNumber),
    "--json", "commits",
  ]);
  const commitsOut = await commitsCmd.execute();
  if (commitsOut.code !== 0) {
    throw new Error("Failed to fetch commits: " + commitsOut.stderr);
  }
  const commitsData = JSON.parse(commitsOut.stdout);
  const commits = (commitsData.commits as Array<{ oid: string; messageHeadline: string; messageBody: string }>)
    .map((c) => `- ${c.messageHeadline}`)
    .join("\n");

  // 4. Load pr-description template
  onPhase?.("Sending to Claude...");
  let promptTemplate = "Generate a pull request description for the following diff.\n\nDiff:\n{{diff}}";
  try {
    const cmd = await getCommandBySlug("pr-description");
    if (cmd?.prompt_template) {
      promptTemplate = cmd.prompt_template;
    }
  } catch {
    // use fallback
  }

  const prompt = promptTemplate
    .replace(/\{\{diff\}\}/g, diff)
    .replace(/\{\{commits\}\}/g, commits)
    .replace(/\{\{branch\}\}/g, branch)
    .replace(/\{\{base\}\}/g, base);

  // 5. Run Claude
  const rawMarkdown = await runClaudeCli(prompt);

  onPhase?.("Done");
  return rawMarkdown.trim();
}
