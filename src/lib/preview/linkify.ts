// S-MD-040: preview-side autolink for plain-text URLs.
//
// CommonMark only autolinks `<https://…>` syntax; users frequently
// paste bare URLs in prose. We post-process the rendered DOM and
// wrap http(s)/mailto matches with `<a>`. We respect existing links
// (skip text inside `<a>` ancestors) and skip `<code>`, `<pre>`,
// `<kbd>`, `<style>`, `<script>` to avoid mangling code samples.
//
// The regex deliberately stops at common trailing punctuation so a
// sentence-ending dot doesn't get swallowed.

const URL_RE = /\b(https?:\/\/[^\s<>"']+|www\.[^\s<>"']+|mailto:[^\s<>"']+)/g;
const SKIP_TAGS = new Set(["A", "CODE", "PRE", "KBD", "STYLE", "SCRIPT"]);

function shouldSkip(node: Node): boolean {
  let cur: Node | null = node;
  while (cur && cur.nodeType === Node.ELEMENT_NODE) {
    if (SKIP_TAGS.has((cur as Element).tagName)) return true;
    cur = cur.parentNode;
  }
  return false;
}

function trimTrailing(url: string): { href: string; trail: string } {
  // Pull trailing punctuation off the URL so prose like "see https://x.com." renders correctly.
  let href = url;
  let trail = "";
  while (href.length > 0 && /[.,;:!?)\]}'"]/.test(href[href.length - 1] ?? "")) {
    trail = (href[href.length - 1] ?? "") + trail;
    href = href.slice(0, -1);
  }
  return { href, trail };
}

export function linkifyTextNodes(root: ParentNode): void {
  const walker = document.createTreeWalker(root as Node, NodeFilter.SHOW_TEXT);
  const targets: Text[] = [];
  let n = walker.nextNode();
  while (n) {
    if (n.nodeValue && URL_RE.test(n.nodeValue)) {
      URL_RE.lastIndex = 0;
      const parent = n.parentNode;
      if (parent && !shouldSkip(parent)) targets.push(n as Text);
    }
    URL_RE.lastIndex = 0;
    n = walker.nextNode();
  }
  for (const text of targets) {
    const value = text.nodeValue ?? "";
    URL_RE.lastIndex = 0;
    const frag = document.createDocumentFragment();
    let last = 0;
    let m = URL_RE.exec(value);
    while (m !== null) {
      if (m.index > last) {
        frag.appendChild(document.createTextNode(value.slice(last, m.index)));
      }
      const { href, trail } = trimTrailing(m[0]);
      const a = document.createElement("a");
      a.href = href.startsWith("www.") ? `https://${href}` : href;
      a.textContent = href;
      a.rel = "noopener noreferrer";
      a.target = "_blank";
      frag.appendChild(a);
      if (trail) frag.appendChild(document.createTextNode(trail));
      last = m.index + m[0].length;
      m = URL_RE.exec(value);
    }
    if (last < value.length) {
      frag.appendChild(document.createTextNode(value.slice(last)));
    }
    text.parentNode?.replaceChild(frag, text);
  }
}
