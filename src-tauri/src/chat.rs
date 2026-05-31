// Chat session persistence backing the `chat-sessions` Zustand store
// (ADR-0010 D2/D5). The front-end calls three Tauri commands:
//
//   - `chat_session_save`     → upsert a session as JSON.
//   - `chat_session_delete`   → remove a session file (best-effort).
//   - `chat_session_list`     → load every session under a workspace.
//
// On-disk layout:
//
//   <data_root>/chat/<workspace_id>/<session_id>.json
//
// `<data_root>` is `$MARKSPREAD_HOME` when set, otherwise the portable
// override directory, otherwise the OS-local appdata dir joined with
// "markspread" — matching `ops::data_dir()` so chat sessions live next
// to the rest of the app's persisted state.
//
// `<workspace_id>` is the front-end's stable hash of the workspace path
// (`workspaceIdFor`), so the backend never has to resolve hashes back
// to filesystem paths. Sessions are scoped to the workspace they were
// created in via the `workspaceId` field on the serialized session.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::error::AppError;
use crate::portable;

/// Top-level chat data directory: `<data_root>/chat`. Resolution order:
///
/// 1. `MARKSPREAD_HOME` env var (joined with `chat`) — matches the
///    convention documented in the defect spec and gives tests a clean
///    override hook.
/// 2. Portable data override (`<exe-dir>/markspread-data`).
/// 3. OS data-local dir + `markspread`.
fn chat_root() -> Result<PathBuf, AppError> {
    if let Some(home) = std::env::var_os("MARKSPREAD_HOME") {
        return Ok(PathBuf::from(home).join("chat"));
    }
    if let Some(over) = portable::data_dir_override() {
        return Ok(over.join("chat"));
    }
    dirs::data_local_dir()
        .map(|p| p.join("markspread").join("chat"))
        .ok_or_else(|| AppError::Invalid("could not resolve OS data dir".into()))
}

/// `<chat_root>/<workspace_id>`. We sanitize the id so a hostile
/// front-end can't escape via `..` even though the production id is a
/// base36 hash with no path separators.
fn workspace_dir(workspace_id: &str) -> Result<PathBuf, AppError> {
    let id = sanitize_id(workspace_id)?;
    Ok(chat_root()?.join(id))
}

fn session_path(workspace_id: &str, session_id: &str) -> Result<PathBuf, AppError> {
    let sid = sanitize_id(session_id)?;
    Ok(workspace_dir(workspace_id)?.join(format!("{sid}.json")))
}

/// Reject empty ids and anything that contains path separators or
/// `..` segments. Production ids are short base36 / uuid-slice strings,
/// so this only catches injection attempts.
fn sanitize_id(id: &str) -> Result<&str, AppError> {
    if id.is_empty() {
        return Err(AppError::Invalid("chat session id is empty".into()));
    }
    if id.contains('/') || id.contains('\\') || id.contains("..") {
        return Err(AppError::Invalid(format!(
            "chat session id contains illegal path chars: {id}"
        )));
    }
    Ok(id)
}

/// Serializable mirror of `ChatSession` in `src/store/chat-sessions.ts`.
/// We use `serde(rename_all = "camelCase")` so the front-end can pass
/// the object verbatim and read it back without conversion.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatSession {
    pub id: String,
    pub workspace_id: String,
    pub title: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub messages: Vec<ChatMessage>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    pub id: String,
    pub role: String,
    pub content: String,
    pub created_at: i64,
}

#[tauri::command]
pub async fn chat_session_save(session: ChatSession) -> Result<(), AppError> {
    // Validate ids before touching the filesystem so a bad payload fails
    // fast and never creates an orphan workspace folder.
    sanitize_id(&session.workspace_id)?;
    sanitize_id(&session.id)?;
    let dir = workspace_dir(&session.workspace_id)?;
    let path = session_path(&session.workspace_id, &session.id)?;
    let json = serde_json::to_vec_pretty(&session)
        .map_err(|e| AppError::Invalid(format!("chat session serialize: {e}")))?;
    tokio::task::spawn_blocking(move || -> Result<(), AppError> {
        std::fs::create_dir_all(&dir).map_err(AppError::Io)?;
        // Write to a temp file and rename so a crash mid-write can't
        // leave a half-serialized JSON behind that would fail to load
        // on the next launch.
        let tmp = path.with_extension("json.tmp");
        std::fs::write(&tmp, &json).map_err(AppError::Io)?;
        std::fs::rename(&tmp, &path).map_err(AppError::Io)?;
        Ok(())
    })
    .await
    .map_err(|e| AppError::Invalid(format!("chat session save join: {e}")))??;
    Ok(())
}

#[tauri::command]
pub async fn chat_session_delete(session_id: String) -> Result<(), AppError> {
    // The front-end does not know which workspace a session belongs to
    // at delete time (the store has already dropped the session record
    // before invoking us). Sweep every workspace folder under the chat
    // root and remove the matching file — there is at most one match
    // because session ids are globally unique.
    sanitize_id(&session_id)?;
    let root = chat_root()?;
    let needle = format!("{session_id}.json");
    tokio::task::spawn_blocking(move || -> Result<(), AppError> {
        if !root.exists() {
            return Ok(());
        }
        let entries = std::fs::read_dir(&root).map_err(AppError::Io)?;
        for entry in entries.flatten() {
            let ws_dir = entry.path();
            if !ws_dir.is_dir() {
                continue;
            }
            let candidate = ws_dir.join(&needle);
            if candidate.exists() {
                // Best-effort: ignore ENOENT (race with another deleter)
                // and surface any other I/O error so the front-end can
                // log it. We intentionally do not stop after the first
                // hit — if a duplicate ever exists, both should go.
                match std::fs::remove_file(&candidate) {
                    Ok(()) => {}
                    Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                    Err(e) => return Err(AppError::Io(e)),
                }
            }
        }
        Ok(())
    })
    .await
    .map_err(|e| AppError::Invalid(format!("chat session delete join: {e}")))??;
    Ok(())
}

