// MAR-1014: per-split file-tree store — back-compat suite.
//
// The legacy `(workspace, path)` API still works for single-shell
// callers (EditorShell single-tab single-split fast path, SidebarPeek).
// All operations route through the window's default split slot.

import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_SPLIT_ID,
  fileTreeSplitKey,
  migrateLegacyFileTreeState,
  splitKeyForWorkspace,
  useFileTree,
} from "../store/file-tree";
import { workspaceIdFor } from "../store/workspace-layout";

const WS = "/ws";

beforeEach(() => {
  useFileTree.setState({ splits: {} });
});

describe("file-tree store (legacy back-compat)", () => {
  it("isExpanded is false for an unknown workspace", () => {
    expect(useFileTree.getState().isExpanded(WS, "/ws/a")).toBe(false);
  });

  it("toggle adds then removes a path", () => {
    useFileTree.getState().toggle(WS, "/ws/a");
    expect(useFileTree.getState().isExpanded(WS, "/ws/a")).toBe(true);
    useFileTree.getState().toggle(WS, "/ws/a");
    expect(useFileTree.getState().isExpanded(WS, "/ws/a")).toBe(false);
  });

  it("toggle keeps other expanded paths intact", () => {
    useFileTree.getState().toggle(WS, "/ws/a");
    useFileTree.getState().toggle(WS, "/ws/b");
    useFileTree.getState().toggle(WS, "/ws/a");
    expect(useFileTree.getState().isExpanded(WS, "/ws/b")).toBe(true);
  });

  it("setExpanded(true) expands a path", () => {
    useFileTree.getState().setExpanded(WS, "/ws/a", true);
    expect(useFileTree.getState().isExpanded(WS, "/ws/a")).toBe(true);
  });

  it("setExpanded(false) collapses a path", () => {
    useFileTree.getState().setExpanded(WS, "/ws/a", true);
    useFileTree.getState().setExpanded(WS, "/ws/a", false);
    expect(useFileTree.getState().isExpanded(WS, "/ws/a")).toBe(false);
  });

  it("setExpanded is a no-op when state already matches", () => {
    useFileTree.getState().setExpanded(WS, "/ws/a", false);
    const before = useFileTree.getState().splits;
    useFileTree.getState().setExpanded(WS, "/ws/a", false);
    expect(useFileTree.getState().splits).toBe(before);
  });

  it("setExpanded(true) is a no-op when already expanded", () => {
    useFileTree.getState().setExpanded(WS, "/ws/a", true);
    const before = useFileTree.getState().splits;
    useFileTree.getState().setExpanded(WS, "/ws/a", true);
    expect(useFileTree.getState().splits).toBe(before);
  });

  it("keeps expansion state isolated per workspace", () => {
    useFileTree.getState().toggle("/ws-1", "/p");
    expect(useFileTree.getState().isExpanded("/ws-2", "/p")).toBe(false);
  });
});

