# 📋 Backend — Rust + Tauri v2

## 🏗️ Architecture

```
src-tauri/src/
├── main.rs         # Entry point — calls lib::run()
├── lib.rs          # App setup: plugins, state, tray, invoke_handler
├── db.rs           # SQLite schema, migrations, CRUD methods
├── monitor.rs      # Background GitHub polling loop
├── tray.rs         # System tray icon + menu + panel toggle
├── terminal.rs     # External terminal launcher (macOS/Windows/Linux)
└── commands/       # Tauri command handlers
    ├── mod.rs      # Module declarations
    ├── github.rs   # GitHub CLI (gh) integration
    ├── kimai.rs    # Kimai REST API
    ├── calendar.rs # Google Calendar OAuth 2.0
    ├── claude.rs   # Claude CLI + Anthropic API
    ├── db.rs       # Database wrapper commands (20 commands)
    └── system.rs   # System utilities (command detection, notifications)
```

## 🎯 Key Patterns

### Shared HTTP Client

Two shared clients managed via Tauri state in `lib.rs`:

```rust
pub struct HttpClient(pub reqwest::Client);       // General use
pub struct KimaiHttpClient(pub reqwest::Client);  // No-redirect policy for Kimai

// In commands:
#[tauri::command]
async fn my_command(http: tauri::State<'_, HttpClient>) -> Result<..., String> {
    http.0.get(url).send().await...
}
```

**Never** construct `reqwest::Client::new()` inside a command.

### Database Access

`Database` is managed as Tauri state. Commands receive it via `State<Database>`:

```rust
#[tauri::command]
fn get_events(db: tauri::State<'_, Database>, filters: EventFilters) -> Result<Vec<DevEvent>, String> {
    db.get_events(filters).map_err(|e| e.to_string())
}
```

The `conn` field is private — all access through `Database` methods.

### Settings Helper

`monitor.rs` uses `get_setting_or` helper to avoid repetitive `.ok().flatten().unwrap_or_else()`:

```rust
fn get_setting_or(db: &Database, key: &str, default: &str) -> String {
    db.get_setting(key).ok().flatten().unwrap_or_else(|| default.to_string())
}
```

### Monitor Structure

`poll_github` is decomposed into three sub-functions:

```rust
async fn poll_github(app: &AppHandle, db: &Database) {
    let repos = db.get_monitored_repos().unwrap_or_default();
    let mut new_events = poll_pr_events(app, db, &repos).await;
    new_events.extend(poll_notifications(app, db).await);
    dispatch_new_events(app, db, &new_events);
}
```

### Monitor Race Condition Guard

Uses `AtomicBool::compare_exchange` to prevent concurrent monitor starts:

```rust
static MONITOR_RUNNING: AtomicBool = AtomicBool::new(false);

if MONITOR_RUNNING.compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst).is_err() {
    return Err("Monitor already running".into());
}
```

### Error Handling

Commands return `Result<T, String>`. DB errors are logged, not silently ignored:

```rust
// ✅ Log errors
match db.insert_event(&event) {
    Ok(_) => {},
    Err(e) => log::warn!("Failed to insert event: {e}"),
}

// ❌ Don't swallow errors
db.insert_event(&event).is_ok();
```

## 🔧 Adding a New Command

1. Add the function in the appropriate `commands/*.rs` file
2. Add `pub use` in `commands/mod.rs` if it's a new module
3. Register in `invoke_handler!()` in `lib.rs`
4. Add typed wrapper in frontend `src/lib/tauri.ts`
5. Add shell permission in `capabilities/default.json` if it runs external commands

## 📦 Tauri Plugins

| Plugin                        | Purpose                    |
| ----------------------------- | -------------------------- |
| `tauri-plugin-opener`         | Open URLs/files            |
| `tauri-plugin-sql`            | SQLite database            |
| `tauri-plugin-store`          | Key-value credential store |
| `tauri-plugin-notification`   | Desktop notifications      |
| `tauri-plugin-shell`          | Execute gh, git, claude    |
| `tauri-plugin-dialog`         | File/folder picker dialogs |
| `tauri-plugin-autostart`      | Launch on system startup   |
| `tauri-plugin-os`             | Platform detection         |

## ⚠️ Common Mistakes

- **Don't create `reqwest::Client` in commands** — Use `State<HttpClient>`
- **Don't access `db.conn` directly** — It's private, use `Database` methods
- **Don't use `load()` + `store()` for atomics** — Use `compare_exchange`
- **Don't silently ignore DB errors** — Use `match` with `log::warn!`
- **Don't forget to register commands** in `lib.rs` `invoke_handler!()`
