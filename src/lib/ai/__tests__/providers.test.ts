// S-AIK: provider catalog + alias/key helpers coverage.

import { describe, expect, it } from "vitest";
import {
  PROVIDERS,
  defaultModel,
  getProvider,
  maskKeyForDisplay,
  validateAlias,
} from "../providers";

describe("getProvider", () => {
  it("finds a known provider", () => {
    expect(getProvider("anthropic")?.label).toBe("Anthropic");
  });

  it("returns undefined for an unknown provider", () => {
    expect(getProvider("nope" as never)).toBeUndefined();
  });

  it("exposes 8 first-class providers", () => {
    expect(PROVIDERS).toHaveLength(8);
  });
});

describe("defaultModel", () => {
  it("returns the recommended model when present", () => {
    const anthropic = getProvider("anthropic");
    if (!anthropic) throw new Error("setup");
    expect(defaultModel(anthropic)?.id).toBe("claude-opus-4-7");
  });

  it("falls back to the first model when none is recommended", () => {
    const ollama = getProvider("ollama");
    if (!ollama) throw new Error("setup");
    expect(defaultModel(ollama)?.id).toBe("llama3.3");
  });

  it("returns undefined when the provider has no models", () => {
    const compat = getProvider("openai-compatible");
    if (!compat) throw new Error("setup");
    expect(defaultModel(compat)).toBeUndefined();
  });
});

describe("validateAlias", () => {
  it("accepts a valid lowercase alias", () => {
    expect(validateAlias("my-key")).toEqual({ ok: true });
  });

  it("rejects an alias shorter than 2 chars", () => {
    const r = validateAlias("a");
    expect(r.ok).toBe(false);
  });

  it("rejects an alias longer than 40 chars", () => {
    const r = validateAlias("a".repeat(41));
    expect(r.ok).toBe(false);
  });

  it("rejects uppercase or special characters", () => {
    expect(validateAlias("MyKey").ok).toBe(false);
    expect(validateAlias("my_key").ok).toBe(false);
  });

  it("rejects leading and trailing hyphens", () => {
    expect(validateAlias("-key").ok).toBe(false);
    expect(validateAlias("key-").ok).toBe(false);
  });
});

describe("maskKeyForDisplay", () => {
  it("fully masks short keys", () => {
    expect(maskKeyForDisplay("abc")).toBe("••••••");
    expect(maskKeyForDisplay("abcdef")).toBe("••••••");
  });

  it("shows a prefix and the last three characters of a long key", () => {
    const masked = maskKeyForDisplay("sk-1234567890XYZ");
    expect(masked.endsWith("XYZ")).toBe(true);
    expect(masked).toContain("…");
    expect(masked).not.toContain("4567890");
  });
});
