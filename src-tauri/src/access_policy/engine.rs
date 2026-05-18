// S-FAP-007: single-entry policy engine.
//
// Two layers exist on top of `check_access`:
//
//   * `check_path_input` — pre-IPC SEC checks (null byte, encoded traversal).
//     Wraps the legacy `validate_input_path` helper.
//   * `ensure_within_engine` — BND/SEC-SYMLINK-ESCAPE plus optional POL
//     gating. Wraps the legacy `ensure_within` helper.
//
// Both layers return `AccessDecision` so callers can inspect the rule that
// fired before downgrading to the old `AppError` shape.

use super::decision::{AccessDecision, AccessIntent, RuleId};
use super::rules::{
    has_encoded_traversal, has_null_byte, is_pol_exception, match_pol_rule, HUGE_FILE_THRESHOLD,
    LARGE_FILE_WARN_THRESHOLD,
};
use std::path::{Path, PathBuf};

/// §3.1 priority order: SEC > BND > PRM > POL > PRF > FMT > IO. The
/// inspection sequence here mirrors that ordering so the first deny wins.
#[allow(dead_code)]
pub fn check_access(
    workspace: &Path,
    relative: &Path,
    raw_input: &str,
    intent: AccessIntent,
) -> Result<PathBuf, AccessDecision> {
    // 1. SEC — pre-canonicalize input validation.
    if let Some(d) = check_path_input(raw_input) {
        return Err(d);
    }

    // 2. SEC-SYMLINK-ESCAPE / BND-OUTSIDE-WORKSPACE — canonicalize + boundary.
    let canonical = ensure_within_engine(workspace, relative)?;

    // 3. POL — defined-but-not-enforced until FAP-006 lands an allow-list UI.
    //    `match_pol_rule` is still exercised through `tests::pol_*` so a future
    //    flip of `pol_enabled` to `true` is a single-line change.
    let pol_enabled = false;
    if pol_enabled {
        if let Some(rule) = match_pol_rule(&relative_to(workspace, &canonical)) {
            if !is_pol_exception(&relative_to(workspace, &canonical)) {
                return Err(AccessDecision::deny(rule));
            }
        }
    }

    // PRM/PRF/FMT/IO categories materialise from the actual fs call, not
    // from the path — those are folded in at the `fs_cmd` boundary through
    // `check_stat` and `AppError::From<io::Error>`. The intent argument is
    // currently informational only but reserved for FAP-009 telemetry.
    let _ = intent;
    Ok(canonical)
}

/// SEC pre-validation. Returns the first matching deny, or None when the
/// input is safe.
pub fn check_path_input(raw: &str) -> Option<AccessDecision> {
    if raw.is_empty() {
        return Some(AccessDecision::deny(RuleId::IoUnclassified).with_var("reason", "empty path"));
    }
    if has_null_byte(raw) {
        return Some(AccessDecision::deny(RuleId::SecNullByte));
    }
    if has_encoded_traversal(raw) {
        return Some(AccessDecision::deny(RuleId::SecPathTraversal));
    }
    None
}

