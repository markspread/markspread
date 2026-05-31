// ADR-0016 (T5.C): 파서 출력 sanitization (DOMPurify + Markspread allowlist).
//
// 다층 방어의 *런타임* 층. Validator (T5.B) 가 작성 시점 차단을 했더라도,
// LLM 이 생성한 코드가 *실행* 단계에서 위험한 HTML/SVG 를 만들 수 있으니
// 출력을 항상 sanitize.
//
// 정책:
//   - strict 모드 (publish 사이트 + imported trust level): script/style/iframe/object/embed
//     완전 차단. SVG 도 strict subset 만. onclick 같은 inline event 제거.
//   - relaxed 모드 (local 미리보기 + 사용자 toggle): 일부 inline style 허용. 단 script/iframe
//     은 여전히 차단.
//
// DOMPurify 의존성은 *지연 import* — 본 모듈 import 시점에 즉시 로드하지 않음 (T1
// 가벼움 정책). 첫 sanitize() 호출 시 dynamic import.

export interface SanitizeOptions {
  /** strict 모드 — publish 사이트 + imported trust level 에서 true. default false (relaxed). */
  strict?: boolean;
  /** 사용자 추가 allowed tag 목록 (e.g. mermaid 다이어그램용 'svg'). */
  extraAllowedTags?: readonly string[];
  /** 사용자 추가 allowed attribute 목록. */
  extraAllowedAttrs?: readonly string[];
}

export interface SanitizeResult {
  html: string;
  /** 원본에서 제거된 tag 들 (디버그·텔레메트리). */
  removed: readonly string[];
}

// Allowlist baselines. 의도적으로 작게 시작 — 사용자 요구 따라 extend.
const STRICT_ALLOWED_TAGS = [
  "a",
  "b",
  "blockquote",
  "br",
  "code",
  "em",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "i",
  "img",
  "li",
  "ol",
  "p",
  "pre",
  "span",
  "strong",
  "table",
  "tbody",
  "td",
  "th",
  "thead",
  "tr",
  "ul",
] as const;

const RELAXED_EXTRA_TAGS = [
  "details",
  "summary",
  "div",
  "section",
  "article",
  "figure",
  "figcaption",
] as const;

const STRICT_ALLOWED_ATTRS = [
  "href",
  "src",
  "alt",
  "title",
  "class",
  "id",
  "colspan",
  "rowspan",
  "lang",
  "dir",
] as const;

const RELAXED_EXTRA_ATTRS = ["style"] as const;

const BLOCKED_TAGS_ALWAYS = [
  "script",
  "iframe",
  "object",
  "embed",
  "applet",
  "form",
  "input",
] as const;

interface DOMPurifyLike {
  sanitize(
    input: string,
    config: {
      ALLOWED_TAGS: string[];
      ALLOWED_ATTR: string[];
      FORBID_TAGS: string[];
      ALLOW_DATA_ATTR: boolean;
      WHOLE_DOCUMENT: boolean;
      RETURN_TRUSTED_TYPE: boolean;
    },
  ): string;
  removed?: Array<{ element?: { tagName?: string }; attribute?: { name?: string } }>;
}

let cachedDom: Promise<DOMPurifyLike> | null = null;

/**
 * DOMPurify 지연 로드. 첫 sanitize() 호출 시점에만 로드. 이후 동일 promise 재사용.
 * 테스트 환경에서는 setSanitizer() 로 mock 주입 가능.
 */
async function getDOMPurify(): Promise<DOMPurifyLike> {
  if (!cachedDom) {
    cachedDom = (async () => {
      const mod = await import("dompurify");
      // jsdom 환경에서는 글로벌 window 가 있으므로 그대로. Node 순수 환경은
      // 별도 setup (vitest.setup.ts) 에서 처리.
      const ctor = (mod as { default?: unknown }).default ?? mod;
      const factory = ctor as ((win?: unknown) => DOMPurifyLike) | DOMPurifyLike;
      if (typeof factory === "function") {
        return (factory as (win?: unknown) => DOMPurifyLike)(
          typeof window === "undefined" ? undefined : window,
        );
      }
      return factory as DOMPurifyLike;
    })();
  }
  return cachedDom;
}

/** 테스트 hook — DOMPurify-like 객체를 직접 주입. */
export function setSanitizer(s: DOMPurifyLike): void {
  cachedDom = Promise.resolve(s);
}

/** 테스트 정리용. */
export function resetSanitizer(): void {
  cachedDom = null;
}

export async function sanitize(html: string, opts: SanitizeOptions = {}): Promise<SanitizeResult> {
  const strict = opts.strict === true;
  const allowedTags = [
    ...STRICT_ALLOWED_TAGS,
    ...(strict ? [] : RELAXED_EXTRA_TAGS),
    ...(opts.extraAllowedTags ?? []),
  ];
  const allowedAttrs = [
    ...STRICT_ALLOWED_ATTRS,
    ...(strict ? [] : RELAXED_EXTRA_ATTRS),
    ...(opts.extraAllowedAttrs ?? []),
  ];

  const dom = await getDOMPurify();
  const out = dom.sanitize(html, {
    ALLOWED_TAGS: allowedTags,
    ALLOWED_ATTR: allowedAttrs,
    FORBID_TAGS: [...BLOCKED_TAGS_ALWAYS],
    ALLOW_DATA_ATTR: !strict,
    WHOLE_DOCUMENT: false,
    RETURN_TRUSTED_TYPE: false,
  });

  const removedNames = (dom.removed ?? [])
    .map((r) => r.element?.tagName ?? r.attribute?.name)
    .filter((n): n is string => typeof n === "string");

  return { html: String(out), removed: removedNames };
}

/** sync version 의 *알림용* helper — 호출자가 await 못 쓸 때 (rare). */
export function sanitizeSync(_html: string, _opts: SanitizeOptions = {}): SanitizeResult {
  throw new Error(
    "sanitizeSync is intentionally unimplemented — use async sanitize(). DOMPurify load is async.",
  );
}
