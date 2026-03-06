# 📋 Commands — Tauri Backend Handlers

All `#[tauri::command]` functions organized by integration.

## 📁 Modules

| Module      | Commands | Purpose                                     |
| ----------- | -------- | ------------------------------------------- |
| `github.rs` | 5        | GitHub CLI wrapper (PRs, reviews, notifications) |
| `kimai.rs`  | 3        | Kimai REST API (timesheets, connection test) |
| `calendar.rs`| 4       | Google Calendar OAuth + events               |
| `claude.rs` | 3        | Claude CLI + Anthropic API                   |
| `db.rs`     | 20+      | Database CRUD wrappers                       |
| `system.rs` | 2        | Command detection + test notification        |

## 🎯 Module Details

### `github.rs`

All GitHub operations go through `gh` CLI via `tauri-plugin-shell`:

```rust
check_gh_auth()          // Verify gh is authenticated
fetch_my_prs(repo)       // PRs authored by current user
fetch_my_reviews(repo)   // PRs where review is requested
fetch_notifications()    // GitHub notification inbox
post_gh_review(...)      // Post review comments to a PR
```

Shared helper: `fetch_pr_list(app, repo, extra_args)` — used by both `fetch_my_prs` and `fetch_my_reviews`.

### `kimai.rs`

Uses `State<KimaiHttpClient>` (no-redirect policy):

```rust
test_kimai_connection(url, token)           // Health check
fetch_kimai_timesheets(url, token, begin, end)  // Get entries
ensure_kimai_mcp(url, token)                // Configure Kimai MCP for Claude
```

### `calendar.rs`

Supports both **OAuth 2.0** (user consent) and **Service Account** flows:

```rust
test_calendar_connection(creds)     // Detect credential type + test
authorize_calendar(creds)           // OAuth flow — opens browser
cancel_calendar_auth()              // Cancel pending OAuth
fetch_calendar_events(creds, start, end)  // Get events
```

Internal helpers receive `&reqwest::Client` since they can't access Tauri state directly:
- `test_authorized_user(client, creds)`
- `test_service_account(client, creds)`
- `refresh_access_token(client, creds)`

### `claude.rs`

Uses `State<HttpClient>`:

```rust
test_claude_connection(key)         // Verify API key
generate_with_ai(key, prompt)       // Call Claude API (sonnet-4-6)
run_claude_cli(prompt)              // Execute claude CLI
```

### `db.rs`

Thin wrappers over `Database` methods. Pattern:

```rust
#[tauri::command]
fn get_events(db: tauri::State<'_, Database>, ...) -> Result<Vec<DevEvent>, String> {
    db.get_events(...).map_err(|e| e.to_string())
}
```

### `system.rs`

```rust
check_command_available(name)       // Uses `which` crate
send_test_notification()            // Fires a test desktop notification
```

## 🔧 Adding a New Command

1. Add function with `#[tauri::command]` in the appropriate module
2. If new module: add `pub mod name;` to `mod.rs`
3. Register in `lib.rs`: `commands::module::function_name`
4. If it calls external commands: add to `capabilities/default.json` shell permissions
5. Add typed wrapper in frontend `src/lib/tauri.ts`
