// S-SE-*, S-MIG-*, S-ER-*, S-U33/34: miscellaneous backend commands that
// don't warrant a module of their own.
//
//   • fs_canonicalize        — resolve `..`/symlinks for the workspace
//                              scope check (S-SE-001/003).
//   • fs_open_tab            — validate a path and ask the renderer to
//                              open it in a tab via `fs://open-tab`.
//   • migration_run          — idempotent boot-time schema migration.
//   • migrate_run            — third-party import (Obsidian/Typora/…).
//   • logger_set_rotation    — persist log-rotation config.
//   • logger_locations       — report on-disk log paths.
//   • shell_open_external    — open an http/https/mailto URL in the OS
//                              handler, rejecting every other scheme.
//   • security_erase_all_data — wipe app data + keychain (S-SE-022..029).

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use crate::error::{AppError, AppResult};
use crate::ops::KEYCHAIN_SERVICE;

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

/// Atomic write: temp file in the same directory, then rename.
fn atomic_write(target: &Path, bytes: &[u8]) -> AppResult<()> {
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent).map_err(AppError::Io)?;
    }
    let tmp = target.with_extension("tmp");
    std::fs::write(&tmp, bytes).map_err(AppError::Io)?;
    std::fs::rename(&tmp, target).map_err(AppError::Io)?;
    Ok(())
}

// ---------------------------------------------------------------------------
// fs_canonicalize
// ---------------------------------------------------------------------------

/// S-SE-001/003: resolve a path to its canonical form (absolute, `..`
/// collapsed, symlinks followed). When the leaf does not exist yet — the
/// common case for "save as new file" — we canonicalise the parent and
/// re-attach the file name so the workspace-scope check still works.
#[tauri::command]
pub fn fs_canonicalize(path: String) -> AppResult<String> {
    if path.is_empty() {
        return Err(AppError::Invalid("empty path".into()));
    }
    let p = PathBuf::from(&path);
    match std::fs::canonicalize(&p) {
        Ok(c) => Ok(c.to_string_lossy().into_owned()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            let parent = p
                .parent()
                .filter(|s| !s.as_os_str().is_empty())
                .ok_or_else(|| AppError::NotFound(format!("path not found: {path}")))?;
            let name = p
                .file_name()
                .ok_or_else(|| AppError::Invalid(format!("path has no file name: {path}")))?;
            let canon_parent = std::fs::canonicalize(parent).map_err(AppError::from)?;
            Ok(canon_parent.join(name).to_string_lossy().into_owned())
        }
        Err(e) => Err(AppError::from(e)),
    }
}

// ---------------------------------------------------------------------------
// fs_open_tab
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct OpenTabPayload {
    workspace: String,
    path: String,
}

/// Validate `path` exists and is a file, then ask the renderer to open it
/// in a tab. The renderer owns tab state, so this is a thin event bridge.
#[tauri::command]
pub fn fs_open_tab(app: AppHandle, workspace: String, path: String) -> AppResult<()> {
    if path.is_empty() {
        return Err(AppError::Invalid("empty path".into()));
    }
    let meta = std::fs::metadata(&path).map_err(AppError::from)?;
    if meta.is_dir() {
        return Err(AppError::IsDirectory(path.clone()));
    }
    app.emit("fs://open-tab", OpenTabPayload { workspace, path })
        .map_err(|e| AppError::Invalid(format!("emit open-tab: {e}")))?;
    Ok(())
}

// ---------------------------------------------------------------------------
// migration_run — boot-time schema migration
// ---------------------------------------------------------------------------

const CURRENT_SCHEMA_VERSION: u32 = 1;

fn schema_version_path() -> AppResult<PathBuf> {
    Ok(data_dir()?.join("state").join("schema-version"))
}

fn read_schema_version() -> u32 {
    schema_version_path()
        .ok()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| s.trim().parse().ok())
        .unwrap_or(0)
}

