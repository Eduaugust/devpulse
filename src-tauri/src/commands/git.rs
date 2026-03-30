use serde::{Deserialize, Serialize};
use tauri_plugin_shell::ShellExt;

use crate::db::Database;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GitLogEntry {
    pub hash: String,
    pub date: String,
    pub message: String,
    pub repo_name: String,
}

#[tauri::command]
pub async fn fetch_git_log(
    app: tauri::AppHandle,
    db: tauri::State<'_, Database>,
    after_date: String,
    before_date: String,
) -> Result<Vec<GitLogEntry>, String> {
    let repos = db.get_local_repos().map_err(|e| e.to_string())?;
    let mut all_entries = Vec::new();

    for repo in &repos {
        let path = &repo.path;

        // Get user.name for this repo to filter by author
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
            format!("--after={}", after_date),
            format!("--before={}", before_date),
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
                        all_entries.push(GitLogEntry {
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

    Ok(all_entries)
}
