// S-AI-009..014: Translate pipeline pure-logic coverage.

import { describe, expect, it } from "vitest";
import {
  type TranslateChunk,
  assembleDocument,
  chunkDocument,
  comparePlaceholders,
  maskUntranslatable,
  unmaskUntranslatable,
} from "../translate";

describe("chunkDocument", () => {
  it("returns no chunks for an empty document", () => {
    expect(chunkDocument("")).toEqual([]);
  });

  it("groups paragraphs three per chunk", () => {
    const doc = ["p1", "", "p2", "", "p3", "", "p4"].join("\n");
    const chunks = chunkDocument(doc);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]?.source).toContain("p1");
    expect(chunks[0]?.source).toContain("p3");
    expect(chunks[1]?.source).toContain("p4");
  });

  it("records 1-based start and end lines", () => {
    const chunks = chunkDocument("first line\nsecond line");
    expect(chunks[0]?.startLine).toBe(1);
    expect(chunks[0]?.endLine).toBe(2);
  });

  it("handles a document that ends without a blank line", () => {
    const chunks = chunkDocument("only paragraph");
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.decision).toBeNull();
  });
});

describe("maskUntranslatable / unmaskUntranslatable", () => {
  it("masks fenced code blocks", () => {
    const { masked, segments } = maskUntranslatable("text\n```\ncode\n```\nmore");
    expect(segments).toHaveLength(1);
    expect(masked).toContain("MS0");
    expect(masked).not.toContain("code");
  });

  it("masks inline code and math", () => {
    const { segments } = maskUntranslatable("a `inline` and $x+y$ end");
    expect(segments).toHaveLength(2);
  });

  it("masks block math", () => {
    const { segments } = maskUntranslatable("text $$E=mc^2$$ done");
    expect(segments).toHaveLength(1);
  });

  it("round-trips when placeholders are preserved", () => {
    const m = maskUntranslatable("a `code` b");
    const restored = unmaskUntranslatable(m, m.masked);
    expect(restored).toBe("a `code` b");
  });

  it("appends a lost segment when a placeholder is dropped", () => {
    const m = maskUntranslatable("a `code` b");
    const restored = unmaskUntranslatable(m, "translated without marker");
    expect(restored).toContain("`code`");
  });
});

describe("comparePlaceholders", () => {
  it("reports zero expected when source has no markers", () => {
    const r = comparePlaceholders("plain", "plain");
    expect(r.expected).toBe(0);
    expect(r.missing).toEqual([]);
  });

  it("detects a missing placeholder", () => {
    const masked = "\x01MS0\x01 and \x01MS1\x01";
    const out = "only \x01MS0\x01 survived";
    const r = comparePlaceholders(masked, out);
    expect(r.expected).toBe(2);
    expect(r.found).toBe(1);
    expect(r.missing).toEqual([1]);
  });
});

describe("assembleDocument", () => {
  const doc = "line1\nline2\nline3";

  function chunk(over: Partial<TranslateChunk>): TranslateChunk {
    return {
      id: "c0",
      startLine: 1,
      endLine: 1,
      source: "line1",
      decision: null,
      ...over,
    };
  }

  it("keeps original lines when the chunk is pending", () => {
    expect(assembleDocument(doc, [chunk({})])).toBe(doc);
  });

  it("keeps original lines when the chunk is rejected", () => {
    expect(assembleDocument(doc, [chunk({ decision: "reject" })])).toBe(doc);
  });

  it("substitutes the translation for an accepted chunk", () => {
    const out = assembleDocument(doc, [chunk({ decision: "accept", translated: "TRANSLATED" })]);
    expect(out).toBe("TRANSLATED\nline2\nline3");
  });

  it("substitutes the edited text for an edited chunk", () => {
    const out = assembleDocument(doc, [chunk({ decision: "edit", edited: "EDITED" })]);
    expect(out).toBe("EDITED\nline2\nline3");
  });

  it("applies multiple chunks bottom-up keeping line indices stable", () => {
    const out = assembleDocument(doc, [
      chunk({ id: "a", startLine: 1, endLine: 1, decision: "accept", translated: "A" }),
      chunk({ id: "b", startLine: 3, endLine: 3, decision: "accept", translated: "B" }),
    ]);
    expect(out).toBe("A\nline2\nB");
  });
});
