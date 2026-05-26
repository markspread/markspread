// ADR-0010 Migration feature flag.

import { afterEach, describe, expect, it } from "vitest";
import { isChatShellEnabled } from "./feature-flags";

const g = globalThis as unknown as {
  __MS_ENV?: Record<string, unknown> | undefined;
  process?: { env?: Record<string, unknown> | undefined } | undefined;
};

afterEach(() => {
  Reflect.deleteProperty(g, "__MS_ENV");
});

describe("isChatShellEnabled", () => {
  it("defaults to true when no flag is set", () => {
    Reflect.deleteProperty(g, "__MS_ENV");
    if (g.process?.env) Reflect.deleteProperty(g.process.env, "MS_SHELL_CHAT_ENABLED");
    expect(isChatShellEnabled({})).toBe(true);
  });

  it("returns false for explicit off values", () => {
    expect(isChatShellEnabled({ MS_SHELL_CHAT_ENABLED: "0" })).toBe(false);
    expect(isChatShellEnabled({ MS_SHELL_CHAT_ENABLED: "false" })).toBe(false);
    expect(isChatShellEnabled({ MS_SHELL_CHAT_ENABLED: "off" })).toBe(false);
    expect(isChatShellEnabled({ MS_SHELL_CHAT_ENABLED: "no" })).toBe(false);
  });

  it("returns true for any other truthy/unknown value", () => {
    expect(isChatShellEnabled({ MS_SHELL_CHAT_ENABLED: "1" })).toBe(true);
    expect(isChatShellEnabled({ MS_SHELL_CHAT_ENABLED: "true" })).toBe(true);
    expect(isChatShellEnabled({ MS_SHELL_CHAT_ENABLED: "yes" })).toBe(true);
  });

  it("reads from __MS_ENV when no envBag is supplied", () => {
    g.__MS_ENV = { MS_SHELL_CHAT_ENABLED: "false" };
    expect(isChatShellEnabled()).toBe(false);
    g.__MS_ENV = { MS_SHELL_CHAT_ENABLED: "true" };
    expect(isChatShellEnabled()).toBe(true);
  });

  it("falls back to process.env when __MS_ENV is absent", () => {
    Reflect.deleteProperty(g, "__MS_ENV");
    const env = g.process?.env;
    if (!env) {
      // node test runner — process.env always exists. Skip safely.
      expect(true).toBe(true);
      return;
    }
    const prev = env.MS_SHELL_CHAT_ENABLED;
    env.MS_SHELL_CHAT_ENABLED = "off";
    try {
      expect(isChatShellEnabled()).toBe(false);
    } finally {
      if (prev === undefined) Reflect.deleteProperty(env, "MS_SHELL_CHAT_ENABLED");
      else env.MS_SHELL_CHAT_ENABLED = prev;
    }
  });

  it("null/undefined raw values default to true", () => {
    expect(isChatShellEnabled({ MS_SHELL_CHAT_ENABLED: null })).toBe(true);
    expect(isChatShellEnabled({ MS_SHELL_CHAT_ENABLED: undefined })).toBe(true);
  });
});
