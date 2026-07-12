// SC-SEC-01..04 (R1 Fix-D): parser 보안 다층방어 wiring guard.
//
// R1 의 결함 클래스는 "모듈 완성, 유닛 green, 라이브 경로 배선 0건" 이었다
// (Validator/BudgetGuard/Consent/Transport 전부). 동작 계약은
// src/lib/preview/parser-security.dom.test.ts 가 실제 모듈 관통으로 고정하고,
// 본 스위트는 유닛/통합 테스트가 볼 수 없는 소스 레벨 시임을 고정한다 —
// preview-boot-wiring.test.ts 와 같은 패턴 (source-level assertion 이 가장
// 값싸고 정직한 검사인 지점만).

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function read(rel: string): string {
  return readFileSync(new URL(`../${rel}`, import.meta.url), "utf-8");
}

describe("parser security wiring (SC-SEC-01..04)", () => {
  it("preview render pipeline gates untrusted parsers through the sandbox path", () => {
    const src = read("lib/preview/render.ts");
    // trust 게이트 + 전용 경로가 render() 본문에 실제로 배선돼 있다.
    expect(src).toContain("requiresSandbox(matched.parser.manifest.id)");
    expect(src).toContain("renderUntrustedRuntimeParser(");
    // BudgetGuard 로컬 예산 + suspend + 토스트 소비자 (SC-SEC-03).
    expect(src).toContain("BUDGETS.local");
    expect(src).toContain("suspendRuntimeParser(");
    expect(src).toContain("useToasts.getState().push");
    // transport-registry 를 render 가 직접 조회 — SpreadPane 외 호출자
    // (ParserWorkbench 등) 도 격리 경로를 탄다.
    expect(src).toContain("getParserTransport(");
  });

  it("register-from-source activates parsers via the worker transport, never eval-on-register", () => {
    const src = read("lib/parsers/register-from-source.ts");
    // Worker transport 활성 배선 (SC-SEC-01).
    expect(src).toContain("activateRuntimeParser(");
    // Validator 거부 배선 (SC-SEC-02): 위반 → ok:false 조기 반환.
    expect(src).toMatch(/violations\.length > 0[\s\S]{0,200}ok: false/);
    // 등록 함수 본문이 evaluateFactory 를 호출하지 않는다 — untrusted 소스의
    // 메인스레드 평가가 R1 SC-SEC-01 의 근원 결함이었다. evaluateFactory 는
    // local-trust 디스크 로더 (hot-reload-tauri) 전용으로만 남는다.
    const registerStart = src.indexOf("export function registerParserFromSource");
    const registerEnd = src.indexOf("export function", registerStart + 1);
    const registerFn = src.slice(registerStart, registerEnd);
    expect(registerFn).not.toContain("evaluateFactory(");
    // 등록 = 자동 동의 금지 (SC-SEC-04): registerParserFromSource 본문의
    // recordConsent 는 워크벤치 프리뷰 분기 1곳뿐이어야 한다 (그 외 동의는
    // resolveParserConsent 의 Accept 경로만).
    expect(registerFn).toContain("if (input.workbenchPreview)");
    expect(registerFn.split("trust.recordConsent(").length - 1).toBe(1);
  });

  it("runtime transport defaults to a real Worker and fails closed without one", () => {
    const src = read("lib/parsers/runtime-transport.ts");
    // 실 Worker 격리 (renderer-host 의 createWorkerTransport 재사용, ADR-0012).
    expect(src).toContain("createWorkerTransport(");
    expect(src).toContain('typeof Worker === "undefined"');
    expect(src).toContain("createFailClosedTransport(");
  });

  it("production code never swaps in the test transport factory", () => {
    // 테스트 시임이 프로덕션에서 호출되면 격리가 무력화된다 — 소비자는
    // 테스트 파일뿐이어야 한다. (본 검사는 대표 소비 지점인 컴포넌트/lib
    // 프로덕션 모듈을 대상으로 한다.)
    for (const rel of [
      "lib/preview/render.ts",
      "lib/parsers/register-from-source.ts",
      "screens/ParserWorkbench.tsx",
      "components/CreateParserDialog.tsx",
      "components/SpreadPane.tsx",
      "main.tsx",
    ]) {
      expect(read(rel)).not.toContain("setRuntimeParserTransportFactoryForTests(");
    }
  });

  it("consent dialog is mounted in both registration surfaces (SC-SEC-04)", () => {
    expect(read("components/CreateParserDialog.tsx")).toContain("<PluginConsentDialog");
    expect(read("screens/ParserWorkbench.tsx")).toContain("<PluginConsentDialog");
  });
});
