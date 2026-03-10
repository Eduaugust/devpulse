use serde::{Deserialize, Serialize};
use std::io::Write;
use std::process::{Command as StdCommand, Stdio};

use crate::HttpClient;

#[derive(Debug, Serialize, Deserialize)]
pub struct ClaudeConnectionResult {
    pub connected: bool,
    pub message: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AiGenerationResult {
    pub text: String,
    pub model: String,
}

#[tauri::command]
pub async fn test_claude_connection(
    http: tauri::State<'_, HttpClient>,
    api_key: String,
) -> Result<ClaudeConnectionResult, String> {
    if api_key.is_empty() {
        return Ok(ClaudeConnectionResult {
            connected: false,
            message: "API key is required".to_string(),
        });
    }

    let response = http.0
        .get("https://api.anthropic.com/v1/models")
        .header("x-api-key", &api_key)
        .header("anthropic-version", "2023-06-01")
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if response.status().is_success() {
        Ok(ClaudeConnectionResult {
            connected: true,
            message: "Connected to Anthropic API".to_string(),
        })
    } else {
        Ok(ClaudeConnectionResult {
            connected: false,
            message: format!("HTTP {}", response.status()),
        })
    }
}

#[tauri::command]
pub async fn generate_with_ai(
    http: tauri::State<'_, HttpClient>,
    api_key: String,
    prompt: String,
) -> Result<AiGenerationResult, String> {
    if api_key.is_empty() {
        return Err("API key is required".to_string());
    }

    let body = serde_json::json!({
        "model": "claude-sonnet-4-6",
        "max_tokens": 4096,
        "messages": [
            {
                "role": "user",
                "content": prompt
            }
        ]
    });

    let response = http.0
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", &api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(format!("API error ({}): {}", status, text));
    }

    let result: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;

    let text = result["content"]
        .as_array()
        .and_then(|arr| arr.first())
        .and_then(|block| block["text"].as_str())
        .unwrap_or("")
        .to_string();

    let model = result["model"].as_str().unwrap_or("unknown").to_string();

    Ok(AiGenerationResult { text, model })
}

/// Run `claude -p <prompt> --output-format text` with CLAUDECODE env unset.
/// This avoids the "nested session" error when DevPulse itself runs inside Claude Code.
#[tauri::command]
pub async fn run_claude_cli(prompt: String) -> Result<String, String> {
    // Spawn in a blocking thread since std::process::Command is sync
    tokio::task::spawn_blocking(move || {
        // Get PATH from a login shell so we find claude
        let path = get_shell_path();

        // Pass prompt via stdin to avoid argument length limits
        // Use StdCommand::new("claude") with .env_remove("CLAUDECODE") — works on all platforms
        let mut child = StdCommand::new("claude")
            .args(["-p", "-", "--output-format", "text"])
            .env_remove("CLAUDECODE")
            .env("PATH", &path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to spawn claude: {}", e))?;

        if let Some(mut stdin) = child.stdin.take() {
            let _ = stdin.write_all(prompt.as_bytes());
        }

        let output = child
            .wait_with_output()
            .map_err(|e| format!("Failed to wait for claude: {}", e))?;

        if output.status.success() {
            Ok(String::from_utf8_lossy(&output.stdout).to_string())
        } else {
            let stderr = String::from_utf8_lossy(&output.stderr).to_string();
            let stdout = String::from_utf8_lossy(&output.stdout).to_string();
            let code = output.status.code().map(|c| c.to_string()).unwrap_or("?".into());
            let detail = if !stderr.is_empty() { &stderr } else { &stdout };
            Err(format!("Claude CLI exited (code {}): {}", code, detail))
        }
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

/// Check if the `claude` CLI is installed and reachable in the user's PATH.
/// Runs `claude --version` and returns the version string on success.
#[tauri::command]
pub async fn test_claude_cli() -> Result<ClaudeConnectionResult, String> {
    tokio::task::spawn_blocking(|| {
        let path = get_shell_path();

        let output = StdCommand::new("claude")
            .args(["--version"])
            .env_remove("CLAUDECODE")
            .env("PATH", &path)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output();

        match output {
            Ok(out) if out.status.success() => {
                let version = String::from_utf8_lossy(&out.stdout).trim().to_string();
                Ok(ClaudeConnectionResult {
                    connected: true,
                    message: if version.is_empty() {
                        "Claude CLI found".to_string()
                    } else {
                        format!("Claude CLI {}", version)
                    },
                })
            }
            Ok(out) => {
                let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
                Ok(ClaudeConnectionResult {
                    connected: false,
                    message: if stderr.is_empty() {
                        format!("CLI exited with code {}", out.status.code().unwrap_or(-1))
                    } else {
                        stderr
                    },
                })
            }
            Err(_) => Ok(ClaudeConnectionResult {
                connected: false,
                message: "Claude CLI not found in PATH".to_string(),
            }),
        }
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

fn get_shell_path() -> String {
    #[cfg(unix)]
    {
        // Try the user's login shell to get the full PATH (picks up .zshrc, .bashrc, etc.)
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string());
        let output = StdCommand::new(&shell)
            .args(["-l", "-c", "echo $PATH"])
            .output();
        if let Ok(output) = output {
            if output.status.success() {
                return String::from_utf8_lossy(&output.stdout).trim().to_string();
            }
        }
    }

    // Fallback (also the primary path on Windows where login shell trick isn't needed)
    std::env::var("PATH").unwrap_or_default()
}
