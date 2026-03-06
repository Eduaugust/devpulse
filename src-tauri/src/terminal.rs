use serde::Deserialize;
use std::io::Write;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum TerminalApp {
    // macOS
    #[serde(alias = "terminal")]
    TerminalApp,
    Iterm2,
    Warp,
    // Windows
    WindowsTerminal,
    Powershell,
    // Linux
    GnomeTerminal,
    Konsole,
    Alacritty,
    Xterm,
}

impl Default for TerminalApp {
    fn default() -> Self {
        #[cfg(target_os = "macos")]
        { Self::TerminalApp }
        #[cfg(target_os = "windows")]
        { Self::WindowsTerminal }
        #[cfg(target_os = "linux")]
        { Self::gnome_or_first_available() }
        #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
        { Self::Xterm }
    }
}

#[cfg(target_os = "linux")]
impl TerminalApp {
    fn gnome_or_first_available() -> Self {
        let candidates = [
            ("gnome-terminal", Self::GnomeTerminal),
            ("konsole", Self::Konsole),
            ("alacritty", Self::Alacritty),
            ("xterm", Self::Xterm),
        ];
        for (cmd, variant) in candidates {
            if which::which(cmd).is_ok() {
                return variant;
            }
        }
        Self::GnomeTerminal
    }
}

/// Open a system terminal window running `claude` with optional initial prompt.
#[tauri::command]
pub fn open_claude_terminal(
    cwd: Option<String>,
    args: Option<Vec<String>>,
    initial_prompt: Option<String>,
    terminal: Option<String>,
) -> Result<(), String> {
    let terminal_app = match terminal.as_deref() {
        // macOS
        Some("iterm2") => TerminalApp::Iterm2,
        Some("warp") => TerminalApp::Warp,
        // Windows
        Some("windows-terminal") => TerminalApp::WindowsTerminal,
        Some("powershell") => TerminalApp::Powershell,
        // Linux
        Some("gnome-terminal") => TerminalApp::GnomeTerminal,
        Some("konsole") => TerminalApp::Konsole,
        Some("alacritty") => TerminalApp::Alacritty,
        Some("xterm") => TerminalApp::Xterm,
        _ => TerminalApp::default(),
    };

    let script_path = create_launch_script(cwd, args.unwrap_or_default(), initial_prompt)?;
    open_terminal(&terminal_app, &script_path)
}

/// Create a temporary bash/ps1 script that launches claude with the right
/// directory and optional initial prompt.
fn create_launch_script(
    cwd: Option<String>,
    args: Vec<String>,
    initial_prompt: Option<String>,
) -> Result<String, String> {
    let id = std::process::id();
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let tmp = std::env::temp_dir();

    if cfg!(target_os = "windows") {
        let script_path = format!(
            "{}\\devpulse-launch-{}-{}.ps1",
            tmp.display(), id, ts
        );
        let mut script = String::new();

        if let Some(dir) = &cwd {
            script.push_str(&format!("Set-Location '{}'\n", dir.replace("'", "''")));
        }

        script.push_str("$env:CLAUDECODE = $null\n");
        let mut cmd_parts = vec!["claude".to_string()];
        for arg in &args {
            cmd_parts.push(format!("'{}'", arg.replace("'", "''")));
        }

        if let Some(prompt) = &initial_prompt {
            let prompt_path = format!(
                "{}\\devpulse-prompt-{}-{}.txt",
                tmp.display(), id, ts
            );
            std::fs::write(&prompt_path, prompt).map_err(|e| e.to_string())?;
            cmd_parts.push(format!(
                "(Get-Content -Raw '{}')",
                prompt_path.replace("'", "''")
            ));
            script.push_str(&format!(
                "& {} ; Remove-Item -Force '{}' -ErrorAction SilentlyContinue\n",
                cmd_parts.join(" "),
                prompt_path.replace("'", "''")
            ));
        } else {
            script.push_str(&format!("& {}\n", cmd_parts.join(" ")));
        }

        script.push_str(&format!(
            "Remove-Item -Force '{}' -ErrorAction SilentlyContinue\n",
            script_path.replace("'", "''")
        ));

        std::fs::write(&script_path, &script).map_err(|e| e.to_string())?;
        Ok(script_path)
    } else {
        // Unix (macOS + Linux)
        let script_path = format!("{}/devpulse-launch-{}-{}.sh", tmp.display(), id, ts);
        let mut f = std::fs::File::create(&script_path).map_err(|e| e.to_string())?;

        writeln!(f, "#!/bin/bash").map_err(|e| e.to_string())?;

        if let Some(dir) = &cwd {
            writeln!(f, "cd '{}'", dir.replace("'", "'\\''")).map_err(|e| e.to_string())?;
        }

        writeln!(f, "unset CLAUDECODE").map_err(|e| e.to_string())?;

        let mut cmd_parts = vec!["exec claude".to_string()];
        for arg in &args {
            cmd_parts.push(format!("'{}'", arg.replace("'", "'\\''")));
        }

        if let Some(prompt) = &initial_prompt {
            let prompt_path = format!("{}/devpulse-prompt-{}-{}.txt", tmp.display(), id, ts);
            std::fs::write(&prompt_path, prompt).map_err(|e| e.to_string())?;

            writeln!(f, "DEVPULSE_PROMPT=$(<'{}')", prompt_path.replace("'", "'\\''"))
                .map_err(|e| e.to_string())?;
            writeln!(f, "rm -f '{}'", prompt_path.replace("'", "'\\''"))
                .map_err(|e| e.to_string())?;

            cmd_parts.push("\"$DEVPULSE_PROMPT\"".to_string());
        }

        writeln!(f, "{}", cmd_parts.join(" ")).map_err(|e| e.to_string())?;

        drop(f);

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&script_path, std::fs::Permissions::from_mode(0o755))
                .map_err(|e| e.to_string())?;
        }

        Ok(script_path)
    }
}

