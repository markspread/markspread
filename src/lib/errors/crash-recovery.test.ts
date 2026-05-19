// Unit tests for crash recovery beacon helpers + breadcrumb ring.

import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import {
  BEACON_REFRESH_INTERVAL_MS,
  BREADCRUMB_RING_SIZE,
  type Breadcrumb,
  BreadcrumbRing,
  type SessionBeacon,
  breadcrumbs,
  clearBeacon,
  listRecoveryCandidates,
  readBeacon,
  writeBeacon,
} from "./crash-recovery";

const beacon: SessionBeacon = {
  id: "abc",
  buffers: [{ key: "untitled-1", dirty: true, sha256: "deadbeef", bytes: 12 }],
  ts: 1000,
};

beforeEach(() => {
  invokeMock.mockReset();
  breadcrumbs.clear();
});

describe("beacon IPC helpers", () => {
  it("exposes a sane refresh interval", () => {
    expect(BEACON_REFRESH_INTERVAL_MS).toBe(5_000);
  });

  it("writeBeacon invokes error_session_beacon_write with the beacon", async () => {
    invokeMock.mockResolvedValue(undefined);
    await writeBeacon(beacon);
    expect(invokeMock).toHaveBeenCalledWith("error_session_beacon_write", { beacon });
  });

  it("readBeacon returns the IPC payload", async () => {
    invokeMock.mockResolvedValue(beacon);
    expect(await readBeacon()).toEqual(beacon);
    expect(invokeMock).toHaveBeenCalledWith("error_session_beacon_read");
  });

  it("readBeacon passes through null", async () => {
    invokeMock.mockResolvedValue(null);
    expect(await readBeacon()).toBeNull();
  });

  it("clearBeacon invokes error_session_beacon_clear", async () => {
    invokeMock.mockResolvedValue(undefined);
    await clearBeacon();
    expect(invokeMock).toHaveBeenCalledWith("error_session_beacon_clear");
  });

  it("listRecoveryCandidates returns the IPC payload", async () => {
    const candidates = [{ key: "a", bytes: 1, diskBody: null, recoveredBody: "x" }];
    invokeMock.mockResolvedValue(candidates);
    expect(await listRecoveryCandidates()).toEqual(candidates);
    expect(invokeMock).toHaveBeenCalledWith("error_recovery_list");
  });
});

describe("BreadcrumbRing", () => {
  const crumb = (label: string): Breadcrumb => ({
    ts: 0,
    category: "command",
    label,
  });

  it("starts empty", () => {
    expect(new BreadcrumbRing().snapshot()).toEqual([]);
  });

  it("pushes and snapshots a copy", () => {
    const ring = new BreadcrumbRing();
    ring.push(crumb("one"));
    const snap = ring.snapshot();
    expect(snap).toHaveLength(1);
    snap.push(crumb("mutation"));
    expect(ring.snapshot()).toHaveLength(1);
  });

  it("evicts the oldest entry past the ring size", () => {
    const ring = new BreadcrumbRing();
    for (let i = 0; i < BREADCRUMB_RING_SIZE + 5; i++) {
      ring.push(crumb(`c${i}`));
    }
    const snap = ring.snapshot();
    expect(snap).toHaveLength(BREADCRUMB_RING_SIZE);
    expect(snap[0]?.label).toBe("c5");
  });

  it("clear empties the ring", () => {
    const ring = new BreadcrumbRing();
    ring.push(crumb("x"));
    ring.clear();
    expect(ring.snapshot()).toEqual([]);
  });

  it("exports a shared singleton ring", () => {
    breadcrumbs.push(crumb("shared"));
    expect(breadcrumbs.snapshot()).toHaveLength(1);
  });
});
