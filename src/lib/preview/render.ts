// S-PR-001 / S-PR-002 / S-PR-003 / S-PR-007: the markdown -> HTML
// pipeline used by the preview pane.
//
// Pipeline (single render call):
//   markdown source
//     → strip frontmatter (S-MD-047 — metadata never renders as body)
//     → unified.parse (remark-parse + remark-gfm + remark-math)
//     → remark-rehype
//     → rehype-raw       (so authored inline HTML survives)
//     → rehype ms-math   (S-MD-044/045 — rewrite remark-math output
//                                       into `.ms-math` placeholders
//                                       for the KaTeX consumer)
//     → rehype-stringify
//     → sanitizeHtml     (S-MD-041/042 — strict whitelist)
//     → highlightCode    (S-PR-007)  — when a host registers a
//                                       highlighter, otherwise a
//                                       no-op pass. Runs *after*
//                                       sanitize: Shiki token styles
//                                       are trusted-tool output, same
//                                       model as the mermaid/KaTeX
//                                       DOM plugins.
//   HTML string ─────────────────────► consumer injects via
//                                       `dangerouslySetInnerHTML`
//
// The renderer is intentionally synchronous-looking — `render()`
// returns a Promise<string> so we can await Shiki's async
// highlighter without blocking the caller's render loop. We also
// expose `createDebouncedRenderer(delay)` (S-PR-002) which the
// preview component uses to coalesce keystrokes.

import type { MatchResult } from "@markspread/parser-sdk";
import { useToasts } from "../../store/toasts";
import { parseFrontmatter } from "../markdown/frontmatter";
import { BUILTIN_MARKDOWN_ID, getParserRegistry } from "../parsers/registry";
import { type SandboxTransport, renderInSandbox } from "../parsers/renderer-host";
import { getRuntimeParserSuspension, suspendRuntimeParser } from "../parsers/runtime-transport";
import { getParserTransport } from "../parsers/transport-registry";
import { BUDGETS, describeOutcome, measureAsync } from "../plugins/runtime/budget-guard";
import { getOrchestrator } from "../plugins/runtime/orchestrator-singleton";
import { type SanitizeOptions, sanitizeHtml } from "./sanitize";

// We keep dependencies optional to make this module safe to import
// in unit-test environments that don't ship the full markdown
// stack. Production Vite builds will bundle them eagerly.
let pipelinePromise: Promise<RenderFn> | null = null;

type RenderFn = (md: string) => Promise<string>;

