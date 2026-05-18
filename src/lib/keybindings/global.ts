// S-KB-010: global (modeless) keydown listener. Lives at the window
// level so commands marked `when: "always"` (or with no when) fire
// regardless of which surface owns focus — Command Palette, New
// Window, Switch Workspace, etc.
//
// Acceptance:
//   • when=true or when omitted → fires anywhere
//   • inside <input> / <textarea> / contenteditable, fire only when
//     a modifier (Mod/Ctrl) is held — plain letters belong to the
//     typing surface, but Mod+P (palette) must still work mid-typing.
//
// We piggy-back on dispatchWithChord (S-KB-009) so chord prefixes work
// from anywhere too. The IME guard is already inside dispatch.

import { dispatchWithChord } from "./chord";

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return true;
  if (target.isContentEditable) return true;
  return false;
}

function hasCommandModifier(event: KeyboardEvent): boolean {
  // Either Mod (Cmd on macOS, Ctrl elsewhere) is enough to lift the
  // typing-target suppression. Plain Alt is not — Alt+letter is a
  // typing combo on most keyboard layouts.
  return event.metaKey || event.ctrlKey;
}

/**
 * Attach the global dispatcher. Returns a detacher; call from a
 * useEffect cleanup.
 */
export function attachGlobalKeybindings(): () => void {
  function onKeyDown(event: KeyboardEvent) {
    // In a typing surface, only modifier-bearing chords are allowed
    // through. This is what lets Mod+P open the palette while a search
    // box has focus, but doesn't break ordinary typing.
    if (isTypingTarget(event.target) && !hasCommandModifier(event)) {
      return;
    }

    const { commandId, consumed } = dispatchWithChord(event);
    if (consumed) {
      // We swallow the keystroke even when the command id is null:
      // either the chord is mid-flight, or a chord miss aborted —
      // either way letting the browser act on the second key would
      // surprise the user.
      event.preventDefault();
      event.stopPropagation();
    }
    void commandId; // commandId is run inside dispatchWithChord
  }

  // capture: true so we win the race against in-tree handlers; the
  // editor's own keymap can still preventDefault at its own bubble
  // phase for in-context bindings.
  window.addEventListener("keydown", onKeyDown, { capture: true });
  return () => {
    window.removeEventListener("keydown", onKeyDown, {
      capture: true,
    } as EventListenerOptions);
  };
}
