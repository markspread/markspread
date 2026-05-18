// S-ER-008 / S-ER-013: crash recovery + crash record sink.
//
// Two on-disk artefacts, both under the app data dir:
//
//   • `logs/crash.log`        — append-only JSON-lines sink. Every
//     React error-boundary catch lands one line here so a support
//     bundle (ops_export_diagnostics) can surface recent crashes.
//   • `state/last-session.json` — the "session beacon": the set of
//     dirty buffers at the last refresh tick. Written every few
//     seconds while the app runs, cleared on clean exit. If it
//     survives into the next launch the previous session crashed,
//     and we offer to recover unsaved edits.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

use crate::error::{AppError, AppResult};

fn data_dir() -> AppResult<PathBuf> {
    dirs::data_local_dir()
        .map(|p| p.join("markspread"))
        .ok_or_else(|| AppError::Invalid("could not resolve OS data dir".into()))
}

fn beacon_path() -> AppResult<PathBuf> {
    Ok(data_dir()?.join("state").join("last-session.json"))
}

fn sha256_hex(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    let mut h = Sha256::new();
    h.update(bytes);
    hex::encode(h.finalize())
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CrashRecord {
    pub boundary_id: String,
    pub message: String,
    pub stack: Option<String>,
    pub component_stack: Option<String>,
    pub ts: i64,
}

/// S-ER-013: append one crash line. We never fail the caller — a crash
/// report that itself errors is worse than useless — so I/O problems
/// are logged and swallowed.
#[tauri::command]
pub async fn error_record_crash(
    boundary_id: String,
    message: String,
    stack: Option<String>,
    component_stack: Option<String>,
    ts: i64,
) -> AppResult<()> {
    let record = CrashRecord {
        boundary_id,
        message,
        stack,
        component_stack,
        ts,
    };
    let dir = match data_dir() {
        Ok(d) => d.join("logs"),
        Err(e) => {
            tracing::warn!(error = %e, "crash record: no data dir");
            return Ok(());
        }
    };
    if let Err(e) = std::fs::create_dir_all(&dir) {
        tracing::warn!(error = %e, "crash record: mkdir failed");
        return Ok(());
    }
    let line = match serde_json::to_string(&record) {
        Ok(s) => s,
        Err(e) => {
            tracing::warn!(error = %e, "crash record: serialise failed");
            return Ok(());
        }
    };
    use std::io::Write;
    match std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(dir.join("crash.log"))
    {
        Ok(mut f) => {
            if let Err(e) = writeln!(f, "{line}") {
                tracing::warn!(error = %e, "crash record: write failed");
            }
        }
        Err(e) => tracing::warn!(error = %e, "crash record: open failed"),
    }
    Ok(())
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionBuffer {
    pub key: String,
    pub dirty: bool,
    pub sha256: String,
    pub bytes: i64,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionBeacon {
    pub id: String,
    pub buffers: Vec<SessionBuffer>,
    pub ts: i64,
}

/// S-ER-008: persist the beacon atomically (temp + rename) so a crash
/// mid-write can't leave a truncated file that the next launch fails
/// to parse — a corrupt beacon would silently lose the recovery offer.
#[tauri::command]
pub async fn error_session_beacon_write(beacon: SessionBeacon) -> AppResult<()> {
    let path = beacon_path()?;
    let parent = path
        .parent()
        .ok_or_else(|| AppError::Invalid("beacon path has no parent".into()))?;
    std::fs::create_dir_all(parent).map_err(AppError::Io)?;
    let bytes = serde_json::to_vec_pretty(&beacon)
        .map_err(|e| AppError::Invalid(format!("serialise beacon: {e}")))?;
    let tmp = parent.join(".last-session.json.tmp");
    std::fs::write(&tmp, &bytes).map_err(AppError::Io)?;
    std::fs::rename(&tmp, &path).map_err(AppError::Io)?;
    Ok(())
}

/// S-ER-008: read the beacon. Returns `None` on a clean prior exit
/// (no file) or an unparseable file — in both cases the front-end
/// just shows no recovery prompt.
#[tauri::command]
pub async fn error_session_beacon_read() -> AppResult<Option<SessionBeacon>> {
    let path = beacon_path()?;
    match std::fs::read_to_string(&path) {
        Ok(raw) => Ok(serde_json::from_str(&raw).ok()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(AppError::Io(e)),
    }
}

/// S-ER-008: clear the beacon on clean exit. A missing file is success.
#[tauri::command]
pub async fn error_session_beacon_clear() -> AppResult<()> {
    let path = beacon_path()?;
    match std::fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(AppError::Io(e)),
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryCandidate {
    pub key: String,
    pub bytes: i64,
    pub disk_body: Option<String>,
    pub recovered_body: Option<String>,
}

/// S-ER-008: derive recovery candidates from the beacon. For each dirty
/// buffer we read the on-disk file (when `key` is a real path); if its
/// content hashes to the same sha256 the buffer recorded, the dirty
/// flag was a false alarm and the entry is dropped. Anything left is a
/// genuine unsaved edit worth offering back to the user.
#[tauri::command]
pub async fn error_recovery_list() -> AppResult<Vec<RecoveryCandidate>> {
    let beacon = match error_session_beacon_read().await? {
        Some(b) => b,
        None => return Ok(Vec::new()),
    };
    let autosave_dir = data_dir()?.join("autosave");
    let mut out = Vec::new();
    for buf in beacon.buffers {
        if !buf.dirty {
            continue;
        }
        let disk_body = std::fs::read_to_string(&buf.key).ok();
        if let Some(body) = &disk_body {
            if sha256_hex(body.as_bytes()) == buf.sha256 {
                // On-disk content already matches the buffer hash — the
                // edit was saved before the crash. Not a candidate.
                continue;
            }
        }
        // Autosave snapshots are keyed by the buffer sha256 the beacon
        // recorded, so a recovered body can be matched back exactly.
        let recovered_body = std::fs::read_to_string(autosave_dir.join(&buf.sha256)).ok();
        out.push(RecoveryCandidate {
            key: buf.key,
            bytes: buf.bytes,
            disk_body,
            recovered_body,
        });
    }
    Ok(out)
}