/// Open the given script in the user's preferred terminal emulator.
fn open_terminal(terminal_app: &TerminalApp, script_path: &str) -> Result<(), String> {
    match terminal_app {
        // macOS
        TerminalApp::TerminalApp => open_macos_terminal(script_path),
        TerminalApp::Iterm2 => open_iterm2(script_path),
        TerminalApp::Warp => open_warp(script_path),
        // Windows
        TerminalApp::WindowsTerminal => open_windows_terminal(script_path),
        TerminalApp::Powershell => open_powershell(script_path),
        // Linux
        TerminalApp::GnomeTerminal => open_linux_terminal("gnome-terminal", &["--"], script_path),
        TerminalApp::Konsole => open_linux_terminal("konsole", &["-e"], script_path),
        TerminalApp::Alacritty => open_linux_terminal("alacritty", &["-e"], script_path),
        TerminalApp::Xterm => open_linux_terminal("xterm", &["-e"], script_path),
    }
}

// ── macOS terminals ──

#[cfg(target_os = "macos")]
fn open_macos_terminal(script_path: &str) -> Result<(), String> {
    let escaped = script_path.replace("\\", "\\\\").replace("\"", "\\\"");
    let applescript = format!(
        r#"tell application "Terminal"
    activate
    do script "{}"
end tell"#,
        escaped
    );

    std::process::Command::new("osascript")
        .args(["-e", &applescript])
        .spawn()
        .map_err(|e| format!("Failed to open Terminal.app: {}", e))?;
    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn open_macos_terminal(_script_path: &str) -> Result<(), String> {
    Err("Terminal.app is only available on macOS".to_string())
}

#[cfg(target_os = "macos")]
fn open_iterm2(script_path: &str) -> Result<(), String> {
    let escaped = script_path.replace("\\", "\\\\").replace("\"", "\\\"");
    let applescript = format!(
        r#"tell application "iTerm2"
    activate
    set newWindow to (create window with default profile)
    tell current session of newWindow
        write text "{}"
    end tell
end tell"#,
        escaped
    );

    std::process::Command::new("osascript")
        .args(["-e", &applescript])
        .spawn()
        .map_err(|e| format!("Failed to open iTerm2: {}", e))?;
    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn open_iterm2(_script_path: &str) -> Result<(), String> {
    Err("iTerm2 is only available on macOS".to_string())
}

#[cfg(target_os = "macos")]
fn open_warp(script_path: &str) -> Result<(), String> {
    std::process::Command::new("open")
        .args(["-a", "Warp", script_path])
        .spawn()
        .map_err(|e| format!("Failed to open Warp: {}", e))?;
    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn open_warp(_script_path: &str) -> Result<(), String> {
    Err("Warp is only available on macOS".to_string())
}

// ── Windows terminals ──

#[cfg(target_os = "windows")]
fn open_windows_terminal(script_path: &str) -> Result<(), String> {
    std::process::Command::new("wt.exe")
        .args(["powershell", "-NoExit", "-File", script_path])
        .spawn()
        .map_err(|e| format!("Failed to open Windows Terminal: {}", e))?;
    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn open_windows_terminal(_script_path: &str) -> Result<(), String> {
    Err("Windows Terminal is not available on this platform".to_string())
}

#[cfg(target_os = "windows")]
fn open_powershell(script_path: &str) -> Result<(), String> {
    std::process::Command::new("powershell")
        .args(["-NoExit", "-File", script_path])
        .spawn()
        .map_err(|e| format!("Failed to open PowerShell: {}", e))?;
    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn open_powershell(_script_path: &str) -> Result<(), String> {
    Err("PowerShell is not available on this platform".to_string())
}

// ── Linux terminals ──

#[cfg(target_os = "linux")]
fn open_linux_terminal(cmd: &str, flag: &[&str], script_path: &str) -> Result<(), String> {
    let mut args: Vec<&str> = flag.to_vec();
    args.push("bash");
    args.push(script_path);
    std::process::Command::new(cmd)
        .args(&args)
        .spawn()
        .map_err(|e| format!("Failed to open {}: {}", cmd, e))?;
    Ok(())
}

#[cfg(not(target_os = "linux"))]
fn open_linux_terminal(cmd: &str, _flag: &[&str], _script_path: &str) -> Result<(), String> {
    Err(format!("{} is only available on Linux", cmd))
}
