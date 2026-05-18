use crate::access_policy::{AccessDecision, RuleId};
use serde::{Serialize, Serializer};
use thiserror::Error;

// S-FAP-007: while the structured `access` payload is the new contract, the
// legacy POSIX-shaped `code` field is preserved so existing frontend call
// sites (and `fromPosixError`) don't change in lockstep.
fn access_decision_legacy_code(d: &AccessDecision) -> &'static str {
    match d.rule_id {
        RuleId::SecNullByte | RuleId::SecPathTraversal => "EINVAL",
        RuleId::SecSymlinkEscape | RuleId::BndOutsideWorkspace => "EOUTSIDE_WORKSPACE",
        RuleId::PrmOsEacces => "EACCES",
        RuleId::FmtIsDirectory => "EISDIR",
        RuleId::FmtNotUtf8 => "ENOTUTF8",
        RuleId::IoDiskFull => "ENOSPC",
        RuleId::IoEnoent => "ENOENT",
        RuleId::PolVcsInternal
        | RuleId::PolNodeModules
        | RuleId::PolBuildOutput
        | RuleId::PolLangCache
        | RuleId::PolIdeInternal
        | RuleId::PolPlatformCruft => "EACCES",
        RuleId::PrfFileSizeLimit | RuleId::PrfFileSizeWarn => "EFBIG",
        RuleId::PrfDirNodeCount => "E2BIG",
        RuleId::FmtBinarySniff => "ENOTUTF8",
        RuleId::IoUnclassified => "EIO",
    }
}

#[derive(Debug, Error)]
pub enum AppError {
    #[error("io: {0}")]
    Io(std::io::Error),
    #[error("permission denied: {0}")]
    PermissionDenied(String),
    #[error("not found: {0}")]
    NotFound(String),
    #[error("disk full: {0}")]
    DiskFull(String),
    #[error("trash failed: {0}")]
    Trash(String),
    #[error("cross-device move: {0}")]
    CrossDevice(String),
    // S-FAP-007: superseded by `Access(AccessDecision)` carrying
    // BND-OUTSIDE-WORKSPACE / SEC-SYMLINK-ESCAPE. Retained until the v1.2
    // cleanup pass so downstream `match` arms can keep their exhaustiveness
    // guards.
    #[allow(dead_code)]
    #[error("path outside workspace: {0}")]
    PathEscape(String),
    #[error("not utf-8: {0}")]
    NotUtf8(String),
    #[error("invalid input: {0}")]
    Invalid(String),
    #[error("path is a directory, not a file: {0}")]
    IsDirectory(String),
    // S-FAP-007: structured access policy denial — carries category + rule_id
    // + i18n vars so the FileAccessErrorCard (FAP-008) renders without going
    // through the legacy POSIX-code shim.
    #[error("access denied: {0:?}")]
    Access(AccessDecision),
}

impl From<AccessDecision> for AppError {
    fn from(d: AccessDecision) -> Self {
        AppError::Access(d)
    }
}

// POSIX ENOSPC=28; Windows ERROR_DISK_FULL=112, ERROR_HANDLE_DISK_FULL=39.
fn is_disk_full(e: &std::io::Error) -> bool {
    if let Some(c) = e.raw_os_error() {
        if cfg!(windows) {
            c == 112 || c == 39
        } else {
            c == 28
        }
    } else {
        false
    }
}

