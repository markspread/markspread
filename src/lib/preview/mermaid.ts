// S-MD-046: render mermaid code blocks to SVG.
//
// We look for `<pre><code class="language-mermaid">…</code></pre>`
// emitted by the markdown pipeline, hand the source to mermaid in a
// Web Worker (configured by the host), and replace the <pre> with
// the resulting SVG. If the host hasn't registered a renderer we
// no-op so plain text fallback is preserved.
//
// Why a worker? Mermaid is heavy (~600KB) and parses in JS; running
// it on the main thread blocks the preview rerender for tens of
// milliseconds on big diagrams.

export type MermaidRenderer = (
  source: string,
  id: string,
) => Promise<{ svg: string } | null>;

let renderer: MermaidRenderer | null = null;
let renderIdSeq = 0;

export function setMermaidRenderer(r: MermaidRenderer | null): void {
  renderer = r;
}

export async function renderMermaidIn(root: ParentNode): Promise<void> {
  if (!renderer) return;
  const blocks = root.querySelectorAll<HTMLElement>(
    'pre > code.language-mermaid:not([data-mermaid-rendered])',
  );
  for (const code of Array.from(blocks)) {
    code.setAttribute("data-mermaid-rendered", "true");
    const pre = code.parentElement;
    if (!pre) continue;
    const source = code.textContent ?? "";
    const id = `ms-mermaid-${++renderIdSeq}`;
    try {
      const out = await renderer(source, id);
      if (!out) continue;
      const wrapper = document.createElement("div");
      wrapper.className = "ms-mermaid";
      wrapper.innerHTML = out.svg;
      pre.replaceWith(wrapper);
    } catch (err) {
      const errEl = document.createElement("pre");
      errEl.className = "ms-mermaid-error";
      errEl.textContent = `Mermaid error: ${(err as Error).message}\n\n${source}`;
      pre.replaceWith(errEl);
    }
  }
}
