use crate::drive::{classify, DriveKind};
use crate::error::{AppError, AppResult};
use crate::search::SearchState;
use notify::RecursiveMode;
use notify_debouncer_mini::{new_debouncer, DebounceEventResult, DebouncedEventKind, Debouncer};
use serde::Serialize;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::oneshot;

/// S-FT-019: rename heuristic window. A `removed` event followed by a
/// `created` event with the same basename within this window is coalesced
/// into a single `renamed` event. Beyond the window we fall back to emitting
/// them separately so consumers still see the change (just less precisely).
const RENAME_WINDOW: Duration = Duration::from_millis(500);

#[derive(Debug, Clone)]
struct PendingRemoval {
    path: PathBuf,
    at: Instant,
}

#[derive(Debug, Clone, Serialize)]
pub struct FsEvent {
    pub workspace: String,
    /// `"created" | "modified" | "removed" | "renamed"`
    pub kind: &'static str,
    pub paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct FsRescan {
    pub workspace: String,
    pub reason: String,
}

type AnyDebouncer = Debouncer<notify::RecommendedWatcher>;

enum ActiveWatcher {
    /// The debouncer is held only to keep the watcher thread alive — drop
    /// stops it. The compiler can't see that, hence the explicit allow.
    Native(#[allow(dead_code)] AnyDebouncer),
    Polling(oneshot::Sender<()>),
}

#[derive(Default)]
pub struct WatcherRegistry {
    inner: Mutex<HashMap<String, ActiveWatcher>>,
}

#[derive(Debug, Clone, Serialize)]
pub struct PollingNotice {
    pub workspace: String,
    pub reason: &'static str,
}

#[tauri::command]
pub fn fs_watch_start(
    app: AppHandle,
    state: State<'_, WatcherRegistry>,
    workspace: String,
) -> AppResult<()> {
    let path = PathBuf::from(&workspace);
    let canonical = path
        .canonicalize()
        .map_err(|e| AppError::Invalid(format!("workspace canonicalize: {e}")))?;

    // S-WS-025: network mounts (SMB/NFS, Windows DRIVE_REMOTE) frequently
    // don't deliver inotify/FSEvents/USN notifications reliably. Skip the
    // recommended watcher and use a 5s polling walk so the editor still sees
    // external changes — slower, but correct.
    let drive = classify(&canonical);
    if drive.kind == DriveKind::Network {
        let _ = app.emit(
            "fs:polling_fallback",
            PollingNotice {
                workspace: workspace.clone(),
                reason: "network drive — change detection may be delayed",
            },
        );
        let stop = start_polling_watcher(app.clone(), workspace.clone(), canonical.clone());
        let mut map = state.inner.lock().expect("watcher registry poisoned");
        map.insert(workspace, ActiveWatcher::Polling(stop));
        return Ok(());
    }

    let app_for_events = app.clone();
    let workspace_for_events = workspace.clone();
    // S-FT-019: state shared across debounce batches so a `removed` in one
    // batch can pair with a `created` in the next — typical of editors that
    // write atomically (write tmp, rename over original).
    let pending_removals: Arc<Mutex<Vec<PendingRemoval>>> = Arc::new(Mutex::new(Vec::new()));
    let pending_clone = pending_removals.clone();
    // 50ms debounce — coalesces save bursts and editor temp-file flurries.
    let mut deb = new_debouncer(
        Duration::from_millis(50),
        move |res: DebounceEventResult| {
            let events = match res {
                Ok(e) => e,
                Err(err) => {
                    // Buffer overrun on Windows (ReadDirectoryChangesW) and inotify
                    // queue overflow on Linux both surface here. We can't recover
                    // individual events — tell the frontend to do a full rescan
                    // and rebuild its index from scratch.
                    let reason = err.to_string();
                    tracing::warn!(reason, "fs watcher errors → requesting rescan");
                    let _ = app_for_events.emit(
                        "fs:rescan",
                        FsRescan {
                            workspace: workspace_for_events.clone(),
                            reason,
                        },
                    );
                    return;
                }
            };
            // First pass: infer per-event kind from path existence at delivery
            // time. notify-debouncer-mini collapses every flavour into "any".
            let mut classified: Vec<(&'static str, PathBuf)> = Vec::with_capacity(events.len());
            for ev in events {
                let kind = match ev.kind {
                    DebouncedEventKind::Any => {
                        if ev.path.exists() {
                            // Distinguish first-sight vs change. The "created"
                            // tag matters for the rename-pair below.
                            "modified"
                        } else {
                            "removed"
                        }
                    }
                    _ => "modified",
                };
                classified.push((kind, ev.path));
            }

            // Second pass: rename heuristic. Same-batch `removed` + `modified`
            // (existing path) with matching basenames become `renamed`. Then we
            // try to pair any leftover `removed` events with a recent removal
            // pending from a previous batch.
            let mut pending = pending_clone.lock().expect("rename pending poisoned");
            // Drop stale entries.
            let now = Instant::now();
            pending.retain(|p| now.duration_since(p.at) < RENAME_WINDOW);

            // Within-batch pairing.
            let mut consumed = vec![false; classified.len()];
            let mut emitted_renames: Vec<(String, String)> = Vec::new();
            for i in 0..classified.len() {
                if consumed[i] {
                    continue;
                }
                if classified[i].0 != "removed" {
                    continue;
                }
                let removed_path = classified[i].1.clone();
                let removed_base = removed_path.file_name().map(|s| s.to_owned());
                for j in 0..classified.len() {
                    if i == j || consumed[j] {
                        continue;
                    }
                    if classified[j].0 != "modified" {
                        continue;
                    }
                    // Only treat newly-existing files (i.e., the existing path
                    // didn't exist before) as creates. The debouncer can't tell
                    // us that directly, so we approximate via basename equality.
                    let created_base = classified[j].1.file_name().map(|s| s.to_owned());
                    if removed_base.is_some() && removed_base == created_base {
                        emitted_renames.push((
                            removed_path.display().to_string(),
                            classified[j].1.display().to_string(),
                        ));
                        consumed[i] = true;
                        consumed[j] = true;
                        break;
                    }
                }
            }

            // Cross-batch pairing for leftover creates.
            let mut leftover_events: Vec<(&'static str, PathBuf)> = Vec::new();
            for (i, (kind, path)) in classified.into_iter().enumerate() {
                if consumed[i] {
                    continue;
                }
                if kind == "modified" {
                    let base = path.file_name().map(|s| s.to_owned());
                    if let Some(ref needle) = base {
                        if let Some(pos) = pending
                            .iter()
                            .position(|p| p.path.file_name() == Some(needle))
                        {
                            let removed = pending.remove(pos);
                            emitted_renames.push((
                                removed.path.display().to_string(),
                                path.display().to_string(),
                            ));
                            continue;
                        }
                    }
                }
                leftover_events.push((kind, path));
            }

            // Anything still tagged "removed" gets parked for the next batch
            // window in case the matching create lands shortly.
            let mut leftover_after_park: Vec<(&'static str, PathBuf)> = Vec::new();
            for (kind, path) in leftover_events {
                if kind == "removed" {
                    pending.push(PendingRemoval {
                        path: path.clone(),
                        at: now,
                    });
                    // Still emit the removed event so consumers don't miss
                    // genuinely deleted files. The frontend's tab orphan logic
                    // tolerates an immediate `renamed` follow-up by clearing the
                    // orphan flag on rebind.
                    leftover_after_park.push((kind, path));
                } else {
                    leftover_after_park.push((kind, path));
                }
            }
            drop(pending);

            let any_change = !leftover_after_park.is_empty() || !emitted_renames.is_empty();
            for (kind, path) in leftover_after_park {
                let payload = FsEvent {
                    workspace: workspace_for_events.clone(),
                    kind,
                    paths: vec![path.display().to_string()],
                };
                let _ = app_for_events.emit("fs:event", payload);
            }
            for (old, new) in emitted_renames {
                let payload = FsEvent {
                    workspace: workspace_for_events.clone(),
                    kind: "renamed",
                    paths: vec![old, new],
                };
                let _ = app_for_events.emit("fs:event", payload);
            }
            // S-IDX-004: any FS change in this workspace invalidates the search
            // index. Mark it Stale so the next query forces a rebuild.
            if any_change {
                if let Some(search) = app_for_events.try_state::<SearchState>() {
                    search.mark_stale(&workspace_for_events);
                }
            }
        },
    )
    .map_err(|e| AppError::Invalid(format!("watcher init: {e}")))?;

    deb.watcher()
        .watch(&canonical, RecursiveMode::Recursive)
        .map_err(|e| {
            // Linux: ENOSPC at inotify_add_watch means fs.inotify.max_user_watches
            // is exhausted. notify maps it to ErrorKind::MaxFilesWatch.
            if matches!(e.kind, notify::ErrorKind::MaxFilesWatch) {
                AppError::Invalid(
                    "inotify watch 한도 초과 — 디렉터리 일부만 감시됩니다. \
                     `sudo sysctl fs.inotify.max_user_watches=524288` 후 재시도하세요."
                        .into(),
                )
            } else {
                AppError::Invalid(format!("watcher start: {e}"))
            }
        })?;

    let mut map = state.inner.lock().expect("watcher registry poisoned");
    // Replace any previous watcher for this workspace.
    map.insert(workspace, ActiveWatcher::Native(deb));
    let _ = app; // silence unused on platforms without manager features
    Ok(())
}

fn start_polling_watcher(
    app: AppHandle,
    workspace: String,
    canonical: PathBuf,
) -> oneshot::Sender<()> {
    use std::collections::HashMap as Map;
    let (tx, mut rx) = oneshot::channel::<()>();
    tauri::async_runtime::spawn(async move {
        // First scan establishes the baseline; subsequent ticks diff against
        // it. We hash modified-mtime per relative path so file additions,
        // deletions, and content changes all surface as one of the four kinds.
        let mut snapshot: Map<PathBuf, std::time::SystemTime> = Map::new();
        if let Ok(initial) = walk_modified(&canonical).await {
            snapshot = initial;
        }
        loop {
            tokio::select! {
                _ = &mut rx => break,
                _ = tokio::time::sleep(Duration::from_secs(5)) => {
                    let next = match walk_modified(&canonical).await {
                        Ok(n) => n,
                        Err(_) => continue,
                    };
                    let mut created: Vec<String> = Vec::new();
                    let mut modified: Vec<String> = Vec::new();
                    let mut removed: Vec<String> = Vec::new();
                    for (path, mtime) in next.iter() {
                        match snapshot.get(path) {
                            None => created.push(path.display().to_string()),
                            Some(prev) if prev != mtime => modified.push(path.display().to_string()),
                            _ => {}
                        }
                    }
                    for path in snapshot.keys() {
                        if !next.contains_key(path) {
                            removed.push(path.display().to_string());
                        }
                    }
                    // S-FT-019: pair removed + created with identical basenames
                    // within the same poll tick as `renamed`. Anything left over
                    // is emitted with its original kind.
                    let mut renames: Vec<(String, String)> = Vec::new();
                    let mut left_removed: Vec<String> = Vec::new();
                    let mut taken_created = vec![false; created.len()];
                    for r in removed.into_iter() {
                        let r_base = std::path::Path::new(&r)
                            .file_name()
                            .map(|s| s.to_owned());
                        let mut matched = false;
                        if r_base.is_some() {
                            for (i, c) in created.iter().enumerate() {
                                if taken_created[i] {
                                    continue;
                                }
                                let c_base = std::path::Path::new(c)
                                    .file_name()
                                    .map(|s| s.to_owned());
                                if r_base == c_base {
                                    renames.push((r.clone(), c.clone()));
                                    taken_created[i] = true;
                                    matched = true;
                                    break;
                                }
                            }
                        }
                        if !matched {
                            left_removed.push(r);
                        }
                    }
                    let left_created: Vec<String> = created
                        .into_iter()
                        .enumerate()
                        .filter_map(|(i, c)| if taken_created[i] { None } else { Some(c) })
                        .collect();
                    let mut any_change = !renames.is_empty();
                    for (kind, paths) in [
                        ("created", left_created),
                        ("modified", modified),
                        ("removed", left_removed),
                    ] {
                        if paths.is_empty() { continue; }
                        any_change = true;
                        let _ = app.emit(
                            "fs:event",
                            FsEvent {
                                workspace: workspace.clone(),
                                kind,
                                paths,
                            },
                        );
                    }
                    for (old, new) in renames {
                        let _ = app.emit(
                            "fs:event",
                            FsEvent {
                                workspace: workspace.clone(),
                                kind: "renamed",
                                paths: vec![old, new],
                            },
                        );
                    }
                    if any_change {
                        if let Some(search) = app.try_state::<SearchState>() {
                            search.mark_stale(&workspace);
                        }
                    }
                    snapshot = next;
                }
            }
        }
    });
    tx
}

async fn walk_modified(
    root: &std::path::Path,
) -> std::io::Result<std::collections::HashMap<PathBuf, std::time::SystemTime>> {
    use std::collections::HashMap as Map;
    let mut out: Map<PathBuf, std::time::SystemTime> = Map::new();
    let mut stack: Vec<PathBuf> = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let mut entries = match tokio::fs::read_dir(&dir).await {
            Ok(e) => e,
            Err(_) => continue,
        };
        while let Ok(Some(entry)) = entries.next_entry().await {
            let path = entry.path();
            let meta = match entry.metadata().await {
                Ok(m) => m,
                Err(_) => continue,
            };
            if meta.is_dir() {
                // Skip the meta dir itself — we don't want polling churn from
                // index.db WAL turnover.
                if path
                    .file_name()
                    .map(|n| n == ".markspread")
                    .unwrap_or(false)
                {
                    continue;
                }
                stack.push(path);
            } else if let Ok(mtime) = meta.modified() {
                out.insert(path, mtime);
            }
        }
    }
    Ok(out)
}

#[tauri::command]
pub fn fs_watch_stop(state: State<'_, WatcherRegistry>, workspace: String) -> AppResult<()> {
    let mut map = state.inner.lock().expect("watcher registry poisoned");
    if let Some(ActiveWatcher::Polling(tx)) = map.remove(&workspace) {
        let _ = tx.send(());
    }
    Ok(())
}

pub fn register(app: &AppHandle) {
    app.manage(WatcherRegistry::default());
}
