// S-TST: plugin sandbox — CSP string, srcdoc generation, hardening
// bundles, and the bootstrap composition.

import { describe, expect, it } from "vitest";
import type { PluginManifest } from "./manifest";
import {
  FETCH_PROXY_SOURCE,
  IFRAME_CSP,
  PLUGIN_CPU_BUDGET_MS_PER_MIN,
  PLUGIN_MEMORY_BUDGET_MB,
  STORAGE_PROXY_SOURCE,
  WATCHDOG_PING_INTERVAL_MS,
  WATCHDOG_TIMEOUT_MS,
  WORKER_HARDENING_SOURCE,
  buildIframeSrcdoc,
  buildSandboxBootstrap,
} from "./sandbox";

const manifest: PluginManifest = {
  id: "demo",
  name: "Demo",
  version: "1.0.0",
  kind: "view",
  engines: { markspread: "^1.0.0" },
  activationEvents: ["onStartup"],
  permissions: [],
};

describe("IFRAME_CSP", () => {
  it("locks default-src to none and scripts to self", () => {
    expect(IFRAME_CSP).toContain("default-src 'none'");
    expect(IFRAME_CSP).toContain("script-src 'self'");
    expect(IFRAME_CSP).toContain("connect-src 'none'");
    expect(IFRAME_CSP).toContain("frame-ancestors 'none'");
  });
});

describe("buildIframeSrcdoc", () => {
  it("embeds the CSP and the plugin URL", () => {
    const doc = buildIframeSrcdoc("https://host/plugin.js");
    expect(doc).toContain("<!doctype html>");
    expect(doc).toContain(IFRAME_CSP);
    expect(doc).toContain('src="https://host/plugin.js"');
  });
});

describe("hardening sources", () => {
  it("WORKER_HARDENING_SOURCE blocks eval and Function", () => {
    expect(WORKER_HARDENING_SOURCE).toContain("globalThis.eval");
    expect(WORKER_HARDENING_SOURCE).toContain("globalThis.Function");
    expect(WORKER_HARDENING_SOURCE).toContain("__msImport");
  });

  it("STORAGE_PROXY_SOURCE blocks direct storage globals", () => {
    expect(STORAGE_PROXY_SOURCE).toContain("localStorage");
    expect(STORAGE_PROXY_SOURCE).toContain("sessionStorage");
    expect(STORAGE_PROXY_SOURCE).toContain("indexedDB");
  });

  it("FETCH_PROXY_SOURCE blocks fetch, XHR and WebSocket", () => {
    expect(FETCH_PROXY_SOURCE).toContain("globalThis.fetch");
    expect(FETCH_PROXY_SOURCE).toContain("XMLHttpRequest");
    expect(FETCH_PROXY_SOURCE).toContain("WebSocket");
  });
});

describe("buildSandboxBootstrap", () => {
  it("concatenates all three hardening bundles in order", () => {
    const bootstrap = buildSandboxBootstrap(manifest);
    expect(bootstrap).toBe(
      [WORKER_HARDENING_SOURCE, STORAGE_PROXY_SOURCE, FETCH_PROXY_SOURCE].join("\n"),
    );
    expect(bootstrap.indexOf(WORKER_HARDENING_SOURCE)).toBeLessThan(
      bootstrap.indexOf(STORAGE_PROXY_SOURCE),
    );
    expect(bootstrap.indexOf(STORAGE_PROXY_SOURCE)).toBeLessThan(
      bootstrap.indexOf(FETCH_PROXY_SOURCE),
    );
  });
});

describe("watchdog constants", () => {
  it("exposes documented budgets", () => {
    expect(WATCHDOG_PING_INTERVAL_MS).toBe(5_000);
    expect(WATCHDOG_TIMEOUT_MS).toBe(30_000);
    expect(PLUGIN_CPU_BUDGET_MS_PER_MIN).toBe(2_000);
    expect(PLUGIN_MEMORY_BUDGET_MB).toBe(256);
  });
});
