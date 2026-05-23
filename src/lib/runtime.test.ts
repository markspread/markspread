// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { isTauriRuntime } from "./runtime";

afterEach(() => {
  // biome-ignore lint/performance/noDelete: test cleanup of injected global.
  delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
});

describe("isTauriRuntime", () => {
  it("returns false when __TAURI_INTERNALS__ is absent", () => {
    expect(isTauriRuntime()).toBe(false);
  });

  it("returns true when __TAURI_INTERNALS__ is set", () => {
    (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    expect(isTauriRuntime()).toBe(true);
  });
});
