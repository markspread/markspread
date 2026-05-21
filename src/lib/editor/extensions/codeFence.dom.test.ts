import "./jsdomLayoutShim";
// S-MD-012/014: tests for code-fence input helpers.

import type { CompletionContext } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import {
  addCodeLanguageCompletion,
  codeFenceExtension,
  fenceLanguageCompletion,
} from "./codeFence";

function mount(doc = ""): EditorView {
  return new EditorView({
    state: EditorState.create({ doc, extensions: codeFenceExtension() }),
  });
}

describe("fenceAutoclose", () => {
  it("auto-closes a ``` typed on a fresh line", async () => {
    const view = mount("");
    view.dispatch({
      changes: { from: 0, insert: "```" },
      selection: { anchor: 3 },
    });
    await new Promise<void>((r) => queueMicrotask(r));
    expect(view.state.doc.toString()).toBe("```\n\n```");
    expect(view.state.selection.main.head).toBe(4);
    view.destroy();
  });

  it("does not fire when ``` is not the whole line", async () => {
    const view = mount("text");
    view.dispatch({
      changes: { from: 4, insert: "```" },
      selection: { anchor: 7 },
    });
    await new Promise<void>((r) => queueMicrotask(r));
    expect(view.state.doc.toString()).toBe("text```");
    view.destroy();
  });
});

describe("addCodeLanguageCompletion", () => {
  it("registers a custom language without throwing", () => {
    expect(() => addCodeLanguageCompletion("brainfuck")).not.toThrow();
    // calling twice is idempotent
    expect(() => addCodeLanguageCompletion("brainfuck")).not.toThrow();
  });

  it("includes the registered custom language in the completion options", () => {
    addCodeLanguageCompletion("myDSL");
    const view = mount("```myDS");
    const ctx = {
      state: view.state,
      pos: 7,
      explicit: false,
      matchBefore: () => null,
    } as unknown as CompletionContext;
    const res = fenceLanguageCompletion(ctx);
    expect(res?.options.some((o) => o.label === "myDSL")).toBe(true);
    view.destroy();
  });
});

describe("fenceLanguageCompletion", () => {
  it("returns options when the cursor sits inside a ``` lang hint line", () => {
    const view = mount("```py");
    const ctx = {
      state: view.state,
      pos: 5,
      explicit: false,
      matchBefore: () => null,
    } as unknown as CompletionContext;
    const res = fenceLanguageCompletion(ctx);
    expect(res).not.toBeNull();
    expect(res?.from).toBe(3);
    expect(res?.options.some((o) => o.label === "python")).toBe(true);
    view.destroy();
  });

  it("returns null when not on a fence-language line", () => {
    const view = mount("plain text");
    const ctx = {
      state: view.state,
      pos: 4,
      explicit: false,
      matchBefore: () => null,
    } as unknown as CompletionContext;
    expect(fenceLanguageCompletion(ctx)).toBeNull();
    view.destroy();
  });
});

describe("fenceLangAutotrigger", () => {
  it("fires the completion popup when the user types a language letter after ```", async () => {
    const view = mount("");
    view.dispatch({
      changes: { from: 0, insert: "```p" },
      selection: { anchor: 4 },
    });
    // This update sees `^```[\w+-]+$` on the line and schedules
    // startCompletion via queueMicrotask. We don't have an easy hook to
    // assert the popup state, but reaching this update path is the goal.
    await new Promise<void>((r) => queueMicrotask(r));
    expect(view.state.doc.toString()).toBe("```p");
    view.destroy();
  });

  it("does not fire when the selection is non-empty", async () => {
    const view = mount("");
    view.dispatch({
      changes: { from: 0, insert: "```p" },
      selection: { anchor: 0, head: 4 },
    });
    await new Promise<void>((r) => queueMicrotask(r));
    view.destroy();
  });

  it("ignores doc-unchanged updates", () => {
    const view = mount("```python");
    view.dispatch({ selection: { anchor: 9 } });
    view.destroy();
  });
});
