use std::path::PathBuf;

/// Marker filename: when present alongside the executable, the app runs in
/// portable mode and redirects all data writes to `<exe-dir>/markspread-data/`.
const PORTABLE_MARKER: &str = "markspread.portable";

/// Returns the override data directory if portable mode is active. Callers
/// (settings/cache/log) should consult this before falling back to the OS
/// default appdata path.
pub fn data_dir_override() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let dir = exe.parent()?;
    let marker = dir.join(PORTABLE_MARKER);
    if !marker.exists() {
        // The marker pattern lets us ship the same binary as installer + portable;
        // the build pipeline only differs in whether it drops the marker file.
        return None;
    }
    let data = dir.join("markspread-data");
    // If we can't create or write to it, refuse rather than silently fall back
    // to %APPDATA% — that would defeat the portability promise.
    if std::fs::create_dir_all(&data).is_err() {
        tracing::error!(
            target: "portable",
            "portable marker present but data dir not writable: {}",
            data.display()
        );
        return None;
    }
    Some(data)
}

pub fn is_portable() -> bool {
    data_dir_override().is_some()
}

#[tauri::command]
pub fn portable_is_active() -> bool {
    is_portable()
}
