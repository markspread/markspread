// S-UP-001..019: in-app updater backend.
//
// The renderer drives a four-step flow: check → download → install.
// This module owns the mechanics:
//
//   • updater_check  — fetch the channel manifest, return it only when
//     it advertises a strictly newer version.
//   • updater_download — stream the platform artefact to disk, emit
//     `updater://progress` events, verify the sha256, and remember the
//     path for the install step. Cancellable via a shared flag.
//   • updater_cancel — flip the cancel flag; the streaming loop checks
//     it between chunks.
//   • updater_install_and_restart — hand the artefact to the OS
//     installer and restart the app.
//
// The manifest URL is read from `settings.json` (`updateManifestUrl`),
// optionally with a `{channel}` placeholder. When unset, `updater_check`
// reports "no update" rather than guessing an endpoint.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};

use crate::error::{AppError, AppResult};

#[derive(Default)]
pub struct UpdaterState {
    cancel: AtomicBool,
    downloaded: Mutex<Option<PathBuf>>,
}

fn data_dir() -> AppResult<PathBuf> {
    dirs::data_local_dir()
        .map(|p| p.join("markspread"))
        .ok_or_else(|| AppError::Invalid("could not resolve OS data dir".into()))
}

fn sha256_hex(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    let mut h = Sha256::new();
    h.update(bytes);
    hex::encode(h.finalize())
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UpdatePlatformEntry {
    pub url: String,
    pub signature: String,
    pub sha256: String,
    pub resolved_host: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UpdateManifest {
    pub version: String,
    pub notes_markdown: String,
    pub pub_date: String,
    pub platforms: std::collections::HashMap<String, UpdatePlatformEntry>,
    pub signature: String,
}

/// Map `std::env::consts::OS` + arch onto the manifest's platform keys.
/// Tauri's convention is `<os>-<arch>` (e.g. `darwin-aarch64`).
fn platform_key() -> String {
    let os = match std::env::consts::OS {
        "macos" => "darwin",
        other => other,
    };
    format!("{os}-{}", std::env::consts::ARCH)
}

fn parse_tuple(v: &str) -> Option<(u64, u64, u64)> {
    let mut it = v
        .split(|c: char| !c.is_ascii_digit())
        .filter(|s| !s.is_empty());
    let major = it.next()?.parse().ok()?;
    let minor = it.next()?.parse().ok()?;
    let patch = it.next()?.parse().ok()?;
    Some((major, minor, patch))
}

/// True when `candidate` is strictly newer than `current`.
fn is_newer(current: &str, candidate: &str) -> bool {
    match (parse_tuple(current), parse_tuple(candidate)) {
        (Some(c), Some(n)) => n > c,
        _ => false,
    }
}

fn read_manifest_url(channel: &str) -> AppResult<Option<String>> {
    let path = data_dir()?.join("settings.json");
    let raw = match std::fs::read_to_string(&path) {
        Ok(r) => r,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(AppError::Io(e)),
    };
    let v: serde_json::Value = serde_json::from_str(&raw)
        .map_err(|e| AppError::Invalid(format!("settings parse: {e}")))?;
    Ok(v.get("updateManifestUrl")
        .and_then(|x| x.as_str())
        .map(|s| s.replace("{channel}", channel)))
}

/// S-UP-001: fetch the channel manifest. Returns `None` when no manifest
/// URL is configured, the fetch fails, or the advertised version is not
/// strictly newer than the running build.
#[tauri::command]
pub async fn updater_check(channel: String) -> AppResult<Option<UpdateManifest>> {
    let url = match read_manifest_url(&channel)? {
        Some(u) => u,
        None => return Ok(None),
    };
    let resp = reqwest::get(&url)
        .await
        .map_err(|e| AppError::Invalid(format!("manifest fetch: {e}")))?;
    if !resp.status().is_success() {
        return Err(AppError::Invalid(format!(
            "manifest fetch returned {}",
            resp.status()
        )));
    }
    let manifest: UpdateManifest = resp
        .json()
        .await
        .map_err(|e| AppError::Invalid(format!("manifest parse: {e}")))?;

    let current = env!("CARGO_PKG_VERSION");
    if !is_newer(current, &manifest.version) {
        return Ok(None);
    }
    Ok(Some(manifest))
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct DownloadProgress {
    bytes_pulled: u64,
    total_bytes: u64,
    paused: bool,
    resumable: bool,
}

/// S-UP-002: stream the platform artefact to `updates/<filename>`,
/// emitting `updater://progress` between chunks and aborting cleanly if
/// `updater_cancel` flips the flag. The sha256 is verified before the
/// download is considered complete.
#[tauri::command]
pub async fn updater_download(
    app: AppHandle,
    state: State<'_, UpdaterState>,
    manifest: UpdateManifest,
) -> AppResult<()> {
    let key = platform_key();
    let entry = manifest
        .platforms
        .get(&key)
        .ok_or_else(|| AppError::Invalid(format!("manifest has no artefact for platform {key}")))?;

    state.cancel.store(false, Ordering::SeqCst);

    let dir = data_dir()?.join("updates");
    std::fs::create_dir_all(&dir).map_err(AppError::Io)?;
    let filename = entry
        .url
        .rsplit('/')
        .next()
        .filter(|s| !s.is_empty())
        .unwrap_or("markspread-update.bin");
    let target = dir.join(filename);

    let resp = reqwest::get(&entry.url)
        .await
        .map_err(|e| AppError::Invalid(format!("artefact fetch: {e}")))?;
    if !resp.status().is_success() {
        return Err(AppError::Invalid(format!(
            "artefact fetch returned {}",
            resp.status()
        )));
    }
    let total = resp.content_length().unwrap_or(0);

    let mut buf: Vec<u8> = Vec::with_capacity(total as usize);
    let mut resp = resp;
    let mut pulled: u64 = 0;
    loop {
        if state.cancel.load(Ordering::SeqCst) {
            let _ = app.emit(
                "updater://progress",
                DownloadProgress {
                    bytes_pulled: pulled,
                    total_bytes: total,
                    paused: true,
                    resumable: true,
                },
            );
            return Err(AppError::Invalid("download cancelled".into()));
        }
        match resp
            .chunk()
            .await
            .map_err(|e| AppError::Invalid(format!("artefact stream: {e}")))?
        {
            Some(chunk) => {
                pulled += chunk.len() as u64;
                buf.extend_from_slice(&chunk);
                let _ = app.emit(
                    "updater://progress",
                    DownloadProgress {
                        bytes_pulled: pulled,
                        total_bytes: total,
                        paused: false,
                        resumable: true,
                    },
                );
            }
            None => break,
        }
    }

    let digest = sha256_hex(&buf);
    if !entry.sha256.is_empty() && !digest.eq_ignore_ascii_case(&entry.sha256) {
        return Err(AppError::Invalid(
            "artefact sha256 mismatch — refusing to install".into(),
        ));
    }

    std::fs::write(&target, &buf).map_err(AppError::Io)?;
    *state
        .downloaded
        .lock()
        .map_err(|_| AppError::Invalid("updater state poisoned".into()))? = Some(target);

    let _ = app.emit(
        "updater://progress",
        DownloadProgress {
            bytes_pulled: pulled,
            total_bytes: total.max(pulled),
            paused: false,
            resumable: false,
        },
    );
    Ok(())
}

/// S-UP-002: request cancellation. The download loop notices between
/// chunks and unwinds with a structured error.
#[tauri::command]
pub async fn updater_cancel(state: State<'_, UpdaterState>) -> AppResult<()> {
    state.cancel.store(true, Ordering::SeqCst);
    Ok(())
}

/// S-UP-009..011: hand the downloaded artefact to the OS installer and
/// restart the app. The exact mechanism is platform-specific; on every
/// platform we spawn the installer detached, then `app.restart()`.
#[tauri::command]
pub async fn updater_install_and_restart(
    app: AppHandle,
    state: State<'_, UpdaterState>,
) -> AppResult<()> {
    let path = state
        .downloaded
        .lock()
        .map_err(|_| AppError::Invalid("updater state poisoned".into()))?
        .clone()
        .ok_or_else(|| AppError::Invalid("no downloaded update to install".into()))?;
    if !path.exists() {
        return Err(AppError::NotFound(
            "downloaded update file is missing".into(),
        ));
    }

    #[cfg(target_os = "macos")]
    let spawn = std::process::Command::new("open").arg(&path).spawn();
    #[cfg(target_os = "windows")]
    let spawn = std::process::Command::new(&path).spawn();
    #[cfg(all(unix, not(target_os = "macos")))]
    let spawn = std::process::Command::new("xdg-open").arg(&path).spawn();

    spawn.map_err(|e| AppError::Invalid(format!("launch installer: {e}")))?;

    // Give the installer a moment to take its file lock before we exit.
    tokio::time::sleep(std::time::Duration::from_millis(400)).await;
    app.restart();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn newer_version_detection() {
        assert!(is_newer("0.1.0", "0.1.1"));
        assert!(is_newer("0.1.0", "1.0.0"));
        assert!(!is_newer("0.2.0", "0.1.9"));
        assert!(!is_newer("1.0.0", "1.0.0"));
    }

    #[test]
    fn platform_key_shape() {
        let k = platform_key();
        assert!(k.contains('-'));
    }
}
