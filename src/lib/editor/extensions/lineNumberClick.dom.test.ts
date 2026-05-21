import "./jsdomLayoutShim";
// S-ED-056: line-number gutter click selects whole line.

import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  handleGutterMousedown,
  lineNumberClickExtension,
  selectLineRange,
} from "./lineNumberClick";

function mount(doc: string, withExt = false): EditorView {
  const view = new EditorView({
    state: EditorState.create({
      doc,
      extensions: withExt ? [lineNumberClickExtension()] : [],
    }),
  });
  document.body.appendChild(view.dom);
  return view;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("selectLineRange", () => {
  it("selects a single line, anchor at start, head at next line start", () => {
    const view = mount("alpha\nbeta\ngamma\n");
    selectLineRange(view, 2, 2);
    const sel = view.state.selection.main;
    expect(sel.from).toBe(6);
    expect(sel.to).toBe(11);
    expect(sel.anchor).toBe(6);
    expect(sel.head).toBe(11);
    view.destroy();
  });

  it("handles the last line which has no trailing newline by using doc.length", () => {
    const view = mount("alpha\nbeta\ngamma");
    selectLineRange(view, 3, 3);
    const sel = view.state.selection.main;
    const line = view.state.doc.line(3);
    expect(sel.from).toBe(line.from);
    expect(sel.to).toBe(view.state.doc.length);
    view.destroy();
  });

  it("forward range: anchor at start, head at end", () => {
    const view = mount("alpha\nbeta\ngamma\ndelta\n");
    selectLineRange(view, 1, 3);
    const sel = view.state.selection.main;
    expect(sel.anchor).toBe(0);
    expect(sel.head).toBe(view.state.doc.line(4).from);
    view.destroy();
  });

  it("backward range: anchor at end, head at start", () => {
    const view = mount("alpha\nbeta\ngamma\ndelta\n");
    selectLineRange(view, 3, 1);
    const sel = view.state.selection.main;
    expect(sel.anchor).toBe(view.state.doc.line(4).from);
    expect(sel.head).toBe(0);
    view.destroy();
  });
});

describe("handleGutterMousedown", () => {
  it("plain click selects only that line", () => {
    const view = mount("alpha\nbeta\ngamma\n");
    const line2 = view.state.doc.line(2);
    handleGutterMousedown(view, line2.from, false);
    const sel = view.state.selection.main;
    expect(sel.from).toBe(line2.from);
    expect(sel.to).toBe(view.state.doc.line(3).from);
    view.destroy();
  });

  it("shift-click extends from the existing anchor to the clicked line", () => {
    const view = mount("alpha\nbeta\ngamma\ndelta\n");
    view.dispatch({ selection: { anchor: 0 } });
    const line3 = view.state.doc.line(3);
    handleGutterMousedown(view, line3.from, true);
    const sel = view.state.selection.main;
    expect(sel.from).toBe(0);
    expect(sel.to).toBe(view.state.doc.line(4).from);
    view.destroy();
  });

  it("installs mousemove/mouseup listeners that extend the selection during drag", () => {
    const view = mount("alpha\nbeta\ngamma\ndelta\n");
    const addSpy = vi.spyOn(window, "addEventListener");
    handleGutterMousedown(view, view.state.doc.line(1).from, false);

    const moveCall = addSpy.mock.calls.find((c) => c[0] === "mousemove");
    const upCall = addSpy.mock.calls.find((c) => c[0] === "mouseup");
    expect(moveCall).toBeDefined();
    expect(upCall).toBeDefined();
    const onMove = moveCall?.[1] as (ev: MouseEvent) => void;
    const onUp = upCall?.[1] as () => void;

    // posAtCoords returns the position of line 3 — drag should extend to line 3.
    const line3 = view.state.doc.line(3);
    const posSpy = vi.spyOn(view, "posAtCoords").mockReturnValue(line3.from);
    onMove(new MouseEvent("mousemove", { clientX: 0, clientY: 50 }));
    const after = view.state.selection.main;
    expect(after.from).toBe(0);
    expect(after.to).toBe(view.state.doc.line(4).from);

    // posAtCoords returning null is a no-op.
    posSpy.mockReturnValue(null);
    onMove(new MouseEvent("mousemove", { clientX: 0, clientY: 999 }));
    expect(view.state.selection.main.from).toBe(after.from);
    expect(view.state.selection.main.to).toBe(after.to);

    const removeSpy = vi.spyOn(window, "removeEventListener");
    onUp();
    expect(removeSpy).toHaveBeenCalledWith("mousemove", onMove);
    expect(removeSpy).toHaveBeenCalledWith("mouseup", onUp);

    view.destroy();
  });

  it("returns true to mark the event handled", () => {
    const view = mount("alpha\n");
    expect(handleGutterMousedown(view, 0, false)).toBe(true);
    view.destroy();
  });
});

describe("lineNumberClickExtension", () => {
  it("installs without throwing and dispatches via the gutter mousedown handler", () => {
    const view = mount("alpha\nbeta\n", true);
    // Smoke-test: dispatch a mousedown on any gutter row. We don't assert
    // line-specific behaviour because jsdom returns zero-rects so CM6's
    // coordinate-to-line resolution is unreliable here — but exercising the
    // handler wires through `handleGutterMousedown` and updates selection.
    const row = view.dom.querySelector(".cm-gutterElement") as HTMLElement | null;
    if (row) {
      row.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    }
    // Tear down the listeners installed by any handler that fired.
    window.dispatchEvent(new MouseEvent("mouseup"));
    view.destroy();
  });
});
