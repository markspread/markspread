// S-AIK-005..020 / S-AI-029..030 / S-AIC-001..012: AI key registry,
// action history, and usage accounting backend.
//
// Three concerns share one SQLite file (`ai.db`) under the app data dir:
//
//   • key registry  — alias-keyed metadata. The *plaintext key* never
//     lands in SQLite; it lives in the OS keychain under
//     `com.markspread.app` / `ai-keys/byo/<alias>`. `ai_key_resolve`
//     is the single seam that returns plaintext to the renderer, and
//     only for the duration of one provider request (S-AIK-020).
//   • action history — one row per completed AI run (S-AI-029).
//   • usage accounting — one row per completed action (S-AIC-001),
//     with a `purged` archive table for accidental-reset recovery.

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::error::{AppError, AppResult};
use crate::ops::KEYCHAIN_SERVICE;

fn data_dir() -> AppResult<PathBuf> {
    dirs::data_local_dir()
        .map(|p| p.join("markspread"))
        .ok_or_else(|| AppError::Invalid("could not resolve OS data dir".into()))
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn open_conn() -> AppResult<Connection> {
    let mut path = data_dir()?;
    std::fs::create_dir_all(&path).map_err(AppError::Io)?;
    path.push("ai.db");
    let conn =
        Connection::open(&path).map_err(|e| AppError::Invalid(format!("ai db open: {e}")))?;
    conn.pragma_update(None, "journal_mode", "WAL")
        .map_err(|e| AppError::Invalid(format!("ai db WAL: {e}")))?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS ai_keys (
            alias       TEXT PRIMARY KEY,
            provider    TEXT NOT NULL,
            model       TEXT NOT NULL,
            base_url    TEXT,
            masked_key  TEXT NOT NULL,
            created_at  INTEGER NOT NULL
         );
         CREATE TABLE IF NOT EXISTS ai_meta (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
         );
         CREATE TABLE IF NOT EXISTS ai_history (
            id            TEXT PRIMARY KEY,
            created_at    INTEGER NOT NULL,
            action_id     TEXT NOT NULL,
            label         TEXT NOT NULL,
            prompt        TEXT NOT NULL,
            model         TEXT NOT NULL,
            response      TEXT NOT NULL,
            input_tokens  INTEGER NOT NULL,
            output_tokens INTEGER NOT NULL,
            usd_cost      REAL NOT NULL,
            duration_ms   INTEGER NOT NULL
         );
         CREATE TABLE IF NOT EXISTS ai_usage (
            id              TEXT PRIMARY KEY,
            ts              INTEGER NOT NULL,
            alias           TEXT NOT NULL,
            provider        TEXT NOT NULL,
            model           TEXT NOT NULL,
            action_id       TEXT NOT NULL,
            input_tokens    INTEGER NOT NULL,
            output_tokens   INTEGER NOT NULL,
            usd             REAL NOT NULL,
            pricing_version TEXT NOT NULL,
            status          TEXT NOT NULL
         );
         CREATE TABLE IF NOT EXISTS ai_usage_purged (
            id              TEXT PRIMARY KEY,
            ts              INTEGER NOT NULL,
            alias           TEXT NOT NULL,
            provider        TEXT NOT NULL,
            model           TEXT NOT NULL,
            action_id       TEXT NOT NULL,
            input_tokens    INTEGER NOT NULL,
            output_tokens   INTEGER NOT NULL,
            usd             REAL NOT NULL,
            pricing_version TEXT NOT NULL,
            status          TEXT NOT NULL,
            purged_at       INTEGER NOT NULL
         );
         CREATE INDEX IF NOT EXISTS ix_ai_usage_ts ON ai_usage(ts);
         CREATE INDEX IF NOT EXISTS ix_ai_history_created ON ai_history(created_at);",
    )
    .map_err(|e| AppError::Invalid(format!("ai db schema: {e}")))?;
    Ok(conn)
}

