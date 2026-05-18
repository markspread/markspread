use serde::Serialize;
use std::path::Path;

#[derive(Debug, Serialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum DriveKind {
    Internal,
    External,
    Network,
    /// Only constructed on Windows (DRIVE_UNKNOWN/NO_ROOT_DIR fallthrough);
    /// `#[allow]` keeps non-Windows builds quiet.
    #[allow(dead_code)]
    Unknown,
}

#[derive(Debug, Serialize)]
pub struct DriveInfo {
    pub kind: DriveKind,
    /// Whether the filesystem is known to be case-preserving but not
    /// case-sensitive (FAT32/exFAT/NTFS-default). Drives in this category
    /// require us to coalesce case-only renames at the application level.
    pub case_preserving_only: bool,
}

#[cfg(target_os = "macos")]
pub fn classify(path: &Path) -> DriveInfo {
    let s = path.to_string_lossy();
    if s.starts_with("/Volumes/") {
        // Skip the boot volume mount, which is typically /Volumes/Macintosh HD
        // and acts as an alias for "/".
        if let Ok(boot) = std::fs::canonicalize("/") {
            if let Ok(canon) = std::fs::canonicalize(path) {
                if canon.starts_with(&boot) && !s.starts_with("/Volumes/Macintosh HD") {
                    return DriveInfo {
                        kind: DriveKind::Internal,
                        case_preserving_only: false,
                    };
                }
            }
        }
        return DriveInfo {
            kind: DriveKind::External,
            case_preserving_only: true,
        };
    }
    DriveInfo {
        kind: DriveKind::Internal,
        case_preserving_only: false,
    }
}

#[cfg(target_os = "linux")]
pub fn classify(path: &Path) -> DriveInfo {
    let s = path.to_string_lossy();
    if s.starts_with("/media/") || s.starts_with("/mnt/") || s.starts_with("/run/media/") {
        return DriveInfo {
            kind: DriveKind::External,
            case_preserving_only: true,
        };
    }
    DriveInfo {
        kind: DriveKind::Internal,
        case_preserving_only: false,
    }
}

#[cfg(target_os = "windows")]
pub fn classify(path: &Path) -> DriveInfo {
    use std::os::windows::ffi::OsStrExt;
    let s = path.to_string_lossy();
    let drive = s.chars().next().filter(|c| c.is_ascii_alphabetic());
    if let Some(letter) = drive {
        let root = format!("{letter}:\\");
        let wide: Vec<u16> = std::ffi::OsStr::new(&root)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        // SAFETY: GetDriveTypeW is FFI-safe and only reads our null-terminated
        // wide string. It returns a numeric DRIVE_* constant.
        let kind = unsafe {
            let ptr = wide.as_ptr();
            // 0=DRIVE_UNKNOWN, 1=DRIVE_NO_ROOT_DIR, 2=DRIVE_REMOVABLE,
            // 3=DRIVE_FIXED, 4=DRIVE_REMOTE, 5=DRIVE_CDROM, 6=DRIVE_RAMDISK
            extern "system" {
                fn GetDriveTypeW(lpRootPathName: *const u16) -> u32;
            }
            GetDriveTypeW(ptr)
        };
        return match kind {
            2 | 5 => DriveInfo {
                kind: DriveKind::External,
                case_preserving_only: true,
            },
            3 => DriveInfo {
                kind: DriveKind::Internal,
                case_preserving_only: true,
            },
            4 => DriveInfo {
                kind: DriveKind::Network,
                case_preserving_only: true,
            },
            _ => DriveInfo {
                kind: DriveKind::Unknown,
                case_preserving_only: true,
            },
        };
    }
    DriveInfo {
        kind: DriveKind::Unknown,
        case_preserving_only: true,
    }
}

#[tauri::command]
pub fn drive_classify(path: String) -> DriveInfo {
    classify(Path::new(&path))
}
