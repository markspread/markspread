use crate::error::{AppError, AppResult};
use crate::path_norm::nfc_str;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};

/// Files larger than this should be loaded chunked, not all at once.
pub const LARGE_FILE_THRESHOLD: u64 = 10 * 1024 * 1024;
/// Beyond this size some editor features (full search/index) get disabled.
pub const HUGE_FILE_THRESHOLD: u64 = 100 * 1024 * 1024;
/// Cap per chunk read to keep IPC payloads bounded.
pub const MAX_CHUNK_BYTES: u64 = 64 * 1024;

#[derive(Debug, Serialize, Deserialize)]
pub struct FileStat {
    pub path: String,
    /// "file" | "dir" | "symlink" | "other"
    pub kind: String,
    pub size: u64,
    pub is_dir: bool,
    pub is_file: bool,
    pub readonly: bool,
    pub modified_ms: Option<i64>,
    pub created_ms: Option<i64>,
    pub accessed_ms: Option<i64>,
}

#[derive(Debug, Serialize)]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub modified_ms: Option<i64>,
}

#[derive(Debug, Default, Deserialize)]
pub struct FsListOptions {
    /// Zero-based page index. Default 0.
    #[serde(default)]
    pub page: Option<usize>,
    /// Default 1000.
    #[serde(default)]
    pub page_size: Option<usize>,
    /// When true, populate size/modified_ms via per-entry stat.
    /// Default false (fast mode skips stat).
    #[serde(default)]
    pub include_metadata: bool,
}

#[derive(Debug, Serialize)]
pub struct FsListPage {
    pub entries: Vec<DirEntry>,
    pub page: usize,
    pub page_size: usize,
    pub has_more: bool,
}

#[derive(Debug, Serialize)]
pub struct FsReadResult {
    pub content: String,
    pub encoding: String,
    pub mtime: u64,
    pub sha256: Option<String>,
    /// True when the file is at or above `LARGE_FILE_THRESHOLD`. The frontend
    /// can use it to defer expensive editor features (full-doc highlighting,
    /// linting) until the user opts in.
    pub large: bool,
}

#[derive(Debug, Serialize)]
pub struct FsChunk {
    pub bytes: Vec<u8>,
    pub offset: u64,
    pub size: u64,
    pub eof: bool,
}

#[derive(Debug, Default, Deserialize)]
pub struct FsReadOptions {
    /// Compute SHA-256 of the file bytes. Default: false (slight cost).
    #[serde(default)]
    pub with_sha256: bool,
}

// S-FAP-007: these two helpers used to host scattered SEC/BND checks. The
// engine in `crate::access_policy` is now the single source of truth — these
// wrappers exist only to preserve the `AppResult` signature so the 14 fs_cmd
// call sites don't each need an `if let AccessDecision { … }` ladder. The
// returned `AppError::Access` carries the structured deny payload.
pub(crate) fn validate_input_path(raw: &str) -> AppResult<()> {
    if let Some(d) = crate::access_policy::check_path_input(raw) {
        crate::telemetry::record(&d);
        return Err(AppError::Access(d));
    }
    Ok(())
}

pub(crate) fn ensure_within(workspace: &Path, target: &Path) -> AppResult<PathBuf> {
    crate::access_policy::ensure_within_engine(workspace, target).map_err(|d| {
        tracing::warn!(
            workspace = %workspace.display(),
            attempted = %target.display(),
            rule_id = d.rule_id.as_wire_str(),
            "access policy engine rejected path"
        );
        crate::telemetry::record(&d);
        AppError::Access(d)
    })
}

fn map_write_io_error(
    e: std::io::Error,
    parent: Option<&Path>,
    needed: u64,
) -> AppError {
    if let Some(err) = enospc_with_space(&e, parent, needed) {
        return err;
    }
    if e.kind() == std::io::ErrorKind::PermissionDenied {
        let hint = if cfg!(target_os = "macos") {
            " (시스템 설정 → 개인정보 보호 및 보안에서 폴더 접근을 허용하거나 워크스페이스를 읽기 전용으로 여세요)"
        } else if cfg!(target_os = "windows") {
            " (파일 속성 → 보안에서 쓰기 권한을 허용하거나 워크스페이스를 읽기 전용으로 여세요)"
        } else {
            " (디렉터리/파일의 쓰기 권한을 확인하거나 워크스페이스를 읽기 전용으로 여세요)"
        };
        return AppError::PermissionDenied(format!("이 파일을 저장할 권한이 없습니다{hint}"));
    }
    e.into()
}

fn enospc_with_space(
    e: &std::io::Error,
    parent: Option<&Path>,
    needed: u64,
) -> Option<AppError> {
    let raw = e.raw_os_error()?;
    let is_full = if cfg!(windows) {
        raw == 112 || raw == 39
    } else {
        raw == 28
    };
    if !is_full {
        return None;
    }
    let avail = parent.and_then(|p| fs4::available_space(p).ok());
    let msg = match avail {
        Some(a) => format!(
            "디스크 공간이 부족합니다 (필요 {} / 가능 {})",
            human_bytes(needed),
            human_bytes(a)
        ),
        None => format!("디스크 공간이 부족합니다 (필요 {})", human_bytes(needed)),
    };
    Some(AppError::DiskFull(msg))
}

fn human_bytes(n: u64) -> String {
    const KIB: u64 = 1024;
    const MIB: u64 = 1024 * KIB;
    const GIB: u64 = 1024 * MIB;
    if n >= GIB {
        format!("{:.2} GB", n as f64 / GIB as f64)
    } else if n >= MIB {
        format!("{:.2} MB", n as f64 / MIB as f64)
    } else if n >= KIB {
        format!("{:.2} KB", n as f64 / KIB as f64)
    } else {
        format!("{n} B")
    }
}

