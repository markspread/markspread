// S-FAP-007: stateless rule matchers consumed by `engine::check_access`.
// Splitting them out keeps the engine flow legible and lets unit tests target
// individual rules without spinning up a full filesystem fixture.

use super::decision::RuleId;
use std::path::Path;

/// §4.5: file-size thresholds. Kept as constants here so the legacy
/// `fs_cmd::HUGE_FILE_THRESHOLD` can be re-exported from one place once the
/// last hand-rolled comparison is migrated.
#[allow(dead_code)]
pub const HUGE_FILE_THRESHOLD: u64 = 100 * 1024 * 1024;
#[allow(dead_code)]
pub const LARGE_FILE_WARN_THRESHOLD: u64 = 10 * 1024 * 1024;
#[allow(dead_code)]
pub const DIR_NODE_LIMIT: usize = 5000;

/// SEC-NULL-BYTE: rejects \0 anywhere in the raw input (§4.2).
pub fn has_null_byte(raw: &str) -> bool {
    raw.as_bytes().contains(&0)
}

/// SEC-PATH-TRAVERSAL: rejects URL-encoded traversal markers. Plain `..`
/// segments are normalised by `canonicalize` so they're handled by the BND
/// check; we only stop the encoded form which can survive naive joins.
pub fn has_encoded_traversal(raw: &str) -> bool {
    let lower = raw.to_ascii_lowercase();
    lower.contains("%2e%2e") || lower.contains("%2f..") || lower.contains("..%2f")
}

/// POL match — returns the first POL rule whose pattern hits the path's
/// canonical segments, or `None`.
///
/// The matcher walks the *workspace-relative* path so a user who opened a
/// workspace whose root happens to be inside (e.g.) `node_modules/` is not
/// blanket-blocked (§4.6).
#[allow(dead_code)]
pub fn match_pol_rule(relative: &Path) -> Option<RuleId> {
    let segs: Vec<&str> = relative
        .components()
        .filter_map(|c| match c {
            std::path::Component::Normal(s) => s.to_str(),
            _ => None,
        })
        .collect();

    let file_name = relative
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or_default();

    // POL-PLATFORM-CRUFT: filename-only matcher, runs first so a `.DS_Store`
    // inside `.git/` still surfaces as cruft (lower noise category) rather
    // than VCS-internal.
    if matches!(file_name, ".DS_Store" | "Thumbs.db" | "desktop.ini")
        || file_name.ends_with(".swp")
        || file_name.ends_with(".swo")
    {
        return Some(RuleId::PolPlatformCruft);
    }

    for seg in &segs {
        match *seg {
            ".git" | ".hg" | ".svn" => return Some(RuleId::PolVcsInternal),
            "node_modules" => return Some(RuleId::PolNodeModules),
            "dist" | "build" | "out" | ".next" | ".nuxt" | ".turbo" | ".svelte-kit"
            | ".astro" | "target" | "bin" | "obj" => return Some(RuleId::PolBuildOutput),
            "__pycache__" | ".venv" | "venv" | ".tox" | ".gradle" | ".mvn" | ".cargo"
            | ".rustup" => return Some(RuleId::PolLangCache),
            ".idea" | ".vscode" | ".cursor" => return Some(RuleId::PolIdeInternal),
            _ => {}
        }
    }
    None
}

/// §4.4: explicit allow-list of well-known editable files that live inside an
/// otherwise-POL directory. Runs *after* `match_pol_rule` and overrides a
/// hit. Keep this list narrow — anything beyond it must go through the
/// user-override allow-list (FAP-006).
#[allow(dead_code)]
pub fn is_pol_exception(relative: &Path) -> bool {
    let segs: Vec<&str> = relative
        .components()
        .filter_map(|c| match c {
            std::path::Component::Normal(s) => s.to_str(),
            _ => None,
        })
        .collect();
    let file_name = relative
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or_default();

    // .github/**/*.{md,yml,yaml}
    if segs.first() == Some(&".github") {
        if file_name.ends_with(".md")
            || file_name.ends_with(".yml")
            || file_name.ends_with(".yaml")
        {
            return true;
        }
    }
    // .vscode/{settings,launch,tasks}.json or .vscode/*.md
    if segs.contains(&".vscode") {
        if matches!(file_name, "settings.json" | "launch.json" | "tasks.json")
            || file_name.ends_with(".md")
        {
            return true;
        }
    }
    // .cursor/rules/*.md, .cursor/*.md
    if segs.contains(&".cursor") && file_name.ends_with(".md") {
        return true;
    }
    false
}

/// First 8 KB sniff for FMT-BINARY-SNIFF. We treat any NUL byte as a
/// strong "this is not text" signal because UTF-8 text never legitimately
/// contains \0.
#[allow(dead_code)]
pub fn looks_binary(prefix: &[u8]) -> bool {
    prefix.contains(&0)
}
