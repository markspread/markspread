// S-MD-015: "Copy" affordance on rendered code blocks in the spread
// pane preview.
//
// We don't render the preview ourselves here — that's the PR unit.
// Instead we expose a `attachCodeCopyButtons(root)` post-processor
// the preview pipeline can call after each rerender. It walks `pre >
// code` nodes, attaches a button at the top-right, and wires the
// click handler to write the code to the clipboard.
//
// The button only becomes visible on hover (CSS `:hover` on the pre
// element + `opacity` on the button) — non-interactive readers won't
// see it. We tag with `data-ms-copy="true"` to guarantee idempotency:
// repeated post-processing skips already-decorated blocks.

const STAMP = "data-ms-copy";

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function attachCodeCopyButtons(
  root: ParentNode,
  labels: { copy: string; copied: string } = { copy: "Copy", copied: "Copied" },
): void {
  const blocks = root.querySelectorAll<HTMLPreElement>("pre > code");
  blocks.forEach((code) => {
    const pre = code.parentElement;
    if (!pre || pre.getAttribute(STAMP) === "true") return;
    pre.setAttribute(STAMP, "true");
    pre.classList.add("ms-code-block");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ms-code-copy";
    btn.textContent = labels.copy;
    btn.setAttribute("aria-label", labels.copy);
    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      const ok = await copyText(code.textContent ?? "");
      if (ok) {
        const original = btn.textContent;
        btn.textContent = labels.copied;
        btn.disabled = true;
        window.setTimeout(() => {
          btn.textContent = original;
          btn.disabled = false;
        }, 1200);
      }
    });
    pre.appendChild(btn);
  });
}
