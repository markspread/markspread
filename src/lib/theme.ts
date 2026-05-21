export type ThemeMode = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export function detectSystemTheme(): ResolvedTheme {
  if (
    typeof window !== "undefined" &&
    window.matchMedia &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  ) {
    return "dark";
  }
  return "light";
}

export function applyTheme(resolved: ResolvedTheme): void {
  /* v8 ignore next -- jsdom always provides document; defensive for SSR/node use */
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;
}
