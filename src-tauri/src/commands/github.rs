use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri_plugin_shell::ShellExt;

#[derive(Debug, Serialize, Deserialize)]
pub struct GhPr {
    pub number: i64,
    pub title: String,
    pub url: String,
    pub state: String,
    pub repo: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GhNotification {
    pub id: String,
    pub title: String,
    pub reason: String,
    pub repo: String,
    pub url: String,
    pub updated_at: String,
}

#[tauri::command]
pub async fn check_gh_auth(app: AppHandle) -> Result<bool, String> {
    let output = app
        .shell()
        .command("gh")
        .args(["auth", "status"])
        .output()
        .await
        .map_err(|e| e.to_string())?;
    Ok(output.status.success())
}

async fn fetch_pr_list(app: &AppHandle, repo: &str, extra_args: &[&str]) -> Result<Vec<GhPr>, String> {
    let mut args = vec![
        "pr", "list", "--repo", repo,
    ];
    args.extend_from_slice(extra_args);
    args.extend_from_slice(&[
        "--json", "number,title,url,state,createdAt,updatedAt",
        "--limit", "20",
    ]);

    let output = app
        .shell()
        .command("gh")
        .args(&args)
        .output()
        .await
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let raw: Vec<serde_json::Value> = serde_json::from_str(&stdout).map_err(|e| e.to_string())?;

    let prs = raw
        .into_iter()
        .map(|v| GhPr {
            number: v["number"].as_i64().unwrap_or(0),
            title: v["title"].as_str().unwrap_or("").to_string(),
            url: v["url"].as_str().unwrap_or("").to_string(),
            state: v["state"].as_str().unwrap_or("").to_string(),
            repo: repo.to_string(),
            created_at: v["createdAt"].as_str().unwrap_or("").to_string(),
            updated_at: v["updatedAt"].as_str().unwrap_or("").to_string(),
        })
        .collect();

    Ok(prs)
}

#[tauri::command]
pub async fn fetch_my_prs(app: AppHandle, repo: String) -> Result<Vec<GhPr>, String> {
    fetch_pr_list(&app, &repo, &["--author", "@me"]).await
}

#[tauri::command]
pub async fn fetch_my_reviews(app: AppHandle, repo: String) -> Result<Vec<GhPr>, String> {
    fetch_pr_list(&app, &repo, &["--search", "review-requested:@me"]).await
}

#[tauri::command]
pub async fn fetch_notifications(app: AppHandle) -> Result<Vec<GhNotification>, String> {
    let output = app
        .shell()
        .command("gh")
        .args(["api", "/notifications", "--method", "GET"])
        .output()
        .await
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let raw: Vec<serde_json::Value> = serde_json::from_str(&stdout).map_err(|e| e.to_string())?;

    let notifications = raw
        .into_iter()
        .map(|v| GhNotification {
            id: v["id"].as_str().unwrap_or("").to_string(),
            title: v["subject"]["title"].as_str().unwrap_or("").to_string(),
            reason: v["reason"].as_str().unwrap_or("").to_string(),
            repo: v["repository"]["full_name"]
                .as_str()
                .unwrap_or("")
                .to_string(),
            url: v["subject"]["url"].as_str().unwrap_or("").to_string(),
            updated_at: v["updated_at"].as_str().unwrap_or("").to_string(),
        })
        .collect();

    Ok(notifications)
}

/// Post a pending review to GitHub using a temp file for the JSON payload.
/// This avoids needing `bash` in the shell allowlist.
#[tauri::command]
pub async fn post_gh_review(
    app: AppHandle,
    repo: String,
    pr_number: i64,
    payload_json: String,
) -> Result<String, String> {
    // Write payload to a temp file
    let tmp_path = std::env::temp_dir().join(format!("devpulse-review-{}-{}.json", pr_number, std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis()));
    std::fs::write(&tmp_path, &payload_json).map_err(|e| e.to_string())?;

    let endpoint = format!("repos/{}/pulls/{}/reviews", repo, pr_number);
    let output = app
        .shell()
        .command("gh")
        .args([
            "api",
            &endpoint,
            "--method",
            "POST",
            "--input",
            &tmp_path.to_string_lossy(),
        ])
        .output()
        .await
        .map_err(|e| e.to_string())?;

    let _ = std::fs::remove_file(&tmp_path);

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}
