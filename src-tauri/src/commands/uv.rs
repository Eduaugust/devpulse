use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::process::{Command as StdCommand, Stdio};
use std::sync::OnceLock;
use tauri::Manager;

use super::claude::get_shell_path;
use crate::HttpClient;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UvSource {
    SystemUvx,
    AppManaged,
    Downloaded,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UvResolution {
    pub binary_path: String,
    pub source: UvSource,
}

/// Cached successful resolution — avoids repeated downloads within a session.
static CACHED_RESOLUTION: OnceLock<UvResolution> = OnceLock::new();

/// Resolve a usable `uv` binary. Resolution chain:
/// 1. `uvx` on system PATH → use it
/// 2. App-managed `{app_data}/bin/uv` exists → use it
/// 3. Download from GitHub Releases → extract to `{app_data}/bin/`
pub async fn resolve_uv_binary(
    app: &tauri::AppHandle,
    http: &HttpClient,
) -> Result<UvResolution, String> {
    // Return cached if available
    if let Some(cached) = CACHED_RESOLUTION.get() {
        return Ok(cached.clone());
    }

    // 1. Check system PATH for uvx
    let path_env = get_shell_path();
    if let Ok(uvx_path) = which::which_in("uvx", Some(&path_env), ".") {
        let resolution = UvResolution {
            binary_path: uvx_path.to_string_lossy().to_string(),
            source: UvSource::SystemUvx,
        };
        let _ = CACHED_RESOLUTION.set(resolution.clone());
        return Ok(resolution);
    }

    // 2. Check app-managed binary
    let app_bin_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?
        .join("bin");

    let managed_binary = if cfg!(windows) {
        app_bin_dir.join("uv.exe")
    } else {
        app_bin_dir.join("uv")
    };

    if managed_binary.exists() {
        let resolution = UvResolution {
            binary_path: managed_binary.to_string_lossy().to_string(),
            source: UvSource::AppManaged,
        };
        let _ = CACHED_RESOLUTION.set(resolution.clone());
        return Ok(resolution);
    }

    // 3. Download from GitHub
    let resolution = download_uv(app, http).await?;
    let _ = CACHED_RESOLUTION.set(resolution.clone());
    Ok(resolution)
}

/// Download the `uv` binary from GitHub Releases and extract to `{app_data}/bin/`.
async fn download_uv(
    app: &tauri::AppHandle,
    http: &HttpClient,
) -> Result<UvResolution, String> {
    let (url, archive_type) = platform_uv_info()?;

    log::info!("Downloading uv from: {}", url);

    let response = http
        .0
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Failed to download uv: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("Failed to download uv: HTTP {}", response.status()));
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Failed to read uv archive: {}", e))?;

    let app_bin_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?
        .join("bin");

    std::fs::create_dir_all(&app_bin_dir)
        .map_err(|e| format!("Failed to create bin dir: {}", e))?;

    let binary_path = match archive_type {
        ArchiveType::TarGz => extract_tar_gz(&bytes, &app_bin_dir)?,
        ArchiveType::Zip => extract_zip(&bytes, &app_bin_dir)?,
    };

    log::info!("uv extracted to: {}", binary_path.display());

    Ok(UvResolution {
        binary_path: binary_path.to_string_lossy().to_string(),
        source: UvSource::Downloaded,
    })
}

enum ArchiveType {
    TarGz,
    Zip,
}

