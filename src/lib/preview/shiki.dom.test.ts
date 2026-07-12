// Coverage for the Shiki syntax-highlighting host API.

import { describe, expect, it, vi } from "vitest";

const createHighlighter = vi.fn();

vi.mock("shiki", () => ({
  createHighlighter: (opts: unknown) => createHighlighter(opts),
}));

import { configureShiki, highlightCode } from "./shiki";

function makeHighlighter(loaded: string[]) {
  return {
    codeToHtml: vi.fn(
      (code: string, opts: { lang: string }) =>
        `<pre class="shiki" data-lang="${opts.lang}">${code}</pre>`,
    ),
    getLoadedLanguages: vi.fn(() => loaded),
    loadLanguage: vi.fn(async (lang: string) => {
      loaded.push(lang);
    }),
  };
}

describe("shiki highlightCode", () => {
  it("falls back to plain pre/code when Shiki is not configured", async () => {
    const out = await highlightCode("const x = 1;", "js");
    expect(out).toBe('<pre><code class="language-js">const x = 1;</code></pre>');
  });

  it("escapes HTML metacharacters in the fallback", async () => {
    const out = await highlightCode("<a> & </a>", "");
    expect(out).toBe("<pre><code>&lt;a&gt; &amp; &lt;/a&gt;</code></pre>");
  });

  it("highlights code once Shiki is configured", async () => {
    const hl = makeHighlighter(["js"]);
    createHighlighter.mockResolvedValueOnce(hl);
    await configureShiki({
      themes: { light: "ms-light", dark: "ms-dark" },
      langs: ["js"],
    });
    const out = await highlightCode("code()", "js");
    expect(out).toContain("shiki");
    expect(hl.codeToHtml).toHaveBeenCalledWith(
      "code()",
      expect.objectContaining({ lang: "js", defaultColor: false }),
    );
  });

  it("lazy-loads a language that is not yet loaded", async () => {
    const hl = makeHighlighter(["js"]);
    createHighlighter.mockResolvedValueOnce(hl);
    await configureShiki({
      themes: { light: "l", dark: "d" },
      langs: ["js"],
    });
    await highlightCode("py()", "python");
    expect(hl.loadLanguage).toHaveBeenCalledWith("python");
  });

  it("defaults an empty lang to 'text'", async () => {
    const hl = makeHighlighter(["text"]);
    createHighlighter.mockResolvedValueOnce(hl);
    await configureShiki({
      themes: { light: "l", dark: "d" },
      langs: ["text"],
    });
    await highlightCode("plain", "");
    expect(hl.codeToHtml).toHaveBeenCalledWith("plain", expect.objectContaining({ lang: "text" }));
  });

  it("falls back when loadLanguage rejects", async () => {
    const hl = makeHighlighter(["js"]);
    hl.loadLanguage = vi.fn(async () => {
      throw new Error("unknown grammar");
    });
    createHighlighter.mockResolvedValueOnce(hl);
    await configureShiki({
      themes: { light: "l", dark: "d" },
      langs: ["js"],
    });
    const out = await highlightCode("x", "brainfuck");
    expect(out).toBe('<pre><code class="language-brainfuck">x</code></pre>');
  });

  it("falls back when the highlighter fails to create", async () => {
    createHighlighter.mockRejectedValueOnce(new Error("wasm load failed"));
    await configureShiki({
      themes: { light: "l", dark: "d" },
      langs: ["js"],
    });
    const out = await highlightCode("x", "js");
    expect(out).toBe('<pre><code class="language-js">x</code></pre>');
  });
});
