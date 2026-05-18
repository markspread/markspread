use crate::error::AppResult;
use serde::Serialize;
use std::sync::{Mutex, OnceLock};
use std::time::Instant;
use tauri::{AppHandle, Manager, Runtime, State};

#[derive(Debug, Default)]
pub struct StartupClock {
    pub first_paint: Mutex<Option<Instant>>,
}

#[derive(Debug, Serialize)]
pub struct StartupMetrics {
    pub first_paint_ms: u128,
    pub since_app_start_ms: u128,
}

static PROCESS_START: OnceLock<Instant> = OnceLock::new();

pub fn process_start() -> Instant {
    *PROCESS_START.get_or_init(Instant::now)
}

pub fn register<R: Runtime>(app: &AppHandle<R>) {
    process_start();
    app.manage(StartupClock::default());
}

#[tauri::command]
pub fn startup_mark_first_paint(state: State<'_, StartupClock>) -> AppResult<StartupMetrics> {
    let now = Instant::now();
    let mut slot = state.first_paint.lock().unwrap();
    if slot.is_none() {
        *slot = Some(now);
    }
    let elapsed = now.duration_since(process_start()).as_millis();
    tracing::info!(cold_start_ms = elapsed as u64, "first paint reported");
    Ok(StartupMetrics {
        first_paint_ms: elapsed,
        since_app_start_ms: elapsed,
    })
}

#[tauri::command]
pub fn startup_metrics(state: State<'_, StartupClock>) -> AppResult<Option<StartupMetrics>> {
    let slot = state.first_paint.lock().unwrap();
    Ok(slot.map(|t| {
        let ms = t.duration_since(process_start()).as_millis();
        StartupMetrics {
            first_paint_ms: ms,
            since_app_start_ms: ms,
        }
    }))
}
