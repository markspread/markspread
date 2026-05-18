// S-ESP-008: external-change detection — mtime comparison + deletion handling.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

beforeEach(() => {
  invokeMock.mockReset();
});

afterEach(() => {
  invokeMock.mockReset();
});

describe("detectExternalChange", () => {
  it("returns unchanged when baselineMs is null", async () => {
    const { detectExternalChange } = await import("../lib/external-change");
    const res = await detectExternalChange("/ws", "/a.md", null);
    expect(res).toEqual({ kind: "unchanged" });
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("returns unchanged when current mtime equals baseline", async () => {
    invokeMock.mockResolvedValueOnce({ modified_ms: 1000 });
    const { detectExternalChange } = await import("../lib/external-change");
    const res = await detectExternalChange("/ws", "/a.md", 1000);
    expect(res.kind).toBe("unchanged");
  });

  it("returns modified when current mtime is newer", async () => {
    invokeMock.mockResolvedValueOnce({ modified_ms: 2000 });
    const { detectExternalChange } = await import("../lib/external-change");
    const res = await detectExternalChange("/ws", "/a.md", 1000);
    expect(res).toEqual({ kind: "modified", baselineMs: 1000, currentMs: 2000 });
  });

  it("treats absent current mtime as unchanged", async () => {
    invokeMock.mockResolvedValueOnce({ modified_ms: null });
    const { detectExternalChange } = await import("../lib/external-change");
    const res = await detectExternalChange("/ws", "/a.md", 1000);
    expect(res.kind).toBe("unchanged");
  });

  it("returns deleted on ENOENT-shaped errors", async () => {
    invokeMock.mockRejectedValueOnce(new Error("ENOENT: file not found"));
    const { detectExternalChange } = await import("../lib/external-change");
    const res = await detectExternalChange("/ws", "/a.md", 1000);
    expect(res).toEqual({ kind: "deleted", baselineMs: 1000 });
  });

  it("returns unknown for unexpected errors", async () => {
    invokeMock.mockRejectedValueOnce(new Error("permission denied"));
    const { detectExternalChange } = await import("../lib/external-change");
    const res = await detectExternalChange("/ws", "/a.md", 1000);
    expect(res.kind).toBe("unknown");
  });
});
