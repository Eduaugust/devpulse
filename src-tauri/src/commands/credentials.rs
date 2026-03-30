use tauri_plugin_store::StoreExt;

/// Read a credential from the shared `credentials.json` store.
/// Returns an empty string if the key is not found or on error.
pub fn get_credential(app: &tauri::AppHandle, key: &str) -> String {
    let store = match app.store("credentials.json") {
        Ok(s) => s,
        Err(_) => return String::new(),
    };
    store
        .get(key)
        .and_then(|v| v.as_str().map(|s| s.to_string()))
        .unwrap_or_default()
}