describe("file-tree store (per-split MAR-1014)", () => {
  it("isolates two splits over the same workspace", () => {
    const a = splitKeyForWorkspace(WS, "split-a");
    const b = splitKeyForWorkspace(WS, "split-b");
    useFileTree.getState().toggleFor(a, "/ws/docs");
    expect(useFileTree.getState().isExpandedFor(a, "/ws/docs")).toBe(true);
    expect(useFileTree.getState().isExpandedFor(b, "/ws/docs")).toBe(false);
  });

  it("setExpandedFor(true)/setExpandedFor(false) round-trip", () => {
    const k = splitKeyForWorkspace(WS, "k");
    useFileTree.getState().setExpandedFor(k, "/p", true);
    expect(useFileTree.getState().isExpandedFor(k, "/p")).toBe(true);
    useFileTree.getState().setExpandedFor(k, "/p", false);
    expect(useFileTree.getState().isExpandedFor(k, "/p")).toBe(false);
  });

  it("setExpandedFor is a no-op when state already matches", () => {
    const k = splitKeyForWorkspace(WS, "k");
    useFileTree.getState().setExpandedFor(k, "/p", false);
    const before = useFileTree.getState().splits;
    useFileTree.getState().setExpandedFor(k, "/p", false);
    expect(useFileTree.getState().splits).toBe(before);
  });

  it("seedSplit copies initial paths but never overwrites an existing slot", () => {
    const k = splitKeyForWorkspace(WS, "k");
    useFileTree.getState().seedSplit(k, ["/a", "/b"]);
    expect(useFileTree.getState().splits[k]).toEqual(["/a", "/b"]);
    useFileTree.getState().seedSplit(k, ["/c"]);
    expect(useFileTree.getState().splits[k]).toEqual(["/a", "/b"]);
  });

  it("removeSplit drops the slot's entry", () => {
    const k = splitKeyForWorkspace(WS, "k");
    useFileTree.getState().toggleFor(k, "/a");
    useFileTree.getState().removeSplit(k);
    expect(useFileTree.getState().splits[k]).toBeUndefined();
  });

  it("removeSplit is a no-op for an unknown key", () => {
    useFileTree.getState().toggleFor(splitKeyForWorkspace(WS, "kept"), "/a");
    const before = useFileTree.getState().splits;
    useFileTree.getState().removeSplit("missing-key");
    expect(useFileTree.getState().splits).toBe(before);
  });

  it("retainSplits GCs any key not in the keep set", () => {
    const a = splitKeyForWorkspace(WS, "a");
    const b = splitKeyForWorkspace(WS, "b");
    useFileTree.getState().toggleFor(a, "/p");
    useFileTree.getState().toggleFor(b, "/p");
    useFileTree.getState().retainSplits(new Set([a]));
    expect(useFileTree.getState().splits[a]).toEqual(["/p"]);
    expect(useFileTree.getState().splits[b]).toBeUndefined();
  });

  it("retainSplits is a no-op when every slot is already kept", () => {
    const a = splitKeyForWorkspace(WS, "a");
    useFileTree.getState().toggleFor(a, "/p");
    const before = useFileTree.getState().splits;
    useFileTree.getState().retainSplits(new Set([a]));
    expect(useFileTree.getState().splits).toBe(before);
  });

  it("legacy isExpanded/setExpanded route through the default split slot", () => {
    useFileTree.getState().setExpanded(WS, "/docs", true);
    const key = fileTreeSplitKey("main", DEFAULT_SPLIT_ID, workspaceIdFor(WS));
    expect(useFileTree.getState().splits[key]).toEqual(["/docs"]);
  });

  it("fileTreeSplitKey composes a deterministic key", () => {
    expect(fileTreeSplitKey("w", "s", "id")).toBe("w:s:id");
  });
});

describe("migrateLegacyFileTreeState", () => {
  it("returns an empty store for null / non-object inputs", () => {
    expect(migrateLegacyFileTreeState(null)).toEqual({ splits: {} });
    expect(migrateLegacyFileTreeState(123)).toEqual({ splits: {} });
  });

  it("passes through an already-migrated payload", () => {
    const splits = { "main:default:abc": ["/p"] };
    expect(migrateLegacyFileTreeState({ splits })).toEqual({ splits });
  });

  it("lifts legacy `expanded` per-workspace map under the default split slot", () => {
    const out = migrateLegacyFileTreeState({
      expanded: { "/ws": ["/ws/docs", "/ws/notes"], "/empty": [] },
    });
    const key = fileTreeSplitKey("main", DEFAULT_SPLIT_ID, workspaceIdFor("/ws"));
    expect(out.splits[key]).toEqual(["/ws/docs", "/ws/notes"]);
    // Empty workspace entries are dropped — no point persisting zeros.
    const emptyKey = fileTreeSplitKey("main", DEFAULT_SPLIT_ID, workspaceIdFor("/empty"));
    expect(out.splits[emptyKey]).toBeUndefined();
  });

  it("skips legacy entries whose value isn't a string array", () => {
    const out = migrateLegacyFileTreeState({
      expanded: { "/ws": "broken" },
    });
    expect(out.splits).toEqual({});
  });

  it("filters non-string members from legacy arrays", () => {
    const out = migrateLegacyFileTreeState({
      expanded: { "/ws": ["/ok", 7, null, "/also"] },
    });
    const key = fileTreeSplitKey("main", DEFAULT_SPLIT_ID, workspaceIdFor("/ws"));
    expect(out.splits[key]).toEqual(["/ok", "/also"]);
  });

  it("treats a missing legacy expanded field as empty", () => {
    expect(migrateLegacyFileTreeState({})).toEqual({ splits: {} });
  });
});
