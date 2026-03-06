# 📋 DevPulse

Developer activity dashboard — GitHub monitoring, AI-powered PR reviews, and automated timesheets.

## 🏗️ Architecture

Tauri v2 desktop app with dual-window architecture:

| Layer    | Stack                                            |
| -------- | ------------------------------------------------ |
| Frontend | React 19, TypeScript 5.8, Vite 7, Tailwind CSS 4 |
| Backend  | Rust 2021, Tauri v2, Tokio, SQLite (rusqlite)    |
| State    | Zustand                                          |
| AI       | Claude CLI / Anthropic API                       |

```
src/                  → React frontend (pages, components, stores, hooks, lib)
src-tauri/src/        → Rust backend (commands, monitor, db, tray)
```

### Windows

- **Main** (`label: "main"`) — Full app with sidebar navigation, 900x600
- **Tray Panel** (`label: "tray-panel"`) — Compact overlay via system tray, 340x560

## 🔧 Commands

```bash
# Development
pnpm tauri dev              # Start app with hot-reload

# Type checking
npx tsc --noEmit            # Frontend
cargo check --manifest-path src-tauri/Cargo.toml  # Backend

# Production build
pnpm tauri build            # Outputs to src-tauri/target/release/bundle/
```

## 📁 Project Structure

```
devpulse/
├── src/                          # React frontend
│   ├── components/               # Reusable UI components
│   ├── pages/                    # Route pages (8 total)
│   ├── stores/                   # Zustand state stores (8 stores)
│   ├── hooks/                    # React hooks
│   ├── lib/                      # Utilities, types, Tauri wrappers
│   └── main.tsx                  # Entry point + routing
├── src-tauri/                    # Rust backend
│   ├── src/
│   │   ├── commands/             # Tauri command handlers (6 modules)
│   │   ├── lib.rs                # App setup + plugin initialization
│   │   ├── monitor.rs            # Background GitHub polling loop
│   │   ├── db.rs                 # SQLite schema + queries
│   │   ├── tray.rs               # System tray icon + menu
│   │   └── terminal.rs           # External terminal launcher
│   ├── capabilities/             # Tauri permission definitions
│   └── tauri.conf.json           # App metadata + window config
└── .github/workflows/release.yml # Cross-platform CI/CD
```

## 🎯 Key Patterns

### Tauri Command Invocation

All backend calls go through typed wrappers in `src/lib/tauri.ts`:

```typescript
// ✅ Always use the typed wrapper
import { getEvents } from "@/lib/tauri";
const events = await getEvents(filters);

// ❌ Never call invoke directly from components
import { invoke } from "@tauri-apps/api/core";
const events = await invoke("get_events", { filters });
```

### Credential Storage

All credentials go through `src/lib/credentials.ts`:

```typescript
// ✅ Use the shared helpers
import { getCredential, setCredential } from "@/lib/credentials";
const token = await getCredential("kimai_token");

// ❌ Never load the store directly
import { load } from "@tauri-apps/plugin-store";
const store = await load("credentials.json");
```

### Shared HTTP Client

Backend commands receive a shared `reqwest::Client` via Tauri state — never construct a new client inside a command:

```rust
// ✅ Use injected state
#[tauri::command]
async fn my_command(http: tauri::State<'_, HttpClient>) -> Result<String, String> {
    let resp = http.0.get(url).send().await;
}

// ❌ Never create a new client
let client = reqwest::Client::new();
```

### State Management

Zustand stores with direct `getState()` for non-reactive access:

```typescript
// Inside React components — use hooks
const { events } = useEventStore();

// Outside React (event listeners, callbacks)
useBackgroundTaskStore.getState().addTask(...);
```

## 🔗 Integration Overview

| Integration     | Backend Module       | Frontend Config Page | Auth Method           |
| --------------- | -------------------- | -------------------- | --------------------- |
| GitHub          | `commands/github.rs` | Connections          | `gh auth login` (CLI) |
| Kimai           | `commands/kimai.rs`  | Connections          | URL + API Token       |
| Google Calendar | `commands/calendar.rs`| Connections         | OAuth 2.0 JSON        |
| Claude AI       | `commands/claude.rs` | Connections          | CLI or API Key        |

## ⚠️ Common Mistakes

- **Don't bypass `lib/tauri.ts`** — All `invoke()` calls must go through typed wrappers
- **Don't bypass `lib/credentials.ts`** — Never use `load("credentials.json")` directly
- **Don't create `reqwest::Client` in commands** — Use `State<HttpClient>` or `State<KimaiHttpClient>`
- **Don't use `Co-Authored-By`** in git commits
- **Commit format**: `:gitmoji: type: description` (e.g., `:sparkles: feat: add new feature`)

## 📚 Related Documentation

- `src/CLAUDE.md` — Frontend architecture
- `src-tauri/CLAUDE.md` — Backend architecture
- `README.md` — Installation and configuration guides
