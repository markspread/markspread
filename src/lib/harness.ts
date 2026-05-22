// S-TST-008/009/etc.: e2e harness routing. When the renderer is loaded
// in a browser with `?harness=<mode>` set, App.tsx short-circuits its
// normal mount logic and renders the matching fixture component
// instead. Production builds inside Tauri never see the param.

const VALID_MODES = [
  "fresh-install",
  "returning-user",
  "empty-home",
  "workspace-with-content",
  "workspace-with-links",
  "ai-mock",
  "plugin-lifecycle",
  "updater",
] as const;

export type HarnessMode = (typeof VALID_MODES)[number];

export function currentHarnessMode(): HarnessMode | null {
  if (typeof window === "undefined") return null;
  const raw = new URLSearchParams(window.location.search).get("harness");
  return (VALID_MODES as readonly string[]).includes(raw ?? "") ? (raw as HarnessMode) : null;
}
