// S-ST-010 / S-ST-013 / S-ST-014 / S-ST-015: settings store coverage.

import { beforeEach, describe, expect, it, vi } from "vitest";

type StoreModule = typeof import("./store");

async function freshStore(): Promise<StoreModule> {
  vi.resetModules();
  return import("./store");
}

function memoryAdapter(
  seed: { global?: Record<string, unknown>; workspace?: Record<string, unknown> } = {},
) {
  const data: Record<"global" | "workspace", Record<string, unknown>> = {
    global: { ...(seed.global ?? {}) },
    workspace: { ...(seed.workspace ?? {}) },
  };
  return {
    data,
    read: vi.fn(async (scope: "global" | "workspace") => ({ ...data[scope] })),
    write: vi.fn(async (scope: "global" | "workspace", values: Record<string, unknown>) => {
      data[scope] = { ...values };
    }),
  };
}

let store: StoreModule;

beforeEach(async () => {
  store = await freshStore();
});

describe("getSetting", () => {
  it("returns the schema default when no override exists", () => {
    expect(store.getSetting("editor.fontSize")).toBe(14);
  });

  it("returns undefined for an unknown key", () => {
    expect(store.getSetting("nope.key")).toBeUndefined();
  });

  it("prefers workspace, then global, then default", async () => {
    const adapter = memoryAdapter({
      global: { "editor.fontSize": 16 },
      workspace: { "editor.fontSize": 20 },
    });
    store.setSettingsAdapter(adapter);
    await store.loadSettings();
    expect(store.getSetting("editor.fontSize")).toBe(20);
  });

  it("falls back to global when only global is set", async () => {
    const adapter = memoryAdapter({ global: { "editor.fontSize": 16 } });
    store.setSettingsAdapter(adapter);
    await store.loadSettings();
    expect(store.getSetting("editor.fontSize")).toBe(16);
  });
});

describe("getSettingScope", () => {
  it("reports workspace, global and default", async () => {
    const adapter = memoryAdapter({
      global: { "editor.fontSize": 16 },
      workspace: { "editor.lineWrapping": false },
    });
    store.setSettingsAdapter(adapter);
    await store.loadSettings();
    expect(store.getSettingScope("editor.lineWrapping")).toBe("workspace");
    expect(store.getSettingScope("editor.fontSize")).toBe("global");
    expect(store.getSettingScope("editor.encoding")).toBe("default");
  });
});

describe("loadSettings", () => {
  it("does nothing without an adapter", async () => {
    await expect(store.loadSettings()).resolves.toBeUndefined();
  });

  it("recovers from a failing read by treating the scope as empty", async () => {
    const adapter = memoryAdapter();
    adapter.read.mockRejectedValue(new Error("disk error"));
    store.setSettingsAdapter(adapter);
    await store.loadSettings();
    expect(store.getSetting("editor.fontSize")).toBe(14);
  });
});

describe("setSetting", () => {
  it("writes a global value through the adapter", async () => {
    const adapter = memoryAdapter();
    store.setSettingsAdapter(adapter);
    await store.setSetting("editor.fontSize", 18, "global");
    expect(store.getSetting("editor.fontSize")).toBe(18);
    expect(adapter.write).toHaveBeenCalledWith("global", { "editor.fontSize": 18 });
  });

  it("writes a workspace value for a scope:both setting", async () => {
    const adapter = memoryAdapter();
    store.setSettingsAdapter(adapter);
    await store.setSetting("editor.fontSize", 22, "workspace");
    expect(store.getSettingScope("editor.fontSize")).toBe("workspace");
    expect(adapter.write).toHaveBeenCalledWith("workspace", { "editor.fontSize": 22 });
  });

  it("downgrades workspace scope to global for a global-only setting", async () => {
    const adapter = memoryAdapter();
    store.setSettingsAdapter(adapter);
    await store.setSetting("privacy.telemetry", true, "workspace");
    expect(store.getSettingScope("privacy.telemetry")).toBe("global");
  });

  it("throws on an unknown setting key", async () => {
    await expect(store.setSetting("bogus.key", 1)).rejects.toThrow("Unknown setting: bogus.key");
  });

  it("works without an adapter", async () => {
    await store.setSetting("editor.fontSize", 30);
    expect(store.getSetting("editor.fontSize")).toBe(30);
  });
});

