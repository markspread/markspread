use crate::error::{AppError, AppResult};
use serde::Serialize;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

#[derive(Debug, Serialize)]
pub struct NewWindowResult {
    pub label: String,
}

/// S-WS-015: open a new top-level webview window so the user can work on
/// multiple workspaces side-by-side. Each window owns its own URL/state but
/// shares the OS-level application + global settings.
#[tauri::command]
pub async fn window_new(app: tauri::AppHandle) -> AppResult<NewWindowResult> {
    let label = format!(
        "ws-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0)
    );

    // Inherit position from the currently focused window so the new one
    // doesn't materialize off-screen on multi-monitor setups.
    let (x, y) = app
        .webview_windows()
        .values()
        .next()
        .and_then(|w| w.outer_position().ok())
        .map(|p| (p.x + 40, p.y + 40))
        .unwrap_or((100, 100));

    WebviewWindowBuilder::new(&app, &label, WebviewUrl::App("index.html".into()))
        .title("Markspread")
        .inner_size(1280.0, 800.0)
        .min_inner_size(800.0, 500.0)
        .position(x as f64, y as f64)
        .build()
        .map_err(|e| AppError::Invalid(format!("window_new: {e}")))?;

    Ok(NewWindowResult { label })
}

#[derive(Debug, Serialize)]
pub struct WindowInfo {
    pub label: String,
    pub is_primary: bool,
}

/// Front-end calls this on boot so it can namespace per-window persistence.
#[tauri::command]
pub fn window_info(window: tauri::Window) -> WindowInfo {
    let label = window.label().to_string();
    WindowInfo {
        is_primary: label == "main",
        label,
    }
}