/// Aliases are used as keychain item suffixes, so they must not carry
/// path-traversal or separator characters. The renderer enforces a
/// friendlier grammar; this is the defensive re-check.
fn validate_alias(alias: &str) -> AppResult<()> {
    if alias.is_empty() || alias.len() > 64 {
        return Err(AppError::Invalid("alias length out of range".into()));
    }
    for c in alias.chars() {
        let ok = c.is_ascii_alphanumeric() || matches!(c, ' ' | '_' | '.' | '-');
        if !ok {
            return Err(AppError::Invalid(format!(
                "alias contains invalid character: {c:?}"
            )));
        }
    }
    Ok(())
}

fn keychain_item(alias: &str) -> String {
    format!("ai-keys/byo/{alias}")
}

/// Display-only mask. The full key never returns to the renderer except
/// via `ai_key_resolve`.
fn mask_key(key: &str) -> String {
    let chars: Vec<char> = key.chars().collect();
    if chars.len() <= 6 {
        return "•".repeat(chars.len());
    }
    let head: String = chars.iter().take(3).collect();
    let tail: String = chars[chars.len() - 3..].iter().collect();
    format!("{head}…••••{tail}")
}

fn gen_id(prefix: &str) -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("{prefix}-{nanos}")
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiKeyEntry {
    pub alias: String,
    pub provider: String,
    pub model: String,
    pub base_url: Option<String>,
    pub masked_key: String,
    pub created_at: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiKeyList {
    pub entries: Vec<AiKeyEntry>,
    pub default_alias: Option<String>,
}

fn read_default_alias(conn: &Connection) -> AppResult<Option<String>> {
    conn.query_row(
        "SELECT value FROM ai_meta WHERE key = 'defaultAlias'",
        [],
        |r| r.get::<_, String>(0),
    )
    .map(Some)
    .or_else(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => Ok(None),
        other => Err(AppError::Invalid(format!("read default alias: {other}"))),
    })
}

#[tauri::command]
pub async fn ai_key_list() -> AppResult<AiKeyList> {
    let conn = open_conn()?;
    let mut stmt = conn
        .prepare(
            "SELECT alias, provider, model, base_url, masked_key, created_at
             FROM ai_keys ORDER BY alias",
        )
        .map_err(|e| AppError::Invalid(format!("ai_key_list prepare: {e}")))?;
    let rows = stmt
        .query_map([], |r| {
            Ok(AiKeyEntry {
                alias: r.get(0)?,
                provider: r.get(1)?,
                model: r.get(2)?,
                base_url: r.get(3)?,
                masked_key: r.get(4)?,
                created_at: r.get(5)?,
            })
        })
        .map_err(|e| AppError::Invalid(format!("ai_key_list query: {e}")))?;
    let mut entries = Vec::new();
    for row in rows {
        entries.push(row.map_err(|e| AppError::Invalid(format!("ai_key_list row: {e}")))?);
    }
    let default_alias = read_default_alias(&conn)?;
    Ok(AiKeyList {
        entries,
        default_alias,
    })
}

#[tauri::command]
pub async fn ai_key_save(
    alias: String,
    provider: String,
    model: String,
    base_url: Option<String>,
    key: String,
) -> AppResult<AiKeyEntry> {
    validate_alias(&alias)?;
    if key.is_empty() {
        return Err(AppError::Invalid("key must not be empty".into()));
    }
    let masked_key = mask_key(&key);

    // Keychain first: if this fails we do not want a metadata row
    // pointing at a key that was never stored.
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, &keychain_item(&alias))
        .map_err(|e| AppError::Invalid(format!("keychain open: {e}")))?;
    entry
        .set_password(&key)
        .map_err(|e| AppError::Invalid(format!("keychain write: {e}")))?;

    let created_at = now_ms();
    let conn = open_conn()?;
    conn.execute(
        "INSERT INTO ai_keys (alias, provider, model, base_url, masked_key, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(alias) DO UPDATE SET
            provider = excluded.provider,
            model = excluded.model,
            base_url = excluded.base_url,
            masked_key = excluded.masked_key",
        params![alias, provider, model, base_url, masked_key, created_at],
    )
    .map_err(|e| AppError::Invalid(format!("ai_key_save insert: {e}")))?;

    // S-AIK-001: first-key-wins default.
    if read_default_alias(&conn)?.is_none() {
        conn.execute(
            "INSERT INTO ai_meta (key, value) VALUES ('defaultAlias', ?1)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![alias],
        )
        .map_err(|e| AppError::Invalid(format!("ai_key_save default: {e}")))?;
    }

    // Re-read created_at: on overwrite the original timestamp is kept.
    let created_at: i64 = conn
        .query_row(
            "SELECT created_at FROM ai_keys WHERE alias = ?1",
            params![alias],
            |r| r.get(0),
        )
        .unwrap_or(created_at);

    Ok(AiKeyEntry {
        alias,
        provider,
        model,
        base_url,
        masked_key,
        created_at,
    })
}

