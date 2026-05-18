// S-FAP-007: file access policy engine — single source of truth.
//
// All path-bearing fs commands (fs_cmd.rs) go through `check_access` so that
// SEC/BND/PRM/POL/PRF/FMT/IO categories described in
// docs/spec/file-access-policy.md are enforced (or recognised) in one place.
//
// The pre-existing helpers `validate_input_path` and `ensure_within` are now
// thin wrappers that delegate here, so each /fs_*/ command automatically
// participates without per-call edits.

mod decision;
mod engine;
mod rules;

#[cfg(test)]
mod tests;

#[allow(unused_imports)]
pub use decision::{AccessCategory, AccessDecision, AccessIntent, RuleId, VarValue};
#[allow(unused_imports)]
pub use engine::{check_access, check_path_input, check_stat, ensure_within_engine};
