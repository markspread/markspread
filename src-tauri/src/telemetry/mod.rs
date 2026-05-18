// S-FAP-009: local-only access-decision telemetry.
//
// Counts every `AccessDecision` denial keyed by (date UTC, category, rule_id).
// Storage is a private SQLite file under `data_dir()/access_telemetry.db`, no
// external transmission. Recording is gated by a single opt-in flag in
// `settings.json` (`telemetryAccessEnabled`, default `false`) so the counter
// stays at zero for users who have not explicitly enabled it.
//
// The frontend reaches the counter through three IPC commands:
//   * `telemetry_access_get`     — { enabled }
//   * `telemetry_access_set`     — { enabled }
//   * `telemetry_access_query`   — Vec<{ date, category, rule_id, count }>
//   * `telemetry_access_clear`   — wipe the counter (without disabling)
//
// The body of the counter is `fn record(decision: &AccessDecision)` which the
// access-policy bridge in `fs_cmd::{validate_input_path, ensure_within}`
// invokes synchronously on every deny.

use crate::access_policy::AccessDecision;
use crate::error::{AppError, AppResult};
use chrono::{Duration as ChronoDuration, Utc};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;

fn data_dir() -> AppResult<PathBuf> {
    // Mirror `ops::data_dir()` — we can't `use` it directly because that
    // module's helper is private. The path layout is part of the public
    // contract (ops_erase_all wipes the entire dir, which includes our db)
    // so the duplication is intentional rather than refactoring `ops`.
    dirs::data_local_dir()
        .map(|p| p.join("markspread"))
        .ok_or_else(|| AppError::Invalid("could not resolve OS data dir".into()))
}

fn db_path() -> AppResult<PathBuf> {
    let mut p = data_dir()?;
    p.push("access_telemetry.db");
    Ok(p)
}

fn settings_path() -> AppResult<PathBuf> {
    let mut p = data_dir()?;
    p.push("settings.json");
    Ok(p)
}

fn open_conn() -> AppResult<Connection> {
    let path = db_path()?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(AppError::Io)?;
    }
    let conn =
        Connection::open(&path).map_err(|e| AppError::Invalid(format!("telemetry open: {e}")))?;
    conn.pragma_update(None, "journal_mode", "WAL")
        .map_err(|e| AppError::Invalid(format!("telemetry WAL: {e}")))?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS access_decision_counter (
            date     TEXT NOT NULL,
            category TEXT NOT NULL,
            rule_id  TEXT NOT NULL,
            count    INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (date, category, rule_id)
         );",
    )
    .map_err(|e| AppError::Invalid(format!("telemetry schema: {e}")))?;
    Ok(conn)
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TelemetrySettings {
    pub enabled: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccessStatRow {
    pub date: String,
    pub category: String,
    pub rule_id: String,
    pub count: i64,
}

fn read_enabled() -> bool {
    let Ok(path) = settings_path() else {
        return false;
    };
    let Ok(raw) = std::fs::read_to_string(&path) else {
        return false;
    };
    let Ok(v) = serde_json::from_str::<serde_json::Value>(&raw) else {
        return false;
    };
    v.get("telemetryAccessEnabled")
        .and_then(|x| x.as_bool())
        .unwrap_or(false)
}

fn write_enabled(enabled: bool) -> AppResult<()> {
    let path = settings_path()?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(AppError::Io)?;
    }
    let mut v: serde_json::Value = match std::fs::read_to_string(&path) {
        Ok(raw) => serde_json::from_str(&raw)
            .map_err(|e| AppError::Invalid(format!("settings parse: {e}")))?,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => serde_json::json!({}),
        Err(e) => return Err(AppError::Io(e)),
    };
    if !v.is_object() {
        return Err(AppError::Invalid(
            "settings.json root is not an object".into(),
        ));
    }
    v.as_object_mut()
        .unwrap()
        .insert("telemetryAccessEnabled".into(), serde_json::json!(enabled));
    let pretty = serde_json::to_string_pretty(&v)
        .map_err(|e| AppError::Invalid(format!("settings serialize: {e}")))?;
    std::fs::write(&path, pretty).map_err(AppError::Io)?;
    Ok(())
}

/// In-process recording guard. We synchronise around the SQLite connection so
/// a flood of deny decisions does not open multiple WAL writers at once.
/// `Mutex<Option<...>>` lets us lazy-open on first use and degrade silently
/// when the data dir is unavailable (e.g., portable mode without disk).
static RECORDER: Mutex<Option<Connection>> = Mutex::new(None);

