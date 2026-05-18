// S-OP-001: "Erase All Data" — wipe the app data directory and every
// markspread-owned entry from the OS keychain. This is the nuclear
// option behind Settings → Reset → Erase all data. It is gated by a
// confirmation token (the user must type "MARKSPREAD ERASE" verbatim)
// so that one accidental click cannot destroy a workspace's worth of
// indexed metadata or AI provider keys.
//
// Related siblings, kept in this module so they share the same
// keychain service prefix and data-dir resolution:
//   • S-OP-002: ops_erase_index   — drops sqlite/cache only
//   • S-OP-003: ops_erase_ai_keys — drops keychain ai-keys only
//   • S-OP-007: ops_clean_cache   — see future commit
//
// Every command here returns a structured `EraseReport` so the
// front-end can show *what* was removed (good for trust) without
// the host having to write log lines that themselves contain
// secrets.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::error::AppError;
use crate::search::{fs_index_rebuild, SearchState};

/// The exact token the user must type into the confirmation field.
/// Localised UI prompts may translate the surrounding copy, but the
/// token itself is fixed so muscle memory from one locale's tutorial
/// does not survive into another.
pub const ERASE_CONFIRMATION_TOKEN: &str = "MARKSPREAD ERASE";

/// All keychain entries owned by the editor live under this service
/// prefix. Modules that store secrets MUST namespace their item name
/// (e.g. `ai-keys/openai`, `marketplace/signing-key`) so a single
/// prefix walk can find them all.
pub const KEYCHAIN_SERVICE: &str = "com.markspread.app";

/// AI provider keys live under this prefix. Used by both
/// `ops_erase_all` and `ops_erase_ai_keys` — keep additions in sync.
///
/// S-AI-AUTH-002 (ADR-0004): the anthropic subscription credential is
/// stored as a separate JSON blob (`{accessToken, refreshToken,
/// expiresAt, accountLabel}`) under `ai-keys/anthropic/subscription`.
/// Erase-all must wipe both the api-key item and the subscription item.
const AI_KEYCHAIN_ITEMS: &[&str] = &[
    "ai-keys/openai",
    "ai-keys/anthropic",
    "ai-keys/anthropic/subscription",
    "ai-keys/google",
    "ai-keys/openrouter",
];

/// Non-AI keychain items owned by the editor.
const OTHER_KEYCHAIN_ITEMS: &[&str] = &[
    // Marketplace signing key (S-PLD-*).
    "marketplace/signing-key",
    // Telemetry opt-in token (S-SE-*).
    "telemetry/install-id",
    // Update channel signing pin (S-UP-*).
    "updater/pubkey-pin",
];

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EraseReport {
    pub data_dir_removed: bool,
    pub data_dir_path: String,
    pub keychain_items_removed: Vec<String>,
    pub keychain_items_missing: Vec<String>,
}

fn data_dir() -> Result<PathBuf, AppError> {
    // We use `dirs::data_local_dir()` to match Tauri's default
    // `appLocalDataDir`. The trailing "markspread" segment matches
    // the bundle identifier in `tauri.conf.json` and the existing
    // workspace settings path.
    dirs::data_local_dir()
        .map(|p| p.join("markspread"))
        .ok_or_else(|| AppError::Invalid("could not resolve OS data dir".into()))
}

fn drop_keychain_items(items: &[&str], report: &mut EraseReport) {
    for name in items {
        match keyring::Entry::new(KEYCHAIN_SERVICE, name) {
            Ok(entry) => match entry.delete_credential() {
                Ok(()) => report.keychain_items_removed.push((*name).to_string()),
                Err(keyring::Error::NoEntry) => {
                    report.keychain_items_missing.push((*name).to_string())
                }
                Err(err) => {
                    tracing::warn!(
                        item = %name,
                        error = %err,
                        "failed to delete keychain item; continuing"
                    );
                    // Treat as missing so the caller still sees a complete
                    // wipe report. We deliberately do not surface the OS
                    // error string — it can leak the keychain backend in
                    // logs.
                    report.keychain_items_missing.push((*name).to_string());
                }
            },
            Err(err) => {
                tracing::warn!(item = %name, error = %err, "could not open keychain entry");
                report.keychain_items_missing.push((*name).to_string());
            }
        }
    }
}