fn modified_ms(meta: &std::fs::Metadata) -> u64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn decode_text(bytes: &[u8]) -> AppResult<(String, &'static str)> {
    // 1. UTF-16 BOMs first — they're unambiguous.
    if bytes.starts_with(&[0xFF, 0xFE]) {
        let (cow, _, _) = encoding_rs::UTF_16LE.decode(&bytes[2..]);
        return Ok((cow.into_owned(), "utf-16le"));
    }
    if bytes.starts_with(&[0xFE, 0xFF]) {
        let (cow, _, _) = encoding_rs::UTF_16BE.decode(&bytes[2..]);
        return Ok((cow.into_owned(), "utf-16be"));
    }
    // 2. UTF-8 with BOM.
    if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        return match std::str::from_utf8(&bytes[3..]) {
            Ok(s) => Ok((s.to_owned(), "utf-8-bom")),
            Err(_) => Err(AppError::NotUtf8(format!("{} bytes", bytes.len()))),
        };
    }
    // 3. Try plain UTF-8.
    if let Ok(s) = std::str::from_utf8(bytes) {
        return Ok((s.to_owned(), "utf-8"));
    }
    // 4. Fall back to legacy-encoding detection (chardetng covers latin1,
    //    EUC-KR, Shift_JIS, GB18030, windows-1252, …).
    let mut det = chardetng::EncodingDetector::new();
    det.feed(bytes, true);
    let enc = det.guess(None, true);
    let (cow, _, had_errors) = enc.decode(bytes);
    if had_errors {
        return Err(AppError::NotUtf8(format!(
            "could not decode {} bytes as {}",
            bytes.len(),
            enc.name()
        )));
    }
    let name: &'static str = enc.name();
    Ok((cow.into_owned(), name))
}

#[tauri::command]
pub async fn fs_read_file(
    workspace: String,
    path: String,
    options: Option<FsReadOptions>,
) -> AppResult<FsReadResult> {
    validate_input_path(&path)?;
    let target = ensure_within(Path::new(&workspace), Path::new(&path))?;
    let meta = tokio::fs::metadata(&target).await?;
    if meta.is_dir() {
        return Err(AppError::IsDirectory(path));
    }
    let size = meta.len();
    if size >= HUGE_FILE_THRESHOLD {
        return Err(AppError::Invalid(format!(
            "file too large for one-shot read ({} ≥ {} bytes); use fs_read_chunk",
            size, HUGE_FILE_THRESHOLD
        )));
    }
    let bytes = tokio::fs::read(&target).await?;
    let (content, encoding) = decode_text(&bytes)?;

    let sha256 = if options.unwrap_or_default().with_sha256 {
        let mut hasher = Sha256::new();
        hasher.update(&bytes);
        Some(hex::encode(hasher.finalize()))
    } else {
        None
    };

    Ok(FsReadResult {
        content,
        encoding: encoding.to_string(),
        mtime: modified_ms(&meta),
        sha256,
        large: size >= LARGE_FILE_THRESHOLD,
    })
}

/// Backwards-compatible wrapper kept for early dev integration.
/// Prefer `fs_read_file` which returns the full record.
#[tauri::command]
pub async fn fs_read(workspace: String, path: String) -> AppResult<String> {
    fs_read_file(workspace, path, None).await.map(|r| r.content)
}

/// Read a single chunk from a file. The frontend drives chunked loading:
/// it discovers `size` via `fs_stat`, then walks the file 64 KB at a time,
/// emitting a progress event after each call. Returning raw bytes keeps the
/// caller in control of how to assemble UTF-8 boundaries (it will typically
/// keep a small carry-over buffer between chunks).
#[tauri::command]
pub async fn fs_read_chunk(
    workspace: String,
    path: String,
    offset: u64,
    len: u64,
) -> AppResult<FsChunk> {
    validate_input_path(&path)?;
    let target = ensure_within(Path::new(&workspace), Path::new(&path))?;
    let len = len.min(MAX_CHUNK_BYTES);
    let mut f = tokio::fs::File::open(&target).await?;
    let total = f.metadata().await?.len();
    if offset > total {
        return Err(AppError::Invalid(format!(
            "offset {offset} past end of file ({total})"
        )));
    }
    f.seek(std::io::SeekFrom::Start(offset)).await?;
    let to_read = (total - offset).min(len) as usize;
    let mut buf = vec![0u8; to_read];
    f.read_exact(&mut buf).await?;
    let new_pos = offset + to_read as u64;
    Ok(FsChunk {
        bytes: buf,
        offset,
        size: total,
        eof: new_pos >= total,
    })
}

#[derive(Debug, Default, Deserialize)]
pub struct FsWriteOptions {
    /// `"utf-8"` (default) or `"utf-8-bom"` to prepend the UTF-8 BOM.
    #[serde(default)]
    pub encoding: Option<String>,
}

