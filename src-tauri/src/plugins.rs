// S-PL-017..026 / S-PLM-001..027 / S-SE-019..021: plugin lifecycle,
// marketplace, per-plugin storage, and the permission audit log.
//
// On-disk state, all under the app data dir:
//
//   plugins.json        — installed registry: { installed: [...] }
//   plugins.db          — sqlite: plugin_storage, permission_audit,
//                         permission_grant
//   plugins/<id>/       — extracted plugin bundle
//
// The marketplace endpoint is read from `settings.json`
// (`pluginMarketplaceUrl`). When unset, browse/search return empty and
// install fails with a structured error rather than guessing a host.
// The plugin tarball is an npm-style `package/`-prefixed `.tgz`.

use std::io::Read;
use std::path::{Path, PathBuf};

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

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

fn gen_id(prefix: &str) -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("{prefix}-{nanos}")
}

/// Manifest grammar `^[a-z][a-z0-9-]{2,38}$`. Re-validated host-side so a
/// hostile renderer cannot smuggle path-traversal characters into a
/// directory name or keychain item.
fn validate_plugin_id(id: &str) -> AppResult<()> {
    if id.len() < 3 || id.len() > 39 {
        return Err(AppError::Invalid("plugin id length out of range".into()));
    }
    let mut chars = id.chars();
    if !chars.next().unwrap().is_ascii_lowercase() {
        return Err(AppError::Invalid("plugin id must start with a-z".into()));
    }
    for c in id.chars() {
        if !(c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-') {
            return Err(AppError::Invalid(format!(
                "plugin id contains invalid character: {c:?}"
            )));
        }
    }
    Ok(())
}

// ─── Installed registry (plugins.json) ──────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct InstalledPlugin {
    pub manifest: serde_json::Value,
    pub enabled: bool,
    #[serde(default)]
    pub version: String,
    #[serde(default)]
    pub installed_at: i64,
}

#[derive(Debug, Serialize, Deserialize, Default)]
struct Registry {
    #[serde(default)]
    installed: Vec<InstalledPlugin>,
}

fn registry_path() -> AppResult<PathBuf> {
    Ok(data_dir()?.join("plugins.json"))
}

fn read_registry() -> AppResult<Registry> {
    let path = registry_path()?;
    match std::fs::read_to_string(&path) {
        Ok(raw) => serde_json::from_str(&raw)
            .map_err(|e| AppError::Invalid(format!("plugins.json parse: {e}"))),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Registry::default()),
        Err(e) => Err(AppError::Io(e)),
    }
}

fn write_registry(reg: &Registry) -> AppResult<()> {
    let path = registry_path()?;
    let dir = data_dir()?;
    std::fs::create_dir_all(&dir).map_err(AppError::Io)?;
    let bytes = serde_json::to_vec_pretty(reg)
        .map_err(|e| AppError::Invalid(format!("plugins.json serialise: {e}")))?;
    let tmp = dir.join(".plugins.json.tmp");
    std::fs::write(&tmp, &bytes).map_err(AppError::Io)?;
    std::fs::rename(&tmp, &path).map_err(AppError::Io)?;
    Ok(())
}

fn manifest_id(m: &serde_json::Value) -> Option<&str> {
    m.get("id").and_then(|v| v.as_str())
}

#[tauri::command]
pub async fn plugin_list() -> AppResult<Vec<InstalledPlugin>> {
    Ok(read_registry()?.installed)
}

fn set_enabled(plugin_id: &str, enabled: bool) -> AppResult<()> {
    validate_plugin_id(plugin_id)?;
    let mut reg = read_registry()?;
    let entry = reg
        .installed
        .iter_mut()
        .find(|p| manifest_id(&p.manifest) == Some(plugin_id))
        .ok_or_else(|| AppError::NotFound(format!("plugin not installed: {plugin_id}")))?;
    entry.enabled = enabled;
    write_registry(&reg)
}

#[tauri::command]
pub async fn plugin_enable(plugin_id: String) -> AppResult<()> {
    set_enabled(&plugin_id, true)
}

#[tauri::command]
pub async fn plugin_disable(plugin_id: String) -> AppResult<()> {
    set_enabled(&plugin_id, false)
}

