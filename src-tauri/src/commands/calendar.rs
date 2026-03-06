use std::sync::atomic::{AtomicBool, Ordering};

use serde::{Deserialize, Serialize};
use tokio::io::AsyncReadExt;

use crate::HttpClient;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CalendarEvent {
    pub summary: String,
    pub start: String,
    pub end: String,
    pub all_day: bool,
    pub attendees: usize,
    pub status: String,
}

static CANCEL_AUTH: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Serialize, Deserialize)]
pub struct CalendarConnectionResult {
    pub connected: bool,
    pub message: String,
}

#[tauri::command]
pub async fn test_calendar_connection(
    http: tauri::State<'_, HttpClient>,
    credentials_json: String,
) -> Result<CalendarConnectionResult, String> {
    if credentials_json.is_empty() {
        return Ok(CalendarConnectionResult {
            connected: false,
            message: "Calendar credentials are required".to_string(),
        });
    }

    let creds: serde_json::Value = match serde_json::from_str(&credentials_json) {
        Ok(v) => v,
        Err(e) => {
            return Ok(CalendarConnectionResult {
                connected: false,
                message: format!("Invalid JSON: {}", e),
            });
        }
    };

    let cred_type = creds.get("type").and_then(|v| v.as_str());

    match cred_type {
        Some("authorized_user") => test_authorized_user(&http.0, &creds).await,
        Some("service_account") => test_service_account(&http.0, &creds).await,
        Some(other) => Ok(CalendarConnectionResult {
            connected: false,
            message: format!("Unknown credential type: '{}'", other),
        }),
        None => {
            if creds.get("installed").is_some() || creds.get("web").is_some() {
                Ok(CalendarConnectionResult {
                    connected: false,
                    message: "OAuth client config detected — click Authorize to connect your Google account".to_string(),
                })
            } else {
                Ok(CalendarConnectionResult {
                    connected: false,
                    message: "Missing 'type' field — not a valid Google credentials file".to_string(),
                })
            }
        }
    }
}

#[tauri::command]
pub fn cancel_calendar_auth() {
    CANCEL_AUTH.store(true, Ordering::SeqCst);
}

/// Run the full OAuth authorization flow:
/// 1. Parse client config to get client_id/secret
/// 2. Start a local HTTP server on a random port
/// 3. Open the browser to Google's auth page
/// 4. Wait for the redirect with the auth code
/// 5. Exchange the code for tokens
/// 6. Return authorized_user credentials JSON
#[tauri::command]
pub async fn authorize_calendar(
    app: tauri::AppHandle,
    http: tauri::State<'_, HttpClient>,
    client_config_json: String,
) -> Result<String, String> {
    let config: serde_json::Value = serde_json::from_str(&client_config_json)
        .map_err(|e| format!("Invalid JSON: {}", e))?;

    let client_info = config
        .get("installed")
        .or_else(|| config.get("web"))
        .ok_or("Not an OAuth client config (missing 'installed' or 'web' key)")?;

    let client_id = client_info["client_id"]
        .as_str()
        .ok_or("Missing client_id")?;
    let client_secret = client_info["client_secret"]
        .as_str()
        .ok_or("Missing client_secret")?;
    let auth_uri = client_info["auth_uri"]
        .as_str()
        .unwrap_or("https://accounts.google.com/o/oauth2/auth");
    let token_uri = client_info["token_uri"]
        .as_str()
        .unwrap_or("https://oauth2.googleapis.com/token");

    // Bind a local TCP listener on a random port
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| format!("Failed to bind local server: {}", e))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("Failed to get port: {}", e))?
        .port();
    let redirect_uri = format!("http://127.0.0.1:{}", port);

    // Build the authorization URL
    let scope = "https://www.googleapis.com/auth/calendar.readonly";
    let auth_url = format!(
        "{}?client_id={}&redirect_uri={}&response_type=code&scope={}&access_type=offline&prompt=consent",
        auth_uri,
        urlencoded(client_id),
        urlencoded(&redirect_uri),
        urlencoded(scope),
    );

    // Open browser
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_url(&auth_url, None::<&str>)
        .map_err(|e| format!("Failed to open browser: {}", e))?;

    // Wait for the redirect, cancellable
    CANCEL_AUTH.store(false, Ordering::SeqCst);

    let accept_result = tokio::select! {
        result = listener.accept() => Some(result),
        _ = async {
            loop {
                tokio::time::sleep(std::time::Duration::from_millis(200)).await;
                if CANCEL_AUTH.load(Ordering::SeqCst) {
                    break;
                }
            }
        } => None,
    };

    let (mut stream, _) = match accept_result {
        None => return Err("Authorization cancelled".to_string()),
        Some(r) => r.map_err(|e| format!("Failed to accept connection: {}", e))?,
    };

    let mut buf = vec![0u8; 4096];
    let n = stream
        .read(&mut buf)
        .await
        .map_err(|e| format!("Failed to read request: {}", e))?;
    let request = String::from_utf8_lossy(&buf[..n]);

    // Check for error in the redirect
    if let Some(error) = extract_query_param(&request, "error") {
        let _ = send_response(
            &mut stream,
            "Authorization failed",
            &format!("Google returned an error: <b>{}</b><br>You can close this tab.", error),
        )
        .await;
        return Err(format!("Authorization denied: {}", error));
    }

    // Extract the authorization code
    let code = extract_query_param(&request, "code")
        .ok_or("No authorization code in the redirect")?;

    // Send success page to browser
    let _ = send_response(
        &mut stream,
        "Authorization successful!",
        "You can close this tab and return to DevPulse.",
    )
    .await;
    drop(stream);
    drop(listener);

    // Exchange code for tokens
    let resp = http.0
        .post(token_uri)
        .form(&[
            ("code", code.as_str()),
            ("client_id", client_id),
            ("client_secret", client_secret),
            ("redirect_uri", redirect_uri.as_str()),
            ("grant_type", "authorization_code"),
        ])
        .send()
        .await
        .map_err(|e| format!("Token exchange failed: {}", e))?;

    if !resp.status().is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Token exchange failed: {}", body));
    }

    let token_data: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse token response: {}", e))?;

    let refresh_token = token_data["refresh_token"]
        .as_str()
        .ok_or("No refresh_token in response — try revoking access at https://myaccount.google.com/permissions and re-authorizing")?;

    // Build authorized_user credentials
    let authorized_creds = serde_json::json!({
        "type": "authorized_user",
        "client_id": client_id,
        "client_secret": client_secret,
        "refresh_token": refresh_token,
        "token_uri": token_uri,
    });

    serde_json::to_string_pretty(&authorized_creds).map_err(|e| e.to_string())
}