#[tauri::command]
pub async fn ai_key_remove(alias: String) -> AppResult<()> {
    validate_alias(&alias)?;
    if let Ok(entry) = keyring::Entry::new(KEYCHAIN_SERVICE, &keychain_item(&alias)) {
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => {}
            Err(e) => tracing::warn!(error = %e, "ai_key_remove: keychain delete failed"),
        }
    }
    let conn = open_conn()?;
    conn.execute("DELETE FROM ai_keys WHERE alias = ?1", params![alias])
        .map_err(|e| AppError::Invalid(format!("ai_key_remove: {e}")))?;
    // If the removed alias was the default, fall back to the first
    // remaining alias (or clear the default entirely).
    if read_default_alias(&conn)?.as_deref() == Some(alias.as_str()) {
        let next: Option<String> = conn
            .query_row(
                "SELECT alias FROM ai_keys ORDER BY alias LIMIT 1",
                [],
                |r| r.get(0),
            )
            .ok();
        match next {
            Some(a) => {
                conn.execute(
                    "UPDATE ai_meta SET value = ?1 WHERE key = 'defaultAlias'",
                    params![a],
                )
                .map_err(|e| AppError::Invalid(format!("ai_key_remove default: {e}")))?;
            }
            None => {
                conn.execute("DELETE FROM ai_meta WHERE key = 'defaultAlias'", [])
                    .map_err(|e| AppError::Invalid(format!("ai_key_remove default: {e}")))?;
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn ai_key_set_default(alias: String) -> AppResult<()> {
    validate_alias(&alias)?;
    let conn = open_conn()?;
    let exists: bool = conn
        .query_row(
            "SELECT 1 FROM ai_keys WHERE alias = ?1",
            params![alias],
            |_| Ok(true),
        )
        .unwrap_or(false);
    if !exists {
        return Err(AppError::NotFound(format!("no key with alias {alias}")));
    }
    conn.execute(
        "INSERT INTO ai_meta (key, value) VALUES ('defaultAlias', ?1)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![alias],
    )
    .map_err(|e| AppError::Invalid(format!("ai_key_set_default: {e}")))?;
    Ok(())
}

/// S-AIK-020: the single seam that hands plaintext key material back to
/// the renderer. The runner calls this immediately before a provider
/// request and drops the string as soon as the request returns. This is
/// the BYO-key path; the OAuth subscription token is never resolved this
/// way (ADR-0004).
#[tauri::command]
pub async fn ai_key_resolve(alias: String) -> AppResult<String> {
    validate_alias(&alias)?;
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, &keychain_item(&alias))
        .map_err(|e| AppError::Invalid(format!("keychain open: {e}")))?;
    match entry.get_password() {
        Ok(secret) => Ok(secret),
        Err(keyring::Error::NoEntry) => Err(AppError::NotFound(format!(
            "no stored key for alias {alias}"
        ))),
        Err(e) => Err(AppError::Invalid(format!("keychain read: {e}"))),
    }
}

// ─── Action history (S-AI-029 / S-AI-030) ───────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiHistoryRecord {
    pub id: String,
    pub created_at: i64,
    pub action_id: String,
    pub label: String,
    pub prompt: String,
    pub model: String,
    pub response: String,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub usd_cost: f64,
    pub duration_ms: i64,
}

#[tauri::command]
pub async fn ai_history_record(record: AiHistoryRecord) -> AppResult<()> {
    let conn = open_conn()?;
    conn.execute(
        "INSERT INTO ai_history
            (id, created_at, action_id, label, prompt, model, response,
             input_tokens, output_tokens, usd_cost, duration_ms)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
         ON CONFLICT(id) DO NOTHING",
        params![
            record.id,
            record.created_at,
            record.action_id,
            record.label,
            record.prompt,
            record.model,
            record.response,
            record.input_tokens,
            record.output_tokens,
            record.usd_cost,
            record.duration_ms,
        ],
    )
    .map_err(|e| AppError::Invalid(format!("ai_history_record: {e}")))?;
    Ok(())
}

#[tauri::command]
pub async fn ai_history_list(limit: Option<u32>) -> AppResult<Vec<AiHistoryRecord>> {
    let limit = limit.unwrap_or(100).min(1000);
    let conn = open_conn()?;
    let mut stmt = conn
        .prepare(
            "SELECT id, created_at, action_id, label, prompt, model, response,
                    input_tokens, output_tokens, usd_cost, duration_ms
             FROM ai_history ORDER BY created_at DESC LIMIT ?1",
        )
        .map_err(|e| AppError::Invalid(format!("ai_history_list prepare: {e}")))?;
    let rows = stmt
        .query_map(params![limit], |r| {
            Ok(AiHistoryRecord {
                id: r.get(0)?,
                created_at: r.get(1)?,
                action_id: r.get(2)?,
                label: r.get(3)?,
                prompt: r.get(4)?,
                model: r.get(5)?,
                response: r.get(6)?,
                input_tokens: r.get(7)?,
                output_tokens: r.get(8)?,
                usd_cost: r.get(9)?,
                duration_ms: r.get(10)?,
            })
        })
        .map_err(|e| AppError::Invalid(format!("ai_history_list query: {e}")))?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| AppError::Invalid(format!("ai_history_list row: {e}")))?);
    }
    Ok(out)
}

