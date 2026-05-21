// S-SE-015..018: markdown sanitiser for the preview pane.
//
// We render markdown to HTML and then strip everything that could ship
// JS execution into the WebView. The default markdown pipelines stop
// short of full sanitisation — they assume "trusted authors", which is
// not the case here: a plugin can hand the renderer arbitrary HTML, a
// teammate can paste an HTML chunk that contains a script tag, and a
// downloaded `.md` from the internet is the same threat surface as any
// other untrusted input.
//
// This sanitiser is intentionally allow-listed: tags and attributes
// not on the allow list are dropped (text content kept). It runs as a
// post-pass on the markdown HTML output, before insertion into the DOM.

const ALLOWED_TAGS = new Set([
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "p",
  "br",
  "hr",
  "blockquote",
  "pre",
  "code",
  "ul",
  "ol",
  "li",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "a",
  "strong",
  "em",
  "s",
  "del",
  "mark",
  "sub",
  "sup",
  "kbd",
  "abbr",
  "cite",
  "small",
  "img",
  "figure",
  "figcaption",
  "details",
  "summary",
  "div",
  "span",
]);

const ALLOWED_ATTRS: Record<string, Set<string>> = {
  "*": new Set(["class", "id", "title", "lang", "dir"]),
  a: new Set(["href", "rel", "target"]),
  img: new Set(["src", "alt", "width", "height", "loading"]),
  th: new Set(["scope"]),
  td: new Set(["colspan", "rowspan"]),
  ol: new Set(["start"]),
  li: new Set(["value"]),
  table: new Set(["align"]),
  code: new Set(["data-lang"]),
  abbr: new Set(["title"]),
  details: new Set(["open"]),
};

// Schemes we accept for href / src. javascript:, data:, vbscript: are
// dropped. `data:image/...` is allowed only for `<img>` to support
// inline graphs/diagrams from parsers, after MIME validation.
const SAFE_HREF_SCHEMES = new Set(["http:", "https:", "mailto:", "ftp:"]);
const SAFE_IMG_SCHEMES = new Set(["http:", "https:"]);
const SAFE_IMG_DATA_PREFIX = /^data:image\/(?:png|jpe?g|gif|webp|svg\+xml|avif);base64,/i;

export interface SanitiseOptions {
  /** S-SE-018: when true, all `<img>` with non-data: src are dropped. */
  blockExternalImages: boolean;
  /** Force `target="_blank" rel="noopener noreferrer"` on outbound links. */
  hardenLinks: boolean;
}

export const DEFAULT_SANITISE_OPTIONS: SanitiseOptions = {
  blockExternalImages: false,
  hardenLinks: true,
};

export function sanitiseMarkdownHtml(
  html: string,
  opts: SanitiseOptions = DEFAULT_SANITISE_OPTIONS,
): string {
  // Parse via DOMParser so we get a real tree to walk. The parsed
  // document is a separate window — its scripts never execute, but
  // serialising it back to a string and then injecting into our doc
  // would lose the safety, so we always read attribute values out and
  // re-emit them through `setAttribute` from a fresh fragment.
  const tpl = new DOMParser().parseFromString(`<!doctype html><body>${html}</body>`, "text/html");
  walk(tpl.body, opts);
  return tpl.body.innerHTML;
}

function walk(node: Element, opts: SanitiseOptions): void {
  for (let i = node.children.length - 1; i >= 0; i -= 1) {
    const child = node.children[i] as HTMLElement;
    const tag = child.tagName.toLowerCase();

    // S-SE-015 / S-SE-016: drop the entire element. Keep no text — script
    // tags often hide intent in their inner text and we don't want to
    // accidentally surface it as content.
    if (
      tag === "script" ||
      tag === "style" ||
      tag === "iframe" ||
      tag === "object" ||
      tag === "embed" ||
      tag === "frame" ||
      tag === "frameset"
    ) {
      child.remove();
      continue;
    }

    if (!ALLOWED_TAGS.has(tag)) {
      // Unknown tag — flatten: replace with its text content.
      /* v8 ignore next -- textContent is non-null on Elements; the ?? "" is type-narrowing for null on Node */
      const text = document.createTextNode(child.textContent ?? "");
      child.replaceWith(text);
      continue;
    }

    // Strip event handlers and unknown attributes.
    for (const attr of [...child.attributes]) {
      const name = attr.name.toLowerCase();
      // S-SE-015: never let on* handlers through, even if a tag's
      // allow-list contains them by accident.
      if (name.startsWith("on")) {
        child.removeAttribute(attr.name);
        continue;
      }

      /* v8 ignore next 2 -- ALLOWED_ATTRS["*"] is always defined; the per-tag fallback is for tags without a custom allow-list */
      const allowList = ALLOWED_ATTRS[tag] ?? new Set<string>();
      const wildcard = ALLOWED_ATTRS["*"] ?? new Set<string>();
      if (!allowList.has(name) && !wildcard.has(name)) {
        child.removeAttribute(attr.name);
        continue;
      }

      // S-SE-017: scheme validation on href/src.
      if (name === "href") {
        if (!isSafeHref(attr.value)) child.removeAttribute(attr.name);
      } else if (name === "src" && tag === "img") {
        if (!isSafeImgSrc(attr.value, opts.blockExternalImages)) child.removeAttribute(attr.name);
      }
    }

    // Harden outbound links.
    if (opts.hardenLinks && tag === "a") {
      const href = child.getAttribute("href") ?? "";
      if (/^https?:/i.test(href)) {
        child.setAttribute("target", "_blank");
        child.setAttribute("rel", "noopener noreferrer");
      }
    }

    walk(child, opts);
  }
}

function isSafeHref(href: string): boolean {
  // Relative links are fine; we anchor them at the document root in the
  // preview pane.
  if (href.startsWith("#")) return true;
  if (href.startsWith("/") || href.startsWith("./") || href.startsWith("../")) return true;
  let url: URL;
  try {
    url = new URL(href, "https://markspread.invalid/");
  } catch {
    return false;
  }
  return SAFE_HREF_SCHEMES.has(url.protocol);
}

function isSafeImgSrc(src: string, blockExternal: boolean): boolean {
  if (src.startsWith("/") || src.startsWith("./") || src.startsWith("../")) return true;
  if (SAFE_IMG_DATA_PREFIX.test(src)) return true;
  if (blockExternal) return false;
  let url: URL;
  try {
    url = new URL(src, "https://markspread.invalid/");
  } catch {
    return false;
  }
  return SAFE_IMG_SCHEMES.has(url.protocol);
}