async function loadPipeline(): Promise<RenderFn> {
  if (pipelinePromise) return pipelinePromise;
  pipelinePromise = (async () => {
    try {
      const [
        { unified },
        { default: remarkParse },
        { default: remarkGfm },
        { default: remarkMath },
        { default: remarkRehype },
        { default: rehypeRaw },
        { default: rehypeStringify },
      ] = await Promise.all([
        import("unified"),
        import("remark-parse"),
        import("remark-gfm"),
        import("remark-math"),
        import("remark-rehype"),
        import("rehype-raw"),
        import("rehype-stringify"),
      ]);
      const processor = unified()
        .use(remarkParse)
        .use(remarkGfm)
        .use(remarkMath)
        .use(remarkRehype, { allowDangerousHtml: true })
        .use(rehypeRaw)
        .use(rehypeMsMath)
        .use(rehypeStringify, { allowDangerousHtml: true });
      return async (md: string) => {
        const file = await processor.process(md);
        return String(file);
      };
    } catch {
      // Fallback: a tiny escape-and-paragraph renderer so the app
      // remains usable even when the bundle is missing.
      return async (md: string) =>
        md
          .split(/\n\n+/)
          .map((p) => `<p>${escapeHtml(p)}</p>`)
          .join("\n");
    }
  })();
  return pipelinePromise;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// S-MD-047 / SC-BASE-04: frontmatter is document metadata, never body.
// Strip it before the markdown pipeline so `---\ntitle: x\n---` doesn't
// leak into the preview as a thematic break + heading. Only the builtin
// pipeline strips — custom parsers keep receiving the full document
// (their manifests may key on frontmatter).
function stripFrontmatter(md: string): string {
  return parseFrontmatter(md)?.body ?? md;
}

// Minimal structural hast node — enough for the math-placeholder walk
// below without pulling hast types into the runtime module graph.
interface HastNode {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

// S-MD-044/045 / SC-BASE-03: remark-math emits
//   `$x$`   → <code class="language-math math-inline">…</code>
//   `$$x$$` → <pre><code class="language-math math-display">…</code></pre>
// while the KaTeX consumer (katex.ts renderMathIn, run by SpreadPane)
// expects `.ms-math` placeholders with data-mode="inline|block". This
// rehype step rewrites the math elements into that contract before
// stringify/sanitise. It runs after rehype-raw so authored inline HTML
// has already been normalised into real elements.
function rehypeMsMath() {
  return (tree: HastNode) => walkMath(tree);
}

function mathModeOf(node: HastNode): "inline" | "display" | null {
  if (node.type !== "element") return null;
  const cls = node.properties?.className;
  if (!Array.isArray(cls)) return null;
  if (cls.includes("math-inline")) return "inline";
  if (cls.includes("math-display")) return "display";
  return null;
}

function msMathElement(mode: "inline" | "display", children: HastNode[]): HastNode {
  return {
    type: "element",
    // Block math becomes a <div> so KaTeX display output sits in its own
    // flow box; inline stays a <span>. Both carry the `.ms-math` contract.
    tagName: mode === "display" ? "div" : "span",
    properties: {
      className: ["ms-math"],
      dataMode: mode === "display" ? "block" : "inline",
    },
    children,
  };
}

function walkMath(node: HastNode): void {
  const children = node.children;
  if (!children) return;
  children.forEach((child, i) => {
    // Fenced `$$…$$` blocks arrive as <pre><code class="…math-display">;
    // replace the whole <pre> so the math isn't typeset inside a code box.
    if (child.tagName === "pre") {
      /* v8 ignore next -- hast elements always carry a children array */
      const code = (child.children ?? []).find((c) => mathModeOf(c) === "display");
      if (code) {
        /* v8 ignore next -- ditto: code elements always carry a children array */
        children[i] = msMathElement("display", code.children ?? []);
        return;
      }
    }
    const mode = mathModeOf(child);
    if (mode) {
      /* v8 ignore next -- ditto: code elements always carry a children array */
      children[i] = msMathElement(mode, child.children ?? []);
      return;
    }
    walkMath(child);
  });
}

export interface RenderOptions extends SanitizeOptions {
  /**
   * Optional Shiki-like highlighter; receives `(code, lang)` and
   * returns highlighted HTML. Undefined leaves code blocks as plain
   * `<pre><code>`.
   */
  highlightCode?: (code: string, lang: string) => Promise<string> | string;
  /**
   * T-U10-001-FIX: document path. When set, the renderer asks the
   * parser registry whether a third-party parser claims this file. If
   * one does and a `transport` is supplied, the request is dispatched
   * into the sandbox instead of the builtin markdown pipeline.
   */
  path?: string;
  /**
   * Optional sniffed frontmatter — improves registry match precision
   * for parsers that key on `kind:` / `type:` etc.
   */
  frontmatter?: Record<string, string>;
  /** Per-parser SandboxTransport looked up via transport-registry. */
  transport?: SandboxTransport;
  /** Encoding passed through to the sandbox request (defaults to utf-8). */
  encoding?: string;
  /**
   * AC(축2): 리뷰 모드 파서 선택기 override. 사용자가 SpreadPane 의 파서
   * 셀렉터로 등록된 다른 파서를 명시 선택하면 그 id 를 여기 실어 보낸다.
   * 설정 시 path 기반 `match()` 를 *우회* 하고 해당 id 의 등록 파서로 직접
   * 렌더한다 (그 파서가 이 path 에 매칭되지 않더라도 — 워크벤치 없이 즉석
   * 파서 시험을 가능케 함). 미등록 id 이면 무시하고 정상 match 경로로 폴백.
   */
  forceParserId?: string;
}

export async function render(md: string, opts: RenderOptions = {}): Promise<string> {
  // Routing matrix (모든 매칭이 동일한 factory→AST 사이클을 거친다 —
  // builtin 도 예외 아님; "특수 builtin 경로" 제거):
  //   path 매칭 → factory 호출
  //     sandbox transport 있음 → renderInSandbox (외부 격리 파서)
  //     없음 → in-process factory 직접 호출 (register-from-source / builtin)
  //   AST kind: html | markdown | raw → handleInProcessAst 가 처리
  //   매칭 자체 없음 (no path 등) → builtin pipeline 직접 호출
  if (opts.path) {
    const registry = getParserRegistry();
    // forceParserId 가 등록 파서를 가리키면 match() 를 우회해 그 파서로 직접
    // 렌더 (사용자 선택 override). 미등록이면 null → 정상 match 폴백.
    const forced = opts.forceParserId
      ? registry.list().find((p) => p.manifest.id === opts.forceParserId)
      : undefined;
    const matched: MatchResult | null = forced
      ? { parser: forced, score: 0, reason: "forced" }
      : registry.match({
          path: opts.path,
          ...(opts.frontmatter ? { frontmatter: opts.frontmatter } : {}),
        });
    if (matched) {
      // SC-SEC-01..04 / ADR-0016: 신뢰경계 밖(llm-generated/imported) 파서는
      // in-process 실행 금지 — 동의 게이트 + Worker 격리 + BudgetGuard 를
      // 강제하는 전용 경로로만 렌더한다. builtin / local(사용자 보유 코드,
      // ADR-0012 C1) 파서는 기존 in-process 사이클 유지.
      if (requiresSandbox(matched.parser.manifest.id)) {
        return renderUntrustedRuntimeParser(matched.parser.manifest.id, md, opts);
      }
      // 1순위: sandbox transport (외부 plugin 격리)
      if (opts.transport && matched.parser.manifest.id !== BUILTIN_MARKDOWN_ID) {
        const result = await renderInSandbox(opts.transport, {
          type: "parse",
          requestId: `r-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          parserId: matched.parser.manifest.id,
          path: opts.path,
          content: md,
          encoding: opts.encoding ?? "utf-8",
        });
        if (result.kind === "html") return sanitizeHtml(result.html, opts);
        if (result.kind === "error") {
          console.warn("[preview/render] sandbox parse failed", result);
          // factory 직접 호출로 fall through
        }
      }
      // 2순위: in-process factory (register-from-source + builtin 모두)
      try {
        const out = matched.parser.factory({
          path: opts.path,
          content: md,
          encoding: opts.encoding ?? "utf-8",
        });
        const handled = await handleInProcessAst(out, md, opts);
        if (handled !== null) return handled;
        // null = AST kind 못 알아봤음 → 최후 fallback (raw md → builtin pipeline)
      } catch (e) {
        console.warn(
          `[preview/render] in-process parser '${matched.parser.manifest.id}' threw — falling back to builtin`,
          e,
        );
      }
    }
  }
  // 최후의 fallback: path 자체 없거나 모든 매칭 실패 → host markdown pipeline.
  return renderBuiltinMarkdown(md, opts);
}

// SC-SEC-01 게이트: trust level 이 llm-generated/imported 인 파서만 sandbox
// 강제. trust 미등록(= builtin, 디스크 hot-reload 등 사용자 보유 코드) 은
// ADR-0012 C1 의 사용자 신뢰로 기존 in-process 경로를 탄다.
function requiresSandbox(parserId: string): boolean {
  const level = getOrchestrator().trust.level(parserId);
  return level === "llm-generated" || level === "imported";
}

// 차단 사유를 문서 대신 렌더하는 가시 카드. sanitizeHtml 화이트리스트
// (div/p/strong + data-*) 안에서만 구성한다.
function blockedNoticeHtml(
  parserId: string,
  reason: "consent" | "suspended" | "no-transport" | "error" | "bad-ast",
  detail: string,
  opts: RenderOptions,
): string {
  const id = escapeHtml(parserId);
  const html = `<div class="ms-parser-blocked" data-testid="parser-blocked" data-parser-blocked="${id}" data-blocked-reason="${reason}"><p><strong>${id}</strong> 파서 실행이 차단되었습니다</p><p>${escapeHtml(detail)}</p></div>`;
  return sanitizeHtml(html, opts);
}

/**
 * SC-SEC-01/03/04: llm-generated/imported 파서 전용 렌더 경로.
 *   - 활성 동의(T5.F) 없으면 실행 자체를 차단.
 *   - 실행은 transport-registry 의 Worker transport 로만 (renderInSandbox).
 *     transport 부재 = 차단 (in-process 강등 금지 — R1 SC-SEC-01 결함 클래스).
 *   - BudgetGuard(T5.D) local 100ms 예산으로 measureAsync — 초과 시 worker
 *     suspend + 토스트 알림 + 차단 카드.
 *   - 결과 AST 는 builtin 과 동일한 handleInProcessAst 사이클로 sanitize.
 */
async function renderUntrustedRuntimeParser(
  parserId: string,
  md: string,
  opts: RenderOptions,
): Promise<string> {
  const trust = getOrchestrator().trust;
  if (!trust.hasConsent(parserId)) {
    return blockedNoticeHtml(
      parserId,
      "consent",
      "활성 동의가 필요합니다 — 파서 등록 시 표시되는 동의 다이얼로그에서 수락 후 사용할 수 있습니다 (ADR-0016 T5.F).",
      opts,
    );
  }
  const suspension = getRuntimeParserSuspension(parserId);
  if (suspension) {
    return blockedNoticeHtml(parserId, "suspended", suspension, opts);
  }
  const transport = opts.transport ?? getParserTransport(parserId);
  if (!transport) {
    return blockedNoticeHtml(
      parserId,
      "no-transport",
      "격리 실행 환경(Worker transport)이 없습니다 — 파서를 다시 등록하세요.",
      opts,
    );
  }
  const budget = BUDGETS.local;
  const { result, outcome } = await measureAsync(budget, () =>
    renderInSandbox(
      transport,
      {
        type: "parse",
        requestId: `r-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        parserId,
        path: opts.path ?? "",
        content: md,
        encoding: opts.encoding ?? "utf-8",
      },
      // renderInSandbox 자체 timeout 은 backstop — 실제 예산은 measureAsync.
      { timeoutMs: Math.max(budget.timeCapMs * 10, 1000) },
    ),
  );
  if (outcome.shouldSuspend) {
    const message = describeOutcome(outcome, parserId);
    // 재등록 race 가드: 이 render 가 dispatch 한 transport 가 이미 교체됐다면
    // (워크벤치 debounce 재등록 등) 새 세대 worker 를 suspend 하지 않는다 —
    // stale 타임아웃의 오발 방지. 현행 세대의 초과만 suspend + 알림.
    if (getParserTransport(parserId) === transport) {
      suspendRuntimeParser(parserId, message);
      useToasts.getState().push({ kind: "error", message });
    }
    return blockedNoticeHtml(parserId, "suspended", message, opts);
  }
  /* v8 ignore next 4 -- renderInSandbox resolves(never rejects), so error_thrown/null result only guards future refactors */
  if (!result) {
    return blockedNoticeHtml(parserId, "error", outcome.message ?? "no result", opts);
  }
  if (result.kind === "error") {
    return blockedNoticeHtml(parserId, "error", result.message, opts);
  }
  if (result.kind === "html") {
    return sanitizeHtml(result.html, opts);
  }
  // kind === "ast" — builtin 과 동일한 factory→AST→render 사이클.
  const handled = await handleInProcessAst({ ast: result.ast }, md, opts);
  if (handled !== null) return handled;
  return blockedNoticeHtml(parserId, "bad-ast", "파서가 알 수 없는 AST 를 반환했습니다.", opts);
}

// The builtin markdown path shared by the no-match fallback and the
// `kind: "markdown"` AST branch. Order matters (SC-BASE-05): sanitize
// runs on the pipeline output *first*, then the host highlighter
// rewrites the (already-safe) code blocks — Shiki's per-token `style`
// attributes would not survive the whitelist, and its output is
// trusted-tool HTML built from escaped code text, the same trust model
// as the mermaid/KaTeX post-render DOM plugins.
async function renderBuiltinMarkdown(md: string, opts: RenderOptions): Promise<string> {
  const pipeline = await loadPipeline();
  let html = sanitizeHtml(await pipeline(stripFrontmatter(md)), opts);
  if (opts.highlightCode) {
    html = await applyCodeHighlight(html, opts.highlightCode);
  }
  return html;
}

/**
 * Custom parser 가 반환한 AST 를 host 가 render 가능한 HTML 로 변환.
 *   - kind: "html" → 직접 sanitize
 *   - kind: "markdown" → builtin pipeline 으로 다시 처리 (LLM 파서가 markdown
 *     중간 form 만 변환하는 케이스, 예: wikilink → standard md link 변환)
 *   - kind: "raw" → <pre> 로 escape
 *   - 알 수 없음 → null (caller 가 builtin fallback 진행)
 */
async function handleInProcessAst(
  out: unknown,
  originalMd: string,
  opts: RenderOptions,
): Promise<string | null> {
  if (!out || typeof out !== "object" || !("ast" in out)) return null;
  const ast = (out as { ast: unknown }).ast;
  if (!ast || typeof ast !== "object" || !("kind" in ast)) return null;
  const kind = (ast as { kind: unknown }).kind;
  if (kind === "html") {
    const html = (ast as { html?: unknown }).html;
    if (typeof html !== "string") return null;
    return sanitizeHtml(html, opts);
  }
  if (kind === "markdown") {
    const source = (ast as { source?: unknown }).source;
    const mdText = typeof source === "string" ? source : originalMd;
    return renderBuiltinMarkdown(mdText, opts);
  }
  if (kind === "raw") {
    const value = (ast as { value?: unknown }).value;
    const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
    return sanitizeHtml(`<pre>${escapeHtml(text)}</pre>`, opts);
  }
  return null;
}

const CODE_BLOCK_RE = /<pre><code(?:\s+class="language-([\w+-]+)")?>([\s\S]*?)<\/code><\/pre>/g;

async function applyCodeHighlight(
  html: string,
  highlight: NonNullable<RenderOptions["highlightCode"]>,
): Promise<string> {
  // Walk the matches sequentially — Shiki highlighters tend to be
  // cheap enough that we don't need to fan out, and serialising
  // keeps the resulting HTML deterministic.
  const matches = Array.from(html.matchAll(CODE_BLOCK_RE));
  if (matches.length === 0) return html;
  const decoder = (s: string) =>
    s
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
  let last = 0;
  const parts: string[] = [];
  for (const m of matches) {
    /* v8 ignore next -- matchAll always sets index on emitted matches */
    const start = m.index ?? 0;
    parts.push(html.slice(last, start));
    const lang = m[1] ?? "";
    /* v8 ignore next -- the inner capture group is non-optional, so m[2] is always a string */
    const code = decoder(m[2] ?? "");
    try {
      const replaced = await highlight(code, lang);
      parts.push(replaced);
    } catch {
      parts.push(m[0]);
    }
    last = start + m[0].length;
  }
  parts.push(html.slice(last));
  return parts.join("");
}

// S-PR-002: debounced rerender. Calls render() at most once per
// `delay` ms and resolves the latest call only — older callers see
// `null` so they can short-circuit (no DOM update).
export function createDebouncedRenderer(delay = 300) {
  let timer: number | undefined;
  let token = 0;
  const debouncedRender = (md: string, opts?: RenderOptions): Promise<string | null> => {
    const my = ++token;
    return new Promise((resolve) => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(async () => {
        const html = await render(md, opts);
        /* v8 ignore next -- the prior setTimeout is always cleared before token can advance, so my === token holds for every fired callback */
        resolve(my === token ? html : null);
      }, delay);
    });
  };
  // S-PR-002: cancel a pending debounced render. Callers clear the timer on
  // unmount so a late callback can't run render()/sanitizeHtml after teardown
  // (e.g. node-env tests where DOMParser is undefined, or wasted work in prod).
  debouncedRender.cancel = () => {
    if (timer) window.clearTimeout(timer);
    timer = undefined;
  };
  return debouncedRender;
}