fn extract_query_param(request: &str, param: &str) -> Option<String> {
    // Parse from "GET /?code=xxx&scope=... HTTP/1.1"
    let path = request.split_whitespace().nth(1)?;
    let query = path.split('?').nth(1)?;
    for pair in query.split('&') {
        let mut kv = pair.splitn(2, '=');
        if kv.next()? == param {
            return kv.next().map(|v| {
                v.replace('+', " ")
                    .split('%')
                    .enumerate()
                    .map(|(i, part)| {
                        if i == 0 {
                            part.to_string()
                        } else if part.len() >= 2 {
                            let hex = &part[..2];
                            let rest = &part[2..];
                            if let Ok(byte) = u8::from_str_radix(hex, 16) {
                                format!("{}{}", byte as char, rest)
                            } else {
                                format!("%{}", part)
                            }
                        } else {
                            format!("%{}", part)
                        }
                    })
                    .collect()
            });
        }
    }
    None
}

fn urlencoded(s: &str) -> String {
    let mut result = String::with_capacity(s.len());
    for byte in s.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                result.push(byte as char);
            }
            _ => {
                result.push_str(&format!("%{:02X}", byte));
            }
        }
    }
    result
}

async fn send_response(
    stream: &mut tokio::net::TcpStream,
    title: &str,
    body: &str,
) -> Result<(), std::io::Error> {
    use tokio::io::AsyncWriteExt;
    let html = format!(
        "<html><head><title>{}</title><style>body{{font-family:system-ui;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#1a1a1a;color:#e0e0e0}}</style></head><body><div style='text-align:center'><h2>{}</h2><p>{}</p></div></body></html>",
        title, title, body
    );
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        html.len(),
        html
    );
    stream.write_all(response.as_bytes()).await
}

async fn test_authorized_user(
    client: &reqwest::Client,
    creds: &serde_json::Value,
) -> Result<CalendarConnectionResult, String> {
    let required = ["client_id", "client_secret", "refresh_token"];
    let missing: Vec<&str> = required
        .iter()
        .filter(|f| {
            creds
                .get(**f)
                .and_then(|v| v.as_str())
                .map_or(true, |s| s.is_empty())
        })
        .cloned()
        .collect();

    if !missing.is_empty() {
        return Ok(CalendarConnectionResult {
            connected: false,
            message: format!("Missing required fields: {}", missing.join(", ")),
        });
    }

    let token_uri = creds
        .get("token_uri")
        .and_then(|v| v.as_str())
        .unwrap_or("https://oauth2.googleapis.com/token");

    let resp = client
        .post(token_uri)
        .form(&[
            ("client_id", creds["client_id"].as_str().unwrap_or("")),
            (
                "client_secret",
                creds["client_secret"].as_str().unwrap_or(""),
            ),
            (
                "refresh_token",
                creds["refresh_token"].as_str().unwrap_or(""),
            ),
            ("grant_type", "refresh_token"),
        ])
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if resp.status().is_success() {
        Ok(CalendarConnectionResult {
            connected: true,
            message: "Connected successfully".to_string(),
        })
    } else {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        let detail = serde_json::from_str::<serde_json::Value>(&body)
            .ok()
            .and_then(|v| v["error_description"].as_str().map(String::from))
            .unwrap_or_else(|| format!("HTTP {}", status));
        Ok(CalendarConnectionResult {
            connected: false,
            message: format!("Authentication failed: {}", detail),
        })
    }
}

