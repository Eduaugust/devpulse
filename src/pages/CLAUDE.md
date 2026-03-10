# 📋 Pages

Route-level components — each corresponds to a sidebar navigation item.

## 📁 Pages

| Page              | Route          | Purpose                                              |
| ----------------- | -------------- | ---------------------------------------------------- |
| `Dashboard`       | `/`            | Activity overview with stats, event cards, filtering |
| `History`         | `/history`     | Searchable event history with type/repo filters      |
| `ClaudeCode`      | `/claude-code` | Claude terminal launcher with directory picker       |
| `PrReview`        | `/pr-review`   | AI-powered PR review with inline findings + fixes    |
| `Commands`        | `/commands`    | Custom command runner (Claude-powered workflows)     |
| `Connections`     | `/connections` | Integration setup (GitHub, Kimai, Calendar, Claude)  |
| `Settings`        | `/settings`    | App config, repos, notifications, automation toggles |
| `ReportGenerator` | `/reports`     | Daily report builder from Git/GitHub/Kimai/Calendar  |

## 🎯 Key Page Patterns

### Dashboard

- Connection status pills at the top (quick health check)
- Activity stats (PRs, reviews, notifications) with time period filter
- Event cards grouped by day

### PrReview

Most complex page. Three tabs:
1. **Review** — Select PR → run AI review → see findings by severity → post to GitHub
2. **Fix** — Review comments → generate fix suggestions → open Claude terminal
3. **History** — Saved reviews with search

Uses `usePrReviewStore` for review state and `lib/reviewRunner.ts` for AI execution.

### ReportGenerator

Multi-source data gathering:
1. Collects data from Git commits, GitHub PRs, Kimai timesheets, Calendar events
2. Builds a structured prompt
3. Sends to Claude CLI or API for report generation
4. Supports "Fill Timesheet" — opens Claude terminal to create Kimai entries

### Connections

Each integration card has:
- Status indicator (connected/disconnected/checking)
- Config inputs (URL, token, JSON, API key)
- Test button that saves credentials then runs the check

Credentials are managed via `lib/credentials.ts` — never use `load("credentials.json")` directly.

### Settings

Sections: General, Notifications, Automation, Sidebar, Local Repos, Monitored Repos.

All toggles use `ToggleSwitch` component. Automation toggles:
- Auto-Review PRs → triggers `monitor:auto-review` events
- Auto-Post Reviews → posts findings to GitHub
- Auto-Describe PRs → generates PR descriptions
- Auto-Fix PRs → opens Claude terminal with fix prompt

## ⚠️ Common Mistakes

- **Don't use `load("credentials.json")`** in pages — Use `getCredential()` from `lib/credentials.ts`
- **Don't use `invoke()` directly** — Use wrappers from `lib/tauri.ts`
- **Don't create inline toggle buttons** — Use `ToggleSwitch`
- **Types `SavedReport` and `SavedReview`** live in `lib/types.ts`, not locally in pages
