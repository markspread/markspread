// S-PSDK-002: 호스트 측 ParserRegistry 싱글톤 + 기본 파서 부트스트랩.
//
// 플러그인 모듈은 `@markspread/parser-sdk` 의 registerParser 를 호출하면
// setRegistryHost 로 주입된 이 싱글톤으로 위임된다. v1 의 markdown 파서를
// 기본(fallback) 파서로 등록해 등록되지 않은 확장자 파일을 열어도 기존 동작이
// 유지된다.

import {
  ParserRegistry,
  setRegistryHost,
  type ParseInput,
  type ParseOutput,
  type ParserManifest,
} from "@markspread/parser-sdk";

export const BUILTIN_MARKDOWN_ID = "builtin-markdown";

const MARKDOWN_MANIFEST: ParserManifest = {
  id: BUILTIN_MARKDOWN_ID,
  version: "1.0.0",
  displayName: "Markdown",
  fileMatch: {
    // 기본 노출 확장자. fallback 등록으로 인해 매칭되지 않는 경로도 이 파서로 떨어진다.
    extensions: [".md", ".markdown", ".mdown", ".mkd"],
  },
  capabilities: "preview-plus-edit",
  entry: "builtin:markdown",
};

// 기본 파서는 raw 마크다운 문자열을 AST 로 변환하지 않고 그대로 통과시킨다.
// 실제 렌더 파이프라인(`src/lib/preview/render.ts`)이 markdown-it 기반으로
// 직접 처리하므로 SDK 추상은 "어떤 파서가 책임지는가" 만 표현한다.
function markdownFactory({ content }: ParseInput): ParseOutput {
  return { ast: { kind: "markdown", source: content } };
}

let singleton: ParserRegistry | null = null;

export function getParserRegistry(): ParserRegistry {
  if (!singleton) {
    singleton = new ParserRegistry();
    singleton.registerParser(MARKDOWN_MANIFEST, markdownFactory);
    singleton.setFallback(BUILTIN_MARKDOWN_ID);
    setRegistryHost(singleton);
  }
  return singleton;
}

// 테스트 전용 — 새 격리된 registry 로 재시작.
export function __resetParserRegistryForTests(): void {
  singleton = null;
  setRegistryHost(null);
}
