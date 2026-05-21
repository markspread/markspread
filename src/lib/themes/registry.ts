// S-TH-001..010: theme registry + applier.
//
// We model a theme as a flat token table keyed by CSS variable
// name. The applier writes the table onto `document.documentElement`
// via `style.setProperty`, which lets us swap themes without
// reloading the app or the editor (S-TH-004).
//
// Built-in themes:
//   • light, dark, high-contrast-light, high-contrast-dark
//   • deuteranopia + protanopia palettes that override the
//     "semantic" colour group (success/warning/danger). Those layer
//     on top of either light or dark — applied by combining tokens
//     in `applyTheme`.
//
// Plug-in / user themes (S-TH-007/008) register via
// `registerTheme()`; they're stored in the same map and can be
// activated by id.

export type ThemeMode = "light" | "dark";

export type ColorVisionMode = "default" | "deuteranopia" | "protanopia";

export interface ThemeTokens {
  /** CSS custom-property table. Keys must start with `--`. */
  tokens: Record<string, string>;
  /** Recommended Shiki theme name (S-TH-006). */
  shiki: string;
  /** Whether this is a high-contrast variant. */
  highContrast?: boolean;
}

export interface ThemeDefinition {
  id: string;
  name: string;
  mode: ThemeMode;
  light: ThemeTokens;
  dark?: ThemeTokens; // optional — mostly themes that span both modes
}

const themes = new Map<string, ThemeDefinition>();
const listeners = new Set<() => void>();

export function registerTheme(theme: ThemeDefinition): () => void {
  themes.set(theme.id, theme);
  emit();
  return () => {
    themes.delete(theme.id);
    emit();
  };
}

export function listThemes(): ThemeDefinition[] {
  return Array.from(themes.values());
}

export function getTheme(id: string): ThemeDefinition | undefined {
  return themes.get(id);
}

let activeId = "default-light";
let activeMode: ThemeMode | "system" = "system";
let activeVision: ColorVisionMode = "default";
let activeContrast: "auto" | "high" = "auto";

export interface ApplyOptions {
  themeId?: string;
  mode?: ThemeMode | "system";
  vision?: ColorVisionMode;
  contrast?: "auto" | "high";
}

export function applyTheme(opts: ApplyOptions = {}): void {
  if (opts.themeId) activeId = opts.themeId;
  if (opts.mode) activeMode = opts.mode;
  if (opts.vision) activeVision = opts.vision;
  if (opts.contrast) activeContrast = opts.contrast;

  const def = themes.get(activeId) ?? themes.get("default-light");
  /* v8 ignore next -- 'default-light' is registered at module-init so this fallback always resolves */
  if (!def) return;
  const resolvedMode: ThemeMode = activeMode === "system" ? matchSystemMode() : activeMode;
  const baseTokens = (resolvedMode === "dark" && def.dark ? def.dark : def.light).tokens;
  const root = document.documentElement;
  // Wipe previous overrides so disabling a vision mode actually
  // removes its tokens. We use a session map keyed by `applyTheme`
  // calls — anything still present is rewritten in this pass.
  for (const k of currentlyApplied) root.style.removeProperty(k);
  currentlyApplied.clear();
  const layers = [baseTokens];
  if (activeVision !== "default") {
    const visionTokens = VISION_OVERRIDES[activeVision];
    if (visionTokens) layers.push(visionTokens);
  }
  if (activeContrast === "high" || (activeContrast === "auto" && systemHighContrast())) {
    const hc = HIGH_CONTRAST_OVERRIDES[resolvedMode];
    if (hc) layers.push(hc);
  }
  for (const layer of layers) {
    for (const [k, v] of Object.entries(layer)) {
      root.style.setProperty(k, v);
      currentlyApplied.add(k);
    }
  }
  root.dataset.theme = resolvedMode;
  root.dataset.themeId = def.id;
  root.dataset.vision = activeVision;
  emit();
}

const currentlyApplied = new Set<string>();

function matchSystemMode(): ThemeMode {
  if (typeof window === "undefined" || !window.matchMedia) return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function systemHighContrast(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-contrast: more)").matches;
}

const VISION_OVERRIDES: Record<Exclude<ColorVisionMode, "default">, Record<string, string>> = {
  // Hue swaps tuned for the most common dichromacies — they shift
  // the warning/success palette away from red↔green collisions.
  deuteranopia: {
    "--ms-color-success": "#2563eb",
    "--ms-color-warning": "#d97706",
    "--ms-color-danger": "#7c3aed",
  },
  protanopia: {
    "--ms-color-success": "#0ea5e9",
    "--ms-color-warning": "#ca8a04",
    "--ms-color-danger": "#9333ea",
  },
};

const HIGH_CONTRAST_OVERRIDES: Record<ThemeMode, Record<string, string>> = {
  light: {
    "--ms-color-bg": "#ffffff",
    "--ms-color-fg": "#000000",
    "--ms-color-border": "#000000",
    "--ms-color-link": "#0000ee",
  },
  dark: {
    "--ms-color-bg": "#000000",
    "--ms-color-fg": "#ffffff",
    "--ms-color-border": "#ffffff",
    "--ms-color-link": "#00ffff",
  },
};

export function getActiveTheme(): {
  themeId: string;
  mode: ThemeMode | "system";
  vision: ColorVisionMode;
  contrast: "auto" | "high";
  shiki: string;
} {
  const def = themes.get(activeId);
  return {
    themeId: activeId,
    mode: activeMode,
    vision: activeVision,
    contrast: activeContrast,
    shiki: def?.light.shiki ?? "github-light",
  };
}

export function subscribeTheme(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit() {
  for (const fn of listeners) fn();
}

// -- bootstrap default themes ------------------------------------

const LIGHT_TOKENS: Record<string, string> = {
  "--ms-color-bg": "#ffffff",
  "--ms-color-bg-subtle": "#f6f7f9",
  "--ms-color-fg": "#1f2328",
  "--ms-color-muted": "#656d76",
  "--ms-color-border": "#d0d7de",
  "--ms-color-link": "#0969da",
  "--ms-color-success": "#1a7f37",
  "--ms-color-warning": "#9a6700",
  "--ms-color-danger": "#cf222e",
};

const DARK_TOKENS: Record<string, string> = {
  "--ms-color-bg": "#0d1117",
  "--ms-color-bg-subtle": "#161b22",
  "--ms-color-fg": "#e6edf3",
  "--ms-color-muted": "#7d8590",
  "--ms-color-border": "#30363d",
  "--ms-color-link": "#58a6ff",
  "--ms-color-success": "#3fb950",
  "--ms-color-warning": "#d29922",
  "--ms-color-danger": "#f85149",
};

registerTheme({
  id: "default-light",
  name: "Default Light",
  mode: "light",
  light: { tokens: LIGHT_TOKENS, shiki: "github-light" },
  dark: { tokens: DARK_TOKENS, shiki: "github-dark" },
});

registerTheme({
  id: "default-dark",
  name: "Default Dark",
  mode: "dark",
  light: { tokens: DARK_TOKENS, shiki: "github-dark" },
});

// -- S-TH-007: import a user theme JSON ----------------------------

export function importThemeJson(json: string): ThemeDefinition {
  const def = JSON.parse(json) as ThemeDefinition;
  if (!def.id || !def.light?.tokens) throw new Error("invalid theme json");
  registerTheme(def);
  return def;
}
