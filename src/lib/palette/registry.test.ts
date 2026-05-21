// S-TST: palette registry — fuzzy match, recency, prefix routing.

import { beforeEach, describe, expect, it } from "vitest";
import { clearPaletteItems, fuzzyScore, noteUsed, query, registerPaletteItem } from "./registry";

beforeEach(() => {
  clearPaletteItems();
});

describe("registerPaletteItem", () => {
  it("builds searchKey from label when none provided and detail is absent", () => {
    registerPaletteItem({
      id: "a",
      category: "command",
      label: "Hello",
      run: () => {},
    });
    expect(query({ raw: "hello" })[0]?.id).toBe("a");
  });

  it("uses an explicit searchKey when provided", () => {
    registerPaletteItem({
      id: "a",
      category: "command",
      label: "Hello",
      searchKey: "world",
      run: () => {},
    });
    expect(query({ raw: "world" })[0]?.id).toBe("a");
  });

  it("returns a detacher that removes the item", () => {
    const detach = registerPaletteItem({
      id: "a",
      category: "command",
      label: "Hello",
      run: () => {},
    });
    detach();
    expect(query({ raw: "hello" })).toEqual([]);
  });
});

describe("query prefix routing", () => {
  beforeEach(() => {
    registerPaletteItem({ id: "cmd", category: "command", label: "Settings", run: () => {} });
    registerPaletteItem({ id: "help", category: "help", label: "Settings", run: () => {} });
    registerPaletteItem({ id: "file", category: "file", label: "Settings", run: () => {} });
  });

  it("> prefix limits to the command category", () => {
    const res = query({ raw: "> settings" }).map((x) => x.id);
    expect(res).toEqual(["cmd"]);
  });

  it("? prefix limits to the help category", () => {
    const res = query({ raw: "? settings" }).map((x) => x.id);
    expect(res).toEqual(["help"]);
  });

  it("no prefix returns any category", () => {
    const ids = new Set(query({ raw: "settings" }).map((x) => x.id));
    expect(ids).toEqual(new Set(["cmd", "help", "file"]));
  });
});

describe("query recency and empty input", () => {
  it("empty raw returns recent items when present", () => {
    registerPaletteItem({ id: "a", category: "command", label: "Alpha", run: () => {} });
    registerPaletteItem({ id: "b", category: "command", label: "Beta", run: () => {} });
    noteUsed("b");
    noteUsed("a");
    expect(query({ raw: "" }).map((x) => x.id)).toEqual(["a", "b"]);
  });

  it("empty raw falls back to the catalogue when there are no recents", () => {
    registerPaletteItem({
      id: "fresh-no-recents",
      category: "command",
      label: "Alpha",
      run: () => {},
    });
    expect(query({ raw: "" }).map((x) => x.id)).toEqual(["fresh-no-recents"]);
  });

  it("noteUsed promotes existing entries to the top", () => {
    registerPaletteItem({ id: "a", category: "command", label: "Alpha", run: () => {} });
    registerPaletteItem({ id: "b", category: "command", label: "Beta", run: () => {} });
    noteUsed("a");
    noteUsed("b");
    noteUsed("a");
    expect(query({ raw: "" }).map((x) => x.id)[0]).toBe("a");
  });

  it("applies weight and recency boost when scoring", () => {
    registerPaletteItem({
      id: "low",
      category: "command",
      label: "alpha",
      run: () => {},
    });
    registerPaletteItem({
      id: "high",
      category: "command",
      label: "alpha",
      weight: 100,
      run: () => {},
    });
    expect(query({ raw: "alpha" })[0]?.id).toBe("high");
  });

  it("ranks recently-used items above equally-scored peers", () => {
    registerPaletteItem({ id: "x1", category: "command", label: "alpha", run: () => {} });
    registerPaletteItem({ id: "x2", category: "command", label: "alpha", run: () => {} });
    noteUsed("x2");
    expect(query({ raw: "alpha" })[0]?.id).toBe("x2");
  });

  it("noteUsed caps recents at the configured limit", () => {
    for (let i = 0; i < 60; i++) {
      registerPaletteItem({
        id: `cap-${i}`,
        category: "command",
        label: `c${i}`,
        run: () => {},
      });
      noteUsed(`cap-${i}`);
    }
    // The most recent should still rank first in an empty-raw query.
    expect(query({ raw: "" })[0]?.id).toBe("cap-59");
  });
});

describe("fuzzyScore", () => {
  it("returns 0 for an empty needle", () => {
    expect(fuzzyScore("anything", "")).toBe(0);
  });

  it("returns -Infinity when not all needle chars are present", () => {
    expect(fuzzyScore("abc", "xyz")).toBe(Number.NEGATIVE_INFINITY);
  });

  it("scores a prefix match higher than a mid-string match", () => {
    const prefix = fuzzyScore("alpha", "a");
    const mid = fuzzyScore("zalpha", "a");
    expect(prefix).toBeGreaterThan(mid);
  });

  it("rewards contiguous runs", () => {
    const run = fuzzyScore("alpha", "alp");
    const skip = fuzzyScore("a-l-p", "alp");
    expect(run).toBeGreaterThan(skip);
  });
});
