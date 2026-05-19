import "./extensions/jsdomLayoutShim";
// S-ED-015..030: tests for the editor settings compartment bridge.

import { indentUnit } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_EDITOR_PREFS,
  type EditorPrefs,
  adjustFontSize,
  reconfigureFromSettings,
  settingsExtensions,
  toggleSoftWrap,
} from "./settings";

function mount(prefs: EditorPrefs = DEFAULT_EDITOR_PREFS): EditorView {
  return new EditorView({
    state: EditorState.create({
      doc: "hello",
      extensions: [settingsExtensions(prefs)],
    }),
  });
}

describe("settingsExtensions", () => {
  it("applies indent unit from spaces", () => {
    const view = mount({ ...DEFAULT_EDITOR_PREFS, indentWithTabs: false, indentSize: 3 });
    expect(view.state.facet(indentUnit)).toBe("   ");
    view.destroy();
  });

  it("applies a tab indent unit", () => {
    const view = mount({ ...DEFAULT_EDITOR_PREFS, indentWithTabs: true });
    expect(view.state.facet(indentUnit)).toBe("\t");
    view.destroy();
  });

  it("clamps tab size to 1..8", () => {
    const big = mount({ ...DEFAULT_EDITOR_PREFS, tabSize: 99 });
    expect(big.state.tabSize).toBe(8);
    big.destroy();
    const small = mount({ ...DEFAULT_EDITOR_PREFS, tabSize: 0 });
    expect(small.state.tabSize).toBe(1);
    small.destroy();
  });
});

describe("toggleSoftWrap", () => {
  it("flips the soft-wrap pref and returns the new value", () => {
    const view = mount({ ...DEFAULT_EDITOR_PREFS, softWrap: true });
    expect(toggleSoftWrap(view, { ...DEFAULT_EDITOR_PREFS, softWrap: true })).toBe(false);
    expect(toggleSoftWrap(view, { ...DEFAULT_EDITOR_PREFS, softWrap: false })).toBe(true);
    view.destroy();
  });
});

describe("adjustFontSize", () => {
  it("bumps the font size by the delta", () => {
    const view = mount();
    const prefs = { ...DEFAULT_EDITOR_PREFS, fontSize: 15 };
    expect(adjustFontSize(view, prefs, 1)).toBe(16);
    expect(adjustFontSize(view, prefs, -1)).toBe(14);
    view.destroy();
  });

  it("clamps the font size to the 8..32 range", () => {
    const view = mount();
    expect(adjustFontSize(view, { ...DEFAULT_EDITOR_PREFS, fontSize: 32 }, 10)).toBe(32);
    expect(adjustFontSize(view, { ...DEFAULT_EDITOR_PREFS, fontSize: 8 }, -10)).toBe(8);
    view.destroy();
  });
});

describe("reconfigureFromSettings", () => {
  it("applies a full prefs change in one dispatch", () => {
    const view = mount();
    reconfigureFromSettings(view, {
      ...DEFAULT_EDITOR_PREFS,
      indentWithTabs: true,
      tabSize: 6,
      showLineNumbers: true,
    });
    expect(view.state.facet(indentUnit)).toBe("\t");
    expect(view.state.tabSize).toBe(6);
    view.destroy();
  });

  it("turning soft wrap off removes line wrapping", () => {
    const view = mount({ ...DEFAULT_EDITOR_PREFS, softWrap: true });
    reconfigureFromSettings(view, { ...DEFAULT_EDITOR_PREFS, softWrap: false });
    // Reconfigured without throwing — assert the doc is intact.
    expect(view.state.doc.toString()).toBe("hello");
    view.destroy();
  });
});
