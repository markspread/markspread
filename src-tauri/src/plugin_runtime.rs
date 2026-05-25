// S-PL-SEC-001: ADR-0012 runtime plugin discovery (host side).
//
// ADR-0012 D3.1 — Plugin discovery: scan both `~/.markspread/plugins/` and
// `<workspace>/.markspread/plugins/` for `markspread-plugin.json` files.
// Front-end picks them up via the IPC commands here and spawns Workers in
// the renderer (we do NOT spawn Workers from Rust).
//
// The Rust side is intentionally minimal — it provides:
//
//   1. `plugin_runtime_dir()`   → returns `<user-home>/.markspread/plugins`.
//   2. `plugin_runtime_list()`  → enumerates manifest files under the dir
//                                 (and an optional workspace dir).
//   3. `plugin_runtime_read()`  → reads a single manifest + entry file
//                                 (front-end uses the entry to build a
//                                 blob URL for the Worker).
//
// File watching uses the existing `watcher` module — we don't duplicate
// the notify wiring; the frontend can call `fs_watch_start` on the
// plugin dir and react to events.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

/// The fixed user-level plugin directory. We do not honour `$XDG_CONFIG_HOME`
/// here — ADR-0012 explicitly pins `~/.markspread/plugins`, and matching the
/// docs is more important than UX flexibility for v1.3.
fn user_plugin_dir() -> AppResult<PathBuf> {
    let home = dirs::home_dir()
        .ok_or_else(|| AppError::Invalid("could not resolve home directory".into()))?;
    Ok(home.join(".markspread").join("plugins"))
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredPlugin {
    pub plugin_dir: String,
    pub manifest_path: String,
    /// `"user"` or `"workspace"` — the front-end uses this for D3.5 priority.
    pub scope: String,
}

#[tauri::command]
pub fn plugin_runtime_dir() -> AppResult<String> {
    let dir = user_plugin_dir()?;
    Ok(dir.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn plugin_runtime_list(workspace: Option<String>) -> AppResult<Vec<DiscoveredPlugin>> {
    let mut out = Vec::new();
    let user_dir = user_plugin_dir()?;
    scan_into(&user_dir, "user", &mut out);
    if let Some(ws) = workspace {
        let ws_dir = PathBuf::from(ws).join(".markspread").join("plugins");
        scan_into(&ws_dir, "workspace", &mut out);
    }
    Ok(out)
}

fn scan_into(dir: &Path, scope: &str, out: &mut Vec<DiscoveredPlugin>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return; // missing dir = no plugins; not an error.
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let manifest = path.join("markspread-plugin.json");
        if manifest.is_file() {
            out.push(DiscoveredPlugin {
                plugin_dir: path.to_string_lossy().into_owned(),
                manifest_path: manifest.to_string_lossy().into_owned(),
                scope: scope.to_string(),
            });
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestRead {
    pub manifest_json: String,
    pub entry_source: String,
}

/// Read manifest + entry script content. The front-end then turns
/// `entry_source` into a blob URL for `new Worker(...)`.
///
/// We re-validate the `plugin_dir` prefix against the resolved entry path
/// so a malicious manifest cannot use `entry: "../../etc/passwd"` to read
/// arbitrary host files (ADR-0012 R6).
#[tauri::command]
pub fn plugin_runtime_read(plugin_dir: String, entry: String) -> AppResult<ManifestRead> {
    let base = PathBuf::from(&plugin_dir);
    let manifest_path = base.join("markspread-plugin.json");
    let manifest_json = std::fs::read_to_string(&manifest_path).map_err(AppError::Io)?;

    // R6: prefix check. We forbid absolute paths, drive prefixes, and `..`.
    if entry.is_empty() || entry.starts_with('/') || entry.contains("..") {
        return Err(AppError::Invalid(format!("unsafe plugin entry: {entry}")));
    }
    if entry.contains('\\') && entry.matches(':').count() > 0 {
        return Err(AppError::Invalid(format!("unsafe plugin entry: {entry}")));
    }
    let entry_path = base.join(&entry);
    // Canonicalise both sides and ensure entry stays inside base.
    let base_canon = base.canonicalize().map_err(AppError::Io)?;
    let entry_canon = entry_path.canonicalize().map_err(AppError::Io)?;
    if !entry_canon.starts_with(&base_canon) {
        return Err(AppError::Invalid(format!(
            "entry escapes plugin dir: {entry}"
        )));
    }
    let entry_source = std::fs::read_to_string(&entry_canon).map_err(AppError::Io)?;
    Ok(ManifestRead {
        manifest_json,
        entry_source,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn returns_user_plugin_dir_path() {
        let p = plugin_runtime_dir().unwrap();
        assert!(p.ends_with("plugins"));
        assert!(p.contains(".markspread"));
    }

    #[test]
    fn list_missing_dir_is_empty_not_error() {
        let ws = TempDir::new().unwrap();
        let out = plugin_runtime_list(Some(ws.path().to_string_lossy().into_owned())).unwrap();
        // workspace dir does not have .markspread/plugins → returns 0 entries.
        assert!(out.iter().all(|p| p.scope != "workspace"));
    }

    #[test]
    fn list_finds_workspace_manifest() {
        let ws = TempDir::new().unwrap();
        let plugin_dir = ws.path().join(".markspread").join("plugins").join("demo");
        std::fs::create_dir_all(&plugin_dir).unwrap();
        std::fs::write(
            plugin_dir.join("markspread-plugin.json"),
            r#"{ "name": "demo" }"#,
        )
        .unwrap();
        let out = plugin_runtime_list(Some(ws.path().to_string_lossy().into_owned())).unwrap();
        let demo: Vec<_> = out.iter().filter(|p| p.scope == "workspace").collect();
        assert_eq!(demo.len(), 1);
        assert!(demo[0].manifest_path.ends_with("markspread-plugin.json"));
    }

    #[test]
    fn read_rejects_traversal_entry() {
        let dir = TempDir::new().unwrap();
        std::fs::write(
            dir.path().join("markspread-plugin.json"),
            r#"{ "name": "x" }"#,
        )
        .unwrap();
        let err = plugin_runtime_read(
            dir.path().to_string_lossy().into_owned(),
            "../escape.js".into(),
        )
        .unwrap_err();
        let msg = format!("{err}");
        assert!(msg.contains("unsafe") || msg.contains("escapes"));
    }

    #[test]
    fn read_returns_manifest_and_entry() {
        let dir = TempDir::new().unwrap();
        std::fs::write(
            dir.path().join("markspread-plugin.json"),
            r#"{ "name": "demo" }"#,
        )
        .unwrap();
        std::fs::write(dir.path().join("index.js"), "self.x = 1;").unwrap();
        let out = plugin_runtime_read(
            dir.path().to_string_lossy().into_owned(),
            "./index.js".into(),
        )
        .unwrap();
        assert!(out.manifest_json.contains("demo"));
        assert!(out.entry_source.contains("self.x"));
    }

    #[test]
    fn read_rejects_absolute_entry() {
        let dir = TempDir::new().unwrap();
        std::fs::write(
            dir.path().join("markspread-plugin.json"),
            r#"{ "name": "x" }"#,
        )
        .unwrap();
        let err = plugin_runtime_read(
            dir.path().to_string_lossy().into_owned(),
            "/etc/passwd".into(),
        )
        .unwrap_err();
        assert!(format!("{err}").contains("unsafe"));
    }
}
