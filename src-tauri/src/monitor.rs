use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::ShellExt;

use chrono::{Datelike, Timelike};

use crate::commands::system::send_notification_with_app;
use crate::HttpClient;

use crate::db::{Database, DevEvent};

/// Tracks the last date auto-fill was executed to prevent duplicate runs.
static LAST_AUTOFILL_DATE: Mutex<Option<String>> = Mutex::new(None);

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

        // Check auto-fill schedule
        if let Err(e) = check_autofill_schedule(&app).await {
            log::warn!("Auto-fill schedule check error: {}", e);
        }

        // Sleep for the interval
        tokio::time::sleep(tokio::time::Duration::from_secs(interval_secs)).await;
    }
}

async fn poll_github(app: &AppHandle) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let db = app.state::<Database>();
    let repos = db.get_monitored_repos().map_err(|e| e.to_string())?;

    let gh_repos: Vec<_> = repos.iter().filter(|r| r.provider == "github").cloned().collect();
    let gl_repos: Vec<_> = repos.iter().filter(|r| r.provider == "gitlab").cloned().collect();
    let az_repos: Vec<_> = repos.iter().filter(|r| r.provider == "azure").cloned().collect();
    let bb_repos: Vec<_> = repos.iter().filter(|r| r.provider == "bitbucket").cloned().collect();

    // Poll all providers concurrently
    let (gh_events, notif_events, gl_events, gl_todos, az_events, bb_events) = tokio::join!(
        poll_pr_events(app, &db, &gh_repos),
        poll_notifications(app, &db),
        async { if gl_repos.is_empty() { vec![] } else { poll_gitlab_mr_events(app, &db, &gl_repos).await } },
        async { if gl_repos.is_empty() { vec![] } else { poll_gitlab_todos(app, &db).await } },
        async { if az_repos.is_empty() { vec![] } else { poll_azure_pr_events(app, &db, &az_repos).await } },
        async { if bb_repos.is_empty() { vec![] } else { poll_bitbucket_pr_events(app, &db, &bb_repos).await } },
    );

    let mut new_events = gh_events;
    new_events.extend(notif_events);
    new_events.extend(gl_events);
    new_events.extend(gl_todos);
    new_events.extend(az_events);
    new_events.extend(bb_events);

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

/// Fetch GitLab MR events for all monitored GitLab repos.
async fn poll_gitlab_mr_events(
    app: &AppHandle,
    db: &Database,
    repos: &[crate::db::MonitoredRepo],
) -> Vec<DevEvent> {
    let mut events = Vec::new();

    for repo in repos {
        // Fetch MRs authored by user
        let mr_output = app
            .shell()
            .command("glab")
            .args([
                "mr", "list", "-R", &repo.full_name,
                "--author=@me",
                "-F", "json",
            ])
            .output()
            .await;

        if let Ok(output) = mr_output {
            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout);
                if let Ok(mrs) = serde_json::from_str::<Vec<serde_json::Value>>(&stdout) {
                    for mr in mrs.iter().take(5) {
                        let title = format!(
                            "MR !{}: {}",
                            mr["iid"].as_i64().unwrap_or(0),
                            mr["title"].as_str().unwrap_or("")
                        );
                        if db.event_exists("pr_created", &title, &repo.full_name).unwrap_or(true) {
                            continue;
                        }
                        let event = DevEvent {
                            id: None,
                            event_type: "pr_created".to_string(),
                            title,
                            description: mr["description"].as_str().unwrap_or("").to_string(),
                            repo: repo.full_name.clone(),
                            url: mr["web_url"].as_str().unwrap_or("").to_string(),
                            created_at: mr["created_at"].as_str().unwrap_or("").to_string(),
                            read: false,
                        };
                        match db.insert_event(&event) {
                            Ok(_) => events.push(event),
                            Err(e) => log::warn!("Failed to insert gitlab mr_created event: {}", e),
                        }
                    }
                }
            }
        }

        // Fetch review requests (MRs where user is reviewer)
        let review_output = app
            .shell()
            .command("glab")
            .args([
                "mr", "list", "-R", &repo.full_name,
                "--reviewer=@me",
                "-F", "json",
            ])
            .output()
            .await;

        if let Ok(output) = review_output {
            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout);
                if let Ok(reviews) = serde_json::from_str::<Vec<serde_json::Value>>(&stdout) {
                    for review in reviews.iter().take(5) {
                        let title = format!(
                            "Review requested: MR !{} - {}",
                            review["iid"].as_i64().unwrap_or(0),
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
                            url: review["web_url"].as_str().unwrap_or("").to_string(),
                            created_at: review["created_at"].as_str().unwrap_or("").to_string(),
                            read: false,
                        };
                        match db.insert_event(&event) {
                            Ok(_) => events.push(event),
                            Err(e) => log::warn!("Failed to insert gitlab review_requested event: {}", e),
                        }
                    }
                }
            }
        }
    }

    events
}

