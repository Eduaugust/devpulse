use serde::{Deserialize, Serialize};
use tauri::Manager;
use tauri_plugin_shell::ShellExt;

use super::credentials::get_credential;
use super::git::GitLogEntry;
use crate::db::Database;
use crate::KimaiHttpClient;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GatherResult {
    pub git_data: String,
    pub github_data: String,
    pub kimai_data: String,
    pub calendar_data: String,
    pub existing_kimai_entries: String,
    pub activity_mappings: String,
}

#[tauri::command]
pub async fn gather_report_data(
    app: tauri::AppHandle,
    _db: tauri::State<'_, Database>,
    _kimai_http: tauri::State<'_, KimaiHttpClient>,
    date_from: String,
    date_to: String,
    include_git: Option<bool>,
    include_github: Option<bool>,
    include_kimai: Option<bool>,
    include_calendar: Option<bool>,
    kimai_context_days: Option<i64>,
) -> Result<GatherResult, String> {
    gather_data_internal(
        &app,
        &date_from,
        &date_to,
        include_git.unwrap_or(true),
        include_github.unwrap_or(true),
        include_kimai.unwrap_or(true),
        include_calendar.unwrap_or(true),
        kimai_context_days.unwrap_or(14),
    )
    .await
}

/// Internal gather function usable from autofill (no State injection needed).
pub async fn gather_data_internal(
    app: &tauri::AppHandle,
    date_from: &str,
    date_to: &str,
    include_git: bool,
    include_github: bool,
    include_kimai: bool,
    include_calendar: bool,
    kimai_context_days: i64,
) -> Result<GatherResult, String> {
    let db = app.state::<Database>();

    let mut result = GatherResult {
        git_data: String::new(),
        github_data: String::new(),
        kimai_data: String::new(),
        calendar_data: String::new(),
        existing_kimai_entries: String::new(),
        activity_mappings: String::new(),
    };

    // Git log
    if include_git {
        result.git_data = gather_git(app, &db, date_from, date_to).await;
    }

    // GitHub PRs
    if include_github {
        result.github_data = gather_github(app, &db, date_from, date_to).await;
    }

    // Kimai timesheets (existing entries + context)
    if include_kimai {
        let kimai_url = get_credential(app, "kimai_url");
        let kimai_token = get_credential(app, "kimai_token");
        if !kimai_url.is_empty() && !kimai_token.is_empty() {
            let kimai_http = app.state::<KimaiHttpClient>();
            result.existing_kimai_entries =
                gather_kimai_entries(&kimai_http, &kimai_url, &kimai_token, date_from, date_to)
                    .await;
            result.kimai_data = gather_kimai_context(
                &kimai_http,
                &kimai_url,
                &kimai_token,
                date_from,
                kimai_context_days,
            )
            .await;
        }
    }

    // Calendar events
    if include_calendar {
        let cal_creds = get_credential(app, "calendar_credentials");
        let cal_id = get_credential(app, "calendar_email");
        let timezone = db
            .get_setting("timezone")
            .ok()
            .flatten()
            .unwrap_or_default();
        if !cal_creds.is_empty() {
            result.calendar_data =
                gather_calendar(app, &cal_creds, &cal_id, date_from, date_to, &timezone).await;
        }
    }

    // Activity mappings
    if let Ok(mappings) = db.get_activity_mappings() {
        let enabled: Vec<_> = mappings.into_iter().filter(|m| m.enabled).collect();
        if !enabled.is_empty() {
            let mut lines = vec!["## Activity Mappings".to_string()];
            for m in &enabled {
                let desc = if m.description.is_empty() { String::new() } else { format!(" — {}", m.description) };
                lines.push(format!(
                    "- Pattern \"{}\" ({}) → Project: {} / Activity: {} (tags: {}){}",
                    m.pattern, m.pattern_type, m.kimai_project_name, m.kimai_activity_name, m.kimai_tags, desc
                ));
            }
            result.activity_mappings = lines.join("\n");
        }
    }

    Ok(result)
}

