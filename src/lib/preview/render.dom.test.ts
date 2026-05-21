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
