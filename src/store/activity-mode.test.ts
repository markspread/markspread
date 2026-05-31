import { beforeEach, describe, expect, it } from "vitest";
import { useActivityMode } from "./activity-mode";

describe("useActivityMode", () => {
  beforeEach(() => {
    useActivityMode.setState({ mode: "workspace" });
  });

  it("defaults to workspace mode", () => {
    expect(useActivityMode.getState().mode).toBe("workspace");
  });

  it("switches to parser mode and back", () => {
    useActivityMode.getState().setMode("parser");
    expect(useActivityMode.getState().mode).toBe("parser");
    useActivityMode.getState().setMode("workspace");
    expect(useActivityMode.getState().mode).toBe("workspace");
  });
});
