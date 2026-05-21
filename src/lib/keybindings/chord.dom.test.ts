// S-KB-009: chord engine coverage.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runCommand = vi.fn();
vi.mock("@/lib/commands/registry", () => ({
  runCommand: (...args: unknown[]) => runCommand(...args),
}));

const dispatch = vi.fn();
const bindingFromEvent = vi.fn();
const listActiveBindings = vi.fn();
const normaliseBinding = vi.fn((b: string) => b);

vi.mock(".", () => ({
  bindingFromEvent: (e: KeyboardEvent) => bindingFromEvent(e),
  listActiveBindings: () => listActiveBindings(),
  normaliseBinding: (b: string) => normaliseBinding(b),
}));

vi.mock("./dispatch", () => ({
  dispatch: (...args: unknown[]) => dispatch(...args),
}));

import { _resetChord, dispatchWithChord, onChordPrefix } from "./chord";

beforeEach(() => {
  runCommand.mockReset();
  dispatch.mockReset();
  bindingFromEvent.mockReset();
  listActiveBindings.mockReset();
  vi.useFakeTimers();
  _resetChord();
});

afterEach(() => {
  vi.useRealTimers();
});

function keyEvent(): KeyboardEvent {
  return new KeyboardEvent("keydown");
}

describe("onChordPrefix", () => {
  it("invokes the listener with the current prefix and on every update", () => {
    listActiveBindings.mockReturnValue([{ binding: "Mod+K Mod+W" }]);
    bindingFromEvent.mockReturnValue("Mod+K");
    const seen: (string | null)[] = [];
    const unsub = onChordPrefix((p) => seen.push(p));
    expect(seen).toEqual([null]);
    dispatchWithChord(keyEvent());
    expect(seen.at(-1)).toBe("Mod+K");
    unsub();
    // After unsubscribe further updates are not delivered.
    _resetChord();
    expect(seen.at(-1)).toBe("Mod+K");
  });
});

describe("dispatchWithChord", () => {
  it("returns immediately when the event has no step", () => {
    bindingFromEvent.mockReturnValue("");
    expect(dispatchWithChord(keyEvent())).toEqual({ commandId: null, consumed: false });
  });

  it("arms a chord prefix and consumes the event", () => {
    listActiveBindings.mockReturnValue([{ binding: "Mod+K Mod+W" }]);
    bindingFromEvent.mockReturnValue("Mod+K");
    expect(dispatchWithChord(keyEvent())).toEqual({ commandId: null, consumed: true });
  });

  it("clears the prefix after the 1500ms timeout", () => {
    listActiveBindings.mockReturnValue([{ binding: "Mod+K Mod+W" }]);
    bindingFromEvent.mockReturnValue("Mod+K");
    const seen: (string | null)[] = [];
    onChordPrefix((p) => seen.push(p));
    dispatchWithChord(keyEvent());
    expect(seen.at(-1)).toBe("Mod+K");
    vi.advanceTimersByTime(1500);
    expect(seen.at(-1)).toBeNull();
  });

  it("resolves a completed chord and runs the command", () => {
    listActiveBindings.mockReturnValue([{ binding: "Mod+K Mod+W" }]);
    bindingFromEvent.mockReturnValueOnce("Mod+K").mockReturnValueOnce("Mod+W");
    dispatchWithChord(keyEvent());
    dispatch.mockReturnValueOnce("cmd.close");
    const r = dispatchWithChord(keyEvent());
    expect(r).toEqual({ commandId: "cmd.close", consumed: true });
    expect(runCommand).toHaveBeenCalledWith("cmd.close");
  });

  it("silently aborts the chord when the follow-up key does not match", () => {
    listActiveBindings.mockReturnValue([{ binding: "Mod+K Mod+W" }]);
    bindingFromEvent.mockReturnValueOnce("Mod+K").mockReturnValueOnce("Mod+Q");
    dispatchWithChord(keyEvent());
    dispatch.mockReturnValueOnce(null);
    const r = dispatchWithChord(keyEvent());
    expect(r).toEqual({ commandId: null, consumed: true });
    expect(runCommand).not.toHaveBeenCalled();
  });

  it("dispatches a plain (non-chord) binding when no prefix matches", () => {
    listActiveBindings.mockReturnValue([{ binding: "Mod+S" }]);
    bindingFromEvent.mockReturnValue("Mod+S");
    dispatch.mockReturnValueOnce("cmd.save");
    const r = dispatchWithChord(keyEvent());
    expect(r).toEqual({ commandId: "cmd.save", consumed: true });
    expect(runCommand).toHaveBeenCalledWith("cmd.save");
  });

  it("returns no-op when the key is neither a prefix nor a plain match", () => {
    listActiveBindings.mockReturnValue([{ binding: "Mod+S" }]);
    bindingFromEvent.mockReturnValue("Mod+Z");
    dispatch.mockReturnValueOnce(null);
    expect(dispatchWithChord(keyEvent())).toEqual({ commandId: null, consumed: false });
  });
});