/// S-PL-020: mark a plugin active. The worker/iframe sandbox spawn is a
/// separate host subsystem; here we validate the plugin is installed and
/// enabled so the renderer's boot loop gets a definite allow/deny.
#[tauri::command]
pub async fn plugin_activate(plugin_id: String) -> AppResult<()> {
    validate_plugin_id(&plugin_id)?;
    let reg = read_registry()?;
    let entry = reg
        .installed
        .iter()
        .find(|p| manifest_id(&p.manifest) == Some(plugin_id.as_str()))
        .ok_or_else(|| AppError::NotFound(format!("plugin not installed: {plugin_id}")))?;
    if !entry.enabled {
        return Err(AppError::Invalid(format!(
            "plugin is disabled: {plugin_id}"
        )));
    }
    Ok(())
}

/// S-PLM-018: uninstall — drop the registry entry, the extracted bundle,
/// and the plugin's storage rows. Disabled plugins are kept on disk
/// until this is called explicitly.
#[tauri::command]
pub async fn plugin_uninstall(plugin_id: String) -> AppResult<()> {
    validate_plugin_id(&plugin_id)?;
    let mut reg = read_registry()?;
    let before = reg.installed.len();
    reg.installed
        .retain(|p| manifest_id(&p.manifest) != Some(plugin_id.as_str()));
    if reg.installed.len() == before {
        return Err(AppError::NotFound(format!(
            "plugin not installed: {plugin_id}"
        )));
    }
    write_registry(&reg)?;

    let bundle = data_dir()?.join("plugins").join(&plugin_id);
    if bundle.exists() {
        std::fs::remove_dir_all(&bundle).map_err(AppError::Io)?;
    }
    let conn = open_db()?;
    conn.execute(
        "DELETE FROM plugin_storage WHERE plugin_id = ?1",
        params![plugin_id],
    )
    .map_err(|e| AppError::Invalid(format!("uninstall storage drop: {e}")))?;
    Ok(())
}

// ─── plugins.db ─────────────────────────────────────────────────────────

fn open_db() -> AppResult<Connection> {
    let mut path = data_dir()?;
    std::fs::create_dir_all(&path).map_err(AppError::Io)?;
    path.push("plugins.db");
    let conn =
        Connection::open(&path).map_err(|e| AppError::Invalid(format!("plugins db open: {e}")))?;
    conn.pragma_update(None, "journal_mode", "WAL")
        .map_err(|e| AppError::Invalid(format!("plugins db WAL: {e}")))?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS plugin_storage (
            plugin_id TEXT NOT NULL,
            key       TEXT NOT NULL,
            value     TEXT NOT NULL,
            PRIMARY KEY (plugin_id, key)
         );
         CREATE TABLE IF NOT EXISTS permission_audit (
            id          TEXT PRIMARY KEY,
            ts          INTEGER NOT NULL,
            plugin_id   TEXT NOT NULL,
            api_kind    TEXT NOT NULL,
            api_summary TEXT NOT NULL,
            decision    TEXT NOT NULL,
            reason      TEXT NOT NULL
         );
         CREATE TABLE IF NOT EXISTS permission_grant (
            plugin_id TEXT NOT NULL,
            ts        INTEGER NOT NULL,
            granted   INTEGER NOT NULL,
            PRIMARY KEY (plugin_id)
         );
         CREATE INDEX IF NOT EXISTS ix_audit_ts ON permission_audit(ts);",
    )
    .map_err(|e| AppError::Invalid(format!("plugins db schema: {e}")))?;
    Ok(conn)
}

// ─── Per-plugin storage (S-PL-023 / S-PL-024) ───────────────────────────

const PLUGIN_STORAGE_QUOTA_BYTES: i64 = 5 * 1024 * 1024;

#[tauri::command]
pub async fn plugin_storage_get(plugin_id: String, key: String) -> AppResult<Option<String>> {
    validate_plugin_id(&plugin_id)?;
    let conn = open_db()?;
    conn.query_row(
        "SELECT value FROM plugin_storage WHERE plugin_id = ?1 AND key = ?2",
        params![plugin_id, key],
        |r| r.get::<_, String>(0),
    )
    .map(Some)
    .or_else(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => Ok(None),
        other => Err(AppError::Invalid(format!("plugin_storage_get: {other}"))),
    })
}

