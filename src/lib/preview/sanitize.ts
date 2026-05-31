// S-MD-041 / S-MD-042: HTML sanitiser for the preview pane.
//
// We render markdown via a remark/rehype pipeline and pass the
// resulting HTML through this function before injecting into the
// DOM. The whitelist mirrors GitHub's safe HTML subset (kbd, sub,
// sup, etc.) and explicitly drops <script>, <iframe>, <object>,
// <embed>, on*= handler attributes, javascript:/data: URLs.
//
// We use the platform DOMParser instead of bringing in a full
// dependency. The cost is that we re-parse the HTML twice (the
// preview pipeline does it again on injection), which is fine at
// preview-render rates (debounced to ~300ms in S-PR-002).
//
// ---------------------------------------------------------------------
// CROSS-REFERENCE — two sanitisers coexist in this repo:
//   1. THIS file  (`src/lib/preview/sanitize.ts`) — LENIENT.
//      The full preview pipeline emits mermaid/katex SVG plus
//      GitHub-style semantic tags (<section>, <time>, <dfn>, <var>,
//      ruby, etc.), so this allowlist is wider than the strict one.
//   2. `src/lib/security/markdown-sanitize.ts` — STRICT. Wraps the
//      output of *plugins* (untrusted third-party code) inside
//      `src/lib/parsers/renderer-host.ts`; it drops everything not
//      in core GFM.
//
// INVARIANT (enforced by `src/lib/security/sanitiser-convergence.test.ts`):
//   The strict sanitiser's ALLOWED_TAGS MUST be a subset of THIS
//   allowlist. BOTH MUST drop <script>/<style>/<iframe>/<object>/
//   <embed>, on* handlers, and javascript:/data: URLs. Diverging on
//   dangerous tags is a security regression — add the test, not an
//   exception.
// ---------------------------------------------------------------------

export const ALLOWED_TAGS = new Set<string>([
  "a",
  "abbr",
  "b",
  "blockquote",
  "br",
  "caption",
  "cite",
  "code",
  "col",
  "colgroup",
  "dd",
  "del",
  "details",
  "dfn",
  "div",
  "dl",
  "dt",
  "em",
  "figcaption",
  "figure",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "i",
  "img",
  // input: GFM task list (`<input type="checkbox">`). attribute filter 가
  // `disabled` 외 모든 dangerous attr 차단 + type=checkbox 외엔 무시.
  "input",
  "ins",
  "kbd",
  "li",
  "mark",
  "ol",
  "p",
  "picture",
  "pre",
  "q",
  "rp",
  "rt",
  "ruby",
  "s",
  "samp",
  "section",
  "small",
  "source",
  "span",
  "strong",
  "sub",
  "summary",
  "sup",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "time",
  "tr",
  "u",
  "ul",
  "var",
  "wbr",
  // mermaid/katex container markers preserved if class allowed
  "svg",
  "g",
  "path",
  "rect",
  "circle",
  "line",
  "polygon",
  "polyline",
  "text",
  "tspan",
]);

const ALLOWED_ATTRS: Record<string, Set<string>> = {
  "*": new Set([
    "id",
    "class",
    "title",
    "lang",
    "dir",
    "data-task-line",
    "data-language",
    "aria-label",
    "aria-hidden",
    "role",
  ]),
  a: new Set(["href", "target", "rel", "name", "download"]),
  img: new Set(["src", "alt", "width", "height", "loading", "srcset", "sizes"]),
  source: new Set(["src", "srcset", "type", "media"]),
  picture: new Set([]),
  pre: new Set(["data-language"]),
  code: new Set(["data-language"]),
  // GFM task list checkbox — disabled 만 의미있음. type/checked 도 허용.
  input: new Set(["type", "checked", "disabled"]),
  td: new Set(["align", "colspan", "rowspan"]),
  th: new Set(["align", "colspan", "rowspan", "scope"]),
  table: new Set(["align"]),
  details: new Set(["open"]),
  time: new Set(["datetime"]),
  // svg subset for mermaid/katex
  svg: new Set(["viewBox", "width", "height", "xmlns", "preserveAspectRatio"]),
  path: new Set(["d", "fill", "stroke", "stroke-width", "transform"]),
  rect: new Set(["x", "y", "width", "height", "fill", "stroke", "rx", "ry", "transform"]),
  circle: new Set(["cx", "cy", "r", "fill", "stroke", "transform"]),
  line: new Set(["x1", "y1", "x2", "y2", "stroke", "stroke-width", "transform"]),
  polygon: new Set(["points", "fill", "stroke", "transform"]),
  polyline: new Set(["points", "fill", "stroke", "transform"]),
  text: new Set([
    "x",
    "y",
    "dx",
    "dy",
    "fill",
    "transform",
    "text-anchor",
    "font-size",
    "font-family",
  ]),
  tspan: new Set(["x", "y", "dx", "dy", "fill"]),
  g: new Set(["transform", "fill", "stroke"]),
};

