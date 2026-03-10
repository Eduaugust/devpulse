use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri_plugin_shell::ShellExt;

#[derive(Debug, Serialize, Deserialize)]
pub struct GlMr {
    pub number: i64,
    pub title: String,
    pub url: String,
    pub state: String,
    pub repo: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GlTodo {
    pub id: String,
    pub title: String,
    pub reason: String,
    pub repo: String,
    pub url: String,
    pub updated_at: String,
}

#[tauri::command]
pub async fn check_glab_auth(app: AppHandle) -> Result<bool, String> {
    let output = app
        .shell()
        .command("glab")
        .args(["auth", "status"])
        .output()
        .await
        .map_err(|e| e.to_string())?;
    Ok(output.status.success())
}

async fn fetch_mr_list(app: &AppHandle, repo: &str, extra_args: &[&str]) -> Result<Vec<GlMr>, String> {
    let mut args = vec!["mr", "list", "-R", repo];
    args.extend_from_slice(extra_args);
    args.extend_from_slice(&["-F", "json"]);

    let output = app
        .shell()
        .command("glab")
        .args(&args)
        .output()
        .await
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let raw: Vec<serde_json::Value> = serde_json::from_str(&stdout).map_err(|e| e.to_string())?;

    let mrs = raw
        .into_iter()
        .map(|v| GlMr {
            number: v["iid"].as_i64().unwrap_or(0),
            title: v["title"].as_str().unwrap_or("").to_string(),
            url: v["web_url"].as_str().unwrap_or("").to_string(),
            state: v["state"].as_str().unwrap_or("").to_string(),
            repo: repo.to_string(),
            created_at: v["created_at"].as_str().unwrap_or("").to_string(),
            updated_at: v["updated_at"].as_str().unwrap_or("").to_string(),
        })
        .collect();

    Ok(mrs)
}

#[tauri::command]
pub async fn fetch_my_mrs(app: AppHandle, repo: String) -> Result<Vec<GlMr>, String> {
    fetch_mr_list(&app, &repo, &["--author=@me"]).await
}

#[tauri::command]
pub async fn fetch_my_mr_reviews(app: AppHandle, repo: String) -> Result<Vec<GlMr>, String> {
    fetch_mr_list(&app, &repo, &["--reviewer=@me"]).await
}

#[tauri::command]
pub async fn fetch_gitlab_todos(app: AppHandle) -> Result<Vec<GlTodo>, String> {
    let output = app
        .shell()
        .command("glab")
        .args(["api", "/todos", "--method", "GET"])
        .output()
        .await
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let raw: Vec<serde_json::Value> = serde_json::from_str(&stdout).map_err(|e| e.to_string())?;

    let todos = raw
        .into_iter()
        .take(20)
        .map(|v| {
            let project = v["project"]["path_with_namespace"]
                .as_str()
                .unwrap_or("")
                .to_string();
            GlTodo {
                id: v["id"].as_u64().map(|n| n.to_string()).unwrap_or_default(),
                title: v["target"]["title"]
                    .as_str()
                    .or_else(|| v["body"].as_str())
                    .unwrap_or("")
                    .to_string(),
                reason: v["action_name"].as_str().unwrap_or("").to_string(),
                repo: project,
                url: v["target_url"].as_str().unwrap_or("").to_string(),
                updated_at: v["updated_at"].as_str().unwrap_or("").to_string(),
            }
        })
        .collect();

    Ok(todos)
}

/// Post a review note to a GitLab merge request.
#[tauri::command]
pub async fn post_glab_review(
    app: AppHandle,
    repo: String,
    mr_number: i64,
    body: String,
) -> Result<String, String> {
    let encoded_repo = repo.replace('/', "%2F");
    let endpoint = format!(
        "/projects/{}/merge_requests/{}/notes",
        encoded_repo,
        mr_number
    );

    let tmp_path = std::env::temp_dir().join(format!(
        "devpulse-gl-review-{}-{}.json",
        mr_number,
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
    ));
    let payload = serde_json::json!({ "body": body });
    std::fs::write(&tmp_path, payload.to_string()).map_err(|e| e.to_string())?;

    let output = app
        .shell()
        .command("glab")
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