#[tauri::command]
pub async fn plugin_storage_set(
    plugin_id: String,
    key: String,
    value: String,
) -> AppResult<()> {
    validate_plugin_id(&plugin_id)?;
    let conn = open_db()?;
    // S-PL-024: soft quota — sum every value the plugin holds, minus the
    // row we're about to overwrite, plus the incoming value.
    let used: i64 = conn
        .query_row(
            "SELECT COALESCE(SUM(LENGTH(value)),0) FROM plugin_storage
             WHERE plugin_id = ?1 AND key != ?2",
            params![plugin_id, key],
            |r| r.get(0),
        )
        .map_err(|e| AppError::Invalid(format!("plugin_storage quota: {e}")))?;
    if used + value.len() as i64 > PLUGIN_STORAGE_QUOTA_BYTES {
        return Err(AppError::Invalid(format!(
            "plugin storage quota exceeded for {plugin_id} (5 MB)"
        )));
    }
    conn.execute(
        "INSERT INTO plugin_storage (plugin_id, key, value) VALUES (?1, ?2, ?3)
         ON CONFLICT(plugin_id, key) DO UPDATE SET value = excluded.value",
        params![plugin_id, key, value],
    )
    .map_err(|e| AppError::Invalid(format!("plugin_storage_set: {e}")))?;
    Ok(())
}

#[tauri::command]
pub async fn plugin_storage_remove(plugin_id: String, key: String) -> AppResult<()> {
    validate_plugin_id(&plugin_id)?;
    let conn = open_db()?;
    conn.execute(
        "DELETE FROM plugin_storage WHERE plugin_id = ?1 AND key = ?2",
        params![plugin_id, key],
    )
    .map_err(|e| AppError::Invalid(format!("plugin_storage_remove: {e}")))?;
    Ok(())
}

// ─── Permission audit log (S-SE-019..021) ───────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditEntryInput {
    pub ts: i64,
    pub plugin_id: String,
    pub api_kind: String,
    pub api_summary: String,
    pub decision: String,
    pub reason: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditEntry {
    pub id: String,
    pub ts: i64,
    pub plugin_id: String,
    pub api_kind: String,
    pub api_summary: String,
    pub decision: String,
    pub reason: String,
}

const AUDIT_RETENTION_MS: i64 = 7 * 24 * 60 * 60 * 1000;

#[tauri::command]
pub async fn plugin_permission_audit(entry: AuditEntryInput) -> AppResult<()> {
    let conn = open_db()?;
    conn.execute(
        "INSERT INTO permission_audit
            (id, ts, plugin_id, api_kind, api_summary, decision, reason)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            gen_id("audit"),
            entry.ts,
            entry.plugin_id,
            entry.api_kind,
            entry.api_summary,
            entry.decision,
            entry.reason,
        ],
    )
    .map_err(|e| AppError::Invalid(format!("plugin_permission_audit: {e}")))?;
    // S-SE-019: 7-day rolling retention — prune on every write.
    conn.execute(
        "DELETE FROM permission_audit WHERE ts < ?1",
        params![now_ms() - AUDIT_RETENTION_MS],
    )
    .map_err(|e| AppError::Invalid(format!("audit prune: {e}")))?;
    Ok(())
}

