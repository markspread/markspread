// S-FAP-008: shared types for the file-access policy surface.
//
// Mirrors docs/spec/file-access-policy.md §3.1 (categories) and §4.2 (rules).
// Implementation of the engine itself lives in Rust (FAP-007); this module is
// the TS contract used by the renderer-side error card and i18n catalog.

export type AccessCategory =
  | "SEC" // Security block
  | "BND" // Workspace boundary
  | "PRM" // Permission block
  | "POL" // Policy block (overridable via allow-list)
  | "PRF" // Performance block
  | "FMT" // Format mismatch (routing signal)
  | "IO"; // Unclassified IO error

export type RuleId =
  // SEC
  | "SEC-NULL-BYTE"
  | "SEC-PATH-TRAVERSAL"
  | "SEC-SYMLINK-ESCAPE"
  // BND
  | "BND-OUTSIDE-WORKSPACE"
  // PRM
  | "PRM-OS-EACCES"
  // POL
  | "POL-VCS-INTERNAL"
  | "POL-NODE-MODULES"
  | "POL-BUILD-OUTPUT"
  | "POL-LANG-CACHE"
  | "POL-IDE-INTERNAL"
  | "POL-PLATFORM-CRUFT"
  // PRF
  | "PRF-FILE-SIZE-LIMIT"
  | "PRF-FILE-SIZE-WARN"
  | "PRF-DIR-NODE-COUNT"
  // FMT
  | "FMT-NOT-UTF8"
  | "FMT-IS-DIRECTORY"
  | "FMT-BINARY-SNIFF"
  // IO
  | "IO-DISK-FULL"
  | "IO-ENOENT"
  | "IO-UNCLASSIFIED";

export type ActionId =
  | "open_settings"
  | "edit_allowlist"
  | "add_workspace"
  | "open_anyway"
  | "force_text"
  | "retry"
  | "copy_diagnostics"
  | "learn_more"
  | "show_in_tree"
  | "open_image_viewer";

export interface AccessDecision {
  ruleId: RuleId;
  category: AccessCategory;
  /** i18next interpolation vars: `{{size}}`, `{{limit}}`, `{{count}}`, `{{code}}` */
  vars?: Record<string, string | number>;
}
