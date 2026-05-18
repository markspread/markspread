use crate::error::{AppError, AppResult};
use std::path::Path;
use std::process::Command;

/// S-FT-014: open the OS file manager at the given path's location, with the
/// path itself selected when the platform supports it. macOS uses `open -R`
/// (NSWorkspace under the hood), Windows uses `explorer /select,` , Linux
/// falls back to `xdg-open` on the parent directory because no portable
/// equivalent of "select this file" exists across the desktop environments.
#[tauri::command]
pub async fn os_reveal_path(path: String) -> AppResult<()> {
    let p = Path::new(&path);
    if !p.exists() {
        return Err(AppError::Invalid(format!(
            "path not found: {}",
            p.display()
        )));
    }
    let target = path.clone();
    tokio::task::spawn_blocking(move || -> Result<(), AppError> {
        #[cfg(target_os = "macos")]
        {
            Command::new("open")
                .arg("-R")
                .arg(&target)
                .status()
                .map_err(|e| AppError::Invalid(format!("open -R failed: {e}")))?;
            Ok(())
        }
        #[cfg(target_os = "windows")]
        {
            // The comma-separated argument is a single string from explorer's
            // perspective; passing it as one arg keeps quoting consistent.
            let arg = format!("/select,{}", target);
            Command::new("explorer")
                .arg(&arg)
                .status()
                .map_err(|e| AppError::Invalid(format!("explorer failed: {e}")))?;
            Ok(())
        }
        #[cfg(target_os = "linux")]
        {
            let parent = Path::new(&target)
                .parent()
                .map(|p| p.to_path_buf())
                .unwrap_or_else(|| Path::new("/").to_path_buf());
            Command::new("xdg-open")
                .arg(&parent)
                .status()
                .map_err(|e| AppError::Invalid(format!("xdg-open failed: {e}")))?;
            Ok(())
        }
        #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
        {
            let _ = target;
            Err(AppError::Invalid("reveal not supported on this OS".into()))
        }
    })
    .await
    .map_err(|e| AppError::Invalid(format!("internal: {e}")))?
}

/// S-FT-013: stub for "Open with…". macOS opens the OS picker via
/// `open -a` is per-app; without an explicit app argument the user-facing
/// "Open With…" dialog isn't accessible from the shell. We surface a clear
/// "unsupported" error so the menu can show a fallback hint.
#[tauri::command]
pub async fn os_open_with(path: String) -> AppResult<()> {
    let p = Path::new(&path);
    if !p.exists() {
        return Err(AppError::Invalid(format!(
            "path not found: {}",
            p.display()
        )));
    }
    #[cfg(target_os = "macos")]
    {
        let target = path.clone();
        tokio::task::spawn_blocking(move || -> Result<(), AppError> {
            // `open -R` reveals; without a flag, `open` invokes the default
            // app. An OS-level "Open With…" picker requires an Info.plist
            // action that we don't currently expose — defer to the default
            // app and let the user pick from Finder.
            Command::new("open")
                .arg(&target)
                .status()
                .map_err(|e| AppError::Invalid(format!("open failed: {e}")))?;
            Ok(())
        })
        .await
        .map_err(|e| AppError::Invalid(format!("internal: {e}")))??;
        Ok(())
    }
    #[cfg(target_os = "windows")]
    {
        // `rundll32 shell32.dll,OpenAs_RunDLL` invokes the picker dialog.
        let target = path.clone();
        tokio::task::spawn_blocking(move || -> Result<(), AppError> {
            Command::new("rundll32")
                .args(["shell32.dll,OpenAs_RunDLL", &target])
                .status()
                .map_err(|e| AppError::Invalid(format!("rundll32 failed: {e}")))?;
            Ok(())
        })
        .await
        .map_err(|e| AppError::Invalid(format!("internal: {e}")))??;
        Ok(())
    }
    #[cfg(target_os = "linux")]
    {
        // No standard "open with picker" — fall through to xdg-open which
        // delegates to the user's default app. Better than nothing.
        let target = path.clone();
        tokio::task::spawn_blocking(move || -> Result<(), AppError> {
            Command::new("xdg-open")
                .arg(&target)
                .status()
                .map_err(|e| AppError::Invalid(format!("xdg-open failed: {e}")))?;
            Ok(())
        })
        .await
        .map_err(|e| AppError::Invalid(format!("internal: {e}")))??;
        Ok(())
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        Err(AppError::Invalid("open with not supported on this OS".into()))
    }
}

/// S-TY-003: enumerate font families installed on the host OS so the
/// Appearance settings panel can offer a picker. fontdb walks the platform
/// font directories (CoreText, DirectWrite, fontconfig) so we don't have to
/// shell out per-OS. Result is sorted + deduped; we never expose paths.
#[tauri::command]
pub async fn os_list_fonts() -> AppResult<Vec<String>> {
    tokio::task::spawn_blocking(|| -> Vec<String> {
        let mut db = fontdb::Database::new();
        db.load_system_fonts();
        let mut families: Vec<String> = db
            .faces()
            .flat_map(|face| face.families.iter().map(|(name, _)| name.clone()))
            .collect();
        families.sort_by_key(|f| f.to_lowercase());
        families.dedup();
        families
    })
    .await
    .map_err(|e| AppError::Invalid(format!("internal: {e}")))
}