#[tauri::command]
pub async fn plugin_permission_audit_list(
    from_ts: i64,
    to_ts: i64,
    plugin_id: Option<String>,
    decision: Option<String>,
) -> AppResult<Vec<AuditEntry>> {
    let conn = open_db()?;
    let mut sql = String::from(
        "SELECT id, ts, plugin_id, api_kind, api_summary, decision, reason
         FROM permission_audit WHERE ts >= ?1 AND ts < ?2",
    );
    if plugin_id.is_some() {
        sql.push_str(" AND plugin_id = ?3");
    }
    if decision.is_some() {
        sql.push_str(if plugin_id.is_some() {
            " AND decision = ?4"
        } else {
            " AND decision = ?3"
        });
    }
    sql.push_str(" ORDER BY ts DESC");

    let mut stmt = conn
        .prepare(&sql)
        .map_err(|e| AppError::Invalid(format!("audit_list prepare: {e}")))?;
    let map_row = |r: &rusqlite::Row| -> rusqlite::Result<AuditEntry> {
        Ok(AuditEntry {
            id: r.get(0)?,
            ts: r.get(1)?,
            plugin_id: r.get(2)?,
            api_kind: r.get(3)?,
            api_summary: r.get(4)?,
            decision: r.get(5)?,
            reason: r.get(6)?,
        })
    };
    let rows = match (&plugin_id, &decision) {
        (Some(p), Some(d)) => stmt.query_map(params![from_ts, to_ts, p, d], map_row),
        (Some(p), None) => stmt.query_map(params![from_ts, to_ts, p], map_row),
        (None, Some(d)) => stmt.query_map(params![from_ts, to_ts, d], map_row),
        (None, None) => stmt.query_map(params![from_ts, to_ts], map_row),
    }
    .map_err(|e| AppError::Invalid(format!("audit_list query: {e}")))?;

    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| AppError::Invalid(format!("audit_list row: {e}")))?);
    }
    Ok(out)
}

/// S-PLM-009: persist the outcome of a permission-consent prompt. The
/// renderer surfaces the dialog; this records the user's decision so a
/// later host-API call can be checked against it without re-prompting.
#[tauri::command]
pub async fn plugin_permission_prompt(plugin_id: String, granted: bool) -> AppResult<()> {
    validate_plugin_id(&plugin_id)?;
    let conn = open_db()?;
    conn.execute(
        "INSERT INTO permission_grant (plugin_id, ts, granted) VALUES (?1, ?2, ?3)
         ON CONFLICT(plugin_id) DO UPDATE SET ts = excluded.ts, granted = excluded.granted",
        params![plugin_id, now_ms(), granted as i64],
    )
    .map_err(|e| AppError::Invalid(format!("plugin_permission_prompt: {e}")))?;
    Ok(())
}

