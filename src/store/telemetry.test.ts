// Coverage for the telemetry emit pipeline added by ADR-0010.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emitTelemetry, subscribeTelemetry, useTelemetry } from "./telemetry";

describe("telemetry emit pipeline", () => {
  beforeEach(() => {
    useTelemetry.setState({ consent: "unset", firstRunPromptShown: false });
  });
  afterEach(() => {
    useTelemetry.setState({ consent: "unset", firstRunPromptShown: false });
  });

  it("no-ops when consent is not enabled", () => {
    const fn = vi.fn();
    const off = subscribeTelemetry(fn);
    emitTelemetry({
      type: "shell.mounted",
      shell: "chat",
      workspaceId: "ws1",
      firstPaintMs: 5,
    });
    expect(fn).not.toHaveBeenCalled();
    off();
  });

  it("delivers events to every subscriber when consent is enabled", () => {
    useTelemetry.setState({ consent: "enabled" });
    const a = vi.fn();
    const b = vi.fn();
    const offA = subscribeTelemetry(a);
    const offB = subscribeTelemetry(b);
    emitTelemetry({
      type: "shell.switched",
      from: "chat",
      to: "editor",
      trigger: "toolbar",
    });
    expect(a).toHaveBeenCalledOnce();
    expect(b).toHaveBeenCalledOnce();
    offA();
    offB();
  });

  it("isolates subscriber errors so one failure does not break others", () => {
    useTelemetry.setState({ consent: "enabled" });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const good = vi.fn();
    const off1 = subscribeTelemetry(() => {
      throw new Error("boom");
    });
    const off2 = subscribeTelemetry(good);
    emitTelemetry({
      type: "chat.session_created",
      workspaceId: "ws1",
      messageCount: 0,
    });
    expect(warn).toHaveBeenCalled();
    expect(good).toHaveBeenCalledOnce();
    off1();
    off2();
    warn.mockRestore();
  });
});
