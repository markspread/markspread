// Coverage for the KaTeX math renderer.

import { beforeEach, describe, expect, it, vi } from "vitest";

const renderToString = vi.fn((src: string, _opts: unknown) => `<span class="katex">${src}</span>`);

vi.mock("katex", () => ({
  default: { renderToString: (s: string, o: unknown) => renderToString(s, o) },
}));

import { renderMathIn } from "./katex";

describe("renderMathIn", () => {
  beforeEach(() => {
    renderToString.mockClear();
    renderToString.mockImplementation((src: string) => `<span class="katex">${src}</span>`);
  });

  it("no-ops when there are no math nodes", async () => {
    const root = document.createElement("div");
    root.innerHTML = "<p>no math</p>";
    await renderMathIn(root);
    expect(renderToString).not.toHaveBeenCalled();
  });

  it("renders inline math and marks it rendered", async () => {
    const root = document.createElement("div");
    root.innerHTML = '<span class="ms-math" data-mode="inline">x^2</span>';
    await renderMathIn(root);
    const el = root.querySelector(".ms-math");
    expect(el?.getAttribute("data-rendered")).toBe("true");
    expect(el?.innerHTML).toContain("katex");
    expect(renderToString).toHaveBeenCalledWith(
      "x^2",
      expect.objectContaining({ displayMode: false, trust: false }),
    );
  });

  it("renders block math with displayMode true", async () => {
    const root = document.createElement("div");
    root.innerHTML = '<div class="ms-math" data-mode="block">\\sum</div>';
    await renderMathIn(root);
    expect(renderToString).toHaveBeenCalledWith(
      "\\sum",
      expect.objectContaining({ displayMode: true }),
    );
  });

  it("treats a missing/unknown data-mode as inline", async () => {
    const root = document.createElement("div");
    root.innerHTML = '<span class="ms-math">a</span>';
    await renderMathIn(root);
    expect(renderToString).toHaveBeenCalledWith(
      "a",
      expect.objectContaining({ displayMode: false }),
    );
  });

  it("passes trust through when opted in", async () => {
    const root = document.createElement("div");
    root.innerHTML = '<span class="ms-math">a</span>';
    await renderMathIn(root, { trust: true });
    expect(renderToString).toHaveBeenCalledWith("a", expect.objectContaining({ trust: true }));
  });

  it("skips already-rendered nodes", async () => {
    const root = document.createElement("div");
    root.innerHTML = '<span class="ms-math" data-rendered="true">a</span>';
    await renderMathIn(root);
    expect(renderToString).not.toHaveBeenCalled();
  });

  it("silently no-ops when the katex bundle fails to load", async () => {
    vi.resetModules();
    vi.doMock("katex", () => {
      throw new Error("missing bundle");
    });
    const { renderMathIn: rmi } = await import("./katex");
    const root = document.createElement("div");
    root.innerHTML = '<span class="ms-math">x</span>';
    await rmi(root);
    expect(root.querySelector(".ms-math")?.getAttribute("data-rendered")).toBeNull();
    vi.doUnmock("katex");
    vi.resetModules();
  });

  it("replaces the node with an error span on failure", async () => {
    renderToString.mockImplementationOnce(() => {
      throw new Error("bad latex");
    });
    const root = document.createElement("div");
    root.innerHTML = '<span class="ms-math">\\frac</span>';
    await renderMathIn(root);
    const err = root.querySelector(".ms-math-error");
    expect(err).not.toBeNull();
    expect(err?.textContent).toBe("\\frac");
    expect(err?.getAttribute("title")).toBe("bad latex");
  });
});