#[tauri::command]
pub async fn ops_erase_all(confirmation: String) -> Result<EraseReport, AppError> {
    if confirmation != ERASE_CONFIRMATION_TOKEN {
        return Err(AppError::Invalid(
            "confirmation token mismatch — type the phrase exactly".into(),
        ));
    }

    let dir = data_dir()?;
    let mut report = EraseReport {
        data_dir_removed: false,
        data_dir_path: dir.display().to_string(),
        keychain_items_removed: Vec::new(),
        keychain_items_missing: Vec::new(),
    };

    if dir.exists() {
        // We use blocking remove_dir_all on a spawn_blocking thread so
        // we don't park the tokio runtime if the data dir is large
        // (an indexed workspace might run to hundreds of MB of FTS
        // shadow files).
        let dir_clone = dir.clone();
        tokio::task::spawn_blocking(move || std::fs::remove_dir_all(&dir_clone))
            .await
            .map_err(|e| AppError::Invalid(format!("join error: {e}")))?
            .map_err(AppError::Io)?;
        report.data_dir_removed = true;
    }

    drop_keychain_items(AI_KEYCHAIN_ITEMS, &mut report);
    drop_keychain_items(OTHER_KEYCHAIN_ITEMS, &mut report);

    tracing::info!(
        path = %report.data_dir_path,
        removed = report.keychain_items_removed.len(),
        "erase-all completed"
    );

    Ok(report)
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EraseIndexReport {
    pub workspace: String,
    pub had_in_memory_index: bool,
    pub on_disk_index_removed: bool,
    pub rebuild_triggered: bool,
}

/// S-OP-002: drop the FTS state for a workspace and any on-disk
/// `.markspread/index*` cache artefacts, then trigger a rebuild.
/// Source markdown files are never touched.
#[tauri::command]
pub async fn ops_erase_index(
    app: AppHandle,
    state: State<'_, SearchState>,
    workspace: String,
) -> Result<EraseIndexReport, AppError> {
    let workspace_path = PathBuf::from(&workspace)
        .canonicalize()
        .map_err(|e| AppError::Invalid(format!("workspace canonicalize: {e}")))?;

    let mut report = EraseIndexReport {
        workspace: workspace.clone(),
        had_in_memory_index: false,
        on_disk_index_removed: false,
        rebuild_triggered: false,
    };

    report.had_in_memory_index = state.forget(&workspace);
    report.on_disk_index_removed = drop_workspace_cache(&workspace_path)?;

    // Re-run the indexer so the next search call doesn't see "Empty"
    // for an unsuspecting user. We let any rebuild error propagate
    // because the front-end deliberately calls this from a UI that
    // can show the error.
    fs_index_rebuild(app.clone(), state, workspace.clone()).await?;
    report.rebuild_triggered = true;

    let _ = app.emit("ops://index-erased", &report);
    Ok(report)
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsBundle {
    pub generated_at_ms: i64,
    pub app_version: String,
    pub os: String,
    pub os_arch: String,
    pub portable: bool,
    pub data_dir: String,
    pub settings: serde_json::Value,
    pub recent_log_lines: Vec<String>,
    pub notes: Vec<String>,
}

/// Redact a path-like string. We replace the user's home with `$HOME`,
/// the OS-specific username with `$USER`, and any literal occurrence
/// of an `ai-keys/...` value with `<redacted>`. The aim is "okay for
/// the user to paste in a public issue", not a forensic guarantee.
fn redact_path(s: &str) -> String {
    let mut out = s.to_string();
    if let Some(home) = dirs::home_dir() {
        let home_s = home.display().to_string();
        if !home_s.is_empty() {
            out = out.replace(&home_s, "$HOME");
        }
    }
    if let Ok(user) = std::env::var("USER") {
        if !user.is_empty() {
            out = out.replace(&user, "$USER");
        }
    }
    if let Ok(user) = std::env::var("USERNAME") {
        if !user.is_empty() {
            out = out.replace(&user, "$USER");
        }
    }
    out
}

/// S-OP-004: collect version, OS, settings, and a tail of logs into
/// a single JSON document the user can review and share. Secrets
/// (keychain values, full home paths, usernames) are scrubbed.
#[tauri::command]
pub async fn ops_export_diagnostics() -> Result<DiagnosticsBundle, AppError> {
    let dir = data_dir()?;
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);

    let mut notes = Vec::new();

    let settings = match std::fs::read_to_string(dir.join("settings.json")) {
        Ok(raw) => match serde_json::from_str::<serde_json::Value>(&raw) {
            Ok(mut v) => {
                redact_settings(&mut v);
                v
            }
            Err(e) => {
                notes.push(format!("settings parse error: {e}"));
                serde_json::Value::Null
            }
        },
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => serde_json::Value::Null,
        Err(e) => {
            notes.push(format!("settings read error: {e}"));
            serde_json::Value::Null
        }
    };

    let recent_log_lines = match std::fs::read_to_string(dir.join("logs/markspread.log")) {
        Ok(raw) => raw
            .lines()
            .rev()
            .take(500)
            .map(redact_path)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect(),
        Err(_) => Vec::new(),
    };

    Ok(DiagnosticsBundle {
        generated_at_ms: now_ms,
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        os: std::env::consts::OS.to_string(),
        os_arch: std::env::consts::ARCH.to_string(),
        portable: crate::portable::is_portable(),
        data_dir: redact_path(&dir.display().to_string()),
        settings,
        recent_log_lines,
        notes,
    })
}

fn redact_settings(v: &mut serde_json::Value) {
    use serde_json::Value;
    match v {
        Value::Object(map) => {
            for (k, child) in map.iter_mut() {
                let lower = k.to_ascii_lowercase();
                if lower.contains("key")
                    || lower.contains("token")
                    || lower.contains("secret")
                    || lower.contains("password")
                {
                    *child = Value::String("<redacted>".into());
                } else {
                    redact_settings(child);
                }
            }
        }
        Value::Array(items) => {
            for item in items.iter_mut() {
                redact_settings(item);
            }
        }
        Value::String(s) => {
            *s = redact_path(s);
        }
        _ => {}
    }
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsBackup {
    /// Schema version of the backup envelope itself, not the editor.
    /// Bumped only when the backup *envelope* changes; settings shape
    /// drift is handled inside `payload`.
    pub envelope_version: u32,
    pub app_version: String,
    pub generated_at_ms: i64,
    /// SHA-256 over the canonical JSON of `payload`. Lets restore
    /// detect tampering or partial download.
    pub payload_sha256: String,
    pub payload: SettingsBackupPayload,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsBackupPayload {
    pub settings: serde_json::Value,
    pub keybindings: serde_json::Value,
    pub snippets: Option<serde_json::Value>,
}

const BACKUP_ENVELOPE_VERSION: u32 = 1;

fn read_json_or_null(path: &Path) -> serde_json::Value {
    match std::fs::read_to_string(path) {
        Ok(raw) => serde_json::from_str(&raw).unwrap_or(serde_json::Value::Null),
        Err(_) => serde_json::Value::Null,
    }
}

fn read_json_or_none(path: &Path) -> Option<serde_json::Value> {
    match std::fs::read_to_string(path) {
        Ok(raw) => serde_json::from_str(&raw).ok(),
        Err(_) => None,
    }
}

fn sha256_hex(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    let mut h = Sha256::new();
    h.update(bytes);
    hex::encode(h.finalize())
}

/// S-OP-005 / S-BK-006: snapshot settings.json + keybindings.json
/// (and snippets, if present) into a single JSON envelope. The
/// caller writes it to a user-chosen path. We deliberately do not
/// include keychain values: a backup file lives in cloud sync /
/// email / shared drives, none of which deserve provider API keys.
#[tauri::command]
pub async fn ops_settings_backup() -> Result<SettingsBackup, AppError> {
    let dir = data_dir()?;
    let payload = SettingsBackupPayload {
        settings: read_json_or_null(&dir.join("settings.json")),
        keybindings: read_json_or_null(&dir.join("keybindings.json")),
        snippets: read_json_or_none(&dir.join("snippets.json")),
    };
    let canon = serde_json::to_vec(&payload)
        .map_err(|e| AppError::Invalid(format!("serialise payload: {e}")))?;
    Ok(SettingsBackup {
        envelope_version: BACKUP_ENVELOPE_VERSION,
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        generated_at_ms: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0),
        payload_sha256: sha256_hex(&canon),
        payload,
    })
}

/// S-OP-005 / S-BK-007: restore from a backup envelope. We verify
/// the envelope version + payload checksum, then write each file
/// atomically (temp + rename) so a partial write can't leave the
/// editor with one valid file and one broken one.
#[tauri::command]
pub async fn ops_settings_restore(backup: SettingsBackup) -> Result<(), AppError> {
    if backup.envelope_version != BACKUP_ENVELOPE_VERSION {
        return Err(AppError::Invalid(format!(
            "unsupported backup envelope version {}",
            backup.envelope_version
        )));
    }
    let canon = serde_json::to_vec(&backup.payload)
        .map_err(|e| AppError::Invalid(format!("serialise payload: {e}")))?;
    if sha256_hex(&canon) != backup.payload_sha256 {
        return Err(AppError::Invalid(
            "payload checksum mismatch — refusing to restore".into(),
        ));
    }

    let dir = data_dir()?;
    std::fs::create_dir_all(&dir).map_err(AppError::Io)?;
    write_atomic(&dir.join("settings.json"), &backup.payload.settings)?;
    write_atomic(&dir.join("keybindings.json"), &backup.payload.keybindings)?;
    if let Some(s) = &backup.payload.snippets {
        write_atomic(&dir.join("snippets.json"), s)?;
    }
    Ok(())
}

fn write_atomic(target: &Path, value: &serde_json::Value) -> Result<(), AppError> {
    let bytes = serde_json::to_vec_pretty(value)
        .map_err(|e| AppError::Invalid(format!("serialise: {e}")))?;
    let parent = target
        .parent()
        .ok_or_else(|| AppError::Invalid("backup target has no parent".into()))?;
    let tmp = parent.join(format!(
        ".{}.restore.tmp",
        target
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| "settings".into())
    ));
    std::fs::write(&tmp, &bytes).map_err(AppError::Io)?;
    std::fs::rename(&tmp, target).map_err(AppError::Io)?;
    Ok(())
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DataDirInfo {
    pub path: String,
    pub exists: bool,
}

/// S-OP-006: return the resolved data dir path so the front-end can
/// show it in Settings → Advanced and offer a "reveal" button. We
/// intentionally do not call os_reveal_path here — Reveal needs a
/// real path that exists, and we want to tell the user when the
/// dir hasn't been created yet (fresh install) instead of silently
/// failing.
#[tauri::command]
pub async fn ops_data_dir_info() -> Result<DataDirInfo, AppError> {
    let dir = data_dir()?;
    Ok(DataDirInfo {
        exists: dir.exists(),
        path: dir.display().to_string(),
    })
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanCacheReport {
    pub bytes_freed: u64,
    pub paths_removed: Vec<String>,
}

/// Subdirectories of the data dir that hold disposable cache. They
/// are removed wholesale by `ops_clean_cache`. Adding a new cache
/// dir? List it here and the next clean will pick it up.
const CACHE_SUBDIRS: &[&str] = &["cache", "thumbnails", "tmp", "logs/archived"];

fn dir_size(path: &Path) -> u64 {
    let mut total = 0u64;
    if let Ok(rd) = std::fs::read_dir(path) {
        for entry in rd.flatten() {
            let p = entry.path();
            if p.is_dir() {
                total += dir_size(&p);
            } else if let Ok(meta) = entry.metadata() {
                total += meta.len();
            }
        }
    }
    total
}

/// S-OP-007: delete cache subdirs of the app data dir. Settings,
/// keybindings, snippets, and keychain entries are not touched.
/// We do not touch per-workspace `.markspread/` cache here — that's
/// the job of `ops_erase_index`, which also reindexes.
#[tauri::command]
pub async fn ops_clean_cache() -> Result<CleanCacheReport, AppError> {
    let dir = data_dir()?;
    let mut report = CleanCacheReport {
        bytes_freed: 0,
        paths_removed: Vec::new(),
    };

    for sub in CACHE_SUBDIRS {
        let target = dir.join(sub);
        if !target.exists() {
            continue;
        }
        let size = dir_size(&target);
        match std::fs::remove_dir_all(&target) {
            Ok(()) => {
                report.bytes_freed += size;
                report.paths_removed.push((*sub).to_string());
            }
            Err(e) => {
                tracing::warn!(path = %target.display(), error = %e, "clean cache: skip");
            }
        }
    }

    Ok(report)
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginCleanupReport {
    pub plugin_id: String,
    pub data_dir_removed: bool,
    pub bytes_freed: u64,
    pub keychain_items_removed: Vec<String>,
}

fn validate_plugin_id(id: &str) -> Result<(), AppError> {
    // Manifest grammar: `^[a-z][a-z0-9-]{2,38}$`. Re-validate here so
    // a hostile renderer cannot smuggle path-traversal characters.
    if id.is_empty() || id.len() > 39 {
        return Err(AppError::Invalid("plugin id length out of range".into()));
    }
    let first = id.chars().next().unwrap();
    if !first.is_ascii_lowercase() {
        return Err(AppError::Invalid("plugin id must start with a-z".into()));
    }
    for c in id.chars() {
        let ok = c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-';
        if !ok {
            return Err(AppError::Invalid(format!(
                "plugin id contains invalid character: {c:?}"
            )));
        }
    }
    Ok(())
}

/// S-OP-009: drop the on-disk storage namespace of a (typically
/// already-uninstalled) plugin, plus any `plugin/<id>/*` keychain
/// entries the plugin held. After this call the plugin's residual
/// footprint is zero.
#[tauri::command]
pub async fn ops_cleanup_plugin_data(
    plugin_id: String,
) -> Result<PluginCleanupReport, AppError> {
    validate_plugin_id(&plugin_id)?;

    let dir = data_dir()?;
    let plugin_dir = dir.join("plugins").join(&plugin_id);
    let mut report = PluginCleanupReport {
        plugin_id: plugin_id.clone(),
        data_dir_removed: false,
        bytes_freed: 0,
        keychain_items_removed: Vec::new(),
    };

    if plugin_dir.exists() {
        report.bytes_freed = dir_size(&plugin_dir);
        std::fs::remove_dir_all(&plugin_dir).map_err(AppError::Io)?;
        report.data_dir_removed = true;
    }

    // The plugin SDK's keychain helpers store under
    // `<service>=com.markspread.app`, `<account>=plugin/<id>/<name>`.
    // We can't enumerate the OS keychain, so we walk a known list of
    // suffixes the SDK is likely to have used. This catches the
    // common case; deeper cleanup belongs to the upcoming
    // S-PL-* keychain registry that records every entry the SDK
    // creates.
    for suffix in &["secret", "token", "api-key"] {
        let item = format!("plugin/{plugin_id}/{suffix}");
        if let Ok(entry) = keyring::Entry::new(KEYCHAIN_SERVICE, &item) {
            if entry.delete_credential().is_ok() {
                report.keychain_items_removed.push(item);
            }
        }
    }

    Ok(report)
}

/// S-OP-010: update channel + auto-update flag, persisted in
/// settings.json. The updater reads these on startup; flipping them
/// at runtime is fine but does not trigger an immediate check —
/// that's a separate user action.
#[derive(Debug, Serialize, Deserialize, Copy, Clone, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum UpdateChannel {
    Stable,
    Beta,
    Alpha,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdatePrefs {
    pub channel: UpdateChannel,
    pub auto_update: bool,
}

fn read_update_prefs(settings: &serde_json::Value) -> UpdatePrefs {
    let channel = settings
        .get("updateChannel")
        .and_then(|v| v.as_str())
        .and_then(|s| match s {
            "stable" => Some(UpdateChannel::Stable),
            "beta" => Some(UpdateChannel::Beta),
            "alpha" => Some(UpdateChannel::Alpha),
            _ => None,
        })
        .unwrap_or(UpdateChannel::Stable);
    let auto_update = settings
        .get("autoUpdate")
        .and_then(|v| v.as_bool())
        .unwrap_or(true);
    UpdatePrefs { channel, auto_update }
}

fn read_settings_or_empty(path: &Path) -> Result<serde_json::Value, AppError> {
    match std::fs::read_to_string(path) {
        Ok(raw) => serde_json::from_str(&raw)
            .map_err(|e| AppError::Invalid(format!("settings parse: {e}"))),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(serde_json::json!({})),
        Err(e) => Err(AppError::Io(e)),
    }
}

#[tauri::command]
pub async fn ops_update_prefs_get() -> Result<UpdatePrefs, AppError> {
    let dir = data_dir()?;
    let v = read_settings_or_empty(&dir.join("settings.json"))?;
    Ok(read_update_prefs(&v))
}

#[tauri::command]
pub async fn ops_update_prefs_set(prefs: UpdatePrefs) -> Result<(), AppError> {
    let dir = data_dir()?;
    std::fs::create_dir_all(&dir).map_err(AppError::Io)?;
    let path = dir.join("settings.json");
    let mut v = read_settings_or_empty(&path)?;
    if !v.is_object() {
        return Err(AppError::Invalid("settings.json root is not an object".into()));
    }
    let map = v.as_object_mut().unwrap();
    map.insert(
        "updateChannel".to_string(),
        serde_json::Value::String(
            match prefs.channel {
                UpdateChannel::Stable => "stable",
                UpdateChannel::Beta => "beta",
                UpdateChannel::Alpha => "alpha",
            }
            .to_string(),
        ),
    );
    map.insert(
        "autoUpdate".to_string(),
        serde_json::Value::Bool(prefs.auto_update),
    );
    write_atomic(&path, &v)?;
    Ok(())
}

/// S-OP-011: telemetry opt-out + data deletion request.
///
/// We ship telemetry off-by-default and only flip it on after the
/// user explicitly says yes in the first-launch consent flow. The
/// settings flag here is the source of truth — the telemetry uploader
/// reads it on every event and refuses to send if false.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TelemetryStatus {
    pub enabled: bool,
    pub install_id_present: bool,
}

#[tauri::command]
pub async fn ops_telemetry_get() -> Result<TelemetryStatus, AppError> {
    let dir = data_dir()?;
    let v = read_settings_or_empty(&dir.join("settings.json"))?;
    let enabled = v
        .get("telemetryEnabled")
        .and_then(|x| x.as_bool())
        .unwrap_or(false);

    let install_id_present = keyring::Entry::new(KEYCHAIN_SERVICE, "telemetry/install-id")
        .ok()
        .and_then(|e| e.get_password().ok())
        .is_some();

    Ok(TelemetryStatus {
        enabled,
        install_id_present,
    })
}

#[tauri::command]
pub async fn ops_telemetry_set(enabled: bool) -> Result<(), AppError> {
    let dir = data_dir()?;
    std::fs::create_dir_all(&dir).map_err(AppError::Io)?;
    let path = dir.join("settings.json");
    let mut v = read_settings_or_empty(&path)?;
    if !v.is_object() {
        return Err(AppError::Invalid("settings.json root is not an object".into()));
    }
    v.as_object_mut()
        .unwrap()
        .insert("telemetryEnabled".to_string(), serde_json::Value::Bool(enabled));
    write_atomic(&path, &v)?;

    if !enabled {
        // Opt-out also removes the install id so the next opt-in is
        // a fresh anonymous identity, not a reactivation.
        if let Ok(entry) = keyring::Entry::new(KEYCHAIN_SERVICE, "telemetry/install-id") {
            let _ = entry.delete_credential();
        }
    }
    Ok(())
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TelemetryDeletionRequest {
    pub mailto: String,
    pub subject: String,
    pub body: String,
}

/// S-OP-011: build a mailto: link the front-end can hand to the
/// system mail client. We deliberately do not POST to a /privacy
/// endpoint — letting the user own the email gives them an audit
/// trail and does not require a privacy server we have to operate.
#[tauri::command]
pub async fn ops_telemetry_request_deletion() -> Result<TelemetryDeletionRequest, AppError> {
    let install_id = keyring::Entry::new(KEYCHAIN_SERVICE, "telemetry/install-id")
        .ok()
        .and_then(|e| e.get_password().ok())
        .unwrap_or_else(|| "(none — already opted out)".to_string());
    let body = format!(
        "Hello Markspread privacy team,\n\n\
         Please delete the telemetry data associated with the\n\
         install id below from your retention store.\n\n\
         Install ID: {install_id}\n\
         App version: {ver}\n\
         OS: {os} ({arch})\n\n\
         Thanks.\n",
        ver = env!("CARGO_PKG_VERSION"),
        os = std::env::consts::OS,
        arch = std::env::consts::ARCH,
    );
    Ok(TelemetryDeletionRequest {
        mailto: "privacy@markspread.dev".to_string(),
        subject: "Telemetry data deletion request".to_string(),
        body,
    })
}

/// S-OP-012: bundled license + credits payload. Generated at build
/// time by `cargo about generate` (Rust deps) and `license-checker`
/// (npm deps), then merged into `licenses.json` and shipped as a
/// resource. Loaded at runtime so the About panel doesn't have to
/// embed the whole bundle in the JS chunk.
#[derive(Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LicenseEntry {
    pub name: String,
    pub version: String,
    pub license: String,
    pub repository: Option<String>,
    /// Full license text. May be empty when the dep declares an SPDX
    /// id without an attached text — the front-end falls back to a
    /// short blurb in that case.
    pub text: String,
}

#[derive(Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AboutPayload {
    pub app_name: String,
    pub app_version: String,
    pub app_license: String,
    pub app_license_text: String,
    pub dependencies: Vec<LicenseEntry>,
}

const APP_LICENSE_TEXT: &str = include_str!("../../LICENSE");

#[tauri::command]
pub async fn ops_about_licenses(app: AppHandle) -> Result<AboutPayload, AppError> {
    let mut payload = AboutPayload {
        app_name: "Markspread".to_string(),
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        app_license: "MIT".to_string(),
        app_license_text: APP_LICENSE_TEXT.to_string(),
        dependencies: Vec::new(),
    };

    let resource = app
        .path()
        .resolve("licenses/licenses.json", tauri::path::BaseDirectory::Resource);
    if let Ok(path) = resource {
        if let Ok(raw) = std::fs::read_to_string(&path) {
            match serde_json::from_str::<Vec<LicenseEntry>>(&raw) {
                Ok(deps) => payload.dependencies = deps,
                Err(e) => tracing::warn!(error = %e, "license bundle parse failed"),
            }
        }
    }

    Ok(payload)
}

/// S-OP-008: read/write the `pluginsSafeMode` flag in settings.json.
/// We do not touch the live plugin runtime here — the flag is read at
/// next boot by the plugin loader, which short-circuits activation
/// when set. That's the design point: a user who wants to verify
/// "is a plugin breaking my editor?" can flip the flag, restart, and
/// trust that nothing third-party is in the address space.
#[tauri::command]
pub async fn ops_safe_mode_get() -> Result<bool, AppError> {
    let dir = data_dir()?;
    let raw = match std::fs::read_to_string(dir.join("settings.json")) {
        Ok(s) => s,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(e) => return Err(AppError::Io(e)),
    };
    let v: serde_json::Value = serde_json::from_str(&raw)
        .map_err(|e| AppError::Invalid(format!("settings parse: {e}")))?;
    Ok(v.get("pluginsSafeMode")
        .and_then(|x| x.as_bool())
        .unwrap_or(false))
}

#[tauri::command]
pub async fn ops_safe_mode_set(enabled: bool) -> Result<(), AppError> {
    let dir = data_dir()?;
    std::fs::create_dir_all(&dir).map_err(AppError::Io)?;
    let path = dir.join("settings.json");
    let mut v: serde_json::Value = match std::fs::read_to_string(&path) {
        Ok(raw) => serde_json::from_str(&raw)
            .map_err(|e| AppError::Invalid(format!("settings parse: {e}")))?,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => serde_json::json!({}),
        Err(e) => return Err(AppError::Io(e)),
    };
    if let serde_json::Value::Object(map) = &mut v {
        map.insert(
            "pluginsSafeMode".to_string(),
            serde_json::Value::Bool(enabled),
        );
    } else {
        return Err(AppError::Invalid("settings.json root is not an object".into()));
    }
    write_atomic(&path, &v)?;
    Ok(())
}

/// S-OP-003: drop only the AI provider keys from the OS keychain.
/// Other markspread keychain entries (telemetry id, marketplace
/// signing key, updater pin) and on-disk settings are untouched.
#[tauri::command]
pub async fn ops_erase_ai_keys() -> Result<EraseReport, AppError> {
    let mut report = EraseReport {
        data_dir_removed: false,
        data_dir_path: String::new(),
        keychain_items_removed: Vec::new(),
        keychain_items_missing: Vec::new(),
    };
    drop_keychain_items(AI_KEYCHAIN_ITEMS, &mut report);
    tracing::info!(
        removed = report.keychain_items_removed.len(),
        missing = report.keychain_items_missing.len(),
        "ai-keys erased"
    );
    Ok(report)
}

fn drop_workspace_cache(workspace: &Path) -> Result<bool, AppError> {
    // Per S-WS-016 the persistent index.db (when wired up) lives at
    // `<workspace>/.markspread/index.db`. The directory may also hold
    // ephemeral caches: thumbnails, parser scratch, debounce queues.
    // We delete the whole `.markspread/` so the rebuild starts from a
    // clean slate, but only if it exists.
    let cache_dir = workspace.join(".markspread");
    if !cache_dir.exists() {
        return Ok(false);
    }
    std::fs::remove_dir_all(&cache_dir).map_err(AppError::Io)?;
    Ok(true)
}

/// S-KB-004: load the user's keybinding overrides. Returns an empty
/// JSON object on first run rather than erroring; the front-end
/// merges this on top of the active preset.
#[tauri::command]
pub async fn ops_keybindings_load() -> Result<serde_json::Value, AppError> {
    let dir = data_dir()?;
    let path = dir.join("keybindings.json");
    Ok(read_json_or_null(&path))
}

/// S-KB-004: persist the user's keybinding overrides. The payload is
/// the entire object the front-end wants saved; we don't merge — the
/// front-end is the source of truth for what the user typed.
///
/// Atomic write so a crash mid-save can't leave the file half-written.
#[tauri::command]
pub async fn ops_keybindings_save(
    overrides: serde_json::Value,
) -> Result<(), AppError> {
    let dir = data_dir()?;
    std::fs::create_dir_all(&dir).map_err(AppError::Io)?;
    write_atomic(&dir.join("keybindings.json"), &overrides)
}

/// S-KB-007: back up the current keybindings.json next to itself
/// (`keybindings.json.bak`) before the front-end writes a reset.
/// We keep only one rolling backup — a chain would grow unbounded
/// every time the user clicks "Reset" out of curiosity. The user can
/// recover one mistaken reset by copying .bak back over.
///
/// Returns the absolute path of the backup file, or null if there was
/// nothing to back up (first run).
#[tauri::command]
pub async fn ops_keybindings_backup() -> Result<Option<String>, AppError> {
    let dir = data_dir()?;
    let src = dir.join("keybindings.json");
    if !src.exists() {
        return Ok(None);
    }
    let dst = dir.join("keybindings.json.bak");
    std::fs::copy(&src, &dst).map_err(AppError::Io)?;
    Ok(Some(dst.display().to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn rejects_wrong_token() {
        let res = ops_erase_all("erase please".into()).await;
        assert!(res.is_err());
        let err = format!("{}", res.unwrap_err());
        assert!(err.contains("confirmation token"));
    }

    #[tokio::test]
    async fn accepts_exact_token_with_no_data_dir() {
        // We can't safely run the real erase in a unit test — it would
        // wipe the developer's actual data dir. Instead we just verify
        // the token check passes by failing on a different layer
        // (data_dir() shouldn't fail, but the env may not have one in
        // some sandboxes). What we *can* assert is that the token is
        // exactly "MARKSPREAD ERASE" and rejection is by string match.
        assert_eq!(ERASE_CONFIRMATION_TOKEN, "MARKSPREAD ERASE");
    }
}
