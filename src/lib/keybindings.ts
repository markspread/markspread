import { commands, runCommand } from "./commands/registry";
import { attachImeGuard, isComposing } from "./keybindings/ime";

export {
  bindingFromEvent,
  formatBinding,
  listActiveBindings,
  normaliseBinding,
  resolveBinding,
  setUserOverride,
  clearUserOverride,
  setPreset,
  getPreset,
  switchPreset,
  registerPluginKeybindings,
  unregisterPluginKeybindings,
} from "./keybindings/index";
export type { Binding, BindingEntry, Preset } from "./keybindings/types";

/**
 * Minimal keybinding bridge until the KB unit lands. Each command's
 * `defaultBinding` is parsed into a matcher and dispatched on keydown.
 * Format: `Mod+Shift+N` where Mod=⌘ on macOS, Ctrl elsewhere.
 */
interface ParsedBinding {
  ctrlOrMeta: boolean;
  shift: boolean;
  alt: boolean;
  key: string;
}

function parseBinding(spec: string): ParsedBinding {
  const parts = spec.split("+").map((p) => p.trim());
  const key = parts.pop() ?? "";
  const set = new Set(parts.map((p) => p.toLowerCase()));
  return {
    ctrlOrMeta: set.has("mod") || set.has("ctrl") || set.has("cmd"),
    shift: set.has("shift"),
    alt: set.has("alt") || set.has("option"),
    key: key.toLowerCase(),
  };
}

function matches(evt: KeyboardEvent, b: ParsedBinding): boolean {
  const isMac = navigator.platform.toLowerCase().includes("mac");
  const modOk = b.ctrlOrMeta ? (isMac ? evt.metaKey : evt.ctrlKey) : !evt.metaKey && !evt.ctrlKey;
  return (
    modOk && evt.shiftKey === b.shift && evt.altKey === b.alt && evt.key.toLowerCase() === b.key
  );
}

export function registerKeybindings(): () => void {
  // S-KB-008: track IME composition globally so the bridge below
  // (and the new dispatcher in lib/keybindings/dispatch.ts) can both
  // ignore keystrokes the IME has consumed.
  const detachIme = attachImeGuard(window);

  const handler = (evt: KeyboardEvent) => {
    if (isComposing(evt)) return;
    for (const cmd of commands) {
      if (!cmd.defaultBinding) continue;
      const b = parseBinding(cmd.defaultBinding);
      if (matches(evt, b)) {
        evt.preventDefault();
        runCommand(cmd.id);
        return;
      }
    }
  };
  window.addEventListener("keydown", handler);
  return () => {
    window.removeEventListener("keydown", handler);
    detachIme();
  };
}