/// BND + SEC-SYMLINK-ESCAPE boundary check. Returns the canonical absolute
/// path on success, or a deny decision pointing at the rule that fired.
///
/// We detect "did this path cross a symlink?" by comparing the raw join
/// (`workspace.join(relative)` with `..` stripped lexically) against the
/// canonical form. If they differ in the segments that lead outside the
/// workspace, we attribute the escape to a symlink — otherwise it's a
/// straight-forward BND violation.
pub fn ensure_within_engine(workspace: &Path, target: &Path) -> Result<PathBuf, AccessDecision> {
    let ws = workspace.canonicalize().map_err(|_| {
        AccessDecision::deny(RuleId::IoUnclassified)
            .with_var("reason", "workspace canonicalize failed")
    })?;

    let candidate = if target.is_absolute() {
        target.to_path_buf()
    } else {
        ws.join(target)
    };

    let resolved = match candidate.canonicalize() {
        Ok(p) => p,
        Err(_) => {
            // Walk up to the nearest ancestor that *does* exist, then re-attach
            // the suffix. This lets create_dir_all & save-to-new-file paths
            // survive the boundary check even though the leaf can't yet be
            // canonicalized. We still anchor on `ws` so the resulting path
            // cannot escape — `starts_with(&ws)` runs below.
            let mut suffix_names: Vec<std::ffi::OsString> = Vec::new();
            let mut anchor: Option<PathBuf> = None;
            let mut walker: Option<&Path> = Some(candidate.as_path());
            while let Some(p) = walker {
                if let Ok(canon) = p.canonicalize() {
                    anchor = Some(canon);
                    break;
                }
                if let Some(name) = p.file_name() {
                    suffix_names.push(name.to_os_string());
                }
                walker = p.parent();
            }
            match anchor {
                Some(base) => {
                    let mut joined = base;
                    for name in suffix_names.iter().rev() {
                        joined.push(name);
                    }
                    joined
                }
                None => {
                    return Err(AccessDecision::deny(RuleId::IoUnclassified)
                        .with_var("reason", "no existing ancestor"));
                }
            }
        }
    };

    if !resolved.starts_with(&ws) {
        let crossed_symlink = path_traverses_symlink(workspace, target);
        let rule = if crossed_symlink {
            RuleId::SecSymlinkEscape
        } else {
            RuleId::BndOutsideWorkspace
        };
        return Err(AccessDecision::deny(rule).with_var("path", resolved.display().to_string()));
    }

    Ok(resolved)
}

/// §4.3 step 5 — once we have a stat() result we classify it. Returns Some
/// when the size/kind warrants a deny or warn; None when the file is good
/// to read.
#[allow(dead_code)]
pub fn check_stat(meta: &std::fs::Metadata, intent: AccessIntent) -> Option<AccessDecision> {
    if meta.is_dir() && intent == AccessIntent::OpenAsFile {
        return Some(AccessDecision::deny(RuleId::FmtIsDirectory));
    }
    let size = meta.len();
    if size >= HUGE_FILE_THRESHOLD {
        return Some(
            AccessDecision::deny(RuleId::PrfFileSizeLimit)
                .with_var("size", size)
                .with_var("limit", HUGE_FILE_THRESHOLD),
        );
    }
    if size >= LARGE_FILE_WARN_THRESHOLD {
        // Warning is encoded as a Deny with the warn rule_id so the call
        // path stays simple — fs_cmd may choose to ignore it and only the
        // telemetry layer (FAP-009) cares.
        return Some(
            AccessDecision::deny(RuleId::PrfFileSizeWarn)
                .with_var("size", size)
                .with_var("warn_at", LARGE_FILE_WARN_THRESHOLD),
        );
    }
    None
}

#[allow(dead_code)]
fn relative_to(base: &Path, full: &Path) -> PathBuf {
    full.strip_prefix(base)
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|_| full.to_path_buf())
}

/// Heuristic for SEC-SYMLINK-ESCAPE: a path traverses a symlink when any
/// component on the way to the leaf is itself a symlink in the workspace.
/// We don't trust this for security — `ensure_within_engine` always falls
/// back to a BND deny when no symlink is found — but it's specific enough
/// for telemetry & message routing.
fn path_traverses_symlink(workspace: &Path, target: &Path) -> bool {
    let start = if target.is_absolute() {
        target.to_path_buf()
    } else {
        workspace.join(target)
    };
    let mut current = start.as_path();
    while let Some(parent) = current.parent() {
        if let Ok(meta) = std::fs::symlink_metadata(current) {
            if meta.file_type().is_symlink() {
                return true;
            }
        }
        if parent == workspace || parent.as_os_str().is_empty() {
            return false;
        }
        current = parent;
    }
    false
}
