// S-PR-001 / S-PR-002 / S-PR-003 / S-PR-007: the markdown -> HTML
// pipeline used by the preview pane.
//
// Pipeline (single render call):
//   markdown source
//     → unified.parse (remark-parse + remark-gfm)
//     → remark-rehype
//     → rehype-raw       (so authored inline HTML survives)
//     → rehype-shiki     (S-PR-007)  — when a host registers a
//                                       highlighter, otherwise a
//                                       no-op pass.
//     → rehype-stringify
//     → sanitizeHtml     (S-MD-041/042 — strict whitelist)
//   HTML string ─────────────────────► consumer injects via
//                                       `dangerouslySetInnerHTML`
//
// The renderer is intentionally synchronous-looking — `render()`
// returns a Promise<string> so we can await Shiki's async
// highlighter without blocking the caller's render loop. We also
// expose `createDebouncedRenderer(delay)` (S-PR-002) which the
// preview component uses to coalesce keystrokes.

import { BUILTIN_MARKDOWN_ID, getParserRegistry } from "../parsers/registry";
import { type SandboxTransport, renderInSandbox } from "../parsers/renderer-host";
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
        { default: remarkRehype },
        { default: rehypeRaw },
        { default: rehypeStringify },
      ] = await Promise.all([
        import("unified"),
        import("remark-parse"),
        import("remark-gfm"),
        import("remark-rehype"),
        import("rehype-raw"),
        import("rehype-stringify"),
      ]);
      const processor = unified()
        .use(remarkParse)
        .use(remarkGfm)
        .use(remarkRehype, { allowDangerousHtml: true })
        .use(rehypeRaw)
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
}

export async function render(md: string, opts: RenderOptions = {}): Promise<string> {
  if (opts.path && opts.transport) {
    const matched = getParserRegistry().match({
      path: opts.path,
      ...(opts.frontmatter ? { frontmatter: opts.frontmatter } : {}),
    });
    if (matched && matched.parser.manifest.id !== BUILTIN_MARKDOWN_ID) {
      const result = await renderInSandbox(opts.transport, {
        type: "parse",
        requestId: `r-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        parserId: matched.parser.manifest.id,
        path: opts.path,
        content: md,
        encoding: opts.encoding ?? "utf-8",
      });
      if (result.kind === "html") return result.html;
      if (result.kind === "error") {
        console.warn("[preview/render] sandbox parse failed", result);
        // fall through to builtin pipeline so the document remains visible.
      }
      // 'ast' result has no host renderer yet; fall through too.
    }
  }
  const pipeline = await loadPipeline();
  let html = await pipeline(md);
  if (opts.highlightCode) {
    html = await applyCodeHighlight(html, opts.highlightCode);
  }
  return sanitizeHtml(html, opts);
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
    const start = m.index ?? 0;
    parts.push(html.slice(last, start));
    const lang = m[1] ?? "";
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
  return function debouncedRender(md: string, opts?: RenderOptions): Promise<string | null> {
    const my = ++token;
    return new Promise((resolve) => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(async () => {
        const html = await render(md, opts);
        resolve(my === token ? html : null);
      }, delay);
    });
  };
}
