// @vitest-environment node
import { describe, expect, it } from "vitest";
import { isTauriRuntime } from "./runtime";

describe("isTauriRuntime (node env)", () => {
  it("returns false when window is undefined", () => {
    expect(typeof window).toBe("undefined");
    expect(isTauriRuntime()).toBe(false);
  });
});
