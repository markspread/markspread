// MAR-1014: collapse-state file-format round-trip.

import { beforeEach, describe, expect, it } from "vitest";
import { splitKeyForWorkspace, useFileTree } from "./file-tree";
import {
  applyCollapseState,
  deserializeCollapseState,
  serializeCollapseState,
} from "./file-tree-collapse";

beforeEach(() => {
  useFileTree.setState({ splits: {} });
});

describe("file-tree-collapse", () => {
  it("serialize -> deserialize round-trips a populated store", () => {
    const k = splitKeyForWorkspace("/ws", "split-a");
    useFileTree.getState().setExpandedFor(k, "/ws/docs", true);
    useFileTree.getState().setExpandedFor(k, "/ws/notes", true);
    const json = serializeCollapseState();
    expect(json.schemaVersion).toBe(1);
    expect(json.splits[k]?.expanded).toEqual(["/ws/docs", "/ws/notes"]);
    const parsed = deserializeCollapseState(JSON.parse(JSON.stringify(json)));
    expect(parsed).not.toBeNull();
    if (!parsed) throw new Error("expected parse to succeed");
    applyCollapseState(parsed);
    expect(useFileTree.getState().splits[k]).toEqual(["/ws/docs", "/ws/notes"]);
  });

  it("serialize drops empty splits", () => {
    const k = splitKeyForWorkspace("/ws", "split-a");
    useFileTree.setState({ splits: { [k]: [] } });
    const json = serializeCollapseState();
    expect(json.splits).toEqual({});
  });

  it("deserialize rejects a non-object input", () => {
    expect(deserializeCollapseState(null)).toBeNull();
    expect(deserializeCollapseState(42)).toBeNull();
    expect(deserializeCollapseState("nope")).toBeNull();
  });

  it("deserialize rejects an unknown schema version", () => {
    expect(deserializeCollapseState({ schemaVersion: 999, splits: {} })).toBeNull();
  });

  it("deserialize rejects a missing/non-object splits map", () => {
    expect(deserializeCollapseState({ schemaVersion: 1 })).toBeNull();
    expect(deserializeCollapseState({ schemaVersion: 1, splits: "x" })).toBeNull();
  });

  it("deserialize skips malformed entries", () => {
    const parsed = deserializeCollapseState({
      schemaVersion: 1,
      splits: {
        "w:s:a": { expanded: ["/a", 42, "/b"] },
        "w:s:b": { expanded: "nope" },
        "w:s:c": "not-an-object",
        "w:s:d": null,
      },
    });
    expect(parsed).not.toBeNull();
    if (!parsed) throw new Error("expected parse");
    expect(parsed.splits["w:s:a"]?.expanded).toEqual(["/a", "/b"]);
    expect(parsed.splits["w:s:b"]).toBeUndefined();
    expect(parsed.splits["w:s:c"]).toBeUndefined();
    expect(parsed.splits["w:s:d"]).toBeUndefined();
  });

  it("applyCollapseState replaces the in-memory splits wholesale", () => {
    useFileTree.setState({
      splits: { "w:s:old": ["/x"] },
    });
    applyCollapseState({
      schemaVersion: 1,
      splits: { "w:s:new": { expanded: ["/y"] } },
    });
    expect(useFileTree.getState().splits["w:s:old"]).toBeUndefined();
    expect(useFileTree.getState().splits["w:s:new"]).toEqual(["/y"]);
  });
});
