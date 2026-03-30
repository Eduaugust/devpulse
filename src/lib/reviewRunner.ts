import { Command } from "@tauri-apps/plugin-shell";
import { getCommandBySlug, runClaudeCli, postGhReview } from "./tauri";
import type { ReviewResult, ReviewFinding, ReviewComment } from "./types";

// ── Parse markdown review output into structured findings ──

export function parseMarkdownReview(markdown: string): ReviewResult {
  const findings: ReviewFinding[] = [];

  // Extract verdict
  let verdict: ReviewResult["verdict"] = "comment";
  const statusMatch = markdown.match(
    /\*\*Status\*\*:\s*(.*)/i,
  );
  if (statusMatch) {
    const status = statusMatch[1].toLowerCase();
    if (status.includes("ready to merge") || status.includes("✅"))
      verdict = "approve";
    else if (status.includes("major revision") || status.includes("🔴"))
      verdict = "request_changes";
    else if (status.includes("needs changes") || status.includes("⚠️"))
      verdict = "request_changes";
  }

  // Extract summary
  let summary = "";
  const summaryMatch = markdown.match(
    /\*\*Summary\*\*:\s*(.*)/i,
  );
  if (summaryMatch) {
    summary = summaryMatch[1].trim();
  }

  // Parse sections: Critical Issues, Warnings, Suggestions, Positive Highlights
  const sectionPatterns: { regex: RegExp; category: ReviewFinding["category"] }[] = [
    { regex: /## 🔴 Critical Issues([\s\S]*?)(?=\n---|\n## )/i, category: "critical" },
    { regex: /## ⚠️ Warnings([\s\S]*?)(?=\n---|\n## )/i, category: "warning" },
    { regex: /## 💡 Suggestions([\s\S]*?)(?=\n---|\n## )/i, category: "suggestion" },
    { regex: /## ✨ Positive Highlights([\s\S]*?)(?=\n---|\n## )/i, category: "positive" },
  ];

  for (const { regex, category } of sectionPatterns) {
    const sectionMatch = markdown.match(regex);
    if (!sectionMatch) continue;
    const sectionText = sectionMatch[1];

    if (category === "positive") {
      // Positive highlights are bullet items: - ✅ ...
      const bullets = sectionText.match(/- ✅\s+(.+)/g);
      if (bullets) {
        for (const bullet of bullets) {
          const text = bullet.replace(/^- ✅\s+/, "").trim();
          const fileMatch = text.match(/`([^`]+\.\w+(?::\d+)?)`/);
          findings.push({
            category: "positive",
            file: fileMatch ? fileMatch[1].split(":")[0] : "",
            line: fileMatch ? parseInt(fileMatch[1].split(":")[1]) || 0 : 0,
            title: text.replace(/`[^`]+`/g, "").trim(),
            description: text,
          });
        }
      }
      continue;
    }

    // Parse ### numbered items
    const itemRegex = /### \d+\.\s+(.+)([\s\S]*?)(?=### \d+\.|$)/g;
    let itemMatch;
    while ((itemMatch = itemRegex.exec(sectionText)) !== null) {
      const title = itemMatch[1].trim();
      const body = itemMatch[2];

      const fileMatch = body.match(/\*\*File\*\*:\s*`([^`]+)`/);
      const descMatch = body.match(/\*\*Description\*\*:\s*(.*)/);
      const recMatch = body.match(/\*\*Recommendation\*\*:\s*([\s\S]*?)(?=\n- \*\*|\n###|$)/);
      const impactMatch = body.match(/\*\*Impact\*\*:\s*(.*)/);
      const benefitMatch = body.match(/\*\*Benefit\*\*:\s*(.*)/);

      let filePath = "";
      let line = 0;
      if (fileMatch) {
        const parts = fileMatch[1].split(":");
        filePath = parts[0];
        line = parseInt(parts[1]) || 0;
      }

      findings.push({
        category,
        file: filePath,
        line,
        title,
        description:
          descMatch?.[1]?.trim() ||
          impactMatch?.[1]?.trim() ||
          benefitMatch?.[1]?.trim() ||
          "",
        suggestion: recMatch?.[1]?.trim(),
      });
    }
  }

  return { rawMarkdown: markdown, findings, verdict, summary };
}

// ── Run a PR review via Claude CLI ──

export async function runReview(
  repo: string,
  prNumber: number,
  onPhase?: (phase: string) => void,
): Promise<ReviewResult> {
  // 1. Fetch diff
  onPhase?.("Fetching diff...");
  const diffCmd = Command.create("gh", [
    "pr", "diff", "--repo", repo, String(prNumber),
  ]);
  const diffOut = await diffCmd.execute();
  if (diffOut.code !== 0) {
    throw new Error("Failed to fetch diff: " + diffOut.stderr);
  }
  const diff = diffOut.stdout;

  // 2. Load review template + post-review style guide
  onPhase?.("Sending to Claude...");
  let promptTemplate = "You are a senior code reviewer. Analyze the following pull request diff. Produce a detailed markdown review with sections: Critical Issues, Warnings, Suggestions, Positive Highlights, and a Final Recommendation.\n\nDiff:\n{{diff}}";
  let postStyleGuide = "";
  try {
    const cmd = await getCommandBySlug("pr-review");
    if (cmd?.prompt_template) {
      promptTemplate = cmd.prompt_template;
    }
    const postCmd = await getCommandBySlug("post-review");
    if (postCmd?.prompt_template) {
      postStyleGuide = postCmd.prompt_template;
    }
  } catch {
    // use fallback
  }

  let prompt = promptTemplate.replace(/\{\{diff\}\}/g, diff);
  if (postStyleGuide) {
    prompt += "\n\n---\n\n" + postStyleGuide;
  }

  // 3. Run Claude via Rust command (properly unsets CLAUDECODE env var)
  const rawMarkdown = await runClaudeCli(prompt);

  // 4. Parse markdown output
  onPhase?.("Parsing results...");
  return parseMarkdownReview(rawMarkdown.trim());
}

// ── Post a review to GitHub (Enlite-style) ──

export interface PostReviewResult {
  commentCount: number;
  prUrl: string;
  filesWithComments: string[];
  apiResponse: string;
}

export async function postReview(
  repo: string,
  prNumber: number,
  findings: ReviewFinding[],
  rawMarkdown?: string,
  onPhase?: (phase: string) => void,
): Promise<PostReviewResult> {
  // 1. Get commit SHA
  onPhase?.("Getting commit SHA...");
  const shaCmd = Command.create("gh", [
    "pr", "view", "--repo", repo, String(prNumber),
    "--json", "commits", "-q", ".commits[-1].oid",
  ]);
  const shaOut = await shaCmd.execute();
  if (shaOut.code !== 0) {
    throw new Error("Failed to get commit SHA: " + shaOut.stderr);
  }
  const commitSha = shaOut.stdout.trim();

  // 2. Get PR files for line validation
  onPhase?.("Validating line numbers...");
  const filesCmd = Command.create("gh", [
    "api", `repos/${repo}/pulls/${prNumber}/files`,
  ]);
  const filesOut = await filesCmd.execute();
  if (filesOut.code !== 0) {
    throw new Error("Failed to fetch PR files: " + filesOut.stderr);
  }
  const prFiles: Array<{ filename: string; patch?: string }> = JSON.parse(filesOut.stdout);
  const validFiles = new Set(prFiles.map((f) => f.filename));

  // 3. Build comments — only non-positive findings with valid file+line
  const comments: Array<{ path: string; line: number; body: string; side?: string }> = [];
  for (const f of findings) {
    if (f.category === "positive") continue;
    if (!f.file || f.line <= 0) continue;

    // Try exact match first, then try matching just the filename
    let matchedFile = f.file;
    if (!validFiles.has(matchedFile)) {
      const basename = matchedFile.split("/").pop() || "";
      const found = [...validFiles].find(
        (vf) => vf === matchedFile || vf.endsWith(`/${matchedFile}`) || vf.endsWith(`/${basename}`),
      );
      if (!found) continue;
      matchedFile = found;
    }

    // Build short, imperative-mood comment body (Enlite style)
    let body = f.description || f.title;
    if (f.suggestion) {
      body += `\n\n${f.suggestion}`;
    }
    // Keep it concise — strip markdown headers
    body = body.replace(/^#+\s+/gm, "").trim();

    comments.push({
      path: matchedFile,
      line: f.line,
      body,
    });
  }

  // 4. Submit review — if we have inline comments, attach them; otherwise post the full review as body
  const prUrl = `https://github.com/${repo}/pull/${prNumber}`;

  if (comments.length > 0) {
    onPhase?.(`Posting ${comments.length} inline comments...`);
    const payload = JSON.stringify({
      commit_id: commitSha,
      body: "",
      comments: comments.map((c) => ({
        path: c.path,
        line: c.line,
        body: c.body,
        ...(c.side ? { side: c.side } : {}),
      })),
    });

    await postGhReview(repo, prNumber, payload);

    return {
      commentCount: comments.length,
      prUrl,
      filesWithComments: [...new Set(comments.map((c) => c.path))],
      apiResponse: "Review posted with inline comments",
    };
  }

  // No inline comments could be mapped — post full review as body comment
  onPhase?.("Posting review as body comment...");
  const bodyMarkdown = rawMarkdown || findings
    .filter((f) => f.category !== "positive")
    .map((f) => `**${f.title}**${f.file ? ` (${f.file}${f.line > 0 ? `:${f.line}` : ""})` : ""}\n${f.description}${f.suggestion ? `\n\n> ${f.suggestion}` : ""}`)
    .join("\n\n---\n\n");

  const payload = JSON.stringify({
    commit_id: commitSha,
    body: bodyMarkdown,
    comments: [],
  });

  await postGhReview(repo, prNumber, payload);

  return {
    commentCount: 1,
    prUrl,
    filesWithComments: [],
    apiResponse: "Review posted as body comment (no inline comments could be mapped)",
  };
}

// ── Fetch review comments for a PR (only unresolved threads) ──

export async function fetchReviewComments(
  repo: string,
  prNumber: number,
): Promise<ReviewComment[]> {
  const [owner, name] = repo.split("/");
  const comments: ReviewComment[] = [];
  let cursor: string | null = null;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const afterClause = cursor ? `, after: "${cursor}"` : "";
    // Keep query on a single line — multiline strings can break in Tauri shell args
    const query = `{ repository(owner: "${owner}", name: "${name}") { pullRequest(number: ${prNumber}) { reviewThreads(first: 100${afterClause}) { pageInfo { hasNextPage endCursor } nodes { isResolved comments(first: 1) { nodes { databaseId path originalLine body author { login } createdAt diffHunk } } } } } } }`;

    const cmd = Command.create("gh", [
      "api", "graphql",
      "-f", `query=${query}`,
    ]);
    const out = await cmd.execute();
    if (out.code !== 0) {
      throw new Error("Failed to fetch review comments: " + out.stderr);
    }

    const data = JSON.parse(out.stdout);
    const threads = data?.data?.repository?.pullRequest?.reviewThreads;
    if (!threads) break;

    for (const thread of threads.nodes) {
      if (thread.isResolved) continue; // skip resolved
      const c = thread.comments.nodes[0];
      if (!c) continue;
      comments.push({
        id: c.databaseId,
        path: c.path ?? "",
        line: c.originalLine ?? null,
        body: c.body ?? "",
        user: { login: c.author?.login ?? "" },
        created_at: c.createdAt ?? "",
        diff_hunk: c.diffHunk ?? "",
        isResolved: false,
      });
    }

    if (threads.pageInfo.hasNextPage) {
      cursor = threads.pageInfo.endCursor;
    } else {
      break;
    }
  }

  return comments;
}

// ── Fetch PRs authored by current user with changes_requested reviews ──

export async function fetchPrsNeedingFixes(
  repos: string[],
): Promise<Array<{ repo: string; number: number; title: string; url: string; headRefName: string; author: { login: string }; commentCount: number }>> {
  const results: Array<{ repo: string; number: number; title: string; url: string; headRefName: string; author: { login: string }; commentCount: number }> = [];

  const seen = new Set<string>();

  for (const repo of repos) {
    // Search for both changes_requested and commented reviews
    const searches = ["review:changes_requested", "review:commented"];
    for (const search of searches) {
      try {
        const cmd = Command.create("gh", [
          "pr", "list",
          "--repo", repo,
          "--author", "@me",
          "--search", search,
          "--json", "number,title,url,headRefName,author,reviewDecision",
          "--limit", "20",
        ]);
        const out = await cmd.execute();
        if (out.code !== 0) continue;

        const prs = JSON.parse(out.stdout) as Array<Record<string, unknown>>;
        for (const pr of prs) {
          const key = `${repo}#${pr.number}`;
          if (seen.has(key)) continue;
          seen.add(key);

          // Count only unresolved review comments
          let commentCount = 0;
          try {
            const comments = await fetchReviewComments(repo, pr.number as number);
            commentCount = comments.length;
          } catch { /* non-critical */ }

          results.push({
            repo,
            number: pr.number as number,
            title: pr.title as string,
            url: pr.url as string,
            headRefName: (pr.headRefName as string) ?? "",
            author: { login: ((pr.author as Record<string, unknown>)?.login as string) ?? "" },
            commentCount,
          });
        }
      } catch {
        // skip repos that fail
      }
    }
  }

  return results.filter((pr) => pr.commentCount > 0);
}

// ── Generate a fix suggestion for a review comment ──

export async function generateFix(
  repo: string,
  prNumber: number,
  comment: ReviewComment,
): Promise<string> {
  // Fetch the file content at the PR head for context
  let fileContext = "";
  try {
    const headCmd = Command.create("gh", [
      "pr", "view", "--repo", repo, String(prNumber),
      "--json", "headRefName", "-q", ".headRefName",
    ]);
    const headOut = await headCmd.execute();
    if (headOut.code === 0) {
      const branch = headOut.stdout.trim();
      const fileCmd = Command.create("gh", [
        "api", `repos/${repo}/contents/${comment.path}?ref=${branch}`,
        "-q", ".content",
      ]);
      const fileOut = await fileCmd.execute();
      if (fileOut.code === 0) {
        const b64 = fileOut.stdout.trim().replace(/\n/g, "");
        fileContext = atob(b64);
        // Limit context to ~200 lines around the comment line
        if (comment.line && fileContext) {
          const lines = fileContext.split("\n");
          const start = Math.max(0, comment.line - 50);
          const end = Math.min(lines.length, comment.line + 50);
          fileContext = lines.slice(start, end).join("\n");
        }
      }
    }
  } catch {
    // continue without file context
  }

  const prompt = `You are a senior developer fixing code based on a review comment. Generate ONLY the fixed code snippet — no explanation, no markdown fences, just the corrected code that addresses the reviewer's feedback.

File: ${comment.path}${comment.line ? `:${comment.line}` : ""}
Reviewer: ${comment.user.login}

Review Comment:
${comment.body}

Diff Hunk (context around the commented code):
${comment.diff_hunk}

${fileContext ? `File Content (surrounding lines):\n${fileContext}` : ""}

Produce the corrected code snippet that addresses the review comment. Output ONLY the fixed code.`;

  return await runClaudeCli(prompt);
}
