use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri_plugin_shell::ShellExt;

#[derive(Debug, Serialize, Deserialize)]
pub struct AzPr {
    pub number: i64,
    pub title: String,
    pub url: String,
    pub state: String,
    pub repo: String,
    pub created_at: String,
    pub updated_at: String,
}

/// Check if the Azure DevOps CLI extension is authenticated.
/// We try `az devops project list` — if it succeeds the user is logged in.
#[tauri::command]
pub async fn check_az_auth(app: AppHandle) -> Result<bool, String> {
    let output = app
        .shell()
        .command("az")
        .args(["devops", "project", "list", "--detect", "true", "-o", "json"])
        .output()
        .await
        .map_err(|e| e.to_string())?;
    Ok(output.status.success())
}

/// Fetch PRs with optional filtering.  `extra_args` can contain `--creator` / `--reviewer`.
async fn fetch_az_pr_list(
    app: &AppHandle,
    org: &str,
    project: &str,
    repo_name: &str,
    extra_args: &[&str],
) -> Result<Vec<AzPr>, String> {
    let full_name = format!("{}/{}", project, repo_name);

    let mut args = vec![
        "repos", "pr", "list",
        "--repository", repo_name,
        "--project", project,
        "--organization", org,
        "--status", "active",
        "-o", "json",
    ];
    args.extend_from_slice(extra_args);

    let output = app
        .shell()
        .command("az")
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
        .map(|v| {
            let pr_id = v["pullRequestId"].as_i64().unwrap_or(0);
            let repository = &v["repository"];
            let web_url = repository["webUrl"].as_str().unwrap_or("");
            // Build web URL: {org}/{project}/_git/{repo}/pullrequest/{id}
            let url = if !web_url.is_empty() {
                format!("{}/pullrequest/{}", web_url, pr_id)
            } else {
                String::new()
            };

            AzPr {
                number: pr_id,
                title: v["title"].as_str().unwrap_or("").to_string(),
                url,
                state: v["status"].as_str().unwrap_or("").to_string(),
                repo: full_name.clone(),
                created_at: v["creationDate"].as_str().unwrap_or("").to_string(),
                updated_at: v["closedDate"]
                    .as_str()
                    .or_else(|| v["creationDate"].as_str())
                    .unwrap_or("")
                    .to_string(),
            }
        })
        .collect();

    Ok(prs)
}

#[tauri::command]
pub async fn fetch_az_my_prs(
    app: AppHandle,
    org: String,
    project: String,
    repo: String,
) -> Result<Vec<AzPr>, String> {
    // `--creator` with empty string means "me" when authenticated
    fetch_az_pr_list(&app, &org, &project, &repo, &["--creator", ""]).await
}

#[tauri::command]
pub async fn fetch_az_my_reviews(
    app: AppHandle,
    org: String,
    project: String,
    repo: String,
) -> Result<Vec<AzPr>, String> {
    fetch_az_pr_list(&app, &org, &project, &repo, &["--reviewer", ""]).await
}

/// Vote on a pull request.
/// vote values: approve, approve-with-suggestions, reject, reset, wait-for-author
#[tauri::command]
pub async fn az_pr_set_vote(
    app: AppHandle,
    org: String,
    project: String,
    pr_id: i64,
    vote: String,
) -> Result<String, String> {
    let output = app
        .shell()
        .command("az")
        .args([
            "repos", "pr", "set-vote",
            "--id", &pr_id.to_string(),
            "--vote", &vote,
            "--organization", &org,
            "--project", &project,
            "-o", "json",
        ])
        .output()
        .await
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

/// Create a comment thread on a PR via `az devops invoke` (REST API wrapper).
#[tauri::command]
pub async fn post_az_review_comment(
    app: AppHandle,
    org: String,
    project: String,
    repo_id: String,
    pr_id: i64,
    body: String,
) -> Result<String, String> {
    let payload = serde_json::json!({
        "comments": [{ "content": body, "commentType": 1 }],
        "status": 1,
    });
    let tmp_path = std::env::temp_dir().join(format!(
        "devpulse-az-review-{}-{}.json",
        pr_id,
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
    ));
    std::fs::write(&tmp_path, payload.to_string()).map_err(|e| e.to_string())?;

    let output = app
        .shell()
        .command("az")
        .args([
            "devops", "invoke",
            "--area", "git",
            "--resource", "threads",
            "--route-parameters",
            &format!("project={}", project),
            &format!("repositoryId={}", repo_id),
            &format!("pullRequestId={}", pr_id),
            "--http-method", "POST",
            "--in-file", &tmp_path.to_string_lossy(),
            "--organization", &org,
            "--api-version", "7.1",
            "-o", "json",
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