// ─── Usage accounting (S-AIC-001..012) ──────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageRowInput {
    pub ts: i64,
    pub alias: String,
    pub provider: String,
    pub model: String,
    pub action_id: String,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub usd: f64,
    pub pricing_version: String,
    pub status: String,
}

#[tauri::command]
pub async fn ai_usage_record(row: UsageRowInput) -> AppResult<()> {
    let conn = open_conn()?;
    conn.execute(
        "INSERT INTO ai_usage
            (id, ts, alias, provider, model, action_id, input_tokens,
             output_tokens, usd, pricing_version, status)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        params![
            gen_id("usage"),
            row.ts,
            row.alias,
            row.provider,
            row.model,
            row.action_id,
            row.input_tokens,
            row.output_tokens,
            row.usd,
            row.pricing_version,
            row.status,
        ],
    )
    .map_err(|e| AppError::Invalid(format!("ai_usage_record: {e}")))?;
    Ok(())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyBucket {
    pub day_start: i64,
    pub usd: f64,
    pub input: i64,
    pub output: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelBucket {
    pub provider: String,
    pub model: String,
    pub usd: f64,
    pub calls: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionBucket {
    pub action_id: String,
    pub usd: f64,
    pub calls: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsagePeriod {
    pub start_ts: i64,
    pub end_ts: i64,
    pub total_usd: f64,
    pub total_input_tokens: i64,
    pub total_output_tokens: i64,
    pub daily_buckets: Vec<DailyBucket>,
    pub by_model: Vec<ModelBucket>,
    pub by_action: Vec<ActionBucket>,
}

#[tauri::command]
pub async fn ai_usage_query(start_ts: i64, end_ts: i64) -> AppResult<UsagePeriod> {
    let conn = open_conn()?;

    let (total_usd, total_input, total_output): (f64, i64, i64) = conn
        .query_row(
            "SELECT COALESCE(SUM(usd),0), COALESCE(SUM(input_tokens),0),
                    COALESCE(SUM(output_tokens),0)
             FROM ai_usage WHERE ts >= ?1 AND ts < ?2",
            params![start_ts, end_ts],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .map_err(|e| AppError::Invalid(format!("ai_usage_query totals: {e}")))?;

    // Day buckets: 86_400_000 ms per UTC day. The renderer re-labels in
    // local time; the bucket key is just a stable floor.
    const DAY_MS: i64 = 86_400_000;
    let mut daily_stmt = conn
        .prepare(
            "SELECT (ts / ?3) * ?3 AS day, COALESCE(SUM(usd),0),
                    COALESCE(SUM(input_tokens),0), COALESCE(SUM(output_tokens),0)
             FROM ai_usage WHERE ts >= ?1 AND ts < ?2
             GROUP BY day ORDER BY day",
        )
        .map_err(|e| AppError::Invalid(format!("ai_usage_query daily prepare: {e}")))?;
    let daily_buckets = daily_stmt
        .query_map(params![start_ts, end_ts, DAY_MS], |r| {
            Ok(DailyBucket {
                day_start: r.get(0)?,
                usd: r.get(1)?,
                input: r.get(2)?,
                output: r.get(3)?,
            })
        })
        .map_err(|e| AppError::Invalid(format!("ai_usage_query daily: {e}")))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| AppError::Invalid(format!("ai_usage_query daily row: {e}")))?;

    let mut model_stmt = conn
        .prepare(
            "SELECT provider, model, COALESCE(SUM(usd),0), COUNT(*)
             FROM ai_usage WHERE ts >= ?1 AND ts < ?2
             GROUP BY provider, model ORDER BY 3 DESC",
        )
        .map_err(|e| AppError::Invalid(format!("ai_usage_query model prepare: {e}")))?;
    let by_model = model_stmt
        .query_map(params![start_ts, end_ts], |r| {
            Ok(ModelBucket {
                provider: r.get(0)?,
                model: r.get(1)?,
                usd: r.get(2)?,
                calls: r.get(3)?,
            })
        })
        .map_err(|e| AppError::Invalid(format!("ai_usage_query model: {e}")))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| AppError::Invalid(format!("ai_usage_query model row: {e}")))?;

    let mut action_stmt = conn
        .prepare(
            "SELECT action_id, COALESCE(SUM(usd),0), COUNT(*)
             FROM ai_usage WHERE ts >= ?1 AND ts < ?2
             GROUP BY action_id ORDER BY 2 DESC",
        )
        .map_err(|e| AppError::Invalid(format!("ai_usage_query action prepare: {e}")))?;
    let by_action = action_stmt
        .query_map(params![start_ts, end_ts], |r| {
            Ok(ActionBucket {
                action_id: r.get(0)?,
                usd: r.get(1)?,
                calls: r.get(2)?,
            })
        })
        .map_err(|e| AppError::Invalid(format!("ai_usage_query action: {e}")))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| AppError::Invalid(format!("ai_usage_query action row: {e}")))?;

    Ok(UsagePeriod {
        start_ts,
        end_ts,
        total_usd,
        total_input_tokens: total_input,
        total_output_tokens: total_output,
        daily_buckets,
        by_model,
        by_action,
    })
}

/// S-AIC-012: move every usage row into the `purged` archive table
/// (kept ~30 days for accidental-reset recovery) and clear the live
/// table. The confirmation dialog lives at the renderer call site.
#[tauri::command]
pub async fn ai_usage_reset() -> AppResult<()> {
    let conn = open_conn()?;
    let purged_at = now_ms();
    conn.execute(
        "INSERT INTO ai_usage_purged
            (id, ts, alias, provider, model, action_id, input_tokens,
             output_tokens, usd, pricing_version, status, purged_at)
         SELECT id, ts, alias, provider, model, action_id, input_tokens,
                output_tokens, usd, pricing_version, status, ?1
         FROM ai_usage",
        params![purged_at],
    )
    .map_err(|e| AppError::Invalid(format!("ai_usage_reset archive: {e}")))?;
    conn.execute("DELETE FROM ai_usage", [])
        .map_err(|e| AppError::Invalid(format!("ai_usage_reset clear: {e}")))?;
    // Drop archive rows older than 30 days so the table doesn't grow
    // without bound across repeated resets.
    let cutoff = purged_at - 30 * 86_400_000;
    conn.execute(
        "DELETE FROM ai_usage_purged WHERE purged_at < ?1",
        params![cutoff],
    )
    .map_err(|e| AppError::Invalid(format!("ai_usage_reset prune: {e}")))?;
    Ok(())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeychainProbe {
    pub status: String,
    pub hint: Option<String>,
}

/// S-AIK-016/017: probe OS keychain availability. The Settings → AI panel
/// runs this once on mount to decide which banner (if any) to show. We
/// open a throwaway probe item and read it; `NoEntry` means the keychain
/// works and is simply empty, which is the healthy case.
#[tauri::command]
pub async fn ai_keychain_probe() -> AppResult<KeychainProbe> {
    let probe = |status: &str, hint: Option<String>| KeychainProbe {
        status: status.to_string(),
        hint,
    };
    let entry = match keyring::Entry::new(KEYCHAIN_SERVICE, "keychain-probe") {
        Ok(e) => e,
        Err(e) => {
            return Ok(probe("missing", Some(e.to_string())));
        }
    };
    match entry.get_password() {
        Ok(_) | Err(keyring::Error::NoEntry) => Ok(probe("available", None)),
        Err(keyring::Error::NoStorageAccess(e)) => Ok(probe("denied", Some(e.to_string()))),
        Err(keyring::Error::PlatformFailure(e)) => Ok(probe("missing", Some(e.to_string()))),
        Err(e) => Ok(probe("missing", Some(e.to_string()))),
    }
}

// ─── Connection test (S-AIK-006..008 / SC-LLM-06) ───────────────────────
//
// `ai_key_test` performs the cheapest request each provider accepts
// (model-list GET) so the Settings → AI "Test" button gets a fast yes/no
// before the key is saved. Classification contract with
// `lib/ai/key-test.ts`:
//
//   • Ok { status, ok, … }         — the provider answered; the renderer
//     folds 401/403 into "auth" and other non-2xx into "other".
//   • Err("network: …")            — DNS/timeout/connection refused. The
//     error type is `String` (not `AppError`) on purpose: the renderer
//     matches on the literal `network:` prefix of the rejection message,
//     and `AppError::Invalid`'s Display would prepend "invalid input: ".
//
// The plaintext key arrives as an argument (pre-save test — it may not
// be in the keychain yet) and lives only on this call's stack.

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiKeyTestResult {
    pub status: u16,
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model_id: Option<String>,
    pub message: String,
}

struct KeyTestPlan {
    url: String,
    headers: Vec<(&'static str, String)>,
    /// Query params appended by reqwest (Google passes the key here).
    query: Vec<(&'static str, String)>,
}

/// Route the test request per provider. Base URLs mirror the frontend
/// catalog in `lib/ai/providers.ts`; `base_url` (when set) overrides.
fn key_test_plan(provider: &str, base_url: Option<&str>, key: &str) -> Result<KeyTestPlan, String> {
    fn base(base_url: Option<&str>, default: &str) -> String {
        base_url
            .unwrap_or(default)
            .trim_end_matches('/')
            .to_string()
    }
    match provider {
        "anthropic" => Ok(KeyTestPlan {
            url: format!("{}/v1/models", base(base_url, "https://api.anthropic.com")),
            headers: vec![
                ("x-api-key", key.to_string()),
                ("anthropic-version", "2023-06-01".to_string()),
            ],
            query: vec![],
        }),
        "google" => Ok(KeyTestPlan {
            url: format!(
                "{}/models",
                base(base_url, "https://generativelanguage.googleapis.com/v1beta")
            ),
            headers: vec![],
            query: vec![("key", key.to_string())],
        }),
        // Local, key-less: hitting /api/tags checks reachability only.
        "ollama" => Ok(KeyTestPlan {
            url: format!("{}/api/tags", base(base_url, "http://127.0.0.1:11434")),
            headers: vec![],
            query: vec![],
        }),
        "openai" | "xai" | "deepseek" | "mistral" | "openai-compatible" => {
            let default = match provider {
                "openai" => Some("https://api.openai.com/v1"),
                "xai" => Some("https://api.x.ai/v1"),
                "deepseek" => Some("https://api.deepseek.com/v1"),
                "mistral" => Some("https://api.mistral.ai/v1"),
                // openai-compatible has no default endpoint by definition.
                _ => None,
            };
            let resolved = match (base_url, default) {
                (Some(b), _) => b.trim_end_matches('/').to_string(),
                (None, Some(d)) => d.to_string(),
                (None, None) => {
                    return Err(format!("provider {provider} requires a base URL"));
                }
            };
            Ok(KeyTestPlan {
                url: format!("{resolved}/models"),
                headers: vec![("authorization", format!("Bearer {key}"))],
                query: vec![],
            })
        }
        other => Err(format!("unknown provider: {other}")),
    }
}

#[tauri::command]
pub async fn ai_key_test(
    provider: String,
    model: String,
    base_url: Option<String>,
    key: String,
    abort_cookie: Option<String>,
) -> Result<AiKeyTestResult, String> {
    // The renderer registers an abort cookie for ESC-cancel; the request
    // below is bounded by a 15s timeout, which caps how long a cancelled
    // test can linger. Cookie-polling cancellation is not implemented.
    let _ = abort_cookie;
    let plan = key_test_plan(&provider, base_url.as_deref(), &key)?;
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| format!("network: http client init failed: {e}"))?;
    let mut req = client.get(&plan.url);
    for (k, v) in &plan.headers {
        req = req.header(*k, v);
    }
    if !plan.query.is_empty() {
        req = req.query(&plan.query);
    }
    // Connection refused / DNS failure / timeout all land here — the
    // `network:` prefix is what key-test.ts keys its classification on.
    let resp = req.send().await.map_err(|e| format!("network: {e}"))?;
    let status = resp.status().as_u16();
    let ok = resp.status().is_success();
    let message = if ok {
        String::new()
    } else {
        // Truncated body so a chatty 4xx/5xx doesn't flood the IPC pipe.
        resp.text()
            .await
            .unwrap_or_default()
            .chars()
            .take(300)
            .collect()
    };
    Ok(AiKeyTestResult {
        status,
        ok,
        model_id: (ok && !model.is_empty()).then_some(model),
        message,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn masks_long_keys() {
        let m = mask_key("sk-ant-abcdefghijklmnop");
        assert!(m.starts_with("sk-"));
        assert!(m.ends_with("nop"));
        assert!(m.contains('•'));
    }

    #[test]
    fn masks_short_keys_fully() {
        assert_eq!(mask_key("abc"), "•••");
    }

    #[test]
    fn rejects_traversal_alias() {
        assert!(validate_alias("../evil").is_err());
        assert!(validate_alias("ok-alias").is_ok());
    }

    // ── ai_key_test (S-AIK-006..008 / SC-LLM-06) ────────────────────────

    #[tokio::test]
    async fn ai_key_test_returns_401_for_rejected_key() {
        use wiremock::matchers::{header, method, path};
        use wiremock::{Mock, MockServer, ResponseTemplate};
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/models"))
            .and(header("authorization", "Bearer sk-bad"))
            .respond_with(ResponseTemplate::new(401).set_body_string("invalid api key"))
            .mount(&server)
            .await;
        let out = ai_key_test(
            "openai".into(),
            "gpt-5".into(),
            Some(server.uri()),
            "sk-bad".into(),
            None,
        )
        .await
        .unwrap();
        assert_eq!(out.status, 401);
        assert!(!out.ok);
        assert!(out.model_id.is_none());
        assert!(out.message.contains("invalid api key"));
    }

    #[tokio::test]
    async fn ai_key_test_returns_ok_for_accepted_key() {
        use wiremock::matchers::{method, path};
        use wiremock::{Mock, MockServer, ResponseTemplate};
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/models"))
            .respond_with(
                ResponseTemplate::new(200).set_body_json(serde_json::json!({ "data": [] })),
            )
            .mount(&server)
            .await;
        let out = ai_key_test(
            "deepseek".into(),
            "deepseek-chat".into(),
            Some(server.uri()),
            "sk-good".into(),
            None,
        )
        .await
        .unwrap();
        assert_eq!(out.status, 200);
        assert!(out.ok);
        assert_eq!(out.model_id.as_deref(), Some("deepseek-chat"));
        assert!(out.message.is_empty());
    }

    #[tokio::test]
    async fn ai_key_test_anthropic_uses_x_api_key_and_v1_models_path() {
        use wiremock::matchers::{header, method, path};
        use wiremock::{Mock, MockServer, ResponseTemplate};
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/v1/models"))
            .and(header("x-api-key", "sk-ant-test"))
            .and(header("anthropic-version", "2023-06-01"))
            .respond_with(ResponseTemplate::new(403).set_body_string("forbidden"))
            .mount(&server)
            .await;
        let out = ai_key_test(
            "anthropic".into(),
            "claude-opus-4-7".into(),
            Some(server.uri()),
            "sk-ant-test".into(),
            None,
        )
        .await
        .unwrap();
        assert_eq!(out.status, 403);
        assert!(!out.ok);
    }

    #[tokio::test]
    async fn ai_key_test_google_passes_key_as_query_param() {
        use wiremock::matchers::{method, path, query_param};
        use wiremock::{Mock, MockServer, ResponseTemplate};
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/models"))
            .and(query_param("key", "g-key"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({})))
            .mount(&server)
            .await;
        let out = ai_key_test(
            "google".into(),
            "gemini-2.5-pro".into(),
            Some(server.uri()),
            "g-key".into(),
            None,
        )
        .await
        .unwrap();
        assert!(out.ok);
    }

    #[tokio::test]
    async fn ai_key_test_unreachable_endpoint_yields_network_prefixed_error() {
        // Port 1 is reserved/closed — connection refused, not a HTTP status.
        let err = ai_key_test(
            "openai".into(),
            "gpt-5".into(),
            Some("http://127.0.0.1:1".into()),
            "sk-x".into(),
            None,
        )
        .await
        .unwrap_err();
        assert!(
            err.starts_with("network:"),
            "expected network: prefix, got {err}"
        );
    }

    #[tokio::test]
    async fn ai_key_test_openai_compatible_requires_base_url() {
        let err = ai_key_test(
            "openai-compatible".into(),
            "my-model".into(),
            None,
            "sk-x".into(),
            None,
        )
        .await
        .unwrap_err();
        assert!(err.contains("base URL"));
        assert!(!err.starts_with("network:"));
    }

    #[tokio::test]
    async fn ai_key_test_unknown_provider_errors() {
        let err = ai_key_test("nope".into(), "m".into(), None, "k".into(), None)
            .await
            .unwrap_err();
        assert!(err.contains("unknown provider"));
    }

    #[test]
    fn ai_key_test_result_serialises_camel_case_and_skips_absent_model() {
        let v = serde_json::to_value(AiKeyTestResult {
            status: 401,
            ok: false,
            model_id: None,
            message: "unauthorized".into(),
        })
        .unwrap();
        assert_eq!(v["status"], 401);
        assert_eq!(v["ok"], false);
        assert!(v.get("modelId").is_none());

        let v = serde_json::to_value(AiKeyTestResult {
            status: 200,
            ok: true,
            model_id: Some("gpt-5".into()),
            message: String::new(),
        })
        .unwrap();
        assert_eq!(v["modelId"], "gpt-5");
    }
}
