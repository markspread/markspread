// S-PSDK-003: sandbox CSP 정책 회귀 — 외부 네트워크가 절대 열리지 않는다.

import { describe, expect, it } from "vitest";
import {
  IFRAME_CSP_META,
  IFRAME_SANDBOX,
  WORKER_CSP,
  cspAllowsExternalConnections,
  cspAllowsScriptHosts,
} from "../sandbox-csp";

describe("worker CSP", () => {
  it("forbids external connect-src", () => {
    expect(cspAllowsExternalConnections(WORKER_CSP)).toBe(false);
  });

  it("forbids external script hosts", () => {
    expect(cspAllowsScriptHosts(WORKER_CSP)).toBe(false);
  });

  it("declares default-src 'none'", () => {
    expect(WORKER_CSP).toMatch(/default-src 'none'/);
  });

  it("allows self + blob: for worker-src", () => {
    expect(WORKER_CSP).toMatch(/worker-src 'self' blob:/);
  });
});

describe("iframe sandbox", () => {
  it("excludes allow-same-origin so the iframe is a unique origin", () => {
    expect(IFRAME_SANDBOX).not.toMatch(/allow-same-origin/);
  });

  it("includes allow-scripts so the parser can run", () => {
    expect(IFRAME_SANDBOX).toMatch(/allow-scripts/);
  });

  it("excludes navigation, popups, and forms", () => {
    expect(IFRAME_SANDBOX).not.toMatch(/allow-top-navigation/);
    expect(IFRAME_SANDBOX).not.toMatch(/allow-popups/);
    expect(IFRAME_SANDBOX).not.toMatch(/allow-forms/);
  });

  it("iframe CSP meta forbids fetch", () => {
    expect(cspAllowsExternalConnections(IFRAME_CSP_META)).toBe(false);
  });
});

describe("CSP regression helpers", () => {
  it("flags an obviously bad CSP that re-enables HTTPS hosts", () => {
    const bad = "default-src 'none'; connect-src https://evil.example";
    expect(cspAllowsExternalConnections(bad)).toBe(true);
  });

  it("flags wildcard script hosts", () => {
    const bad = "default-src 'self'; script-src *";
    expect(cspAllowsScriptHosts(bad)).toBe(true);
  });
});
