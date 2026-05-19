// Unit tests for the toasts store, including the TTL auto-dismiss path.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useToasts } from "../store/toasts";

beforeEach(() => {
  useToasts.setState({ toasts: [] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("toasts store", () => {
  it("push appends a toast and returns a unique id", () => {
    vi.useFakeTimers();
    const id = useToasts.getState().push({ kind: "info", message: "hi" });
    expect(typeof id).toBe("string");
    const toasts = useToasts.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0]?.id).toBe(id);
    expect(toasts[0]?.message).toBe("hi");
  });

  it("auto-dismisses after the default TTL", () => {
    vi.useFakeTimers();
    useToasts.getState().push({ kind: "info", message: "ephemeral" });
    expect(useToasts.getState().toasts).toHaveLength(1);
    vi.advanceTimersByTime(5000);
    expect(useToasts.getState().toasts).toHaveLength(0);
  });

  it("respects a custom TTL", () => {
    vi.useFakeTimers();
    useToasts.getState().push({ kind: "warning", message: "soon", ttlMs: 100 });
    vi.advanceTimersByTime(99);
    expect(useToasts.getState().toasts).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(useToasts.getState().toasts).toHaveLength(0);
  });

  it("a zero TTL keeps the toast sticky", () => {
    vi.useFakeTimers();
    useToasts.getState().push({ kind: "error", message: "sticky", ttlMs: 0 });
    vi.advanceTimersByTime(60_000);
    expect(useToasts.getState().toasts).toHaveLength(1);
  });

  it("dismiss removes a toast by id", () => {
    vi.useFakeTimers();
    const a = useToasts.getState().push({ kind: "info", message: "a", ttlMs: 0 });
    const b = useToasts.getState().push({ kind: "info", message: "b", ttlMs: 0 });
    useToasts.getState().dismiss(a);
    const toasts = useToasts.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0]?.id).toBe(b);
  });

  it("dismiss for an unknown id is a no-op", () => {
    vi.useFakeTimers();
    useToasts.getState().push({ kind: "info", message: "a", ttlMs: 0 });
    useToasts.getState().dismiss("missing");
    expect(useToasts.getState().toasts).toHaveLength(1);
  });

  it("update patches an existing toast in place", () => {
    vi.useFakeTimers();
    const id = useToasts.getState().push({ kind: "info", message: "progress", ttlMs: 0 });
    useToasts.getState().update(id, { message: "progress 50%", details: "halfway" });
    const toast = useToasts.getState().toasts[0];
    expect(toast?.message).toBe("progress 50%");
    expect(toast?.details).toBe("halfway");
    expect(toast?.kind).toBe("info");
  });

  it("update for an unknown id leaves toasts unchanged", () => {
    vi.useFakeTimers();
    useToasts.getState().push({ kind: "info", message: "a", ttlMs: 0 });
    useToasts.getState().update("missing", { message: "x" });
    expect(useToasts.getState().toasts[0]?.message).toBe("a");
  });

  it("auto-dismiss only removes the matching toast", () => {
    vi.useFakeTimers();
    const sticky = useToasts.getState().push({ kind: "info", message: "stays", ttlMs: 0 });
    useToasts.getState().push({ kind: "info", message: "goes", ttlMs: 50 });
    vi.advanceTimersByTime(50);
    const toasts = useToasts.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0]?.id).toBe(sticky);
  });

  it("carries an inline action through push", () => {
    vi.useFakeTimers();
    const onClick = vi.fn();
    useToasts.getState().push({
      kind: "success",
      message: "undoable",
      ttlMs: 0,
      action: { label: "Undo", onClick },
    });
    useToasts.getState().toasts[0]?.action?.onClick();
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
