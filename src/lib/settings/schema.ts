// S-ST-002..009: settings schema definition.
//
// Each setting is a flat record keyed by `category.key`. The schema
// owns:
//   • the default value
//   • the type info (used by the dialog renderer)
//   • whether the setting can be overridden per-workspace
//   • a label/description i18n key
//   • an optional list of choices (for select inputs)
//
// The whole settings dialog is generated from this schema; adding
// a new entry doesn't require touching the React layer.

export type SettingScope = "global" | "workspace" | "both";

export type SettingCategory =
  | "general"
  | "editor"
  | "ai"
  | "plugins"
  | "keybindings"
  | "appearance"
  | "privacy"
  | "about";

export type SettingKind =
  | { kind: "boolean" }
  | { kind: "number"; min?: number; max?: number; step?: number }
  | { kind: "string"; multiline?: boolean }
  | { kind: "select"; choices: { value: string; labelKey: string }[] }
  | { kind: "info" };

export interface SettingDef {
  key: string; // dot-prefixed, e.g. "editor.fontSize"
  category: SettingCategory;
  scope: SettingScope;
  defaultValue: unknown;
  labelKey: string;
  descriptionKey?: string;
  type: SettingKind;
  /** Hidden from the dialog UI (still readable via the API). */
  hidden?: boolean;
}

export const SETTINGS: SettingDef[] = [
  // -- general --
  {
    key: "general.locale",
    category: "general",
    scope: "global",
    defaultValue: "system",
    labelKey: "settings.general.locale",
    type: {
      kind: "select",
      choices: [
        { value: "system", labelKey: "settings.locale.system" },
        { value: "en", labelKey: "lang.en" },
        { value: "ko", labelKey: "lang.ko" },
        { value: "ja", labelKey: "lang.ja" },
        { value: "zh", labelKey: "lang.zh" },
        { value: "es", labelKey: "lang.es" },
      ],
    },
  },
  {
    key: "general.autosave",
    category: "general",
    scope: "both",
    defaultValue: "onBlur",
    labelKey: "settings.general.autosave",
    type: {
      kind: "select",
      choices: [
        { value: "off", labelKey: "settings.autosave.off" },
        { value: "onBlur", labelKey: "settings.autosave.onBlur" },
        { value: "after2s", labelKey: "settings.autosave.after2s" },
        { value: "onSave", labelKey: "settings.autosave.onSave" },
      ],
    },
  },
  // -- editor --
  {
    key: "editor.fontSize",
    category: "editor",
    scope: "both",
    defaultValue: 14,
    labelKey: "settings.editor.fontSize",
    type: { kind: "number", min: 9, max: 32, step: 1 },
  },
  {
    key: "editor.lineWrapping",
    category: "editor",
    scope: "both",
    defaultValue: true,
    labelKey: "settings.editor.lineWrapping",
    type: { kind: "boolean" },
  },
  {
    key: "editor.lineEndings",
    category: "editor",
    scope: "both",
    defaultValue: "preserve",
    labelKey: "settings.editor.lineEndings",
    descriptionKey: "settings.editor.lineEndings.desc",
    type: {
      kind: "select",
      choices: [
        { value: "preserve", labelKey: "settings.lineEnd.preserve" },
        { value: "lf", labelKey: "settings.lineEnd.lf" },
        { value: "crlf", labelKey: "settings.lineEnd.crlf" },
      ],
    },
  },
  {
    key: "editor.encoding",
    category: "editor",
    scope: "both",
    defaultValue: "utf-8",
    labelKey: "settings.editor.encoding",
    descriptionKey: "settings.editor.encoding.desc",
    type: {
      kind: "select",
      choices: [
        { value: "utf-8", labelKey: "settings.encoding.utf8" },
        { value: "utf-8-bom", labelKey: "settings.encoding.utf8bom" },
        { value: "utf-16le", labelKey: "settings.encoding.utf16le" },
        { value: "shift-jis", labelKey: "settings.encoding.shiftjis" },
      ],
    },
  },
  // -- ai --
  {
    key: "ai.defaultProvider",
    category: "ai",
    scope: "both",
    defaultValue: "openai",
    labelKey: "settings.ai.defaultProvider",
    type: {
      kind: "select",
      choices: [
        { value: "openai", labelKey: "ai.provider.openai" },
        { value: "anthropic", labelKey: "ai.provider.anthropic" },
        { value: "google", labelKey: "ai.provider.google" },
        { value: "ollama", labelKey: "ai.provider.ollama" },
      ],
    },
  },
  // -- plugins --
  {
    key: "plugins.allowThirdParty",
    category: "plugins",
    scope: "global",
    defaultValue: false,
    labelKey: "settings.plugins.allowThirdParty",
    type: { kind: "boolean" },
  },
  // -- keybindings (full editor opens via Keybindings sheet) --
  {
    key: "keybindings.preset",
    category: "keybindings",
    scope: "global",
    defaultValue: "vscode",
    labelKey: "settings.keybindings.preset",
    type: {
      kind: "select",
      choices: [
        { value: "vscode", labelKey: "settings.keybindings.vscode" },
        { value: "sublime", labelKey: "settings.keybindings.sublime" },
        { value: "none", labelKey: "settings.keybindings.none" },
      ],
    },
  },
  // -- appearance --
  {
    key: "appearance.theme",
    category: "appearance",
    scope: "global",
    defaultValue: "system",
    labelKey: "settings.appearance.theme",
    type: {
      kind: "select",
      choices: [
        { value: "system", labelKey: "settings.theme.system" },
        { value: "light", labelKey: "settings.theme.light" },
        { value: "dark", labelKey: "settings.theme.dark" },
      ],
    },
  },
  // -- privacy --
  {
    key: "privacy.telemetry",
    category: "privacy",
    scope: "global",
    defaultValue: false,
    labelKey: "settings.privacy.telemetry",
    type: { kind: "boolean" },
  },
  {
    key: "privacy.crashReports",
    category: "privacy",
    scope: "global",
    defaultValue: false,
    labelKey: "settings.privacy.crashReports",
    type: { kind: "boolean" },
  },
  // -- update --
  {
    key: "update.channel",
    category: "general",
    scope: "global",
    defaultValue: "stable",
    labelKey: "settings.update.channel",
    type: {
      kind: "select",
      choices: [
        { value: "stable", labelKey: "settings.update.stable" },
        { value: "beta", labelKey: "settings.update.beta" },
      ],
    },
  },
  // -- about (read-only info) --
  {
    key: "about.version",
    category: "about",
    scope: "global",
    defaultValue: "0.0.0",
    labelKey: "settings.about.version",
    type: { kind: "info" },
    hidden: false,
  },
];

export function findSetting(key: string): SettingDef | undefined {
  return SETTINGS.find((s) => s.key === key);
}

export function settingsByCategory(category: SettingCategory): SettingDef[] {
  return SETTINGS.filter((s) => s.category === category && !s.hidden);
}
