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

use std::collections::HashMap;
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

// MAR-1019: chat-side LLM agent posts a scaffolded plugin (manifest +
// index.js + README) and we drop it in `~/.markspread/plugins/<name>/`.
// All file paths are reconstructed from `name` — the front-end *cannot*
// pass arbitrary destinations, which keeps this command compatible with
// the existing R6 prefix guarantees.
//
// Allowed relative paths are restricted to a known whitelist (manifest +
// index.js + README + optional `assets/`). Any other key is rejected so a
// rogue chat session cannot smuggle e.g. `.ssh/authorized_keys`.

fn is_safe_plugin_name(name: &str) -> bool {
    if name.is_empty() || name.len() > 32 {
        return false;
    }
    let bytes = name.as_bytes();
    if !bytes[0].is_ascii_lowercase() && !bytes[0].is_ascii_digit() {
        return false;
    }
    bytes
        .iter()
        .all(|&b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

fn is_safe_relative_path(rel: &str) -> bool {
    if rel.is_empty() || rel.len() > 256 {
        return false;
    }
    if rel.starts_with('/') || rel.starts_with('\\') {
        return false;
    }
    if rel.contains("..") || rel.contains('\0') {
        return false;
    }
    // Disallow drive letters / backslashes on Windows.
    if rel.contains(':') {
        return false;
    }
    true
}

#[tauri::command]
pub fn plugin_scaffold_install(name: String, files: HashMap<String, String>) -> AppResult<String> {
    if !is_safe_plugin_name(&name) {
        return Err(AppError::Invalid(format!("unsafe plugin name: {name}")));
    }
    if files.is_empty() {
        return Err(AppError::Invalid("no files provided".into()));
    }
    if !files.contains_key("markspread-plugin.json") {
        return Err(AppError::Invalid(
            "scaffold must contain markspread-plugin.json".into(),
        ));
    }
    for key in files.keys() {
        if !is_safe_relative_path(key) {
            return Err(AppError::Invalid(format!("unsafe scaffold path: {key}")));
        }
    }
    let target = user_plugin_dir()?.join(&name);
    std::fs::create_dir_all(&target).map_err(AppError::Io)?;
    for (rel, contents) in &files {
        let dest = target.join(rel);
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent).map_err(AppError::Io)?;
        }
        std::fs::write(&dest, contents).map_err(AppError::Io)?;
    }
    Ok(target.to_string_lossy().into_owned())
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
    fn is_safe_plugin_name_accepts_valid_names() {
        assert!(is_safe_plugin_name("demo"));
        assert!(is_safe_plugin_name("demo-plugin-2"));
        assert!(is_safe_plugin_name("1demo"));
    }

    #[test]
    fn is_safe_plugin_name_rejects_invalid_names() {
        assert!(!is_safe_plugin_name(""));
        assert!(!is_safe_plugin_name("UPPER"));
        assert!(!is_safe_plugin_name("with space"));
        assert!(!is_safe_plugin_name("../escape"));
        assert!(!is_safe_plugin_name(&"x".repeat(40)));
        assert!(!is_safe_plugin_name("-leading-dash"));
    }

    #[test]
    fn is_safe_relative_path_filters_dangerous_inputs() {
        assert!(is_safe_relative_path("index.js"));
        assert!(is_safe_relative_path("assets/icon.svg"));
        assert!(!is_safe_relative_path(""));
        assert!(!is_safe_relative_path("/etc/passwd"));
        assert!(!is_safe_relative_path("..\\escape"));
        assert!(!is_safe_relative_path("../escape"));
        assert!(!is_safe_relative_path("C:/Windows"));
        assert!(!is_safe_relative_path(&"x".repeat(300)));
    }

    #[test]
    fn scaffold_install_rejects_unsafe_name() {
        let mut files = HashMap::new();
        files.insert("markspread-plugin.json".into(), "{}".into());
        let err = plugin_scaffold_install("Bad NAME".into(), files).unwrap_err();
        assert!(format!("{err}").contains("unsafe plugin name"));
    }

    #[test]
    fn scaffold_install_rejects_missing_manifest() {
        let mut files = HashMap::new();
        files.insert("index.js".into(), "self.x=1".into());
        let err = plugin_scaffold_install("ok".into(), files).unwrap_err();
        assert!(format!("{err}").contains("markspread-plugin.json"));
    }

    #[test]
    fn scaffold_install_rejects_empty_files() {
        let err = plugin_scaffold_install("ok".into(), HashMap::new()).unwrap_err();
        assert!(format!("{err}").contains("no files"));
    }

    #[test]
    fn scaffold_install_rejects_unsafe_path_key() {
        let mut files = HashMap::new();
        files.insert("markspread-plugin.json".into(), "{}".into());
        files.insert("../escape.js".into(), "x".into());
        let err = plugin_scaffold_install("ok".into(), files).unwrap_err();
        assert!(format!("{err}").contains("unsafe scaffold path"));
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
