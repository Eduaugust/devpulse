mod commands;
mod db;
mod monitor;
mod terminal;
mod tray;

use db::Database;
use tauri::Manager;

/// Shared HTTP client for general API calls (Claude, Calendar, etc.)
pub struct HttpClient(pub reqwest::Client);

/// Kimai-specific HTTP client (no redirect following).
pub struct KimaiHttpClient(pub reqwest::Client);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_sql::Builder::new().build())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_os::init())
        // MacosLauncher::LaunchAgent is only used on macOS; the plugin ignores it on other platforms
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .setup(|app| {
            // Initialize database
            let app_dir = app
                .path()
                .app_data_dir()
                .expect("Failed to get app data dir");
            let database =
                Database::new(app_dir).expect("Failed to initialize database");
            app.manage(database);
            app.manage(HttpClient(reqwest::Client::new()));
            app.manage(KimaiHttpClient(
                reqwest::Client::builder()
                    .redirect(reqwest::redirect::Policy::none())
                    .build()
                    .expect("Failed to build Kimai HTTP client"),
            ));

            // Setup tray icon
            tray::setup_tray(app.handle())?;

            // On non-macOS: restore native decorations so window controls are visible
            // (tauri.conf.json sets Overlay + hiddenTitle for macOS)
            #[cfg(not(target_os = "macos"))]
            {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.set_decorations(true);
                    let _ = window.set_title("DevPulse");
                }
            }

            // Hide main window on close (keep in tray)
            let main_window = app.get_webview_window("main");
            if let Some(window) = main_window {
                let w = window.clone();
                let app_handle = app.handle().clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = w.hide();
                        // macOS: remove from Dock, keep only in menu bar tray
                        #[cfg(target_os = "macos")]
                        let _ = app_handle.set_dock_visibility(false);
                        // Windows/Linux: hide from taskbar, keep only in system tray
                        #[cfg(not(target_os = "macos"))]
                        let _ = w.set_skip_taskbar(true);
                    }
                });
            }

            // Auto-hide tray panel on blur
            let tray_panel = app.get_webview_window("tray-panel");
            if let Some(panel) = tray_panel {
                let p = panel.clone();
                panel.on_window_event(move |event| {
                    if let tauri::WindowEvent::Focused(false) = event {
                        let _ = p.hide();
                    }
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // DB commands
            commands::db::get_events,
            commands::db::get_recent_events,
            commands::db::get_local_repos,
            commands::db::add_local_repo,
            commands::db::remove_local_repo,
            commands::db::get_monitored_repos,
            commands::db::add_monitored_repo,
            commands::db::remove_monitored_repo,
            commands::db::update_monitored_repo_base_branch,
            commands::db::get_settings,
            commands::db::update_setting,
            commands::db::create_claude_session,
            commands::db::update_claude_session,
            commands::db::get_claude_sessions,
            commands::db::delete_claude_session,
            commands::db::get_commands,
            commands::db::get_command_by_slug,
            commands::db::save_command,
            commands::db::delete_command,
            commands::db::reset_builtin_commands,
            commands::db::create_command_run,
            commands::db::update_command_run,
            commands::db::delete_command_run,
            commands::db::get_command_runs,
            // GitHub commands
            commands::github::check_gh_auth,
            commands::github::fetch_my_prs,
            commands::github::fetch_my_reviews,
            commands::github::fetch_notifications,
            commands::github::post_gh_review,
            // Integration commands
            commands::kimai::test_kimai_connection,
            commands::kimai::fetch_kimai_timesheets,
            commands::kimai::ensure_kimai_mcp,
            commands::calendar::test_calendar_connection,
            commands::calendar::authorize_calendar,
            commands::calendar::cancel_calendar_auth,
            commands::calendar::fetch_calendar_events,
            commands::claude::test_claude_connection,
            commands::claude::generate_with_ai,
            commands::claude::run_claude_cli,
            // System commands
            commands::system::check_command_available,
            commands::system::send_test_notification,
            // Terminal commands
            terminal::open_claude_terminal,
            // Monitor commands
            monitor::start_monitor,
            monitor::stop_monitor,
            monitor::is_monitor_running,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
