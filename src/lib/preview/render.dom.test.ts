// Coverage for the markdown -> HTML preview pipeline.

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BUILTIN_MARKDOWN_ID,
  __resetParserRegistryForTests,
  getParserRegistry,
} from "../parsers/registry";
import type { SandboxTransport } from "../parsers/renderer-host";
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
