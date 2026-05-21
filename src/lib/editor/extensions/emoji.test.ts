// S-MD-043: emoji shortcode helpers + completion source.

import type {
  CompletionContext,
  CompletionResult,
  CompletionSource,
} from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { beforeEach, describe, expect, it, vi } from "vitest";

const hoist = vi.hoisted(() => ({ src: undefined as CompletionSource | undefined }));
vi.mock("./autocompletion", () => ({
  addCompletionSource: (src: CompletionSource) => {
    hoist.src = src;
    return () => {};
  },
}));

import { addEmojiShortcode, setEmojiEnabled } from "./emoji";

function makeContext(doc: string, pos: number, explicit = true): CompletionContext {
  const state = EditorState.create({ doc });
  return {
    state,
    pos,
    explicit,
    matchBefore: () => null,
    aborted: false,
    addEventListener: () => {},
  } as unknown as CompletionContext;
}

beforeEach(() => {
  setEmojiEnabled(false);
});

describe("setEmojiEnabled / addEmojiShortcode helpers", () => {
  it("setEmojiEnabled toggles without throwing", () => {
    expect(() => setEmojiEnabled(true)).not.toThrow();
    expect(() => setEmojiEnabled(false)).not.toThrow();
  });

  it("addEmojiShortcode registers a custom glyph that surfaces in results", () => {
    addEmojiShortcode("shrug", "🤷");
    setEmojiEnabled(true);
    const result = hoist.src?.(makeContext("note :sh", 8)) as CompletionResult;
    expect(result.options.some((o) => o.label === ":shrug:")).toBe(true);
  });
});

describe("emoji completion source", () => {
  it("returns null when emoji is disabled", () => {
    setEmojiEnabled(false);
    expect(hoist.src?.(makeContext(":sm", 3))).toBeNull();
  });

  it("returns null when the prefix does not match the trigger regex", () => {
    setEmojiEnabled(true);
    expect(hoist.src?.(makeContext("plain text", 10))).toBeNull();
  });

  it("returns options anchored to the colon for a valid trigger", () => {
    setEmojiEnabled(true);
    const r = hoist.src?.(makeContext("note :smi", 9)) as CompletionResult;
    expect(r.from).toBe(5);
    expect(r.to).toBe(9);
    const labels = r.options.map((o) => o.label);
    expect(labels).toContain(":smile:");
    expect(labels).toContain(":fire:");
  });
});
