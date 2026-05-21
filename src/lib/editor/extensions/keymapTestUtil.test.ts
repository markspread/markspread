import { keymap } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { findKeymapCommand } from "./keymapTestUtil";

describe("findKeymapCommand", () => {
  it("returns the bound run for a matching key", () => {
    const run = () => true;
    const ext = keymap.of([{ key: "Mod-x", run }]);
    expect(findKeymapCommand(ext, "Mod-x")).toBe(run);
  });

  it("throws when no binding matches the requested key", () => {
    const ext = keymap.of([{ key: "Mod-x", run: () => true }]);
    expect(() => findKeymapCommand(ext, "Mod-y")).toThrow("no command for Mod-y");
  });
});
