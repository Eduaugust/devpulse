use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::ShellExt;

use crate::commands::system::send_notification_with_app;

use crate::db::{Database, DevEvent};

/// Tracks repo/PR combos that have already been auto-reviewed this session.
static AUTO_REVIEWED: Mutex<Option<HashSet<String>>> = Mutex::new(None);

/// Tracks repo/PR combos that have already been auto-described this session.
static AUTO_DESCRIBED: Mutex<Option<HashSet<String>>> = Mutex::new(None);

/// Tracks repo/PR combos that have already been auto-fixed this session.
static AUTO_FIXED: Mutex<Option<HashSet<String>>> = Mutex::new(None);

/// Whether the one-time backfill of old "notification" events has run this session.
static BACKFILL_DONE: AtomicBool = AtomicBool::new(false);

/// Read a setting from DB, returning `default` if missing or on error.
fn get_setting_or(db: &Database, key: &str, default: &str) -> String {
    db.get_setting(key)
        .ok()
        .flatten()
        .unwrap_or_else(|| default.to_string())
}

/// Parse a PR number from a title containing "PR #123".
fn extract_pr_number_from_title(title: &str) -> Option<i64> {
    title
        .split("PR #")
        .nth(1)
        .and_then(|s| s.split(|c: char| !c.is_ascii_digit()).next())
        .and_then(|num_str| num_str.parse::<i64>().ok())
}

/// Convert GitHub API URLs to web URLs.
/// e.g. "https://api.github.com/repos/owner/repo/pulls/123" → "https://github.com/owner/repo/pull/123"
///      "https://api.github.com/repos/owner/repo/issues/45" → "https://github.com/owner/repo/issues/45"
fn api_url_to_web_url(api_url: &str) -> String {
    api_url
        .replace("https://api.github.com/repos/", "https://github.com/")
        .replace("/pulls/", "/pull/")
}

static MONITOR_RUNNING: AtomicBool = AtomicBool::new(false);

#[tauri::command]
pub async fn start_monitor(app: AppHandle) -> Result<(), String> {
    if MONITOR_RUNNING
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Ok(());
    }

    let app_clone = app.clone();
    tokio::spawn(async move {
        monitor_loop(app_clone).await;
    });

    Ok(())
}

#[tauri::command]
pub async fn stop_monitor() -> Result<(), String> {
    MONITOR_RUNNING.store(false, Ordering::SeqCst);
    Ok(())
}

#[tauri::command]
pub fn is_monitor_running() -> bool {
    MONITOR_RUNNING.load(Ordering::SeqCst)
}

async fn monitor_loop(app: AppHandle) {
    loop {
        if !MONITOR_RUNNING.load(Ordering::SeqCst) {
            break;
        }

        // Read polling interval from settings
        let interval_secs = {
            let db = app.state::<Database>();
            db.get_setting("polling_interval")
                .ok()
                .flatten()
                .and_then(|v| v.parse::<u64>().ok())
                .unwrap_or(300)
        };

        // One-time backfill of old generic "notification" events
        if !BACKFILL_DONE.load(Ordering::SeqCst) {
            BACKFILL_DONE.store(true, Ordering::SeqCst);
            if let Err(e) = backfill_notifications(&app).await {
                log::warn!("Backfill error: {}", e);
            }
        }

        // Poll GitHub data
        if let Err(e) = poll_github(&app).await {
            log::warn!("Monitor poll error: {}", e);
        }

        // Sleep for the interval
        tokio::time::sleep(tokio::time::Duration::from_secs(interval_secs)).await;
    }
}

async fn poll_github(app: &AppHandle) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let db = app.state::<Database>();
    let repos = db.get_monitored_repos().map_err(|e| e.to_string())?;

    let mut new_events = poll_pr_events(app, &db, &repos).await;
    new_events.extend(poll_notifications(app, &db).await);

    if !new_events.is_empty() {
        dispatch_new_events(app, &db, &new_events);
    }

    Ok(())
}

