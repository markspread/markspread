use std::path::Path;
use unicode_normalization::UnicodeNormalization;

/// Normalize a path string to NFC for *display, comparison, and indexing*.
///
/// macOS canonicalize() returns NFD; Linux and Windows preserve whatever was
/// on disk. We always present NFC so that `~/문서/메모📝/foo.md` shows the
/// same way regardless of platform, and so search hits and tab titles match
/// the FileTree label.
///
/// IMPORTANT: never use the NFC form for filesystem syscalls on macOS. Keep
/// the original `Path` for I/O; only convert at UI boundaries.
pub fn to_nfc<P: AsRef<Path>>(path: P) -> String {
    path.as_ref().to_string_lossy().nfc().collect::<String>()
}

pub fn nfc_str(s: &str) -> String {
    s.nfc().collect::<String>()
}
