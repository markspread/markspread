// SC-BASE-02 / SC-BASE-05 regression: R1 found mermaid.ts and shiki.ts
// were complete (unit-green) but *nothing in production ever registered
// them* — setMermaidRenderer/configureShiki had zero non-test callers.
// These tests pin the boot module that closes that gap; the companion
// wiring test (src/__tests__/preview-boot-wiring.test.ts) pins that
// main.tsx actually imports it.

import { afterEach, describe, expect, it, vi } from "vitest";

const initialize = vi.fn();
const mermaidRender = vi.fn(async (id: string, _src: string) => ({
  svg: `<svg data-diagram="${id}"><g></g></svg>`,
}));
vi.mock("mermaid", () => ({
  default: {
    initialize: (...args: unknown[]) => initialize(...args),
    render: (id: string, src: string) => mermaidRender(id, src),
  },
}));

const configureShiki = vi.fn((_cfg: unknown) => Promise.resolve());
vi.mock("./shiki", () => ({
  configureShiki: (cfg: unknown) => configureShiki(cfg),
}));

import { bootPreviewRuntime } from "./boot";
import { renderMermaidIn, setMermaidRenderer } from "./mermaid";

afterEach(() => {
  setMermaidRenderer(null);
  initialize.mockClear();
  mermaidRender.mockClear();
  configureShiki.mockClear();
});

function mermaidBlock(source: string): HTMLDivElement {
  const root = document.createElement("div");
  const pre = document.createElement("pre");
  const code = document.createElement("code");
  code.className = "language-mermaid";
  code.textContent = source;
  pre.appendChild(code);
  root.appendChild(pre);
  return root;
}

describe("bootPreviewRuntime", () => {
  it("registers a mermaid renderer so diagrams render end-to-end (init once)", async () => {
    // NOTE: single test on purpose — loadMermaid memoises at module scope,
    // so initialize-count assertions can't be split across tests.
    bootPreviewRuntime();
    const root = mermaidBlock("graph TD; A-->B");
    await renderMermaidIn(root);
    // the <pre> is replaced by the rendered SVG wrapper
    expect(root.querySelector(".ms-mermaid svg")).not.toBeNull();
    expect(root.querySelector("pre")).toBeNull();
    expect(mermaidRender).toHaveBeenCalledWith(
      expect.stringMatching(/^ms-mermaid-/),
      "graph TD; A-->B",
    );
    // module is memoised — a second diagram must not re-initialise
    await renderMermaidIn(mermaidBlock("graph LR; C-->D"));
    expect(initialize).toHaveBeenCalledTimes(1);
    expect(initialize).toHaveBeenCalledWith({ startOnLoad: false, securityLevel: "strict" });
    expect(mermaidRender).toHaveBeenCalledTimes(2);
  });

  it("configures shiki with dual themes and pre-warmed grammars", () => {
    bootPreviewRuntime();
    expect(configureShiki).toHaveBeenCalledWith({
      themes: { light: "github-light", dark: "github-dark" },
      langs: expect.arrayContaining(["typescript", "json", "bash"]),
    });
  });

  it("keeps the plain-text fallback when the mermaid bundle fails to load", async () => {
    vi.resetModules();
    vi.doMock("mermaid", () => {
      throw new Error("missing bundle");
    });
    const { bootPreviewRuntime: boot } = await import("./boot");
    const { renderMermaidIn: rmi, setMermaidRenderer: smr } = await import("./mermaid");
    boot();
    const root = mermaidBlock("graph TD; A-->B");
    await rmi(root);
    // renderer resolves null → mermaid.ts leaves the source block in place
    expect(root.querySelector(".ms-mermaid")).toBeNull();
    expect(root.querySelector("pre > code.language-mermaid")).not.toBeNull();
    smr(null);
    vi.doUnmock("mermaid");
    vi.resetModules();
  });
});