/// Fetch PR and review-request events for all monitored repos.
async fn poll_pr_events(
    app: &AppHandle,
    db: &Database,
    repos: &[crate::db::MonitoredRepo],
) -> Vec<DevEvent> {
    let mut events = Vec::new();

    for repo in repos {
        // Fetch PRs authored by user
        let pr_output = app
            .shell()
            .command("gh")
            .args([
                "pr", "list", "--repo", &repo.full_name,
                "--author", "@me",
                "--json", "number,title,url,state,createdAt,body",
                "--limit", "5",
            ])
            .output()
            .await;

        if let Ok(output) = pr_output {
            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout);
                if let Ok(prs) = serde_json::from_str::<Vec<serde_json::Value>>(&stdout) {
                    for pr in prs {
                        let title = format!(
                            "PR #{}: {}",
                            pr["number"].as_i64().unwrap_or(0),
                            pr["title"].as_str().unwrap_or("")
                        );
                        if db.event_exists("pr_created", &title, &repo.full_name).unwrap_or(true) {
                            continue;
                        }
                        let event = DevEvent {
                            id: None,
                            event_type: "pr_created".to_string(),
                            title,
                            description: pr["body"].as_str().unwrap_or("").to_string(),
                            repo: repo.full_name.clone(),
                            url: pr["url"].as_str().unwrap_or("").to_string(),
                            created_at: pr["createdAt"].as_str().unwrap_or("").to_string(),
                            read: false,
                        };
                        match db.insert_event(&event) {
                            Ok(_) => events.push(event),
                            Err(e) => log::warn!("Failed to insert pr_created event: {}", e),
                        }
                    }
                }
            }
        }

        // Fetch review requests
        let review_output = app
            .shell()
            .command("gh")
            .args([
                "pr", "list", "--repo", &repo.full_name,
                "--search", "review-requested:@me",
                "--json", "number,title,url,createdAt",
                "--limit", "5",
            ])
            .output()
            .await;

        if let Ok(output) = review_output {
            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout);
                if let Ok(reviews) = serde_json::from_str::<Vec<serde_json::Value>>(&stdout) {
                    for review in reviews {
                        let title = format!(
                            "Review requested: PR #{} - {}",
                            review["number"].as_i64().unwrap_or(0),
                            review["title"].as_str().unwrap_or("")
                        );
                        if db.event_exists("review_requested", &title, &repo.full_name).unwrap_or(true) {
                            continue;
                        }
                        let event = DevEvent {
                            id: None,
                            event_type: "review_requested".to_string(),
                            title,
                            description: String::new(),
                            repo: repo.full_name.clone(),
                            url: review["url"].as_str().unwrap_or("").to_string(),
                            created_at: review["createdAt"].as_str().unwrap_or("").to_string(),
                            read: false,
                        };
                        match db.insert_event(&event) {
                            Ok(_) => events.push(event),
                            Err(e) => log::warn!("Failed to insert review_requested event: {}", e),
                        }
                    }
                }
            }
        }
    }

    events
}

