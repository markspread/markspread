// S-FT-027: best-effort lock detection. The "is anyone holding this file?"
// question has no portable answer, so we probe with the OS-native flavor and
// fall back to "unknown" (reported as not-locked) on failure.
//
// We never expose which process holds the file — that requires elevated
// privileges on most platforms and leaks tenant info on shared boxes.

use crate::error::AppResult;
use crate::fs_cmd::{ensure_within, validate_input_path};
use std::path::Path;
use tokio::task::spawn_blocking;

#[tauri::command]
pub async fn fs_check_locked(workspace: String, path: String) -> AppResult<bool> {
    validate_input_path(&path)?;
    let target = ensure_within(Path::new(&workspace), Path::new(&path))?;
    if target.is_dir() {
        return Ok(false);
    }
    let target = target.to_path_buf();
    let locked = spawn_blocking(move || probe_locked(&target))
        .await
        .unwrap_or(false);
    Ok(locked)
}

#[cfg(unix)]
fn probe_locked(path: &Path) -> bool {
    use std::os::unix::io::AsRawFd;
    let Ok(file) = std::fs::OpenOptions::new().read(true).open(path) else {
        return false;
    };
    let fd = file.as_raw_fd();
    // LOCK_SH | LOCK_NB: take a shared lock without blocking. EWOULDBLOCK ⇒
    // somebody else holds it exclusively. flock against an unlocked file
    // succeeds, so we always release before returning.
    let r = unsafe { libc::flock(fd, libc::LOCK_SH | libc::LOCK_NB) };
    if r == 0 {
        let _ = unsafe { libc::flock(fd, libc::LOCK_UN) };
        return false;
    }
    let err = std::io::Error::last_os_error();
    matches!(err.raw_os_error(), Some(libc::EWOULDBLOCK))
}

#[cfg(windows)]
fn probe_locked(path: &Path) -> bool {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Foundation::{
        CloseHandle, ERROR_SHARING_VIOLATION, GetLastError, INVALID_HANDLE_VALUE,
    };
    use windows_sys::Win32::Storage::FileSystem::{
        CreateFileW, FILE_ATTRIBUTE_NORMAL, OPEN_EXISTING,
    };
    use windows_sys::Win32::System::SystemServices::GENERIC_READ;

    let wide: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    // Open with FILE_SHARE_NONE: if anything else holds an exclusive handle
    // we get ERROR_SHARING_VIOLATION. dwShareMode = 0 ⇒ no share.
    let handle = unsafe {
        CreateFileW(
            wide.as_ptr(),
            GENERIC_READ,
            0,
            std::ptr::null(),
            OPEN_EXISTING,
            FILE_ATTRIBUTE_NORMAL,
            0,
        )
    };
    if handle == INVALID_HANDLE_VALUE {
        let code = unsafe { GetLastError() };
        return code == ERROR_SHARING_VIOLATION;
    }
    unsafe { CloseHandle(handle) };
    false
}

#[cfg(not(any(unix, windows)))]
fn probe_locked(_path: &Path) -> bool {
    false
}
