use crate::error::{AppError, AppResult};
use crate::path_norm::to_nfc;
use serde::Serialize;
use std::path::{Path, PathBuf};

const META_DIR: &str = ".markspread";
const SETTINGS_FILE: &str = "settings.json";
const INDEX_FILE: &str = "index.db";
const SNAPSHOTS_DIR: &str = "snapshots";
const RECENT_FILE: &str = "recent.json";
const LAYOUT_FILE: &str = "layout.json";
const SETTINGS_SCHEMA_VERSION: u32 = 1;
const LAYOUT_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Serialize)]
pub struct WorkspaceLayout {
    pub root: String,
    pub meta_dir: String,
    pub settings: String,
    pub index_db: String,
    pub snapshots: String,
    pub already_existed: bool,
    pub settings_schema_version: Option<u32>,
    pub current_schema_version: u32,
    pub index_db_corrupt: bool,
    pub read_only: bool,
}

fn default_settings() -> serde_json::Value {
    serde_json::json!({
        "schemaVersion": SETTINGS_SCHEMA_VERSION,
        "createdAtMs": std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0),
        "ai": { "providers": [] },
        "plugins": { "enabled": [] }
    })
}

fn default_recent() -> serde_json::Value {
    serde_json::json!({
        "schemaVersion": 1,
        "items": []
    })
}

async fn probe_writable(root: &Path) -> AppResult<()> {
    let probe = root.join(format!(
        ".markspread.write-probe-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0)
    ));
    match tokio::fs::write(&probe, b"").await {
        Ok(()) => {
            let _ = tokio::fs::remove_file(&probe).await;
            Ok(())
        }
        Err(e) => Err(e.into()),
    }
}

/// S-WS-024: non-fatal write probe used for read-only mode detection. Maps
/// EROFS/EPERM/EACCES → `Ok(true)` (read-only) instead of bubbling.
async fn detect_read_only(root: &Path) -> bool {
    match probe_writable(root).await {
        Ok(()) => false,
        Err(AppError::PermissionDenied(_)) => true,
        Err(_) => false, // other errors aren't a read-only signal
    }
}

