// S-AI-AUTH-002: provider supportedAuthModes 회귀.

import { describe, expect, it } from "vitest";
import { PROVIDERS, getProvider } from "../providers";

describe("ProviderDefinition.supportedAuthModes", () => {
  it("every provider declares at least one auth mode", () => {
    for (const p of PROVIDERS) {
      expect(p.supportedAuthModes.length).toBeGreaterThan(0);
    }
  });

  it("anthropic supports both api-key and subscription", () => {
    const p = getProvider("anthropic")!;
    expect(p.supportedAuthModes).toContain("api-key");
    expect(p.supportedAuthModes).toContain("subscription");
  });

  it("only anthropic supports subscription in v1.2 scope", () => {
    for (const p of PROVIDERS) {
      if (p.id === "anthropic") continue;
      expect(p.supportedAuthModes).not.toContain("subscription");
    }
  });

  it("every non-anthropic provider supports api-key", () => {
    for (const p of PROVIDERS) {
      expect(p.supportedAuthModes).toContain("api-key");
    }
  });
});
