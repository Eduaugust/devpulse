# 📋 Stores — Zustand State Management

All application state lives in Zustand stores. Each store is a single `create<T>()` call with actions co-located.

## 📁 Stores

| Store                  | Purpose                                    |
| ---------------------- | ------------------------------------------ |
| `eventStore`           | DevEvents from the monitor (CRUD + fetch)  |
| `settingsStore`        | App settings (key-value from SQLite)       |
| `connectionStore`      | Integration connection status + check fns  |
| `githubDataStore`      | Cached GitHub PRs, reviews, notifications  |
| `prReviewStore`        | PR review workflow state                   |
| `reportStore`          | Report generation state                    |
| `backgroundTaskStore`  | Async background task tracking             |
| `commandStore`         | Custom command definitions + runs          |

## 🎯 Patterns

### Reactive (inside React)

```typescript
function MyComponent() {
  const { events, fetchRecentEvents } = useEventStore();
  // ...
}
```

### Non-reactive (outside React)

Use `getState()` for event listeners, callbacks, or other non-component code:

```typescript
// In useMonitorListener hook
useBackgroundTaskStore.getState().addTask("pr-review", label, metadata);
useGithubDataStore.getState().refresh();
```

### Settings Store

Settings are key-value strings. Use `getSetting` with a fallback:

```typescript
const { getSetting, updateSetting } = useSettingsStore();
const interval = getSetting("polling_interval", "60");
await updateSetting("polling_interval", "120");
```

### Connection Store

Each integration has a `check*` function that updates its own status:

```typescript
const { github, checkGitHub } = useConnectionStore();
// github.status: "connected" | "disconnected" | "checking"
// github.message?: string
await checkGitHub(); // Tests and updates status
```

### Background Task Store

Tracks async operations (reviews, report generation, etc.):

```typescript
const { addTask, updateTask } = useBackgroundTaskStore.getState();
const taskId = addTask("pr-review", `Review PR #${prNumber}`, { repo, prNumber });
// ... async work ...
updateTask(taskId, { status: "completed", result: "3 findings", finishedAt: Date.now() });
```

## ⚠️ Common Mistakes

- **Don't create new stores for page-local state** — Use `useState` for UI state
- **Don't call hooks outside React** — Use `store.getState()` pattern instead
- **Don't forget the fallback** in `getSetting(key, fallback)`
