use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};
use uuid::Uuid;

/// Active PTY session — holds the master (for resize) and writer (for input).
struct PtySession {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
}

/// Managed state: map of session_id → PtySession.
pub struct PtyState(Mutex<HashMap<String, PtySession>>);

impl Default for PtyState {
    fn default() -> Self {
        Self(Mutex::new(HashMap::new()))
    }
}

#[derive(Clone, serde::Serialize)]
struct PtyDataPayload {
    session_id: String,
    data: String,
}

#[derive(Clone, serde::Serialize)]
struct PtyExitPayload {
    session_id: String,
    code: Option<u32>,
}

/// Spawn a new PTY running `command` with `args`.
/// Returns the session_id (UUID).
#[tauri::command]
pub fn spawn_pty(
    app: AppHandle,
    state: tauri::State<'_, PtyState>,
    command: String,
    args: Vec<String>,
    cwd: Option<String>,
    cols: u16,
    rows: u16,
) -> Result<String, String> {
    let pty_system = native_pty_system();

    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Failed to open PTY: {e}"))?;

    let mut cmd = CommandBuilder::new(&command);
    for arg in &args {
        cmd.arg(arg);
    }
    if let Some(dir) = &cwd {
        cmd.cwd(dir);
    }
    cmd.env_remove("CLAUDECODE");

    let mut child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("Failed to spawn command: {e}"))?;

    // Drop slave — we only need the master side
    drop(pair.slave);

    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("Failed to take PTY writer: {e}"))?;

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("Failed to clone PTY reader: {e}"))?;

    let session_id = Uuid::new_v4().to_string();
    let sid = session_id.clone();

    // Store session
    {
        let mut sessions = state.0.lock().map_err(|e| e.to_string())?;
        sessions.insert(
            session_id.clone(),
            PtySession {
                master: pair.master,
                writer,
            },
        );
    }

    // Reader thread: reads PTY output and emits events
    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let data = String::from_utf8_lossy(&buf[..n]).to_string();
                    let _ = app.emit(
                        "pty:data",
                        PtyDataPayload {
                            session_id: sid.clone(),
                            data,
                        },
                    );
                }
                Err(_) => break,
            }
        }

        // Process exited — get exit code
        let code = child
            .wait()
            .ok()
            .map(|status| status.exit_code());

        let _ = app.emit(
            "pty:exit",
            PtyExitPayload {
                session_id: sid.clone(),
                code,
            },
        );

        // Clean up session from state
        if let Some(state) = app.try_state::<PtyState>() {
            if let Ok(mut sessions) = state.0.lock() {
                sessions.remove(&sid);
            }
        }
    });

    Ok(session_id)
}

/// Write user input to the PTY.
#[tauri::command]
pub fn write_pty(
    state: tauri::State<'_, PtyState>,
    session_id: String,
    data: String,
) -> Result<(), String> {
    let mut sessions = state.0.lock().map_err(|e| e.to_string())?;
    let session = sessions
        .get_mut(&session_id)
        .ok_or("Session not found")?;
    session
        .writer
        .write_all(data.as_bytes())
        .map_err(|e| format!("Write failed: {e}"))?;
    session
        .writer
        .flush()
        .map_err(|e| format!("Flush failed: {e}"))?;
    Ok(())
}

/// Resize the PTY.
#[tauri::command]
pub fn resize_pty(
    state: tauri::State<'_, PtyState>,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let sessions = state.0.lock().map_err(|e| e.to_string())?;
    let session = sessions
        .get(&session_id)
        .ok_or("Session not found")?;
    session
        .master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Resize failed: {e}"))?;
    Ok(())
}

/// Kill (drop) a PTY session.
#[tauri::command]
pub fn kill_pty(
    state: tauri::State<'_, PtyState>,
    session_id: String,
) -> Result<(), String> {
    let mut sessions = state.0.lock().map_err(|e| e.to_string())?;
    sessions.remove(&session_id);
    Ok(())
}
