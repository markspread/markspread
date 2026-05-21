// S-KB-010: global keydown listener coverage.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const dispatchWithChord = vi.fn();
vi.mock("./chord", () => ({
  dispatchWithChord: (e: KeyboardEvent) => dispatchWithChord(e),
}));

import { attachGlobalKeybindings } from "./global";

let detach: (() => void) | null = null;

beforeEach(() => {
  dispatchWithChord.mockReset();
  dispatchWithChord.mockReturnValue({ commandId: null, consumed: false });
  detach = attachGlobalKeybindings();
});

afterEach(() => {
  detach?.();
  detach = null;
  document.body.innerHTML = "";
});

function press(target?: Element): KeyboardEvent {
  const ev = new KeyboardEvent("keydown", { metaKey: true, cancelable: true, bubbles: true });
  if (target) {
    target.dispatchEvent(ev);
  } else {
    window.dispatchEvent(ev);
  }
  return ev;
}

describe("attachGlobalKeybindings", () => {
  it("dispatches a plain window keydown through the chord engine", () => {
    dispatchWithChord.mockReturnValueOnce({ commandId: "x", consumed: true });
    const ev = press();
    expect(dispatchWithChord).toHaveBeenCalled();
    expect(ev.defaultPrevented).toBe(true);
  });

  it("does not preventDefault when the event is not consumed", () => {
    dispatchWithChord.mockReturnValueOnce({ commandId: null, consumed: false });
    const ev = press();
    expect(ev.defaultPrevented).toBe(false);
  });

  it("preventsDefault when a chord is mid-flight even without a command", () => {
    dispatchWithChord.mockReturnValueOnce({ commandId: null, consumed: true });
    const ev = press();
    expect(ev.defaultPrevented).toBe(true);
  });

  it("ignores a plain (no modifier) keystroke inside an <input>", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    const ev = new KeyboardEvent("keydown", { key: "a", bubbles: true, cancelable: true });
    input.dispatchEvent(ev);
    expect(dispatchWithChord).not.toHaveBeenCalled();
  });

  it("forwards a modifier-bearing keystroke from inside an <input>", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    dispatchWithChord.mockReturnValueOnce({ commandId: "x", consumed: true });
    const ev = new KeyboardEvent("keydown", {
      key: "p",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(ev);
    expect(dispatchWithChord).toHaveBeenCalled();
  });

  it("treats <textarea> as a typing surface", () => {
    const ta = document.createElement("textarea");
    document.body.appendChild(ta);
    ta.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
    expect(dispatchWithChord).not.toHaveBeenCalled();
  });

  it("treats contenteditable hosts as typing surfaces", () => {
    const ce = document.createElement("div");
    Object.defineProperty(ce, "isContentEditable", { value: true });
    document.body.appendChild(ce);
    ce.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
    expect(dispatchWithChord).not.toHaveBeenCalled();
  });

  it("forwards keystrokes from a non-typing HTMLElement target", () => {
    const div = document.createElement("div");
    document.body.appendChild(div);
    div.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
    expect(dispatchWithChord).toHaveBeenCalled();
  });

  it("forwards keystrokes whose target is not an HTMLElement", () => {
    // Direct window dispatch with a non-element target hits the
    // `target instanceof HTMLElement` false branch.
    window.dispatchEvent(new KeyboardEvent("keydown", { metaKey: true, cancelable: true }));
    expect(dispatchWithChord).toHaveBeenCalled();
  });

  it("returns a detacher that removes the window listener", () => {
    detach?.();
    detach = null;
    press();
    expect(dispatchWithChord).not.toHaveBeenCalled();
  });
});