/// Returns (download_url, archive_type) for the current platform.
fn platform_uv_info() -> Result<(String, ArchiveType), String> {
    // Use latest release redirect — GitHub will 302 to the actual version
    let base = "https://github.com/astral-sh/uv/releases/latest/download";

    let (filename, archive_type) = if cfg!(target_os = "macos") && cfg!(target_arch = "aarch64") {
        ("uv-aarch64-apple-darwin.tar.gz", ArchiveType::TarGz)
    } else if cfg!(target_os = "macos") && cfg!(target_arch = "x86_64") {
        ("uv-x86_64-apple-darwin.tar.gz", ArchiveType::TarGz)
    } else if cfg!(target_os = "linux") && cfg!(target_arch = "x86_64") {
        ("uv-x86_64-unknown-linux-gnu.tar.gz", ArchiveType::TarGz)
    } else if cfg!(target_os = "linux") && cfg!(target_arch = "aarch64") {
        ("uv-aarch64-unknown-linux-gnu.tar.gz", ArchiveType::TarGz)
    } else if cfg!(target_os = "windows") && cfg!(target_arch = "x86_64") {
        ("uv-x86_64-pc-windows-msvc.zip", ArchiveType::Zip)
    } else {
        return Err(format!(
            "Unsupported platform: {} / {}",
            std::env::consts::OS,
            std::env::consts::ARCH
        ));
    };

    Ok((format!("{}/{}", base, filename), archive_type))
}

/// Extract a .tar.gz archive and return the path to the `uv` binary.
fn extract_tar_gz(data: &[u8], dest_dir: &std::path::Path) -> Result<PathBuf, String> {
    use flate2::read::GzDecoder;
    use tar::Archive;

    let decoder = GzDecoder::new(data);
    let mut archive = Archive::new(decoder);

    let binary_name = "uv";
    let mut found_binary = None;

    for entry in archive.entries().map_err(|e| format!("Failed to read tar: {}", e))? {
        let mut entry = entry.map_err(|e| format!("Failed to read tar entry: {}", e))?;
        let path = entry
            .path()
            .map_err(|e| format!("Failed to get entry path: {}", e))?
            .to_path_buf();

        // The archive typically contains a directory like `uv-aarch64-apple-darwin/uv`
        if let Some(file_name) = path.file_name() {
            if file_name == binary_name || file_name == "uvx" {
                let dest = dest_dir.join(file_name);
                entry
                    .unpack(&dest)
                    .map_err(|e| format!("Failed to extract {}: {}", file_name.to_string_lossy(), e))?;

                // Set executable permission on Unix
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    let _ = std::fs::set_permissions(&dest, std::fs::Permissions::from_mode(0o755));
                }

                if file_name == binary_name {
                    found_binary = Some(dest);
                }
            }
        }
    }

    found_binary.ok_or_else(|| "uv binary not found in archive".to_string())
}

/// Extract a .zip archive and return the path to the `uv.exe` binary.
fn extract_zip(data: &[u8], dest_dir: &std::path::Path) -> Result<PathBuf, String> {
    let cursor = std::io::Cursor::new(data);
    let mut archive =
        zip::ZipArchive::new(cursor).map_err(|e| format!("Failed to open zip: {}", e))?;

    let binary_name = if cfg!(windows) { "uv.exe" } else { "uv" };
    let mut found_binary = None;

    for i in 0..archive.len() {
        let mut file = archive
            .by_index(i)
            .map_err(|e| format!("Failed to read zip entry: {}", e))?;

        let Some(file_name) = file.enclosed_name().and_then(|p| p.file_name().map(|f| f.to_owned())) else {
            continue;
        };

        let name_str = file_name.to_string_lossy();
        if name_str == binary_name || name_str == "uvx" || name_str == "uvx.exe" {
            let dest = dest_dir.join(&file_name);
            let mut out = std::fs::File::create(&dest)
                .map_err(|e| format!("Failed to create {}: {}", name_str, e))?;
            std::io::copy(&mut file, &mut out)
                .map_err(|e| format!("Failed to write {}: {}", name_str, e))?;

            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let _ = std::fs::set_permissions(&dest, std::fs::Permissions::from_mode(0o755));
            }

            if name_str == binary_name {
                found_binary = Some(dest);
            }
        }
    }

    found_binary.ok_or_else(|| "uv binary not found in zip archive".to_string())
}

/// Verify the uv binary works by running `uv --version`.
pub fn verify_uv(binary_path: &str) -> Result<String, String> {
    let output = StdCommand::new(binary_path)
        .args(["--version"])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| format!("Failed to run uv: {}", e))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        Err(format!("uv verification failed: {}", stderr))
    }
}