/// Fetch GitHub notification events.
async fn poll_notifications(app: &AppHandle, db: &Database) -> Vec<DevEvent> {
    let mut events = Vec::new();

    let notif_output = app
        .shell()
        .command("gh")
        .args(["api", "/notifications", "--method", "GET"])
        .output()
        .await;

    if let Ok(output) = notif_output {
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            if let Ok(notifs) = serde_json::from_str::<Vec<serde_json::Value>>(&stdout) {
                for notif in notifs.iter().take(10) {
                    let title = notif["subject"]["title"].as_str().unwrap_or("").to_string();
                    let repo_name = notif["repository"]["full_name"]
                        .as_str()
                        .unwrap_or("")
                        .to_string();
                    let reason = notif["reason"].as_str().unwrap_or("");
                    let subject_type = notif["subject"]["type"].as_str().unwrap_or("");

                    let mut event_type = match reason {
                        "review_requested" => "review_requested".to_string(),
                        "mention" | "team_mention" => "mention".to_string(),
                        "comment" => "comment".to_string(),
                        "assign" => "assigned".to_string(),
                        "ci_activity" => "ci_activity".to_string(),
                        "approval_requested" => "approval_requested".to_string(),
                        _ => match subject_type {
                            "PullRequest" => "pr_activity".to_string(),
                            "Issue" => "issue_activity".to_string(),
                            "Release" => "release".to_string(),
                            "CheckSuite" | "CheckRun" => "ci_activity".to_string(),
                            "Discussion" => "discussion".to_string(),
                            _ => "notification".to_string(),
                        },
                    };

                    let mut detail_reason = reason.to_string();

                    // For PR author notifications, fetch the latest review to get the specific action
                    if subject_type == "PullRequest" && reason == "author" {
                        if let Some(comment_url) = notif["subject"]["latest_comment_url"].as_str() {
                            if let Ok(detail_out) = app
                                .shell()
                                .command("gh")
                                .args(["api", comment_url, "--method", "GET"])
                                .output()
                                .await
                            {
                                if detail_out.status.success() {
                                    let detail_str = String::from_utf8_lossy(&detail_out.stdout);
                                    if let Ok(detail) = serde_json::from_str::<serde_json::Value>(&detail_str) {
                                        if let Some(state) = detail["state"].as_str() {
                                            match state {
                                                "APPROVED" | "approved" => {
                                                    event_type = "pr_approved".to_string();
                                                    detail_reason = "approved".to_string();
                                                }
                                                "CHANGES_REQUESTED" | "changes_requested" => {
                                                    event_type = "changes_requested".to_string();
                                                    detail_reason = "changes_requested".to_string();
                                                }
                                                "COMMENTED" | "commented" => {
                                                    event_type = "comment".to_string();
                                                    detail_reason = "review_comment".to_string();
                                                }
                                                "DISMISSED" | "dismissed" => {
                                                    event_type = "review_dismissed".to_string();
                                                    detail_reason = "dismissed".to_string();
                                                }
                                                _ => {}
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }

                    if db.event_exists(&event_type, &title, &repo_name).unwrap_or(true) {
                        continue;
                    }

                    let event = DevEvent {
                        id: None,
                        event_type,
                        title: title.clone(),
                        description: format!("{}:{}", subject_type, detail_reason),
                        repo: repo_name,
                        url: api_url_to_web_url(notif["subject"]["url"].as_str().unwrap_or("")),
                        created_at: notif["updated_at"].as_str().unwrap_or("").to_string(),
                        read: false,
                    };
                    match db.insert_event(&event) {
                        Ok(_) => events.push(event),
                        Err(e) => log::warn!("Failed to insert notification event: {}", e),
                    }
                }
            }
        }
    }

    events
}

/// Emit events to frontend, send notifications, and trigger auto-actions.
fn dispatch_new_events(app: &AppHandle, db: &Database, new_events: &[DevEvent]) {
    let _ = app.emit("monitor:new-events", new_events);

    // Send native notifications
    if get_setting_or(db, "notifications_enabled", "true") == "true" {
        for event in new_events {
            let notif_title = match event.event_type.as_str() {
                "pr_approved" => "PR Approved",
                "changes_requested" => "Changes Requested",
                "review_requested" => "Review Requested",
                "mention" => "You were mentioned",
                "comment" => "New Comment",
                "pr_created" => "PR Created",
                _ => "DevPulse",
            };
            send_notification_with_app(app, notif_title, &event.title);
        }

        if let Some(latest) = new_events.last() {
            let _ = app.emit("monitor:last-notified-event", serde_json::json!({
                "event_type": &latest.event_type,
                "url": &latest.url,
                "repo": &latest.repo,
                "title": &latest.title,
            }));
        }
    }

    // Auto-review
    if get_setting_or(db, "auto_review_enabled", "false") == "true" {
        let auto_post = get_setting_or(db, "auto_review_post", "false");
        let mut reviewed = AUTO_REVIEWED.lock().unwrap();
        let set = reviewed.get_or_insert_with(HashSet::new);

        for event in new_events {
            if event.event_type == "review_requested" {
                if let Some(pr_number) = extract_pr_number_from_title(&event.title) {
                    let key = format!("{}#{}", event.repo, pr_number);
                    if !set.insert(key) {
                        continue;
                    }
                    let _ = app.emit("monitor:auto-review", serde_json::json!({
                        "repo": &event.repo,
                        "prNumber": pr_number,
                        "autoPost": auto_post == "true",
                    }));
                }
            }
        }
    }

    // Auto-describe
    if get_setting_or(db, "auto_description_enabled", "false") == "true" {
        let mut described = AUTO_DESCRIBED.lock().unwrap();
        let set = described.get_or_insert_with(HashSet::new);

        for event in new_events {
            if event.event_type == "pr_created" && event.description.trim().is_empty() {
                if let Some(pr_number) = extract_pr_number_from_title(&event.title) {
                    let key = format!("{}#{}", event.repo, pr_number);
                    if !set.insert(key) {
                        continue;
                    }
                    let _ = app.emit("monitor:auto-description", serde_json::json!({
                        "repo": &event.repo,
                        "prNumber": pr_number,
                    }));
                }
            }
        }
    }

    // Auto-fixes
    if get_setting_or(db, "auto_fixes_enabled", "false") == "true" {
        let mut fixed = AUTO_FIXED.lock().unwrap();
        let set = fixed.get_or_insert_with(HashSet::new);

        for event in new_events {
            if event.event_type == "changes_requested" {
                if let Some(pr_number) = extract_pr_number_from_url(&event.url) {
                    let key = format!("{}#{}", event.repo, pr_number);
                    if !set.insert(key) {
                        continue;
                    }
                    let _ = app.emit("monitor:auto-fixes", serde_json::json!({
                        "repo": &event.repo,
                        "prNumber": pr_number,
                    }));
                }
            }
        }
    }
}

/// Extract PR number from a GitHub URL like "https://github.com/owner/repo/pull/123"
fn extract_pr_number_from_url(url: &str) -> Option<i64> {
    url.split('/').last().and_then(|s| s.parse::<i64>().ok())
}

/// One-time backfill: reclassify old generic "notification" events by fetching PR review details.
async fn backfill_notifications(app: &AppHandle) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let db = app.state::<Database>();
    let old_events = db.get_generic_notifications().map_err(|e| e.to_string())?;

    if old_events.is_empty() {
        return Ok(());
    }

    log::info!("Backfilling {} old notification events", old_events.len());

    for event in &old_events {
        let id = match event.id {
            Some(id) => id,
            None => continue,
        };

        // Only reclassify PR-related events
        if !event.url.contains("/pull/") {
            continue;
        }

        // https://github.com/owner/repo/pull/123 → /repos/owner/repo/pulls/123/reviews
        let api_path = event.url
            .replace("https://github.com/", "/repos/")
            .replace("/pull/", "/pulls/")
            + "/reviews";

        let output = app
            .shell()
            .command("gh")
            .args(["api", &api_path, "--method", "GET"])
            .output()
            .await;

        if let Ok(out) = output {
            if out.status.success() {
                let stdout = String::from_utf8_lossy(&out.stdout);
                if let Ok(reviews) = serde_json::from_str::<Vec<serde_json::Value>>(&stdout) {
                    // Get the latest non-PENDING review
                    if let Some(latest) = reviews.iter().rev().find(|r| {
                        r["state"].as_str().map_or(false, |s| s != "PENDING")
                    }) {
                        let (new_type, new_reason) = match latest["state"].as_str().unwrap_or("") {
                            "APPROVED" => ("pr_approved", "approved"),
                            "CHANGES_REQUESTED" => ("changes_requested", "changes_requested"),
                            "COMMENTED" => ("comment", "review_comment"),
                            "DISMISSED" => ("review_dismissed", "dismissed"),
                            _ => continue,
                        };

                        let new_desc = format!("PullRequest:{}", new_reason);
                        let _ = db.update_event_classification(id, new_type, &new_desc);
                    }
                }
            }
        }
    }

    // Notify frontend to refresh
    let _ = app.emit("monitor:new-events", &[] as &[String]);

    Ok(())
}
