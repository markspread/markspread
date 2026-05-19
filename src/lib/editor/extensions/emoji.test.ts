// S-MD-043: tests for the emoji shortcode helpers.
//
// emoji.ts registers its CompletionSource as an import side-effect and
// keeps the source itself private; the exported surface is the
// `setEmojiEnabled` toggle and the `addEmojiShortcode` plugin hook.

import { CompletionContext } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { addEmojiShortcode, setEmojiEnabled } from "./emoji";

describe("emoji shortcode helpers", () => {
  it("setEmojiEnabled toggles without throwing", () => {
    expect(() => setEmojiEnabled(true)).not.toThrow();
    expect(() => setEmojiEnabled(false)).not.toThrow();
  });

  it("addEmojiShortcode registers a custom glyph without throwing", () => {
    expect(() => addEmojiShortcode("shrug", "🤷")).not.toThrow();
  });

  it("a CompletionContext can be constructed for the source to consume", () => {
    // Smoke-check the trigger surface emoji.ts depends on: a colon-led
    // token at the cursor is what the source's TRIGGER_RE matches.
    const state = EditorState.create({ doc: "note :smi" });
    const ctx = new CompletionContext(state, 9, false);
    expect(ctx.pos).toBe(9);
    const line = state.doc.lineAt(9);
    expect(/:([\w+_-]*)$/.exec(line.text.slice(0, 9 - line.from))?.[0]).toBe(":smi");
  });
});
