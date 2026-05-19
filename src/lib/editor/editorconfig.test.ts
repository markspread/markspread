// S-ED-025: tests for the minimal .editorconfig resolver.

import { describe, expect, it } from "vitest";
import { applyEditorconfigPatch, parseEditorconfig, patchFromEditorconfig } from "./editorconfig";
import { DEFAULT_EDITOR_PREFS } from "./settings";

describe("parseEditorconfig", () => {
  it("detects root and section props", () => {
    const { root, sections } = parseEditorconfig(
      ["root = true", "", "[*.md]", "indent_style = space", "indent_size = 2"].join("\n"),
    );
    expect(root).toBe(true);
    expect(sections).toHaveLength(1);
    expect(sections[0]?.glob).toBe("*.md");
    expect(sections[0]?.props.indent_style).toBe("space");
    expect(sections[0]?.props.indent_size).toBe("2");
  });

  it("ignores comments and blank lines", () => {
    const { sections } = parseEditorconfig(
      ["# comment", "; also comment", "  ", "[*]", "indent_size=4"].join("\n"),
    );
    expect(sections).toHaveLength(1);
    expect(sections[0]?.props.indent_size).toBe("4");
  });

  it("ignores lines with no '=' and pre-section props that aren't root", () => {
    const { root, sections } = parseEditorconfig(
      ["garbage line", "charset = utf-8", "[*]", "key without value"].join("\n"),
    );
    expect(root).toBe(false);
    expect(sections[0]?.props).toEqual({});
  });

  it("treats CRLF line endings", () => {
    const { sections } = parseEditorconfig("[*.md]\r\nindent_size = 8\r\n");
    expect(sections[0]?.props.indent_size).toBe("8");
  });

  it("root = false leaves root unset", () => {
    const { root } = parseEditorconfig("root = false\n");
    expect(root).toBe(false);
  });
});

describe("patchFromEditorconfig", () => {
  it("applies a matching glob with tab style", () => {
    const patch = patchFromEditorconfig(
      "[*.md]\nindent_style = tab\nindent_size = 4\ntab_width = 8\n",
      "readme.md",
    );
    expect(patch).toEqual({ indentWithTabs: true, indentSize: 4, tabSize: 8 });
  });

  it("space style sets indentWithTabs false", () => {
    const patch = patchFromEditorconfig("[*]\nindent_style = space\n", "x.md");
    expect(patch.indentWithTabs).toBe(false);
  });

  it("skips non-matching globs", () => {
    const patch = patchFromEditorconfig("[*.ts]\nindent_size = 4\n", "readme.md");
    expect(patch).toEqual({});
  });

  it("expands brace alternation", () => {
    const patch = patchFromEditorconfig("[*.{md,markdown}]\nindent_size = 3\n", "doc.markdown");
    expect(patch.indentSize).toBe(3);
  });

  it("supports double-star globs", () => {
    const patch = patchFromEditorconfig("[**.md]\nindent_size = 5\n", "a/b/c.md");
    expect(patch.indentSize).toBe(5);
  });

  it("ignores non-positive / non-finite numeric values", () => {
    const patch = patchFromEditorconfig("[*]\nindent_size = 0\ntab_width = abc\n", "x.md");
    expect(patch.indentSize).toBeUndefined();
    expect(patch.tabSize).toBeUndefined();
  });

  it("last matching section wins", () => {
    const patch = patchFromEditorconfig("[*]\nindent_size = 2\n[*.md]\nindent_size = 4\n", "x.md");
    expect(patch.indentSize).toBe(4);
  });
});

describe("applyEditorconfigPatch", () => {
  it("merges a patch over the baseline prefs", () => {
    const merged = applyEditorconfigPatch(DEFAULT_EDITOR_PREFS, {
      indentSize: 4,
      indentWithTabs: true,
    });
    expect(merged.indentSize).toBe(4);
    expect(merged.indentWithTabs).toBe(true);
    expect(merged.fontSize).toBe(DEFAULT_EDITOR_PREFS.fontSize);
  });

  it("empty patch returns an equivalent prefs object", () => {
    expect(applyEditorconfigPatch(DEFAULT_EDITOR_PREFS, {})).toEqual(DEFAULT_EDITOR_PREFS);
  });
});
