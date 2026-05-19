import "./extensions/jsdomLayoutShim";
// S-ED-060: tests for the external-change reconciler.

import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { reconcileExternalChange } from "./reconcile";

function mount(doc: string, head = 0, onTr?: (ev: string) => void): EditorView {
  return new EditorView({
    state: EditorState.create({
      doc,
      selection: { anchor: head },
      extensions: onTr
        ? [
            EditorView.updateListener.of((u) => {
              for (const tr of u.transactions) {
                if (tr.isUserEvent("external.replace.dirty")) onTr("dirty");
                else if (tr.isUserEvent("external.replace")) onTr("clean");
              }
            }),
          ]
        : [],
    }),
  });
}

describe("reconcileExternalChange", () => {
  it("no-ops when the doc on disk is identical", () => {
    const view = mount("same", 2);
    const r = reconcileExternalChange(view, "same", false);
    expect(r).toEqual({ applied: false, hadLocalChanges: false });
    expect(view.state.doc.toString()).toBe("same");
    view.destroy();
  });

  it("replaces the doc and preserves the clamped selection (clean)", () => {
    const view = mount("hello world", 5);
    const r = reconcileExternalChange(view, "hello there", false);
    expect(r).toEqual({ applied: true, hadLocalChanges: false });
    expect(view.state.doc.toString()).toBe("hello there");
    expect(view.state.selection.main.head).toBe(5);
    view.destroy();
  });

  it("clamps the head when the new doc is shorter", () => {
    const view = mount("a long document", 15);
    reconcileExternalChange(view, "short", false);
    expect(view.state.selection.main.head).toBe(5);
    view.destroy();
  });

  it("tags a clean reconcile with userEvent external.replace", () => {
    const events: string[] = [];
    const view = mount("orig", 0, (ev) => events.push(ev));
    const r = reconcileExternalChange(view, "changed", false);
    expect(r).toEqual({ applied: true, hadLocalChanges: false });
    expect(events).toEqual(["clean"]);
    view.destroy();
  });

  it("tags a dirty reconcile with userEvent external.replace.dirty", () => {
    const events: string[] = [];
    const view = mount("orig", 0, (ev) => events.push(ev));
    const r = reconcileExternalChange(view, "next", true);
    expect(r).toEqual({ applied: true, hadLocalChanges: true });
    expect(events).toContain("dirty");
    view.destroy();
  });
});