#[tauri::command]
pub async fn fs_write(
    workspace: String,
    path: String,
    content: String,
    options: Option<FsWriteOptions>,
) -> AppResult<()> {
    validate_input_path(&path)?;
    let target = ensure_within(Path::new(&workspace), Path::new(&path))?;
    if let Some(parent) = target.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    let tmp = target.with_extension(format!(
        "{}.tmp-{}-{}",
        target.extension().and_then(|s| s.to_str()).unwrap_or(""),
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0)
    ));
    let encoding = options
        .and_then(|o| o.encoding)
        .unwrap_or_else(|| "utf-8".to_string());
    let bytes_len = content.len() + if encoding == "utf-8-bom" { 3 } else { 0 };
    let mut buf = Vec::with_capacity(bytes_len);
    if encoding == "utf-8-bom" {
        buf.extend_from_slice(&[0xEF, 0xBB, 0xBF]);
    }
    buf.extend_from_slice(content.as_bytes());

    // Atomic write: tmp lives in same dir → same filesystem → rename(2) is atomic.
    // We fsync the file before rename and the parent dir after rename so a power
    // loss can never expose a half-written file or a dangling rename. On any
    // failure between tmp creation and rename, remove the tmp so we never leave
    // stale `.tmp-…` siblings next to the real file.
    let write_and_sync = async {
        let mut f = tokio::fs::File::create(&tmp).await?;
        f.write_all(&buf).await?;
        f.sync_all().await?;
        Ok::<_, std::io::Error>(())
    };
    if let Err(e) = write_and_sync.await {
        let _ = tokio::fs::remove_file(&tmp).await;
        return Err(map_write_io_error(e, target.parent(), buf.len() as u64));
    }
    if let Err(e) = tokio::fs::rename(&tmp, &target).await {
        let _ = tokio::fs::remove_file(&tmp).await;
        return Err(map_write_io_error(e, target.parent(), buf.len() as u64));
    }
    // POSIX: durably persist the directory entry created by rename.
    // No-op on Windows — FlushFileBuffers on the file already covered it.
    #[cfg(unix)]
    if let Some(parent) = target.parent() {
        if let Ok(dir) = tokio::fs::File::open(parent).await {
            let _ = dir.sync_all().await;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn fs_remove_file(workspace: String, path: String, force: bool) -> AppResult<()> {
    validate_input_path(&path)?;
    let target = ensure_within(Path::new(&workspace), Path::new(&path))?;
    if !force {
        // Permanent delete is destructive — the caller must explicitly opt in
        // via `force=true` after showing a confirmation dialog. Without it we
        // refuse rather than silently fall back to trash.
        return Err(AppError::Invalid(
            "permanent delete requires force=true".into(),
        ));
    }
    tokio::fs::remove_file(&target).await?;
    Ok(())
}

#[tauri::command]
pub async fn fs_copy(workspace: String, from: String, to: String) -> AppResult<u64> {
    validate_input_path(&from)?;
    validate_input_path(&to)?;
    let ws = Path::new(&workspace);
    let src = ensure_within(ws, Path::new(&from))?;
    let dst = ensure_within(ws, Path::new(&to))?;
    if let Some(parent) = dst.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    // Try a copy-on-write clone first (APFS clonefile / Linux FICLONE / btrfs
    // reflink). On unsupported filesystems fall back to a regular byte copy
    // — which itself uses copy_file_range when available. Progress events and
    // cancellation are tracked separately; this scenario covers the data path.
    let src_for_blocking = src.clone();
    let dst_for_blocking = dst.clone();
    let reflinked = tokio::task::spawn_blocking(move || {
        reflink_copy::reflink(&src_for_blocking, &dst_for_blocking).is_ok()
    })
    .await
    .unwrap_or(false);
    if reflinked {
        let meta = tokio::fs::metadata(&dst).await?;
        return Ok(meta.len());
    }
    let n = tokio::fs::copy(&src, &dst).await?;
    Ok(n)
}

/// S-FT-010: high-level move that picks atomic rename on the same filesystem
/// and falls back to copy + delete on EXDEV. The DNS layer (drag-drop UI)
/// uses this so callers don't have to inspect cross-device errors themselves.
#[tauri::command]
pub async fn fs_move(workspace: String, from: String, to: String) -> AppResult<()> {
    validate_input_path(&from)?;
    validate_input_path(&to)?;
    let ws = Path::new(&workspace);
    let src = ensure_within(ws, Path::new(&from))?;
    let dst = ensure_within(ws, Path::new(&to))?;
    // Reject self / descendant moves to prevent destroying the source.
    if dst == src || dst.starts_with(&src) {
        return Err(AppError::Invalid(
            "cannot move a path into itself or a descendant".into(),
        ));
    }
    if let Some(parent) = dst.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    match tokio::fs::rename(&src, &dst).await {
        Ok(()) => return Ok(()),
        Err(e) => {
            let xdev = match e.raw_os_error() {
                Some(c) if cfg!(windows) => c == 17,
                Some(c) => c == 18,
                None => false,
            };
            if !xdev {
                return Err(e.into());
            }
            // EXDEV: walk the source, copy, then remove. We don't bother with
            // a content checksum — the per-file copy already errors on short
            // writes, and the source is removed only after all copies succeed.
        }
    }
    let meta = tokio::fs::metadata(&src).await?;
    if meta.is_dir() {
        copy_dir_recursive(&src, &dst).await?;
        tokio::fs::remove_dir_all(&src).await?;
    } else {
        tokio::fs::copy(&src, &dst).await?;
        tokio::fs::remove_file(&src).await?;
    }
    Ok(())
}

async fn copy_dir_recursive(src: &Path, dst: &Path) -> AppResult<()> {
    tokio::fs::create_dir_all(dst).await?;
    let mut stack = vec![(src.to_path_buf(), dst.to_path_buf())];
    while let Some((s, d)) = stack.pop() {
        let mut rd = tokio::fs::read_dir(&s).await?;
        while let Some(entry) = rd.next_entry().await? {
            let ft = entry.file_type().await?;
            let from = entry.path();
            let to = d.join(entry.file_name());
            if ft.is_dir() {
                tokio::fs::create_dir_all(&to).await?;
                stack.push((from, to));
            } else if ft.is_file() {
                tokio::fs::copy(&from, &to).await?;
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn fs_rename(workspace: String, from: String, to: String) -> AppResult<()> {
    validate_input_path(&from)?;
    validate_input_path(&to)?;
    let ws = Path::new(&workspace);
    let src = ensure_within(ws, Path::new(&from))?;
    let dst = ensure_within(ws, Path::new(&to))?;
    if let Some(parent) = dst.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    if let Err(e) = tokio::fs::rename(&src, &dst).await {
        // EXDEV: caller should fall back to copy+delete. We surface a typed
        // error rather than silently doing the slow path here.
        if let Some(c) = e.raw_os_error() {
            let xdev = if cfg!(windows) { c == 17 } else { c == 18 };
            if xdev {
                return Err(AppError::CrossDevice(
                    "rename across devices not supported — use copy + delete".into(),
                ));
            }
        }
        return Err(e.into());
    }
    Ok(())
}

#[tauri::command]
pub async fn fs_remove_dir(
    workspace: String,
    path: String,
    recursive: bool,
) -> AppResult<()> {
    validate_input_path(&path)?;
    let target = ensure_within(Path::new(&workspace), Path::new(&path))?;
    if recursive {
        tokio::fs::remove_dir_all(&target).await?;
    } else {
        // remove_dir refuses non-empty directories at the OS level — surface
        // that as ENOTEMPTY rather than swallowing it.
        tokio::fs::remove_dir(&target).await?;
    }
    Ok(())
}

#[tauri::command]
pub async fn fs_trash_file(workspace: String, path: String) -> AppResult<()> {
    validate_input_path(&path)?;
    let target = ensure_within(Path::new(&workspace), Path::new(&path))?;
    // The OS trash API is a synchronous, blocking call. Run it on the blocking
    // pool so the runtime stays responsive. We do NOT fall back to permanent
    // delete on failure — surface a clear error and let the user decide.
    let target_for_blocking = target.clone();
    tokio::task::spawn_blocking(move || trash::delete(&target_for_blocking))
        .await
        .map_err(|e| AppError::Trash(format!("internal: {e}")))?
        .map_err(|e| AppError::Trash(format!("휴지통으로 이동 실패: {e}")))?;
    Ok(())
}

/// S-FT-011/012: copy from an arbitrary OS path into the workspace. Unlike
/// `fs_copy`, the source isn't required to live under the workspace root
/// (drag-imported files are anywhere in the user's filesystem). Folders are
/// copied recursively, with periodic `fs:import:progress` events so the UI
/// can show per-item file/byte counts during long imports.
#[tauri::command]
pub async fn fs_import_copy(
    app: AppHandle,
    workspace: String,
    source: String,
    dest: String,
    overwrite: bool,
    job_id: Option<String>,
) -> AppResult<()> {
    validate_input_path(&dest)?;
    let dst = ensure_within(Path::new(&workspace), Path::new(&dest))?;
    let src = Path::new(&source).to_path_buf();
    if !src.exists() {
        return Err(AppError::Invalid(format!(
            "source not found: {}",
            src.display()
        )));
    }
    if dst.exists() && !overwrite {
        return Err(AppError::Invalid("destination exists".into()));
    }
    if dst.exists() && overwrite {
        if dst.is_dir() {
            tokio::fs::remove_dir_all(&dst).await?;
        } else {
            tokio::fs::remove_file(&dst).await?;
        }
    }
    if let Some(parent) = dst.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    let meta = tokio::fs::metadata(&src).await?;
    if meta.is_dir() {
        copy_dir_recursive_progress(&app, &job_id, &src, &dst).await?;
    } else {
        let bytes = tokio::fs::copy(&src, &dst).await?;
        emit_import_progress(&app, &job_id, 1, bytes);
    }
    Ok(())
}

#[derive(Serialize, Clone)]
struct ImportProgress {
    job_id: Option<String>,
    files_done: u64,
    bytes_done: u64,
}

fn emit_import_progress(
    app: &AppHandle,
    job_id: &Option<String>,
    files_done: u64,
    bytes_done: u64,
) {
    let _ = app.emit(
        "fs:import:progress",
        ImportProgress {
            job_id: job_id.clone(),
            files_done,
            bytes_done,
        },
    );
}

async fn copy_dir_recursive_progress(
    app: &AppHandle,
    job_id: &Option<String>,
    src: &Path,
    dst: &Path,
) -> AppResult<()> {
    tokio::fs::create_dir_all(dst).await?;
    let mut stack = vec![(src.to_path_buf(), dst.to_path_buf())];
    let mut files_done: u64 = 0;
    let mut bytes_done: u64 = 0;
    let mut last_emit = std::time::Instant::now();
    while let Some((s, d)) = stack.pop() {
        let mut rd = tokio::fs::read_dir(&s).await?;
        while let Some(entry) = rd.next_entry().await? {
            let ft = entry.file_type().await?;
            let from = entry.path();
            let to = d.join(entry.file_name());
            if ft.is_dir() {
                tokio::fs::create_dir_all(&to).await?;
                stack.push((from, to));
            } else if ft.is_file() {
                let bytes = tokio::fs::copy(&from, &to).await?;
                files_done += 1;
                bytes_done += bytes;
                // Throttle to ~10 emits/sec; the renderer doesn't need finer
                // granularity and a 10K-file import would otherwise emit
                // 10K events back-to-back.
                if last_emit.elapsed().as_millis() >= 100 {
                    emit_import_progress(app, job_id, files_done, bytes_done);
                    last_emit = std::time::Instant::now();
                }
            }
        }
    }
    // Final flush so the receiver sees the terminal count even if the loop
    // ran for less than the throttle interval.
    emit_import_progress(app, job_id, files_done, bytes_done);
    Ok(())
}

/// S-FT-008: best-effort undo of a recent trash. The `trash` crate exposes
/// `os_limited::list/restore_all` on Windows and Linux only — macOS doesn't
/// expose a programmatic restore via NSWorkspace, so we surface a clear
/// "unsupported" error there instead of silently no-op'ing.
#[tauri::command]
pub async fn fs_trash_restore(workspace: String, path: String) -> AppResult<()> {
    validate_input_path(&path)?;
    let target = ensure_within(Path::new(&workspace), Path::new(&path))?;
    #[cfg(any(target_os = "windows", target_os = "linux"))]
    {
        let target_for_blocking = target.clone();
        let result: Result<(), AppError> =
            tokio::task::spawn_blocking(move || -> Result<(), AppError> {
                let items = trash::os_limited::list()
                    .map_err(|e| AppError::Trash(format!("trash list 실패: {e}")))?;
                let mut matches: Vec<_> = items
                    .into_iter()
                    .filter(|i| i.original_path() == target_for_blocking)
                    .collect();
                if matches.is_empty() {
                    return Err(AppError::Trash("휴지통 항목을 찾지 못함".into()));
                }
                // Restore the most recently trashed entry only — older copies
                // would silently clobber whatever the user replaced after the
                // trash, which would surprise them.
                matches.sort_by_key(|i| i.time_deleted);
                let latest = matches.pop().unwrap();
                trash::os_limited::restore_all([latest])
                    .map_err(|e| AppError::Trash(format!("복원 실패: {e}")))?;
                Ok(())
            })
            .await
            .map_err(|e| AppError::Trash(format!("internal: {e}")))?;
        let _ = target;
        result
    }
    #[cfg(not(any(target_os = "windows", target_os = "linux")))]
    {
        let _ = target;
        Err(AppError::Trash(
            "macOS는 트래시 자동 복원을 지원하지 않습니다".into(),
        ))
    }
}

/// S-FT-005: exclusive file creation. Returns AlreadyExists when the leaf
/// already exists, so the inline-create input can show a duplicate-name error
/// without losing the user's typed name. `fs_write` would silently overwrite.
#[tauri::command]
pub async fn fs_create_file(workspace: String, path: String) -> AppResult<()> {
    validate_input_path(&path)?;
    let target = ensure_within(Path::new(&workspace), Path::new(&path))?;
    if let Some(parent) = target.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    match tokio::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&target)
        .await
    {
        Ok(f) => {
            let _ = f.sync_all().await;
            Ok(())
        }
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
            Err(AppError::Invalid("already exists".into()))
        }
        Err(e) => Err(e.into()),
    }
}

#[tauri::command]
pub async fn fs_create_dir(workspace: String, path: String) -> AppResult<()> {
    validate_input_path(&path)?;
    let workspace_path = Path::new(&workspace);
    // Resolve via parent walk: the leaf may not exist yet.
    let target = ensure_within(workspace_path, Path::new(&path))?;
    tokio::fs::create_dir_all(&target).await?;
    Ok(())
}

#[tauri::command]
pub async fn fs_stat(workspace: String, path: String) -> AppResult<FileStat> {
    validate_input_path(&path)?;
    let workspace_path = Path::new(&workspace);
    let target = ensure_within(workspace_path, Path::new(&path))?;
    let meta = tokio::fs::metadata(&target).await?;

    // Detect symlink-ness by checking the un-canonicalized candidate. After
    // canonicalize() above we'd only ever see the dereferenced target.
    let candidate = if Path::new(&path).is_absolute() {
        Path::new(&path).to_path_buf()
    } else {
        workspace_path.join(&path)
    };
    let is_symlink = tokio::fs::symlink_metadata(&candidate)
        .await
        .map(|m| m.file_type().is_symlink())
        .unwrap_or(false);

    let kind = if is_symlink {
        "symlink"
    } else if meta.is_dir() {
        "dir"
    } else if meta.is_file() {
        "file"
    } else {
        "other"
    };

    let to_ms = |t: std::io::Result<std::time::SystemTime>| {
        t.ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as i64)
    };
    Ok(FileStat {
        path: target.display().to_string(),
        kind: kind.to_string(),
        size: meta.len(),
        is_dir: meta.is_dir(),
        is_file: meta.is_file(),
        readonly: meta.permissions().readonly(),
        modified_ms: to_ms(meta.modified()),
        created_ms: to_ms(meta.created()),
        accessed_ms: to_ms(meta.accessed()),
    })
}

#[tauri::command]
pub async fn fs_list(workspace: String, path: String) -> AppResult<Vec<DirEntry>> {
    validate_input_path(&path)?;
    let target = ensure_within(Path::new(&workspace), Path::new(&path))?;
    let mut rd = tokio::fs::read_dir(&target).await?;
    let mut out = Vec::new();
    while let Some(entry) = rd.next_entry().await? {
        let ft = entry.file_type().await?;
        out.push(DirEntry {
            name: nfc_str(&entry.file_name().to_string_lossy()),
            path: nfc_str(&entry.path().to_string_lossy()),
            is_dir: ft.is_dir(),
            size: None,
            modified_ms: None,
        });
    }
    Ok(out)
}

#[tauri::command]
pub async fn fs_list_dir(
    workspace: String,
    path: String,
    options: Option<FsListOptions>,
) -> AppResult<FsListPage> {
    validate_input_path(&path)?;
    let target = ensure_within(Path::new(&workspace), Path::new(&path))?;
    let opts = options.unwrap_or_default();
    let page = opts.page.unwrap_or(0);
    let page_size = opts.page_size.unwrap_or(1000).max(1);
    let skip = page.saturating_mul(page_size);

    let mut rd = tokio::fs::read_dir(&target).await?;
    let mut out = Vec::with_capacity(page_size);
    let mut idx = 0usize;
    let mut has_more = false;
    while let Some(entry) = rd.next_entry().await? {
        if idx < skip {
            idx += 1;
            continue;
        }
        if out.len() == page_size {
            has_more = true;
            break;
        }
        let ft = entry.file_type().await?;
        let (size, modified_ms) = if opts.include_metadata {
            let m = entry.metadata().await?;
            let mt = m
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as i64);
            (Some(m.len()), mt)
        } else {
            (None, None)
        };
        out.push(DirEntry {
            name: nfc_str(&entry.file_name().to_string_lossy()),
            path: nfc_str(&entry.path().to_string_lossy()),
            is_dir: ft.is_dir(),
            size,
            modified_ms,
        });
        idx += 1;
    }
    Ok(FsListPage {
        entries: out,
        page,
        page_size,
        has_more,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    // S-FAP-007: the BND/SEC denies that used to surface as
    // `AppError::PathEscape` now arrive as `AppError::Access(d)` with
    // `d.rule_id` ∈ {BND-OUTSIDE-WORKSPACE, SEC-SYMLINK-ESCAPE}. Tests use
    // these predicates so the assertions stay readable.
    fn is_outside_workspace_deny<T: std::fmt::Debug>(r: &AppResult<T>) -> bool {
        matches!(r, Err(AppError::Access(d))
            if d.rule_id.as_wire_str() == "BND-OUTSIDE-WORKSPACE"
                || d.rule_id.as_wire_str() == "SEC-SYMLINK-ESCAPE")
    }

    fn is_sec_deny<T: std::fmt::Debug>(r: &AppResult<T>, rule_id: &str) -> bool {
        matches!(r, Err(AppError::Access(d)) if d.rule_id.as_wire_str() == rule_id)
    }

    #[tokio::test]
    async fn fs_read_file_returns_content_and_encoding() {
        let dir = tempdir().unwrap();
        let ws = dir.path().display().to_string();
        let path = dir.path().join("hi.md");
        std::fs::write(&path, "# Hello\n").unwrap();
        let r = fs_read_file(ws, "hi.md".into(), None).await.unwrap();
        assert_eq!(r.content, "# Hello\n");
        assert_eq!(r.encoding, "utf-8");
        assert!(r.mtime > 0);
        assert!(r.sha256.is_none());
    }

    #[tokio::test]
    async fn fs_read_file_with_sha256() {
        let dir = tempdir().unwrap();
        let ws = dir.path().display().to_string();
        let path = dir.path().join("a.md");
        std::fs::write(&path, "abc").unwrap();
        let r = fs_read_file(
            ws,
            "a.md".into(),
            Some(FsReadOptions { with_sha256: true }),
        )
        .await
        .unwrap();
        assert_eq!(
            r.sha256.unwrap(),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[tokio::test]
    async fn fs_read_file_strips_utf8_bom_and_reports_encoding() {
        let dir = tempdir().unwrap();
        let ws = dir.path().display().to_string();
        let path = dir.path().join("bom.md");
        std::fs::write(&path, b"\xEF\xBB\xBFhello").unwrap();
        let r = fs_read_file(ws, "bom.md".into(), None).await.unwrap();
        assert_eq!(r.content, "hello");
        assert_eq!(r.encoding, "utf-8-bom");
    }

    #[tokio::test]
    async fn fs_write_preserves_bom_when_requested() {
        let dir = tempdir().unwrap();
        let ws = dir.path().display().to_string();
        fs_write(
            ws.clone(),
            "out.md".into(),
            "hello".into(),
            Some(FsWriteOptions {
                encoding: Some("utf-8-bom".into()),
            }),
        )
        .await
        .unwrap();
        let raw = std::fs::read(dir.path().join("out.md")).unwrap();
        assert_eq!(&raw[..3], &[0xEF, 0xBB, 0xBF]);
        assert_eq!(&raw[3..], b"hello");

        let r = fs_read_file(ws, "out.md".into(), None).await.unwrap();
        assert_eq!(r.encoding, "utf-8-bom");
        assert_eq!(r.content, "hello");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn fs_write_permission_denied_suggests_readonly() {
        use std::os::unix::fs::PermissionsExt;
        if std::env::var("USER").unwrap_or_default() == "root" {
            return; // root bypasses POSIX permission bits
        }
        let dir = tempdir().unwrap();
        let ws_path = dir.path().to_path_buf();
        // Make the workspace dir read-only so file creation fails.
        std::fs::set_permissions(&ws_path, std::fs::Permissions::from_mode(0o500)).unwrap();

        let r = fs_write(
            ws_path.display().to_string(),
            "doc.md".into(),
            "v1".into(),
            None,
        )
        .await;

        // Restore permissions so tempdir cleanup can succeed.
        let _ = std::fs::set_permissions(&ws_path, std::fs::Permissions::from_mode(0o755));

        match r {
            Err(AppError::PermissionDenied(msg)) => {
                assert!(msg.contains("저장할 권한"), "msg was: {msg}");
                assert!(msg.contains("읽기 전용"), "expected read-only suggestion: {msg}");
            }
            other => panic!("expected PermissionDenied, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn fs_read_chunk_walks_file_in_pieces() {
        let dir = tempdir().unwrap();
        let ws = dir.path().display().to_string();
        let body: Vec<u8> = (0..200).map(|i| (i % 256) as u8).collect();
        std::fs::write(dir.path().join("big.bin"), &body).unwrap();

        let mut got = Vec::new();
        let mut offset = 0u64;
        loop {
            let chunk = fs_read_chunk(ws.clone(), "big.bin".into(), offset, 64)
                .await
                .unwrap();
            got.extend_from_slice(&chunk.bytes);
            offset += chunk.bytes.len() as u64;
            if chunk.eof {
                break;
            }
        }
        assert_eq!(got, body);
    }

    #[tokio::test]
    async fn fs_read_chunk_rejects_offset_past_eof() {
        let dir = tempdir().unwrap();
        let ws = dir.path().display().to_string();
        std::fs::write(dir.path().join("a.md"), "hi").unwrap();
        let r = fs_read_chunk(ws, "a.md".into(), 999, 64).await;
        assert!(matches!(r, Err(AppError::Invalid(_))));
    }

    #[tokio::test]
    async fn fs_read_file_detects_utf16_le_bom() {
        let dir = tempdir().unwrap();
        let ws = dir.path().display().to_string();
        // UTF-16LE BOM + "hi" in UTF-16LE
        let mut bytes = vec![0xFF, 0xFE];
        bytes.extend_from_slice(&[b'h', 0, b'i', 0]);
        std::fs::write(dir.path().join("u16.md"), &bytes).unwrap();
        let r = fs_read_file(ws, "u16.md".into(), None).await.unwrap();
        assert_eq!(r.content, "hi");
        assert_eq!(r.encoding, "utf-16le");
    }

    #[tokio::test]
    async fn fs_read_file_detects_legacy_encoding() {
        let dir = tempdir().unwrap();
        let ws = dir.path().display().to_string();
        // EUC-KR encoding of a Korean paragraph — bytes are not valid UTF-8.
        // chardetng is statistical, so the fixture must be long enough for a
        // confident guess; a handful of bytes is inherently ambiguous.
        let expected = "한글 문서입니다. 마크다운 편집기 마크스프레드는 한국어 문서를 잘 지원합니다. 인코딩 자동 감지 기능을 확인하기 위한 테스트 문장입니다.";
        let euckr = b"\xc7\xd1\xb1\xdb\x20\xb9\xae\xbc\xad\xc0\xd4\xb4\xcf\xb4\xd9\x2e\x20\xb8\xb6\xc5\xa9\xb4\xd9\xbf\xee\x20\xc6\xed\xc1\xfd\xb1\xe2\x20\xb8\xb6\xc5\xa9\xbd\xba\xc7\xc1\xb7\xb9\xb5\xe5\xb4\xc2\x20\xc7\xd1\xb1\xb9\xbe\xee\x20\xb9\xae\xbc\xad\xb8\xa6\x20\xc0\xdf\x20\xc1\xf6\xbf\xf8\xc7\xd5\xb4\xcf\xb4\xd9\x2e\x20\xc0\xce\xc4\xda\xb5\xf9\x20\xc0\xda\xb5\xbf\x20\xb0\xa8\xc1\xf6\x20\xb1\xe2\xb4\xc9\xc0\xbb\x20\xc8\xae\xc0\xce\xc7\xcf\xb1\xe2\x20\xc0\xa7\xc7\xd1\x20\xc5\xd7\xbd\xba\xc6\xae\x20\xb9\xae\xc0\xe5\xc0\xd4\xb4\xcf\xb4\xd9\x2e";
        std::fs::write(dir.path().join("k.md"), euckr).unwrap();
        let r = fs_read_file(ws, "k.md".into(), None).await.unwrap();
        assert_eq!(r.content, expected);
        // chardetng will pick a Korean encoding label (EUC-KR maps to "EUC-KR").
        assert!(
            r.encoding.eq_ignore_ascii_case("EUC-KR")
                || r.encoding.eq_ignore_ascii_case("windows-949"),
            "unexpected encoding label: {}",
            r.encoding
        );
    }

    #[tokio::test]
    async fn fs_stat_classifies_file_and_dir() {
        let dir = tempdir().unwrap();
        let ws = dir.path().display().to_string();
        std::fs::write(dir.path().join("a.md"), "hi").unwrap();
        std::fs::create_dir(dir.path().join("sub")).unwrap();

        let f = fs_stat(ws.clone(), "a.md".into()).await.unwrap();
        assert_eq!(f.kind, "file");
        assert!(f.is_file);
        assert_eq!(f.size, 2);

        let d = fs_stat(ws, "sub".into()).await.unwrap();
        assert_eq!(d.kind, "dir");
        assert!(d.is_dir);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn fs_stat_reports_symlink_kind() {
        use std::os::unix::fs::symlink;
        let dir = tempdir().unwrap();
        let ws = dir.path().display().to_string();
        std::fs::write(dir.path().join("real.md"), "hi").unwrap();
        symlink(dir.path().join("real.md"), dir.path().join("link.md")).unwrap();
        let s = fs_stat(ws, "link.md".into()).await.unwrap();
        assert_eq!(s.kind, "symlink");
    }

    #[tokio::test]
    async fn fs_list_dir_paginates() {
        let dir = tempdir().unwrap();
        let ws = dir.path().display().to_string();
        for i in 0..5 {
            std::fs::write(dir.path().join(format!("f{i}.md")), "x").unwrap();
        }
        let p1 = fs_list_dir(
            ws.clone(),
            ".".into(),
            Some(FsListOptions {
                page: Some(0),
                page_size: Some(2),
                include_metadata: false,
            }),
        )
        .await
        .unwrap();
        assert_eq!(p1.entries.len(), 2);
        assert!(p1.has_more);
        assert!(p1.entries[0].size.is_none());

        let p_last = fs_list_dir(
            ws,
            ".".into(),
            Some(FsListOptions {
                page: Some(2),
                page_size: Some(2),
                include_metadata: true,
            }),
        )
        .await
        .unwrap();
        assert_eq!(p_last.entries.len(), 1);
        assert!(!p_last.has_more);
        assert_eq!(p_last.entries[0].size, Some(1));
    }

    #[tokio::test]
    async fn fs_copy_duplicates_file_contents() {
        let dir = tempdir().unwrap();
        let ws = dir.path().display().to_string();
        std::fs::write(dir.path().join("src.md"), b"hello").unwrap();
        let n = fs_copy(ws, "src.md".into(), "dst/copy.md".into()).await.unwrap();
        assert_eq!(n, 5);
        assert_eq!(std::fs::read(dir.path().join("dst/copy.md")).unwrap(), b"hello");
        assert!(dir.path().join("src.md").exists());
    }

    #[tokio::test]
    async fn fs_rename_moves_file_within_workspace() {
        let dir = tempdir().unwrap();
        let ws = dir.path().display().to_string();
        std::fs::write(dir.path().join("a.md"), "v1").unwrap();
        fs_rename(ws, "a.md".into(), "sub/b.md".into()).await.unwrap();
        assert!(!dir.path().join("a.md").exists());
        assert_eq!(std::fs::read(dir.path().join("sub/b.md")).unwrap(), b"v1");
    }

    #[tokio::test]
    async fn fs_rename_rejects_target_outside_workspace() {
        let dir = tempdir().unwrap();
        let ws = dir.path().display().to_string();
        std::fs::write(dir.path().join("a.md"), "v1").unwrap();
        let r = fs_rename(ws, "a.md".into(), "../escape.md".into()).await;
        assert!(is_outside_workspace_deny(&r), "expected BND/SEC escape: {r:?}");
    }

    #[tokio::test]
    async fn fs_remove_dir_refuses_non_empty_without_recursive() {
        let dir = tempdir().unwrap();
        let ws = dir.path().display().to_string();
        std::fs::create_dir(dir.path().join("d")).unwrap();
        std::fs::write(dir.path().join("d/x.md"), "hi").unwrap();
        let r = fs_remove_dir(ws.clone(), "d".into(), false).await;
        assert!(r.is_err());
        assert!(dir.path().join("d/x.md").exists());

        fs_remove_dir(ws, "d".into(), true).await.unwrap();
        assert!(!dir.path().join("d").exists());
    }

    #[tokio::test]
    async fn fs_remove_file_requires_force_flag() {
        let dir = tempdir().unwrap();
        let ws = dir.path().display().to_string();
        std::fs::write(dir.path().join("a.md"), "hi").unwrap();
        let r = fs_remove_file(ws.clone(), "a.md".into(), false).await;
        assert!(matches!(r, Err(AppError::Invalid(_))));
        assert!(dir.path().join("a.md").exists());

        fs_remove_file(ws, "a.md".into(), true).await.unwrap();
        assert!(!dir.path().join("a.md").exists());
    }

    #[tokio::test]
    async fn fs_create_dir_creates_nested_directories() {
        let dir = tempdir().unwrap();
        let ws = dir.path().display().to_string();
        fs_create_dir(ws, "a/b/c".into()).await.unwrap();
        assert!(dir.path().join("a/b/c").is_dir());
    }

    #[tokio::test]
    async fn fs_create_dir_idempotent() {
        let dir = tempdir().unwrap();
        let ws = dir.path().display().to_string();
        fs_create_dir(ws.clone(), "x/y".into()).await.unwrap();
        // Second call must succeed (mkdir -p semantics).
        fs_create_dir(ws, "x/y".into()).await.unwrap();
    }

    #[tokio::test]
    async fn fs_create_dir_rejects_outside_workspace() {
        let dir = tempdir().unwrap();
        let ws = dir.path().display().to_string();
        let r = fs_create_dir(ws, "../escape".into()).await;
        assert!(is_outside_workspace_deny(&r), "expected BND/SEC escape: {r:?}");
    }

    #[tokio::test]
    async fn fs_write_leaves_no_tmp_siblings_on_success() {
        let dir = tempdir().unwrap();
        let ws = dir.path().display().to_string();
        fs_write(ws, "doc.md".into(), "hello".into(), None)
            .await
            .unwrap();
        let entries: Vec<_> = std::fs::read_dir(dir.path())
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        assert!(
            !entries.iter().any(|n| n.contains(".tmp-")),
            "tmp file leaked: {entries:?}"
        );
        assert!(entries.contains(&"doc.md".to_string()));
    }

    #[tokio::test]
    async fn fs_write_preserves_original_on_invalid_path() {
        let dir = tempdir().unwrap();
        let ws = dir.path().display().to_string();
        fs_write(ws.clone(), "keep.md".into(), "v1".into(), None)
            .await
            .unwrap();
        // Path escape attempt must fail before the file is touched.
        let r = fs_write(ws, "../keep.md".into(), "v2".into(), None).await;
        assert!(r.is_err());
        let raw = std::fs::read(dir.path().join("keep.md")).unwrap();
        assert_eq!(raw, b"v1");
    }

    #[tokio::test]
    async fn fs_write_without_bom_by_default() {
        let dir = tempdir().unwrap();
        let ws = dir.path().display().to_string();
        fs_write(ws, "plain.md".into(), "hi".into(), None).await.unwrap();
        let raw = std::fs::read(dir.path().join("plain.md")).unwrap();
        assert_eq!(raw, b"hi");
    }

    #[tokio::test]
    async fn rejects_path_traversal() {
        let dir = tempdir().unwrap();
        let ws = dir.path().display().to_string();
        let r = fs_read_file(ws, "../etc/passwd".into(), None).await;
        assert!(is_outside_workspace_deny(&r), "expected BND/SEC escape: {r:?}");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn rejects_symlink_pointing_outside_workspace() {
        use std::os::unix::fs::symlink;
        let outside = tempdir().unwrap();
        std::fs::write(outside.path().join("secret.md"), "shh").unwrap();

        let ws = tempdir().unwrap();
        symlink(outside.path().join("secret.md"), ws.path().join("link.md")).unwrap();

        let r = fs_read_file(
            ws.path().display().to_string(),
            "link.md".into(),
            None,
        )
        .await;
        assert!(is_outside_workspace_deny(&r), "expected BND/SEC escape: {r:?}");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn allows_symlink_pointing_inside_workspace() {
        use std::os::unix::fs::symlink;
        let ws = tempdir().unwrap();
        std::fs::write(ws.path().join("real.md"), "hello").unwrap();
        symlink(ws.path().join("real.md"), ws.path().join("alias.md")).unwrap();

        let r = fs_read_file(
            ws.path().display().to_string(),
            "alias.md".into(),
            None,
        )
        .await
        .unwrap();
        assert_eq!(r.content, "hello");
    }

    #[tokio::test]
    async fn rejects_url_encoded_traversal() {
        let dir = tempdir().unwrap();
        let ws = dir.path().display().to_string();
        let r = fs_read_file(ws, "%2e%2e/etc/passwd".into(), None).await;
        assert!(is_sec_deny(&r, "SEC-PATH-TRAVERSAL"), "got {r:?}");
    }

    #[tokio::test]
    async fn rejects_null_byte_in_path() {
        let dir = tempdir().unwrap();
        let ws = dir.path().display().to_string();
        let r = fs_read_file(ws, "evil\0.md".into(), None).await;
        assert!(is_sec_deny(&r, "SEC-NULL-BYTE"), "got {r:?}");
    }

    #[tokio::test]
    async fn rejects_multiple_dotdot() {
        let dir = tempdir().unwrap();
        let ws = dir.path().display().to_string();
        let r = fs_read_file(ws, "../../../etc/passwd".into(), None).await;
        assert!(is_outside_workspace_deny(&r), "expected BND/SEC escape: {r:?}");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn maps_permission_denied_to_eacces() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempdir().unwrap();
        let ws = dir.path().display().to_string();
        let path = dir.path().join("locked.md");
        std::fs::write(&path, "secret").unwrap();
        // Remove all permissions on the file.
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o000)).unwrap();

        let r = fs_read_file(ws, "locked.md".into(), None).await;

        // Restore so tempdir cleanup can succeed.
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644));

        // Root bypasses permission checks; skip the assertion in that case.
        if std::env::var("USER").unwrap_or_default() == "root" {
            return;
        }
        match r {
            Err(AppError::PermissionDenied(msg)) => {
                assert!(msg.contains("권한이 없습니다"), "msg was: {msg}");
            }
            other => panic!("expected PermissionDenied, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn rejects_absolute_path_outside_workspace() {
        let dir = tempdir().unwrap();
        let ws = dir.path().display().to_string();
        let r = fs_read_file(ws, "/etc/hosts".into(), None).await;
        assert!(is_outside_workspace_deny(&r), "expected BND/SEC escape: {r:?}");
        if let Err(e) = r {
            assert_eq!(e.code(), "EOUTSIDE_WORKSPACE");
        }
    }

    /// S-WS-005: paths with embedded whitespace must round-trip through IPC
    /// without any quoting. We never shell out, so the only failure mode is
    /// our own validators or PathBuf handling — guard both here.
    #[tokio::test]
    async fn fs_read_file_handles_paths_with_spaces() {
        let dir = tempdir().unwrap();
        let sub = dir.path().join("My Documents").join("Project A");
        std::fs::create_dir_all(&sub).unwrap();
        std::fs::write(sub.join("note book.md"), "ok").unwrap();
        let ws = dir.path().display().to_string();
        let r = fs_read_file(
            ws,
            "My Documents/Project A/note book.md".into(),
            None,
        )
        .await
        .unwrap();
        assert_eq!(r.content, "ok");
    }
}