/// Fetch GitLab To-Do notification events.
async fn poll_gitlab_todos(app: &AppHandle, db: &Database) -> Vec<DevEvent> {
    let mut events = Vec::new();

    let output = app
        .shell()
        .command("glab")
        .args(["api", "/todos", "--method", "GET"])
        .output()
        .await;

    if let Ok(out) = output {
        if out.status.success() {
            let stdout = String::from_utf8_lossy(&out.stdout);
            if let Ok(todos) = serde_json::from_str::<Vec<serde_json::Value>>(&stdout) {
                for todo in todos.iter().take(10) {
                    let title = todo["target"]["title"]
                        .as_str()
                        .or_else(|| todo["body"].as_str())
                        .unwrap_or("")
                        .to_string();
                    let repo_name = todo["project"]["path_with_namespace"]
                        .as_str()
                        .unwrap_or("")
                        .to_string();
                    let action = todo["action_name"].as_str().unwrap_or("");
                    let target_type = todo["target_type"].as_str().unwrap_or("");

                    let event_type = match action {
                        "review_requested" => "review_requested",
                        "mentioned" => "mention",
                        "assigned" => "assigned",
                        "approval_required" => "approval_requested",
                        "directly_addressed" => "mention",
                        _ => match target_type {
                            "MergeRequest" => "pr_activity",
                            "Issue" => "issue_activity",
                            _ => "notification",
                        },
                    };

                    if db.event_exists(event_type, &title, &repo_name).unwrap_or(true) {
                        continue;
                    }

                    let event = DevEvent {
                        id: None,
                        event_type: event_type.to_string(),
                        title,
                        description: format!("{}:{}", target_type, action),
                        repo: repo_name,
                        url: todo["target_url"].as_str().unwrap_or("").to_string(),
                        created_at: todo["updated_at"].as_str().unwrap_or("").to_string(),
                        read: false,
                    };
                    match db.insert_event(&event) {
                        Ok(_) => events.push(event),
                        Err(e) => log::warn!("Failed to insert gitlab todo event: {}", e),
                    }
                }
            }
        }
    }

    events
}

/// Fetch Azure DevOps PR events for all monitored Azure repos.
/// For Azure repos, `owner` stores "org_url" and `name` stores the repo name.
/// `full_name` is "project/repo".
async fn poll_azure_pr_events(
    app: &AppHandle,
    db: &Database,
    repos: &[crate::db::MonitoredRepo],
) -> Vec<DevEvent> {
    let mut events = Vec::new();

    // Detect the Azure DevOps org from settings or the first repo's owner field
    let az_org = {
        let org_setting = get_setting_or(&db, "azure_org", "");
        if org_setting.is_empty() {
            repos.first().map(|r| r.owner.clone()).unwrap_or_default()
        } else {
            org_setting
        }
    };
    if az_org.is_empty() {
        return events;
    }

    for repo in repos {
        // owner = org URL, full_name = "project/repo"
        let parts: Vec<&str> = repo.full_name.splitn(2, '/').collect();
        if parts.len() != 2 {
            continue;
        }
        let project = parts[0];
        let repo_name = parts[1];

        // Fetch PRs created by the current user
        let pr_output = app
            .shell()
            .command("az")
            .args([
                "repos", "pr", "list",
                "--repository", repo_name,
                "--project", project,
                "--organization", &az_org,
                "--creator", "",
                "--status", "active",
                "--top", "5",
                "-o", "json",
            ])
            .output()
            .await;

        if let Ok(output) = pr_output {
            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout);
                if let Ok(prs) = serde_json::from_str::<Vec<serde_json::Value>>(&stdout) {
                    for pr in prs.iter().take(5) {
                        let pr_id = pr["pullRequestId"].as_i64().unwrap_or(0);
                        let title = format!(
                            "PR !{}: {}",
                            pr_id,
                            pr["title"].as_str().unwrap_or("")
                        );
                        if db.event_exists("pr_created", &title, &repo.full_name).unwrap_or(true) {
                            continue;
                        }
                        let web_url = pr["repository"]["webUrl"].as_str().unwrap_or("");
                        let url = if !web_url.is_empty() {
                            format!("{}/pullrequest/{}", web_url, pr_id)
                        } else {
                            String::new()
                        };
                        let event = DevEvent {
                            id: None,
                            event_type: "pr_created".to_string(),
                            title,
                            description: pr["description"].as_str().unwrap_or("").to_string(),
                            repo: repo.full_name.clone(),
                            url,
                            created_at: pr["creationDate"].as_str().unwrap_or("").to_string(),
                            read: false,
                        };
                        match db.insert_event(&event) {
                            Ok(_) => events.push(event),
                            Err(e) => log::warn!("Failed to insert azure pr_created event: {}", e),
                        }
                    }
                }
            }
        }

        // Fetch PRs where user is a reviewer
        let review_output = app
            .shell()
            .command("az")
            .args([
                "repos", "pr", "list",
                "--repository", repo_name,
                "--project", project,
                "--organization", &az_org,
                "--reviewer", "",
                "--status", "active",
                "--top", "5",
                "-o", "json",
            ])
            .output()
            .await;

        if let Ok(output) = review_output {
            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout);
                if let Ok(reviews) = serde_json::from_str::<Vec<serde_json::Value>>(&stdout) {
                    for review in reviews.iter().take(5) {
                        let pr_id = review["pullRequestId"].as_i64().unwrap_or(0);
                        let title = format!(
                            "Review requested: PR !{} - {}",
                            pr_id,
                            review["title"].as_str().unwrap_or("")
                        );
                        if db.event_exists("review_requested", &title, &repo.full_name).unwrap_or(true) {
                            continue;
                        }
                        let web_url = review["repository"]["webUrl"].as_str().unwrap_or("");
                        let url = if !web_url.is_empty() {
                            format!("{}/pullrequest/{}", web_url, pr_id)
                        } else {
                            String::new()
                        };
                        let event = DevEvent {
                            id: None,
                            event_type: "review_requested".to_string(),
                            title,
                            description: String::new(),
                            repo: repo.full_name.clone(),
                            url,
                            created_at: review["creationDate"].as_str().unwrap_or("").to_string(),
                            read: false,
                        };
                        match db.insert_event(&event) {
                            Ok(_) => events.push(event),
                            Err(e) => log::warn!("Failed to insert azure review_requested event: {}", e),
                        }
                    }
                }
            }
        }
    }

    events
}