/// S-U33/34: apply pending schema migrations. Idempotent — the renderer
/// passes `CURRENT_SCHEMA_VERSION` on every launch and we no-op when the
/// recorded version already covers it. The version is clamped to what
/// this build knows how to produce.
#[tauri::command]
pub fn migration_run(schema_version: u32) -> AppResult<()> {
    let target = schema_version.min(CURRENT_SCHEMA_VERSION);
    let current = read_schema_version();
    if current >= target {
        return Ok(());
    }
    // Migration ladder. Each step is idempotent; today the only ladder
    // entry is the v0→v1 baseline (no on-disk transform required — the
    // stores self-initialise — so we just stamp the version).
    let path = schema_version_path()?;
    atomic_write(&path, target.to_string().as_bytes())?;
    Ok(())
}

// ---------------------------------------------------------------------------
// migrate_run — third-party import
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationRunRequest {
    pub source: String,
    pub input_path: String,
    pub output_path: String,
    pub copy_files: bool,
}

#[derive(Debug, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MigrationError {
    pub path: String,
    pub reason: String,
}

#[derive(Debug, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MigrationRunResult {
    pub files_processed: u32,
    pub files_written: u32,
    pub warnings: Vec<String>,
    pub errors: Vec<MigrationError>,
}

fn is_markdown(path: &Path) -> bool {
    matches!(
        path.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()),
        Some(ref e) if e == "md" || e == "markdown" || e == "mdx"
    )
}

/// Source-specific directories that should never be carried into the
/// destination workspace.
fn is_skipped_dir(name: &str) -> bool {
    matches!(
        name,
        ".obsidian" | ".trash" | ".git" | "node_modules" | ".logseq" | ".DS_Store"
    )
}

/// S-MIG-001..008: copy markdown (and, for known sources, sibling asset
/// folders) from a third-party export into the destination workspace.
/// The migrator never writes outside `output_path`.
#[tauri::command]
pub fn migrate_run(req: MigrationRunRequest) -> AppResult<MigrationRunResult> {
    let mut result = MigrationRunResult::default();

    let valid_sources = ["obsidian", "typora", "ia-writer", "notion", "logseq"];
    if !valid_sources.contains(&req.source.as_str()) {
        return Err(AppError::Invalid(format!(
            "unknown migration source: {}",
            req.source
        )));
    }

    let input = PathBuf::from(&req.input_path);
    if !input.exists() {
        return Err(AppError::NotFound(format!(
            "import source not found: {}",
            req.input_path
        )));
    }
    let output = PathBuf::from(&req.output_path);
    if req.copy_files {
        std::fs::create_dir_all(&output).map_err(AppError::from)?;
    }
    let output_canon = std::fs::canonicalize(&output)
        .unwrap_or_else(|_| output.clone());

    // Notion exports arrive as a `.zip`; everything else is a folder.
    let scan_root: PathBuf;
    let _tmp_guard: Option<tempdir_like::Dir>;
    if input.is_file() {
        // Extract the zip into a sibling temp directory under the output.
        let extract_to = output.join(".markspread-import-tmp");
        let _ = std::fs::remove_dir_all(&extract_to);
        std::fs::create_dir_all(&extract_to).map_err(AppError::from)?;
        let file = std::fs::File::open(&input).map_err(AppError::from)?;
        let mut zip = zip::ZipArchive::new(file)
            .map_err(|e| AppError::Invalid(format!("import zip read: {e}")))?;
        for i in 0..zip.len() {
            let mut entry = zip
                .by_index(i)
                .map_err(|e| AppError::Invalid(format!("import zip entry: {e}")))?;
            let Some(rel) = entry.enclosed_name() else {
                result.warnings.push(format!(
                    "skipped unsafe zip entry: {}",
                    entry.name()
                ));
                continue;
            };
            let dest = extract_to.join(&rel);
            if entry.is_dir() {
                std::fs::create_dir_all(&dest).map_err(AppError::from)?;
            } else {
                if let Some(parent) = dest.parent() {
                    std::fs::create_dir_all(parent).map_err(AppError::from)?;
                }
                let mut out = std::fs::File::create(&dest).map_err(AppError::from)?;
                std::io::copy(&mut entry, &mut out).map_err(AppError::from)?;
            }
        }
        scan_root = extract_to.clone();
        _tmp_guard = Some(tempdir_like::Dir(extract_to));
    } else {
        scan_root = input.clone();
        _tmp_guard = None;
    }

    for entry in walkdir::WalkDir::new(&scan_root)
        .into_iter()
        .filter_entry(|e| {
            !e.file_type().is_dir()
                || !is_skipped_dir(&e.file_name().to_string_lossy())
        })
        .filter_map(|e| e.ok())
    {
        let path = entry.path();
        if !entry.file_type().is_file() {
            continue;
        }
        let name = entry.file_name().to_string_lossy();
        if name == ".DS_Store" {
            continue;
        }

        let is_md = is_markdown(path);
        // Carry sibling assets (images) so embedded references survive.
        let is_asset = matches!(
            path.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()),
            Some(ref e) if matches!(
                e.as_str(),
                "png" | "jpg" | "jpeg" | "gif" | "svg" | "webp" | "pdf"
            )
        );
        if !is_md && !is_asset {
            continue;
        }
        if is_md {
            result.files_processed += 1;
        }

        if !req.copy_files {
            continue;
        }

        let rel = match path.strip_prefix(&scan_root) {
            Ok(r) => r.to_path_buf(),
            Err(_) => {
                result.errors.push(MigrationError {
                    path: path.to_string_lossy().into_owned(),
                    reason: "could not derive relative path".into(),
                });
                continue;
            }
        };
        let dest = output.join(&rel);
        // Defence in depth: never escape the destination workspace.
        let dest_parent_ok = dest
            .parent()
            .map(|p| {
                let _ = std::fs::create_dir_all(p);
                std::fs::canonicalize(p)
                    .map(|c| c.starts_with(&output_canon))
                    .unwrap_or(false)
            })
            .unwrap_or(false);
        if !dest_parent_ok {
            result.errors.push(MigrationError {
                path: rel.to_string_lossy().into_owned(),
                reason: "destination escapes workspace".into(),
            });
            continue;
        }
        match std::fs::copy(path, &dest) {
            Ok(_) => {
                if is_md {
                    result.files_written += 1;
                }
            }
            Err(e) => result.errors.push(MigrationError {
                path: rel.to_string_lossy().into_owned(),
                reason: e.to_string(),
            }),
        }
    }

    if !req.copy_files {
        result
            .warnings
            .push("manifest-only run: no files were copied".into());
    }
    result.warnings.push(format!(
        "imported from {} — review the compatibility notes for skipped syntax",
        req.source
    ));

    Ok(result)
}

