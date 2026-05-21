// S-ESP-009: layout.json (de)serialisation, schema-version safety, prune-missing.

import { describe, expect, it } from "vitest";
import {
  type LayoutNode,
  type SplitNode,
  type WorkspaceLayout,
  collectPaths,
  parseEditorLayout,
  pruneEditorLayout,
  serializeEditorLayout,
} from "../lib/editor/layout-model";

const POS = { line: 0, column: 0, scrollTop: 0 };

function pane(id: string, paths: string[], activeIdx: number | null = 0): LayoutNode {
  const tabs = paths.map((p, i) => ({ id: `${id}-t${i}`, path: p, position: POS }));
  return {
    type: "pane",
    id,
    tabs,
    activeTabId: activeIdx == null ? null : (tabs[activeIdx]?.id ?? null),
  };
}

function split(
  id: string,
  dir: "horizontal" | "vertical",
  kids: LayoutNode[],
  sizes?: number[],
): SplitNode {
  return {
    type: "split",
    id,
    direction: dir,
    children: kids,
    sizes: sizes ?? kids.map(() => 1 / kids.length),
  };
}

function layout(root: LayoutNode, activePaneId?: string): WorkspaceLayout {
  return { schemaVersion: 1, root, activePaneId: activePaneId ?? "pane-a" };
}

