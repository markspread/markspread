// S-ESP-012: verify the editor-layout commands surface in the palette.

import { beforeEach, describe, expect, it } from "vitest";
import i18next from "i18next";
import { bootstrapSidebarPaletteItems } from "../lib/palette/bootstrap";
import { clearPaletteItems, query } from "../lib/palette/registry";

beforeEach(async () => {
  clearPaletteItems();
  if (!i18next.isInitialized) {
    await i18next.init({
      lng: "en",
      resources: {
        en: {
          translation: {
            commands: {
              view: {
                toggle_sidebar: "Toggle Sidebar",
                show_sidebar: "Show Sidebar",
                hide_sidebar: "Hide Sidebar",
                split_right: "Split Editor Right",
                split_down: "Split Editor Down",
                focus_pane_1: "Focus Pane 1",
                focus_pane_2: "Focus Pane 2",
                focus_pane_3: "Focus Pane 3",
                move_editor_to_next_group: "Move Editor to Next Group",
              },
              tabs: { close_active: "Close Editor" },
            },
          },
        },
      },
    });
  }
});

describe("palette bootstrap (editor-layout)", () => {
  it("registers split / focus / close / move commands with localised labels", () => {
    bootstrapSidebarPaletteItems();
    const results = query({ raw: "split", limit: 50 }).map((it) => it.id);
    expect(results).toContain("view.split_right");
    expect(results).toContain("view.split_down");

    const close = query({ raw: "close editor", limit: 50 });
    expect(close.find((it) => it.id === "tabs.close_active")?.label).toBe(
      "Close Editor",
    );

    const move = query({ raw: "move editor", limit: 50 });
    expect(move.find((it) => it.id === "view.move_editor_to_next_group")?.label).toBe(
      "Move Editor to Next Group",
    );

    const focus = query({ raw: "focus pane", limit: 50 }).map((it) => it.id);
    expect(focus).toContain("view.focus_pane_1");
    expect(focus).toContain("view.focus_pane_2");
    expect(focus).toContain("view.focus_pane_3");
  });
});