// EROFS=30, EPERM=1; Windows ERROR_WRITE_PROTECT=19. We map all three to
// PermissionDenied so the user-facing message is consistent — the difference
// only matters in logs.
fn is_readonly_or_eperm(e: &std::io::Error) -> bool {
    if let Some(c) = e.raw_os_error() {
        if cfg!(windows) {
            c == 19
        } else {
            c == 30 || c == 1
        }
    } else {
        false
    }
}

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        use std::io::ErrorKind;
        if is_disk_full(&e) {
            return AppError::DiskFull("디스크 공간이 부족하여 저장할 수 없습니다".into());
        }
        if is_readonly_or_eperm(&e) {
            let hint = if cfg!(target_os = "macos") {
                " (시스템 설정 → 개인정보 보호 및 보안에서 접근 권한을 확인하세요)"
            } else if cfg!(target_os = "windows") {
                " (파일 속성 → 보안에서 쓰기 권한을 확인하세요)"
            } else {
                " (디렉터리가 읽기 전용일 수 있습니다)"
            };
            return AppError::PermissionDenied(format!("이 폴더에 쓸 수 없습니다{hint}"));
        }
        // EISDIR=21 on POSIX. Windows raises ERROR_ACCESS_DENIED (5) for the
        // same situation, which we'd already see via PermissionDenied; the
        // explicit kind check below handles it portably for fs::read.
        if e.raw_os_error() == Some(21) {
            return AppError::IsDirectory(e.to_string());
        }
        match e.kind() {
            ErrorKind::PermissionDenied => {
                let hint = if cfg!(target_os = "macos") {
                    " (시스템 설정 → 개인정보 보호 및 보안에서 접근 권한을 확인하세요)"
                } else if cfg!(target_os = "windows") {
                    " (파일 속성 → 보안에서 접근 권한을 확인하세요)"
                } else {
                    " (파일/디렉터리의 읽기 권한을 확인하세요)"
                };
                AppError::PermissionDenied(format!("이 파일을 읽을 권한이 없습니다{hint}"))
            }
            ErrorKind::NotFound => AppError::NotFound(e.to_string()),
            _ => AppError::Io(e),
        }
    }
}

impl AppError {
    pub fn code(&self) -> &'static str {
        match self {
            AppError::Io(_) => "EIO",
            AppError::PermissionDenied(_) => "EACCES",
            AppError::NotFound(_) => "ENOENT",
            AppError::DiskFull(_) => "ENOSPC",
            AppError::Trash(_) => "ETRASH",
            AppError::CrossDevice(_) => "EXDEV",
            AppError::PathEscape(_) => "EOUTSIDE_WORKSPACE",
            AppError::NotUtf8(_) => "ENOTUTF8",
            AppError::Invalid(_) => "EINVAL",
            AppError::IsDirectory(_) => "EISDIR",
            AppError::Access(d) => access_decision_legacy_code(d),
        }
    }

    /// Returns a derived AccessDecision for legacy POSIX-shaped errors so the
    /// frontend can render FileAccessErrorCard without an additional shim
    /// roundtrip. The dedicated `AppError::Access` variant skips this path.
    pub fn access_decision(&self) -> Option<AccessDecision> {
        use crate::access_policy::RuleId;
        let rule = match self {
            AppError::Access(d) => return Some(d.clone()),
            AppError::PathEscape(_) => RuleId::BndOutsideWorkspace,
            AppError::PermissionDenied(_) => RuleId::PrmOsEacces,
            AppError::IsDirectory(_) => RuleId::FmtIsDirectory,
            AppError::NotUtf8(_) => RuleId::FmtNotUtf8,
            AppError::DiskFull(_) => RuleId::IoDiskFull,
            AppError::NotFound(_) => RuleId::IoEnoent,
            _ => return None,
        };
        Some(AccessDecision::deny(rule))
    }
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        // S-FAP-007: legacy IPC contract preserved (`code`/`message`) and a
        // new `access` payload is added when the error maps onto a rule_id
        // the FileAccessErrorCard can render directly.
        let access = self.access_decision();
        let n = if access.is_some() { 3 } else { 2 };
        let mut state = s.serialize_struct("AppError", n)?;
        state.serialize_field("code", self.code())?;
        state.serialize_field("message", &self.to_string())?;
        if let Some(d) = access {
            state.serialize_field("access", &d)?;
        }
        state.end()
    }
}

pub type AppResult<T> = Result<T, AppError>;
