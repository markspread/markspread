// S-SBC-005 / S-ESP-012: bridge between the static command registry and
// the command palette. Called once at app startup; re-runs on locale
// change so the labels follow i18n. Covers View-category sidebar
// commands plus the F4 editor-layout commands (split / focus / close /
// move) so they're discoverable without memorising the chord.

import i18next from "i18next";
import { commands } from "../commands/registry";
import { registerPaletteItem } from "./registry";

const PALETTE_IDS: { id: string; titleKey: string }[] = [
  { id: "view.toggle_sidebar", titleKey: "commands.view.toggle_sidebar" },
  { id: "view.show_sidebar", titleKey: "commands.view.show_sidebar" },
  { id: "view.hide_sidebar", titleKey: "commands.view.hide_sidebar" },
  { id: "view.split_right", titleKey: "commands.view.split_right" },
  { id: "view.split_down", titleKey: "commands.view.split_down" },
  { id: "view.focus_pane_1", titleKey: "commands.view.focus_pane_1" },
  { id: "view.focus_pane_2", titleKey: "commands.view.focus_pane_2" },
  { id: "view.focus_pane_3", titleKey: "commands.view.focus_pane_3" },
  {
    id: "view.move_editor_to_next_group",
    titleKey: "commands.view.move_editor_to_next_group",
  },
  { id: "tabs.close_active", titleKey: "commands.tabs.close_active" },
];

const detachers: (() => void)[] = [];

function detach(): void {
  while (detachers.length > 0) {
    const fn = detachers.pop();
    fn?.();
  }
}

function register(): void {
  for (const { id, titleKey } of PALETTE_IDS) {
    const cmd = commands.find((c) => c.id === id);
    if (!cmd) continue;
    const label = i18next.t(titleKey, { defaultValue: cmd.title });
    detachers.push(
      registerPaletteItem({
        id: cmd.id,
        category: "command",
        label,
        detail: cmd.category,
        // English fallback for searchKey so a user typing the canonical
        // word ("sidebar") still hits even when the active locale is
        // non-English. Both the localised label and the English title
        // are made searchable.
        searchKey: `${label} ${cmd.title} ${cmd.category}`.toLowerCase(),
        run: () => cmd.run(),
      }),
    );
  }
}

/**
 * Idempotent — calling twice rebuilds the entries (e.g. after a locale
 * change). Returns a detacher in case the app wants to drop the entries.
 */
export function bootstrapSidebarPaletteItems(): () => void {
  detach();
  register();
  i18next.on("languageChanged", () => {
    detach();
    register();
  });
  return detach;
}
