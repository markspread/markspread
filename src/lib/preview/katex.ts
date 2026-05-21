// S-MD-044 / S-MD-045: render KaTeX math in the preview pane.
//
// The remark/rehype pipeline emits placeholder spans for math
// blocks (typically `<span class="ms-math" data-mode="inline">…</span>`
// and `<div class="ms-math" data-mode="block">…</div>`). We pick those
// elements up post-render and replace their textContent with the
// rendered HTML. Errors render as a styled `.ms-math-error` span
// containing the original source — no runtime exceptions.
//
// The katex dependency is loaded lazily on first call so the editor
// boot stays small. If the bundle isn't present we no-op silently
// and the placeholder text is shown verbatim.

type KatexModule = typeof import("katex");
let katexMod: Promise<KatexModule | null> | null = null;

async function loadKatex(): Promise<KatexModule | null> {
  if (!katexMod) {
    katexMod = import("katex").catch(() => null);
  }
  return katexMod;
}

export interface RenderMathOptions {
  /** Drop trust-mode by default; users can opt in via setting. */
  trust?: boolean;
}

export async function renderMathIn(root: ParentNode, opts: RenderMathOptions = {}): Promise<void> {
  const nodes = root.querySelectorAll<HTMLElement>(".ms-math:not([data-rendered])");
  if (nodes.length === 0) return;
  const katex = await loadKatex();
  if (!katex) return;
  for (const el of nodes) {
    const mode = el.getAttribute("data-mode") === "block" ? "block" : "inline";
    /* v8 ignore next -- HTMLElement.textContent is always a string, so the fallback never triggers */
    const src = el.textContent ?? "";
    try {
      const html = katex.default.renderToString(src, {
        throwOnError: false,
        displayMode: mode === "block",
        output: "html",
        trust: opts.trust === true,
      });
      el.innerHTML = html;
      el.setAttribute("data-rendered", "true");
    } catch (err) {
      const span = document.createElement("span");
      span.className = "ms-math-error";
      span.title = String((err as Error).message);
      span.textContent = src;
      el.replaceWith(span);
    }
  }
}
