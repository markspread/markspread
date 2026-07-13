// ADR-0013 / H4: 사용자가 chat 으로 LLM 과 만든 파서 JS 소스를 *런타임에* 등록.
//
// SC-SEC-01..04 (ADR-0016 다층 방어) — 본 모듈이 합성 지점이다:
//   1. Validator (T5.B)      — 위반 발견 시 *등록 거부* (ok:false + violations).
//   2. TrustRegistry (T5.G)  — llm-generated 로 등록.
//   3. 활성 동의 (T5.F)       — 등록 ≠ 동의. consent.action === "show" 를 caller
//                              (CreateParserDialog / ParserWorkbench) 가
//                              PluginConsentDialog 로 노출, Accept 시에만
//                              resolveParserConsent → recordConsent + 활성.
//   4. Worker 격리 (ADR-0012) — llm-generated 소스는 메인스레드에서 실행하지
//                              않는다. 활성 시 runtime-transport 가 Worker 를
//                              띄워 transport-registry 에 등록하고, ParserRegistry
//                              에는 in-process 실행을 차단하는 guard factory 만
//                              들어간다. Sanitizer(T5.C)/BudgetGuard(T5.D) 는
//                              preview/render.ts 의 sandbox 경로가 적용.

import type {
  ParseInput,
  ParseOutput,
  ParserFactory,
  ParserManifest,
} from "@markspread/parser-sdk";
import {
  type ConsentDecision,
  type ConsentEvaluation,
  evaluateConsent,
} from "../plugins/runtime/consent";
import { getOrchestrator } from "../plugins/runtime/orchestrator-singleton";
import { type Violation, analyse } from "../plugins/runtime/validator";
import { getParserRegistry } from "./registry";
import {
  activateRuntimeParser,
  disposeRuntimeParser,
  stripFactorySource,
} from "./runtime-transport";

/** 런타임(register-from-source) 파서 식별용 manifest entry 마커. */
export const RUNTIME_PARSER_ENTRY = "inline:llm-generated";

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
  /**
   * 파서 워크벤치 라이브 프리뷰(sentinel 등록) 전용. 활성 동의 다이얼로그 없이
   * 즉시 활성한다 — 코드 전문이 바로 옆 에디터에 노출된 개발 루프라 T5.F 의
   * "요약 + 전체 코드 + Accept" 표면이 이미 충족돼 있고, 격리·Validator·
   * BudgetGuard 는 동일하게 적용된다. 실제 확장자 등록([적용]/Create) 경로는
   * 이 플래그를 절대 사용하지 않는다.
   */
  workbenchPreview?: boolean;
}

export interface RegisterFromSourceResult {
  ok: boolean;
  /** validator 가 발견한 위반 — caller 가 UI 에 표시 (위반 존재 시 등록 거부됨) */
  violations: Violation[];
  error?: string;
  /**
   * ok === true 일 때의 동의 평가. action === "show" 면 caller 가
   * PluginConsentDialog(prompt) 를 띄우고 resolveParserConsent 로 마무리한다.
   */
  consent?: ConsentEvaluation;
  /** transport 까지 활성돼 즉시 렌더 가능한 상태인가 (동의 완료/불필요). */
  activated?: boolean;
}

/**
 * 사용자 입력 JS source → ParserFactory. **local trust 전용** — llm-generated
 * 소스는 이 함수를 거치지 않는다 (Worker 안에서만 평가; ADR-0012 A.(a) 거부).
 *
 * exported: hot-reload 의 디스크 로더 (hot-reload-tauri.ts) 가 사용한다.
 * `.markspread/parsers/` 디스크 파서는 ADR-0012 C1 의 "사용자가 직접 보유한
 * 코드 = 사용자 신뢰(local)" 이므로 in-process 평가가 허용된다.
 */
export function evaluateFactory(source: string): ParserFactory | Error {
  try {
    const body = `return (${stripFactorySource(source)})`;
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

/**
 * 문법 검사 전용 — Function constructor 는 *컴파일만* 하고 body 를 실행하지
 * 않으므로 untrusted 소스에 안전하다. shape 오류("factory must be a function")
 * 는 Worker 안 평가 시점에 parse:err 로 표면화된다.
 */
export function compileFactorySource(source: string): Error | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    new Function(`return (${stripFactorySource(source)})`);
    return null;
  } catch (e) {
    return e instanceof Error ? e : new Error(String(e));
  }
}

// 동의 대기 중(consent.action === "show") 파서의 소스 — Accept 시 Worker spawn 에 필요.
const pendingConsentSources = new Map<string, string>();

/**
 * llm-generated 파서의 ParserRegistry factory 는 in-process 실행을 차단하는
 * guard 다 — 실행은 오직 renderInSandbox(Worker) 경로로만 일어난다.
 */