#[tauri::command]
pub async fn workspace_scaffold(workspace: String) -> AppResult<WorkspaceLayout> {
    let root = PathBuf::from(&workspace)
        .canonicalize()
        .map_err(|e| AppError::Invalid(format!("workspace canonicalize: {e}")))?;
    if !root.is_dir() {
        return Err(AppError::Invalid(format!(
            "not a directory: {}",
            root.display()
        )));
    }
    let meta = root.join(META_DIR);

    // If `.markspread/` already exists, treat this as "open existing" — don't
    // overwrite settings or wipe state. The caller (S-WS-002) decides UX.
    if meta.exists() {
        let settings_schema_version = read_settings_schema(&meta.join(SETTINGS_FILE)).await;
        let index_db_corrupt = !is_index_db_intact(&meta.join(INDEX_FILE)).await;
        let read_only = detect_read_only(&root).await;
        return Ok(WorkspaceLayout {
            root: to_nfc(&root),
            meta_dir: to_nfc(&meta),
            settings: to_nfc(meta.join(SETTINGS_FILE)),
            index_db: to_nfc(meta.join(INDEX_FILE)),
            snapshots: to_nfc(meta.join(SNAPSHOTS_DIR)),
            already_existed: true,
            settings_schema_version,
            current_schema_version: SETTINGS_SCHEMA_VERSION,
            index_db_corrupt,
            read_only,
        });
    }

    // S-WS-024: if the root is read-only there's nothing to scaffold. Open
    // as a virtual workspace — meta_dir paths are returned for completeness
    // but they don't exist on disk; the front-end gates writes on
    // `read_only`.
    if detect_read_only(&root).await {
        return Ok(WorkspaceLayout {
            root: to_nfc(&root),
            meta_dir: to_nfc(&meta),
            settings: to_nfc(meta.join(SETTINGS_FILE)),
            index_db: to_nfc(meta.join(INDEX_FILE)),
            snapshots: to_nfc(meta.join(SNAPSHOTS_DIR)),
            already_existed: false,
            settings_schema_version: None,
            current_schema_version: SETTINGS_SCHEMA_VERSION,
            index_db_corrupt: false,
            read_only: true,
        });
    }

    // Probe write permission *before* we touch the workspace. If this fails the
    // user gets the canonical PermissionDenied message instead of a partial
    // scaffold + obscure rename error.
    probe_writable(&root).await?;

    // Atomic-ish scaffold: build into a temp sibling, then rename. If any step
    // fails we wipe the scratch dir so the workspace stays untouched.
    let scratch = root.join(format!(".markspread.scratch-{}", std::process::id()));
    if scratch.exists() {
        let _ = tokio::fs::remove_dir_all(&scratch).await;
    }
    if let Err(e) = scaffold_into(&scratch).await {
        // Best-effort cleanup; if even this fails (e.g. on ENOSPC the unlink
        // succeeded but rmdir cannot allocate metadata), leave the half-empty
        // scratch dir for a subsequent retry to clear.
        if let Err(rm_err) = tokio::fs::remove_dir_all(&scratch).await {
            tracing::warn!(
                error = %rm_err,
                scratch = %scratch.display(),
                "scaffold rollback cleanup failed",
            );
        }
        return Err(e);
    }
    if let Err(e) = tokio::fs::rename(&scratch, &meta).await {
        if let Err(rm_err) = tokio::fs::remove_dir_all(&scratch).await {
            tracing::warn!(
                error = %rm_err,
                scratch = %scratch.display(),
                "scaffold rename rollback failed",
            );
        }
        return Err(e.into());
    }

    Ok(WorkspaceLayout {
        root: to_nfc(&root),
        meta_dir: to_nfc(&meta),
        settings: to_nfc(meta.join(SETTINGS_FILE)),
        index_db: to_nfc(meta.join(INDEX_FILE)),
        snapshots: to_nfc(meta.join(SNAPSHOTS_DIR)),
        already_existed: false,
        settings_schema_version: Some(SETTINGS_SCHEMA_VERSION),
        current_schema_version: SETTINGS_SCHEMA_VERSION,
        index_db_corrupt: false,
        read_only: false,
    })
}

#[derive(Debug, Serialize)]
pub struct WorkspaceInspection {
    pub root: String,
    pub already_existed: bool,
    pub settings_schema_version: Option<u32>,
    pub current_schema_version: u32,
    pub index_db_corrupt: bool,
    pub read_only: bool,
}

#[tauri::command]
pub async fn workspace_inspect(workspace: String) -> AppResult<WorkspaceInspection> {
    let root = PathBuf::from(&workspace)
        .canonicalize()
        .map_err(|e| AppError::Invalid(format!("workspace canonicalize: {e}")))?;
    if !root.is_dir() {
        return Err(AppError::Invalid(format!(
            "not a directory: {}",
            root.display()
        )));
    }
    let meta = root.join(META_DIR);
    let read_only = detect_read_only(&root).await;
    if !meta.exists() {
        return Ok(WorkspaceInspection {
            root: to_nfc(&root),
            already_existed: false,
            settings_schema_version: None,
            current_schema_version: SETTINGS_SCHEMA_VERSION,
            index_db_corrupt: false,
            read_only,
        });
    }
    let settings_schema_version = read_settings_schema(&meta.join(SETTINGS_FILE)).await;
    let index_db_corrupt = !is_index_db_intact(&meta.join(INDEX_FILE)).await;
    Ok(WorkspaceInspection {
        root: to_nfc(&root),
        already_existed: true,
        settings_schema_version,
        current_schema_version: SETTINGS_SCHEMA_VERSION,
        index_db_corrupt,
        read_only,
    })
}