// ─── Marketplace (S-PLM-001..027) ───────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DistInfo {
    pub tarball: String,
    pub sha512: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MarketplaceDep {
    pub name: String,
    pub version: String,
    pub is_markspread_plugin: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MarketplaceListing {
    pub id: String,
    pub name: String,
    pub publisher: Option<String>,
    pub description: String,
    pub version: String,
    pub readme_html: Option<String>,
    #[serde(default)]
    pub permissions: Vec<serde_json::Value>,
    #[serde(default)]
    pub dependencies: Vec<MarketplaceDep>,
    pub license: Option<String>,
    #[serde(default)]
    pub official_badge: bool,
    #[serde(default)]
    pub weekly_downloads: i64,
    #[serde(default)]
    pub published_at: i64,
    #[serde(default)]
    pub rating_average: f64,
    #[serde(default)]
    pub rating_count: i64,
    pub dist: DistInfo,
}

fn marketplace_base() -> AppResult<Option<String>> {
    let path = data_dir()?.join("settings.json");
    let raw = match std::fs::read_to_string(&path) {
        Ok(r) => r,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(AppError::Io(e)),
    };
    let v: serde_json::Value =
        serde_json::from_str(&raw).map_err(|e| AppError::Invalid(format!("settings parse: {e}")))?;
    Ok(v.get("pluginMarketplaceUrl")
        .and_then(|x| x.as_str())
        .map(|s| s.trim_end_matches('/').to_string()))
}

#[tauri::command]
pub async fn plugin_marketplace_search(
    query: serde_json::Value,
) -> AppResult<Vec<MarketplaceListing>> {
    let base = match marketplace_base()? {
        Some(b) => b,
        None => return Ok(Vec::new()),
    };
    let text = query
        .get("text")
        .and_then(|t| t.as_str())
        .unwrap_or("")
        .to_string();
    let url = format!("{base}/search?text={}", urlencode(&text));
    let resp = reqwest::get(&url)
        .await
        .map_err(|e| AppError::Invalid(format!("marketplace search: {e}")))?;
    if !resp.status().is_success() {
        return Err(AppError::Invalid(format!(
            "marketplace search returned {}",
            resp.status()
        )));
    }
    resp.json()
        .await
        .map_err(|e| AppError::Invalid(format!("marketplace search parse: {e}")))
}

#[tauri::command]
pub async fn plugin_marketplace_get(id: String) -> AppResult<MarketplaceListing> {
    validate_plugin_id(&id)?;
    let base = marketplace_base()?.ok_or_else(|| {
        AppError::Invalid("no plugin marketplace configured".into())
    })?;
    let url = format!("{base}/plugins/{id}");
    let resp = reqwest::get(&url)
        .await
        .map_err(|e| AppError::Invalid(format!("marketplace get: {e}")))?;
    if resp.status() == reqwest::StatusCode::NOT_FOUND {
        return Err(AppError::NotFound(format!("no marketplace plugin {id}")));
    }
    if !resp.status().is_success() {
        return Err(AppError::Invalid(format!(
            "marketplace get returned {}",
            resp.status()
        )));
    }
    resp.json()
        .await
        .map_err(|e| AppError::Invalid(format!("marketplace get parse: {e}")))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateAvailable {
    pub id: String,
    pub installed_version: String,
    pub latest_version: String,
    pub permission_delta: Vec<serde_json::Value>,
}

fn parse_tuple(v: &str) -> Option<(u64, u64, u64)> {
    let mut it = v
        .split(|c: char| !c.is_ascii_digit())
        .filter(|s| !s.is_empty());
    Some((
        it.next()?.parse().ok()?,
        it.next()?.parse().ok()?,
        it.next()?.parse().ok()?,
    ))
}

#[tauri::command]
pub async fn plugin_marketplace_updates() -> AppResult<Vec<UpdateAvailable>> {
    let base = match marketplace_base()? {
        Some(b) => b,
        None => return Ok(Vec::new()),
    };
    let mut out = Vec::new();
    for plugin in read_registry()?.installed {
        let Some(id) = manifest_id(&plugin.manifest) else {
            continue;
        };
        let url = format!("{base}/plugins/{id}");
        let resp = match reqwest::get(&url).await {
            Ok(r) if r.status().is_success() => r,
            _ => continue,
        };
        let Ok(listing) = resp.json::<MarketplaceListing>().await else {
            continue;
        };
        let newer = match (parse_tuple(&plugin.version), parse_tuple(&listing.version)) {
            (Some(cur), Some(latest)) => latest > cur,
            _ => false,
        };
        if !newer {
            continue;
        }
        // S-PLM-020: surface permissions the new version adds that the
        // installed one did not request.
        let installed_perms: Vec<String> = plugin
            .manifest
            .get("permissions")
            .and_then(|p| p.as_array())
            .map(|a| a.iter().map(|v| v.to_string()).collect())
            .unwrap_or_default();
        let permission_delta: Vec<serde_json::Value> = listing
            .permissions
            .iter()
            .filter(|p| !installed_perms.contains(&p.to_string()))
            .cloned()
            .collect();
        out.push(UpdateAvailable {
            id: id.to_string(),
            installed_version: plugin.version.clone(),
            latest_version: listing.version.clone(),
            permission_delta,
        });
    }
    Ok(out)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallError {
    pub code: String,
    pub message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallOutcome {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub installed_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<InstallError>,
}

fn install_fail(code: &str, message: String) -> InstallOutcome {
    InstallOutcome {
        ok: false,
        installed_version: None,
        error: Some(InstallError {
            code: code.to_string(),
            message,
        }),
    }
}

fn sha512_hex(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha512};
    let mut h = Sha512::new();
    h.update(bytes);
    hex::encode(h.finalize())
}

fn sha512_matches(bytes: &[u8], expected: &str) -> bool {
    if expected.is_empty() {
        return true;
    }
    let digest_hex = sha512_hex(bytes);
    if digest_hex.eq_ignore_ascii_case(expected) {
        return true;
    }
    // npm `integrity` form: `sha512-<base64>`.
    if let Some(b64) = expected.strip_prefix("sha512-") {
        if let Ok(raw) = base64_decode(b64) {
            return raw == sha512_raw(bytes);
        }
    }
    false
}

fn sha512_raw(bytes: &[u8]) -> Vec<u8> {
    use sha2::{Digest, Sha512};
    let mut h = Sha512::new();
    h.update(bytes);
    h.finalize().to_vec()
}

/// Minimal standard-base64 decoder — npm integrity strings are the only
/// caller, so we don't pull a crate for it.
fn base64_decode(s: &str) -> Result<Vec<u8>, ()> {
    const T: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut lookup = [255u8; 256];
    for (i, &c) in T.iter().enumerate() {
        lookup[c as usize] = i as u8;
    }
    let mut out = Vec::new();
    let mut acc = 0u32;
    let mut bits = 0u32;
    for &c in s.trim().as_bytes() {
        if c == b'=' {
            break;
        }
        let v = lookup[c as usize];
        if v == 255 {
            return Err(());
        }
        acc = (acc << 6) | v as u32;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((acc >> bits) as u8);
        }
    }
    Ok(out)
}

fn urlencode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

/// S-PLM-009..014: install pipeline — fetch listing, download the
/// `.tgz`, verify sha512, extract (npm tarballs nest under `package/`),
/// re-validate the manifest, and register the plugin.
#[tauri::command]
pub async fn plugin_install(plugin_id: String, version: String) -> AppResult<InstallOutcome> {
    if validate_plugin_id(&plugin_id).is_err() {
        return Ok(install_fail(
            "EINVAL",
            format!("invalid plugin id: {plugin_id}"),
        ));
    }

    let listing = match plugin_marketplace_get(plugin_id.clone()).await {
        Ok(l) => l,
        Err(e) => return Ok(install_fail("EMARKET", e.to_string())),
    };

    // Download tarball.
    let resp = match reqwest::get(&listing.dist.tarball).await {
        Ok(r) if r.status().is_success() => r,
        Ok(r) => return Ok(install_fail("EDOWNLOAD", format!("registry returned {}", r.status()))),
        Err(e) => return Ok(install_fail("EDOWNLOAD", e.to_string())),
    };
    let bytes = match resp.bytes().await {
        Ok(b) => b,
        Err(e) => return Ok(install_fail("EDOWNLOAD", e.to_string())),
    };

    // S-PLM-011: integrity verification.
    if !sha512_matches(&bytes, &listing.dist.sha512) {
        return Ok(install_fail(
            "EINTEGRITY",
            "tarball sha512 mismatch — refusing to install".into(),
        ));
    }

    // Extract `.tgz` into plugins/<id>/, stripping the leading
    // `package/` component npm tarballs always carry.
    let dest = match data_dir() {
        Ok(d) => d.join("plugins").join(&plugin_id),
        Err(e) => return Ok(install_fail("EIO", e.to_string())),
    };
    if dest.exists() {
        if let Err(e) = std::fs::remove_dir_all(&dest) {
            return Ok(install_fail("EIO", format!("clear old bundle: {e}")));
        }
    }
    if let Err(e) = extract_tgz(&bytes, &dest) {
        return Ok(install_fail("EEXTRACT", e.to_string()));
    }

    // S-PLM-012: re-read the extracted manifest.
    let manifest = match read_extracted_manifest(&dest) {
        Ok(m) => m,
        Err(e) => return Ok(install_fail("EMANIFEST", e.to_string())),
    };
    if manifest_id(&manifest) != Some(plugin_id.as_str()) {
        return Ok(install_fail(
            "EMANIFEST",
            "manifest id does not match requested plugin".into(),
        ));
    }

    let installed_version = if version.is_empty() {
        listing.version.clone()
    } else {
        version.clone()
    };
    let mut reg = match read_registry() {
        Ok(r) => r,
        Err(e) => return Ok(install_fail("EIO", e.to_string())),
    };
    reg.installed
        .retain(|p| manifest_id(&p.manifest) != Some(plugin_id.as_str()));
    reg.installed.push(InstalledPlugin {
        manifest,
        enabled: true,
        version: installed_version.clone(),
        installed_at: now_ms(),
    });
    if let Err(e) = write_registry(&reg) {
        return Ok(install_fail("EIO", e.to_string()));
    }

    Ok(InstallOutcome {
        ok: true,
        installed_version: Some(installed_version),
        error: None,
    })
}

fn extract_tgz(bytes: &[u8], dest: &Path) -> AppResult<()> {
    use flate2::read::GzDecoder;
    std::fs::create_dir_all(dest).map_err(AppError::Io)?;
    let mut archive = tar::Archive::new(GzDecoder::new(bytes));
    let entries = archive
        .entries()
        .map_err(|e| AppError::Invalid(format!("tar entries: {e}")))?;
    for entry in entries {
        let mut entry = entry.map_err(|e| AppError::Invalid(format!("tar entry: {e}")))?;
        let path = entry
            .path()
            .map_err(|e| AppError::Invalid(format!("tar path: {e}")))?
            .into_owned();
        // npm tarballs nest everything under `package/`.
        let rel: PathBuf = path
            .components()
            .skip(1)
            .collect::<PathBuf>();
        if rel.as_os_str().is_empty() {
            continue;
        }
        // Reject traversal that survives the skip.
        if rel.components().any(|c| c.as_os_str() == "..") {
            return Err(AppError::Invalid(format!(
                "unsafe path in tarball: {}",
                path.display()
            )));
        }
        let target = dest.join(&rel);
        if entry.header().entry_type().is_dir() {
            std::fs::create_dir_all(&target).map_err(AppError::Io)?;
            continue;
        }
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent).map_err(AppError::Io)?;
        }
        let mut buf = Vec::new();
        entry
            .read_to_end(&mut buf)
            .map_err(|e| AppError::Invalid(format!("tar read: {e}")))?;
        std::fs::write(&target, &buf).map_err(AppError::Io)?;
    }
    Ok(())
}

