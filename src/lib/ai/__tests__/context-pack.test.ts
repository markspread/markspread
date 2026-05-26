// ADR-0010 D4 validation: priority + trimming + telemetry.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { subscribeTelemetry, useTelemetry } from "../../../store/telemetry";
import {
  buildContextPack,
  estimateTokens,
  getRecentlyEditedFiles,
  reportMessageSent,
} from "../context-pack";

describe("estimateTokens", () => {
  it("returns 0 for empty input", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("uses chars/4 rounded up", () => {
    expect(estimateTokens("a")).toBe(1);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
  });
});

describe("buildContextPack", () => {
  beforeEach(() => {
    useTelemetry.setState({ consent: "enabled" });
  });
  afterEach(() => {
    useTelemetry.setState({ consent: "unset" });
  });

  it("orders blocks: selection > activeFile > recentChanges > pinned > workspaceMeta", () => {
    const pack = buildContextPack({
      workspaceId: "ws1",
      workspaceName: "Notes",
      workspaceFileCount: 12,
      activeFilePath: "a.md",
      activeFileContent: "hello",
      selection: "pick me",
      recentlyEdited: [{ path: "b.md", mtime: 1 }],
      pinnedSnippets: [{ label: "pin", text: "p" }],
      tokenBudget: 100_000,
    });
    expect(pack.blocks.map((b) => b.kind)).toEqual([
      "selection",
      "activeFile",
      "recentChanges",
      "pinned",
      "workspaceMeta",
    ]);
    expect(pack.trimmedKinds).toEqual([]);
    expect(pack.tokensUsed).toBeGreaterThan(0);
  });

  it("skips an empty selection (whitespace only)", () => {
    const pack = buildContextPack({
      workspaceId: "ws1",
      selection: "   \n",
      tokenBudget: 1000,
    });
    expect(pack.blocks.map((b) => b.kind)).toEqual(["workspaceMeta"]);
  });

  it("skips activeFile when content is missing or empty", () => {
    const pack = buildContextPack({
      workspaceId: "ws1",
      activeFilePath: "a.md",
      activeFileContent: "",
      tokenBudget: 1000,
    });
    expect(pack.blocks.map((b) => b.kind)).toEqual(["workspaceMeta"]);
  });

  it("inlines recently-edited file diffs when supplied", () => {
    const pack = buildContextPack({
      workspaceId: "ws1",
      recentlyEdited: [
        { path: "a.md", mtime: 1, diff: "+ hi" },
        { path: "b.md", mtime: 2 },
      ],
      tokenBudget: 1000,
    });
    const recent = pack.blocks.find((b) => b.kind === "recentChanges");
    expect(recent?.text).toContain("a.md");
    expect(recent?.text).toContain("+ hi");
    expect(recent?.text).toContain("- b.md");
  });

  it("trims from the LOW priority end and reports trimmedKinds + telemetry", () => {
    const events: unknown[] = [];
    const off = subscribeTelemetry((e) => events.push(e));
    try {
      // Make the big blocks huge so trimming kicks in. Budget tight.
      const big = "x".repeat(4_000);
      const pack = buildContextPack({
        workspaceId: "ws1",
        selection: big, // ~1000 tokens
        activeFilePath: "a.md",
        activeFileContent: big,
        recentlyEdited: [{ path: "b.md", mtime: 1, diff: big }],
        pinnedSnippets: [{ label: "p", text: big }],
        tokenBudget: 1500,
      });
      expect(pack.trimmedKinds.length).toBeGreaterThan(0);
      // workspaceMeta + pinned trimmed first (lowest priority).
      expect(pack.trimmedKinds).toContain("workspaceMeta");
      expect(pack.trimmedKinds).toContain("pinned");
      expect(pack.tokensUsed).toBeLessThanOrEqual(1500);
      const trimmedEvt = events.find(
        (e): e is { type: "chat.context_trimmed"; trimmedKinds: string[] } =>
          (e as { type: string }).type === "chat.context_trimmed",
      );
      expect(trimmedEvt).toBeDefined();
    } finally {
      off();
    }
  });

  it("workspaceMeta omits optional fields when not supplied", () => {
    const pack = buildContextPack({ workspaceId: "ws1", tokenBudget: 1000 });
    const meta = pack.blocks.find((b) => b.kind === "workspaceMeta");
    expect(meta?.text).toBe("workspaceId=ws1");
  });
});

describe("getRecentlyEditedFiles", () => {
  it("filters by window and sorts newest-first", () => {
    const now = 1_000_000;
    const out = getRecentlyEditedFiles(
      [
        { path: "old.md", mtime: now - 600_000 },
        { path: "new.md", mtime: now - 100 },
        { path: "mid.md", mtime: now - 5_000 },
      ],
      10_000,
      now,
    );
    expect(out.map((f) => f.path)).toEqual(["new.md", "mid.md"]);
  });

  it("uses Date.now() when `now` is omitted", () => {
    const real = Date.now();
    const out = getRecentlyEditedFiles([{ path: "a.md", mtime: real - 5 }], 10_000);
    expect(out).toHaveLength(1);
  });
});

describe("reportMessageSent", () => {
  beforeEach(() => useTelemetry.setState({ consent: "enabled" }));
  afterEach(() => useTelemetry.setState({ consent: "unset" }));

  it("emits chat.message_sent with the pack contents", () => {
    const fn = vi.fn();
    const off = subscribeTelemetry(fn);
    try {
      reportMessageSent({
        workspaceId: "ws1",
        pack: {
          blocks: [{ kind: "selection", label: "Selection", text: "x", tokens: 1 }],
          tokensUsed: 1,
          tokensBudget: 100,
          trimmedKinds: [],
        },
      });
      expect(fn).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "chat.message_sent",
          workspaceId: "ws1",
          contextBlocks: ["selection"],
          tokensUsed: 1,
          tokensBudget: 100,
        }),
      );
    } finally {
      off();
    }
  });
});