async fn read_settings_schema(path: &Path) -> Option<u32> {
    let bytes = tokio::fs::read(path).await.ok()?;
    let value: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
    value
        .get("schemaVersion")
        .and_then(|v| v.as_u64())
        .map(|n| n as u32)
}

/// S-WS-021: try parsing settings.json. Returns:
///   - `Ok(true)`  → file is valid JSON
///   - `Ok(false)` → file does not exist (caller treats as fresh)
///   - `Err`       → file exists but is unparseable (caller surfaces dialog)
async fn settings_parse_status(path: &Path) -> AppResult<bool> {
    match tokio::fs::read(path).await {
        Ok(bytes) => serde_json::from_slice::<serde_json::Value>(&bytes)
            .map(|_| true)
            .map_err(|e| AppError::Invalid(format!("settings.json corrupt: {e}"))),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(e) => Err(e.into()),
    }
}

/// Move a corrupt settings.json sideways and write fresh defaults. The
/// quarantine path is what the front-end reports back to the user so they
/// can hand-edit and restore later.
#[tauri::command]
pub async fn workspace_settings_recover(workspace: String) -> AppResult<String> {
    let root = PathBuf::from(&workspace)
        .canonicalize()
        .map_err(|e| AppError::Invalid(format!("workspace canonicalize: {e}")))?;
    let meta = root.join(META_DIR);
    let settings = meta.join(SETTINGS_FILE);
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let quarantine = meta.join(format!("settings.json.broken-{now_ms}"));
    if settings.exists() {
        tokio::fs::rename(&settings, &quarantine).await?;
    }
    let bytes = serde_json::to_vec_pretty(&default_settings())
        .map_err(|e| AppError::Invalid(format!("settings serialize: {e}")))?;
    tokio::fs::write(&settings, bytes).await?;
    Ok(to_nfc(&quarantine))
}

#[tauri::command]
pub async fn workspace_settings_check(workspace: String) -> AppResult<bool> {
    let root = PathBuf::from(&workspace)
        .canonicalize()
        .map_err(|e| AppError::Invalid(format!("workspace canonicalize: {e}")))?;
    let settings = root.join(META_DIR).join(SETTINGS_FILE);
    settings_parse_status(&settings).await
}

async fn is_index_db_intact(path: &Path) -> bool {
    // Treat a missing or empty file as "fresh" (caller can rebuild). A
    // non-empty file that doesn't pass `PRAGMA integrity_check` is the
    // actual corruption case we want to surface for S-WS-022.
    let meta = match tokio::fs::metadata(path).await {
        Ok(m) => m,
        Err(_) => return true,
    };
    if meta.len() == 0 {
        return true;
    }
    let path = path.to_path_buf();
    tokio::task::spawn_blocking(move || -> bool {
        let conn = match rusqlite::Connection::open(&path) {
            Ok(c) => c,
            Err(_) => return false,
        };
        // pragma_query_value returns the first row; SQLite emits "ok" when
        // the database is healthy, anything else means we should rebuild.
        match conn.pragma_query_value(None, "integrity_check", |row| row.get::<_, String>(0)) {
            Ok(v) => v.eq_ignore_ascii_case("ok"),
            Err(_) => false,
        }
    })
    .await
    .unwrap_or(false)
}

/// S-WS-022: move a corrupt index.db sideways so the search module can
/// rebuild from scratch. Returns the quarantine path.
#[tauri::command]
pub async fn workspace_index_quarantine(workspace: String) -> AppResult<String> {
    let root = PathBuf::from(&workspace)
        .canonicalize()
        .map_err(|e| AppError::Invalid(format!("workspace canonicalize: {e}")))?;
    let meta = root.join(META_DIR);
    let index = meta.join(INDEX_FILE);
    if !index.exists() {
        return Ok(String::new());
    }
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let quarantine = meta.join(format!("index.db.broken-{now_ms}"));
    tokio::fs::rename(&index, &quarantine).await?;
    // Re-create empty placeholder so the next scaffold sees a fresh slate.
    tokio::fs::write(&index, b"").await?;
    Ok(to_nfc(&quarantine))
}

