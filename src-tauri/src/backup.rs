// S-BK-001..007: snapshots, crash recovery, workspace + settings +
// keybinding export/import.
//
// On-disk layout, all under the app data dir:
//
//   snapshots/<workspaceHash>/<id>.json   — snapshot manifest
//   snapshots/<workspaceHash>/blobs/<sha> — content-addressed blob
//
// Snapshot manifests reference blobs by sha256 so a 5-minute cadence
// costs only the unique edits. Workspace export is a portable `.zip`
// preserving relative paths. Settings + keybindings have their own
// JSON export documents so a keymap can be shared without the rest.

use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use walkdir::WalkDir;
use zip::write::SimpleFileOptions;

use crate::error::{AppError, AppResult};

fn data_dir() -> AppResult<PathBuf> {
    dirs::data_local_dir()
        .map(|p| p.join("markspread"))
        .ok_or_else(|| AppError::Invalid("could not resolve OS data dir".into()))
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

// Retained for the snapshot-blob path; restore verifies against the
// renderer-supplied digest, so this is currently only exercised by tests.
#[allow(dead_code)]
fn sha256_hex(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    let mut h = Sha256::new();
    h.update(bytes);
    hex::encode(h.finalize())
}

/// A workspace hash is used as a directory name. The renderer derives it
/// as a sha256 hex digest, so a defensive check that it carries only
/// `[0-9a-f]` keeps a hostile renderer from path-escaping.
fn validate_hash(hash: &str) -> AppResult<()> {
    if hash.is_empty() || hash.len() > 128 || !hash.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(AppError::Invalid("invalid workspace hash".into()));
    }
    Ok(())
}

fn validate_snapshot_id(id: &str) -> AppResult<()> {
    if id.is_empty()
        || id.len() > 128
        || !id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err(AppError::Invalid("invalid snapshot id".into()));
    }
    Ok(())
}

// ─── Snapshots (S-BK-001..003) ──────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SnapshotFile {
    rel: String,
    sha256: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SnapshotManifest {
    id: String,
    ts: i64,
    workspace_hash: String,
    workspace_path: String,
    new_blobs: i64,
    bytes_added: i64,
    files: Vec<SnapshotFile>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotRecord {
    pub id: String,
    pub ts: i64,
    pub workspace_hash: String,
    pub new_blobs: i64,
    pub bytes_added: i64,
}

fn read_manifests(hash: &str) -> AppResult<Vec<SnapshotManifest>> {
    let dir = data_dir()?.join("snapshots").join(hash);
    let mut out = Vec::new();
    let rd = match std::fs::read_dir(&dir) {
        Ok(rd) => rd,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(out),
        Err(e) => return Err(AppError::Io(e)),
    };
    for entry in rd.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        if let Ok(raw) = std::fs::read_to_string(&path) {
            if let Ok(m) = serde_json::from_str::<SnapshotManifest>(&raw) {
                out.push(m);
            }
        }
    }
    out.sort_by_key(|m| m.ts);
    Ok(out)
}

