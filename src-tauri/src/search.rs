use crate::error::{AppError, AppResult};
use ignore::WalkBuilder;
use rusqlite::{params, Connection};
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};

/// Skip files larger than this when indexing — they're almost certainly not
/// prose-style documents and would blow the per-call budget.
const MAX_INDEXED_FILE_BYTES: u64 = 1024 * 1024;

#[derive(Debug, Clone, Serialize)]
pub struct SearchHit {
    pub path: String,
    pub line_no: u32,
    pub snippet: String,
}

/// Status of a workspace index. Search remains usable in `Stale` and
/// `Rebuilding` states (just against possibly out-of-date data) — callers can
/// surface a banner via `fs_index_status`.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum IndexState {
    Empty,
    Rebuilding,
    Ready,
    Stale,
}

pub struct WorkspaceIndex {
    pub conn: Connection,
    pub state: IndexState,
    pub indexed_lines: u64,
    pub indexed_files: u64,
    pub last_built_ms: i64,
}

#[derive(Default)]
pub struct SearchState {
    inner: Mutex<HashMap<String, WorkspaceIndex>>,
}

impl SearchState {
    /// S-OP-002: drop the in-memory FTS for a workspace so the next
    /// query forces a fresh rebuild. Returns true if there was an
    /// entry to drop.
    pub fn forget(&self, workspace: &str) -> bool {
        let mut map = self.inner.lock().expect("search state poisoned");
        map.remove(workspace).is_some()
    }