async fn gather_git(app: &tauri::AppHandle, db: &Database, from: &str, to: &str) -> String {
    let repos = db.get_local_repos().unwrap_or_default();
    let mut entries: Vec<GitLogEntry> = Vec::new();

    for repo in &repos {
        let path = &repo.path;
        let user_output = app
            .shell()
            .command("git")
            .args(["config", "user.name"])
            .current_dir(path)
            .output()
            .await;
        let author = match user_output {
            Ok(out) if out.status.success() => {
                String::from_utf8_lossy(&out.stdout).trim().to_string()
            }
            _ => String::new(),
        };

        let mut args = vec![
            "log".to_string(),
            format!("--after={}", from),
            format!("--before={}", to),
            "--pretty=format:%H|%aI|%s".to_string(),
            "--no-merges".to_string(),
        ];
        if !author.is_empty() {
            args.push(format!("--author={}", author));
        }

        let output = app
            .shell()
            .command("git")
            .args(&args)
            .current_dir(path)
            .output()
            .await;

        if let Ok(out) = output {
            if out.status.success() {
                let stdout = String::from_utf8_lossy(&out.stdout);
                for line in stdout.lines() {
                    let parts: Vec<&str> = line.splitn(3, '|').collect();
                    if parts.len() == 3 {
                        entries.push(GitLogEntry {
                            hash: parts[0].to_string(),
                            date: parts[1].to_string(),
                            message: parts[2].to_string(),
                            repo_name: repo.name.clone(),
                        });
                    }
                }
            }
        }
    }

    if entries.is_empty() {
        return String::new();
    }

    let mut lines = vec!["## Git Commits".to_string()];
    for e in &entries {
        lines.push(format!(
            "- [{}] {} — {} ({})",
            &e.hash[..7.min(e.hash.len())],
            e.date,
            e.message,
            e.repo_name
        ));
    }
    lines.join("\n")
}

async fn gather_github(app: &tauri::AppHandle, db: &Database, from: &str, to: &str) -> String {
    let repos = db.get_monitored_repos().unwrap_or_default();
    let gh_repos: Vec<_> = repos.iter().filter(|r| r.provider == "github").collect();

    if gh_repos.is_empty() {
        return String::new();
    }

    let mut lines = vec!["## GitHub Activity".to_string()];

    for repo in &gh_repos {
        let output = app
            .shell()
            .command("gh")
            .args([
                "pr",
                "list",
                "--repo",
                &repo.full_name,
                "--author",
                "@me",
                "--json",
                "number,title,url,state,createdAt,updatedAt",
                "--limit",
                "20",
            ])
            .output()
            .await;

        if let Ok(out) = output {
            if out.status.success() {
                let stdout = String::from_utf8_lossy(&out.stdout);
                if let Ok(prs) = serde_json::from_str::<Vec<serde_json::Value>>(&stdout) {
                    for pr in &prs {
                        let created = pr["createdAt"].as_str().unwrap_or("");
                        // Only include PRs within date range
                        if created >= from && created <= to {
                            lines.push(format!(
                                "- PR #{}: {} [{}] ({})",
                                pr["number"].as_i64().unwrap_or(0),
                                pr["title"].as_str().unwrap_or(""),
                                pr["state"].as_str().unwrap_or(""),
                                repo.full_name
                            ));
                        }
                    }
                }
            }
        }

        // Reviews
        let review_output = app
            .shell()
            .command("gh")
            .args([
                "pr",
                "list",
                "--repo",
                &repo.full_name,
                "--search",
                &format!("reviewed-by:@me updated:{}..{}", from, to),
                "--json",
                "number,title,url",
                "--limit",
                "10",
            ])
            .output()
            .await;

        if let Ok(out) = review_output {
            if out.status.success() {
                let stdout = String::from_utf8_lossy(&out.stdout);
                if let Ok(reviews) = serde_json::from_str::<Vec<serde_json::Value>>(&stdout) {
                    for r in &reviews {
                        lines.push(format!(
                            "- Reviewed PR #{}: {} ({})",
                            r["number"].as_i64().unwrap_or(0),
                            r["title"].as_str().unwrap_or(""),
                            repo.full_name
                        ));
                    }
                }
            }
        }
    }

    if lines.len() <= 1 {
        return String::new();
    }
    lines.join("\n")
}