async fn scaffold_into(scratch: &Path) -> AppResult<()> {
    tokio::fs::create_dir_all(scratch).await?;
    tokio::fs::create_dir_all(scratch.join(SNAPSHOTS_DIR)).await?;
    let settings = serde_json::to_vec_pretty(&default_settings())
        .map_err(|e| AppError::Invalid(format!("settings serialize: {e}")))?;
    tokio::fs::write(scratch.join(SETTINGS_FILE), settings).await?;
    let recent = serde_json::to_vec_pretty(&default_recent())
        .map_err(|e| AppError::Invalid(format!("recent serialize: {e}")))?;
    tokio::fs::write(scratch.join(RECENT_FILE), recent).await?;
    // index.db is a placeholder — the search module owns its actual schema.
    tokio::fs::write(scratch.join(INDEX_FILE), b"").await?;
    // S-SBC-004: layout.json is created empty (schema-only). Layout values
    // are written lazily on first user-driven change so a never-toggled
    // workspace doesn't sprout disk writes for default state.
    let layout = serde_json::to_vec_pretty(&serde_json::json!({
        "schemaVersion": LAYOUT_SCHEMA_VERSION,
    }))
    .map_err(|e| AppError::Invalid(format!("layout serialize: {e}")))?;
    tokio::fs::write(scratch.join(LAYOUT_FILE), layout).await?;
    Ok(())
}

/// S-SBC-004: per-workspace layout state. The renderer pushes the in-memory
/// layout store here so a reopened workspace restores its sidebar visibility
/// / width / collapsed mode. Schema-versioned for forward compatibility —
/// unknown fields are ignored on load, missing fields fall back to defaults
/// on the renderer side (`useLayout` getters).
#[tauri::command]
pub async fn workspace_layout_load(workspace: String) -> AppResult<serde_json::Value> {
    let root = PathBuf::from(&workspace)
        .canonicalize()
        .map_err(|e| AppError::Invalid(format!("workspace canonicalize: {e}")))?;
    let path = root.join(META_DIR).join(LAYOUT_FILE);
    match tokio::fs::read(&path).await {
        Ok(bytes) => serde_json::from_slice::<serde_json::Value>(&bytes)
            .map_err(|e| AppError::Invalid(format!("layout.json parse: {e}"))),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            // Missing file → treat as "use defaults". Returning an empty
            // object lets the caller's optional-field reads short-circuit to
            // their defaults without a special error path.
            Ok(serde_json::json!({ "schemaVersion": LAYOUT_SCHEMA_VERSION }))
        }
        Err(e) => Err(e.into()),
    }
}

#[tauri::command]
pub async fn workspace_layout_save(workspace: String, payload: serde_json::Value) -> AppResult<()> {
    let root = PathBuf::from(&workspace)
        .canonicalize()
        .map_err(|e| AppError::Invalid(format!("workspace canonicalize: {e}")))?;
    let meta = root.join(META_DIR);
    // Best-effort dir creation so a workspace opened before this command
    // shipped (no `.markspread/layout.json` placeholder yet) still gets a
    // valid write path on first save.
    tokio::fs::create_dir_all(&meta).await?;
    let mut value = payload;
    if !value.is_object() {
        return Err(AppError::Invalid("layout payload not an object".into()));
    }
    if let Some(obj) = value.as_object_mut() {
        obj.insert(
            "schemaVersion".into(),
            serde_json::json!(LAYOUT_SCHEMA_VERSION),
        );
    }
    let bytes = serde_json::to_vec_pretty(&value)
        .map_err(|e| AppError::Invalid(format!("layout serialize: {e}")))?;
    let path = meta.join(LAYOUT_FILE);
    tokio::fs::write(&path, bytes).await?;
    Ok(())
}
