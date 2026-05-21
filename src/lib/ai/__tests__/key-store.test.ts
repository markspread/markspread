// S-AIK-005..017: AI key registry coverage.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { type AiKeyEntry, maskInFlight, useKeyStore } from "../key-store";

function entry(over: Partial<AiKeyEntry>): AiKeyEntry {
  return {
    alias: "default",
    provider: "anthropic",
    model: "claude-opus-4-7",
    baseUrl: null,
    maskedKey: "sk-…••••abc",
    createdAt: 1,
    ...over,
  };
}

beforeEach(() => {
  invokeMock.mockReset();
  useKeyStore.setState({ entries: [], defaultAlias: null });
});
afterEach(() => invokeMock.mockReset());

describe("maskInFlight", () => {
  it("returns empty for an empty key", () => {
    expect(maskInFlight("", 0, 0)).toBe("");
  });

  it("shows the last typed char within the reveal window", () => {
    expect(maskInFlight("abcd", 1000, 1300)).toBe("•••d");
  });

  it("fully masks once the reveal window has elapsed", () => {
    expect(maskInFlight("abcd", 1000, 2000)).toBe("••••");
  });
});

describe("useKeyStore.load", () => {
  it("populates entries and default from ai_key_list", async () => {
    invokeMock.mockResolvedValueOnce({
      entries: [entry({ alias: "a" })],
      defaultAlias: "a",
    });
    await useKeyStore.getState().load();
    expect(useKeyStore.getState().entries).toHaveLength(1);
    expect(useKeyStore.getState().defaultAlias).toBe("a");
  });
});

describe("useKeyStore.save", () => {
  it("inserts an entry and adopts it as default when none exists", async () => {
    const saved = entry({ alias: "first" });
    invokeMock.mockResolvedValueOnce(saved); // ai_key_save
    invokeMock.mockResolvedValueOnce(undefined); // ai_key_set_default
    await useKeyStore.getState().save({
      alias: "first",
      provider: "anthropic",
      model: "claude-opus-4-7",
      baseUrl: null,
      key: "sk-secret",
    });
    expect(useKeyStore.getState().entries).toHaveLength(1);
    expect(useKeyStore.getState().defaultAlias).toBe("first");
    expect(invokeMock).toHaveBeenCalledWith("ai_key_set_default", { alias: "first" });
  });

  it("keeps the existing default when adding a second key", async () => {
    useKeyStore.setState({ entries: [entry({ alias: "a" })], defaultAlias: "a" });
    invokeMock.mockResolvedValueOnce(entry({ alias: "b" }));
    await useKeyStore.getState().save({
      alias: "b",
      provider: "openai",
      model: "gpt-5",
      baseUrl: null,
      key: "sk-x",
    });
    expect(useKeyStore.getState().defaultAlias).toBe("a");
    expect(useKeyStore.getState().entries.map((e) => e.alias)).toEqual(["a", "b"]);
  });

  it("overwrites an entry with the same alias", async () => {
    useKeyStore.setState({ entries: [entry({ alias: "a", model: "old" })], defaultAlias: "a" });
    invokeMock.mockResolvedValueOnce(entry({ alias: "a", model: "new" }));
    invokeMock.mockResolvedValueOnce(undefined);
    await useKeyStore.getState().save({
      alias: "a",
      provider: "anthropic",
      model: "new",
      baseUrl: null,
      key: "sk-x",
    });
    expect(useKeyStore.getState().entries).toHaveLength(1);
    expect(useKeyStore.getState().entries[0]?.model).toBe("new");
  });
});

describe("useKeyStore.remove", () => {
  it("removes an entry and promotes the next as default", async () => {
    useKeyStore.setState({
      entries: [entry({ alias: "a" }), entry({ alias: "b" })],
      defaultAlias: "a",
    });
    invokeMock.mockResolvedValueOnce(undefined);
    await useKeyStore.getState().remove("a");
    expect(useKeyStore.getState().entries.map((e) => e.alias)).toEqual(["b"]);
    expect(useKeyStore.getState().defaultAlias).toBe("b");
  });

  it("preserves the default when removing a non-default entry", async () => {
    useKeyStore.setState({
      entries: [entry({ alias: "a" }), entry({ alias: "b" })],
      defaultAlias: "a",
    });
    invokeMock.mockResolvedValueOnce(undefined);
    await useKeyStore.getState().remove("b");
    expect(useKeyStore.getState().defaultAlias).toBe("a");
  });

  it("clears the default when the last entry is removed", async () => {
    useKeyStore.setState({ entries: [entry({ alias: "a" })], defaultAlias: "a" });
    invokeMock.mockResolvedValueOnce(undefined);
    await useKeyStore.getState().remove("a");
    expect(useKeyStore.getState().defaultAlias).toBeNull();
  });
});

describe("useKeyStore.setDefault", () => {
  it("switches the default alias", async () => {
    useKeyStore.setState({
      entries: [entry({ alias: "a" }), entry({ alias: "b" })],
      defaultAlias: "a",
    });
    invokeMock.mockResolvedValueOnce(undefined);
    await useKeyStore.getState().setDefault("b");
    expect(useKeyStore.getState().defaultAlias).toBe("b");
  });
});
