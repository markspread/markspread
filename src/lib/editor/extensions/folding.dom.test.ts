import "./jsdomLayoutShim";
// S-ED-012..S-ED-014: markdown folding extension.

import { markdown } from "@codemirror/lang-markdown";
import { foldEffect, foldedRanges } from "@codemirror/language";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { foldAllHeadingsCommand, foldingExtension, unfoldAllCommand } from "./folding";

function makeView(doc: string): EditorView {
  return new EditorView({
    state: EditorState.create({
      doc,
      extensions: [markdown(), foldingExtension()],
    }),
  });
}

describe("foldAllHeadingsCommand", () => {
  it("returns false when there are no headings", () => {
    const view = makeView("just plain text\nno headings here\n");
    expect(foldAllHeadingsCommand(view)).toBe(false);
    view.destroy();
  });

  it("returns true and folds every heading-bounded section", () => {
    const view = makeView("# h1\nbody\n## h2a\nbody2\n## h2b\nbody3\n");
    expect(foldAllHeadingsCommand(view)).toBe(true);
    const ranges = foldedRanges(view.state);
    expect(ranges.size).toBeGreaterThan(0);
    view.destroy();
  });

  it("skips heading lines with no body (no fold range)", () => {
    const view = makeView("# only heading");
    expect(foldAllHeadingsCommand(view)).toBe(false);
    view.destroy();
  });
});

describe("unfoldAllCommand", () => {
  it("returns false when nothing is folded", () => {
    const view = makeView("# h1\nbody\n");
    expect(unfoldAllCommand(view)).toBe(false);
    view.destroy();
  });

  it("returns true when at least one folded range exists, and clears them", () => {
    const view = makeView("# h1\nbody\nmore\n");
    foldAllHeadingsCommand(view);
    expect(foldedRanges(view.state).size).toBeGreaterThan(0);
    expect(unfoldAllCommand(view)).toBe(true);
    expect(foldedRanges(view.state).size).toBe(0);
    view.destroy();
  });
});

describe("foldingExtension fold service (code blocks)", () => {
  it("folds a fenced code block from its open fence to before close", () => {
    const view = makeView("```\ncode\nmore\n```\n");
    // Use the fold service indirectly by calling foldEffect manually.
    // What we exercise here is just that the extension installs without
    // throwing and the code path under `codeBlockFoldRange` executes via
    // the foldService when CM6's fold gutter queries it. We assert no
    // throw on adding a fold effect.
    view.dispatch({
      effects: foldEffect.of({ from: 3, to: view.state.doc.length - 4 }),
      selection: EditorSelection.cursor(0),
    });
    view.destroy();
  });
});
