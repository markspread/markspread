import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const recordAudit = vi.fn((..._args: unknown[]) => Promise.resolve());
vi.mock("./audit-log", () => ({
  recordAudit: (...args: unknown[]) => recordAudit(...args),
}));

import { installWebviewPermissionGuard } from "./webview-permissions";

interface MutableNavigator {
  permissions:
    | {
        query: (desc: PermissionDescriptor) => Promise<PermissionStatus>;
      }
    | undefined;
  geolocation:
    | {
        getCurrentPosition: typeof navigator.geolocation.getCurrentPosition;
        watchPosition: typeof navigator.geolocation.watchPosition;
      }
    | undefined;
  mediaDevices:
    | {
        getUserMedia: typeof navigator.mediaDevices.getUserMedia;
        getDisplayMedia: typeof navigator.mediaDevices.getDisplayMedia | undefined;
      }
    | undefined;
}

const nav = navigator as unknown as MutableNavigator;
const originals: MutableNavigator = {
  permissions: undefined,
  geolocation: undefined,
  mediaDevices: undefined,
};

beforeEach(() => {
  originals.permissions = nav.permissions;
  originals.geolocation = nav.geolocation;
  originals.mediaDevices = nav.mediaDevices;
  recordAudit.mockClear();
});

afterEach(() => {
  if (originals.permissions) nav.permissions = originals.permissions;
  else nav.permissions = undefined;
  if (originals.geolocation) nav.geolocation = originals.geolocation;
  else nav.geolocation = undefined;
  if (originals.mediaDevices) nav.mediaDevices = originals.mediaDevices;
  else nav.mediaDevices = undefined;
});

describe("installWebviewPermissionGuard", () => {
  it("denies blocked permissions and records the audit entry", async () => {
    const upstream = vi.fn(() => Promise.resolve({ state: "granted" } as PermissionStatus));
    nav.permissions = { query: upstream } as MutableNavigator["permissions"];

    const restore = installWebviewPermissionGuard();
    const status = (await nav.permissions?.query({ name: "geolocation" })) as PermissionStatus;
    expect(status.state).toBe("denied");
    expect(upstream).not.toHaveBeenCalled();
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        pluginId: "host:webview",
        decision: "deny",
        apiKind: "permission:geolocation",
      }),
    );

    // The denied PermissionStatus stub exposes the standard EventTarget API
    // so callers that wire onchange listeners don't blow up.
    const denied = status as unknown as {
      addEventListener: (...args: unknown[]) => undefined;
      removeEventListener: (...args: unknown[]) => undefined;
      dispatchEvent: (...args: unknown[]) => boolean;
    };
    expect(denied.addEventListener("change", () => {})).toBeUndefined();
    expect(denied.removeEventListener("change", () => {})).toBeUndefined();
    expect(denied.dispatchEvent(new Event("change"))).toBe(true);

    restore();
  });

  it("passes through unknown permissions to the upstream query", async () => {
    const upstream = vi.fn(() => Promise.resolve({ state: "granted" } as PermissionStatus));
    nav.permissions = { query: upstream } as MutableNavigator["permissions"];

    const restore = installWebviewPermissionGuard();
    const result = (await nav.permissions?.query({
      name: "push" as PermissionName,
    })) as PermissionStatus;
    expect(result.state).toBe("granted");
    expect(upstream).toHaveBeenCalledTimes(1);
    expect(recordAudit).not.toHaveBeenCalled();

    upstream.mockClear();
    restore();
    // After restore the upstream is wired back in (as a bound function).
    await nav.permissions?.query({ name: "push" as PermissionName });
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it("short-circuits geolocation and rejects media capture", async () => {
    const watchPosition = vi.fn();
    const getUserMedia = vi.fn(() => Promise.resolve({} as MediaStream));
    const getDisplayMedia = vi.fn(() => Promise.resolve({} as MediaStream));
    nav.geolocation = {
      getCurrentPosition: vi.fn(),
      watchPosition,
    } as MutableNavigator["geolocation"];
    nav.mediaDevices = {
      getUserMedia,
      getDisplayMedia,
    } as MutableNavigator["mediaDevices"];

    installWebviewPermissionGuard();

    const fail = vi.fn();
    nav.geolocation?.getCurrentPosition(() => {}, fail);
    expect(fail).toHaveBeenCalledWith(expect.objectContaining({ code: 1 }));

    // The fail callback is optional — the no-callback path must not throw.
    expect(() => nav.geolocation?.getCurrentPosition(() => {})).not.toThrow();

    expect(nav.geolocation?.watchPosition({} as PositionCallback)).toBe(-1);

    await expect(nav.mediaDevices?.getUserMedia({})).rejects.toMatchObject({
      name: "NotAllowedError",
    });
    await expect(nav.mediaDevices?.getDisplayMedia?.({})).rejects.toMatchObject({
      name: "NotAllowedError",
    });
  });

  it("is a no-op when navigator.permissions is unavailable", () => {
    nav.permissions = undefined;
    nav.geolocation = undefined;
    nav.mediaDevices = undefined;
    const restore = installWebviewPermissionGuard();
    expect(typeof restore).toBe("function");
    expect(() => restore()).not.toThrow();
    expect(nav.permissions).toBeUndefined();
  });
});
