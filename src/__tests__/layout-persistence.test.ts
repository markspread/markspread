// S-ESP-009: layout.json (de)serialisation, schema-version safety, prune-missing.

import { describe, expect, it } from "vitest";
import {
  collectPaths,
  type LayoutNode,
  parseEditorLayout,
  pruneEditorLayout,
  serializeEditorLayout,
  type SplitNode,
  type WorkspaceLayout,
} from "../lib/editor/layout-model";

const POS = { line: 0, column: 0, scrollTop: 0 };

function pane(id: string, paths: string[], activeIdx: number | null = 0): LayoutNode {
  const tabs = paths.map((p, i) => ({ id: `${id}-t${i}`, path: p, position: POS }));
  return {
    type: "pane",
    id,
    tabs,
    activeTabId: activeIdx == null ? null : tabs[activeIdx]?.id ?? null,
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

  it("repairs an activePaneId that no longer exists after prune", () => {
    const l = layout(pane("pane-a", ["/x.md"]), "pane-stale");
    const pruned = pruneEditorLayout(l, () => false);
    expect(pruned.activePaneId).toBe("pane-a");
  });
});
