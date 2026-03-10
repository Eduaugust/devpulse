use crate::HttpClient;
use serde::{Deserialize, Serialize};

const BB_API: &str = "https://api.bitbucket.org/2.0";

#[derive(Debug, Serialize, Deserialize)]
pub struct BbPr {
    pub number: i64,
    pub title: String,
    pub url: String,
    pub state: String,
    pub repo: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct BbUser {
    pub username: String,
    pub display_name: String,
}

fn basic_auth(username: &str, app_password: &str) -> String {
    use std::io::Write;
    let mut buf = Vec::new();
    write!(buf, "{}:{}", username, app_password).unwrap();
    format!("Basic {}", base64_encode(&buf))
}

fn base64_encode(data: &[u8]) -> String {
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut result = String::new();
    for chunk in data.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = if chunk.len() > 1 { chunk[1] as u32 } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] as u32 } else { 0 };
        let n = (b0 << 16) | (b1 << 8) | b2;
        result.push(CHARS[(n >> 18 & 63) as usize] as char);
        result.push(CHARS[(n >> 12 & 63) as usize] as char);
        if chunk.len() > 1 {
            result.push(CHARS[(n >> 6 & 63) as usize] as char);
        } else {
            result.push('=');
        }
        if chunk.len() > 2 {
            result.push(CHARS[(n & 63) as usize] as char);
        } else {
            result.push('=');
        }
    }
    result
}

/// Test Bitbucket authentication by calling /2.0/user
#[tauri::command]
pub async fn check_bb_auth(
    http: tauri::State<'_, HttpClient>,
    username: String,
    app_password: String,
) -> Result<BbUser, String> {
    let resp = http
        .0
        .get(format!("{}/user", BB_API))
        .header("Authorization", basic_auth(&username, &app_password))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        return Err(format!("Auth failed: {}", resp.status()));
    }

    let body: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    Ok(BbUser {
        username: body["username"].as_str().unwrap_or("").to_string(),
        display_name: body["display_name"].as_str().unwrap_or("").to_string(),
    })
}

/// List repositories in a workspace.
#[tauri::command]
pub async fn fetch_bb_repos(
    http: tauri::State<'_, HttpClient>,
    username: String,
    app_password: String,
    workspace: String,
) -> Result<Vec<String>, String> {
    let resp = http
        .0
        .get(format!("{}/repositories/{}?pagelen=100", BB_API, workspace))
        .header("Authorization", basic_auth(&username, &app_password))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        return Err(format!("Failed: {}", resp.status()));
    }

    let body: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    let repos = body["values"]
        .as_array()
        .unwrap_or(&Vec::new())
        .iter()
        .filter_map(|v| v["full_name"].as_str().map(|s| s.to_string()))
        .collect();

    Ok(repos)
}

/// List open pull requests for a repository.
#[tauri::command]
pub async fn fetch_bb_prs(
    http: tauri::State<'_, HttpClient>,
    username: String,
    app_password: String,
    workspace: String,
    repo_slug: String,
) -> Result<Vec<BbPr>, String> {
    let resp = http
        .0
        .get(format!(
            "{}/repositories/{}/{}/pullrequests?state=OPEN&pagelen=20",
            BB_API, workspace, repo_slug
        ))
        .header("Authorization", basic_auth(&username, &app_password))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        return Err(format!("Failed: {}", resp.status()));
    }

    let body: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    let full_name = format!("{}/{}", workspace, repo_slug);

    let prs = body["values"]
        .as_array()
        .unwrap_or(&Vec::new())
        .iter()
        .map(|v| {
            // Store source branch + author in the `state` field alongside the actual state
            // Format: "STATE|source_branch|author" — parsed on frontend
            let state = v["state"].as_str().unwrap_or("");
            let source_branch = v["source"]["branch"]["name"].as_str().unwrap_or("");
            let author = v["author"]["display_name"].as_str().unwrap_or("");
            BbPr {
                number: v["id"].as_i64().unwrap_or(0),
                title: v["title"].as_str().unwrap_or("").to_string(),
                url: v["links"]["html"]["href"].as_str().unwrap_or("").to_string(),
                state: format!("{}|{}|{}", state, source_branch, author),
                repo: full_name.clone(),
                created_at: v["created_on"].as_str().unwrap_or("").to_string(),
                updated_at: v["updated_on"].as_str().unwrap_or("").to_string(),
            }
        })
        .collect();

    Ok(prs)
}

/// Post a comment on a pull request.
#[tauri::command]
pub async fn post_bb_comment(
    http: tauri::State<'_, HttpClient>,
    username: String,
    app_password: String,
    workspace: String,
    repo_slug: String,
    pr_id: i64,
    body: String,
) -> Result<String, String> {
    let payload = serde_json::json!({
        "content": { "raw": body }
    });

    let resp = http
        .0
        .post(format!(
            "{}/repositories/{}/{}/pullrequests/{}/comments",
            BB_API, workspace, repo_slug, pr_id
        ))
        .header("Authorization", basic_auth(&username, &app_password))
        .header("Content-Type", "application/json")
        .json(&payload)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("Failed ({}): {}", status, text));
    }

    let result: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    Ok(result.to_string())
}

/// Approve a pull request.
#[tauri::command]
pub async fn approve_bb_pr(
    http: tauri::State<'_, HttpClient>,
    username: String,
    app_password: String,
    workspace: String,
    repo_slug: String,
    pr_id: i64,
) -> Result<String, String> {
    let resp = http
        .0
        .post(format!(
            "{}/repositories/{}/{}/pullrequests/{}/approve",
            BB_API, workspace, repo_slug, pr_id
        ))
        .header("Authorization", basic_auth(&username, &app_password))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        return Err(format!("Failed: {}", resp.status()));
    }

    Ok("approved".to_string())
}

/// Edit a pull request's description.
#[tauri::command]
pub async fn edit_bb_pr_body(
    http: tauri::State<'_, HttpClient>,
    username: String,
    app_password: String,
    workspace: String,
    repo_slug: String,
    pr_id: i64,
    body: String,
) -> Result<String, String> {
    let payload = serde_json::json!({
        "description": body
    });

    let resp = http
        .0
        .put(format!(
            "{}/repositories/{}/{}/pullrequests/{}",
            BB_API, workspace, repo_slug, pr_id
        ))
        .header("Authorization", basic_auth(&username, &app_password))
        .header("Content-Type", "application/json")
        .json(&payload)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("Failed ({}): {}", status, text));
    }

    Ok("updated".to_string())
}

/// Get the diff of a pull request.
#[tauri::command]
pub async fn fetch_bb_pr_diff(
    http: tauri::State<'_, HttpClient>,
    username: String,
    app_password: String,
    workspace: String,
    repo_slug: String,
    pr_id: i64,
) -> Result<String, String> {
    let resp = http
        .0
        .get(format!(
            "{}/repositories/{}/{}/pullrequests/{}/diff",
            BB_API, workspace, repo_slug, pr_id
        ))
        .header("Authorization", basic_auth(&username, &app_password))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        return Err(format!("Failed: {}", resp.status()));
    }

    resp.text().await.map_err(|e| e.to_string())
}