const SAFE_URL_RE = /^(?:https?:|mailto:|tel:|ftp:|#|\/|\.\.?\/)/i;

export interface SanitizeOptions {
  /** Block remote images entirely (S-PR-004). */
  blockRemoteImages?: boolean;
}

function safeAttrValue(name: string, value: string): boolean {
  if (name === "href" || name === "src" || name === "action" || name === "formaction") {
    if (value.trim() === "") return true;
    return SAFE_URL_RE.test(value.trim());
  }
  return true;
}

export function sanitizeHtml(html: string, opts: SanitizeOptions = {}): string {
  const doc = new DOMParser().parseFromString(`<div id="ms-root">${html}</div>`, "text/html");
  const root = doc.getElementById("ms-root");
  /* v8 ignore next -- DOMParser always returns a document containing the wrapper div */
  if (!root) return "";
  walk(root, opts);
  return root.innerHTML;
}

function walk(node: Element, opts: SanitizeOptions): void {
  for (const child of Array.from(node.children)) {
    const tag = child.tagName.toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) {
      // Replace the disallowed element with its (sanitised)
      // children so prose around <script>/<iframe> survives.
      while (child.firstChild) node.insertBefore(child.firstChild, child);
      node.removeChild(child);
      continue;
    }
    // Strip on* handlers + non-whitelisted attributes.
    const attrSet = ALLOWED_ATTRS[tag] ?? new Set<string>();
    /* v8 ignore next -- ALLOWED_ATTRS["*"] is statically declared, so the fallback never triggers */
    const star = ALLOWED_ATTRS["*"] ?? new Set<string>();
    for (const attr of Array.from(child.attributes)) {
      const n = attr.name.toLowerCase();
      // data-* 는 wildcard 허용 — custom 런타임 파서 (예: wireweave 의
      // data-edge, data-node 등) 가 임의 hook attr 을 자유롭게 쓸 수
      // 있도록. data-* 자체는 코드 실행을 트리거하지 않음. on* 이벤트
      // 핸들러는 여전히 차단.
      const isDataAttr = n.startsWith("data-");
      const allowed = attrSet.has(n) || star.has(n) || isDataAttr;
      if (!allowed || n.startsWith("on")) {
        child.removeAttribute(attr.name);
        continue;
      }
      if (!safeAttrValue(n, attr.value)) {
        child.removeAttribute(attr.name);
      }
    }
    if (tag === "img" && opts.blockRemoteImages) {
      const src = child.getAttribute("src") ?? "";
      if (/^https?:\/\//i.test(src)) {
        child.removeAttribute("src");
        child.setAttribute("data-blocked", "remote");
      }
    }
    if (tag === "input") {
      // 보안: type 이 checkbox 가 아닌 input 은 모두 제거 (text/file/submit
      // 등 form 흐름 차단). disabled 자동 부여 — task list 는 표시용일 뿐
      // 토글은 별도 plugin (checkboxToggle.ts) 이 attach 함.
      const type = (child.getAttribute("type") ?? "").toLowerCase();
      if (type !== "checkbox") {
        /* v8 ignore next -- <input> is a void element, so a parsed input never has children; child.firstChild is always null and this unwrap loop body never runs (defensive mirror of the generic disallowed-tag unwrap above) */
        while (child.firstChild) node.insertBefore(child.firstChild, child);
        node.removeChild(child);
        continue;
      }
      child.setAttribute("disabled", "");
    }
    if (tag === "a") {
      // Force noopener on every external link (defense in depth).
      const href = child.getAttribute("href") ?? "";
      if (/^https?:\/\//i.test(href)) {
        child.setAttribute("rel", "noopener noreferrer");
        child.setAttribute("target", "_blank");
      }
    }
    walk(child, opts);
  }
}