#[tauri::command]
pub async fn chat_session_list(workspace_id: String) -> Result<Vec<ChatSession>, AppError> {
    sanitize_id(&workspace_id)?;
    let dir = workspace_dir(&workspace_id)?;
    tokio::task::spawn_blocking(move || -> Result<Vec<ChatSession>, AppError> {
        if !dir.exists() {
            return Ok(Vec::new());
        }
        let mut out = Vec::new();
        let entries = std::fs::read_dir(&dir).map_err(AppError::Io)?;
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) != Some("json") {
                continue;
            }
            let bytes = match std::fs::read(&path) {
                Ok(b) => b,
                Err(e) => {
                    tracing::warn!(
                        target: "chat",
                        path = %path.display(),
                        error = %e,
                        "chat session read failed; skipping"
                    );
                    continue;
                }
            };
            match serde_json::from_slice::<ChatSession>(&bytes) {
                Ok(s) => out.push(s),
                Err(e) => {
                    // A corrupt session file should not poison the whole
                    // workspace load; warn and continue so the user at
                    // least sees their other history.
                    tracing::warn!(
                        target: "chat",
                        path = %path.display(),
                        error = %e,
                        "chat session parse failed; skipping"
                    );
                }
            }
        }
        Ok(out)
    })
    .await
    .map_err(|e| AppError::Invalid(format!("chat session list join: {e}")))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use serial_test::serial;
    use tempfile::TempDir;

    /// Point `MARKSPREAD_HOME` at a fresh tempdir for the duration of a
    /// test. We `#[serial]` every test in this module because the env
    /// var is process-global.
    struct EnvGuard {
        _dir: TempDir,
        prev: Option<std::ffi::OsString>,
    }

    impl EnvGuard {
        fn new() -> Self {
            let dir = TempDir::new().expect("tempdir");
            let prev = std::env::var_os("MARKSPREAD_HOME");
            std::env::set_var("MARKSPREAD_HOME", dir.path());
            EnvGuard { _dir: dir, prev }
        }
    }

    impl Drop for EnvGuard {
        fn drop(&mut self) {
            match self.prev.take() {
                Some(v) => std::env::set_var("MARKSPREAD_HOME", v),
                None => std::env::remove_var("MARKSPREAD_HOME"),
            }
        }
    }

    fn sample_session(ws: &str, id: &str, title: &str) -> ChatSession {
        ChatSession {
            id: id.into(),
            workspace_id: ws.into(),
            title: title.into(),
            created_at: 1,
            updated_at: 2,
            messages: vec![ChatMessage {
                id: "m1".into(),
                role: "user".into(),
                content: "hi".into(),
                created_at: 1,
            }],
        }
    }

    #[tokio::test]
    #[serial]
    async fn save_then_list_roundtrips() {
        let _g = EnvGuard::new();
        let s = sample_session("ws1", "s1", "Hello");
        chat_session_save(s.clone()).await.unwrap();
        let loaded = chat_session_list("ws1".into()).await.unwrap();
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].id, "s1");
        assert_eq!(loaded[0].title, "Hello");
        assert_eq!(loaded[0].messages.len(), 1);
    }

    #[tokio::test]
    #[serial]
    async fn save_overwrites_existing() {
        let _g = EnvGuard::new();
        chat_session_save(sample_session("ws1", "s1", "Old"))
            .await
            .unwrap();
        chat_session_save(sample_session("ws1", "s1", "New"))
            .await
            .unwrap();
        let loaded = chat_session_list("ws1".into()).await.unwrap();
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].title, "New");
    }

    #[tokio::test]
    #[serial]
    async fn list_for_unknown_workspace_is_empty() {
        let _g = EnvGuard::new();
        let loaded = chat_session_list("never-seen".into()).await.unwrap();
        assert!(loaded.is_empty());
    }

    #[tokio::test]
    #[serial]
    async fn delete_removes_file_across_workspaces() {
        let _g = EnvGuard::new();
        chat_session_save(sample_session("wsA", "s-shared", "A"))
            .await
            .unwrap();
        chat_session_save(sample_session("wsB", "s-other", "B"))
            .await
            .unwrap();
        chat_session_delete("s-shared".into()).await.unwrap();
        let a = chat_session_list("wsA".into()).await.unwrap();
        let b = chat_session_list("wsB".into()).await.unwrap();
        assert!(a.is_empty());
        assert_eq!(b.len(), 1);
    }

    #[tokio::test]
    #[serial]
    async fn delete_unknown_session_is_noop() {
        let _g = EnvGuard::new();
        // Even with no chat root on disk this must not error.
        chat_session_delete("ghost".into()).await.unwrap();
    }

    #[tokio::test]
    #[serial]
    async fn save_rejects_path_traversal_in_ids() {
        let _g = EnvGuard::new();
        let mut s = sample_session("ws1", "s1", "x");
        s.id = "../../escape".into();
        let err = chat_session_save(s).await.unwrap_err();
        assert!(matches!(err, AppError::Invalid(_)));
    }

    #[tokio::test]
    #[serial]
    async fn list_skips_corrupt_files() {
        let _g = EnvGuard::new();
        chat_session_save(sample_session("ws1", "good", "ok"))
            .await
            .unwrap();
        // Drop a junk JSON next to the good one.
        let dir = workspace_dir("ws1").unwrap();
        std::fs::write(dir.join("broken.json"), b"{not valid json").unwrap();
        let loaded = chat_session_list("ws1".into()).await.unwrap();
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].id, "good");
    }
}
