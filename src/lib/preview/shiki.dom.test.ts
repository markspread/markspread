// Coverage for the Shiki syntax-highlighting host API.
//
// The highlighter core and regex engine are mocked at the package seam
// (@shikijs/core / @shikijs/engine-javascript); grammar and theme
// registration modules load for real — they are pure data, and letting
// them resolve keeps the curated loader map honest. External-contract
// behavior against the real core lives in preview-real-deps.dom.test.ts.

import { describe, expect, it, vi } from "vitest";

const createHighlighterCore = vi.fn();

vi.mock("@shikijs/core", () => ({
  createHighlighterCore: (opts: unknown) => createHighlighterCore(opts),
}));
vi.mock("@shikijs/engine-javascript", () => ({
  createJavaScriptRegexEngine: () => ({ kind: "js-engine" }),
}));

import { configureShiki, highlightCode } from "./shiki";

function makeHighlighter(loaded: string[]) {
  return {
    codeToHtml: vi.fn(
      (code: string, opts: { lang: string }) =>
        `<pre class="shiki" data-lang="${opts.lang}">${code}</pre>`,
    ),
    getLoadedLanguages: vi.fn(() => loaded),
    loadLanguage: vi.fn(async () => {}),
  };
}

const GITHUB_THEMES = { light: "github-light", dark: "github-dark" };

// Mirrors of the curated maps in shiki.ts. Kept literal on purpose:
// the exhaustive tests below load every entry for real, so a drift
// between this list and the source map fails loudly instead of
// silently shrinking coverage of the loader table.
const CURATED_LANGS = [
  "bash",
  "css",
  "diff",
  "dockerfile",
  "go",
  "html",
  "javascript",
  "json",
  "jsonc",
  "jsx",
  "markdown",
  "python",
  "rust",
  "sql",
  "toml",
  "tsx",
  "typescript",
  "xml",
  "yaml",
];

const FENCE_ALIASES: Record<string, string> = {
  golang: "go",
  js: "javascript",
  md: "markdown",
  py: "python",
  rs: "rust",
  sh: "bash",
  shell: "bash",
  ts: "typescript",
  yml: "yaml",
  zsh: "bash",
};

