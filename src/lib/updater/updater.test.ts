// S-UP-001..019: updater orchestration coverage.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UpdateManifest } from "../security/update-verify";

const invokeMock = vi.fn();
const listenMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => listenMock(...args),
}));

import {
  DEFAULT_UPDATER_SETTINGS,
  cancelDownload,
  checkForUpdate,
  installAndRestart,
  manifestSecurityFlag,
  selectDelta,
  shouldOfferUpdate,
  startDownload,
  subscribeToProgress,
} from "./updater";

function manifest(overrides: Partial<UpdateManifest> = {}): UpdateManifest {
  return {
    version: "1.2.3",
    notesMarkdown: "release notes",
    pubDate: "2026-01-01T00:00:00Z",
    platforms: {},
    signature: "sig",
    ...overrides,
  };
}

beforeEach(() => {
  invokeMock.mockReset();
  listenMock.mockReset();
});

describe("DEFAULT_UPDATER_SETTINGS", () => {
  it("defaults to the enabled stable channel", () => {
    expect(DEFAULT_UPDATER_SETTINGS).toEqual({
      enabled: true,
      channel: "stable",
      policy: "auto-download-manual-install",
      lastCheckedAt: 0,
    });
  });
});

describe("IPC wrappers", () => {
  it("checkForUpdate forwards the channel and returns the manifest", async () => {
    invokeMock.mockResolvedValue(manifest());
    const result = await checkForUpdate("beta");
    expect(invokeMock).toHaveBeenCalledWith("updater_check", { channel: "beta" });
    expect(result?.version).toBe("1.2.3");
  });

  it("checkForUpdate can return null", async () => {
    invokeMock.mockResolvedValue(null);
    expect(await checkForUpdate("stable")).toBeNull();
  });

  it("startDownload forwards the manifest", async () => {
    invokeMock.mockResolvedValue(undefined);
    const m = manifest();
    await startDownload(m);
    expect(invokeMock).toHaveBeenCalledWith("updater_download", { manifest: m });
  });

  it("cancelDownload invokes the cancel command", async () => {
    invokeMock.mockResolvedValue(undefined);
    await cancelDownload();
    expect(invokeMock).toHaveBeenCalledWith("updater_cancel");
  });

  it("installAndRestart invokes the install command", async () => {
    invokeMock.mockResolvedValue(undefined);
    await installAndRestart();
    expect(invokeMock).toHaveBeenCalledWith("updater_install_and_restart");
  });
});

describe("subscribeToProgress", () => {
  it("listens to the progress channel and unwraps the payload", async () => {
    const unlisten = vi.fn();
    listenMock.mockImplementation((_evt: string, cb: (e: { payload: unknown }) => void) => {
      cb({ payload: { bytesPulled: 1, totalBytes: 2, paused: false, resumable: true } });
      return Promise.resolve(unlisten);
    });
    const handler = vi.fn();
    const result = await subscribeToProgress(handler);
    expect(listenMock).toHaveBeenCalledWith("updater://progress", expect.any(Function));
    expect(handler).toHaveBeenCalledWith({
      bytesPulled: 1,
      totalBytes: 2,
      paused: false,
      resumable: true,
    });
    expect(result).toBe(unlisten);
  });
});

describe("manifestSecurityFlag", () => {
  it("returns null when there is no security tag", () => {
    expect(manifestSecurityFlag(manifest({ notesMarkdown: "## Features\nstuff" }))).toBeNull();
  });

  it("flags critical with CVE ids when a security section exists", () => {
    const flag = manifestSecurityFlag(
      manifest({ notesMarkdown: "## Security\nFixes CVE-2026-1234 and CVE-2026-9999." }),
    );
    expect(flag).toEqual({ critical: true, cveIds: ["CVE-2026-1234", "CVE-2026-9999"] });
  });

  it("flags critical with an empty CVE list when none are listed", () => {
    const flag = manifestSecurityFlag(manifest({ notesMarkdown: "## Security\nhardening" }));
    expect(flag).toEqual({ critical: true, cveIds: [] });
  });
});

describe("shouldOfferUpdate", () => {
  it("offers a newer version", () => {
    expect(shouldOfferUpdate("1.0.0", manifest({ version: "1.1.0" }))).toBe(true);
  });

  it("declines an older version (downgrade)", () => {
    expect(shouldOfferUpdate("2.0.0", manifest({ version: "1.0.0" }))).toBe(false);
  });
});

describe("selectDelta", () => {
  it("returns null — delta updates are a v2 stub", () => {
    expect(selectDelta(manifest(), "1.0.0")).toBeNull();
  });
});
