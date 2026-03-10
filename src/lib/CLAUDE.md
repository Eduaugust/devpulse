# 📋 Lib — Utilities, Types, and Helpers

Shared code used across the frontend.

## 📁 Files

| File                | Purpose                                          |
| ------------------- | ------------------------------------------------ |
| `tauri.ts`          | Typed wrappers for all Tauri backend commands     |
| `credentials.ts`    | Credential store helpers (get, set, getStore)     |
| `types.ts`          | All shared TypeScript interfaces                  |
| `platform.ts`       | Platform detection + terminal option lists        |
| `utils.ts`          | `cn()` helper (clsx + tailwind-merge)             |
| `reviewRunner.ts`   | AI PR review execution (Claude CLI)               |
| `fixRunner.ts`      | PR fix workflow (find repo, checkout, build prompt)|
| `descriptionRunner.ts` | AI PR description generation                   |

## 🎯 Key Modules

### `tauri.ts` — Backend Command Wrappers

**Every** Tauri `invoke()` call must go through this file. It provides typed wrappers:

```typescript
export const getEvents = (filters: EventFilters) =>
  invoke<DevEvent[]>("get_events", { ...filters });

export const openClaudeTerminal = (opts: {
  cwd?: string | null;
  args?: string[] | null;
  initialPrompt?: string | null;
  terminal?: string | null;
}) => invoke<void>("open_claude_terminal", { ... });
```

When adding a new Rust command, always add a typed wrapper here.

### `credentials.ts` — Credential Storage

Wraps `@tauri-apps/plugin-store` for the `credentials.json` store:

```typescript
import { getCredential, setCredential, getCredentialStore } from "@/lib/credentials";

const token = await getCredential("kimai_token");       // Returns "" if not set
await setCredential("kimai_token", "abc123");            // Saves + persists
const store = await getCredentialStore();                // Bulk reads
```

**Never** import `load` from `@tauri-apps/plugin-store` directly in pages or stores.

### `types.ts` — Shared Interfaces

All shared types live here. Key types:

- `DevEvent` — Core event model (PR, review, notification, etc.)
- `ConnectionStatus` — Integration health (`connected | disconnected | checking`)
- `GhPr`, `GhNotification` — GitHub data models
- `KimaiTimesheet`, `CalendarEvent` — Integration data models
- `ReviewFinding`, `ReviewResult` — PR review types
- `SavedReport`, `SavedReview` — Persisted report/review types
- `BackgroundTask` — Async task tracking
- `CommandDef`, `CommandRun` — Custom command system
- `ClaudeSession`, `ClaudeStream*` — Claude CLI streaming types

### `platform.ts` — Platform Detection

Cached platform detection + terminal options per OS:

```typescript
import { getPlatform, getTerminalOptions } from "@/lib/platform";

const os = await getPlatform();  // "macos" | "windows" | "linux" (cached)
const terminals = getTerminalOptions(os);
// macOS: Terminal.app, iTerm2, Warp
// Windows: Windows Terminal, PowerShell
// Linux: GNOME Terminal, Konsole, Alacritty, xterm
```

### `reviewRunner.ts` — PR Review Engine

Executes AI code reviews via Claude CLI:

```typescript
import { runReview, postReview, parseMarkdownReview } from "@/lib/reviewRunner";

const result = await runReview("owner/repo", 42);
// result: { rawMarkdown, findings[], verdict, summary }

await postReview("owner/repo", 42, result.findings, result.rawMarkdown);
```

### `fixRunner.ts` — PR Fix Workflow

Finds local repo clones, checks out PR branches, builds fix prompts:

```typescript
import { findLocalRepo, checkoutPrBranch, buildFixPrompt } from "@/lib/fixRunner";

const local = await findLocalRepo("owner/repo", "feat/branch", "development");
if (local.needsCheckout) await checkoutPrBranch(local.path, "feat/branch");
const prompt = buildFixPrompt(repo, prNumber, branch, comments);
```

## ⚠️ Common Mistakes

- **Don't add `invoke()` calls in components** — Add a wrapper in `tauri.ts`
- **Don't define types locally in pages** — Add them to `types.ts`
- **Don't use `load("credentials.json")`** — Use `credentials.ts` helpers
- **Don't call `platform()` directly** — Use `getPlatform()` (cached)