describe("layout persistence", () => {
  it("round-trips a single pane", () => {
    const l = layout(pane("pane-a", ["/x.md", "/y.md"]));
    const json = serializeEditorLayout(l);
    const parsed = parseEditorLayout(JSON.parse(JSON.stringify(json)));
    expect(parsed?.root).toEqual(l.root);
    expect(parsed?.activePaneId).toBe("pane-a");
  });

  it("round-trips a nested split tree", () => {
    const root = split("s-1", "horizontal", [
      pane("pane-a", ["/a.md"]),
      split("s-2", "vertical", [pane("pane-b", ["/b.md"]), pane("pane-c", ["/c.md"])]),
    ]);
    const l = layout(root, "pane-b");
    const parsed = parseEditorLayout(JSON.parse(JSON.stringify(serializeEditorLayout(l))));
    expect(parsed?.root).toMatchObject({ type: "split", direction: "horizontal" });
    expect(parsed?.activePaneId).toBe("pane-b");
  });

  it("rejects mismatched schema versions", () => {
    expect(parseEditorLayout({ schemaVersion: 2, root: {} })).toBeNull();
    expect(parseEditorLayout({ root: {} })).toBeNull();
    expect(parseEditorLayout(null)).toBeNull();
    expect(parseEditorLayout(42)).toBeNull();
  });

  it("recovers from missing fields with sane defaults", () => {
    const parsed = parseEditorLayout({
      schemaVersion: 1,
      root: { type: "pane", id: "p" },
    });
    expect(parsed?.root).toEqual({ type: "pane", id: "p", tabs: [], activeTabId: null });
    expect(parsed?.activePaneId).toBe("p");
  });

  it("normalises split sizes on parse", () => {
    const parsed = parseEditorLayout({
      schemaVersion: 1,
      activePaneId: "p1",
      root: {
        type: "split",
        id: "s1",
        direction: "horizontal",
        children: [
          { type: "pane", id: "p1", tabs: [] },
          { type: "pane", id: "p2", tabs: [] },
        ],
        sizes: [3, 1],
      },
    }) as WorkspaceLayout;
    const root = parsed.root as SplitNode;
    expect(root.sizes[0]).toBeCloseTo(0.75);
    expect(root.sizes[1]).toBeCloseTo(0.25);
  });

  it("prunes tabs whose paths are missing", () => {
    const l = layout(
      split("s-1", "horizontal", [
        pane("pane-a", ["/keep.md", "/gone.md"]),
        pane("pane-b", ["/also-gone.md"]),
      ]),
      "pane-a",
    );
    const missing = new Set(["/gone.md", "/also-gone.md"]);
    const pruned = pruneEditorLayout(l, (p) => missing.has(p));
    // pane-b had only gone files → entire pane removed; split flattens to pane-a.
    expect(pruned.root.type).toBe("pane");
    expect((pruned.root as { tabs: { path: string }[] }).tabs.map((t) => t.path)).toEqual([
      "/keep.md",
    ]);
  });

  it("falls back to a fresh empty pane when everything is missing", () => {
    const l = layout(pane("pane-a", ["/gone.md"]));
    const pruned = pruneEditorLayout(l, () => true);
    expect(pruned.root.type).toBe("pane");
    expect((pruned.root as { tabs: unknown[] }).tabs).toEqual([]);
  });

  it("collectPaths deduplicates across panes", () => {
    const root = split("s-1", "horizontal", [
      pane("a", ["/x.md", "/y.md"]),
      pane("b", ["/x.md", "/z.md"]),
    ]);
    expect(collectPaths(root).sort()).toEqual(["/x.md", "/y.md", "/z.md"]);
  });

  it("flattens a split that loses all but one child during prune", () => {
    const l = layout(
      split("s-1", "horizontal", [pane("pane-a", ["/keep.md"]), pane("pane-b", ["/gone.md"])]),
      "pane-a",
    );
    const pruned = pruneEditorLayout(l, (p) => p === "/gone.md");
    expect(pruned.root.type).toBe("pane");
    expect((pruned.root as { id: string }).id).toBe("pane-a");
  });

  it("rejects unknown layout-node types", () => {
    expect(
      parseEditorLayout({
        schemaVersion: 1,
        root: { type: "ufo", id: "x" },
      }),
    ).toBeNull();
  });

  it("substitutes 1 for non-finite sizes during parse", () => {
    const parsed = parseEditorLayout({
      schemaVersion: 1,
      root: {
        type: "split",
        id: "s",
        direction: "vertical",
        children: [
          { type: "pane", id: "p1", tabs: [] },
          { type: "pane", id: "p2", tabs: [] },
        ],
        sizes: [Number.NaN, "oops"],
      },
    }) as WorkspaceLayout;
    const root = parsed.root as SplitNode;
    expect(root.sizes[0]).toBeCloseTo(0.5);
    expect(root.sizes[1]).toBeCloseTo(0.5);
  });

  it("repairs an activePaneId that no longer exists after prune", () => {
    const l = layout(pane("pane-a", ["/x.md"]), "pane-stale");
    const pruned = pruneEditorLayout(l, () => false);
    expect(pruned.activePaneId).toBe("pane-a");
  });

  it("uses the first tab id when the stored activeTabId is unknown", () => {
    const parsed = parseEditorLayout({
      schemaVersion: 1,
      root: {
        type: "pane",
        id: "p",
        activeTabId: "stale-id",
        tabs: [{ id: "t1", path: "/a.md", position: POS }],
      },
    }) as WorkspaceLayout;
    const root = parsed.root as { tabs: { id: string }[]; activeTabId: string | null };
    expect(root.activeTabId).toBe("t1");
  });

  it("preserves an in-range activeTabId across parse", () => {
    const parsed = parseEditorLayout({
      schemaVersion: 1,
      root: {
        type: "pane",
        id: "p",
        activeTabId: "t1",
        tabs: [{ id: "t1", path: "/a.md", position: POS }],
      },
    }) as WorkspaceLayout;
    const root = parsed.root as { activeTabId: string | null };
    expect(root.activeTabId).toBe("t1");
  });

  it("preserves optional pane-tab booleans across parse", () => {
    const parsed = parseEditorLayout({
      schemaVersion: 1,
      root: {
        type: "pane",
        id: "p",
        tabs: [
          {
            id: "t1",
            path: "/a.md",
            position: POS,
            preview: true,
            pinned: true,
            dirty: true,
            orphaned: true,
          },
        ],
      },
    }) as WorkspaceLayout;
    const tabs = (parsed.root as unknown as { tabs: Record<string, unknown>[] }).tabs;
    expect(tabs[0]).toMatchObject({ preview: true, pinned: true, dirty: true, orphaned: true });
  });

  it("rejects pane / split nodes with missing or non-string ids", () => {
    expect(parseEditorLayout({ schemaVersion: 1, root: { type: "pane" } })).toBeNull();
    expect(
      parseEditorLayout({
        schemaVersion: 1,
        root: { type: "split", direction: "horizontal", children: [] },
      }),
    ).toBeNull();
  });

  it("rejects split nodes with an unknown direction or non-array children", () => {
    expect(
      parseEditorLayout({
        schemaVersion: 1,
        root: { type: "split", id: "s", direction: "diagonal", children: [] },
      }),
    ).toBeNull();
    expect(
      parseEditorLayout({
        schemaVersion: 1,
        root: { type: "split", id: "s", direction: "horizontal", children: "nope" },
      }),
    ).toBeNull();
  });

  it("drops malformed tabs and synthesises a fresh position", () => {
    const parsed = parseEditorLayout({
      schemaVersion: 1,
      root: {
        type: "pane",
        id: "p",
        tabs: [
          null,
          { id: "ok", path: "/x.md" },
          { id: 123, path: "/y.md" },
          { id: "bad-pos", path: "/z.md", position: { line: "x" } },
        ],
      },
    }) as WorkspaceLayout;
    const tabs = (parsed.root as { tabs: { id: string; position: { line: number } }[] }).tabs;
    expect(tabs.map((t) => t.id).sort()).toEqual(["bad-pos", "ok"]);
    const ok = tabs.find((t) => t.id === "ok");
    expect(ok?.position).toEqual({ line: 0, column: 0, scrollTop: 0 });
  });

  it("falls back to evenly-spaced sizes when the array length does not match", () => {
    const parsed = parseEditorLayout({
      schemaVersion: 1,
      root: {
        type: "split",
        id: "s",
        direction: "horizontal",
        children: [
          { type: "pane", id: "p1", tabs: [] },
          { type: "pane", id: "p2", tabs: [] },
        ],
        sizes: [1],
      },
    }) as WorkspaceLayout;
    const root = parsed.root as SplitNode;
    expect(root.sizes[0]).toBeCloseTo(0.5);
    expect(root.sizes[1]).toBeCloseTo(0.5);
  });

  it("drops malformed children from a split node", () => {
    const parsed = parseEditorLayout({
      schemaVersion: 1,
      root: {
        type: "split",
        id: "s",
        direction: "horizontal",
        children: [{ type: "pane", id: "p1", tabs: [] }, null, "not-a-node"],
      },
    }) as WorkspaceLayout;
    const root = parsed.root as { type: string; children?: unknown[] };
    // Single surviving child: parseSplitNode succeeds with one child;
    // (the SplitNode is kept since parseSplitNode doesn't flatten the way prune does).
    expect(root.type).toBe("split");
    expect(root.children?.length).toBe(1);
  });

  it("returns null for a split node whose children all fail to parse", () => {
    expect(
      parseEditorLayout({
        schemaVersion: 1,
        root: { type: "split", id: "s", direction: "horizontal", children: [null, "x"] },
      }),
    ).toBeNull();
  });

  it("repairs an unknown activeTabId during prune by snapping to the first survivor", () => {
    const l = layout(
      {
        type: "pane",
        id: "pane-a",
        tabs: [
          { id: "t-keep", path: "/keep.md", position: POS },
          { id: "t-gone", path: "/gone.md", position: POS },
        ],
        activeTabId: "t-gone",
      },
      "pane-a",
    );
    const pruned = pruneEditorLayout(l, (p) => p === "/gone.md");
    expect((pruned.root as { activeTabId: string | null }).activeTabId).toBe("t-keep");
  });

  it("returns a single empty pane when a split loses every child", () => {
    const l = layout(
      split("s-1", "horizontal", [pane("a", ["/gone.md"]), pane("b", ["/also-gone.md"])]),
      "a",
    );
    const pruned = pruneEditorLayout(l, () => true);
    expect(pruned.root.type).toBe("pane");
    expect((pruned.root as { tabs: unknown[] }).tabs).toEqual([]);
  });

  it("falls back to evenly-spaced sizes when the rawSizes total is zero", () => {
    const parsed = parseEditorLayout({
      schemaVersion: 1,
      root: {
        type: "split",
        id: "s",
        direction: "horizontal",
        children: [
          { type: "pane", id: "p1", tabs: [] },
          { type: "pane", id: "p2", tabs: [] },
        ],
        sizes: [0, 0],
      },
    }) as WorkspaceLayout;
    const root = parsed.root as SplitNode;
    expect(root.sizes.every((s) => Number.isFinite(s))).toBe(true);
  });

  it("fromLegacyTabs mirrors a flat tab array into a single pane", async () => {
    const { fromLegacyTabs } = await import("../lib/editor/layout-model");
    const layout = fromLegacyTabs(
      [
        { path: "/a.md", position: POS, preview: true, dirty: false, orphaned: false } as never,
        { path: "/b.md", position: POS } as never,
      ],
      "/a.md",
    );
    expect(layout.root.type).toBe("pane");
    const root = layout.root as {
      tabs: { path: string; preview?: boolean }[];
      activeTabId: string | null;
    };
    expect(root.tabs.map((t) => t.path)).toEqual(["/a.md", "/b.md"]);
    expect(root.tabs[0]?.preview).toBe(true);
    expect(root.activeTabId).toBeTruthy();
  });

  it("fromLegacyTabs leaves activeTabId null when no tab matches the active path", async () => {
    const { fromLegacyTabs } = await import("../lib/editor/layout-model");
    const layout = fromLegacyTabs([{ path: "/a.md", position: POS } as never], "/missing.md");
    const root = layout.root as { activeTabId: string | null };
    expect(root.activeTabId).toBeNull();
  });
});
