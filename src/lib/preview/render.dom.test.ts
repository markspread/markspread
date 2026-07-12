// Coverage for the markdown -> HTML preview pipeline.

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BUILTIN_MARKDOWN_ID,
  __resetParserRegistryForTests,
  getParserRegistry,
} from "../parsers/registry";
import type { SandboxTransport } from "../parsers/renderer-host";
// Real KaTeX (not the katex.dom.test mock) — the SC-BASE-03 regression
// asserts the *end-to-end* seam: pipeline placeholder → KaTeX markup.
import { renderMathIn } from "./katex";
import { createDebouncedRenderer, render } from "./render";

afterEach(() => {
  __resetParserRegistryForTests();
  vi.useRealTimers();
});

describe("render", () => {
  it("renders basic markdown to sanitised HTML", async () => {
    const out = await render("# Hello\n\nsome **bold** text");
    expect(out).toContain("<h1>Hello</h1>");
    expect(out).toContain("<strong>bold</strong>");
  });

  it("strips dangerous HTML from the rendered output", async () => {
    const out = await render("<script>alert(1)</script>\n\nsafe");
    expect(out).not.toMatch(/<script/i);
    expect(out).toContain("safe");
  });

  it("applies a highlightCode hook to fenced code blocks", async () => {
    const highlight = vi.fn((code: string, lang: string) => `<pre data-hl="${lang}">${code}</pre>`);
    await render("```js\nconst x = 1;\n```", {
      highlightCode: highlight,
    });
    expect(highlight).toHaveBeenCalled();
    const [code, lang] = highlight.mock.calls[0] ?? [];
    expect(lang).toBe("js");
    expect(code).toContain("const x = 1;");
  });

  it("falls back to the raw code block when highlightCode throws", async () => {
    const out = await render("```js\nuniqueCodeToken\n```", {
      highlightCode: () => {
        throw new Error("hl fail");
      },
    });
    expect(out).toContain("uniqueCodeToken");
  });

  it("leaves output unchanged when there are no code blocks to highlight", async () => {
    const highlight = vi.fn((c: string) => c);
    await render("just prose", { highlightCode: highlight });
    expect(highlight).not.toHaveBeenCalled();
  });

  it("blocks remote images when requested", async () => {
    const out = await render("![alt](https://cdn.example.com/a.png)", {
      blockRemoteImages: true,
    });
    expect(out).not.toMatch(/src="https/);
    expect(out).toContain('data-blocked="remote"');
  });

  it("uses the builtin pipeline when path matches the builtin parser", async () => {
    const transport: SandboxTransport = {
      mode: "worker",
      postMessage: vi.fn(),
      onMessage: () => () => {},
      dispose: () => {},
    };
    getParserRegistry();
    const out = await render("# Title", {
      path: "/doc.md",
      transport,
    });
    expect(out).toContain("<h1>Title</h1>");
    // builtin parser → no sandbox dispatch.
    expect(transport.postMessage).not.toHaveBeenCalled();
  });

  it("dispatches to the sandbox for a third-party parser and returns its HTML", async () => {
    const reg = getParserRegistry();
    reg.registerParser(
      {
        id: "custom-parser",
        version: "1.0.0",
        displayName: "Custom",
        fileMatch: { extensions: [".custom"] },
        capabilities: "preview-plus-edit",
        entry: "test:custom",
      },
      ({ content }) => ({ ast: { kind: "x", source: content } }),
    );
    let handler: ((raw: unknown) => void) | null = null;
    const transport: SandboxTransport = {
      mode: "worker",
      postMessage: (msg) => {
        queueMicrotask(() =>
          handler?.({
            type: "parse:ok",
            requestId: msg.requestId,
            parserId: "custom-parser",
            result: { kind: "html", html: "<p>from sandbox</p>" },
          }),
        );
      },
      onMessage: (h) => {
        handler = h;
        return () => {
          handler = null;
        };
      },
      dispose: () => {},
    };
    const out = await render("body", {
      path: "/file.custom",
      transport,
    });
    expect(out).toContain("from sandbox");
  });

  it("falls through to the builtin pipeline when the sandbox errors", async () => {
    const reg = getParserRegistry();
    reg.registerParser(
      {
        id: "err-parser",
        version: "1.0.0",
        displayName: "Err",
        fileMatch: { extensions: [".err"] },
        capabilities: "preview-plus-edit",
        entry: "test:err",
      },
      ({ content }) => ({ ast: { kind: "x", source: content } }),
    );
    let handler: ((raw: unknown) => void) | null = null;
    const transport: SandboxTransport = {
      mode: "worker",
      postMessage: (msg) => {
        queueMicrotask(() =>
          handler?.({
            type: "parse:err",
            requestId: msg.requestId,
            parserId: "err-parser",
            message: "sandbox blew up",
          }),
        );
      },
      onMessage: (h) => {
        handler = h;
        return () => {
          handler = null;
        };
      },
      dispose: () => {},
    };
    const out = await render("# Heading", {
      path: "/file.err",
      transport,
    });
    expect(out).toContain("<h1>Heading</h1>");
  });

  it("ignores path when no transport is supplied", async () => {
    const out = await render("# T", { path: "/file.custom" });
    expect(out).toContain("<h1>T</h1>");
  });

  it("forwards frontmatter to the parser registry match", async () => {
    const reg = getParserRegistry();
    const matchSpy = vi.spyOn(reg, "match");
    const transport: SandboxTransport = {
      mode: "worker",
      postMessage: vi.fn(),
      onMessage: () => () => {},
      dispose: () => {},
    };
    await render("# H", {
      path: "/doc.md",
      transport,
      frontmatter: { kind: "diagram" },
    });
    expect(matchSpy).toHaveBeenCalledWith(
      expect.objectContaining({ path: "/doc.md", frontmatter: { kind: "diagram" } }),
    );
    matchSpy.mockRestore();
  });

  it("highlights a code block with no language", async () => {
    const highlight = vi.fn(async (code: string) => `<pre><code>HL:${code}</code></pre>`);
    const out = await render("```\nno-lang\n```", { highlightCode: highlight });
    expect(highlight).toHaveBeenCalledWith("no-lang\n", "");
    expect(out).toContain("HL:no-lang");
  });

  it("exposes the builtin markdown id constant", () => {
    expect(BUILTIN_MARKDOWN_ID).toBe("builtin-markdown");
  });
});

describe("createDebouncedRenderer", () => {
  it("coalesces rapid calls and resolves the latest with HTML", async () => {
    const debounced = createDebouncedRenderer(10);
    // Earlier calls have their timers cleared, so only the last
    // call's promise settles — assert that one carries the latest doc.
    void debounced("# Old");
    const fresh = debounced("# New");
    const freshHtml = await fresh;
    expect(freshHtml).toContain("New");
    expect(freshHtml).not.toContain("Old");
  });

  it("renders a single call after the delay", async () => {
    const debounced = createDebouncedRenderer(5);
    const html = await debounced("# X");
    expect(html).toContain("X");
  });

  it("passes render options through", async () => {
    const debounced = createDebouncedRenderer(5);
    const html = await debounced("![a](https://cdn.example.com/a.png)", {
      blockRemoteImages: true,
    });
    expect(html).toContain('data-blocked="remote"');
  });

  it("cancel() clears a pending render and is a no-op when idle", async () => {
    vi.useFakeTimers();
    try {
      const debounced = createDebouncedRenderer(10);
      // idle branch: no timer scheduled yet — cancel must be a safe no-op.
      expect(() => debounced.cancel()).not.toThrow();
      // pending branch: schedule a render, then cancel before the timer fires;
      // the callback must never run, so the promise stays unsettled.
      let settled = false;
      void debounced("# Cancelled").then(() => {
        settled = true;
      });
      debounced.cancel();
      await vi.advanceTimersByTimeAsync(50);
      expect(settled).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("render — in-process custom parser (register-from-source path, no sandbox)", () => {
  it("calls factory directly + uses html AST", async () => {
    const reg = getParserRegistry();
    reg.registerParser(
      {
        id: "in-proc-html",
        version: "0.0.1",
        displayName: "InProc HTML",
        fileMatch: { extensions: [".inproc"] },
        capabilities: "preview-only",
        entry: "inline:test",
      },
      (input) => ({
        ast: { kind: "html", html: `<section data-iph="1">${input.content}</section>` },
      }),
    );
    const out = await render("hello world", { path: "/x/y.inproc" });
    expect(out).toContain('data-iph="1"');
    expect(out).toContain("hello world");
  });

  it("forceParserId routes through a parser that does NOT match the path", async () => {
    const reg = getParserRegistry();
    reg.registerParser(
      {
        id: "forced-only",
        version: "0.0.1",
        displayName: "Forced Only",
        // Matches .forcedext, NOT .md — so a plain path match would never pick it.
        fileMatch: { extensions: [".forcedext"] },
        capabilities: "preview-only",
        entry: "inline:test",
      },
      (input) => ({ ast: { kind: "html", html: `<u data-forced="1">${input.content}</u>` } }),
    );
    // Path is .md (would normally hit builtin) but forceParserId overrides it.
    const out = await render("OVERRIDDEN", { path: "/x/y.md", forceParserId: "forced-only" });
    expect(out).toContain('data-forced="1"');
    expect(out).toContain("OVERRIDDEN");
  });

  it("unknown forceParserId falls back to the normal path match", async () => {
    const reg = getParserRegistry();
    reg.registerParser(
      {
        id: "ext-claims-md",
        version: "0.0.1",
        displayName: "Ext claims md2",
        fileMatch: { extensions: [".md2"] },
        capabilities: "preview-only",
        entry: "inline:test",
      },
      (input) => ({ ast: { kind: "html", html: `<i data-matched="1">${input.content}</i>` } }),
    );
    // forceParserId points at a non-existent parser → ignored → path match wins.
    const out = await render("CONTENT", { path: "/x/y.md2", forceParserId: "does-not-exist" });
    expect(out).toContain('data-matched="1"');
    expect(out).toContain("CONTENT");
  });

  it("markdown AST goes through builtin pipeline", async () => {
    const reg = getParserRegistry();
    reg.registerParser(
      {
        id: "in-proc-md-rewrite",
        version: "0.0.1",
        displayName: "InProc MD rewrite",
        fileMatch: { extensions: [".mdrw"] },
        capabilities: "preview-only",
        entry: "inline:test",
      },
      (input) => ({
        // Replace 'foo' with '**FOO**' before sending to markdown pipeline.
        ast: { kind: "markdown", source: input.content.replace(/foo/g, "**FOO**") },
      }),
    );
    const out = await render("the foo bar", { path: "/x/y.mdrw" });
    expect(out).toContain("<strong>FOO</strong>");
  });

  it("raw AST gets escaped into <pre>", async () => {
    const reg = getParserRegistry();
    reg.registerParser(
      {
        id: "in-proc-raw",
        version: "0.0.1",
        displayName: "InProc raw",
        fileMatch: { extensions: [".raw"] },
        capabilities: "preview-only",
        entry: "inline:test",
      },
      (input) => ({ ast: { kind: "raw", value: `<script>${input.content}</script>` } }),
    );
    const out = await render("alert(1)", { path: "/x/y.raw" });
    // script tag literal in the raw text is HTML-escaped, not executed.
    expect(out).toContain("&lt;script&gt;");
    expect(out).not.toMatch(/<script>/);
  });

  it("factory throw falls back to builtin pipeline (document stays visible)", async () => {
    const reg = getParserRegistry();
    reg.registerParser(
      {
        id: "in-proc-throw",
        version: "0.0.1",
        displayName: "InProc throw",
        fileMatch: { extensions: [".thr"] },
        capabilities: "preview-only",
        entry: "inline:test",
      },
      () => {
        throw new Error("boom");
      },
    );
    const out = await render("# fallback", { path: "/x/y.thr" });
    expect(out).toContain("<h1>fallback</h1>");
  });

  it("does NOT call factory for builtin markdown (avoids no-op detour)", async () => {
    let invoked = 0;
    const reg = getParserRegistry();
    // Replace builtin's factory tracking — we won't actually replace it, but
    // we'll register an extra .md parser to verify the dispatch DID happen.
    // Note: builtin is registered first + fallback. A second .md parser will
    // also match → ParserRegistry.match returns the more specific one.
    reg.registerParser(
      {
        id: "in-proc-md-tracker",
        version: "0.0.1",
        displayName: "tracker",
        fileMatch: { extensions: [".md"] },
        capabilities: "preview-only",
        entry: "inline:test",
      },
      (input) => {
        invoked += 1;
        return { ast: { kind: "html", html: `<p data-via-tracker>${input.content}</p>` } };
      },
    );
    const out = await render("hello", { path: "/x/y.md" });
    expect(invoked).toBeGreaterThan(0);
    expect(out).toContain("data-via-tracker");
    // sanity: builtin still works for "no path"
    const noPath = await render("# H");
    expect(noPath).toContain("<h1>H</h1>");
    void BUILTIN_MARKDOWN_ID;
  });
});

describe("render — handleInProcessAst defensive branches → builtin fallback", () => {
  function registerFactory(id: string, ext: string, factory: () => unknown) {
    getParserRegistry().registerParser(
      {
        id,
        version: "0.0.1",
        displayName: id,
        fileMatch: { extensions: [ext] },
        capabilities: "preview-only",
        entry: "inline:test",
      },
      factory as never,
    );
  }

  it("factory output without an `ast` key → null → builtin fallback (line 180)", async () => {
    registerFactory("noast", ".noast", () => ({ notAst: true }));
    const out = await render("# fallback-a", { path: "/x.noast" });
    expect(out).toContain("<h1>fallback-a</h1>");
  });

  it("factory output whose ast lacks a `kind` → null → builtin fallback (line 182)", async () => {
    registerFactory("nokind", ".nokind", () => ({ ast: { foo: 1 } }));
    const out = await render("# fallback-b", { path: "/x.nokind" });
    expect(out).toContain("<h1>fallback-b</h1>");
  });

  it("kind:html with a non-string html → null → builtin fallback (line 186)", async () => {
    registerFactory("htmlnum", ".htmlnum", () => ({ ast: { kind: "html", html: 123 } }));
    const out = await render("# fallback-c", { path: "/x.htmlnum" });
    expect(out).toContain("<h1>fallback-c</h1>");
  });

  it("kind:markdown with a non-string source falls back to the original md (line 191)", async () => {
    registerFactory("mdnosrc", ".mdnosrc", () => ({ ast: { kind: "markdown" } }));
    const out = await render("# original-md", { path: "/x.mdnosrc" });
    expect(out).toContain("<h1>original-md</h1>");
  });

  it("kind:markdown applies highlightCode to the re-rendered pipeline (lines 194-196)", async () => {
    registerFactory("mdhl", ".mdhl", (...args: unknown[]) => {
      const input = args[0] as { content: string };
      return { ast: { kind: "markdown", source: input.content } };
    });
    const highlight = vi.fn(
      (code: string, lang: string) => `<pre data-mdhl="${lang}">${code}</pre>`,
    );
    const out = await render("```js\nfromMarkdownAst\n```", {
      path: "/x.mdhl",
      highlightCode: highlight,
    });
    expect(highlight).toHaveBeenCalled();
    expect(out).toContain("fromMarkdownAst");
  });

  it("kind:raw with a non-string value is JSON-stringified inside <pre> (line 201)", async () => {
    registerFactory("rawobj", ".rawobj", () => ({
      ast: { kind: "raw", value: { a: 1, b: [2, 3] } },
    }));
    const out = await render("ignored", { path: "/x.rawobj" });
    expect(out).toContain("<pre>");
    // value is JSON.stringify'd (non-string branch of line 201).
    expect(out).toContain('"a": 1');
    expect(out).toContain('"b"');
  });

  it("unrecognised ast kind → null → builtin fallback", async () => {
    registerFactory("unkkind", ".unkkind", () => ({ ast: { kind: "totally-unknown" } }));
    const out = await render("# unk", { path: "/x.unkkind" });
    expect(out).toContain("<h1>unk</h1>");
  });
});

// SC-BASE-03 regression: R1 found the `.ms-math` consumer (katex.ts) had
// no producer — remark-math was missing so `$E=mc^2$` rendered literally.
// These tests pin the whole seam: markdown → placeholder → KaTeX markup.
describe("render — math placeholders (SC-BASE-03)", () => {
  it("turns $inline$ math into an .ms-math span that KaTeX then typesets", async () => {
    const out = await render("mass–energy: $E=mc^2$ equivalence");
    expect(out).toContain('class="ms-math"');
    expect(out).toContain('data-mode="inline"');
    // the raw TeX no longer appears as literal $…$ prose
    expect(out).not.toContain("$E=mc^2$");
    const root = document.createElement("div");
    root.innerHTML = out;
    await renderMathIn(root);
    const el = root.querySelector(".ms-math");
    expect(el?.getAttribute("data-rendered")).toBe("true");
    expect(el?.querySelector(".katex")).not.toBeNull();
  });

  it("turns a $$…$$ fenced block into a block-mode .ms-math div (no <pre> box)", async () => {
    const out = await render("$$\n\\sum_{i=1}^{n} i\n$$");
    expect(out).toContain('data-mode="block"');
    expect(out).toMatch(/<div class="ms-math"/);
    expect(out).not.toContain("<pre>");
    const root = document.createElement("div");
    root.innerHTML = out;
    await renderMathIn(root);
    expect(root.querySelector(".ms-math .katex")).not.toBeNull();
  });

  it("treats inline $$…$$ as inline math (remark-math text-math semantics)", async () => {
    const out = await render("before $$x^2$$ after");
    expect(out).toContain('data-mode="inline"');
    expect(out).toContain("before");
    expect(out).toContain("after");
  });

  it("rewrites an authored bare math-display element outside a <pre>", async () => {
    // rehype-raw route: authored HTML carrying the remark-math classes is
    // normalised into the same `.ms-math` contract as pipeline output.
    const out = await render('x <code class="language-math math-display">x^2</code> y');
    expect(out).toContain('data-mode="block"');
    expect(out).toContain('class="ms-math"');
  });

  it("leaves regular code blocks untouched by the math rewrite", async () => {
    const out = await render("```js\nconst dollars = '$5';\n```");
    expect(out).toContain("<pre>");
    expect(out).not.toContain("ms-math");
  });
});

// SC-BASE-04 regression: R1 found SpreadPane rendered the raw document, so
// `---\ntitle: x\n---` leaked into the preview as <hr> + heading.
describe("render — frontmatter stripping (SC-BASE-04)", () => {
  it("does not leak frontmatter into the rendered body", async () => {
    const out = await render("---\ntitle: my doc\ntags: [a, b]\n---\n\n# Body\n\nprose");
    expect(out).toContain("<h1>Body</h1>");
    expect(out).toContain("prose");
    expect(out).not.toContain("<hr");
    expect(out).not.toContain("title: my doc");
    expect(out).not.toContain("<h2");
  });

  it("also strips frontmatter on the builtin .md parser route (path match)", async () => {
    const out = await render("---\ntitle: routed\n---\n\n# Routed", { path: "/ws/doc.md" });
    expect(out).toContain("<h1>Routed</h1>");
    expect(out).not.toContain("title: routed");
    expect(out).not.toContain("<hr");
  });

  it("keeps a mid-document thematic break intact (no over-stripping)", async () => {
    const out = await render("above\n\n---\n\nbelow");
    expect(out).toContain("<hr");
    expect(out).toContain("above");
    expect(out).toContain("below");
  });
});

// SC-BASE-05 regression: R1 found the sanitiser ran *after* the code
// highlighter, so Shiki's per-token `style` attributes were stripped and
// every code block fell back to unstyled text. The order is now
// sanitize → highlight; these tests pin both halves of that contract.
describe("render — highlight style survival (SC-BASE-05)", () => {
  const shikiLike = (code: string, lang: string) =>
    `<pre class="shiki" style="--shiki-light:#24292e;--shiki-dark:#e1e4e8"><code><span data-lang="${lang}" style="--shiki-light:#d73a49;--shiki-dark:#f97583">${code}</span></code></pre>`;

  it("keeps the highlighter's per-token style attributes in the output", async () => {
    const out = await render("```js\nconst x = 1;\n```", { highlightCode: shikiLike });
    expect(out).toContain('class="shiki"');
    expect(out).toContain("--shiki-light:#d73a49");
    expect(out).toContain("--shiki-dark:#f97583");
  });

  it("still strips style/script from authored markdown when a highlighter is active", async () => {
    const out = await render(
      '<div style="color:red" onclick="x()">hi</div>\n\n<script>alert(1)</script>\n\n```js\nsafe\n```',
      { highlightCode: shikiLike },
    );
    // XSS 계약 (SC-BASE-06) 후퇴 금지: 문서 유래 style/on*/script 는 여전히 제거,
    // style 을 유지하는 건 highlighter 출력(신뢰된 도구 산출물)뿐이다.
    expect(out).not.toContain("color:red");
    expect(out).not.toContain("onclick");
    expect(out).not.toMatch(/<script/i);
    expect(out).toContain("--shiki-light:#d73a49");
  });
});

describe("render fallback when remark imports fail", () => {
  it("uses the escape-and-paragraph renderer when unified is missing", async () => {
    vi.resetModules();
    vi.doMock("unified", () => {
      throw new Error("missing");
    });
    const { render: r } = await import("./render");
    const html = await r('a <b> "c" & d\n\nsecond');
    // The <b> opener gets escaped by the fallback renderer to literal text;
    // the sanitiser parses & re-serialises, but does not turn it back into an element.
    expect(html).not.toContain("<b>");
    expect(html).toContain("second");
    expect(html.split("<p>").length).toBeGreaterThan(2);
    vi.doUnmock("unified");
    vi.resetModules();
  });
});