/// Fetch Bitbucket PR events via REST API.
async fn poll_bitbucket_pr_events(
    app: &AppHandle,
    db: &Database,
    repos: &[crate::db::MonitoredRepo],
) -> Vec<DevEvent> {
    let mut events = Vec::new();

    let bb_username = get_setting_or(db, "bb_username", "");
    let bb_app_password = get_setting_or(db, "bb_app_password", "");
    if bb_username.is_empty() || bb_app_password.is_empty() {
        return events;
    }

    let http = app.state::<HttpClient>();
    let auth = {
        let creds = format!("{}:{}", bb_username, bb_app_password);
        format!("Basic {}", base64_encode(creds.as_bytes()))
    };

    for repo in repos {
        // full_name is "workspace/repo_slug"
        let url = format!(
            "https://api.bitbucket.org/2.0/repositories/{}/pullrequests?state=OPEN&pagelen=10",
            repo.full_name
        );

        let resp = http.0
            .get(&url)
            .header("Authorization", &auth)
            .send()
            .await;

        if let Ok(resp) = resp {
            if resp.status().is_success() {
                if let Ok(body) = resp.json::<serde_json::Value>().await {
                    if let Some(prs) = body["values"].as_array() {
                        for pr in prs.iter().take(5) {
                            let pr_id = pr["id"].as_i64().unwrap_or(0);
                            let title = format!(
                                "PR #{}: {}",
                                pr_id,
                                pr["title"].as_str().unwrap_or("")
                            );

                            // Check if author is the current user
                            let author = pr["author"]["username"].as_str().unwrap_or("");
                            let is_mine = author == bb_username;

                            if is_mine {
                                if db.event_exists("pr_created", &title, &repo.full_name).unwrap_or(true) {
                                    continue;
                                }
                                let event = DevEvent {
                                    id: None,
                                    event_type: "pr_created".to_string(),
                                    title,
                                    description: pr["description"].as_str().unwrap_or("").to_string(),
                                    repo: repo.full_name.clone(),
                                    url: pr["links"]["html"]["href"].as_str().unwrap_or("").to_string(),
                                    created_at: pr["created_on"].as_str().unwrap_or("").to_string(),
                                    read: false,
                                };
                                match db.insert_event(&event) {
                                    Ok(_) => events.push(event),
                                    Err(e) => log::warn!("Failed to insert bb pr_created: {}", e),
                                }
                            }

                            // Check if current user is a reviewer
                            if let Some(reviewers) = pr["reviewers"].as_array() {
                                let is_reviewer = reviewers.iter().any(|r| {
                                    r["username"].as_str().unwrap_or("") == bb_username
                                });
                                if is_reviewer {
                                    let review_title = format!(
                                        "Review requested: PR #{} - {}",
                                        pr_id,
                                        pr["title"].as_str().unwrap_or("")
                                    );
                                    if db.event_exists("review_requested", &review_title, &repo.full_name).unwrap_or(true) {
                                        continue;
                                    }
                                    let event = DevEvent {
                                        id: None,
                                        event_type: "review_requested".to_string(),
                                        title: review_title,
                                        description: String::new(),
                                        repo: repo.full_name.clone(),
                                        url: pr["links"]["html"]["href"].as_str().unwrap_or("").to_string(),
                                        created_at: pr["created_on"].as_str().unwrap_or("").to_string(),
                                        read: false,
                                    };
                                    match db.insert_event(&event) {
                                        Ok(_) => events.push(event),
                                        Err(e) => log::warn!("Failed to insert bb review_requested: {}", e),
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    events
}

/// Simple base64 encoder for basic auth.
pub(crate) fn base64_encode(data: &[u8]) -> String {
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut result = String::new();
    for chunk in data.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = if chunk.len() > 1 { chunk[1] as u32 } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] as u32 } else { 0 };
        let n = (b0 << 16) | (b1 << 8) | b2;
        result.push(CHARS[(n >> 18 & 63) as usize] as char);
        result.push(CHARS[(n >> 12 & 63) as usize] as char);
        if chunk.len() > 1 { result.push(CHARS[(n >> 6 & 63) as usize] as char); } else { result.push('='); }
        if chunk.len() > 2 { result.push(CHARS[(n & 63) as usize] as char); } else { result.push('='); }
    }
    result
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

                    // Quick check: skip if base event already exists (avoids N+1 detail fetches)
                    if db.event_exists(&event_type, &title, &repo_name).unwrap_or(true) {
                        continue;
                    }

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
                        // Re-check with refined event_type after detail fetch
                        if db.event_exists(&event_type, &title, &repo_name).unwrap_or(true) {
                            continue;
                        }
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
    // Signal frontend to refresh — no payload to avoid serializing large event list
    let _ = app.emit("monitor:new-events", ());

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
        let include_comments = get_setting_or(db, "auto_fixes_comments", "false") == "true";
        let mut fixed = AUTO_FIXED.lock().unwrap();
        let set = fixed.get_or_insert_with(HashSet::new);

        for event in new_events {
            let should_fix = event.event_type == "changes_requested"
                || (include_comments && event.event_type == "comment");
            if should_fix {
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

/// Check if auto-fill should run based on the configured schedule.
async fn check_autofill_schedule(
    app: &AppHandle,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let db = app.state::<Database>();

    let enabled = get_setting_or(&db, "autofill_enabled", "false");
    if enabled != "true" {
        return Ok(());
    }

    let scheduled_time = get_setting_or(&db, "autofill_time", "09:00");
    let now = chrono::Local::now();
    let today_str = now.format("%Y-%m-%d").to_string();

    // Check if already ran today
    {
        let last = LAST_AUTOFILL_DATE.lock().unwrap();
        if let Some(ref last_date) = *last {
            if last_date == &today_str {
                return Ok(());
            }
        }
    }

    // Parse scheduled time
    let parts: Vec<&str> = scheduled_time.split(':').collect();
    let (sched_hour, sched_min) = match (parts.first(), parts.get(1)) {
        (Some(h), Some(m)) => {
            let hour = h.parse::<u32>().unwrap_or(9);
            let min = m.parse::<u32>().unwrap_or(0);
            (hour, min)
        }
        _ => (9, 0),
    };

    let current_hour = now.hour();
    let current_min = now.minute();

    // Only trigger if we're past the scheduled time
    if current_hour < sched_hour || (current_hour == sched_hour && current_min < sched_min) {
        return Ok(());
    }

    // Mark as ran today
    {
        let mut last = LAST_AUTOFILL_DATE.lock().unwrap();
        *last = Some(today_str);
    }

    // Determine target date: skip weekends
    // Mon(1)→Fri, Tue-Fri→previous day, Sat/Sun→skip
    let weekday = now.weekday();
    if weekday == chrono::Weekday::Sat || weekday == chrono::Weekday::Sun {
        return Ok(());
    }
    let days_back: i64 = if weekday == chrono::Weekday::Mon { 3 } else { 1 };
    let target = (now - chrono::Duration::days(days_back))
        .format("%Y-%m-%d")
        .to_string();

    log::info!("Auto-fill triggered for {}", target);

    let app_clone = app.clone();
    tokio::spawn(async move {
        match crate::commands::autofill::run_autofill_internal(&app_clone, &target).await {
            Ok(result) => {
                if result.success {
                    log::info!(
                        "Auto-fill completed for {}: {} entries",
                        target,
                        result.entries_created
                    );
                } else {
                    log::warn!("Auto-fill failed for {}: {}", target, result.message);
                }
            }
            Err(e) => {
                log::warn!("Auto-fill error for {}: {}", target, e);
            }
        }
    });

    Ok(())
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
    let _ = app.emit("monitor:new-events", ());

    Ok(())
}
