// S-PL-001..004: plugin manifest schema + validator.
//
// Every plugin ships a `manifest.json` describing its identity, kind,
// permissions, and contribution points. The host validates the manifest
// before booting the sandbox — bad manifests are rejected with a clear
// error so plugin authors see the failure immediately.
//
// We use a lightweight hand-rolled validator rather than pulling in ajv
// for two reasons:
//
//   1. The schema is small enough that explicit code is shorter than
//      the JSON-schema document plus the ajv runtime.
//   2. Error messages are more diagnostic — we tell the author the
//      offending field name and what shape it should have, rather than
//      the cryptic ajv vocabulary.
//
// If the schema grows past ~10 fields with conditional shapes we'll
// switch to ajv. Until then this stays.

export type PluginKind = "parser" | "ai" | "command" | "view";

export interface PluginManifest {
  /** Stable identifier — also used as the storage namespace. */
  id: string;
  /** Human-readable display name. */
  name: string;
  /** SemVer of the plugin itself. */
  version: string;
  /** Plugin runtime contract — Worker (parser/ai) vs iframe (command/view). */
  kind: PluginKind;
  /** Required Markspread runtime version, semver range. */
  engines: { markspread: string };
  /** Activation triggers — see S-PL-017..020. */
  activationEvents: string[];
  /** Permissions the plugin requires (S-PL-011..016). */
  permissions: PluginPermission[];
  /** Optional metadata. */
  description?: string;
  publisher?: string;
  homepage?: string;
  /** Contribution points — varies by kind. Validated at registration time. */
  contributes?: Record<string, unknown>;
}

export type PluginPermission =
  | "fs.workspace-read"
  | "fs.workspace-write"
  | "fs.outside"
  | { network: string[] }      // S-PL-014: explicit hostname allow-list
  | { keychain: string[] }     // S-PL-015: alias allow-list
  | "shell";                   // S-PL-016: always denied in v1

export interface ManifestValidationError {
  path: string;
  message: string;
}

const ID_RE = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/;
const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

const VALID_KINDS: PluginKind[] = ["parser", "ai", "command", "view"];

const VALID_ACTIVATION_PREFIXES = ["onLanguage:", "onCommand:", "onView:"];
const VALID_BARE_ACTIVATIONS = new Set(["onStartup"]);

export function validateManifest(input: unknown): { ok: true; value: PluginManifest } | { ok: false; errors: ManifestValidationError[] } {
  const errors: ManifestValidationError[] = [];
  const expectObject = (path: string, v: unknown): v is Record<string, unknown> => {
    if (!v || typeof v !== "object" || Array.isArray(v)) {
      errors.push({ path, message: "expected object" });
      return false;
    }
    return true;
  };

  if (!expectObject("$", input)) return { ok: false, errors };
  const m = input;

  // S-PL-002: required fields. Each missing field gets its own error so
  // the plugin author sees the full list in one shot.
  const required = ["id", "name", "version", "kind", "engines", "activationEvents", "permissions"];
  for (const k of required) if (!(k in m)) errors.push({ path: k, message: "required field missing" });
  if (errors.length > 0) return { ok: false, errors };

  if (typeof m.id !== "string" || !ID_RE.test(m.id)) {
    errors.push({ path: "id", message: "must be lowercase, 1..64 chars, [a-z0-9._-], not starting/ending in punctuation" });
  }
  if (typeof m.name !== "string" || m.name.length === 0 || m.name.length > 80) {
    errors.push({ path: "name", message: "must be a non-empty string ≤80 chars" });
  }
  if (typeof m.version !== "string" || !SEMVER_RE.test(m.version)) {
    errors.push({ path: "version", message: "must be a SemVer string (e.g. 1.2.3)" });
  }
  if (typeof m.kind !== "string" || !VALID_KINDS.includes(m.kind as PluginKind)) {
    errors.push({ path: "kind", message: `must be one of ${VALID_KINDS.join(", ")}` });
  }
  // S-PL-003: engines.markspread is required and must be a non-empty range.
  if (!expectObject("engines", m.engines) || typeof m.engines.markspread !== "string") {
    errors.push({ path: "engines.markspread", message: "must be a SemVer range string (e.g. ^1.0.0)" });
  }
  if (!Array.isArray(m.activationEvents)) {
    errors.push({ path: "activationEvents", message: "must be an array of strings" });
  } else {
    m.activationEvents.forEach((evt, i) => {
      if (typeof evt !== "string") {
        errors.push({ path: `activationEvents[${i}]`, message: "must be a string" });
        return;
      }
      const matches = VALID_ACTIVATION_PREFIXES.some((p) => evt.startsWith(p)) || VALID_BARE_ACTIVATIONS.has(evt);
      if (!matches) errors.push({ path: `activationEvents[${i}]`, message: `unknown activation event "${evt}"` });
    });
  }
  if (!Array.isArray(m.permissions)) {
    errors.push({ path: "permissions", message: "must be an array" });
  } else {
    m.permissions.forEach((p, i) => {
      if (typeof p === "string") {
        if (p !== "fs.workspace-read" && p !== "fs.workspace-write" && p !== "fs.outside" && p !== "shell") {
          errors.push({ path: `permissions[${i}]`, message: `unknown permission "${p}"` });
        }
      } else if (expectObject(`permissions[${i}]`, p)) {
        if ("network" in p && Array.isArray(p.network)) return;
        if ("keychain" in p && Array.isArray(p.keychain)) return;
        errors.push({ path: `permissions[${i}]`, message: "object permission must be {network: [...]} or {keychain: [...]}" });
      }
    });
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: m as unknown as PluginManifest };
}

// S-PL-003: semver range compatibility check. We don't pull in the full
// `semver` library; the host version is fixed at build time and we
// support the four range shapes the manifest is allowed to use:
//   - ^X.Y.Z   (caret)
//   - ~X.Y.Z   (tilde)
//   - >=X.Y.Z  (gte)
//   - X.Y.Z    (exact)
export function isHostCompatible(hostVersion: string, requiredRange: string): boolean {
  const host = parseSemver(hostVersion);
  if (!host) return false;
  const range = requiredRange.trim();
  if (range.startsWith("^")) {
    const want = parseSemver(range.slice(1));
    if (!want) return false;
    return host.major === want.major && cmp(host, want) >= 0;
  }
  if (range.startsWith("~")) {
    const want = parseSemver(range.slice(1));
    if (!want) return false;
    return host.major === want.major && host.minor === want.minor && cmp(host, want) >= 0;
  }
  if (range.startsWith(">=")) {
    const want = parseSemver(range.slice(2).trim());
    if (!want) return false;
    return cmp(host, want) >= 0;
  }
  const want = parseSemver(range);
  if (!want) return false;
  return cmp(host, want) === 0;
}

interface SemverParts { major: number; minor: number; patch: number }

function parseSemver(s: string): SemverParts | null {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(s);
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

function cmp(a: SemverParts, b: SemverParts): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

// S-PL-004: id collision detector. We surface a clear "two plugins claim
// the same id" error rather than letting the second registration silently
// shadow the first.
export class PluginIdCollisionError extends Error {
  readonly id: string;
  readonly existingPath: string;
  readonly newPath: string;
  constructor(id: string, existingPath: string, newPath: string) {
    super(`plugin id "${id}" is already registered (existing: ${existingPath}, new: ${newPath})`);
    this.id = id;
    this.existingPath = existingPath;
    this.newPath = newPath;
    this.name = "PluginIdCollisionError";
  }
}
