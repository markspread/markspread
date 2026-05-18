// S-ER-014 / S-ER-015: error code system + i18n bridge.
//
// Every user-visible error has:
//   - a stable code  (E####)  → never localised, used in support tickets
//   - an i18n key    (errors.E####)  → translated for display
//   - a category     → drives the toast/dialog severity styling
//   - optional retry/reset semantics  → drives action buttons
//
// New codes are added at the bottom of the table; codes are never
// renumbered (telemetry, support tickets, and bug reports refer to the
// number long after the message wording has changed). When a code goes
// away, we keep the entry with `deprecated: true` so old reports still
// resolve.

export type ErrorCategory = "fatal" | "error" | "warning" | "info";

export interface ErrorActionability {
  /** When set, the toast renders a Retry button and calls this on click. */
  retry?: () => Promise<void> | void;
  /** When set, the dialog renders an Open Folder / Open Settings link. */
  openSettings?: string;
}

export interface ErrorDescriptor {
  code: string;
  i18nKey: string;
  category: ErrorCategory;
  /** Marks the code as no longer emitted by current code paths. */
  deprecated?: boolean;
}

// Reserved range conventions — codes are short, mnemonic, and grouped
// by subsystem so a number tells you the area at a glance.
//   E1### — file system
//   E2### — AI providers
//   E3### — plugins
//   E4### — keychain / security
//   E5### — updater
//   E6### — runtime / crash
//   E9### — internal / unexpected
export const ERROR_TABLE: Record<string, ErrorDescriptor> = {
  E1001: { code: "E1001", i18nKey: "errors.E1001.disk-full",       category: "error" },     // S-ER-001
  E1002: { code: "E1002", i18nKey: "errors.E1002.fs-permission",   category: "error" },     // S-ER-002
  E1003: { code: "E1003", i18nKey: "errors.E1003.unmounted",       category: "error" },     // S-ER-004
  E1004: { code: "E1004", i18nKey: "errors.E1004.file-locked",     category: "error" },     // S-ER-005
  E1005: { code: "E1005", i18nKey: "errors.E1005.path-too-long",   category: "error" },     // S-ER-006
  E1006: { code: "E1006", i18nKey: "errors.E1006.encoding-mismatch", category: "warning" }, // S-ER-007
  E2001: { code: "E2001", i18nKey: "errors.E2001.ai-network",      category: "error" },     // S-ER-003
  E2002: { code: "E2002", i18nKey: "errors.E2002.ai-context-truncated", category: "warning" },
  E3001: { code: "E3001", i18nKey: "errors.E3001.plugin-activate", category: "error" },
  E3002: { code: "E3002", i18nKey: "errors.E3002.plugin-permission-denied", category: "warning" },
  E4001: { code: "E4001", i18nKey: "errors.E4001.keychain-missing", category: "warning" },  // S-ER-010
  E5001: { code: "E5001", i18nKey: "errors.E5001.update-network",  category: "warning" },
  E5002: { code: "E5002", i18nKey: "errors.E5002.update-signature", category: "fatal" },
  E5003: { code: "E5003", i18nKey: "errors.E5003.update-downgrade", category: "warning" },
  E6001: { code: "E6001", i18nKey: "errors.E6001.crash-recovered", category: "info" },      // S-ER-008
  E6002: { code: "E6002", i18nKey: "errors.E6002.oom-large-file",  category: "error" },     // S-ER-009
  E9999: { code: "E9999", i18nKey: "errors.E9999.unknown",         category: "error" },
};

export function describe(code: string): ErrorDescriptor {
  return ERROR_TABLE[code] ?? ERROR_TABLE.E9999!;
}

// Wrap an unknown thrown value as a structured error. Native errors keep
// their stack; everything else is coerced to a string. The descriptor is
// resolved lazily so callers can include extra context fields without
// duplicating the i18n key.
export interface AppError {
  code: string;
  message: string;
  category: ErrorCategory;
  cause: unknown;
  /** Extra k/v context the toast / dialog can render. */
  context?: Record<string, string | number>;
}

export function makeError(code: string, cause: unknown, context?: AppError["context"]): AppError {
  const d = describe(code);
  const message = (cause instanceof Error ? cause.message : String(cause)) || code;
  return {
    code: d.code,
    category: d.category,
    cause,
    message,
    ...(context !== undefined && { context }),
  };
}

// Rust IPC errors arrive as `{code: "E1001", message: "...", context: {...}}`.
// This helper normalises them into the same AppError shape used renderer-side.
export function fromIpcError(raw: unknown): AppError {
  if (!raw || typeof raw !== "object") return makeError("E9999", raw);
  const r = raw as Record<string, unknown>;
  if (typeof r.code === "string" && r.code in ERROR_TABLE) {
    const ctx = typeof r.context === "object" && r.context ? (r.context as Record<string, string | number>) : undefined;
    return {
      ...describe(r.code),
      message: typeof r.message === "string" ? r.message : "",
      cause: raw,
      ...(ctx !== undefined && { context: ctx }),
    };
  }
  return makeError("E9999", raw);
}

// POSIX-style codes coming back from the Rust `AppError` (`EIO`, `ENOENT`,
// `EACCES`, `EISDIR`, `ENOSPC`, `EOUTSIDE_WORKSPACE`, …). They are NOT the
// same as the curated `E####` ticket codes above — those are surfaced by
// higher-level workflows (telemetry, support tickets) while these come
// from raw filesystem calls. We map them to i18n keys so the editor can
// render a readable message instead of `io: …`. The `t()` call site is
// expected to pass a fallback string for languages that don't (yet)
// translate the key.
export interface PosixErrorMessage {
  i18nKey: string;
  fallback: string;
}

export function describePosixIpcError(raw: unknown): PosixErrorMessage {
  const code = raw && typeof raw === "object" ? (raw as { code?: unknown }).code : undefined;
  switch (code) {
    case "EISDIR":
      return {
        i18nKey: "errors.posix.isdir",
        fallback: "This path is a folder, not a file.",
      };
    case "ENOENT":
      return {
        i18nKey: "errors.posix.enoent",
        fallback: "File not found. It may have been moved or deleted.",
      };
    case "EACCES":
      return {
        i18nKey: "errors.posix.eacces",
        fallback: "Permission denied. Check the file’s read permissions.",
      };
    case "ENOSPC":
      return {
        i18nKey: "errors.posix.enospc",
        fallback: "Not enough disk space.",
      };
    case "EOUTSIDE_WORKSPACE":
      return {
        i18nKey: "errors.posix.outside_workspace",
        fallback: "This path is outside the current workspace.",
      };
    case "ENOTUTF8":
      return {
        i18nKey: "errors.posix.enotutf8",
        fallback: "This file’s encoding could not be decoded as text.",
      };
    case "EINVAL":
      return {
        i18nKey: "errors.posix.einval",
        fallback: "The request was invalid.",
      };
    default:
      return {
        i18nKey: "errors.posix.eio",
        fallback: "Could not read this file.",
      };
  }
}
