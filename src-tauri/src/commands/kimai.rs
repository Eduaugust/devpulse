use serde::{Deserialize, Serialize};

use crate::KimaiHttpClient;

#[derive(Debug, Serialize, Deserialize)]
pub struct KimaiConnectionResult {
    pub connected: bool,
    pub message: String,
    pub username: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Default)]
pub struct KimaiTimesheet {
    #[serde(default)]
    pub id: i64,
    #[serde(default)]
    pub begin: String,
    #[serde(default)]
    pub end: Option<String>,
    #[serde(default)]
    pub duration: Option<i64>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub project: Option<serde_json::Value>,
    #[serde(default)]
    pub activity: Option<serde_json::Value>,
}

#[tauri::command]
pub async fn test_kimai_connection(
    kimai_http: tauri::State<'_, KimaiHttpClient>,
    url: String,
    api_token: String,
) -> Result<KimaiConnectionResult, String> {
    if url.is_empty() || api_token.is_empty() {
        return Ok(KimaiConnectionResult {
            connected: false,
            message: "URL and API token are required".to_string(),
            username: None,
        });
    }

    let api_url = format!("{}/api/timesheets?size=1", url.trim_end_matches('/'));

    let response = kimai_http.0
        .get(&api_url)
        .header("X-AUTH-TOKEN", &api_token)
        .header("Authorization", format!("Bearer {}", &api_token))
        .header("Accept", "application/json")
        .header("Cookie", "redirected=true")
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if response.status().is_success() {
        Ok(KimaiConnectionResult {
            connected: true,
            message: "Connected successfully".to_string(),
            username: None,
        })
    } else if response.status().is_redirection() {
        Ok(KimaiConnectionResult {
            connected: false,
            message: "Redirected to login — check URL and token".to_string(),
            username: None,
        })
    } else {
        Ok(KimaiConnectionResult {
            connected: false,
            message: format!("HTTP {}", response.status()),
            username: None,
        })
    }
}

#[tauri::command]
pub async fn fetch_kimai_timesheets(
    kimai_http: tauri::State<'_, KimaiHttpClient>,
    url: String,
    api_token: String,
    begin: String,
    end: String,
) -> Result<Vec<KimaiTimesheet>, String> {
    if url.is_empty() || api_token.is_empty() {
        return Err("URL and API token are required".to_string());
    }

    // Encode begin/end: replace '+' with '%2B' for positive UTC offsets (e.g. +05:30)
    // Colons and dashes are safe in query values per RFC 3986.
    let enc_begin = begin.replace('+', "%2B");
    let enc_end = end.replace('+', "%2B");

    let api_url = format!(
        "{}/api/timesheets?begin={}&end={}&order=ASC&size=250&full=true",
        url.trim_end_matches('/'),
        enc_begin,
        enc_end
    );

    log::info!("Kimai fetch URL: {}", api_url);

    let response = kimai_http.0
        .get(&api_url)
        .header("X-AUTH-TOKEN", &api_token)
        .header("Authorization", format!("Bearer {}", &api_token))
        .header("Accept", "application/json")
        .header("Cookie", "redirected=true")
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if response.status().is_redirection() {
        return Err("Kimai redirected to login — check URL and token in Connections".to_string());
    }
    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        log::warn!("Kimai API error ({}): {}", status, body);
        return Err(format!("Kimai API returned HTTP {} — {}", status, body));
    }

    let text = response
        .text()
        .await
        .map_err(|e| format!("Failed to read Kimai response: {}", e))?;

    let timesheets: Vec<KimaiTimesheet> = serde_json::from_str(&text)
        .map_err(|e| {
            let preview = if text.len() > 500 { &text[..500] } else { &text };
            format!("Failed to parse Kimai JSON: {}. Response preview: {}", e, preview)
        })?;

    Ok(timesheets)
}

/// Ensure Kimai MCP server is configured in Claude Code's settings.
/// Writes/updates ~/.claude/settings.local.json to include the kimai MCP server
/// using uvx to install directly from GitHub — no local paths needed.
#[tauri::command]
pub async fn ensure_kimai_mcp(
    kimai_url: String,
    kimai_token: String,
) -> Result<(), String> {
    let home = dirs::home_dir().ok_or_else(|| "Could not determine home directory".to_string())?;
    let settings_path = home.join(".claude").join("settings.local.json");

    // Read existing settings or start fresh
    let mut settings: serde_json::Value = if settings_path.exists() {
        let content = std::fs::read_to_string(&settings_path)
            .map_err(|e| format!("Failed to read settings: {}", e))?;
        serde_json::from_str(&content)
            .map_err(|e| format!("Failed to parse settings: {}", e))?
    } else {
        serde_json::json!({})
    };

    // Ensure mcpServers key exists
    if settings.get("mcpServers").is_none() {
        settings["mcpServers"] = serde_json::json!({});
    }

    // Add/update kimai MCP server entry using uvx + GitHub
    settings["mcpServers"]["kimai"] = serde_json::json!({
        "command": "uvx",
        "args": [
            "--from", "git+https://github.com/gfb-47/kimai_mcp",
            "kimai-mcp",
            format!("--kimai-url={}", kimai_url),
            format!("--kimai-token={}", kimai_token),
        ]
    });

    // Write back
    let content = serde_json::to_string_pretty(&settings)
        .map_err(|e| format!("Failed to serialize settings: {}", e))?;
    std::fs::write(&settings_path, content)
        .map_err(|e| format!("Failed to write settings: {}", e))?;

    Ok(())
}