async fn gather_kimai_entries(
    kimai_http: &KimaiHttpClient,
    url: &str,
    token: &str,
    from: &str,
    to: &str,
) -> String {
    let api_url = format!(
        "{}/api/timesheets?begin={}&end={}&order=ASC&size=250&full=true",
        url.trim_end_matches('/'),
        from,
        to,
    );

    let resp = kimai_http
        .0
        .get(&api_url)
        .header("X-AUTH-TOKEN", token)
        .header("Authorization", format!("Bearer {}", token))
        .header("Accept", "application/json")
        .header("Cookie", "redirected=true")
        .send()
        .await;

    let entries = match resp {
        Ok(r) if r.status().is_success() => {
            r.json::<Vec<serde_json::Value>>().await.unwrap_or_default()
        }
        _ => return String::new(),
    };

    if entries.is_empty() {
        return "## Existing Kimai Entries\nNo existing entries for this date range.".to_string();
    }

    let mut lines = vec!["## Existing Kimai Entries".to_string()];
    for e in &entries {
        let project = e["project"]["name"].as_str().unwrap_or("?");
        let activity = e["activity"]["name"].as_str().unwrap_or("?");
        let begin = e["begin"].as_str().unwrap_or("");
        let end = e["end"].as_str().unwrap_or("");
        let desc = e["description"].as_str().unwrap_or("");
        lines.push(format!(
            "- {} to {} | {} / {} | {}",
            begin, end, project, activity, desc
        ));
    }
    lines.join("\n")
}

async fn gather_kimai_context(
    kimai_http: &KimaiHttpClient,
    url: &str,
    token: &str,
    date_from: &str,
    context_days: i64,
) -> String {
    // Parse date_from and go back context_days
    let from_date = chrono::NaiveDate::parse_from_str(
        &date_from[..10.min(date_from.len())],
        "%Y-%m-%d",
    );
    let context_begin = match from_date {
        Ok(d) => (d - chrono::Duration::days(context_days))
            .format("%Y-%m-%dT00:00:00")
            .to_string(),
        Err(_) => return String::new(),
    };

    let api_url = format!(
        "{}/api/timesheets?begin={}&end={}&order=ASC&size=250&full=true",
        url.trim_end_matches('/'),
        context_begin,
        date_from,
    );

    let resp = kimai_http
        .0
        .get(&api_url)
        .header("X-AUTH-TOKEN", token)
        .header("Authorization", format!("Bearer {}", token))
        .header("Accept", "application/json")
        .header("Cookie", "redirected=true")
        .send()
        .await;

    let entries = match resp {
        Ok(r) if r.status().is_success() => {
            r.json::<Vec<serde_json::Value>>().await.unwrap_or_default()
        }
        _ => return String::new(),
    };

    if entries.is_empty() {
        return String::new();
    }

    let mut lines = vec![format!(
        "## Kimai Context (last {} days)",
        context_days
    )];
    for e in &entries {
        let project = e["project"]["name"].as_str().unwrap_or("?");
        let activity = e["activity"]["name"].as_str().unwrap_or("?");
        let begin = e["begin"].as_str().unwrap_or("");
        let desc = e["description"].as_str().unwrap_or("");
        lines.push(format!("- {} | {} / {} | {}", begin, project, activity, desc));
    }
    lines.join("\n")
}

async fn gather_calendar(
    app: &tauri::AppHandle,
    creds_json: &str,
    calendar_id: &str,
    from: &str,
    to: &str,
    timezone: &str,
) -> String {
    use crate::HttpClient;

    let http = app.state::<HttpClient>();

    // Build time range for Google Calendar API
    let time_min = if from.contains('T') {
        format!("{}Z", from)
    } else {
        format!("{}T00:00:00Z", from)
    };
    let time_max = if to.contains('T') {
        format!("{}Z", to)
    } else {
        format!("{}T23:59:59Z", to)
    };

    // Re-use the calendar command's fetch logic
    let result = super::calendar::fetch_calendar_events(
        http,
        creds_json.to_string(),
        time_min,
        time_max,
        if calendar_id.is_empty() {
            None
        } else {
            Some(calendar_id.to_string())
        },
        if timezone.is_empty() {
            None
        } else {
            Some(timezone.to_string())
        },
    )
    .await;

    match result {
        Ok(events) if !events.is_empty() => {
            let mut lines = vec!["## Calendar Events".to_string()];
            for e in &events {
                let duration_info = if e.all_day {
                    "all-day".to_string()
                } else {
                    format!("{} to {}", e.start, e.end)
                };
                let attendees_info = if e.attendees > 0 {
                    format!(" ({} attendees)", e.attendees)
                } else {
                    String::new()
                };
                lines.push(format!(
                    "- {} | {}{}",
                    e.summary, duration_info, attendees_info
                ));
            }
            lines.join("\n")
        }
        _ => String::new(),
    }
}