describe("resetSetting", () => {
  it("removes a workspace override and writes back", async () => {
    const adapter = memoryAdapter();
    store.setSettingsAdapter(adapter);
    await store.setSetting("editor.fontSize", 25, "workspace");
    adapter.write.mockClear();
    await store.resetSetting("editor.fontSize", "workspace");
    expect(store.getSettingScope("editor.fontSize")).toBe("default");
    expect(adapter.write).toHaveBeenCalled();
  });

  it("removes a global override", async () => {
    const adapter = memoryAdapter();
    store.setSettingsAdapter(adapter);
    await store.setSetting("editor.fontSize", 25, "global");
    await store.resetSetting("editor.fontSize", "global");
    expect(store.getSettingScope("editor.fontSize")).toBe("default");
  });

  it("is a no-op when the key is not overridden", async () => {
    const adapter = memoryAdapter();
    store.setSettingsAdapter(adapter);
    await store.resetSetting("editor.fontSize", "workspace");
    expect(adapter.write).not.toHaveBeenCalled();
  });

  it("works without an adapter", async () => {
    await store.setSetting("editor.fontSize", 25, "workspace");
    await store.resetSetting("editor.fontSize", "workspace");
    expect(store.getSettingScope("editor.fontSize")).toBe("default");
  });
});

describe("subscribeSetting", () => {
  it("notifies the key listener on change and stops after unsubscribe", async () => {
    const fn = vi.fn();
    const off = store.subscribeSetting("editor.fontSize", fn);
    await store.setSetting("editor.fontSize", 19);
    expect(fn).toHaveBeenCalledTimes(1);
    off();
    await store.setSetting("editor.fontSize", 21);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("supports multiple subscribers on the same key", async () => {
    const a = vi.fn();
    const b = vi.fn();
    store.subscribeSetting("editor.fontSize", a);
    store.subscribeSetting("editor.fontSize", b);
    await store.setSetting("editor.fontSize", 19);
    expect(a).toHaveBeenCalled();
    expect(b).toHaveBeenCalled();
  });

  it("notifies all listeners on loadSettings", async () => {
    const fn = vi.fn();
    store.subscribeSetting("editor.fontSize", fn);
    const adapter = memoryAdapter();
    store.setSettingsAdapter(adapter);
    await store.loadSettings();
    expect(fn).toHaveBeenCalled();
  });
});

describe("exportSettings / importSettings", () => {
  it("exports a copy of both scopes", async () => {
    await store.setSetting("editor.fontSize", 17, "global");
    await store.setSetting("editor.lineWrapping", false, "workspace");
    const exported = store.exportSettings();
    expect(exported.global).toEqual({ "editor.fontSize": 17 });
    expect(exported.workspace).toEqual({ "editor.lineWrapping": false });
  });

  it("imports both scopes, dropping unknown keys", async () => {
    const adapter = memoryAdapter();
    store.setSettingsAdapter(adapter);
    await store.importSettings({
      global: { "editor.fontSize": 28, "junk.key": 1 },
      workspace: { "editor.lineWrapping": false },
    });
    expect(store.getSetting("editor.fontSize")).toBe(28);
    expect(store.getSetting("editor.lineWrapping")).toBe(false);
    expect(store.exportSettings().global).toEqual({ "editor.fontSize": 28 });
  });

  it("imports only the scopes present in the payload", async () => {
    await store.importSettings({ global: { "editor.fontSize": 9 } });
    expect(store.getSetting("editor.fontSize")).toBe(9);
  });

  it("works without an adapter", async () => {
    await store.importSettings({ workspace: { "editor.fontSize": 11 } });
    expect(store.getSetting("editor.fontSize")).toBe(11);
  });
});

describe("snapshot", () => {
  it("returns defs, values and scopes for every setting", async () => {
    const adapter = memoryAdapter({ global: { "editor.fontSize": 24 } });
    store.setSettingsAdapter(adapter);
    await store.loadSettings();
    const snap = store.snapshot();
    expect(snap.defs.length).toBeGreaterThan(0);
    expect(snap.values["editor.fontSize"]).toBe(24);
    expect(snap.scopes["editor.fontSize"]).toBe("global");
    expect(snap.scopes["editor.encoding"]).toBe("default");
  });
});
