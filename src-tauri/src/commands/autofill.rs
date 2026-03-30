use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager};

use super::gather::gather_data_internal;
use crate::commands::claude::run_claude_cli_with_args;
use crate::commands::system::send_notification_with_app;
use crate::db::Database;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AutofillResult {
    pub run_id: i64,
    pub success: bool,
    pub message: String,
    pub entries_created: i64,
}

#[tauri::command]
pub async fn run_autofill(
    app: tauri::AppHandle,
    target_date: String,
) -> Result<AutofillResult, String> {
    run_autofill_internal(&app, &target_date).await
}

/// Internal version callable from the scheduler (no State injection).
pub async fn run_autofill_internal(
    app: &tauri::AppHandle,
    target_date: &str,
) -> Result<AutofillResult, String> {
    let db = app.state::<Database>();
    let start_time = std::time::Instant::now();

    // Create run record
    let run_id = db
        .create_autofill_run(target_date)
        .map_err(|e| e.to_string())?;

    // 1. Ensure Kimai MCP is configured
    let kimai_url = super::credentials::get_credential(app, "kimai_url");
    let kimai_token = super::credentials::get_credential(app, "kimai_token");
    if kimai_url.is_empty() || kimai_token.is_empty() {
        let err = "Kimai credentials not configured".to_string();
        let _ = db.update_autofill_run(run_id, "error", "", &err, 0, None);
        return Ok(AutofillResult {
            run_id,
            success: false,
            message: err,
            entries_created: 0,
        });
    }

    // Setup MCP (ignore errors — it may already be configured)
    let _ = super::kimai::setup_kimai_mcp(
        app.clone(),
        app.state::<crate::HttpClient>(),
        kimai_url,
        kimai_token,
    )
    .await;

    // 2. Gather data
    let context_days = db
        .get_setting("autofill_context_days")
        .ok()
        .flatten()
        .and_then(|v| v.parse::<i64>().ok())
        .unwrap_or(14);

    let date_to = format!("{}T23:59:59", target_date);
    let date_from = format!("{}T00:00:00", target_date);

    let gather_result = match gather_data_internal(
        app,
        &date_from,
        &date_to,
        true,  // git
        true,  // github
        true,  // kimai
        true,  // calendar
        context_days,
    )
    .await
    {
        Ok(r) => r,
        Err(e) => {
            let err = format!("Data gathering failed: {}", e);
            let duration = start_time.elapsed().as_millis() as i64;
            let _ = db.update_autofill_run(run_id, "error", "", &err, 0, Some(duration));
            return Ok(AutofillResult {
                run_id,
                success: false,
                message: err,
                entries_created: 0,
            });
        }
    };

    // 3. Build prompt
    let mut data_sections = Vec::new();
    if !gather_result.git_data.is_empty() {
        data_sections.push(gather_result.git_data);
    }
    if !gather_result.github_data.is_empty() {
        data_sections.push(gather_result.github_data);
    }
    if !gather_result.calendar_data.is_empty() {
        data_sections.push(gather_result.calendar_data);
    }
    if !gather_result.existing_kimai_entries.is_empty() {
        data_sections.push(gather_result.existing_kimai_entries);
    }
    if !gather_result.kimai_data.is_empty() {
        data_sections.push(gather_result.kimai_data);
    }
    if !gather_result.activity_mappings.is_empty() {
        data_sections.push(gather_result.activity_mappings);
    }

    if data_sections.is_empty() {
        let msg = "No data collected for the target date".to_string();
        let duration = start_time.elapsed().as_millis() as i64;
        let _ = db.update_autofill_run(run_id, "completed", &msg, "", 0, Some(duration));
        return Ok(AutofillResult {
            run_id,
            success: true,
            message: msg,
            entries_created: 0,
        });
    }

    let gathered = data_sections.join("\n\n");

    let prompt = format!(
        r#"You have access to Kimai MCP tools. Create timesheet entries for {target_date} based on the data below.

IMPORTANT RULES:
1. Check the "Existing Kimai Entries" section — do NOT create duplicates
2. Use the "Activity Mappings" section to match calendar events to Kimai projects/activities
3. When an Activity Mapping specifies tags, you MUST include those tags when creating the timesheet entry
4. For calendar events with no mapping, use your best judgment based on the Kimai Context
5. Create entries directly using the Kimai MCP tools — do NOT ask for confirmation
6. Set descriptions based on the actual work done (git commits, PRs, calendar event names)
7. Ensure entries don't overlap in time
8. Round times to the nearest 15 minutes

---

{gathered}

---

Create the timesheet entries now using the Kimai MCP tools. After creating all entries, output a summary of what was created."#
    );

    // 4. Run Claude CLI
    let claude_result = run_claude_cli_with_args(
        prompt,
        &["--allowedTools", "mcp__kimai__*"],
    ).await;

    let duration = start_time.elapsed().as_millis() as i64;

    match claude_result {
        Ok(output) => {
            // Count lines that mention "created" as a rough proxy for entries
            let entries_created = output
                .lines()
                .filter(|l| {
                    let lower = l.to_lowercase();
                    lower.contains("created") || lower.contains("entry")
                })
                .count() as i64;

            let _ = db.update_autofill_run(
                run_id,
                "completed",
                &output,
                "",
                entries_created,
                Some(duration),
            );

            send_notification_with_app(
                app,
                "Auto-Fill Complete",
                &format!("Timesheet for {} filled", target_date),
            );
            let _ = app.emit("autofill:completed", serde_json::json!({
                "run_id": run_id,
                "success": true,
                "target_date": target_date,
                "entries_created": entries_created,
            }));

            Ok(AutofillResult {
                run_id,
                success: true,
                message: output,
                entries_created,
            })
        }
        Err(e) => {
            let _ = db.update_autofill_run(run_id, "error", "", &e, 0, Some(duration));

            send_notification_with_app(
                app,
                "Auto-Fill Failed",
                &format!("Failed to fill timesheet for {}", target_date),
            );
            let _ = app.emit("autofill:completed", serde_json::json!({
                "run_id": run_id,
                "success": false,
                "target_date": target_date,
                "error": &e,
            }));

            Ok(AutofillResult {
                run_id,
                success: false,
                message: e,
                entries_created: 0,
            })
        }
    }
}
