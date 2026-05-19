// Unit tests for the per-workspace file-tree expansion store.

import { beforeEach, describe, expect, it } from "vitest";
import { useFileTree } from "../store/file-tree";

const WS = "/ws";

beforeEach(() => {
  useFileTree.setState({ expanded: {} });
});

describe("file-tree store", () => {
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
    const before = useFileTree.getState().expanded;
    useFileTree.getState().setExpanded(WS, "/ws/a", false);
    expect(useFileTree.getState().expanded).toBe(before);
  });

  it("setExpanded(true) is a no-op when already expanded", () => {
    useFileTree.getState().setExpanded(WS, "/ws/a", true);
    const before = useFileTree.getState().expanded;
    useFileTree.getState().setExpanded(WS, "/ws/a", true);
    expect(useFileTree.getState().expanded).toBe(before);
  });

  it("keeps expansion state isolated per workspace", () => {
    useFileTree.getState().toggle("/ws-1", "/p");
    expect(useFileTree.getState().isExpanded("/ws-2", "/p")).toBe(false);
  });
});