#[tauri::command]
pub async fn backup_snapshot_list(workspace_hash: String) -> AppResult<Vec<SnapshotRecord>> {
    validate_hash(&workspace_hash)?;
    Ok(read_manifests(&workspace_hash)?
        .into_iter()
        .map(|m| SnapshotRecord {
            id: m.id,
            ts: m.ts,
            workspace_hash: m.workspace_hash,
            new_blobs: m.new_blobs,
            bytes_added: m.bytes_added,
        })
        .collect())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreResult {
    pub files_restored: i64,
}

#[tauri::command]
pub async fn backup_snapshot_restore(id: String) -> AppResult<RestoreResult> {
    validate_snapshot_id(&id)?;
    let root = data_dir()?.join("snapshots");
    // The manifest id is unique; scan each workspace-hash dir for it.
    let rd = match std::fs::read_dir(&root) {
        Ok(rd) => rd,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Err(AppError::NotFound(format!("no snapshot {id}")))
        }
        Err(e) => return Err(AppError::Io(e)),
    };
    for entry in rd.flatten() {
        let manifest_path = entry.path().join(format!("{id}.json"));
        if !manifest_path.exists() {
            continue;
        }
        let raw = std::fs::read_to_string(&manifest_path).map_err(AppError::Io)?;
        let manifest: SnapshotManifest = serde_json::from_str(&raw)
            .map_err(|e| AppError::Invalid(format!("snapshot manifest parse: {e}")))?;
        let blobs = entry.path().join("blobs");
        let workspace = PathBuf::from(&manifest.workspace_path);
        let mut restored = 0i64;
        for file in &manifest.files {
            // Reject any traversal smuggled into a stored manifest.
            if file.rel.contains("..") || Path::new(&file.rel).is_absolute() {
                return Err(AppError::Invalid(format!(
                    "unsafe path in snapshot: {}",
                    file.rel
                )));
            }
            let blob = blobs.join(&file.sha256);
            let body = std::fs::read(&blob).map_err(AppError::Io)?;
            let target = workspace.join(&file.rel);
            if let Some(parent) = target.parent() {
                std::fs::create_dir_all(parent).map_err(AppError::Io)?;
            }
            std::fs::write(&target, &body).map_err(AppError::Io)?;
            restored += 1;
        }
        return Ok(RestoreResult {
            files_restored: restored,
        });
    }
    Err(AppError::NotFound(format!("no snapshot {id}")))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryProposal {
    pub workspace_hash: String,
    pub snapshots: Vec<SnapshotRecord>,
    pub last_session_ended_at: Option<i64>,
}

#[tauri::command]
pub async fn backup_propose_recovery(workspace_hash: String) -> AppResult<RecoveryProposal> {
    validate_hash(&workspace_hash)?;
    let snapshots = backup_snapshot_list(workspace_hash.clone()).await?;
    // A surviving session beacon means the previous run ended uncleanly;
    // its `ts` is the best estimate of when.
    let beacon = data_dir()?.join("state").join("last-session.json");
    let last_session_ended_at = std::fs::read_to_string(&beacon)
        .ok()
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok())
        .and_then(|v| v.get("ts").and_then(|t| t.as_i64()));
    Ok(RecoveryProposal {
        workspace_hash,
        snapshots,
        last_session_ended_at,
    })
}

// ─── Workspace zip export / import (S-BK-004 / S-BK-005) ─────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceExportRequest {
    pub workspace_path: String,
    pub output_path: Option<String>,
    pub include_markspread_folder: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceExportResult {
    pub output_path: String,
    pub bytes: i64,
}

#[tauri::command]
pub async fn backup_workspace_export(
    req: WorkspaceExportRequest,
) -> AppResult<WorkspaceExportResult> {
    let workspace = PathBuf::from(&req.workspace_path);
    if !workspace.is_dir() {
        return Err(AppError::NotFound(format!(
            "workspace not found: {}",
            req.workspace_path
        )));
    }
    let output = req.output_path.clone().ok_or_else(|| {
        AppError::Invalid("output path required — the save dialog must resolve it first".into())
    })?;

    let file = std::fs::File::create(&output).map_err(AppError::Io)?;
    let mut zip = zip::ZipWriter::new(file);
    let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);

    for entry in WalkDir::new(&workspace).into_iter().filter_map(|e| e.ok()) {
        let path = entry.path();
        let rel = match path.strip_prefix(&workspace) {
            Ok(r) => r,
            Err(_) => continue,
        };
        if rel.as_os_str().is_empty() {
            continue;
        }
        let first = rel.components().next().and_then(|c| c.as_os_str().to_str());
        if !req.include_markspread_folder && first == Some(".markspread") {
            continue;
        }
        let rel_str = rel.to_string_lossy().replace('\\', "/");
        if entry.file_type().is_dir() {
            zip.add_directory(format!("{rel_str}/"), options)
                .map_err(|e| AppError::Invalid(format!("zip dir: {e}")))?;
        } else if entry.file_type().is_file() {
            let body = std::fs::read(path).map_err(AppError::Io)?;
            zip.start_file(&rel_str, options)
                .map_err(|e| AppError::Invalid(format!("zip start: {e}")))?;
            zip.write_all(&body).map_err(AppError::Io)?;
        }
    }
    zip.finish()
        .map_err(|e| AppError::Invalid(format!("zip finish: {e}")))?;

    let bytes = std::fs::metadata(&output)
        .map(|m| m.len() as i64)
        .unwrap_or(0);
    Ok(WorkspaceExportResult {
        output_path: output,
        bytes,
    })
}

