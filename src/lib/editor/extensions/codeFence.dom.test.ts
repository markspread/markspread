import "./jsdomLayoutShim";
// S-MD-012/014: tests for code-fence input helpers.

import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { addCodeLanguageCompletion, codeFenceExtension } from "./codeFence";

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
});