/// Synchronous deny recorder. Called from the SEC/BND/PRM/POL/PRF/FMT/IO
/// engine bridge. Returns silently on any failure — telemetry is best-effort
/// and must never block or fail the original fs operation.
pub fn record(decision: &AccessDecision) {
    if !read_enabled() {
        return;
    }
    let mut guard = match RECORDER.lock() {
        Ok(g) => g,
        Err(_) => return,
    };
    if guard.is_none() {
        match open_conn() {
            Ok(c) => *guard = Some(c),
            Err(err) => {
                tracing::warn!(error = %err, "telemetry open failed; recording disabled for this session");
                return;
            }
        }
    }
    let Some(conn) = guard.as_ref() else {
        return;
    };
    let today = Utc::now().format("%Y-%m-%d").to_string();
    let category = decision.category.as_str();
    let rule_id = decision.rule_id.as_wire_str();
    let _ = conn.execute(
        "INSERT INTO access_decision_counter (date, category, rule_id, count)
         VALUES (?1, ?2, ?3, 1)
         ON CONFLICT(date, category, rule_id) DO UPDATE SET count = count + 1",
        params![today, category, rule_id],
    );
}

/// Drop the in-process recorder so a subsequent `record` reopens the
/// connection. Used by `telemetry_access_clear` after a TRUNCATE.
fn drop_recorder() {
    if let Ok(mut g) = RECORDER.lock() {
        *g = None;
    }
}

#[tauri::command]
pub async fn telemetry_access_get() -> AppResult<TelemetrySettings> {
    Ok(TelemetrySettings {
        enabled: read_enabled(),
    })
}

#[tauri::command]
pub async fn telemetry_access_set(enabled: bool) -> AppResult<()> {
    write_enabled(enabled)?;
    if !enabled {
        // Don't surprise the user — disabling stops new writes but leaves
        // previously-collected counts intact. They can call `_clear` to wipe.
        drop_recorder();
    }
    Ok(())
}

#[tauri::command]
pub async fn telemetry_access_query(days: Option<u32>) -> AppResult<Vec<AccessStatRow>> {
    let days = days.unwrap_or(30).clamp(1, 365) as i64;
    let cutoff = (Utc::now() - ChronoDuration::days(days))
        .format("%Y-%m-%d")
        .to_string();
    let conn = open_conn()?;
    let mut stmt = conn
        .prepare(
            "SELECT date, category, rule_id, count
             FROM access_decision_counter
             WHERE date >= ?1
             ORDER BY date DESC, count DESC",
        )
        .map_err(|e| AppError::Invalid(format!("telemetry prepare: {e}")))?;
    let rows = stmt
        .query_map(params![cutoff], |row| {
            Ok(AccessStatRow {
                date: row.get(0)?,
                category: row.get(1)?,
                rule_id: row.get(2)?,
                count: row.get(3)?,
            })
        })
        .map_err(|e| AppError::Invalid(format!("telemetry query: {e}")))?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| AppError::Invalid(format!("telemetry row: {e}")))?);
    }
    Ok(out)
}

#[tauri::command]
pub async fn telemetry_access_clear() -> AppResult<()> {
    let conn = open_conn()?;
    conn.execute("DELETE FROM access_decision_counter", [])
        .map_err(|e| AppError::Invalid(format!("telemetry clear: {e}")))?;
    drop_recorder();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::access_policy::{AccessDecision, RuleId};

    #[test]
    fn record_when_disabled_is_noop() {
        // Without the opt-in flag, record() returns instantly and never
        // opens a connection. Verified indirectly: calling it twice with
        // the env's `telemetryAccessEnabled` unset must not panic.
        let d = AccessDecision::deny(RuleId::PolNodeModules);
        record(&d);
        record(&d);
    }

    #[test]
    fn stat_row_serializes_to_camel_case() {
        let row = AccessStatRow {
            date: "2026-05-13".into(),
            category: "SEC".into(),
            rule_id: "SEC-NULL-BYTE".into(),
            count: 7,
        };
        let json = serde_json::to_string(&row).unwrap();
        assert!(json.contains("\"ruleId\":\"SEC-NULL-BYTE\""));
        assert!(json.contains("\"count\":7"));
    }
}
