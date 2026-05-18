// S-FAP-007: decision shape that flows back over IPC to the
// FileAccessErrorCard (FAP-008). Field names match
// `src/lib/access-policy/types.ts` so the React `AccessDecision` interface
// receives this struct verbatim through `AppError::Access`.

use serde::Serialize;
use std::collections::BTreeMap;

#[allow(dead_code)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum AccessCategory {
    SEC,
    BND,
    PRM,
    POL,
    PRF,
    FMT,
    IO,
}

impl AccessCategory {
    #[allow(dead_code)]
    pub fn as_str(self) -> &'static str {
        match self {
            AccessCategory::SEC => "SEC",
            AccessCategory::BND => "BND",
            AccessCategory::PRM => "PRM",
            AccessCategory::POL => "POL",
            AccessCategory::PRF => "PRF",
            AccessCategory::FMT => "FMT",
            AccessCategory::IO => "IO",
        }
    }
}

/// Rule identifiers mirror `RuleId` in the frontend mapping table. Adding a
/// new rule requires updating `src/lib/access-policy/mapping.ts` and the
/// `errors.access.rule.*` i18n bundles or the FileAccessErrorCard cannot
/// render it.
#[allow(dead_code)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RuleId {
    SecNullByte,
    SecPathTraversal,
    SecSymlinkEscape,
    BndOutsideWorkspace,
    PrmOsEacces,
    PolVcsInternal,
    PolNodeModules,
    PolBuildOutput,
    PolLangCache,
    PolIdeInternal,
    PolPlatformCruft,
    PrfFileSizeLimit,
    PrfFileSizeWarn,
    PrfDirNodeCount,
    FmtNotUtf8,
    FmtIsDirectory,
    FmtBinarySniff,
    IoDiskFull,
    IoEnoent,
    IoUnclassified,
}

impl RuleId {
    pub fn as_wire_str(self) -> &'static str {
        match self {
            RuleId::SecNullByte => "SEC-NULL-BYTE",
            RuleId::SecPathTraversal => "SEC-PATH-TRAVERSAL",
            RuleId::SecSymlinkEscape => "SEC-SYMLINK-ESCAPE",
            RuleId::BndOutsideWorkspace => "BND-OUTSIDE-WORKSPACE",
            RuleId::PrmOsEacces => "PRM-OS-EACCES",
            RuleId::PolVcsInternal => "POL-VCS-INTERNAL",
            RuleId::PolNodeModules => "POL-NODE-MODULES",
            RuleId::PolBuildOutput => "POL-BUILD-OUTPUT",
            RuleId::PolLangCache => "POL-LANG-CACHE",
            RuleId::PolIdeInternal => "POL-IDE-INTERNAL",
            RuleId::PolPlatformCruft => "POL-PLATFORM-CRUFT",
            RuleId::PrfFileSizeLimit => "PRF-FILE-SIZE-LIMIT",
            RuleId::PrfFileSizeWarn => "PRF-FILE-SIZE-WARN",
            RuleId::PrfDirNodeCount => "PRF-DIR-NODE-COUNT",
            RuleId::FmtNotUtf8 => "FMT-NOT-UTF8",
            RuleId::FmtIsDirectory => "FMT-IS-DIRECTORY",
            RuleId::FmtBinarySniff => "FMT-BINARY-SNIFF",
            RuleId::IoDiskFull => "IO-DISK-FULL",
            RuleId::IoEnoent => "IO-ENOENT",
            RuleId::IoUnclassified => "IO-UNCLASSIFIED",
        }
    }

    pub fn category(self) -> AccessCategory {
        match self {
            RuleId::SecNullByte | RuleId::SecPathTraversal | RuleId::SecSymlinkEscape => {
                AccessCategory::SEC
            }
            RuleId::BndOutsideWorkspace => AccessCategory::BND,
            RuleId::PrmOsEacces => AccessCategory::PRM,
            RuleId::PolVcsInternal
            | RuleId::PolNodeModules
            | RuleId::PolBuildOutput
            | RuleId::PolLangCache
            | RuleId::PolIdeInternal
            | RuleId::PolPlatformCruft => AccessCategory::POL,
            RuleId::PrfFileSizeLimit | RuleId::PrfFileSizeWarn | RuleId::PrfDirNodeCount => {
                AccessCategory::PRF
            }
            RuleId::FmtNotUtf8 | RuleId::FmtIsDirectory | RuleId::FmtBinarySniff => {
                AccessCategory::FMT
            }
            RuleId::IoDiskFull | RuleId::IoEnoent | RuleId::IoUnclassified => AccessCategory::IO,
        }
    }
}

impl Serialize for RuleId {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(self.as_wire_str())
    }
}

/// Serializable variable bag for i18n interpolation. The frontend's
/// `AccessDecision.vars` is `Record<string, string | number>` — we represent
/// numbers as i64/u64 because we never need fractional values.
#[derive(Debug, Clone, Serialize)]
#[serde(untagged)]
pub enum VarValue {
    Str(String),
    Num(i64),
}

impl From<&str> for VarValue {
    fn from(s: &str) -> Self {
        VarValue::Str(s.to_owned())
    }
}
impl From<String> for VarValue {
    fn from(s: String) -> Self {
        VarValue::Str(s)
    }
}
impl From<u64> for VarValue {
    fn from(n: u64) -> Self {
        VarValue::Num(n as i64)
    }
}
impl From<usize> for VarValue {
    fn from(n: usize) -> Self {
        VarValue::Num(n as i64)
    }
}

#[allow(dead_code)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AccessIntent {
    /// Open the path as a file (read/edit).
    OpenAsFile,
    /// Walk the path as a directory (listing).
    ListDir,
    /// Write to the path (create or replace).
    Write,
    /// stat() only, used by sidebar prefetch.
    Stat,
}

/// The deny payload that flows back to the frontend. `Allow`/`Warn` are kept
/// in the engine for completeness but only `Deny` is surfaced through IPC
/// today — the existing `validate_input_path`/`ensure_within` wrappers map
/// `Deny` to `AppError::Access` and ignore the others.
#[derive(Debug, Clone, Serialize)]
pub struct AccessDecision {
    #[serde(rename = "ruleId")]
    pub rule_id: RuleId,
    pub category: AccessCategory,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vars: Option<BTreeMap<String, VarValue>>,
}

impl AccessDecision {
    pub fn deny(rule: RuleId) -> Self {
        Self {
            rule_id: rule,
            category: rule.category(),
            vars: None,
        }
    }

    pub fn with_var(mut self, key: &str, value: impl Into<VarValue>) -> Self {
        self.vars
            .get_or_insert_with(BTreeMap::new)
            .insert(key.to_owned(), value.into());
        self
    }
}