fn read_extracted_manifest(dest: &Path) -> AppResult<serde_json::Value> {
    for name in ["manifest.json", "markspread.json"] {
        let path = dest.join(name);
        if let Ok(raw) = std::fs::read_to_string(&path) {
            return serde_json::from_str(&raw)
                .map_err(|e| AppError::Invalid(format!("{name} parse: {e}")));
        }
    }
    Err(AppError::NotFound(
        "no manifest.json in plugin bundle".into(),
    ))
}

// ─── Signature verification (S-PLM-027) ─────────────────────────────────

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SignatureVerification {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fingerprint: Option<String>,
    pub verified_at: i64,
}

/// S-PLM-027: official-plugin badge. A signed plugin carries a detached
/// signature at `<tarball>.sig` over its sha512 digest. We fetch that
/// sidecar and classify the outcome.
///
/// Cryptographic verification requires the project's Ed25519 public key
/// to be pinned in the build; until that key is provisioned the only
/// honest outcomes are `no-signature` (sidecar absent) and `fetch-failed`
/// (network error). The badge is a trust hint, never a security
/// boundary — the sandbox + manifest checks gate every plugin equally.
#[tauri::command]
pub async fn plugin_marketplace_verify_signature(
    tarball_url: String,
    sha512: String,
) -> AppResult<SignatureVerification> {
    let _ = sha512;
    let verified_at = now_ms();
    let sig_url = format!("{tarball_url}.sig");
    let resp = match reqwest::get(&sig_url).await {
        Ok(r) => r,
        Err(_) => {
            return Ok(SignatureVerification {
                ok: false,
                reason: Some("fetch-failed".into()),
                fingerprint: None,
                verified_at,
            });
        }
    };
    if !resp.status().is_success() {
        return Ok(SignatureVerification {
            ok: false,
            reason: Some("no-signature".into()),
            fingerprint: None,
            verified_at,
        });
    }
    // A sidecar exists but no publisher key is pinned in this build, so
    // we cannot assert a match. Report `key-mismatch` rather than a
    // false-positive `ok: true`.
    Ok(SignatureVerification {
        ok: false,
        reason: Some("key-mismatch".into()),
        fingerprint: None,
        verified_at,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_plugin_id() {
        assert!(validate_plugin_id("good-plugin").is_ok());
        assert!(validate_plugin_id("../evil").is_err());
        assert!(validate_plugin_id("Ab").is_err());
    }

    #[test]
    fn base64_roundtrip_known_vector() {
        assert_eq!(base64_decode("aGk=").unwrap(), b"hi");
    }

    #[test]
    fn sha512_empty_expected_passes() {
        assert!(sha512_matches(b"anything", ""));
    }

    #[test]
    fn version_tuple_compare() {
        assert!(parse_tuple("1.2.3").unwrap() < parse_tuple("1.2.4").unwrap());
    }
}