async fn test_service_account(
    client: &reqwest::Client,
    creds: &serde_json::Value,
) -> Result<CalendarConnectionResult, String> {
    let required = [
        "project_id",
        "private_key_id",
        "private_key",
        "client_email",
        "client_id",
        "token_uri",
    ];
    let missing: Vec<&str> = required
        .iter()
        .filter(|f| {
            creds
                .get(**f)
                .and_then(|v| v.as_str())
                .map_or(true, |s| s.is_empty())
        })
        .cloned()
        .collect();

    if !missing.is_empty() {
        return Ok(CalendarConnectionResult {
            connected: false,
            message: format!("Missing required fields: {}", missing.join(", ")),
        });
    }

    let email = creds["client_email"].as_str().unwrap_or("?");

    // Verify the token endpoint is reachable
    let token_uri = creds["token_uri"].as_str().unwrap_or("");
    match client.post(token_uri).send().await {
        Ok(_) => Ok(CalendarConnectionResult {
            connected: true,
            message: format!("Service account: {}", email),
        }),
        Err(e) => Ok(CalendarConnectionResult {
            connected: false,
            message: format!("Cannot reach token endpoint: {}", e),
        }),
    }
}

// ── Calendar Events API ──

/// Refresh an OAuth2 token and return the access_token string.
async fn refresh_access_token(client: &reqwest::Client, creds: &serde_json::Value) -> Result<String, String> {
    let token_uri = creds
        .get("token_uri")
        .and_then(|v| v.as_str())
        .unwrap_or("https://oauth2.googleapis.com/token");

    let resp = client
        .post(token_uri)
        .form(&[
            ("client_id", creds["client_id"].as_str().unwrap_or("")),
            ("client_secret", creds["client_secret"].as_str().unwrap_or("")),
            ("refresh_token", creds["refresh_token"].as_str().unwrap_or("")),
            ("grant_type", "refresh_token"),
        ])
        .send()
        .await
        .map_err(|e| format!("Token refresh failed: {}", e))?;

    if !resp.status().is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Token refresh failed: {}", body));
    }

    let data: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    data["access_token"]
        .as_str()
        .map(String::from)
        .ok_or_else(|| "No access_token in response".to_string())
}

/// Fetch Google Calendar events for a date range.
/// `time_min` and `time_max` should be ISO 8601 date strings like "2026-03-02".
#[tauri::command]
pub async fn fetch_calendar_events(
    http: tauri::State<'_, HttpClient>,
    credentials_json: String,
    time_min: String,
    time_max: String,
) -> Result<Vec<CalendarEvent>, String> {
    if credentials_json.is_empty() {
        return Err("Calendar credentials not configured".to_string());
    }

    let creds: serde_json::Value =
        serde_json::from_str(&credentials_json).map_err(|e| format!("Invalid JSON: {}", e))?;

    let access_token = refresh_access_token(&http.0, &creds).await?;

    // Build the API URL — fetch from primary calendar
    let time_min_rfc = format!("{}T00:00:00Z", time_min);
    let time_max_rfc = format!("{}T23:59:59Z", time_max);

    let url = format!(
        "https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin={}&timeMax={}&singleEvents=true&orderBy=startTime&maxResults=50",
        urlencoded(&time_min_rfc),
        urlencoded(&time_max_rfc),
    );

    let resp = http.0
        .get(&url)
        .header("Authorization", format!("Bearer {}", access_token))
        .send()
        .await
        .map_err(|e| format!("Calendar API request failed: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Calendar API error ({}): {}", status, body));
    }

    let data: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;

    let events = data["items"]
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter(|item| {
                    // Skip cancelled events
                    item["status"].as_str() != Some("cancelled")
                })
                .map(|item| {
                    let (start, all_day) = if let Some(date) = item["start"]["date"].as_str() {
                        (date.to_string(), true)
                    } else {
                        (
                            item["start"]["dateTime"]
                                .as_str()
                                .unwrap_or("")
                                .to_string(),
                            false,
                        )
                    };

                    let end = if let Some(date) = item["end"]["date"].as_str() {
                        date.to_string()
                    } else {
                        item["end"]["dateTime"]
                            .as_str()
                            .unwrap_or("")
                            .to_string()
                    };

                    let attendees = item["attendees"]
                        .as_array()
                        .map(|a| a.len())
                        .unwrap_or(0);

                    let response_status = item["attendees"]
                        .as_array()
                        .and_then(|attendees| {
                            attendees.iter().find(|a| {
                                a["self"].as_bool().unwrap_or(false)
                            })
                        })
                        .and_then(|me| me["responseStatus"].as_str())
                        .unwrap_or("accepted")
                        .to_string();

                    CalendarEvent {
                        summary: item["summary"]
                            .as_str()
                            .unwrap_or("(no title)")
                            .to_string(),
                        start,
                        end,
                        all_day,
                        attendees,
                        status: response_status,
                    }
                })
                .collect()
        })
        .unwrap_or_default();

    Ok(events)
}
