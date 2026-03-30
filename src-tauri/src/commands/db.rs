use crate::db;
use crate::db::Database;

#[tauri::command]
pub fn get_events(
    db: tauri::State<'_, Database>,
    event_type: Option<String>,
    repo: Option<String>,
    search: Option<String>,
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<Vec<db::DevEvent>, String> {
    db.get_events(
        event_type.as_deref(),
        repo.as_deref(),
        search.as_deref(),
        limit.unwrap_or(50),
        offset.unwrap_or(0),
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_recent_events(db: tauri::State<'_, Database>) -> Result<Vec<db::DevEvent>, String> {
    db.get_recent_events(10).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_local_repos(db: tauri::State<'_, Database>) -> Result<Vec<db::LocalRepo>, String> {
    db.get_local_repos().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn add_local_repo(
    db: tauri::State<'_, Database>,
    path: String,
    name: String,
) -> Result<i64, String> {
    db.add_local_repo(&path, &name).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn remove_local_repo(db: tauri::State<'_, Database>, id: i64) -> Result<(), String> {
    db.remove_local_repo(id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_monitored_repos(
    db: tauri::State<'_, Database>,
) -> Result<Vec<db::MonitoredRepo>, String> {
    db.get_monitored_repos().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn add_monitored_repo(
    db: tauri::State<'_, Database>,
    owner: String,
    name: String,
    provider: Option<String>,
) -> Result<i64, String> {
    db.add_monitored_repo(&owner, &name, provider.as_deref().unwrap_or("github"))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn remove_monitored_repo(db: tauri::State<'_, Database>, id: i64) -> Result<(), String> {
    db.remove_monitored_repo(id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_monitored_repo_base_branch(
    db: tauri::State<'_, Database>,
    id: i64,
    base_branch: String,
) -> Result<(), String> {
    db.update_monitored_repo_base_branch(id, &base_branch)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_settings(db: tauri::State<'_, Database>) -> Result<Vec<db::Setting>, String> {
    db.get_settings().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_setting(
    db: tauri::State<'_, Database>,
    key: String,
    value: String,
) -> Result<(), String> {
    db.update_setting(&key, &value).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_claude_session(
    db: tauri::State<'_, Database>,
    prompt: String,
    working_directory: String,
    model: String,
    permission_mode: String,
    max_budget: Option<f64>,
) -> Result<i64, String> {
    let session = db::ClaudeSession {
        id: None,
        prompt,
        working_directory,
        model,
        permission_mode,
        max_budget,
        status: "running".to_string(),
        result_text: String::new(),
        cost_usd: None,
        duration_ms: None,
        created_at: chrono::Utc::now().to_rfc3339(),
        finished_at: None,
    };
    db.insert_claude_session(&session).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_claude_session(
    db: tauri::State<'_, Database>,
    id: i64,
    status: String,
    result_text: String,
    cost_usd: Option<f64>,
    duration_ms: Option<i64>,
) -> Result<(), String> {
    db.update_claude_session_status(id, &status, &result_text, cost_usd, duration_ms)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_claude_sessions(
    db: tauri::State<'_, Database>,
    limit: Option<i64>,
) -> Result<Vec<db::ClaudeSession>, String> {
    db.get_claude_sessions(limit.unwrap_or(50)).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_claude_session(db: tauri::State<'_, Database>, id: i64) -> Result<(), String> {
    db.delete_claude_session(id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_commands(db: tauri::State<'_, Database>) -> Result<Vec<db::CommandDef>, String> {
    db.get_commands().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_command_by_slug(db: tauri::State<'_, Database>, slug: String) -> Result<Option<db::CommandDef>, String> {
    db.get_command_by_slug(&slug).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_command(db: tauri::State<'_, Database>, command: db::CommandDef) -> Result<i64, String> {
    if let Some(id) = command.id {
        db.update_command(&command).map_err(|e| e.to_string())?;
        Ok(id)
    } else {
        db.insert_command(&command).map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub fn delete_command(db: tauri::State<'_, Database>, id: i64) -> Result<(), String> {
    db.delete_command(id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn reset_builtin_commands(db: tauri::State<'_, Database>) -> Result<(), String> {
    db.reset_builtin_commands().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_command_run(
    db: tauri::State<'_, Database>,
    command_id: i64,
    parameters_json: String,
) -> Result<i64, String> {
    let run = db::CommandRun {
        id: None,
        command_id,
        parameters_json,
        status: "running".to_string(),
        result_text: String::new(),
        error_text: String::new(),
        duration_ms: None,
        created_at: chrono::Utc::now().to_rfc3339(),
        finished_at: None,
    };
    db.insert_command_run(&run).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_command_run(
    db: tauri::State<'_, Database>,
    id: i64,
    status: String,
    result_text: String,
    error_text: String,
    duration_ms: Option<i64>,
) -> Result<(), String> {
    db.update_command_run_status(id, &status, &result_text, &error_text, duration_ms)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_command_run(db: tauri::State<'_, Database>, id: i64) -> Result<(), String> {
    db.delete_command_run(id).map_err(|e| e.to_string())
}

// ── Invoice Profiles ──

#[tauri::command]
pub fn get_invoice_profiles(
    db: tauri::State<'_, Database>,
    profile_type: Option<String>,
) -> Result<Vec<db::InvoiceProfile>, String> {
    db.get_invoice_profiles(profile_type.as_deref())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_invoice_profile(
    db: tauri::State<'_, Database>,
    profile: db::InvoiceProfile,
) -> Result<i64, String> {
    if let Some(id) = profile.id {
        db.update_invoice_profile(&profile).map_err(|e| e.to_string())?;
        Ok(id)
    } else {
        db.insert_invoice_profile(&profile).map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub fn delete_invoice_profile(db: tauri::State<'_, Database>, id: i64) -> Result<(), String> {
    db.delete_invoice_profile(id).map_err(|e| e.to_string())
}

// ── Invoices ──

#[tauri::command]
pub fn get_invoices(
    db: tauri::State<'_, Database>,
    limit: Option<i64>,
) -> Result<Vec<db::Invoice>, String> {
    db.get_invoices(limit.unwrap_or(50)).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_invoice(db: tauri::State<'_, Database>, id: i64) -> Result<Option<db::Invoice>, String> {
    db.get_invoice(id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_invoice(db: tauri::State<'_, Database>, invoice: db::Invoice) -> Result<i64, String> {
    if let Some(id) = invoice.id {
        db.update_invoice(&invoice).map_err(|e| e.to_string())?;
        Ok(id)
    } else {
        db.insert_invoice(&invoice).map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub fn delete_invoice(db: tauri::State<'_, Database>, id: i64) -> Result<(), String> {
    db.delete_invoice(id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_command_runs(
    db: tauri::State<'_, Database>,
    command_id: Option<i64>,
    limit: Option<i64>,
) -> Result<Vec<db::CommandRun>, String> {
    db.get_command_runs(command_id, limit.unwrap_or(50))
        .map_err(|e| e.to_string())
}

// ── Activity Mappings ──

#[tauri::command]
pub fn get_activity_mappings(db: tauri::State<'_, Database>) -> Result<Vec<db::ActivityMapping>, String> {
    db.get_activity_mappings().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_activity_mapping(
    db: tauri::State<'_, Database>,
    mapping: db::ActivityMapping,
) -> Result<i64, String> {
    db.save_activity_mapping(&mapping).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_activity_mapping(db: tauri::State<'_, Database>, id: i64) -> Result<(), String> {
    db.delete_activity_mapping(id).map_err(|e| e.to_string())
}

// ── Autofill Runs ──

#[tauri::command]
pub fn get_autofill_runs(
    db: tauri::State<'_, Database>,
    limit: Option<i64>,
) -> Result<Vec<db::AutofillRun>, String> {
    db.get_autofill_runs(limit.unwrap_or(10)).map_err(|e| e.to_string())
}