    /// Mark a workspace's index as Stale so the next query rebuilds it.
    /// Called from the FS watcher on debounced change events. Returns true
    /// if there was a Ready index to invalidate.
    pub fn mark_stale(&self, workspace: &str) -> bool {
        let mut map = self.inner.lock().expect("search state poisoned");
        match map.get_mut(workspace) {
            Some(entry) if entry.state == IndexState::Ready => {
                entry.state = IndexState::Stale;
                true
            }
            _ => false,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct IndexProgress {
    pub workspace: String,
    pub files_seen: u64,
    pub bytes_seen: u64,
    pub state: IndexState,
}

#[derive(Debug, Clone, Serialize)]
pub struct IndexStatus {
    pub workspace: String,
    pub state: IndexState,
    pub indexed_files: u64,
    pub indexed_lines: u64,
    pub last_built_ms: i64,
}

/// S-WS-016: WAL + busy timeout pragmas applied to any persistent index.db
/// connection so multiple windows (and the watcher rebuild thread) can share
/// the file without serializing readers behind the writer. In-memory FTS
/// connections don't need this — but keep the helper colocated so the
/// persistence migration is a one-line swap.
fn apply_shared_pragmas(conn: &Connection) -> AppResult<()> {
    conn.pragma_update(None, "journal_mode", "WAL")
        .map_err(|e| AppError::Invalid(format!("WAL: {e}")))?;
    conn.pragma_update(None, "busy_timeout", 5000_i64)
        .map_err(|e| AppError::Invalid(format!("busy_timeout: {e}")))?;
    conn.pragma_update(None, "synchronous", "NORMAL")
        .map_err(|e| AppError::Invalid(format!("synchronous: {e}")))?;
    Ok(())
}

fn open_in_memory_fts() -> AppResult<Connection> {
    let conn = Connection::open_in_memory()
        .map_err(|e| AppError::Invalid(format!("sqlite open: {e}")))?;
    conn.execute_batch(
        "CREATE VIRTUAL TABLE docs USING fts5(
            path UNINDEXED,
            line_no UNINDEXED,
            line,
            tokenize = 'unicode61 remove_diacritics 2'
         );",
    )
    .map_err(|e| AppError::Invalid(format!("fts5 schema: {e}")))?;
    Ok(conn)
}

#[allow(dead_code)] // wired up when search swaps to file-backed index.db
pub fn open_workspace_index(path: &Path) -> AppResult<Connection> {
    let conn =
        Connection::open(path).map_err(|e| AppError::Invalid(format!("sqlite open: {e}")))?;
    apply_shared_pragmas(&conn)?;
    Ok(conn)
}

struct IndexStats {
    files: u64,
    lines: u64,
}

fn index_workspace<F>(
    conn: &Connection,
    workspace: &Path,
    mut on_progress: F,
) -> AppResult<IndexStats>
where
    F: FnMut(u64, u64),
{
    let mut stmt = conn
        .prepare("INSERT INTO docs(path, line_no, line) VALUES (?1, ?2, ?3)")
        .map_err(|e| AppError::Invalid(format!("prepare: {e}")))?;
    let mut files = 0u64;
    let mut lines = 0u64;
    let mut bytes_seen = 0u64;
    let walker = WalkBuilder::new(workspace)
        .hidden(false)
        .git_ignore(true)
        .git_exclude(true)
        .git_global(false)
        .build();
    for dent in walker.flatten() {
        let path = dent.path();
        if !dent.file_type().map(|t| t.is_file()).unwrap_or(false) {
            continue;
        }
        let meta = match std::fs::metadata(path) {
            Ok(m) => m,
            Err(_) => continue,
        };
        if meta.len() > MAX_INDEXED_FILE_BYTES {
            continue;
        }
        let bytes = match std::fs::read(path) {
            Ok(b) => b,
            Err(_) => continue,
        };
        let text = match std::str::from_utf8(&bytes) {
            Ok(s) => s,
            Err(_) => continue,
        };
        let rel = path.strip_prefix(workspace).unwrap_or(path);
        let rel_str = rel.display().to_string();
        for (i, line) in text.lines().enumerate() {
            stmt.execute(params![rel_str, (i + 1) as i64, line])
                .map_err(|e| AppError::Invalid(format!("insert: {e}")))?;
            lines += 1;
        }
        files += 1;
        bytes_seen += bytes.len() as u64;
        // Throttle progress: every 32 files.
        if files % 32 == 0 {
            on_progress(files, bytes_seen);
        }
    }
    on_progress(files, bytes_seen);
    Ok(IndexStats { files, lines })
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn ensure_indexed(
    state: &SearchState,
    workspace: &str,
    workspace_path: &Path,
    app: Option<&AppHandle>,
) -> AppResult<()> {
    {
        let map = state.inner.lock().expect("search state poisoned");
        if let Some(entry) = map.get(workspace) {
            // Ready ⇒ no work. Stale ⇒ usable but rebuild now (watcher saw
            // changes since last build). Empty/Rebuilding fall through.
            if entry.state == IndexState::Ready {
                return Ok(());
            }
        }
    }
    rebuild_index(state, workspace, workspace_path, app)
}

fn rebuild_index(
    state: &SearchState,
    workspace: &str,
    workspace_path: &Path,
    app: Option<&AppHandle>,
) -> AppResult<()> {
    {
        let mut map = state.inner.lock().expect("search state poisoned");
        if let Some(entry) = map.get_mut(workspace) {
            entry.state = IndexState::Rebuilding;
        }
    }
    if let Some(a) = app {
        let _ = a.emit(
            "fs:index:progress",
            IndexProgress {
                workspace: workspace.to_string(),
                files_seen: 0,
                bytes_seen: 0,
                state: IndexState::Rebuilding,
            },
        );
    }
    let conn = open_in_memory_fts()?;
    let workspace_owned = workspace.to_string();
    let app_clone = app.cloned();
    let stats = index_workspace(&conn, workspace_path, |files, bytes| {
        if let Some(a) = &app_clone {
            let _ = a.emit(
                "fs:index:progress",
                IndexProgress {
                    workspace: workspace_owned.clone(),
                    files_seen: files,
                    bytes_seen: bytes,
                    state: IndexState::Rebuilding,
                },
            );
        }
    })?;
    let mut map = state.inner.lock().expect("search state poisoned");
    map.insert(
        workspace.to_string(),
        WorkspaceIndex {
            conn,
            state: IndexState::Ready,
            indexed_lines: stats.lines,
            indexed_files: stats.files,
            last_built_ms: now_ms(),
        },
    );
    if let Some(a) = app {
        let _ = a.emit(
            "fs:index:done",
            IndexProgress {
                workspace: workspace.to_string(),
                files_seen: stats.files,
                bytes_seen: 0,
                state: IndexState::Ready,
            },
        );
    }
    Ok(())
}

#[tauri::command]
pub async fn fs_search(
    state: State<'_, SearchState>,
    workspace: String,
    query: String,
    limit: Option<u32>,
) -> AppResult<Vec<SearchHit>> {
    if query.trim().is_empty() {
        return Ok(vec![]);
    }
    let limit = limit.unwrap_or(200).min(2000) as i64;
    let workspace_path = PathBuf::from(&workspace)
        .canonicalize()
        .map_err(|e| AppError::Invalid(format!("workspace canonicalize: {e}")))?;

    ensure_indexed(&state, &workspace, &workspace_path, None)?;

    let map = state.inner.lock().expect("search state poisoned");
    let entry = map
        .get(&workspace)
        .ok_or_else(|| AppError::Invalid("index missing".into()))?;
    let mut stmt = entry
        .conn
        .prepare(
            "SELECT path, line_no, snippet(docs, 2, '<mark>', '</mark>', '…', 16) \
             FROM docs WHERE docs MATCH ?1 ORDER BY rank LIMIT ?2",
        )
        .map_err(|e| AppError::Invalid(format!("prepare search: {e}")))?;
    let rows = stmt
        .query_map(params![&query, limit], |row| {
            Ok(SearchHit {
                path: crate::path_norm::nfc_str(&row.get::<_, String>(0)?),
                line_no: row.get::<_, i64>(1)? as u32,
                snippet: row.get::<_, String>(2)?,
            })
        })
        .map_err(|e| AppError::Invalid(format!("search: {e}")))?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| AppError::Invalid(format!("row: {e}")))?);
    }
    Ok(out)
}

#[tauri::command]
pub async fn fs_index_status(
    state: State<'_, SearchState>,
    workspace: String,
) -> AppResult<IndexStatus> {
    let map = state.inner.lock().expect("search state poisoned");
    Ok(match map.get(&workspace) {
        Some(e) => IndexStatus {
            workspace,
            state: e.state,
            indexed_files: e.indexed_files,
            indexed_lines: e.indexed_lines,
            last_built_ms: e.last_built_ms,
        },
        None => IndexStatus {
            workspace,
            state: IndexState::Empty,
            indexed_files: 0,
            indexed_lines: 0,
            last_built_ms: 0,
        },
    })
}

#[tauri::command]
pub async fn fs_index_rebuild(
    app: AppHandle,
    state: State<'_, SearchState>,
    workspace: String,
) -> AppResult<()> {
    let workspace_path = PathBuf::from(&workspace)
        .canonicalize()
        .map_err(|e| AppError::Invalid(format!("workspace canonicalize: {e}")))?;
    rebuild_index(&state, &workspace, &workspace_path, Some(&app))?;
    Ok(())
}

pub fn register(app: &AppHandle) {
    app.manage(SearchState::default());
}
