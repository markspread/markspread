import "./jsdomLayoutShim";
// S-ED-011: autocompletion sources.

import type {
  CompletionContext,
  CompletionResult,
  CompletionSource,
} from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import {
  addCompletionSource,
  autocompletionExtension,
  markdownKeywordSource,
} from "./autocompletion";

function ctxAt(doc: string, pos: number, explicit: boolean): CompletionContext {
  const state = EditorState.create({ doc, selection: { anchor: pos } });
  return {
    state,
    pos,
    explicit,
    matchBefore: (re: RegExp) => {
      const line = state.doc.lineAt(pos);
      const text = line.text.slice(0, pos - line.from);
      const m = text.match(new RegExp(`${re.source}$`));
      if (!m) return null;
      return { from: line.from + (m.index ?? 0), to: pos, text: m[0] };
    },
  } as unknown as CompletionContext;
}

describe("markdownKeywordSource", () => {
  it("returns null on non-explicit invocations (no auto-trigger)", () => {
    const ctx = ctxAt("# heading", 2, false);
    expect(markdownKeywordSource(ctx)).toBeNull();
  });

  it("returns markdown keyword options on explicit invocation", () => {
    const ctx = ctxAt("# ", 2, true);
    const res = markdownKeywordSource(ctx) as CompletionResult | null;
    expect(res).not.toBeNull();
    expect(res?.options.some((o) => o.label === "# ")).toBe(true);
    expect(res?.options.some((o) => o.label === "```")).toBe(true);
  });

  it("anchors the completion start at the matched word boundary", () => {
    const ctx = ctxAt("## ", 3, true);
    const res = markdownKeywordSource(ctx) as CompletionResult | null;
    expect(res?.from).toBe(0); // matches the `##` prefix
  });

  it("anchors at ctx.pos when there is no matching markup prefix", () => {
    const ctx = ctxAt("plain text", 10, true);
    const res = markdownKeywordSource(ctx) as CompletionResult | null;
    expect(res?.from).toBe(10);
  });
});

describe("addCompletionSource", () => {
  it("registers a plugin source and returns a disposer that removes it", () => {
    const src: CompletionSource = (ctx) => ({
      from: ctx.pos,
      options: [{ label: "plug" }],
    });
    const dispose = addCompletionSource(src);
    expect(typeof dispose).toBe("function");
    dispose();
    // Calling dispose twice doesn't throw — the second call finds nothing to
    // splice out and silently returns.
    expect(() => dispose()).not.toThrow();
  });
});

describe("autocompletionExtension", () => {
  it("returns an extension array combining the autocompletion config and keymap", () => {
    const ext = autocompletionExtension();
    expect(Array.isArray(ext)).toBe(true);
    // Smoke-test: install it without throwing.
    const state = EditorState.create({ doc: "", extensions: [ext] });
    expect(state).toBeDefined();
  });
});