function makeGuardFactory(id: string): ParserFactory {
  return () => ({
    ast: {
      kind: "raw",
      value: `[${id}] 이 파서는 sandbox 전용입니다 — in-process 실행이 차단되었습니다 (ADR-0016).`,
    },
  });
}

export function registerParserFromSource(input: RegisterFromSourceInput): RegisterFromSourceResult {
  // 1. Validator — 위반은 곧 등록 거부 (SC-SEC-02). false-positive override 는
  //    local trust 에만 허용되는데(ADR-0016 T5.B) 본 경로는 항상 llm-generated.
  const violations = analyse(input.source);
  if (violations.length > 0) {
    return {
      ok: false,
      violations,
      error: `Validator 위반 ${violations.length}건 — 등록이 거부되었습니다`,
    };
  }

  // 2. 문법 검사 (컴파일 전용 — 실행 없음)
  const compileErr = compileFactorySource(input.source);
  if (compileErr) {
    return { ok: false, violations, error: compileErr.message };
  }

  // 3. Manifest + registry 등록. 같은 id 의 *런타임 파서* 재등록은 교체
  //    (registry 항목만 — trust/consent 는 유지: ADR-0016 T5.F "수정마다 X").
  const registry = getParserRegistry();
  const existing = registry.list().find((p) => p.manifest.id === input.id);
  if (existing && existing.manifest.entry === RUNTIME_PARSER_ENTRY) {
    registry.unregisterParser(input.id);
  }
  const manifest: ParserManifest = {
    id: input.id,
    version: "0.0.1",
    displayName: input.displayName,
    fileMatch: { extensions: input.extensions },
    capabilities: "preview-only",
    entry: RUNTIME_PARSER_ENTRY,
  };
  try {
    registry.registerParser(manifest, makeGuardFactory(input.id));
  } catch (e) {
    return {
      ok: false,
      violations,
      error: e instanceof Error ? e.message : String(e),
    };
  }

  // 4. Trust registry — llm-generated. (재등록 시 기존 entry 유지 → consentedAt 보존)
  const now = Date.now();
  const orch = getOrchestrator();
  try {
    orch.trust.register(input.id, "llm-generated", {
      now,
      authoredBy: "user-chat",
    });
  } catch (e) {
    // Trust registry might reject downgrade — not fatal for parser usage
    console.warn("[register-from-source] trust register failed", e);
  }

  // 5. 활성 동의 (T5.F). 워크벤치 프리뷰는 개발 루프 표면 자체가 동의 UI 와
  //    등가라 즉시 동의 기록 (input.workbenchPreview 주석 참고).
  if (input.workbenchPreview) {
    try {
      orch.trust.recordConsent(input.id, now);
    } catch (e) {
      console.warn("[register-from-source] workbench consent record failed", e);
    }
  }
  const consent = evaluateConsent(input.id, orch.trust, {
    fullSource: input.source,
    oneLinerSummary: input.oneLinerSummary ?? "(요약 없음)",
    violations,
  });

  if (consent.action === "show") {
    // Worker spawn 은 Accept 이후 (resolveParserConsent). 그 전까지 렌더는
    // preview/render.ts 의 동의 게이트가 차단한다.
    pendingConsentSources.set(input.id, input.source);
    return { ok: true, violations, consent, activated: false };
  }

  // local / already-consented / workbenchPreview → 즉시 Worker 활성.
  activateRuntimeParser(input.id, input.source);
  pendingConsentSources.delete(input.id);
  return { ok: true, violations, consent, activated: true };
}

/**
 * PluginConsentDialog 의 사용자 결정 처리 (SC-SEC-04).
 *   accept → recordConsent + Worker 활성.
 *   reject → 파서 등록 자체를 롤백 (미활성 유령 등록을 남기지 않는다).
 */
export function resolveParserConsent(
  id: string,
  decision: ConsentDecision,
): { activated: boolean } {
  const source = pendingConsentSources.get(id);
  if (decision === "accept") {
    if (source === undefined) return { activated: false };
    try {
      getOrchestrator().trust.recordConsent(id, Date.now());
    } catch (e) {
      console.warn("[register-from-source] consent record failed", e);
      return { activated: false };
    }
    activateRuntimeParser(id, source);
    pendingConsentSources.delete(id);
    return { activated: true };
  }
  pendingConsentSources.delete(id);
  unregisterParser(id);
  return { activated: false };
}

/**
 * Unregister 헬퍼 — 테스트 정리 + 사용자가 "remove parser" 버튼 누를 때.
 * transport(Worker)/suspend 상태/trust 까지 함께 정리한다.
 */
export function unregisterParser(id: string): void {
  getParserRegistry().unregisterParser(id);
  pendingConsentSources.delete(id);
  disposeRuntimeParser(id);
  try {
    getOrchestrator().trust.reset(id);
  } catch {
    // ignore
  }
}
