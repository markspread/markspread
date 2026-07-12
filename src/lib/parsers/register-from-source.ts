// ADR-0013 / H4: 사용자가 chat 으로 LLM 과 만든 파서 JS 소스를 *런타임에* 등록.
//
// 본 모듈은 source 문자열 → ParserFactory 변환 + ParserRegistry 등록 + (선택) 디스크 저장.
// 격리는 *minimal* — Function constructor 로 evaluate. ADR-0016 의 Validator 가 정적 검증
// 통과한 코드만 호출자가 전달해야 함 (caller responsibility).
//
// 안전성 layer:
//   1. Validator (ADR-0016 T5.B) — caller 가 호출 (UI dialog 에서)
//   2. TrustRegistry (ADR-0016 T5.G) — caller 가 trust level 등록 (caller 가 llm-generated)
//   3. Sanitizer (ADR-0016 T5.C) — SpreadPane 렌더 시 자동
//   4. BudgetGuard (ADR-0016 T5.D) — PluginOrchestrator 가 적용

import type {
  ParseInput,
  ParseOutput,
  ParserFactory,
  ParserManifest,
} from "@markspread/parser-sdk";
import { getOrchestrator } from "../plugins/runtime/orchestrator-singleton";
import { analyse } from "../plugins/runtime/validator";
import { getParserRegistry } from "./registry";

export interface RegisterFromSourceInput {
  /** plugin id — unique, slug 형식 권장 */
  id: string;
  /** 사용자-제공 displayName */
  displayName: string;
  /** 처리할 파일 확장자 (예: [".wireweave", ".ww"]) */
  extensions: string[];
  /** factory JS 소스. `(input: ParseInput) => ParseOutput` 형태의 default export */
  source: string;
  /** LLM 이 작성한 한 줄 요약 (consent dialog 용) */
  oneLinerSummary?: string;
}

export interface RegisterFromSourceResult {
  ok: boolean;
  /** validator 가 발견한 위반 — caller 가 UI 에 표시 */
  violations: ReturnType<typeof analyse>;
  error?: string;
}

/**
 * 사용자 입력 JS source → ParserFactory.
 *
 * source 의 마지막 expression 이 factory function 이어야 함. 또는
 * `export default factory` 형태 (CJS 도 OK).
 *
 * 본 함수는 *동기 evaluate*. 외부 의존성 import 는 지원 안 함 (eval 환경).
 *
 * exported: hot-reload 의 디스크 로더 (hot-reload-tauri.ts) 가 같은
 * source→factory 변환을 재사용한다 — 두 경로의 evaluate 규칙이 갈라지면
 * 워크벤치에서 되던 파서가 디스크 리로드에서 깨지는 종류의 버그가 생긴다.
 */
export function evaluateFactory(source: string): ParserFactory | Error {
  try {
    // FIX: 이전엔 source 안에 'return' 이 *inner 함수 body* 에 있으면 wrap 을 skip 했음.
    //      그 return 은 inner 함수 것 — outer Function 은 여전히 wrap 필요.
    //      `export default` / `module.exports =` 만 strip 하고, 나머지는 항상 `return (...)` 으로 wrap.
    const stripped = source
      .replace(/^\s*export\s+default\s+/m, "")
      .replace(/^\s*module\.exports\s*=\s*/m, "");
    const body = `return (${stripped.trim()})`;
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const fn = new Function(body) as () => unknown;
    const result = fn();
    if (typeof result !== "function") {
      return new Error(`factory must be a function, got ${typeof result}`);
    }
    // Wrap with type cast
    return ((input: ParseInput): ParseOutput => {
      const r = (result as (i: ParseInput) => unknown)(input);
      if (r && typeof r === "object" && "ast" in r) return r as ParseOutput;
      return { ast: { kind: "raw", value: r } };
    }) as ParserFactory;
  } catch (e) {
    return e instanceof Error ? e : new Error(String(e));
  }
}

export function registerParserFromSource(input: RegisterFromSourceInput): RegisterFromSourceResult {
  // 1. Validator
  const violations = analyse(input.source);

  // 2. Evaluate factory
  const factoryOrErr = evaluateFactory(input.source);
  if (factoryOrErr instanceof Error) {
    return { ok: false, violations, error: factoryOrErr.message };
  }

  // 3. Manifest
  const manifest: ParserManifest = {
    id: input.id,
    version: "0.0.1",
    displayName: input.displayName,
    fileMatch: { extensions: input.extensions },
    capabilities: "preview-only",
    entry: "inline:llm-generated",
  };

  // 4. Register in singleton
  try {
    getParserRegistry().registerParser(manifest, factoryOrErr);
  } catch (e) {
    return {
      ok: false,
      violations,
      error: e instanceof Error ? e.message : String(e),
    };
  }

  // 5. Trust registry — llm-generated
  try {
    const now = Date.now();
    const orch = getOrchestrator();
    orch.trust.register(input.id, "llm-generated", {
      now,
      authoredBy: "user-chat",
    });
    // Mark consented since user explicitly hit "Create" button
    orch.trust.recordConsent(input.id, now);
  } catch (e) {
    // Trust registry might reject downgrade — not fatal for parser usage
    console.warn("[register-from-source] trust register failed", e);
  }

  return { ok: true, violations };
}

/**
 * Unregister 헬퍼 — 테스트 정리 + 사용자가 "remove parser" 버튼 누를 때.
 */
export function unregisterParser(id: string): void {
  getParserRegistry().unregisterParser(id);
  try {
    getOrchestrator().trust.reset(id);
  } catch {
    // ignore
  }
}
