// S-ED-052 / S-ED-053: convert pasted HTML / rich text into markdown.
//
// We don't pull in turndown — its tree-walker + GFM plugin is ~30KB
// and most of the rules we'd configure away. Markdown's surface area
// is small enough that a hand-written DOM walk gives the right
// trade-off:
//
//   • Predictable output (no escaping surprises from turndown's GFM
//     extensions).
//   • No tracker scripts / unsafe HTML pulled across — we walk only
//     the elements we whitelist.
//   • Easy to extend per-feedback (e.g. "task list checkbox", "GFM
//     strikethrough").
//
// What we map:
//
//   p, br             → paragraph / hard break
//   h1..h6            → ATX headings
//   strong/b          → **
//   em/i              → *
//   code (inline)     → `…`
//   pre>code          → fenced ``` block (language taken from the
//                       code element's `class="language-X"` if any)
//   a[href]           → [text](href)
//   img[src]          → ![alt](src)
//   ul/ol/li          → - / 1. lists with nesting
//   blockquote        → > prefix (per line)
//   hr                → ---
//   strike/s/del      → ~~ ~~ (GFM)
//   table/tr/td/th    → GFM table when shapes are regular; falls back
//                       to plain text otherwise.

const HEAD_TAGS = new Set(["H1", "H2", "H3", "H4", "H5", "H6"]);

function indent(s: string, prefix: string): string {
  return s
    .split("\n")
    .map((l) => (l.length ? prefix + l : l))
    .join("\n");
}

function attr(el: Element, name: string): string | null {
  return el.getAttribute(name);
}

function cleanInlineWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").replace(/^ | $/g, "");
}

function nodeToMarkdown(node: Node, listDepth: number): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return cleanInlineWhitespace(node.textContent ?? "");
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return "";
  const el = node as Element;
  const tag = el.tagName.toUpperCase();

  if (tag === "BR") return "  \n";
  if (tag === "HR") return "\n\n---\n\n";

  if (HEAD_TAGS.has(tag)) {
    const level = Number(tag.slice(1));
    const inner = childrenToMarkdown(el, listDepth);
    return `\n\n${"#".repeat(level)} ${inner.trim()}\n\n`;
  }

  if (tag === "P") {
    return `\n\n${childrenToMarkdown(el, listDepth).trim()}\n\n`;
  }

  if (tag === "STRONG" || tag === "B") {
    return `**${childrenToMarkdown(el, listDepth)}**`;
  }
  if (tag === "EM" || tag === "I") {
    return `*${childrenToMarkdown(el, listDepth)}*`;
  }
  if (tag === "S" || tag === "STRIKE" || tag === "DEL") {
    return `~~${childrenToMarkdown(el, listDepth)}~~`;
  }

  if (tag === "CODE" && el.parentElement?.tagName !== "PRE") {
    return `\`${(el.textContent ?? "").replace(/`/g, "\\`")}\``;
  }
  if (tag === "PRE") {
    const code = el.querySelector(":scope > code");
    const langClass = code?.className?.match(/language-([\w-]+)/)?.[1] ?? "";
    const text = (code ?? el).textContent ?? "";
    return `\n\n\`\`\`${langClass}\n${text.replace(/\n+$/, "")}\n\`\`\`\n\n`;
  }

  if (tag === "A") {
    const href = attr(el, "href") ?? "";
    const inner = childrenToMarkdown(el, listDepth).trim() || href;
    return `[${inner}](${href})`;
  }
  if (tag === "IMG") {
    const src = attr(el, "src") ?? "";
    const alt = attr(el, "alt") ?? "";
    return `![${alt}](${src})`;
  }

  if (tag === "BLOCKQUOTE") {
    const inner = childrenToMarkdown(el, listDepth).trim();
    return `\n\n${indent(inner, "> ")}\n\n`;
  }

  if (tag === "UL" || tag === "OL") {
    const ordered = tag === "OL";
    const items = Array.from(el.children).filter((c) => c.tagName === "LI");
    const lines = items.map((li, i) => {
      const marker = ordered ? `${i + 1}. ` : "- ";
      const inner = childrenToMarkdown(li, listDepth + 1).trim();
      const [first, ...rest] = inner.split("\n");
      const cont = rest.length ? `\n${indent(rest.join("\n"), "  ")}` : "";
      return `${marker}${first}${cont}`;
    });
    return `\n\n${indent(lines.join("\n"), "  ".repeat(listDepth))}\n\n`;
  }

  if (tag === "TABLE") {
    return tableToMarkdown(el) ?? childrenToMarkdown(el, listDepth);
  }

  // Default: descend through unknown wrappers (DIV, SPAN, etc.).
  return childrenToMarkdown(el, listDepth);
}

function childrenToMarkdown(el: Element, listDepth: number): string {
  let out = "";
  for (const child of Array.from(el.childNodes)) {
    out += nodeToMarkdown(child, listDepth);
  }
  return out;
}

function tableToMarkdown(table: Element): string | null {
  const rows = Array.from(
    table.querySelectorAll(":scope > thead > tr, :scope > tbody > tr, :scope > tr"),
  );
  if (rows.length === 0) return null;
  const cells: string[][] = rows.map((tr) =>
    Array.from(tr.children).map((td) =>
      childrenToMarkdown(td, 0).replace(/\|/g, "\\|").replace(/\n/g, " ").trim(),
    ),
  );
  const cols = Math.max(...cells.map((r) => r.length));
  if (!cells.every((r) => r.length === cols)) return null;
  const head = cells[0];
  if (!head) return null;
  const body = cells.slice(1);
  const sep = head.map(() => "---");
  const fmt = (r: string[]) => `| ${r.join(" | ")} |`;
  return `\n\n${[fmt(head), fmt(sep), ...body.map(fmt)].join("\n")}\n\n`;
}

export function htmlToMarkdown(html: string): string {
  if (typeof DOMParser === "undefined") return html;
  const doc = new DOMParser().parseFromString(html, "text/html");
  const md = childrenToMarkdown(doc.body, 0);
  // Collapse runaway blank lines, trim outer whitespace.
  return md.replace(/\n{3,}/g, "\n\n").trim();
}
