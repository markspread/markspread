import "./jsdomLayoutShim";
// S-MD-047/048: frontmatter fold extension.

import { foldEffect, foldService } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import { frontmatterFoldExtension } from "./frontmatterFold";

function mount(doc: string): EditorView {
  const view = new EditorView({
    state: EditorState.create({
      doc,
      extensions: [frontmatterFoldExtension()],
    }),
  });
  document.body.appendChild(view.dom);
  return view;
}

function runFoldService(view: EditorView, lineStart: number): { from: number; to: number } | null {
  const handlers = view.state.facet(foldService);
  for (const h of handlers) {
    const r = h(view.state, lineStart, lineStart);
    if (r) return r;
  }
  return null;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("frontmatterFold service", () => {
  it("returns a fold range covering the YAML frontmatter on line 1", () => {
    const doc = "---\ntitle: Demo\nauthor: Me\n---\nbody text\n";
    const view = mount(doc);
    const r = runFoldService(view, 0);
    expect(r).not.toBeNull();
    expect(r?.from).toBe(doc.indexOf("\n"));
    // `to` is one before the end-of-fence newline.
    expect(r?.to).toBeGreaterThan(r?.from ?? 0);
    expect(r?.to).toBeLessThan(doc.length);
    view.destroy();
  });

  it("returns null when not asked about the document start", () => {
    const view = mount("---\ntitle: Demo\n---\nbody\n");
    const r = runFoldService(view, 4); // line 2
    expect(r).toBeNull();
    view.destroy();
  });

  it("returns null when the document has no frontmatter", () => {
    const view = mount("# heading\n\nbody only\n");
    const r = runFoldService(view, 0);
    expect(r).toBeNull();
    view.destroy();
  });

  it("returns null when the opening fence is not closed within the prefix", () => {
    const view = mount("---\nincomplete: yes\n");
    const r = runFoldService(view, 0);
    expect(r).toBeNull();
    view.destroy();
  });
});

function dispatchedFoldEffects(
  dispatchSpy: ReturnType<typeof vi.spyOn>,
): Array<{ from: number; to: number }> {
  const all: Array<{ from: number; to: number }> = [];
  for (const call of dispatchSpy.mock.calls) {
    const arg = call[0] as { effects?: unknown } | undefined;
    const effects = arg?.effects;
    const list = Array.isArray(effects) ? effects : effects ? [effects] : [];
    for (const e of list) {
      if (e && typeof e === "object" && (e as { is?: unknown }).is) {
        // CM StateEffect — check whether it is a foldEffect.
        // biome-ignore lint/suspicious/noExplicitAny: StateEffect runtime type
        const eAny = e as any;
        if (eAny.is(foldEffect)) all.push(eAny.value as { from: number; to: number });
      }
    }
  }
  return all;
}

describe("frontmatterFold auto-fold on first update", () => {
  it("dispatches a foldEffect on the first docChanged update with frontmatter", async () => {
    const view = mount("");
    const dispatchSpy = vi.spyOn(view, "dispatch");
    view.dispatch({ changes: { from: 0, insert: "---\ntitle: T\n---\nbody\n" } });
    await new Promise((r) => setTimeout(r, 0));
    const folds = dispatchedFoldEffects(dispatchSpy);
    expect(folds.length).toBeGreaterThan(0);
    expect(folds[0]?.from).toBe("---".length); // index of the newline after opening fence
    view.destroy();
  });

  it("does not auto-fold a document with no frontmatter", async () => {
    const view = mount("");
    const dispatchSpy = vi.spyOn(view, "dispatch");
    view.dispatch({ changes: { from: 0, insert: "no fence here\n" } });
    await new Promise((r) => setTimeout(r, 0));
    expect(dispatchedFoldEffects(dispatchSpy)).toEqual([]);
    view.destroy();
  });

  it("ignores updates that don't change the document", async () => {
    const view = mount("---\ntitle: x\n---\nbody\n");
    const dispatchSpy = vi.spyOn(view, "dispatch");
    view.dispatch({ selection: { anchor: 0 } });
    await new Promise((r) => setTimeout(r, 0));
    expect(dispatchedFoldEffects(dispatchSpy)).toEqual([]);
    view.destroy();
  });

  it("only auto-folds once per editor (subsequent docChanged events skip)", async () => {
    const view = mount("");
    view.dispatch({ changes: { from: 0, insert: "---\ntitle: A\n---\nbody\n" } });
    await new Promise((r) => setTimeout(r, 0));
    const dispatchSpy = vi.spyOn(view, "dispatch");
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: "---\ntitle: B\n---\nfoo\n" },
    });
    await new Promise((r) => setTimeout(r, 0));
    // Second docChanged with frontmatter — should NOT dispatch another foldEffect
    // because the WeakSet guard already remembered this view.
    expect(dispatchedFoldEffects(dispatchSpy)).toEqual([]);
    view.destroy();
  });
});
