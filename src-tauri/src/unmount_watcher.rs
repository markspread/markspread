use crate::error::{AppError, AppResult};
use serde::Serialize;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::oneshot;

/// S-WS-020: cross-platform unmount detection. Tauri doesn't expose DA /
/// udev / WMI directly, so instead we poll the workspace root every two
/// seconds. The poll is cheap (one stat per workspace) and Just Works on all
/// three OSes — when an external drive is yanked the path goes missing and
/// we emit `workspace:disconnected` so the UI can flush dirty buffers to a
/// snapshot orphan dir before closing the workspace.
#[derive(Default)]
pub struct UnmountRegistry {
    inner: Mutex<HashMap<String, oneshot::Sender<()>>>,
}

#[derive(Debug, Clone, Serialize)]
pub struct WorkspaceDisconnected {
    pub workspace: String,
}

#[tauri::command]
pub fn unmount_watch_start(
    app: AppHandle,
    state: State<'_, UnmountRegistry>,
    workspace: String,
) -> AppResult<()> {
    let mut map = state.inner.lock().expect("unmount registry poisoned");
    if map.contains_key(&workspace) {
        return Ok(());
    }
    let (tx, mut rx) = oneshot::channel::<()>();
    map.insert(workspace.clone(), tx);

    let path = PathBuf::from(&workspace);
    let workspace_for_task = workspace.clone();
    let app_clone = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::select! {
                _ = &mut rx => break,
                _ = tokio::time::sleep(Duration::from_secs(2)) => {
                    if tokio::fs::metadata(&path).await.is_err() {
                        let _ = app_clone.emit(
                            "workspace:disconnected",
                            WorkspaceDisconnected {
                                workspace: workspace_for_task.clone(),
                            },
                        );
                        break;
                    }
                }
            }
        }
    });
    Ok(())
}

#[tauri::command]
pub fn unmount_watch_stop(
    state: State<'_, UnmountRegistry>,
    workspace: String,
) -> AppResult<()> {
    let mut map = state.inner.lock().expect("unmount registry poisoned");
    if let Some(tx) = map.remove(&workspace) {
        let _ = tx.send(());
    }
    Ok(())
}

/// Snapshot a single dirty buffer to the global orphans dir so the user can
/// recover after the drive comes back. Called from the UI when
/// `workspace:disconnected` fires for files with unsaved changes.
#[tauri::command]
pub async fn unmount_dump_orphan(
    relative_path: String,
    contents: String,
) -> AppResult<String> {
    let home = dirs::home_dir().ok_or_else(|| AppError::Invalid("home dir missing".into()))?;
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let dir = home.join(".markspread/snapshots/orphans").join(format!(
        "{now_ms}-{}",
        std::process::id()
    ));
    tokio::fs::create_dir_all(&dir).await?;
    // Sanitize: collapse path separators in the relative path so we never
    // escape the orphan dir (defensive against ../).
    let safe_name = relative_path.replace(['/', '\\'], "_");
    let dest = dir.join(safe_name);
    tokio::fs::write(&dest, contents.as_bytes()).await?;
    Ok(dest.to_string_lossy().to_string())
}

pub fn register(app: &AppHandle) {
    app.manage(UnmountRegistry::default());
}
