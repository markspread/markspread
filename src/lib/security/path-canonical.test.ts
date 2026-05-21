// S-SE-001 / S-SE-003: path canonicalisation + workspace-scope check.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import { PathTraversalError, canonicalize, inWorkspace, looksTraversal } from "./path-canonical";

const mockInvoke = invoke as unknown as ReturnType<typeof vi.fn>;

function mockCanon(map: Record<string, string>): void {
  mockInvoke.mockImplementation((_cmd: string, args: { path: string }) => {
    const v = map[args.path];
    /* v8 ignore next -- defensive default: tests always seed every probed path */
    return Promise.resolve(v ?? args.path);
  });
}

beforeEach(() => {
  mockInvoke.mockReset();
});

describe("PathTraversalError", () => {
  it("captures attempt and workspace and is named", () => {
    const err = new PathTraversalError("/etc/passwd", "/ws");
    expect(err.attempt).toBe("/etc/passwd");
    expect(err.workspace).toBe("/ws");
    expect(err.name).toBe("PathTraversalError");
    expect(err.message).toContain("/etc/passwd");
    expect(err.message).toContain("/ws");
  });
});

describe("canonicalize", () => {
  it("delegates to fs_canonicalize", async () => {
    mockCanon({ "/a/../b": "/b" });
    const r = await canonicalize("/a/../b");
    expect(r).toBe("/b");
    expect(mockInvoke).toHaveBeenCalledWith("fs_canonicalize", { path: "/a/../b" });
  });
});

describe("inWorkspace", () => {
  it("returns the canonical candidate when it equals the workspace", async () => {
    mockCanon({ "/ws": "/ws" });
    expect(await inWorkspace("/ws", "/ws")).toBe("/ws");
  });

  it("returns the canonical candidate when it sits inside the workspace", async () => {
    mockCanon({ "/ws": "/ws", "/ws/sub/file.md": "/ws/sub/file.md" });
    expect(await inWorkspace("/ws", "/ws/sub/file.md")).toBe("/ws/sub/file.md");
  });

  it("throws PathTraversalError when the candidate escapes", async () => {
    mockCanon({ "/ws": "/ws", "/etc/passwd": "/etc/passwd" });
    await expect(inWorkspace("/ws", "/etc/passwd")).rejects.toBeInstanceOf(PathTraversalError);
  });

  it("rejects /foobar when the workspace is /foo (no false-prefix match)", async () => {
    mockCanon({ "/foo": "/foo", "/foobar/x": "/foobar/x" });
    await expect(inWorkspace("/foo", "/foobar/x")).rejects.toBeInstanceOf(PathTraversalError);
  });

  it("handles a workspace that already ends with the separator", async () => {
    mockCanon({ "/ws/": "/ws/", "/ws/file": "/ws/file" });
    expect(await inWorkspace("/ws/", "/ws/file")).toBe("/ws/file");
  });

  it("uses backslash separator on windows-style paths", async () => {
    mockCanon({
      "C:\\ws": "C:\\ws",
      "C:\\ws\\sub\\file": "C:\\ws\\sub\\file",
    });
    expect(await inWorkspace("C:\\ws", "C:\\ws\\sub\\file")).toBe("C:\\ws\\sub\\file");
  });

  it("handles a windows workspace already ending in backslash", async () => {
    mockCanon({ "C:\\ws\\": "C:\\ws\\", "C:\\ws\\f": "C:\\ws\\f" });
    expect(await inWorkspace("C:\\ws\\", "C:\\ws\\f")).toBe("C:\\ws\\f");
  });
});

describe("looksTraversal", () => {
  it("flags interior /../", () => {
    expect(looksTraversal("/a/../b")).toBe(true);
  });

  it("flags leading ../", () => {
    expect(looksTraversal("../a")).toBe(true);
  });

  it("flags bare ..", () => {
    expect(looksTraversal("..")).toBe(true);
  });

  it("flags trailing /..", () => {
    expect(looksTraversal("/a/..")).toBe(true);
  });

  it("normalises backslashes before checking", () => {
    expect(looksTraversal("a\\..\\b")).toBe(true);
  });

  it("returns false for normal paths", () => {
    expect(looksTraversal("/a/b/c.md")).toBe(false);
    expect(looksTraversal("foo")).toBe(false);
  });
});
