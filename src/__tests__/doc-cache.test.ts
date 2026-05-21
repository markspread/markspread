// S-ESP-005: shared document cache — buffer-share + dirty + reload epoch.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _resetSaveTimers,
  cancelScheduledSave,
  isDirty,
  scheduleSave,
  useDocCache,
} from "../store/doc-cache";

const WS = "/tmp/ws";

beforeEach(() => {
  vi.useFakeTimers();
  useDocCache.setState({ baselines: {}, live: {}, errors: {}, reloadEpoch: {} });
  _resetSaveTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("doc-cache store", () => {
  it("two panes sharing a path observe the same baseline", () => {
    useDocCache.getState().setBaseline(WS, "/ws/a.md", { content: "hello", encoding: "utf-8" });
    expect(useDocCache.getState().getBaseline(WS, "/ws/a.md")?.content).toBe("hello");
    // A second consumer reads the exact same baseline (reference identity).
    const b1 = useDocCache.getState().getBaseline(WS, "/ws/a.md");
    const b2 = useDocCache.getState().getBaseline(WS, "/ws/a.md");
    expect(b1).toBe(b2);
  });

  it("seeds live content on first baseline load and tracks dirty", () => {
    useDocCache.getState().setBaseline(WS, "/ws/a.md", { content: "abc", encoding: "utf-8" });
    expect(useDocCache.getState().getLive(WS, "/ws/a.md")).toBe("abc");
    expect(isDirty(WS, "/ws/a.md")).toBe(false);
    useDocCache.getState().setLive(WS, "/ws/a.md", "abcd");
    expect(isDirty(WS, "/ws/a.md")).toBe(true);
    useDocCache.getState().setLive(WS, "/ws/a.md", "abc");
    expect(isDirty(WS, "/ws/a.md")).toBe(false);
  });

  it("setLive is a no-op when content is unchanged (identity preserved)", () => {
    useDocCache.getState().setLive(WS, "/ws/a.md", "x");
    const before = useDocCache.getState().live;
    useDocCache.getState().setLive(WS, "/ws/a.md", "x");
    expect(useDocCache.getState().live).toBe(before);
  });

  it("setError + clearError round-trip", () => {
    const decision = { ruleId: "fap.read.denied", category: "policy" } as const;
    useDocCache.getState().setError(WS, "/ws/a.md", decision as never);
    expect(useDocCache.getState().getError(WS, "/ws/a.md")?.ruleId).toBe("fap.read.denied");
    useDocCache.getState().clearError(WS, "/ws/a.md");
    expect(useDocCache.getState().getError(WS, "/ws/a.md")).toBeUndefined();
  });

  it("bumpReload monotonically increments per path", () => {
    expect(useDocCache.getState().bumpReload(WS, "/ws/a.md")).toBe(1);
    expect(useDocCache.getState().bumpReload(WS, "/ws/a.md")).toBe(2);
    expect(useDocCache.getState().bumpReload(WS, "/ws/b.md")).toBe(1);
  });

  it("forget removes all per-path state", () => {
    const s = useDocCache.getState();
    s.setBaseline(WS, "/ws/a.md", { content: "x", encoding: "utf-8" });
    s.setLive(WS, "/ws/a.md", "y");
    s.bumpReload(WS, "/ws/a.md");
    s.forget(WS, "/ws/a.md");
    expect(s.getBaseline(WS, "/ws/a.md")).toBeUndefined();
    expect(s.getLive(WS, "/ws/a.md")).toBeUndefined();
    expect(useDocCache.getState().reloadEpoch[`${WS}::/ws/a.md`]).toBeUndefined();
  });

  it("scheduleSave: two panes on the same path coalesce into one flush", () => {
    const flush = vi.fn();
    // Two PaneEditors each call scheduleSave on the same keystroke.
    scheduleSave(WS, "/ws/a.md", 600, flush);
    scheduleSave(WS, "/ws/a.md", 600, flush);
    vi.advanceTimersByTime(600);
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it("scheduleSave: different paths flush independently", () => {
    const flushA = vi.fn();
    const flushB = vi.fn();
    scheduleSave(WS, "/ws/a.md", 600, flushA);
    scheduleSave(WS, "/ws/b.md", 600, flushB);
    vi.advanceTimersByTime(600);
    expect(flushA).toHaveBeenCalledTimes(1);
    expect(flushB).toHaveBeenCalledTimes(1);
  });

  it("scheduleSave: a later call resets the timer", () => {
    const flush = vi.fn();
    scheduleSave(WS, "/ws/a.md", 600, flush);
    vi.advanceTimersByTime(300);
    scheduleSave(WS, "/ws/a.md", 600, flush);
    vi.advanceTimersByTime(599);
    expect(flush).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it("cancelScheduledSave prevents flush", () => {
    const flush = vi.fn();
    scheduleSave(WS, "/ws/a.md", 600, flush);
    cancelScheduledSave(WS, "/ws/a.md");
    vi.advanceTimersByTime(600);
    expect(flush).not.toHaveBeenCalled();
  });

  it("_resetSaveTimers cancels any pending timers and empties the map", () => {
    const flush = vi.fn();
    scheduleSave(WS, "/ws/a.md", 600, flush);
    _resetSaveTimers();
    vi.advanceTimersByTime(600);
    expect(flush).not.toHaveBeenCalled();
  });

  it("clearError is a no-op when no error is registered for the path", () => {
    const s = useDocCache.getState();
    const before = s.errors;
    s.clearError(WS, "/ws/never-erred.md");
    expect(useDocCache.getState().errors).toBe(before);
  });

  it("isDirty returns false when no baseline has been recorded", () => {
    expect(isDirty(WS, "/ws/no-baseline.md")).toBe(false);
  });

  it("isDirty returns false when live is missing for a baseline-only entry", () => {
    const s = useDocCache.getState();
    s.setBaseline(WS, "/ws/a.md", { content: "x", encoding: "utf-8" });
    // Strip the seeded live entry to exercise the live === undefined branch.
    useDocCache.setState({ live: {} });
    expect(isDirty(WS, "/ws/a.md")).toBe(false);
  });

  it("scopes by workspace — same path in two workspaces is independent", () => {
    const s = useDocCache.getState();
    s.setBaseline("/ws/A", "/x.md", { content: "A", encoding: "utf-8" });
    s.setBaseline("/ws/B", "/x.md", { content: "B", encoding: "utf-8" });
    expect(s.getBaseline("/ws/A", "/x.md")?.content).toBe("A");
    expect(s.getBaseline("/ws/B", "/x.md")?.content).toBe("B");
  });
});
