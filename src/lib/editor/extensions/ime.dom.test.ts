import "./jsdomLayoutShim";
// S-ED-046..S-ED-049: editor IME composition class toggle.

import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { imeExtension } from "./ime";

describe("imeExtension", () => {
  it("adds and removes the cm-composing class on composition events", () => {
    const view = new EditorView({
      state: EditorState.create({ doc: "", extensions: [imeExtension()] }),
    });
    view.contentDOM.dispatchEvent(new CompositionEvent("compositionstart"));
    expect(view.dom.classList.contains("cm-composing")).toBe(true);
    view.contentDOM.dispatchEvent(new CompositionEvent("compositionend"));
    expect(view.dom.classList.contains("cm-composing")).toBe(false);
    view.destroy();
  });
});
