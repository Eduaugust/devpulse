use serde::{Deserialize, Serialize};

use super::uv::{self, UvResolution, UvSource};
use crate::{HttpClient, KimaiHttpClient};

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

    // Strip timezone offset from begin/end — some Kimai servers reject it (HTTP 400).
    // The server interprets timestamps in its configured timezone.
    fn strip_tz(s: &str) -> &str {
        // "2026-03-11T00:00:00-03:00" → "2026-03-11T00:00:00"
        // "2026-03-11T00:00:00+05:30" → "2026-03-11T00:00:00"
        // "2026-03-11T00:00:00"       → "2026-03-11T00:00:00" (no change)
        if let Some(t_pos) = s.find('T') {
            let after_t = &s[t_pos + 1..];
            if let Some(offset_pos) = after_t.rfind('+').or_else(|| after_t.rfind('-')) {
                return &s[..t_pos + 1 + offset_pos];
            }
        }
        s
    }

    let api_url = format!(
        "{}/api/timesheets?begin={}&end={}&order=ASC&size=250&full=true",
        url.trim_end_matches('/'),
        strip_tz(&begin),
        strip_tz(&end),
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

#[derive(Debug, Serialize, Deserialize)]
pub struct KimaiMcpSetupResult {
    pub uv_resolution: Option<UvResolution>,
    pub config_written: bool,
    pub uv_verified: bool,
    pub error: Option<String>,
}

/// Full Kimai MCP setup: resolve uv binary, write MCP config, verify.
#[tauri::command]
pub async fn setup_kimai_mcp(
    app: tauri::AppHandle,
    http: tauri::State<'_, HttpClient>,
    kimai_url: String,
    kimai_token: String,
) -> Result<KimaiMcpSetupResult, String> {
    // 1. Resolve uv binary
    let resolution = uv::resolve_uv_binary(&app, &http).await?;

    // 2. Write MCP config
    let config_written = match write_kimai_mcp_config(&resolution, &kimai_url, &kimai_token) {
        Ok(()) => true,
        Err(e) => {
            return Ok(KimaiMcpSetupResult {
                uv_resolution: Some(resolution),
                config_written: false,
                uv_verified: false,
                error: Some(format!("Failed to write MCP config: {}", e)),
            });
        }
    };

    // 3. Verify uv works
    let uv_verified = match &resolution.source {
        UvSource::SystemUvx => {
            // For system uvx, verify the uv sibling exists
            uv::verify_uv("uv").is_ok()
                || uv::verify_uv(&resolution.binary_path.replace("uvx", "uv")).is_ok()
        }
        _ => uv::verify_uv(&resolution.binary_path).is_ok(),
    };

    Ok(KimaiMcpSetupResult {
        uv_resolution: Some(resolution),
        config_written,
        uv_verified,
        error: None,
    })
}

/// Write the Kimai MCP server config into `~/.claude/settings.local.json`.
fn write_kimai_mcp_config(
    resolution: &UvResolution,
    kimai_url: &str,
    kimai_token: &str,
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

    // Build MCP config based on uv source
    let mcp_entry = match &resolution.source {
        UvSource::SystemUvx => {
            // System uvx: use "uvx" command directly
            serde_json::json!({
                "command": "uvx",
                "args": [
                    "--from", "git+https://github.com/gfb-47/kimai_mcp",
                    "kimai-mcp",
                    format!("--kimai-url={}", kimai_url),
                    format!("--kimai-token={}", kimai_token),
                ]
            })
        }
        UvSource::AppManaged | UvSource::Downloaded => {
            // App-managed uv: use absolute path with "tool run"
            serde_json::json!({
                "command": &resolution.binary_path,
                "args": [
                    "tool", "run",
                    "--from", "git+https://github.com/gfb-47/kimai_mcp",
                    "kimai-mcp",
                    format!("--kimai-url={}", kimai_url),
                    format!("--kimai-token={}", kimai_token),
                ]
            })
        }
    };

    settings["mcpServers"]["kimai"] = mcp_entry;

    // Write back
    let content = serde_json::to_string_pretty(&settings)
        .map_err(|e| format!("Failed to serialize settings: {}", e))?;
    std::fs::write(&settings_path, content)
        .map_err(|e| format!("Failed to write settings: {}", e))?;

    Ok(())
}

/// Legacy wrapper — calls setup_kimai_mcp internally for backward compatibility.
#[tauri::command]
pub async fn ensure_kimai_mcp(
    app: tauri::AppHandle,
    http: tauri::State<'_, HttpClient>,
    kimai_url: String,
    kimai_token: String,
) -> Result<(), String> {
    let result = setup_kimai_mcp(app, http, kimai_url, kimai_token).await?;
    if let Some(err) = result.error {
        return Err(err);
    }
    Ok(())
}