describe("shiki highlightCode", () => {
  it("falls back to plain pre/code when Shiki is not configured", async () => {
    const out = await highlightCode("const x = 1;", "js");
    expect(out).toBe('<pre><code class="language-js">const x = 1;</code></pre>');
  });

  it("escapes HTML metacharacters in the fallback", async () => {
    const out = await highlightCode("<a> & </a>", "");
    expect(out).toBe("<pre><code>&lt;a&gt; &amp; &lt;/a&gt;</code></pre>");
  });

  it("highlights code once Shiki is configured, resolving fence aliases", async () => {
    const hl = makeHighlighter(["javascript"]);
    createHighlighterCore.mockResolvedValueOnce(hl);
    await configureShiki({ themes: GITHUB_THEMES, langs: ["js"] });
    const out = await highlightCode("code()", "js");
    expect(out).toContain("shiki");
    expect(hl.codeToHtml).toHaveBeenCalledWith(
      "code()",
      expect.objectContaining({ lang: "javascript", defaultColor: false }),
    );
    // Registration payloads (not name strings) reach the core factory.
    const opts = createHighlighterCore.mock.calls[0]?.[0] as {
      themes: unknown[];
      langs: unknown[];
      engine: { kind: string };
    };
    expect(opts.themes).toHaveLength(2);
    expect(opts.langs).toHaveLength(1);
    expect(opts.engine).toEqual({ kind: "js-engine" });
  });

  it("lazy-loads a curated grammar that is not yet loaded", async () => {
    const hl = makeHighlighter(["javascript"]);
    createHighlighterCore.mockResolvedValueOnce(hl);
    await configureShiki({ themes: GITHUB_THEMES, langs: ["js"] });
    await highlightCode("py()", "python");
    expect(hl.loadLanguage).toHaveBeenCalledTimes(1);
    // The loader hands the registration object, not a name string.
    expect(typeof (hl.loadLanguage.mock.calls[0] as unknown[])?.[0]).toBe("object");
    expect(hl.codeToHtml).toHaveBeenCalledWith("py()", expect.objectContaining({ lang: "python" }));
  });

  it("falls back for a language outside the curated set without touching the core", async () => {
    const hl = makeHighlighter(["javascript"]);
    createHighlighterCore.mockResolvedValueOnce(hl);
    await configureShiki({ themes: GITHUB_THEMES, langs: ["js"] });
    const out = await highlightCode("x", "brainfuck");
    expect(out).toBe('<pre><code class="language-brainfuck">x</code></pre>');
    expect(hl.loadLanguage).not.toHaveBeenCalled();
  });

  it("defaults an empty lang to 'text', which falls back as non-curated", async () => {
    const hl = makeHighlighter(["javascript"]);
    createHighlighterCore.mockResolvedValueOnce(hl);
    await configureShiki({ themes: GITHUB_THEMES, langs: ["js"] });
    const out = await highlightCode("plain", "");
    expect(out).toBe("<pre><code>plain</code></pre>");
  });

  it("falls back when loadLanguage rejects", async () => {
    const hl = makeHighlighter(["javascript"]);
    hl.loadLanguage = vi.fn(async () => {
      throw new Error("registration rejected");
    });
    createHighlighterCore.mockResolvedValueOnce(hl);
    await configureShiki({ themes: GITHUB_THEMES, langs: ["js"] });
    const out = await highlightCode("py()", "python");
    expect(out).toBe('<pre><code class="language-python">py()</code></pre>');
  });

  it("falls back when the highlighter fails to create", async () => {
    createHighlighterCore.mockRejectedValueOnce(new Error("engine init failed"));
    await configureShiki({ themes: GITHUB_THEMES, langs: ["js"] });
    const out = await highlightCode("x", "js");
    expect(out).toBe('<pre><code class="language-js">x</code></pre>');
  });

  it("falls back when a configured theme is outside the curated set", async () => {
    createHighlighterCore.mockClear();
    await configureShiki({ themes: { light: "ms-light", dark: "ms-dark" }, langs: ["js"] });
    const out = await highlightCode("x", "js");
    expect(out).toBe('<pre><code class="language-js">x</code></pre>');
    expect(createHighlighterCore).not.toHaveBeenCalled();
  });

  it("resolves a real registration module for every curated grammar and theme", async () => {
    createHighlighterCore.mockClear();
    const hl = makeHighlighter(CURATED_LANGS);
    createHighlighterCore.mockResolvedValueOnce(hl);
    await configureShiki({ themes: GITHUB_THEMES, langs: CURATED_LANGS });
    // highlightCode awaits the configure promise, so every loader in the
    // curated maps has run (and resolved) by the time this returns.
    const out = await highlightCode("x", "bash");
    expect(out).toContain('data-lang="bash"');
    const opts = createHighlighterCore.mock.calls[0]?.[0] as {
      themes: unknown[];
      langs: unknown[];
    };
    expect(opts.themes).toHaveLength(2);
    expect(opts.langs).toHaveLength(CURATED_LANGS.length);
    // Each loader must yield a registration payload (module default export).
    for (const registration of [...opts.themes, ...opts.langs]) {
      expect(registration).toBeTruthy();
    }
  });

  it("maps every fence alias to a grammar inside the curated set", async () => {
    createHighlighterCore.mockClear();
    const hl = makeHighlighter(CURATED_LANGS);
    createHighlighterCore.mockResolvedValueOnce(hl);
    await configureShiki({ themes: GITHUB_THEMES, langs: [] });
    for (const [alias, canonical] of Object.entries(FENCE_ALIASES)) {
      expect(CURATED_LANGS).toContain(canonical);
      const out = await highlightCode("x", alias);
      expect(out).toContain(`data-lang="${canonical}"`);
    }
  });

  it("falls back when a configured grammar is outside the curated set", async () => {
    createHighlighterCore.mockClear();
    await configureShiki({ themes: GITHUB_THEMES, langs: ["brainfuck"] });
    const out = await highlightCode("x", "js");
    expect(out).toBe('<pre><code class="language-js">x</code></pre>');
    expect(createHighlighterCore).not.toHaveBeenCalled();
  });
});