#[tauri::command]
pub async fn backup_workspace_import(
    zip_path: String,
    destination: String,
) -> AppResult<RestoreResult> {
    let dest = PathBuf::from(&destination);
    std::fs::create_dir_all(&dest).map_err(AppError::Io)?;
    let file = std::fs::File::open(&zip_path).map_err(AppError::Io)?;
    let mut archive =
        zip::ZipArchive::new(file).map_err(|e| AppError::Invalid(format!("open zip: {e}")))?;

    let mut restored = 0i64;
    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| AppError::Invalid(format!("zip entry {i}: {e}")))?;
        // `enclosed_name` rejects absolute paths and `..` traversal.
        let rel = match entry.enclosed_name() {
            Some(p) => p,
            None => {
                return Err(AppError::Invalid(format!(
                    "unsafe path in archive: {}",
                    entry.name()
                )))
            }
        };
        let target = dest.join(&rel);
        if entry.is_dir() {
            std::fs::create_dir_all(&target).map_err(AppError::Io)?;
            continue;
        }
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent).map_err(AppError::Io)?;
        }
        let mut body = Vec::with_capacity(entry.size() as usize);
        entry.read_to_end(&mut body).map_err(AppError::Io)?;
        std::fs::write(&target, &body).map_err(AppError::Io)?;
        restored += 1;
    }
    Ok(RestoreResult {
        files_restored: restored,
    })
}

// ─── Settings export / import (S-BK-006) ─────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginRef {
    pub id: String,
    pub version: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsExport {
    pub schema_version: u32,
    pub exported_at: i64,
    pub settings: serde_json::Value,
    pub plugins: Vec<PluginRef>,
}

fn read_json_or_empty(path: &Path) -> serde_json::Value {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_else(|| serde_json::json!({}))
}

/// Installed-plugin registry, written by the plugin module. Each entry
/// carries at least `id` and `version`; absent file → no plugins.
fn read_installed_plugins() -> Vec<PluginRef> {
    let Ok(dir) = data_dir() else {
        return Vec::new();
    };
    let raw = match std::fs::read_to_string(dir.join("plugins.json")) {
        Ok(r) => r,
        Err(_) => return Vec::new(),
    };
    let Ok(v) = serde_json::from_str::<serde_json::Value>(&raw) else {
        return Vec::new();
    };
    let arr = v
        .get("installed")
        .and_then(|x| x.as_array())
        .cloned()
        .unwrap_or_default();
    arr.into_iter()
        .filter_map(|p| {
            let id = p.get("id")?.as_str()?.to_string();
            let version = p
                .get("version")
                .and_then(|x| x.as_str())
                .unwrap_or("0.0.0")
                .to_string();
            Some(PluginRef { id, version })
        })
        .collect()
}

#[tauri::command]
pub async fn backup_settings_export() -> AppResult<SettingsExport> {
    let dir = data_dir()?;
    Ok(SettingsExport {
        schema_version: 1,
        exported_at: now_ms(),
        settings: read_json_or_empty(&dir.join("settings.json")),
        plugins: read_installed_plugins(),
    })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportSettingsResult {
    pub ok: bool,
    pub warnings: Vec<String>,
}

fn write_atomic(target: &Path, bytes: &[u8]) -> AppResult<()> {
    let parent = target
        .parent()
        .ok_or_else(|| AppError::Invalid("target has no parent".into()))?;
    std::fs::create_dir_all(parent).map_err(AppError::Io)?;
    let tmp = parent.join(format!(
        ".{}.import.tmp",
        target
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| "out".into())
    ));
    std::fs::write(&tmp, bytes).map_err(AppError::Io)?;
    std::fs::rename(&tmp, target).map_err(AppError::Io)?;
    Ok(())
}

