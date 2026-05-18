// S-TH-003 / S-TH-010: bind to OS-level prefers-color-scheme and
// prefers-contrast media queries, re-applying the theme whenever
// the user flips the system setting. Idempotent: safe to call once
// at app boot.
//
// We don't auto-call this from `registry.ts` so unit tests can opt
// out of the listener.

import { applyTheme, getActiveTheme } from "./registry";

let installed = false;

export function bindSystemTheme(): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  if (installed) return () => {};
  installed = true;
  const dark = window.matchMedia("(prefers-color-scheme: dark)");
  const contrast = window.matchMedia("(prefers-contrast: more)");
  const onChange = () => {
    const cur = getActiveTheme();
    if (cur.mode === "system" || cur.contrast === "auto") {
      applyTheme({});
    }
  };
  dark.addEventListener("change", onChange);
  contrast.addEventListener("change", onChange);
  return () => {
    dark.removeEventListener("change", onChange);
    contrast.removeEventListener("change", onChange);
    installed = false;
  };
}
