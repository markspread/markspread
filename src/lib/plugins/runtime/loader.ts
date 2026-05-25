// S-PL-SEC-001: ADR-0012 manifest validator + plugin loader.
//
// 책임:
//   1. `markspread-plugin.json` 의 zod 검증 (D2 의 모든 제약).
//   2. entry path 의 prefix/traversal 검증 (R6).
//   3. host runtime 버전과 engines.markspread 호환성 (engine 검사는
//      D2 의 "알 수 없는 키는 무시" 정책에 따라 best-effort 으로 수행).
//
// 본 파일은 *순수* — Worker 생성은 `host.ts` 가 담당한다. 그 이유는
// 테스트가 Worker 인스턴스화 없이 validation 만 검증할 수 있어야 하기
// 때문이다.

import { z } from "zod";
import type { PluginManifest } from "./types";

const PERMISSION = z.enum(["network", "fs:read", "fs:write"]);
const RENDER_MODE = z.enum(["html", "react", "iframe-react"]);

const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const NAME_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;

const codeblockContrib = z.object({ render: RENDER_MODE });
const headerContrib = z.object({ render: RENDER_MODE });
const fenceContrib = z.object({
  name: z.string().min(1).max(32),
  render: RENDER_MODE,
});
const inlineRule = z.object({
  pattern: z.string().min(1).max(256),
  flags: z.string().max(8).optional(),
  render: RENDER_MODE,
});

const contributionMap = z.object({
  codeblocks: z.record(codeblockContrib).optional(),
  headers: z.record(headerContrib).optional(),
  fences: z.array(fenceContrib).optional(),
  inlineRules: z.array(inlineRule).optional(),
});

export const ManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    name: z.string().regex(NAME_RE, "name must be alphanumeric+dash, ≤32 chars"),
    version: z.string().regex(SEMVER_RE, "version must be a valid SemVer string"),
    entry: z.string().min(1).max(256),
    displayName: z.string().max(80).optional(),
    description: z.string().max(280).optional(),
    permissions: z.array(PERMISSION).default([]),
    allowedHosts: z.array(z.string().min(1)).default([]),
    contributes: contributionMap.default({}),
    render: RENDER_MODE,
    engines: z.object({ markspread: z.string().min(1) }),
  })
  .passthrough(); // ADR-0012 D2: "알 수 없는 키는 무시 (forward-compat)".

export type ManifestParseError = {
  path: string;
  message: string;
};

export type ManifestParseResult =
  | { ok: true; value: PluginManifest }
  | { ok: false; errors: ManifestParseError[] };

/**
 * 메모리 상의 객체를 manifest 로 검증. zod 의 issues 를 ADR 의 path 형식
 * (`"contributes.codeblocks.wireweave.render"`) 으로 평탄화한다.
 */
export function parseManifest(input: unknown): ManifestParseResult {
  const result = ManifestSchema.safeParse(input);
  if (!result.success) {
    const errors = result.error.issues.map((iss) => ({
      path: iss.path.length === 0 ? "$" : iss.path.join("."),
      message: iss.message,
    }));
    return { ok: false, errors };
  }
  const m = result.data as PluginManifest;

  // D2: network 권한이 있는데 allowedHosts 가 비어 있으면 거부 — fail-safe.
  if (m.permissions.includes("network") && m.allowedHosts.length === 0) {
    return {
      ok: false,
      errors: [
        {
          path: "allowedHosts",
          message: "must be non-empty when 'network' permission is requested",
        },
      ],
    };
  }

  return { ok: true, value: m };
}

/**
 * D2 + R6: entry 가 manifest 디렉터리 prefix 안에 있는지 검증. 절대경로/`..`
 * 거부. 입력은 forward-slash 표기를 가정 (Tauri fs 경로는 platform-native
 * 일 수 있지만 manifest 의 entry 는 portable 표기여야 한다).
 */
export function isEntryWithinPluginDir(entry: string): boolean {
  if (entry.length === 0) return false;
  if (entry.startsWith("/")) return false;
  if (/^[a-zA-Z]:[\\/]/.test(entry)) return false; // Windows drive prefix.
  if (entry.includes("\0")) return false;
  // 정규화 — 모든 `\\` 를 `/` 로 통일한 뒤 segment 단위 검사.
  const normalised = entry.replace(/\\/g, "/");
  const segments = normalised.split("/").filter((s) => s.length > 0);
  for (const seg of segments) {
    if (seg === "..") return false;
  }
  return true;
}

/**
 * raw JSON 문자열을 manifest 로 검증. JSON parse 실패는 `errors[0]` 에
 * 위치 정보 없이 보고된다 (parse 단계에서는 path 가 없음).
 */
export function parseManifestText(raw: string): ManifestParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return {
      ok: false,
      errors: [{ path: "$", message: `JSON parse error: ${(e as Error).message}` }],
    };
  }
  const result = parseManifest(parsed);
  if (!result.ok) return result;
  if (!isEntryWithinPluginDir(result.value.entry)) {
    return {
      ok: false,
      errors: [
        {
          path: "entry",
          message: "entry must be a relative path inside the plugin directory",
        },
      ],
    };
  }
  return result;
}

/**
 * Host runtime version 과 engines.markspread 호환성 체크. 본 호환성
 * 검사는 D2 의 "알 수 없는 키는 무시" 정책과 직교한다 — engines 가
 * 명시되지 않은 buggy manifest 는 zod 단계에서 이미 거부되므로 여기서는
 * 항상 값이 존재한다고 가정한다.
 */
export function isHostCompatible(hostVersion: string, range: string): boolean {
  const host = splitSemver(hostVersion);
  if (!host) return false;
  const r = range.trim();
  if (r.startsWith("^")) {
    const want = splitSemver(r.slice(1));
    if (!want) return false;
    return host[0] === want[0] && compareSemver(host, want) >= 0;
  }
  if (r.startsWith("~")) {
    const want = splitSemver(r.slice(1));
    if (!want) return false;
    return host[0] === want[0] && host[1] === want[1] && compareSemver(host, want) >= 0;
  }
  if (r.startsWith(">=")) {
    const want = splitSemver(r.slice(2).trim());
    if (!want) return false;
    return compareSemver(host, want) >= 0;
  }
  // exact match — gives plugin authors a way to pin during development.
  const want = splitSemver(r);
  if (!want) return false;
  return compareSemver(host, want) === 0;
}

function splitSemver(s: string): [number, number, number] | null {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(s);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function compareSemver(a: [number, number, number], b: [number, number, number]): number {
  for (let i = 0; i < 3; i += 1) {
    const av = a[i] as number;
    const bv = b[i] as number;
    if (av !== bv) return av - bv;
  }
  return 0;
}