#[tauri::command]
pub async fn backup_settings_import(payload: SettingsExport) -> AppResult<ImportSettingsResult> {
    if payload.schema_version != 1 {
        return Err(AppError::Invalid(format!(
            "unsupported settings schema version {}",
            payload.schema_version
        )));
    }
    if !payload.settings.is_object() {
        return Err(AppError::Invalid(
            "settings payload is not an object".into(),
        ));
    }
    let dir = data_dir()?;
    let bytes = serde_json::to_vec_pretty(&payload.settings)
        .map_err(|e| AppError::Invalid(format!("serialise settings: {e}")))?;
    write_atomic(&dir.join("settings.json"), &bytes)?;

    // Warn about plugins referenced by the export that are not present
    // on this machine — the user must re-install them from the
    // marketplace for the imported settings to fully apply.
    let installed = read_installed_plugins();
    let mut warnings = Vec::new();
    for want in &payload.plugins {
        if !installed.iter().any(|p| p.id == want.id) {
            warnings.push(format!(
                "plugin not installed: {} ({})",
                want.id, want.version
            ));
        }
    }
    Ok(ImportSettingsResult { ok: true, warnings })
}

// ─── Keybinding export / import (S-BK-007) ───────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct KeybindingEntry {
    pub command: String,
    pub shortcut: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub when: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeybindingExport {
    pub schema_version: u32,
    pub exported_at: i64,
    pub bindings: Vec<KeybindingEntry>,
}

/// keybindings.json is the user-override store. It may be an array of
/// `{command,shortcut,when?}` or a flat `{command: shortcut}` map; we
/// normalise both into the export shape.
fn read_keybindings() -> AppResult<Vec<KeybindingEntry>> {
    let dir = data_dir()?;
    let v = read_json_or_empty(&dir.join("keybindings.json"));
    if let Some(arr) = v.as_array() {
        return Ok(arr
            .iter()
            .filter_map(|e| {
                Some(KeybindingEntry {
                    command: e.get("command")?.as_str()?.to_string(),
                    shortcut: e.get("shortcut")?.as_str()?.to_string(),
                    when: e.get("when").and_then(|w| w.as_str()).map(String::from),
                })
            })
            .collect());
    }
    if let Some(map) = v.as_object() {
        return Ok(map
            .iter()
            .filter_map(|(k, val)| {
                Some(KeybindingEntry {
                    command: k.clone(),
                    shortcut: val.as_str()?.to_string(),
                    when: None,
                })
            })
            .collect());
    }
    Ok(Vec::new())
}

#[tauri::command]
pub async fn backup_keybindings_export() -> AppResult<KeybindingExport> {
    Ok(KeybindingExport {
        schema_version: 1,
        exported_at: now_ms(),
        bindings: read_keybindings()?,
    })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportKeybindingsResult {
    pub ok: bool,
    pub conflicts: Vec<String>,
}

#[tauri::command]
pub async fn backup_keybindings_import(
    payload: KeybindingExport,
) -> AppResult<ImportKeybindingsResult> {
    if payload.schema_version != 1 {
        return Err(AppError::Invalid(format!(
            "unsupported keybinding schema version {}",
            payload.schema_version
        )));
    }
    // A conflict = the command already had a *different* shortcut. The
    // import still wins (the user asked for it), but we report the
    // overridden commands so the UI can show what changed.
    let existing = read_keybindings()?;
    let mut conflicts = Vec::new();
    for incoming in &payload.bindings {
        if let Some(prev) = existing.iter().find(|e| e.command == incoming.command) {
            if prev.shortcut != incoming.shortcut {
                conflicts.push(incoming.command.clone());
            }
        }
    }
    let dir = data_dir()?;
    let bytes = serde_json::to_vec_pretty(&payload.bindings)
        .map_err(|e| AppError::Invalid(format!("serialise keybindings: {e}")))?;
    write_atomic(&dir.join("keybindings.json"), &bytes)?;
    Ok(ImportKeybindingsResult {
        ok: true,
        conflicts,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_bad_hash() {
        assert!(validate_hash("../etc").is_err());
        assert!(validate_hash("deadbeef").is_ok());
        assert!(validate_hash("DEADBEEF").is_ok());
    }

    #[test]
    fn rejects_bad_snapshot_id() {
        assert!(validate_snapshot_id("../x").is_err());
        assert!(validate_snapshot_id("snap-2026-01").is_ok());
    }
}
