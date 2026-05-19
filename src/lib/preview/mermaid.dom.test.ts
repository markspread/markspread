// Coverage for the mermaid diagram renderer.

import { afterEach, describe, expect, it, vi } from "vitest";
import { renderMermaidIn, setMermaidRenderer } from "./mermaid";

afterEach(() => {
  setMermaidRenderer(null);
});

function mermaidRoot(): HTMLDivElement {
  const root = document.createElement("div");
  root.innerHTML = '<pre><code class="language-mermaid">graph TD; A-->B</code></pre>';
  return root;
}

describe("renderMermaidIn", () => {
  it("no-ops when no renderer is registered", async () => {
    const root = mermaidRoot();
    await renderMermaidIn(root);
    expect(root.querySelector("pre")).not.toBeNull();
  });

  it("replaces the pre block with rendered SVG", async () => {
    setMermaidRenderer(async () => ({ svg: "<svg><g></g></svg>" }));
    const root = mermaidRoot();
    await renderMermaidIn(root);
    expect(root.querySelector("pre")).toBeNull();
    const wrapper = root.querySelector(".ms-mermaid");
    expect(wrapper?.querySelector("svg")).not.toBeNull();
  });

  it("marks code as rendered to stay idempotent", async () => {
    const renderer = vi.fn(async () => ({ svg: "<svg></svg>" }));
    setMermaidRenderer(renderer);
    const root = mermaidRoot();
    await renderMermaidIn(root);
    await renderMermaidIn(root);
    expect(renderer).toHaveBeenCalledTimes(1);
  });

  it("keeps the pre block when the renderer returns null", async () => {
    setMermaidRenderer(async () => null);
    const root = mermaidRoot();
    await renderMermaidIn(root);
    expect(root.querySelector("pre")).not.toBeNull();
  });

  it("renders an error pre when the renderer throws", async () => {
    setMermaidRenderer(async () => {
      throw new Error("parse fail");
    });
    const root = mermaidRoot();
    await renderMermaidIn(root);
    const err = root.querySelector("pre.ms-mermaid-error");
    expect(err).not.toBeNull();
    expect(err?.textContent).toContain("Mermaid error: parse fail");
    expect(err?.textContent).toContain("graph TD; A-->B");
  });

  it("ignores non-mermaid code blocks", async () => {
    setMermaidRenderer(async () => ({ svg: "<svg></svg>" }));
    const root = document.createElement("div");
    root.innerHTML = '<pre><code class="language-js">1</code></pre>';
    await renderMermaidIn(root);
    expect(root.querySelector("pre")).not.toBeNull();
    expect(root.querySelector(".ms-mermaid")).toBeNull();
  });

  it("passes a unique id to each render call", async () => {
    const ids: string[] = [];
    setMermaidRenderer(async (_src, id) => {
      ids.push(id);
      return { svg: "<svg></svg>" };
    });
    const root = document.createElement("div");
    root.innerHTML =
      '<pre><code class="language-mermaid">a</code></pre>' +
      '<pre><code class="language-mermaid">b</code></pre>';
    await renderMermaidIn(root);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });
});
