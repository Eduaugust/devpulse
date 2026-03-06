use tauri::AppHandle;
use tauri_plugin_notification::NotificationExt;

// ── macOS-only: branded terminal-notifier ──

#[cfg(target_os = "macos")]
mod macos_notifier {
    use std::path::PathBuf;
    use std::sync::OnceLock;
    use tauri::{AppHandle, Manager};

    static NOTIFIER_BIN: OnceLock<Option<PathBuf>> = OnceLock::new();

    /// Create a branded copy of terminal-notifier with DevPulse icon + bundle ID.
    /// macOS shows the *sending app's* icon in notifications, so we need our own .app.
    fn ensure_branded_notifier(app: &AppHandle) -> Option<PathBuf> {
        let dest_dir = app.path().app_data_dir().ok()?;
        let dest_app = dest_dir.join("DevPulse Notifier.app");
        let dest_bin = dest_app.join("Contents/MacOS/terminal-notifier");

        if dest_bin.exists() {
            return Some(dest_bin);
        }

        let tn_app = find_terminal_notifier_app()?;

        std::fs::create_dir_all(&dest_dir).ok()?;
        let status = std::process::Command::new("cp")
            .args(["-R", &tn_app.to_string_lossy(), &dest_app.to_string_lossy()])
            .status()
            .ok()?;
        if !status.success() {
            return None;
        }

        let plist = dest_app.join("Contents/Info.plist");
        let _ = std::process::Command::new("/usr/libexec/PlistBuddy")
            .args(["-c", "Set :CFBundleIdentifier com.eduardo.devpulse.notifier",
                   &plist.to_string_lossy()])
            .status();
        let _ = std::process::Command::new("/usr/libexec/PlistBuddy")
            .args(["-c", "Set :CFBundleName DevPulse",
                   &plist.to_string_lossy()])
            .status();

        let icns_src = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("icons/icon.icns");
        let icns_dest = dest_app.join("Contents/Resources/Terminal.icns");
        if icns_src.exists() {
            let _ = std::fs::copy(&icns_src, &icns_dest);
        }

        let _ = std::process::Command::new("touch").arg(&dest_app).status();

        if dest_bin.exists() { Some(dest_bin) } else { None }
    }

    fn find_terminal_notifier_app() -> Option<PathBuf> {
        for base in &["/opt/homebrew/Cellar/terminal-notifier", "/usr/local/Cellar/terminal-notifier"] {
            let brew_dir = PathBuf::from(base);
            if let Ok(entries) = std::fs::read_dir(&brew_dir) {
                for entry in entries.flatten() {
                    let app = entry.path().join("terminal-notifier.app");
                    if app.is_dir() {
                        return Some(app);
                    }
                }
            }
        }
        None
    }

    pub fn get_notifier_bin(app: &AppHandle) -> Option<&'static PathBuf> {
        NOTIFIER_BIN
            .get_or_init(|| ensure_branded_notifier(app))
            .as_ref()
    }
}

/// Send a notification using platform-appropriate method.
/// macOS: try branded terminal-notifier first, then fall through to Tauri plugin.
/// All platforms: Tauri notification plugin as universal backend.
pub fn send_notification_with_app(app: &AppHandle, title: &str, body: &str) {
    #[cfg(target_os = "macos")]
    {
        if let Some(bin) = macos_notifier::get_notifier_bin(app) {
            let result = std::process::Command::new(bin)
                .args(["-title", title, "-message", body])
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .spawn();
            if result.is_ok() {
                return;
            }
        }
    }

    // Universal fallback: Tauri notification plugin (works on all platforms)
    if let Err(e) = app.notification().builder().title(title).body(body).show() {
        log::warn!("Failed to send notification: {}", e);
    }
}

#[tauri::command]
pub async fn check_command_available(_app: AppHandle, command: String) -> Result<bool, String> {
    // Use the `which` crate for cross-platform command detection
    Ok(which::which(&command).is_ok())
}

#[tauri::command]
pub fn send_test_notification(app: AppHandle) -> Result<String, String> {
    send_notification_with_app(
        &app,
        "DevPulse",
        "Test notification — if you see this, notifications work!",
    );
    Ok("Notification sent".to_string())
}