/// Tiny RAII guard so the zip extraction temp dir is removed even on the
/// error paths above.
mod tempdir_like {
    use std::path::PathBuf;
    pub struct Dir(pub PathBuf);
    impl Drop for Dir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
}

// ---------------------------------------------------------------------------
// logger_set_rotation / logger_locations
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LogRotationConfig {
    pub max_bytes: u64,
    pub keep: u32,
    pub check_interval_sec: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct LogRotationSettings {
    app_log: LogRotationConfig,
    crash_log: LogRotationConfig,
}

fn log_rotation_path() -> AppResult<PathBuf> {
    Ok(data_dir()?.join("state").join("log-rotation.json"))
}

/// S-ER-011: persist the log-rotation policy. The Rust logger reads this
/// file when it next checks file sizes; we only own the configuration.
#[tauri::command]
pub fn logger_set_rotation(
    app_log: LogRotationConfig,
    crash_log: LogRotationConfig,
) -> AppResult<()> {
    for (label, c) in [("appLog", &app_log), ("crashLog", &crash_log)] {
        if c.max_bytes == 0 {
            return Err(AppError::Invalid(format!("{label}.maxBytes must be > 0")));
        }
    }
    let settings = LogRotationSettings { app_log, crash_log };
    let json = serde_json::to_vec_pretty(&settings)
        .map_err(|e| AppError::Invalid(format!("serialize log rotation: {e}")))?;
    atomic_write(&log_rotation_path()?, &json)?;
    Ok(())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogLocations {
    app_log_path: String,
    crash_log_dir: String,
}

/// Report the on-disk log paths so the Privacy panel can offer "open in
/// system viewer" without rendering the content in-app.
#[tauri::command]
pub fn logger_locations() -> AppResult<LogLocations> {
    let logs = data_dir()?.join("logs");
    Ok(LogLocations {
        app_log_path: logs.join("app.log").to_string_lossy().into_owned(),
        crash_log_dir: logs.to_string_lossy().into_owned(),
    })
}

// ---------------------------------------------------------------------------
// shell_open_external
// ---------------------------------------------------------------------------

/// Open `url` in the OS handler. Only `http`, `https` and `mailto` are
/// allowed — anything else (e.g. `file:`, `javascript:`, a bare path)
/// could hand arbitrary execution to the OS, so it is rejected.
#[tauri::command]
pub fn shell_open_external(url: String) -> AppResult<()> {
    let lowered = url.trim().to_ascii_lowercase();
    let allowed = lowered.starts_with("http://")
        || lowered.starts_with("https://")
        || lowered.starts_with("mailto:");
    if !allowed {
        return Err(AppError::Invalid(
            "only http, https and mailto URLs may be opened externally".into(),
        ));
    }
    // Control characters could be used to smuggle extra arguments.
    if url.chars().any(|c| c.is_control()) {
        return Err(AppError::Invalid("url contains control characters".into()));
    }

    #[cfg(target_os = "macos")]
    let spawn = std::process::Command::new("open").arg(&url).spawn();
    #[cfg(target_os = "windows")]
    let spawn = std::process::Command::new("cmd")
        .args(["/C", "start", "", &url])
        .spawn();
    #[cfg(all(unix, not(target_os = "macos")))]
    let spawn = std::process::Command::new("xdg-open").arg(&url).spawn();

    spawn.map_err(|e| AppError::Invalid(format!("open external url: {e}")))?;
    Ok(())
}

// ---------------------------------------------------------------------------
// security_erase_all_data
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EraseOptions {
    #[serde(default = "default_true")]
    pub wipe_app_data: bool,
    #[serde(default)]
    pub wipe_workspace_state: bool,
    #[serde(default = "default_true")]
    pub wipe_keychain: bool,
    #[serde(default)]
    pub self_uninstall: bool,
}

fn default_true() -> bool {
    true
}

impl Default for EraseOptions {
    fn default() -> Self {
        Self {
            wipe_app_data: true,
            wipe_workspace_state: false,
            wipe_keychain: true,
            self_uninstall: false,
        }
    }
}

#[derive(Debug, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RemovedItem {
    pub path: String,
    pub bytes: u64,
}

#[derive(Debug, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RemovedAlias {
    pub alias: String,
}

