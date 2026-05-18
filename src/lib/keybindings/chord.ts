// S-KB-009: chord engine. A "chord" is a two-step shortcut (VS Code
// calls these "chord keybindings") where the first step is a prefix
// that arms a 1.5-second window, during which the next step resolves
// the actual command. Examples from the vscode preset:
//
//   "Mod+K Mod+S"   → keybindings sheet
//   "Mod+K Mod+T"   → theme picker
//   "Mod+K Z"        → zen mode
//
// Acceptance:
//   • after the first step, 1500ms window before the chord resets
//   • the status bar shows "(⌘K) waiting for next key…" while armed
//
// The dispatcher (S-KB-005) already accepts an optional `prefix`
// argument. This module is the controller around it: it inspects the
// active bindings to decide if a step is a chord prefix, holds the
// prefix string, and emits events for the status bar to subscribe to.

import { dispatch } from "./dispatch";
import { bindingFromEvent, listActiveBindings, normaliseBinding } from ".";
import { runCommand } from "@/lib/commands/registry";

const CHORD_TIMEOUT_MS = 1500;

let pendingPrefix: string | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

type Listener = (prefix: string | null) => void;
const listeners = new Set<Listener>();

/**
 * Subscribe to chord-prefix changes. Status bar UI calls this on
 * mount; the listener fires with the current prefix (string while
 * armed, null when cleared) so the bar can render
 * "(⌘K) waiting for next key…".
 */
export function onChordPrefix(fn: Listener): () => void {
  listeners.add(fn);
  fn(pendingPrefix);
  return () => {
    listeners.delete(fn);
  };
}

function emit() {
  for (const fn of listeners) fn(pendingPrefix);
}

function clearPrefix() {
  if (timer) clearTimeout(timer);
  timer = null;
  pendingPrefix = null;
  emit();
}

function isChordPrefix(step: string): boolean {
  // A step is a "chord prefix" if any active binding starts with it
  // and has at least one more step after a space.
  const want = `${normaliseBinding(step)} `;
  for (const e of listActiveBindings()) {
    if (normaliseBinding(e.binding).startsWith(want)) return true;
  }
  return false;
}

/**
 * Top-level keydown handler that wraps `dispatch`. Use this instead of
 * `dispatch` when you want chord support — the editor host and the
 * global window listener both call this. Returns:
 *   - the resolved commandId (and runs it) if a chord completes or a
 *     plain binding matches
 *   - null if nothing matched, or if the event armed a chord prefix
 *     (the caller still wants to preventDefault to swallow the prefix
 *     keys, so we surface the chord state separately).
 */
export function dispatchWithChord(event: KeyboardEvent): {
  commandId: string | null;
  consumed: boolean;
} {
  const step = bindingFromEvent(event);
  if (!step) return { commandId: null, consumed: false };
  const norm = normaliseBinding(step);

  if (pendingPrefix) {
    // We're inside a chord window. Try to resolve as chord first.
    const id = dispatch(event, pendingPrefix);
    clearPrefix();
    if (id) {
      runCommand(id);
      return { commandId: id, consumed: true };
    }
    // Chord miss: VS Code's behaviour is to silently abort the chord;
    // we mirror that. The second key is *not* re-dispatched as a
    // standalone — that would too easily fire an unintended command.
    return { commandId: null, consumed: true };
  }

  // No prefix armed. If this step starts a chord, arm and wait.
  if (isChordPrefix(norm)) {
    pendingPrefix = norm;
    timer = setTimeout(clearPrefix, CHORD_TIMEOUT_MS);
    emit();
    return { commandId: null, consumed: true };
  }

  // Plain (non-chord) resolution.
  const id = dispatch(event);
  if (id) {
    runCommand(id);
    return { commandId: id, consumed: true };
  }
  return { commandId: null, consumed: false };
}

/** Reset chord state. Tests and the modeless host call this. */
export function _resetChord(): void {
  clearPrefix();
}
