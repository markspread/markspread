// S-SE-006..014: secret scanner — file-name patterns, content patterns,
// Shannon entropy, allow-list, custom user patterns.
//
// The scanner runs in three places, each tuned for the noise budget the
// user can tolerate:
//
//   - indexing pipeline (S-SE-010): files matching the filename rules
//     and any line matching content rules are *excluded* from the
//     workspace search index. We bias toward false-positives — a
//     missed search hit is much cheaper than a leaked key.
//   - AI context builder (S-SE-011 / S-AI-036): masks at the line level
//     before the bytes leave the renderer.
//   - log writer (S-SE-006): rolling masking on every log line as it's
//     formatted, so a misbehaving plugin can't accidentally log a key.
//
// User-side controls:
//   - allow-list (S-SE-012) for files the user explicitly OKs ("yes,
//     this fixture really does contain a fake `sk-...` value").
//   - custom patterns (S-SE-013) for org-specific secret shapes.
//   - detection log (S-SE-014) so users can see what was caught.

export interface SecretPattern {
  id: string;
  /** Regex to match — must include exactly one capture group around the secret-shaped substring. */
  re: RegExp;
  /** Optional minimum Shannon entropy bits/char, applied to the captured group. */
  minEntropyBits?: number;
  /** Severity label for the detection log. */
  severity: "high" | "medium" | "low";
}

// S-SE-008: built-in content patterns. Mirrors the AI-context list but
// captures the secret group so the scanner can run an entropy check.
export const BUILTIN_CONTENT_PATTERNS: SecretPattern[] = [
  { id: "aws-akia", re: /\b(AKIA[0-9A-Z]{16})\b/g, severity: "high" },
  {
    id: "aws-secret",
    re: /\b([A-Za-z0-9/+]{40})\b(?=\s|$|[^A-Za-z0-9/+])/g,
    severity: "high",
    minEntropyBits: 4.5,
  },
  { id: "github-token", re: /\b(ghp_[A-Za-z0-9]{36})\b/g, severity: "high" },
  { id: "github-fg", re: /\b(github_pat_[A-Za-z0-9_]{82})\b/g, severity: "high" },
  { id: "openai-key", re: /\b(sk-[A-Za-z0-9]{20,})\b/g, severity: "high" },
  { id: "anthropic-key", re: /\b(sk-ant-[A-Za-z0-9-]{40,})\b/g, severity: "high" },
  { id: "google-api", re: /\b(AIza[0-9A-Za-z_-]{35})\b/g, severity: "high" },
  { id: "slack-token", re: /\b(xox[abprs]-[0-9A-Za-z-]{20,})\b/g, severity: "high" },
  { id: "stripe-live", re: /\b(sk_live_[0-9A-Za-z]{24,})\b/g, severity: "high" },
  {
    id: "jwt",
    re: /\b(eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})\b/g,
    severity: "medium",
  },
  // S-SE-021/022: Authorization-style bearer tokens. Opaque OAuth /
  // session tokens never match the issuer-specific patterns above, yet
  // they're exactly what leaks through a crash dump. Capture the token
  // after the `Bearer` keyword so log lines keep the keyword but drop
  // the credential.
  { id: "bearer-token", re: /\bBearer\s+([A-Za-z0-9._~+/=-]{8,})/gi, severity: "high" },
  {
    id: "private-key",
    re: /(-----BEGIN (?:RSA |EC |OPENSSH |)PRIVATE KEY-----[\s\S]*?-----END[^-]*-----)/g,
    severity: "high",
  },
];

// S-SE-007: filename patterns. Files matching any of these names are
// excluded from indexing entirely; their contents never reach the AI
// context unless the user explicitly drags them onto a prompt.
export const SECRET_FILENAME_PATTERNS: RegExp[] = [
  /(^|\/)\.env(\..+)?$/i,
  /(^|\/)id_(rsa|ed25519|ecdsa|dsa)$/,
  /(^|\/).*\.pem$/i,
  /(^|\/).*\.key$/i,
  /(^|\/).*\.pfx$/i,
  /(^|\/).*\.p12$/i,
  /(^|\/)credentials(\.json|\.yaml|\.yml)?$/i,
  /(^|\/)secrets(\.json|\.yaml|\.yml)?$/i,
  /(^|\/)kubeconfig$/i,
];

export function isSecretFilename(path: string): boolean {
  return SECRET_FILENAME_PATTERNS.some((re) => re.test(path));
}

// S-SE-009: Shannon entropy in bits per character. Used to suppress
// false positives on the broad AWS-secret-style 40-char-base64 pattern;
// real secrets carry high entropy whereas hex hashes / base64 versions
// of structured data tend to cluster lower. Threshold 4.5 bits/char is
// the standard rule of thumb (real keys average ~5.0).
export function shannonEntropyBits(s: string): number {
  if (s.length === 0) return 0;
  const freq = new Map<string, number>();
  for (const ch of s) freq.set(ch, (freq.get(ch) ?? 0) + 1);
  let h = 0;
  for (const c of freq.values()) {
    const p = c / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

export interface SecretFinding {
  patternId: string;
  severity: SecretPattern["severity"];
  /** 0-indexed offset where the secret starts in the source. */
  offset: number;
  length: number;
  /** Masked preview — never the raw secret. */
  preview: string;
}

export function scanContent(
  source: string,
  patterns: SecretPattern[] = BUILTIN_CONTENT_PATTERNS,
): SecretFinding[] {
  const out: SecretFinding[] = [];
  for (const p of patterns) {
    p.re.lastIndex = 0;
    let m = p.re.exec(source);
    while (m !== null) {
      const captured = m[1] ?? m[0];
      if (p.minEntropyBits == null || shannonEntropyBits(captured) >= p.minEntropyBits) {
        const start = m.index + Math.max(0, m[0].indexOf(captured));
        out.push({
          patternId: p.id,
          severity: p.severity,
          offset: start,
          length: captured.length,
          preview: maskPreview(captured),
        });
      }
      m = p.re.exec(source);
    }
  }
  return out;
}

function maskPreview(s: string): string {
  if (s.length <= 6) return "•".repeat(s.length);
  return `${s.slice(0, 3)}…••••${s.slice(-3)}`;
}

// S-SE-006: log line masker. Used at the formatter level so any caller
// of the structured logger gets sanitised output without thinking
// about it.
export function maskLogLine(
  line: string,
  patterns: SecretPattern[] = BUILTIN_CONTENT_PATTERNS,
): string {
  let out = line;
  for (const p of patterns) {
    p.re.lastIndex = 0;
    out = out.replace(p.re, (full, captured: string | undefined) => {
      const target = captured ?? full;
      return full.replace(target, `«REDACTED:${p.id}»`);
    });
  }
  return out;
}

// S-SE-012 / S-SE-013: user-supplied configuration. Allow-list paths are
// matched as glob expressions; custom patterns are added to the active
// scan set with the user-provided severity (default "medium").
export interface ScannerConfig {
  allowedFiles: string[]; // globs, e.g. "tests/fixtures/**/*.env"
  customPatterns: SecretPattern[];
}

export const DEFAULT_SCANNER_CONFIG: ScannerConfig = {
  allowedFiles: [],
  customPatterns: [],
};

// S-SE-014: detection log entry. The Privacy panel renders this list
// (most recent first) so users can audit what the scanner caught.
export interface ScannerLogEntry {
  ts: number;
  source: "indexer" | "ai-context" | "logger";
  filePath: string | null;
  findings: SecretFinding[];
}