#[derive(Debug, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct EraseErrorItem {
    pub path: String,
    pub reason: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SelfUninstallStatus {
    pub platform: String,
    pub scheduled: bool,
    pub artifact: Option<String>,
    pub message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EraseReport {
    pub app_data_removed: Vec<RemovedItem>,
    pub workspace_state_removed: Vec<RemovedItem>,
    pub keychain_items_removed: Vec<RemovedAlias>,
    pub errors: Vec<EraseErrorItem>,
    pub self_uninstall: Option<SelfUninstallStatus>,
    pub total_bytes_removed: u64,
    pub started_at: i64,
    pub finished_at: i64,
}

/// Read every BYO key alias recorded in `ai.db` so the keychain wipe can
/// target `ai-keys/byo/<alias>` items. Best-effort: a missing/locked db
/// just yields an empty list.
fn byo_key_aliases() -> Vec<String> {
    let Ok(db) = data_dir().map(|d| d.join("ai.db")) else {
        return Vec::new();
    };
    if !db.exists() {
        return Vec::new();
    }
    let Ok(conn) = rusqlite::Connection::open(&db) else {
        return Vec::new();
    };
    let Ok(mut stmt) = conn.prepare("SELECT alias FROM ai_keys") else {
        return Vec::new();
    };
    let rows = stmt
        .query_map([], |r| r.get::<_, String>(0))
        .map(|it| it.filter_map(|r| r.ok()).collect())
        .unwrap_or_default();
    rows
}

/// S-SE-022..029: wipe Markspread's persisted state. Returns a report of
/// exactly what was touched so the result page can be honest.
///
/// `opts` is optional: the Settings → Security panel invokes this with no
/// arguments, in which case the conservative default applies (wipe app
/// data + keychain, keep workspace state, no self-uninstall).
///
/// Self-uninstall is intentionally *not* performed here. Removing the
/// running bundle from a command this audit triggers is too blunt; we
/// report a non-scheduled status with an explanatory message instead.
#[tauri::command]
pub fn security_erase_all_data(opts: Option<EraseOptions>) -> AppResult<EraseReport> {
    let opts = opts.unwrap_or_default();
    let started_at = now_ms();

    let mut app_data_removed: Vec<RemovedItem> = Vec::new();
    let mut keychain_items_removed: Vec<RemovedAlias> = Vec::new();
    let mut errors: Vec<EraseErrorItem> = Vec::new();
    let mut total_bytes_removed: u64 = 0;

    // Snapshot keychain aliases before the data dir (and ai.db) go away.
    let mut keychain_targets: Vec<String> = vec![
        "ai-keys/anthropic/subscription".to_string(),
        "telemetry/install-id".to_string(),
    ];
    if opts.wipe_keychain {
        for alias in byo_key_aliases() {
            keychain_targets.push(format!("ai-keys/byo/{alias}"));
        }
    }

    if opts.wipe_app_data {
        let dir = data_dir()?;
        if dir.exists() {
            // Tally sizes before removal so the report is accurate.
            for entry in walkdir::WalkDir::new(&dir)
                .into_iter()
                .filter_map(|e| e.ok())
            {
                if entry.file_type().is_file() {
                    let bytes = entry.metadata().map(|m| m.len()).unwrap_or(0);
                    total_bytes_removed += bytes;
                    app_data_removed.push(RemovedItem {
                        path: entry.path().to_string_lossy().into_owned(),
                        bytes,
                    });
                }
            }
            if let Err(e) = std::fs::remove_dir_all(&dir) {
                errors.push(EraseErrorItem {
                    path: dir.to_string_lossy().into_owned(),
                    reason: e.to_string(),
                });
                app_data_removed.clear();
            }
        }
    }

    if opts.wipe_keychain {
        for item in keychain_targets {
            match keyring::Entry::new(KEYCHAIN_SERVICE, &item) {
                Ok(entry) => match entry.delete_credential() {
                    Ok(()) => keychain_items_removed.push(RemovedAlias { alias: item }),
                    Err(keyring::Error::NoEntry) => {}
                    Err(e) => errors.push(EraseErrorItem {
                        path: format!("keychain:{item}"),
                        reason: e.to_string(),
                    }),
                },
                Err(e) => errors.push(EraseErrorItem {
                    path: format!("keychain:{item}"),
                    reason: e.to_string(),
                }),
            }
        }
    }

    // S-SE-024: the workspace `.markspread/` folder lives outside the app
    // data dir and its location is not passed to this command, so it is
    // wiped by the renderer's own per-workspace flow. Reported empty here.
    let workspace_state_removed: Vec<RemovedItem> = Vec::new();
    if opts.wipe_workspace_state {
        errors.push(EraseErrorItem {
            path: "<workspace>/.markspread".into(),
            reason: "workspace state must be wiped from the open workspace; \
                     no workspace path was supplied to this command"
                .into(),
        });
    }

    let self_uninstall = if opts.self_uninstall {
        Some(SelfUninstallStatus {
            platform: std::env::consts::OS.to_string(),
            scheduled: false,
            artifact: None,
            message: "Self-uninstall was requested but is not performed \
                      automatically. Delete the Markspread application \
                      bundle manually to finish removal."
                .into(),
        })
    } else {
        None
    };

    Ok(EraseReport {
        app_data_removed,
        workspace_state_removed,
        keychain_items_removed,
        errors,
        self_uninstall,
        total_bytes_removed,
        started_at,
        finished_at: now_ms(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_non_http_external_urls() {
        assert!(shell_open_external("file:///etc/passwd".into()).is_err());
        assert!(shell_open_external("javascript:alert(1)".into()).is_err());
        assert!(shell_open_external("/bin/sh".into()).is_err());
    }

    #[test]
    fn erase_options_default_is_conservative() {
        let d = EraseOptions::default();
        assert!(d.wipe_app_data);
        assert!(d.wipe_keychain);
        assert!(!d.wipe_workspace_state);
        assert!(!d.self_uninstall);
    }

    #[test]
    fn is_markdown_detects_extensions() {
        assert!(is_markdown(Path::new("a/b.md")));
        assert!(is_markdown(Path::new("a/b.MARKDOWN")));
        assert!(!is_markdown(Path::new("a/b.txt")));
    }
}
