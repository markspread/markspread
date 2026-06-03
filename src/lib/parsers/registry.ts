// S-PSDK-002: 호스트 측 ParserRegistry 싱글톤 + 기본 파서 부트스트랩.
//
// 플러그인 모듈은 `@markspread/parser-sdk` 의 registerParser 를 호출하면
// setRegistryHost 로 주입된 이 싱글톤으로 위임된다. v1 의 markdown 파서를
// 기본(fallback) 파서로 등록해 등록되지 않은 확장자 파일을 열어도 기존 동작이
// 유지된다.

import {
  type ParseInput,
  type ParseOutput,
  type ParserManifest,
  ParserRegistry,
  setRegistryHost,
} from "@markspread/parser-sdk";

export const BUILTIN_MARKDOWN_ID = "builtin-markdown";

const MARKDOWN_MANIFEST: ParserManifest = {
  id: BUILTIN_MARKDOWN_ID,
  version: "1.0.0",
  displayName: "Markdown",
  fileMatch: {
    // 기본 노출 확장자. tie-break (registry.ts 의 sort) 가 *최근 등록 우선*
    // 이므로 사용자가 동일 확장자에 custom 파서를 등록하면 그 파서가 이긴다.
    extensions: [".md", ".markdown", ".mdown", ".mkd"],
  },
  capabilities: "preview-plus-edit",
  entry: "builtin:markdown",
};

// 기본 파서도 다른 모든 런타임 파서와 동일한 흐름을 거친다 — render.ts 의
// handleInProcessAst 가 `kind: "markdown"` 을 보면 host 의 markdown-it
// 파이프라인으로 다시 전달한다 (사용자 일관성 요구). 즉 "특수 builtin 경로"
// 가 사라지고 모든 매칭이 동일한 factory→AST→render 사이클을 거친다.
function markdownFactory({ content }: ParseInput): ParseOutput {
  return { ast: { kind: "markdown", source: content } };
}

let singleton: ParserRegistry | null = null;

export function getParserRegistry(): ParserRegistry {
  if (!singleton) {
    singleton = new ParserRegistry();
    singleton.registerParser(MARKDOWN_MANIFEST, markdownFactory);
    // 시스템 lock — 사용자가 UI/SDK 어디서든 unregister 호출해도 거부됨.
    // markdown 은 마지막 안전망 (fallback) 이라 삭제되면 일반 텍스트 파일
    // 열기가 깨진다.
    singleton.markSystem(BUILTIN_MARKDOWN_ID);
    singleton.setFallback(BUILTIN_MARKDOWN_ID);
    setRegistryHost(singleton);
  }
  return singleton;
}

// ADR-0019 §Decision.5 (T5): 자작(local-trust) 파서 개수.
//
// rail 노출 게이트가 쓰는 신호. registry 에 등록된 파서 중 *시스템 파서가
// 아니고* Parser Studio 의 임시 프리뷰 파서도 아닌 것만 센다 — 즉 사용자가
// 의도적으로 만든 파서만. builtin markdown(시스템 lock)·studio 프리뷰는 제외.
export const STUDIO_PREVIEW_PARSER_ID = "__studio_preview__";

export function countUserParsers(): number {
  const reg = getParserRegistry();
  let count = 0;
  for (const p of reg.list()) {
    const id = p.manifest.id;
    if (reg.isSystem(id)) continue;
    if (id === STUDIO_PREVIEW_PARSER_ID) continue;
    count++;
  }
  return count;
}

// 테스트 전용 — 새 격리된 registry 로 재시작.
export function __resetParserRegistryForTests(): void {
  singleton = null;
  setRegistryHost(null);
}
