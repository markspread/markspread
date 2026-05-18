// S-PSDK-002: ParserRegistry — manifest 와 factory 를 보관하고 파일 경로/
// frontmatter 기반으로 우선순위 매칭을 수행한다.
//
// 매칭 우선순위 (높을수록 먼저 채택):
//   1. frontmatterSniff 정확 일치 (값 동일)        → score 1000 + 키 개수
//   2. 확장자 정확 일치 (.csv 등 lowercase 비교)   → score 100
//   3. 글롭 패턴 일치                              → score 10
//   (위 셋 다 매칭이 없으면 기본 fallback 파서가 선택된다 — 호스트가 등록함.)
//
// 동일 점수 충돌 시 등록 순서가 깨지지 않도록 안정 정렬. candidates() 는
// 호환 가능한 모든 파서를 점수 내림차순으로 반환하여 UI 가 사용자 선택을
// 보여줄 수 있게 한다 (S-PSDK-003).

import type { ParserManifest } from "./manifest";
import type { ParserFactory, RegistryHost, RendererSpec } from "./register";

export type RegisteredParser = {
  manifest: ParserManifest;
  factory: ParserFactory;
  registrationOrder: number;
};

export type MatchContext = {
  path: string;
  frontmatter?: Record<string, string>;
};

export type MatchResult = {
  parser: RegisteredParser;
  score: number;
  reason: "frontmatter" | "extension" | "glob" | "fallback";
};

export type FallbackKey = "markdown";

const FRONTMATTER_BASE = 1000;
const EXTENSION_SCORE = 100;
const GLOB_SCORE = 10;
const FALLBACK_SCORE = 0;

export class ParserRegistry implements RegistryHost {
  private parsers = new Map<string, RegisteredParser>();
  private renderers = new Map<string, RendererSpec>();
  private fallback: RegisteredParser | null = null;
  private nextOrder = 0;

  registerParser(manifest: ParserManifest, factory: ParserFactory): void {
    if (this.parsers.has(manifest.id)) {
      throw new Error(`Parser '${manifest.id}' is already registered`);
    }
    this.parsers.set(manifest.id, {
      manifest,
      factory,
      registrationOrder: this.nextOrder++,
    });
  }

  unregisterParser(id: string): boolean {
    if (this.fallback?.manifest.id === id) this.fallback = null;
    this.renderers.delete(id);
    return this.parsers.delete(id);
  }

  registerRenderer(spec: RendererSpec): void {
    if (!this.parsers.has(spec.parserId)) {
      throw new Error(`Cannot register renderer for unknown parser '${spec.parserId}'`);
    }
    this.renderers.set(spec.parserId, spec);
  }

  getRenderer(parserId: string): RendererSpec | undefined {
    return this.renderers.get(parserId);
  }

  setFallback(id: string): void {
    const p = this.parsers.get(id);
    if (!p) throw new Error(`Cannot set fallback to unknown parser '${id}'`);
    this.fallback = p;
  }

  list(): RegisteredParser[] {
    return Array.from(this.parsers.values());
  }

  match(ctx: MatchContext): MatchResult | null {
    const ranked = this.candidates(ctx);
    return ranked[0] ?? null;
  }

  candidates(ctx: MatchContext): MatchResult[] {
    const results: MatchResult[] = [];
    for (const p of this.parsers.values()) {
      const scored = scoreParser(p, ctx);
      if (scored) results.push(scored);
    }
    results.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.parser.registrationOrder - b.parser.registrationOrder;
    });
    if (results.length === 0 && this.fallback) {
      results.push({ parser: this.fallback, score: FALLBACK_SCORE, reason: "fallback" });
    }
    return results;
  }
}

function scoreParser(p: RegisteredParser, ctx: MatchContext): MatchResult | null {
  const { manifest } = p;
  const fm = manifest.fileMatch;
  if (fm.frontmatterSniff && ctx.frontmatter) {
    const keys = Object.entries(fm.frontmatterSniff);
    const allMatch = keys.every(([k, v]) => ctx.frontmatter?.[k] === v);
    if (allMatch && keys.length > 0) {
      return { parser: p, score: FRONTMATTER_BASE + keys.length, reason: "frontmatter" };
    }
  }
  if (fm.extensions && fm.extensions.length > 0) {
    const lower = ctx.path.toLowerCase();
    for (const ext of fm.extensions) {
      if (lower.endsWith(ext.toLowerCase())) {
        return { parser: p, score: EXTENSION_SCORE, reason: "extension" };
      }
    }
  }
  if (fm.globs && fm.globs.length > 0) {
    for (const g of fm.globs) {
      if (globMatch(g, ctx.path)) {
        return { parser: p, score: GLOB_SCORE, reason: "glob" };
      }
    }
  }
  return null;
}

// 의도적으로 작은 글롭 구현체. `*` = 0+ 비-슬래시 문자, `**` = 0+ 임의 문자,
// `?` = 1 비-슬래시 문자. minimatch 의 전체 spec 은 v1.3 plugin 격리 단계에서.
export function globMatch(glob: string, path: string): boolean {
  const re = new RegExp(`^${globToRegex(glob)}$`);
  return re.test(path);
}

function globToRegex(glob: string): string {
  let out = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i] as string;
    if (c === "*") {
      if (glob[i + 1] === "*") {
        out += ".*";
        i++;
      } else {
        out += "[^/]*";
      }
    } else if (c === "?") {
      out += "[^/]";
    } else if (".+^$(){}|\\".includes(c)) {
      out += `\\${c}`;
    } else {
      out += c;
    }
  }
  return out;
}
